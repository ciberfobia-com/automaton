/**
 * Child Resources — Phase 3
 *
 * GET /api/children/:id/resources
 *
 * Returns lifecycle-derived resource/health metrics.
 * Children run in E2B sandboxes, so CPU/memory is unavailable.
 */

const { Router } = require("express");
const db = require("../lib/db");
const router = Router();

router.get("/children/:id/resources", (req, res) => {
    const { id } = req.params;

    let child = db.safeGet("SELECT * FROM children WHERE id = ?", [id]);
    if (!child) child = db.safeGet("SELECT * FROM children WHERE sandbox_id = ?", [id]);
    if (!child) child = db.safeGet("SELECT * FROM children WHERE address = ? OR address = ?", [id, `local://${id}`]);
    if (!child) {
        return res.status(404).json({ error: "Child not found", id });
    }

    // ── Lifecycle-derived metrics ───────────────────────
    const lifecycle = db.safeAll(
        "SELECT * FROM child_lifecycle_events WHERE child_id = ? ORDER BY created_at ASC",
        [id]
    );

    // Uptime: time since last "healthy" or "running" transition
    const lastHealthy = [...lifecycle]
        .reverse()
        .find((e) => e.to_state === "healthy" || e.to_state === "funded" || e.to_state === "starting");
    let uptimeSeconds = null;
    if (lastHealthy && (child.status === "running" || child.status === "spawning")) {
        uptimeSeconds = Math.floor(
            (Date.now() - new Date(lastHealthy.created_at).getTime()) / 1000
        );
    }

    // Restart count: transitions to "starting" after initial start
    const startingEvents = lifecycle.filter((e) => e.to_state === "starting");
    const restartCount = Math.max(0, startingEvents.length - 1);

    // State timeline
    const stateTimeline = lifecycle.map((e) => ({
        from: e.from_state,
        to: e.to_state,
        reason: e.reason,
        timestamp: e.created_at,
    }));

    // ── Task completion stats ──────────────────────────
    const tasksTotal = db.safeGet(
        "SELECT COUNT(*) as count FROM task_graph WHERE assigned_to = ?",
        [child.address || ""]
    );
    const tasksCompleted = db.safeGet(
        "SELECT COUNT(*) as count FROM task_graph WHERE assigned_to = ? AND status = 'completed'",
        [child.address || ""]
    );
    const tasksFailed = db.safeGet(
        "SELECT COUNT(*) as count FROM task_graph WHERE assigned_to = ? AND status = 'failed'",
        [child.address || ""]
    );
    const tasksRunning = db.safeGet(
        "SELECT COUNT(*) as count FROM task_graph WHERE assigned_to = ? AND status IN ('running','assigned')",
        [child.address || ""]
    );

    res.json({
        childId: id,
        sandboxId: child.sandbox_id,
        status: child.status,

        // Resource metrics (limited — E2B sandbox)
        memory_mb: null,
        cpu_percent: null,
        uptime_seconds: uptimeSeconds,
        restart_count: restartCount,
        pm2_status: "not_applicable — child runs in E2B sandbox",

        // Lifecycle
        stateTimeline,
        totalStateTransitions: lifecycle.length,

        // Task stats
        tasks: {
            total: tasksTotal ? tasksTotal.count : 0,
            completed: tasksCompleted ? tasksCompleted.count : 0,
            failed: tasksFailed ? tasksFailed.count : 0,
            running: tasksRunning ? tasksRunning.count : 0,
        },
    });
});

module.exports = router;
