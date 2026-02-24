const { Router } = require("express");
const db = require("../lib/db");
const router = Router();

const startTime = Date.now();

router.get("/status", (_req, res) => {
    const kv = (key) => {
        const row = db.safeGet("SELECT value FROM kv WHERE key = ?", [key]);
        return row ? row.value : null;
    };

    const lastTurn = db.safeGet("SELECT timestamp FROM turns ORDER BY timestamp DESC LIMIT 1");
    const turnCount = db.safeGet("SELECT COUNT(*) as count FROM turns");

    res.json({
        agentState: kv("agent_state") || "unknown",
        creditsBalance: kv("credits_balance"),
        usdcBalance: kv("usdc_balance"),
        survivalTier: kv("survival_tier"),
        currentModel: kv("current_model") || kv("inference_model"),
        lastTurnTimestamp: lastTurn ? lastTurn.timestamp : null,
        turnCount: turnCount ? turnCount.count : 0,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        dbConnected: db.isConnected(),
    });
});

module.exports = router;
