const express = require("express");
const router = express.Router();

const { db } = require("../../lib/db");

// ── Helper to propagate failure blockages safely using sqlite ──
// We don't import the TypeScript core. We replicate the transaction logic natively.
function failTaskLocally(taskId, reason) {
    db.transaction(() => {
        // Mark failed
        const failureResult = {
            success: false,
            output: reason,
            artifacts: [],
            costCents: 0,
            duration: 0
        };

        db.prepare(`
            UPDATE task_graph 
            SET status = 'failed', result = ?, assigned_to = NULL 
            WHERE id = ?
        `).run(JSON.stringify(failureResult), taskId);

        // Block dependents (mimicking task-graph.ts blockDependentsForFailedTask)
        db.prepare(`
            UPDATE task_graph
            SET status = 'blocked', assigned_to = NULL
            WHERE status IN ('pending', 'assigned', 'running')
              AND EXISTS (
                  SELECT 1
                  FROM json_each(COALESCE(NULLIF(task_graph.dependencies, ''), '[]')) dep
                  WHERE dep.value = ?
              )
        `).run(taskId);
    })();
}

/**
 * Mark Task Failed
 * Safely marks failing and blocks downstream tasks.
 */
router.post("/mark_task_failed", async (req, res) => {
    try {
        const { taskId, reason } = req.body;

        if (!taskId || !reason) {
            return res.status(400).json({ error: "Missing taskId or reason" });
        }

        const task = db.prepare("SELECT status FROM task_graph WHERE id = ?").get(taskId);
        if (!task) return res.status(404).json({ error: "Task not found" });

        if (task.status === "completed" || task.status === "failed") {
            return res.status(400).json({ error: `Task is already ${task.status}` });
        }

        failTaskLocally(taskId, `Admin override: ${reason}`);

        res.json({ success: true, message: "Task marked failed successfully." });
    } catch (err) {
        console.error("Admin action error", err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Unassign Task
 * Safely removes the assigned worker, putting the task back in the queue
 */
router.post("/unassign_task", async (req, res) => {
    try {
        const { taskId } = req.body;

        if (!taskId) return res.status(400).json({ error: "Missing taskId" });

        const task = db.prepare("SELECT status FROM task_graph WHERE id = ?").get(taskId);
        if (!task) return res.status(404).json({ error: "Task not found" });

        if (task.status !== "running" && task.status !== "assigned") {
            return res.status(400).json({ error: "Task must be assigned or running to unassign." });
        }

        db.prepare(`
            UPDATE task_graph
            SET status = 'pending', assigned_to = NULL
            WHERE id = ?
        `).run(taskId);

        res.json({ success: true, message: "Task unassigned. Orchestrator will pick it up." });
    } catch (err) {
        console.error("Admin action error", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
