/**
 * Admin Actions — safe DB mutations for operational control
 * 
 * Uses only validated, specific SQLite statements.
 * No arbitrary SQL. No TS imports.
 */
const express = require("express");
const router = express.Router();
const { getDb } = require("../lib/db");

router.post("/admin/unassign_task", (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ error: "Database not connected" });

    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: "Missing taskId" });

    try {
        const task = db.prepare("SELECT status FROM task_graph WHERE id = ?").get(taskId);
        if (!task) return res.status(404).json({ error: "Task not found" });
        if (task.status !== "running" && task.status !== "assigned") {
            return res.status(400).json({ error: `Task must be assigned/running, got '${task.status}'` });
        }

        db.prepare(`UPDATE task_graph SET status = 'pending', assigned_to = NULL, started_at = NULL WHERE id = ?`).run(taskId);
        res.json({ success: true, message: "Task unassigned → pending" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post("/admin/mark_task_failed", (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ error: "Database not connected" });

    const { taskId, reason } = req.body;
    if (!taskId || !reason) return res.status(400).json({ error: "Missing taskId or reason" });

    try {
        const task = db.prepare("SELECT status FROM task_graph WHERE id = ?").get(taskId);
        if (!task) return res.status(404).json({ error: "Task not found" });
        if (task.status === "completed" || task.status === "failed") {
            return res.status(400).json({ error: `Task already ${task.status}` });
        }

        const failResult = JSON.stringify({ success: false, output: `Admin: ${reason}`, artifacts: [], costCents: 0, duration: 0 });

        db.prepare(`UPDATE task_graph SET status = 'failed', result = ?, assigned_to = NULL WHERE id = ?`)
            .run(failResult, taskId);

        // Block dependents
        db.prepare(`
            UPDATE task_graph SET status = 'blocked', assigned_to = NULL
            WHERE status IN ('pending','assigned','running')
              AND EXISTS (SELECT 1 FROM json_each(COALESCE(NULLIF(task_graph.dependencies,''),'[]')) dep WHERE dep.value = ?)
        `).run(taskId);

        res.json({ success: true, message: "Task marked failed + dependents blocked" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post("/admin/requeue_task", (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ error: "Database not connected" });

    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: "Missing taskId" });

    try {
        const task = db.prepare("SELECT status FROM task_graph WHERE id = ?").get(taskId);
        if (!task) return res.status(404).json({ error: "Task not found" });
        if (task.status !== "assigned" && task.status !== "running") {
            return res.status(400).json({ error: `Task must be assigned/running, got '${task.status}'` });
        }

        db.prepare(`UPDATE task_graph SET status = 'pending', assigned_to = NULL, started_at = NULL WHERE id = ?`).run(taskId);
        res.json({ success: true, message: "Task requeued → pending (ready for re-dispatch)" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
