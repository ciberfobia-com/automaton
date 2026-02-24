/**
 * Child Details API — Phase 1 + Phase 5 (Failed Diagnostics)
 *
 * GET /api/children/:id/details
 *
 * Returns enriched child JSON with lifecycle, tasks, goals,
 * activity, financial summary, and failure diagnostics.
 */

const { Router } = require("express");
const db = require("../lib/db");
const router = Router();

router.get("/children/:id/details", (req, res) => {
    const { id } = req.params;

    // ── Core metadata ──────────────────────────────────
    const child = db.safeGet("SELECT * FROM children WHERE id = ?", [id]);
    if (!child) {
        return res.status(404).json({ error: "Child not found", id });
    }

    // ── Lifecycle events ───────────────────────────────
    const lifecycle = db.safeAll(
        "SELECT * FROM child_lifecycle_events WHERE child_id = ? ORDER BY created_at DESC LIMIT 50",
        [id]
    );

    // ── Current lifecycle state (latest transition) ────
    const latestState = db.safeGet(
        "SELECT to_state, reason, metadata, created_at FROM child_lifecycle_events WHERE child_id = ? ORDER BY created_at DESC LIMIT 1",
        [id]
    );

    // ── Assigned tasks from task_graph ─────────────────
    const tasks = db.safeAll(
        "SELECT * FROM task_graph WHERE assigned_to = ? ORDER BY created_at DESC LIMIT 20",
        [child.address || ""]
    );

    // Current task (running or pending)
    const currentTask = db.safeGet(
        "SELECT * FROM task_graph WHERE assigned_to = ? AND status IN ('running','assigned','pending') ORDER BY priority DESC LIMIT 1",
        [child.address || ""]
    );

    // ── Goal assignment ────────────────────────────────
    let goal = null;
    if (currentTask && currentTask.goal_id) {
        goal = db.safeGet("SELECT * FROM goals WHERE id = ?", [currentTask.goal_id]);
    }
    // Fallback: any goal from any assigned task
    if (!goal && tasks.length > 0) {
        const firstGoalId = tasks.find((t) => t.goal_id)?.goal_id;
        if (firstGoalId) {
            goal = db.safeGet("SELECT * FROM goals WHERE id = ?", [firstGoalId]);
        }
    }

    // ── Activity events from event_stream ──────────────
    const events = db.safeAll(
        "SELECT * FROM event_stream WHERE agent_address = ? ORDER BY created_at DESC LIMIT 30",
        [child.address || ""]
    );

    // ── Recent turns (tool_calls mentioning child) ─────
    // Children don't have their own turns in parent DB, but we can look
    // for tool_calls that reference the child
    const recentToolCalls = db.safeAll(
        `SELECT tc.*, t.timestamp as turn_timestamp, t.cost_cents, t.state
     FROM tool_calls tc
     JOIN turns t ON tc.turn_id = t.id
     WHERE tc.arguments LIKE ? OR tc.result LIKE ?
     ORDER BY tc.created_at DESC LIMIT 20`,
        [`%${id}%`, `%${id}%`]
    );

    // Turn count referencing this child
    const turnCountRow = db.safeGet(
        `SELECT COUNT(DISTINCT tc.turn_id) as count
     FROM tool_calls tc
     WHERE tc.arguments LIKE ? OR tc.result LIKE ?`,
        [`%${id}%`, `%${id}%`]
    );
    const turnCount = turnCountRow ? turnCountRow.count : 0;

    // ── Tools used (last 5 unique from events or tool_calls) ──
    const toolsUsed = [];
    const toolSet = new Set();
    for (const tc of recentToolCalls) {
        if (tc.name && !toolSet.has(tc.name)) {
            toolSet.add(tc.name);
            toolsUsed.push(tc.name);
            if (toolsUsed.length >= 5) break;
        }
    }

    // ── Financial summary ──────────────────────────────
    // Transactions mentioning child in description
    const childTransactions = db.safeAll(
        "SELECT * FROM transactions WHERE description LIKE ? ORDER BY created_at DESC LIMIT 20",
        [`%${id}%`]
    );
    // Also try matching by name
    const childTransactionsByName = child.name
        ? db.safeAll(
            "SELECT * FROM transactions WHERE description LIKE ? ORDER BY created_at DESC LIMIT 20",
            [`%${child.name}%`]
        )
        : [];
    // Merge & dedupe
    const allChildTxns = [...childTransactions];
    const txnIds = new Set(allChildTxns.map((t) => t.id));
    for (const t of childTransactionsByName) {
        if (!txnIds.has(t.id)) allChildTxns.push(t);
    }

    const totalSpentCents = allChildTxns
        .filter((t) => t.amount_cents < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);

    // Task costs
    const taskCosts = tasks.reduce((sum, t) => sum + (t.actual_cost_cents || 0), 0);

    // ── Balances (from KV if child-specific keys exist) ─
    const kvGet = (key) => {
        const row = db.safeGet("SELECT value FROM kv WHERE key = ?", [key]);
        return row ? row.value : null;
    };
    const creditBalance = kvGet(`child_credits_${id}`) || null;
    const usdcBalance = kvGet(`child_usdc_${id}`) || null;

    // ── Failed child diagnostics (Phase 5) ─────────────
    let failureDiagnostics = null;
    if (child.status === "dead" || child.status === "failed" || child.status === "unknown") {
        const errorEvents = lifecycle.filter(
            (e) => e.to_state === "failed" || e.to_state === "stopped" || e.to_state === "unhealthy"
        );
        const restartAttempts = lifecycle.filter(
            (e) => e.to_state === "starting" || e.to_state === "runtime_ready"
        ).length;

        failureDiagnostics = {
            lastErrors: errorEvents.slice(0, 5).map((e) => ({
                state: e.to_state,
                reason: e.reason,
                metadata: safeParseJSON(e.metadata),
                timestamp: e.created_at,
            })),
            failureReason: errorEvents.length > 0 ? errorEvents[0].reason : null,
            failureTime: errorEvents.length > 0 ? errorEvents[0].created_at : null,
            creditsAtFailure: child.funded_amount_cents,
            restartAttempts,
            restartCount: restartAttempts,
        };
    }

    // ── Last error (from any source) ───────────────────
    const lastErrorEvent = lifecycle.find(
        (e) => e.to_state === "failed" || e.to_state === "unhealthy"
    );

    // ── Build response ─────────────────────────────────
    res.json({
        id: child.id,
        name: child.name,
        status: child.status,
        address: child.address,
        sandbox_id: child.sandbox_id,
        role: child.role || "generalist",
        created_at: child.created_at,
        last_checked: child.last_checked,
        model: null, // Not stored per-child in parent DB
        parent_id: "parent",
        goal_id: goal ? goal.id : null,
        goal_title: goal ? goal.title : null,
        goal_status: goal ? goal.status : null,
        current_task: currentTask
            ? {
                id: currentTask.id,
                title: currentTask.title,
                status: currentTask.status,
                priority: currentTask.priority,
            }
            : null,
        turn_count: turnCount,
        credit_balance: creditBalance,
        usdc_balance: usdcBalance,
        funded_amount_cents: child.funded_amount_cents,
        total_spent_credits: totalSpentCents + taskCosts,
        last_error: lastErrorEvent ? lastErrorEvent.reason : null,
        failure_reason: failureDiagnostics ? failureDiagnostics.failureReason : null,
        state_summary: latestState
            ? `${latestState.to_state}${latestState.reason ? " — " + latestState.reason : ""}`
            : child.status,
        tools_used_last_5: toolsUsed,
        recent_turns: recentToolCalls.slice(0, 10).map((tc) => ({
            turn_id: tc.turn_id,
            timestamp: tc.turn_timestamp || tc.created_at,
            tool_name: tc.name,
            cost_cents: tc.cost_cents || 0,
            duration_ms: tc.duration_ms,
        })),
        lifecycle,
        tasks: tasks.slice(0, 10),
        events: events.slice(0, 20),
        transactions: allChildTxns,
        failureDiagnostics,
    });
});

function safeParseJSON(str) {
    if (!str) return null;
    try {
        return JSON.parse(str);
    } catch {
        return str;
    }
}

module.exports = router;
