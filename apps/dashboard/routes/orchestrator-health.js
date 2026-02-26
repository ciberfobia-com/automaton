/**
 * Orchestrator Health API — cycle detection, stale recovery tracking
 */
const express = require("express");
const router = express.Router();
const { safeAll, safeGet } = require("../lib/db");

router.get("/orchestrator/health", (_req, res) => {
    // Orchestrator state
    const stateRow = safeGet(`SELECT value FROM kv WHERE key = 'orchestrator.state'`);
    let orchState = { phase: "unknown", goalId: null, replanCount: 0 };
    if (stateRow?.value) {
        try { orchState = JSON.parse(stateRow.value); } catch { }
    }

    // Active goal info
    let activeGoal = null;
    if (orchState.goalId) {
        activeGoal = safeGet(`SELECT id, title, status, created_at FROM goals WHERE id = ?`, [orchState.goalId]);
    }

    // Last tick result
    const tickRow = safeGet(`SELECT value FROM kv WHERE key = 'orchestrator.last_tick'`);
    let lastTick = null;
    if (tickRow?.value) {
        try { lastTick = JSON.parse(tickRow.value); } catch { }
    }

    // Stale recovery counts (orchestrator.stale_count.*)
    const staleCounts = safeAll(`
        SELECT key, value, updated_at FROM kv
        WHERE key LIKE 'orchestrator.stale_count.%'
        ORDER BY updated_at DESC
    `);

    const staleRecoveries = staleCounts.map(row => {
        const taskId = row.key.replace("orchestrator.stale_count.", "");
        const count = parseInt(row.value, 10) || 0;
        const task = safeGet(`SELECT id, title, status, assigned_to, max_retries FROM task_graph WHERE id = ?`, [taskId]);
        return {
            taskId,
            count,
            maxRetries: task?.max_retries ?? 3,
            taskTitle: task?.title || "Unknown",
            taskStatus: task?.status || "unknown",
            assignedTo: task?.assigned_to || null,
            lastRecovery: row.updated_at,
            exhausted: count >= (task?.max_retries ?? 3),
        };
    });

    // Cycle detection: if any task has been recovered 2+ times recently, it's a cycle
    const cycleDetected = staleRecoveries.some(r => r.count >= 2 && !r.exhausted);
    const totalStaleRecoveries = staleRecoveries.reduce((sum, r) => sum + r.count, 0);

    // Recent orchestrator plans
    const plans = safeAll(`
        SELECT key, updated_at FROM kv
        WHERE key LIKE 'orchestrator.plan.%' OR key LIKE 'orchestrator.replan.%'
        ORDER BY updated_at DESC LIMIT 5
    `);

    res.json({
        phase: orchState.phase,
        goalId: orchState.goalId,
        replanCount: orchState.replanCount || 0,
        activeGoal,
        lastTick,
        cycleDetected,
        totalStaleRecoveries,
        staleRecoveries,
        recentPlans: plans.map(p => ({
            type: p.key.includes("replan") ? "replan" : "plan",
            goalId: p.key.split(".").pop(),
            updatedAt: p.updated_at,
        })),
    });
});

module.exports = router;
