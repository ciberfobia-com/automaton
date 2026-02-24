const { Router } = require("express");
const db = require("../lib/db");
const router = Router();

router.get("/spend", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 1000);

    // Recent spend records
    const records = db.safeAll(
        "SELECT * FROM spend_tracking ORDER BY created_at DESC LIMIT ?",
        [limit]
    );

    // Daily totals
    const dailyTotals = db.safeAll(
        `SELECT window_day, SUM(amount_cents) as total_cents, COUNT(*) as count
     FROM spend_tracking
     GROUP BY window_day
     ORDER BY window_day DESC
     LIMIT 30`
    );

    // Also include recent transactions (ledger transfers)
    const transfers = db.safeAll(
        "SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?",
        [Math.min(limit, 100)]
    );

    res.json({ records, dailyTotals, transfers });
});

module.exports = router;
