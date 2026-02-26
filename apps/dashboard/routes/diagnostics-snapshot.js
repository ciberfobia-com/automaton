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

router.get("/diagnostics/snapshot", (_req, res) => {
    const minutes = Math.min(Math.max(parseInt(_req.query.minutes) || 5, 1), 30);
    const now = Date.now();
    const cutoff = `-${minutes} minutes`;
    const lines = [];

    const sep = (title) => {
        lines.push("");
        lines.push(`══ ${title} ══`);
    };

    // ── Header ─────────────────────────────────
    lines.push(`AUTOMATON DIAGNOSTIC SNAPSHOT`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Window: last ${minutes} minutes`);

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

    // ── Active Goals ───────────────────────────
    sep("GOALS");
    const goals = safeAll(`SELECT id, title, status, created_at FROM goals ORDER BY created_at DESC`);
    if (goals.length === 0) {
        lines.push("No goals found");
    } else {
        const active = goals.filter(g => g.status === "active");
        const completed = goals.filter(g => g.status === "completed");
        const failed = goals.filter(g => g.status === "failed");
        lines.push(`Total: ${goals.length} (active=${active.length} completed=${completed.length} failed=${failed.length})`);

        for (const g of goals.slice(0, 10)) {
            const taskCount = safeGet(`SELECT COUNT(*) as c FROM task_graph WHERE goal_id = ?`, [g.id]);
            const completedTasks = safeGet(`SELECT COUNT(*) as c FROM task_graph WHERE goal_id = ? AND status = 'completed'`, [g.id]);
            const failedTasks = safeGet(`SELECT COUNT(*) as c FROM task_graph WHERE goal_id = ? AND status = 'failed'`, [g.id]);
            lines.push(`  [${g.status}] "${g.title.slice(0, 60)}" tasks=${taskCount?.c || 0} done=${completedTasks?.c || 0} failed=${failedTasks?.c || 0}`);
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
            let flags = "";
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
            const lastCheckedAge = c.last_checked ? Math.floor((now - new Date(c.last_checked).getTime()) / 60000) : null;
            const runtime = c.address?.startsWith("local://") ? "local" : "cloud";

            // Worker spend
            const spendRow = safeGet(`SELECT SUM(amount_cents) as total FROM child_ledger WHERE address = ?`, [c.address]);
            const spent = spendRow?.total || 0;

            // Assigned tasks
            const workerTasks = tasks.filter(t => t.assigned_to === c.address || t.assigned_to === `local://${c.sandbox_id}`);
            const taskInfo = workerTasks.length > 0 ? ` tasks=[${workerTasks.map(t => t.status + ":" + (t.title || "").slice(0, 20)).join(", ")}]` : "";

            let flag = "";
            if (lastCheckedAge != null && lastCheckedAge > 10 && workerTasks.length > 0) flag = " ⚠ZOMBIE";
            else if (lastCheckedAge != null && lastCheckedAge > 5 && workerTasks.length > 0) flag = " ⚠STALE";

            lines.push(`  [${c.status}] ${c.name || c.id.slice(0, 8)} (${runtime}) silence=${lastCheckedAge != null ? lastCheckedAge + "m" : "—"} spent=${fmtCents(spent)}${taskInfo}${flag}`);
        }
    }

    // ── Economy (within window) ────────────────
    sep("ECONOMY (last " + minutes + "m)");
    const burnWindow = safeGet(`
        SELECT SUM(total_cost_cents) as cost, COUNT(*) as calls
        FROM inference_costs WHERE created_at > datetime('now', '${cutoff}')
    `);
    const burn1h = safeGet(`
        SELECT SUM(total_cost_cents) as cost FROM inference_costs WHERE created_at > datetime('now', '-1 hour')
    `);
    lines.push(`Inference cost (${minutes}m): ${fmtCents(burnWindow?.cost)} over ${burnWindow?.calls || 0} calls`);
    lines.push(`Inference cost (1h): ${fmtCents(burn1h?.cost)}`);

    const burnPerMin = (burnWindow?.cost || 0) / minutes;
    const balCents = balanceRaw?.creditsCents || 0;
    const ttl = burnPerMin > 0 ? Math.floor(balCents / burnPerMin) : -1;
    lines.push(`Burn rate: ${fmtCents(burnPerMin)}/min | Time to zero: ${ttl < 0 ? "∞" : ttl + "m"}`);

    // Tool spending
    const toolSpend = safeAll(`
        SELECT tool_name, SUM(amount_cents) as total, COUNT(*) as cnt
        FROM spend_tracking
        WHERE created_at > datetime('now', '${cutoff}')
        GROUP BY tool_name ORDER BY total DESC LIMIT 10
    `);
    if (toolSpend.length > 0) {
        lines.push(`Tool spend (${minutes}m):`);
        for (const ts of toolSpend) {
            lines.push(`  ${ts.tool_name}: ${fmtCents(ts.total)} (${ts.cnt} calls)`);
        }
    }

    // ── Recent Turns ───────────────────────────
    sep("RECENT TURNS (last " + minutes + "m)");
    const turns = safeAll(`
        SELECT id, state, input_source, cost_cents, tool_calls, timestamp
        FROM turns
        WHERE timestamp > datetime('now', '${cutoff}')
        ORDER BY timestamp DESC
    `);
    if (turns.length === 0) {
        lines.push("No turns in window");
    } else {
        lines.push(`Count: ${turns.length}`);
        for (const t of turns.slice(0, 20)) {
            let tools = "—";
            try {
                const tc = typeof t.tool_calls === "string" ? JSON.parse(t.tool_calls) : t.tool_calls;
                if (Array.isArray(tc)) tools = tc.map(x => x.name || x).join(",");
            } catch { }
            lines.push(`  [${t.state || "?"}] cost=${fmtCents(t.cost_cents)} src=${t.input_source || "?"} tools=${tools} ts=${t.timestamp}`);
        }
        if (turns.length > 20) lines.push(`  ... and ${turns.length - 20} more`);
    }

    // ── Recent Events ──────────────────────────
    sep("RECENT EVENTS (last " + minutes + "m)");
    const events = safeAll(`
        SELECT type, content, goal_id, token_count, created_at
        FROM event_stream
        WHERE created_at > datetime('now', '${cutoff}')
        ORDER BY created_at DESC LIMIT 30
    `);
    if (events.length === 0) {
        lines.push("No events in window");
    } else {
        lines.push(`Count: ${events.length}`);
        for (const e of events.slice(0, 15)) {
            lines.push(`  [${e.type}] "${(e.content || "").slice(0, 80)}" tokens=${e.token_count || 0} ts=${e.created_at}`);
        }
        if (events.length > 15) lines.push(`  ... and ${events.length - 15} more`);
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

    lines.push(`Dispatch deadlocks: ${deadlocks.length}`);
    lines.push(`Stalled/zombie workers: ${stalledWorkers.length}`);
    lines.push(`Stale recovery tasks: ${staleCounts.length}`);

    if (deadlocks.length > 0) {
        for (const d of deadlocks) {
            lines.push(`  DEADLOCK: task="${(d.title || "").slice(0, 40)}" worker=${d.assigned_to || "?"} wait=${Math.floor((now - new Date(d.created_at).getTime()) / 60000)}m`);
        }
    }

    lines.push("");
    lines.push("── END SNAPSHOT ──");

    res.type("text/plain").send(lines.join("\n"));
});

module.exports = router;
