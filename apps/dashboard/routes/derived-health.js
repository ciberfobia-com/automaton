/**
 * Derived Health — Server-side computed diagnostics
 * 
 * Computes dispatch_age, run_age, zombie detection, stall detection
 * entirely from SQLite timestamps. No Conway Cloud telemetry needed.
 */
const express = require("express");
const router = express.Router();
const { safeAll, safeGet } = require("../lib/db");

const DISPATCH_THRESHOLD_MS = 60 * 1000;       // 60s — dispatch deadlock detection
const STALE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 min
const ZOMBIE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min

router.get("/health/derived", (_req, res) => {
    const now = Date.now();

    // ── Task Health ───────────────────────────────────
    const tasks = safeAll(`
        SELECT id, title, goal_id, status, assigned_to, timeout_ms,
               created_at, started_at, completed_at, retry_count, max_retries
        FROM task_graph
        WHERE status NOT IN ('completed', 'failed', 'cancelled')
    `);

    const taskHealth = tasks.map(t => {
        const createdMs = t.created_at ? new Date(t.created_at).getTime() : 0;
        const startedMs = t.started_at ? new Date(t.started_at).getTime() : 0;

        const dispatchAge = (t.status === "assigned" && !t.started_at)
            ? now - createdMs : null;
        const runAge = (t.started_at && !t.completed_at)
            ? now - startedMs : null;
        const timedOut = runAge !== null && t.timeout_ms > 0 && runAge > t.timeout_ms;
        const dispatchFailed = dispatchAge !== null && dispatchAge > DISPATCH_THRESHOLD_MS;
        const retriesRemaining = (t.max_retries || 0) - (t.retry_count || 0);

        let severity = "ok";
        if (timedOut) severity = "critical";
        else if (dispatchFailed) severity = "dispatch_deadlock";
        else if (t.status === "blocked") severity = "info";

        return {
            id: t.id,
            title: t.title,
            goal_id: t.goal_id,
            status: t.status,
            assigned_to: t.assigned_to,
            dispatch_age_ms: dispatchAge,
            run_age_ms: runAge,
            timed_out: timedOut,
            dispatch_failed: dispatchFailed,
            retries_remaining: retriesRemaining,
            severity,
        };
    });

    // ── Worker Health ─────────────────────────────────
    const children = safeAll(`
        SELECT id, sandbox_id, address, name, status, created_at, last_checked
        FROM children
    `);

    // Find last activity per worker address from turns/tool_calls
    const workerHealth = children.map(c => {
        // Last turn activity (check tool_calls for this worker's address)
        const lastActivity = safeGet(`
            SELECT MAX(tc.created_at) as last_act
            FROM tool_calls tc
            WHERE tc.result LIKE ? OR tc.result LIKE ?
        `, [`%${c.sandbox_id || "NOID"}%`, `%${c.address || "NOADDR"}%`]);

        const lastCheckedMs = c.last_checked ? new Date(c.last_checked).getTime() : 0;
        const lastActMs = lastActivity?.last_act ? new Date(lastActivity.last_act).getTime() : 0;
        const lastSignal = Math.max(lastCheckedMs, lastActMs);
        const silenceMs = lastSignal > 0 ? now - lastSignal : now;

        // Assigned tasks for this worker
        const assignedTasks = taskHealth.filter(t =>
            t.assigned_to === c.address || t.assigned_to === `local://${c.sandbox_id}`
        );

        let derived = "healthy";
        if (c.status === "failed" || c.status === "dead") {
            derived = "dead";
        } else if (silenceMs > ZOMBIE_THRESHOLD_MS && assignedTasks.length > 0) {
            derived = "zombie";
        } else if (silenceMs > STALE_THRESHOLD_MS && assignedTasks.length > 0) {
            derived = "stale";
        } else if (silenceMs > ZOMBIE_THRESHOLD_MS) {
            derived = "idle";
        }

        return {
            id: c.id,
            sandbox_id: c.sandbox_id,
            address: c.address,
            name: c.name,
            db_status: c.status,
            derived_status: derived,
            last_checked: c.last_checked,
            last_activity_ms: lastActMs || null,
            silence_ms: silenceMs,
            assigned_tasks: assignedTasks,
            runtime: c.address?.startsWith("local://") ? "local" : "cloud",
        };
    });

    // ── Goal Health ───────────────────────────────────
    const goals = safeAll(`SELECT id, title, status, created_at FROM goals WHERE status = 'active'`);
    const goalHealth = goals.map(g => {
        const gTasks = taskHealth.filter(t => t.goal_id === g.id);
        const dispatchFailures = gTasks.filter(t => t.dispatch_failed);
        const timedOutTasks = gTasks.filter(t => t.timed_out);
        const blockedTasks = gTasks.filter(t => t.status === "blocked");

        // Check for event delta — any recent event_stream activity?
        const lastEvent = safeGet(`
            SELECT MAX(created_at) as last_ev FROM event_stream WHERE goal_id = ?
        `, [g.id]);
        const lastEvMs = lastEvent?.last_ev ? new Date(lastEvent.last_ev).getTime() : 0;
        const eventSilenceMs = lastEvMs > 0 ? now - lastEvMs : now;

        let derived = "progressing";
        if (dispatchFailures.length > 0) derived = "dispatch_failure";
        else if (timedOutTasks.length > 0) derived = "worker_stall";
        else if (eventSilenceMs > ZOMBIE_THRESHOLD_MS && gTasks.length > 0) derived = "stalled";
        else if (blockedTasks.length === gTasks.length && gTasks.length > 0) derived = "blocked";

        return {
            id: g.id,
            title: g.title,
            derived_status: derived,
            total_tasks: gTasks.length,
            dispatch_failures: dispatchFailures.length,
            timed_out_tasks: timedOutTasks.length,
            blocked_tasks: blockedTasks.length,
            event_silence_ms: eventSilenceMs,
        };
    });

    // ── Summary ──────────────────────────────────────
    const criticalTasks = taskHealth.filter(t => t.severity === "critical").length;
    const dispatchDeadlocks = taskHealth.filter(t => t.severity === "dispatch_deadlock").length;
    const warningTasks = taskHealth.filter(t => t.severity === "warning").length;
    const zombieWorkers = workerHealth.filter(w => w.derived_status === "zombie").length;
    const staleWorkers = workerHealth.filter(w => w.derived_status === "stale").length;
    const stalledGoals = goalHealth.filter(g => g.derived_status !== "progressing").length;

    res.json({
        timestamp: new Date().toISOString(),
        summary: {
            critical_tasks: criticalTasks,
            dispatch_deadlocks: dispatchDeadlocks,
            warning_tasks: warningTasks,
            zombie_workers: zombieWorkers,
            stale_workers: staleWorkers,
            stalled_goals: stalledGoals,
            overall: (criticalTasks + zombieWorkers + dispatchDeadlocks) > 0 ? "critical"
                : (warningTasks + staleWorkers + stalledGoals) > 0 ? "warning"
                    : "healthy",
        },
        tasks: taskHealth,
        workers: workerHealth,
        goals: goalHealth,
    });
});

module.exports = router;
