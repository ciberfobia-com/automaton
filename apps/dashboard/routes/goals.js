/**
 * Goals API — list + detail with task health, events, costs
 */
const express = require("express");
const router = express.Router();
const { safeAll, safeGet } = require("../lib/db");

// List all goals with progress summary
router.get("/goals", (_req, res) => {
    const goals = safeAll(`
        SELECT g.id, g.title, g.description, g.status, g.strategy,
               g.expected_revenue_cents, g.actual_revenue_cents,
               g.created_at, g.completed_at, g.deadline,
               COUNT(t.id) as task_count,
               SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) as completed_tasks,
               SUM(CASE WHEN t.status='failed' THEN 1 ELSE 0 END) as failed_tasks,
               SUM(CASE WHEN t.status IN ('running','assigned') THEN 1 ELSE 0 END) as active_tasks,
               SUM(CASE WHEN t.status='blocked' THEN 1 ELSE 0 END) as blocked_tasks,
               SUM(COALESCE(t.actual_cost_cents, 0)) as total_cost_cents
        FROM goals g
        LEFT JOIN task_graph t ON t.goal_id = g.id
        GROUP BY g.id
        ORDER BY g.created_at DESC
    `);
    res.json(goals);
});

// Goal detail with full task table + events + costs
router.get("/goals/:id", (req, res) => {
    const id = req.params.id;

    const goal = safeGet(`SELECT * FROM goals WHERE id = ?`, [id]);
    if (!goal) return res.status(404).json({ error: "Goal not found" });

    const now = Date.now();

    // Tasks with derived health
    const tasks = safeAll(`
        SELECT id, title, description, status, assigned_to, agent_role, priority,
               dependencies, result, estimated_cost_cents, actual_cost_cents,
               timeout_ms, retry_count, max_retries,
               created_at, started_at, completed_at
        FROM task_graph WHERE goal_id = ?
        ORDER BY created_at ASC
    `, [id]);

    const tasksWithHealth = tasks.map(t => {
        const createdMs = t.created_at ? new Date(t.created_at).getTime() : 0;
        const startedMs = t.started_at ? new Date(t.started_at).getTime() : 0;

        const dispatchAge = (t.status === "assigned" && !t.started_at)
            ? now - createdMs : null;
        const runAge = (t.started_at && !t.completed_at)
            ? now - startedMs : null;
        const timedOut = runAge !== null && t.timeout_ms > 0 && runAge > t.timeout_ms;
        const dispatchFailed = dispatchAge !== null && dispatchAge > 120000;

        return {
            ...t,
            dispatch_age_ms: dispatchAge,
            run_age_ms: runAge,
            timed_out: timedOut,
            dispatch_failed: dispatchFailed,
            retries_remaining: (t.max_retries || 0) - (t.retry_count || 0),
        };
    });

    // Events
    const events = safeAll(`
        SELECT type, content, token_count, created_at
        FROM event_stream WHERE goal_id = ?
        ORDER BY created_at DESC LIMIT 50
    `, [id]);

    // Cost breakdown
    const costByModel = safeAll(`
        SELECT model, SUM(total_cost_cents) as cost, SUM(input_tokens + output_tokens) as tokens, COUNT(*) as calls
        FROM inference_costs
        WHERE created_at >= (SELECT created_at FROM goals WHERE id = ?)
        GROUP BY model
        ORDER BY cost DESC
    `, [id]);

    res.json({
        goal,
        tasks: tasksWithHealth,
        events,
        cost_breakdown: costByModel,
    });
});

module.exports = router;
