const { Router } = require("express");
const db = require("../lib/db");
const router = Router();

router.get("/heartbeat", (_req, res) => {
    // Legacy heartbeat_entries
    const entries = db.safeAll("SELECT * FROM heartbeat_entries");

    // Phase 1.1 heartbeat_schedule (richer data)
    const schedule = db.safeAll("SELECT * FROM heartbeat_schedule ORDER BY priority ASC");

    // Recent heartbeat history
    const history = db.safeAll(
        "SELECT * FROM heartbeat_history ORDER BY started_at DESC LIMIT 50"
    );

    res.json({ entries, schedule, history });
});

module.exports = router;
