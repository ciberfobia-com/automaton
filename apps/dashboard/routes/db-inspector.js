/**
 * Database Inspector — generic read-only table browser
 */
const express = require("express");
const router = express.Router();
const { safeAll, safeGet, getDb } = require("../lib/db");

const ALLOWED_TABLES = new Set([
    "goals", "task_graph", "children", "child_lifecycle_events",
    "turns", "tool_calls", "event_stream", "heartbeat_history",
    "inference_costs", "spend_tracking", "onchain_transactions",
    "child_ledger", "policy_decisions", "kv",
]);

router.get("/db/tables", (_req, res) => {
    res.json([...ALLOWED_TABLES]);
});

router.get("/db/:table", (req, res) => {
    const table = req.params.table;
    if (!ALLOWED_TABLES.has(table)) {
        return res.status(403).json({ error: `Table '${table}' not allowed` });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const schema = safeAll(`PRAGMA table_info(${table})`);
    const rows = safeAll(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT ? OFFSET ?`, [limit, offset]);
    const countRow = safeGet(`SELECT COUNT(*) as total FROM ${table}`);

    res.json({
        table,
        schema: schema.map(s => ({ name: s.name, type: s.type })),
        total_rows: countRow?.total || 0,
        limit,
        offset,
        data: rows,
    });
});

module.exports = router;
