const express = require("express");
const router = express.Router();
const { db } = require("../../lib/db");
const { WorkerRepo } = require("../../lib/repositories/worker_repo");
const { LoopRepo } = require("../../lib/repositories/loop_repo");
const { DiagnosticRepo } = require("../../lib/repositories/diagnostic_repo");

// 1. Worker Deep Telemetry
router.get("/workers", (req, res) => {
    try {
        const data = WorkerRepo.getWorkerTelemetry();
        res.json(data);
    } catch (err) {
        console.error("Worker telemetry error", err);
        res.status(500).json({ error: err.message });
    }
});

// 2. Real-Time Loop Inspector
router.get("/loop", (req, res) => {
    try {
        const data = LoopRepo.getRealtimeLoop();
        res.json(data);
    } catch (err) {
        console.error("Loop telemetry error", err);
        res.status(500).json({ error: err.message });
    }
});

// 3. Diagnostics & Zombie Detection
router.get("/diagnostics", (req, res) => {
    try {
        const data = DiagnosticRepo.getSystemDiagnostics();
        res.json(data);
    } catch (err) {
        console.error("Diagnostic error", err);
        res.status(500).json({ error: err.message });
    }
});

// 4. Goal Execution Trace
router.get("/goals/:id/trace", (req, res) => {
    try {
        const goalId = req.params.id;

        // Fetch tasks
        const tasks = db.prepare(`
            SELECT id, title, agent_role, status, assigned_to, estimated_cost_cents, actual_cost_cents, started_at, completed_at
            FROM task_graph
            WHERE goal_id = ?
            ORDER BY created_at ASC
        `).all(goalId);

        // Fetch events
        const events = db.prepare(`
            SELECT type, content, token_count, created_at
            FROM event_stream
            WHERE goal_id = ?
            ORDER BY created_at ASC
        `).all(goalId);

        // Calculate Goal Cost Details
        let totalCost = 0;
        let workerCostMap = {};
        for (const t of tasks) {
            totalCost += (t.actual_cost_cents || 0);
            if (t.assigned_to) {
                workerCostMap[t.assigned_to] = (workerCostMap[t.assigned_to] || 0) + (t.actual_cost_cents || 0);
            }
        }

        res.json({
            goal_id: goalId,
            financials: {
                total_cost_cents: totalCost,
                worker_breakdown: workerCostMap
            },
            timeline: {
                tasks: tasks,
                events: events
            }
        });
    } catch (err) {
        console.error("Goal trace error", err);
        res.status(500).json({ error: err.message });
    }
});

// 5. Database Inspector (Read-Only)
router.get("/db/:table", (req, res) => {
    try {
        const table = req.params.table;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        // Hardcode allowed tables to prevent SQL injection or reading sensitive internal sqlite stats
        const allowedTables = new Set([
            'goals', 'task_graph', 'children', 'spend_tracking',
            'inference_costs', 'tool_calls', 'event_stream',
            'heartbeat_history', 'turns', 'child_ledger'
        ]);

        if (!allowedTables.has(table)) {
            return res.status(403).json({ error: "Access denied to table or table does not exist." });
        }

        // Schema Info
        const schema = db.prepare(`PRAGMA table_info(${table})`).all();

        // Data
        const rows = db.prepare(`SELECT * FROM ${table} LIMIT ? OFFSET ?`).all(limit, offset);

        // Total Count
        const countRow = db.prepare(`SELECT COUNT(*) as total FROM ${table}`).get();

        res.json({
            table: table,
            schema: schema.map(s => ({ name: s.name, type: s.type })),
            total_rows: countRow.total,
            limit,
            offset,
            data: rows
        });
    } catch (err) {
        console.error("DB Inspector error", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
