const { Router } = require("express");
const db = require("../lib/db");
const router = Router();

router.get("/children", (_req, res) => {
    const rows = db.safeAll("SELECT * FROM children ORDER BY created_at DESC");
    res.json(rows);
});

router.get("/children/:id", (req, res) => {
    let child = db.safeGet("SELECT * FROM children WHERE id = ?", [req.params.id]);
    if (!child) child = db.safeGet("SELECT * FROM children WHERE sandbox_id = ?", [req.params.id]);
    if (!child) child = db.safeGet("SELECT * FROM children WHERE address = ? OR address = ?", [req.params.id, `local://${req.params.id}`]);
    if (!child) {
        return res.status(404).json({ error: "Child not found" });
    }

    // Try to get lifecycle events if table exists
    const lifecycle = db.tableExists("child_lifecycle_events")
        ? db.safeAll(
            "SELECT * FROM child_lifecycle_events WHERE child_id = ? ORDER BY created_at DESC LIMIT 50",
            [req.params.id]
        )
        : [];

    // Try to get recent messages
    const messages = db.tableExists("inbox_messages")
        ? db.safeAll(
            "SELECT id, from_address, content, received_at, status FROM inbox_messages WHERE from_address = ? ORDER BY received_at DESC LIMIT 10",
            [child.address || ""]
        )
        : [];

    res.json({ ...child, lifecycle, messages });
});

module.exports = router;
