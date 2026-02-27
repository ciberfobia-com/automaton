/**
 * Diagnostics Snapshot — Plain-text system state dump for AI analysis
 *
 * GET /api/diagnostics/snapshot?minutes=2|5|10
 * Returns a compact, plain-text summary of the entire system state
 * for the requested time window. Designed for copy-paste into AI tools.
 */
const express = require("express");
const router = express.Router();
const { safeAll, safeGet } = require("../lib/db");

// ── Dashboard boot timestamp (captured once at module load) ──
const BOOT_TIME = new Date().toISOString();

function kv(key) {
    const row = safeGet("SELECT value FROM kv WHERE key = ?", [key]);
    return row ? row.value : null;
}

function kvJson(key) {
    const v = kv(key);
    if (!v) return null;
    try { return JSON.parse(v); } catch { return v; }
}

function fmtCents(c) {
    if (c == null) return "—";
    return "$" + (c / 100).toFixed(4);
}

/**
 * Compute ISO 8601 cutoff string in JS — solves the format mismatch
 * between app-generated timestamps (ISO 8601 with T and Z) and
 * SQLite's datetime() (space-separated, no Z).
 */
function isoCutoff(minutes) {
    return new Date(Date.now() - minutes * 60_000).toISOString();
}

router.get("/diagnostics/snapshot", (_req, res) => {
    const minutes = Math.min(Math.max(parseInt(_req.query.minutes) || 5, 1), 30);
    const now = Date.now();
    const cutoff = isoCutoff(minutes);
    const lines = [];

    const sep = (title) => {
        lines.push("");
        lines.push(`══ ${title} ══`);
    };

    // ── Header ─────────────────────────────────
    lines.push(`AUTOMATON DIAGNOSTIC SNAPSHOT`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Window: last ${minutes} minutes (cutoff: ${cutoff})`);
    lines.push(`Dashboard boot: ${BOOT_TIME} (uptime: ${Math.floor((now - new Date(BOOT_TIME).getTime()) / 60000)}m)`);

    // ── Agent State ────────────────────────────
    sep("AGENT STATE");
    lines.push(`State: ${kv("agent_state") || "unknown"}`);
    lines.push(`Credits: ${kv("credits_balance") || "—"}`);
    lines.push(`USDC: ${kv("usdc_balance") || "—"}`);
    lines.push(`Survival Tier: ${kv("survival_tier") || "—"}`);
    lines.push(`Model: ${kv("current_model") || kv("inference_model") || "—"}`);

    const balanceRaw = kvJson("last_known_balance");
    if (balanceRaw) {
        lines.push(`Last Known Balance: creditsCents=${balanceRaw.creditsCents || 0}`);
    }

    // ── Orchestrator ───────────────────────────
    sep("ORCHESTRATOR");
    const orchState = kvJson("orchestrator.state") || {};
    lines.push(`Phase: ${orchState.phase || "unknown"}`);
    lines.push(`Goal ID: ${orchState.goalId || "none"}`);
    lines.push(`Replan Count: ${orchState.replanCount || 0}`);

    const lastTick = kvJson("orchestrator.last_tick");
    if (lastTick) {
        lines.push(`Last Tick: action=${lastTick.action || "?"} result=${lastTick.result || "?"} ts=${lastTick.timestamp || "?"}`);
    } else {
        lines.push(`Last Tick: no tick recorded`);
    }

    // Stale recovery counts
    const staleCounts = safeAll(`
        SELECT key, value, updated_at FROM kv
        WHERE key LIKE 'orchestrator.stale_count.%'
        ORDER BY updated_at DESC
    `);
    if (staleCounts.length > 0) {
        lines.push(`Stale Recoveries: ${staleCounts.length} tasks tracked`);
        for (const sc of staleCounts) {
            const taskId = sc.key.replace("orchestrator.stale_count.", "");
            lines.push(`  task=${taskId.slice(0, 8)}… count=${sc.value} updated=${sc.updated_at}`);
        }
    }

    // ── Goals ──────────────────────────────────
    sep("GOALS");
    const goals = safeAll(`SELECT id, title, status, created_at, completed_at FROM goals ORDER BY created_at DESC`);
    if (goals.length === 0) {
        lines.push("No goals found");
    } else {
        const active = goals.filter(g => g.status === "active");
        const completed = goals.filter(g => g.status === "completed");
        const failed = goals.filter(g => g.status === "failed");
        const recentFailed = failed.filter(g => (g.completed_at || g.created_at) > cutoff);
        lines.push(`Total: ${goals.length} (active=${active.length} completed=${completed.length} failed=${failed.length})`);
        if (recentFailed.length > 0) {
            lines.push(`⚠ Failed in window: ${recentFailed.length}`);
        }

        for (const g of goals.slice(0, 10)) {
            const taskCount = safeGet(`SELECT COUNT(*) as c FROM task_graph WHERE goal_id = ?`, [g.id]);
            const completedTasks = safeGet(`SELECT COUNT(*) as c FROM task_graph WHERE goal_id = ? AND status = 'completed'`, [g.id]);
            const failedTasks = safeGet(`SELECT COUNT(*) as c FROM task_graph WHERE goal_id = ? AND status = 'failed'`, [g.id]);
            const cancelledTasks = safeGet(`SELECT COUNT(*) as c FROM task_graph WHERE goal_id = ? AND status = 'cancelled'`, [g.id]);
            lines.push(`  [${g.status}] "${g.title.slice(0, 60)}" tasks=${taskCount?.c || 0} done=${completedTasks?.c || 0} failed=${failedTasks?.c || 0} cancelled=${cancelledTasks?.c || 0}`);
        }
    }

    // ── Task Graph (non-terminal) ──────────────
    sep("ACTIVE TASKS");
    const tasks = safeAll(`
        SELECT id, title, status, assigned_to, started_at, created_at, goal_id, timeout_ms, retry_count, max_retries
        FROM task_graph
        WHERE status NOT IN ('completed', 'failed', 'cancelled')
        ORDER BY created_at DESC
    `);
    if (tasks.length === 0) {
        lines.push("No active tasks");
    } else {
        lines.push(`Total active: ${tasks.length}`);
        for (const t of tasks) {
            const age = t.started_at ? Math.floor((now - new Date(t.started_at).getTime()) / 60000) : null;
            const dispatchAge = (!t.started_at && t.created_at) ? Math.floor((now - new Date(t.created_at).getTime()) / 60000) : null;
            // Check if the goal is already failed/completed
            const goalRow = safeGet(`SELECT status FROM goals WHERE id = ?`, [t.goal_id]);
            let flags = "";
            if (goalRow && goalRow.status === "failed") flags += " ⚠ORPHAN(goal_failed)";
            if (goalRow && goalRow.status === "completed") flags += " ⚠ORPHAN(goal_done)";
            if (dispatchAge != null && dispatchAge > 1) flags += " DISPATCH_WAIT=" + dispatchAge + "m";
            if (age != null && t.timeout_ms > 0 && (age * 60000) > t.timeout_ms) flags += " TIMED_OUT";
            lines.push(`  [${t.status}] "${(t.title || "").slice(0, 50)}" worker=${t.assigned_to || "unassigned"} runAge=${age != null ? age + "m" : "—"} retries=${t.retry_count || 0}/${t.max_retries || 0}${flags}`);
        }
    }

    // ── Workers / Children ─────────────────────
    sep("WORKERS");
    const children = safeAll(`
        SELECT id, sandbox_id, address, name, status, created_at, last_checked
        FROM children ORDER BY created_at DESC
    `);
    if (children.length === 0) {
        lines.push("No workers found");
    } else {
        lines.push(`Total: ${children.length}`);
        for (const c of children) {
            const lastCheckedMs = c.last_checked ? new Date(c.last_checked).getTime() : 0;
            // Also check event_stream for recent worker_log entries (same fix as workers.js)
            const lastWorkerLog = safeGet(`SELECT MAX(created_at) as t FROM event_stream WHERE type = 'worker_log' AND agent_address = ?`, [c.address || ""]);
            const lastLogMs = lastWorkerLog?.t ? new Date(lastWorkerLog.t).getTime() : 0;
            const lastSignal = Math.max(lastCheckedMs, lastLogMs);
            const lastCheckedAge = lastSignal > 0 ? Math.floor((now - lastSignal) / 60000) : null;
            const createdAge = Math.floor((now - new Date(c.created_at).getTime()) / 60000);
            const isLocal = c.address?.startsWith("local://");
            const runtime = isLocal ? "local" : "cloud";

            // Worker spend (try, may not have this table)
            let spent = 0;
            try {
                const spendRow = safeGet(`SELECT SUM(amount_cents) as total FROM child_ledger WHERE address = ?`, [c.address]);
                spent = spendRow?.total || 0;
            } catch { }

            // Assigned tasks
            const workerTasks = tasks.filter(t => t.assigned_to === c.address || t.assigned_to === `local://${c.sandbox_id}`);
            const taskInfo = workerTasks.length > 0 ? ` tasks=[${workerTasks.map(t => t.status + ":" + (t.title || "").slice(0, 20)).join(", ")}]` : " tasks=none";

            // Flags
            let flag = "";
            if (c.status === "running" && workerTasks.length === 0) {
                flag = " ⚠GHOST(running+no_tasks)";
            }
            if (lastCheckedAge != null && lastCheckedAge > 10 && workerTasks.length > 0) flag = " ⚠ZOMBIE";
            else if (lastCheckedAge != null && lastCheckedAge > 5 && workerTasks.length > 0) flag = " ⚠STALE";

            // Explain local workers
            const note = isLocal ? " [uses padre inference, no separate funding]" : "";

            lines.push(`  [${c.status}] ${c.name || c.id.slice(0, 8)} (${runtime}) age=${createdAge}m silence=${lastCheckedAge != null ? lastCheckedAge + "m" : "—"} spent=${fmtCents(spent)}${taskInfo}${flag}${note}`);

            // Show lifecycle events for this worker (last 5 transitions)
            const lifecycleEvents = safeAll(`
                SELECT from_state, to_state, reason, created_at
                FROM child_lifecycle_events
                WHERE child_id = ?
                ORDER BY created_at DESC LIMIT 5
            `, [c.id]);
            if (lifecycleEvents.length > 0) {
                for (const le of lifecycleEvents.reverse()) {
                    lines.push(`      ${le.from_state} → ${le.to_state}: ${(le.reason || "").slice(0, 80)} ts=${le.created_at}`);
                }
            }
        }
    }

    // ── Economy ─────────────────────────────────
    sep("ECONOMY");
    const balCents = balanceRaw?.creditsCents || 0;
    const usdcBal = kv("usdc_balance") || "—";
    lines.push(`  Credits:  ${fmtCents(balCents)} (${balCents} cents)`);
    lines.push(`  USDC:     ${usdcBal}`);
    lines.push(`  Combined: ~${fmtCents(balCents)} credits + ${usdcBal} on-chain`);
    lines.push("");

    // Inference costs table
    const burnWindow = safeGet(`
        SELECT SUM(cost_cents) as cost, COUNT(*) as calls
        FROM inference_costs WHERE created_at > ?
    `, [cutoff]);
    const burn1h = safeGet(`
        SELECT SUM(cost_cents) as cost, COUNT(*) as calls
        FROM inference_costs WHERE created_at > ?
    `, [isoCutoff(60)]);
    const burn24h = safeGet(`
        SELECT SUM(cost_cents) as cost, COUNT(*) as calls
        FROM inference_costs WHERE created_at > ?
    `, [isoCutoff(24 * 60)]);
    const burnAllTime = safeGet(`
        SELECT SUM(cost_cents) as cost, COUNT(*) as calls FROM inference_costs
    `);

    lines.push(`  Inference Costs:`);
    lines.push(`    Last ${minutes}m:  ${fmtCents(burnWindow?.cost)} (${burnWindow?.calls || 0} calls)`);
    lines.push(`    Last 1h:     ${fmtCents(burn1h?.cost)} (${burn1h?.calls || 0} calls)`);
    lines.push(`    Last 24h:    ${fmtCents(burn24h?.cost)} (${burn24h?.calls || 0} calls)`);
    lines.push(`    All time:    ${fmtCents(burnAllTime?.cost)} (${burnAllTime?.calls || 0} calls)`);

    const burnPerMin = (burnWindow?.cost || 0) / minutes;
    const ttl = burnPerMin > 0 ? Math.floor(balCents / burnPerMin) : -1;
    lines.push(`    Rate: ${fmtCents(burnPerMin)}/min → TTZ: ${ttl < 0 ? "∞" : ttl + "m"}`);
    lines.push("");

    // Turn costs in window
    const turnCosts = safeGet(`
        SELECT SUM(cost_cents) as cost, COUNT(*) as cnt
        FROM turns WHERE timestamp > ?
    `, [cutoff]);
    lines.push(`  Turn costs (${minutes}m): ${fmtCents(turnCosts?.cost)} over ${turnCosts?.cnt || 0} turns`);

    // Sandbox / child creation costs
    const sandboxCreations = safeAll(`
        SELECT description, timestamp FROM modifications
        WHERE type = 'child_spawn'
        ORDER BY timestamp DESC LIMIT 5
    `);
    if (sandboxCreations.length > 0) {
        lines.push(``);
        lines.push(`  Sandbox Spawns (recent):`);
        for (const s of sandboxCreations) {
            lines.push(`    ${(s.description || "").slice(0, 80)} ts=${s.timestamp}`);
        }
    }
    // Child funding totals
    const childFunding = safeAll(`
        SELECT name, address, status, funded_amount_cents
        FROM children WHERE funded_amount_cents > 0
        ORDER BY funded_amount_cents DESC
    `);
    if (childFunding.length > 0) {
        lines.push(``);
        lines.push(`  Child Funding:`);
        for (const cf of childFunding) {
            lines.push(`    ${cf.name}: ${fmtCents(cf.funded_amount_cents)} [${cf.status}]`);
        }
    }

    // Tool spending
    const toolSpend = safeAll(`
        SELECT tool_name, SUM(amount_cents) as total, COUNT(*) as cnt
        FROM spend_tracking
        WHERE created_at > ?
        GROUP BY tool_name ORDER BY total DESC LIMIT 10
    `, [cutoff]);
    if (toolSpend.length > 0) {
        lines.push(``);
        lines.push(`  Tool Spend (${minutes}m):`);
        for (const ts of toolSpend) {
            lines.push(`    ${ts.tool_name}: ${fmtCents(ts.total)} (${ts.cnt} calls)`);
        }
    }

    // ── Recent Turns ───────────────────────────
    sep("RECENT TURNS (last " + minutes + "m)");
    const turns = safeAll(`
        SELECT id, state, input_source, cost_cents, tool_calls, timestamp
        FROM turns
        WHERE timestamp > ?
        ORDER BY timestamp DESC
    `, [cutoff]);
    if (turns.length === 0) {
        lines.push("No turns in window");
    } else {
        lines.push(`Count: ${turns.length}`);
        for (const t of turns.slice(0, 25)) {
            let tools = "—";
            try {
                const tc = typeof t.tool_calls === "string" ? JSON.parse(t.tool_calls) : t.tool_calls;
                if (Array.isArray(tc)) tools = tc.map(x => x.name || x).join(",");
            } catch { }
            lines.push(`  [${t.state || "?"}] cost=${fmtCents(t.cost_cents)} src=${t.input_source || "?"} tools=${tools} ts=${t.timestamp}`);
        }
        if (turns.length > 25) lines.push(`  ... and ${turns.length - 25} more turns`);
    }

    // ── Recent Events ──────────────────────────
    sep("RECENT EVENTS (last " + minutes + "m)");
    const events = safeAll(`
        SELECT type, content, goal_id, task_id, agent_address, token_count, created_at
        FROM event_stream
        WHERE type != 'worker_log'
          AND created_at > ?
        ORDER BY created_at DESC LIMIT 50
    `, [cutoff]);
    if (events.length === 0) {
        lines.push("No events in window");
    } else {
        lines.push(`Count: ${events.length}`);
        for (const e of events) {
            lines.push(`  [${e.type}] "${(e.content || "").slice(0, 100)}" ts=${e.created_at}`);
        }
    }

    // ── Worker Activity (per-worker grouped) ─────
    sep("WORKER ACTIVITY (last " + minutes + "m)");
    const workerLogs = safeAll(`
        SELECT agent_address, task_id, content, created_at
        FROM event_stream
        WHERE type = 'worker_log'
          AND created_at > ?
        ORDER BY created_at ASC
    `, [cutoff]);
    if (workerLogs.length === 0) {
        lines.push("No worker activity in window");
        // Show most recent logs GROUPED BY WORKER (max 3 per worker)
        const recentLogs = safeAll(`
            SELECT agent_address, content, created_at
            FROM event_stream
            WHERE type = 'worker_log'
            ORDER BY created_at DESC LIMIT 50
        `);
        if (recentLogs.length > 0) {
            const grouped = {};
            for (const wl of recentLogs) {
                const addr = wl.agent_address || "unknown";
                if (!grouped[addr]) grouped[addr] = [];
                if (grouped[addr].length < 3) grouped[addr].push(wl);
            }
            lines.push(`  (showing recent logs per worker from all time):`);
            for (const [addr, logs] of Object.entries(grouped)) {
                const workerId = addr.replace("local://", "").slice(-6);
                for (const wl of logs) {
                    lines.push(`    [${workerId}] ${(wl.content || "").slice(0, 120)} ts=${wl.created_at}`);
                }
            }
        }
    } else {
        // Group by worker
        const byWorker = {};
        for (const wl of workerLogs) {
            const addr = wl.agent_address || "unknown";
            if (!byWorker[addr]) byWorker[addr] = [];
            byWorker[addr].push(wl);
        }
        lines.push(`Total: ${workerLogs.length} entries from ${Object.keys(byWorker).length} workers`);
        for (const [addr, logs] of Object.entries(byWorker)) {
            const workerId = addr.replace("local://", "").slice(-8);
            lines.push(`  Worker ${workerId}:`);
            for (const wl of logs) {
                lines.push(`    ${(wl.content || "").slice(0, 120)} ts=${wl.created_at}`);
            }
        }
    }

    // ── Diagnostics Flags ──────────────────────
    sep("DIAGNOSTIC FLAGS");
    const deadlocks = tasks.filter(t => t.status === "assigned" && !t.started_at &&
        (now - new Date(t.created_at).getTime()) > 60000);
    const stalledWorkers = children.filter(c => {
        const age = c.last_checked ? (now - new Date(c.last_checked).getTime()) / 60000 : 999;
        const hasTasks = tasks.some(t => t.assigned_to === c.address || t.assigned_to === `local://${c.sandbox_id}`);
        return age > 5 && hasTasks;
    });
    const ghostWorkers = children.filter(c =>
        c.status === "running" &&
        !tasks.some(t => t.assigned_to === c.address || t.assigned_to === `local://${c.sandbox_id}`)
    );
    // Stale local tasks: assigned/running to local:// but worker is dead or missing
    const staleLocalTasks = tasks.filter(t =>
        (t.status === "assigned" || t.status === "running") &&
        t.assigned_to && t.assigned_to.startsWith("local://") &&
        !children.some(c => c.address === t.assigned_to && c.status === "running")
    );

    lines.push(`Dispatch deadlocks: ${deadlocks.length}`);
    lines.push(`Stalled/zombie workers: ${stalledWorkers.length}`);
    lines.push(`Ghost workers (running, no tasks): ${ghostWorkers.length}`);
    lines.push(`Stale recovery tasks: ${staleCounts.length}`);
    lines.push(`Orphaned local tasks (worker dead): ${staleLocalTasks.length}`);

    if (deadlocks.length > 0) {
        for (const d of deadlocks) {
            lines.push(`  DEADLOCK: task="${(d.title || "").slice(0, 40)}" worker=${d.assigned_to || "?"} wait=${Math.floor((now - new Date(d.created_at).getTime()) / 60000)}m`);
        }
    }

    if (stalledWorkers.length > 0) {
        for (const w of stalledWorkers) {
            const workerTasks = tasks.filter(t => t.assigned_to === w.address);
            const silence = w.last_checked ? Math.floor((now - new Date(w.last_checked).getTime()) / 60000) : 999;
            lines.push(`  ZOMBIE: ${w.name || w.id.slice(0, 8)} silence=${silence}m tasks=${workerTasks.length}`);
            lines.push(`    Likely cause: process restart killed in-memory worker, task stuck`);
            for (const t of workerTasks) {
                lines.push(`    → task="${(t.title || "").slice(0, 50)}" status=${t.status}`);
            }
        }
    }

    if (ghostWorkers.length > 0) {
        for (const g of ghostWorkers) {
            lines.push(`  GHOST: ${g.name || g.id.slice(0, 8)} status=${g.status} address=${g.address}`);
        }
    }

    if (staleLocalTasks.length > 0) {
        lines.push(`  ⚠ RECOVERY NEEDED: ${staleLocalTasks.length} task(s) assigned to dead local workers:`);
        for (const t of staleLocalTasks) {
            lines.push(`    → task="${(t.title || "").slice(0, 50)}" worker=${t.assigned_to} status=${t.status}`);
        }
        lines.push(`    These will be auto-recovered on next orchestrator restart.`);
    }

    lines.push("");
    lines.push("── END SNAPSHOT ──");

    res.type("text/plain").send(lines.join("\n"));
});

module.exports = router;
