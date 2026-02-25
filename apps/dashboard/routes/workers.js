/**
 * Workers API — unified children + derived health
 */
const express = require("express");
const router = express.Router();
const { safeAll, safeGet } = require("../lib/db");

const STALE_MS = 5 * 60 * 1000;
const ZOMBIE_MS = 10 * 60 * 1000;

router.get("/workers", (_req, res) => {
    const now = Date.now();

    const children = safeAll(`
        SELECT id, sandbox_id, address, name, status, created_at, last_checked
        FROM children
        ORDER BY created_at DESC
    `);

    const workers = children.map(c => {
        // Assigned tasks
        const tasks = safeAll(`
            SELECT id, title, status, started_at, created_at, timeout_ms
            FROM task_graph
            WHERE assigned_to = ? OR assigned_to = ?
        `, [c.address || "", `local://${c.sandbox_id || ""}`]);

        // Last activity from child_ledger or tool_calls
        const lastLedger = safeGet(`
            SELECT MAX(created_at) as t FROM child_ledger WHERE address = ?
        `, [c.address || ""]);

        const lastCheckedMs = c.last_checked ? new Date(c.last_checked).getTime() : 0;
        const lastLedgerMs = lastLedger?.t ? new Date(lastLedger.t).getTime() : 0;
        const lastSignal = Math.max(lastCheckedMs, lastLedgerMs);
        const silenceMs = lastSignal > 0 ? now - lastSignal : -1;

        // Spend
        const spend = safeGet(`
            SELECT SUM(amount_cents) as total FROM child_ledger WHERE address = ?
        `, [c.address || ""]);

        let derived = "healthy";
        if (c.status === "failed" || c.status === "dead") derived = "dead";
        else if (silenceMs > ZOMBIE_MS && tasks.some(t => t.status === "running" || t.status === "assigned")) derived = "zombie";
        else if (silenceMs > STALE_MS && tasks.length > 0) derived = "stale";
        else if (tasks.length === 0 && silenceMs > ZOMBIE_MS) derived = "idle";

        return {
            id: c.id,
            sandbox_id: c.sandbox_id,
            address: c.address,
            name: c.name,
            db_status: c.status,
            derived_status: derived,
            runtime: c.address?.startsWith("local://") ? "local" : "cloud",
            silence_ms: silenceMs,
            last_checked: c.last_checked,
            total_spent_cents: spend?.total || 0,
            tasks: tasks.map(t => ({
                id: t.id,
                title: t.title,
                status: t.status,
                age_ms: t.started_at ? now - new Date(t.started_at).getTime()
                    : t.created_at ? now - new Date(t.created_at).getTime() : 0,
            })),
            created_at: c.created_at,
        };
    });

    res.json(workers);
});

module.exports = router;
