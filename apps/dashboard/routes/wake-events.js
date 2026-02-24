const { Router } = require("express");
const db = require("../lib/db");
const router = Router();

router.get("/wake-events", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 500);

    const rows = db.safeAll(
        "SELECT * FROM wake_events ORDER BY created_at DESC LIMIT ?",
        [limit]
    );

    res.json(rows);
});

module.exports = router;
