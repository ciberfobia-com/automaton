const { Router } = require("express");
const db = require("../lib/db");
const router = Router();

router.get("/turns", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 500);

    const turns = db.safeAll(
        "SELECT * FROM turns ORDER BY timestamp DESC LIMIT ?",
        [limit]
    );

    // Enrich with tool calls if available
    const enriched = turns.map((turn) => {
        const toolCalls = db.safeAll(
            "SELECT * FROM tool_calls WHERE turn_id = ?",
            [turn.id]
        );
        return { ...turn, tool_calls_detail: toolCalls };
    });

    res.json(enriched);
});

module.exports = router;
