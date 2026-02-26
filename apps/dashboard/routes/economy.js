/**
 * Economy API — burn rate, time-to-zero, per-model costs, topups
 */
const express = require("express");
const router = express.Router();
const { safeAll, safeGet } = require("../lib/db");

router.get("/economy/overview", (_req, res) => {
    // Current credits from KV
    const creditsRow = safeGet(`SELECT value FROM kv WHERE key = 'last_known_balance'`);
    let creditsCents = 0;
    if (creditsRow?.value) {
        try { creditsCents = JSON.parse(creditsRow.value).creditsCents || 0; } catch { }
    }

    // Burn rate: last 10 min, last hour, last 24h
    const burn10m = safeGet(`
        SELECT SUM(total_cost_cents) as cost, COUNT(*) as calls
        FROM inference_costs WHERE created_at > datetime('now', '-10 minutes')
    `);
    const burn1h = safeGet(`
        SELECT SUM(total_cost_cents) as cost, COUNT(*) as calls
        FROM inference_costs WHERE created_at > datetime('now', '-1 hour')
    `);
    const burn24h = safeGet(`
        SELECT SUM(total_cost_cents) as cost, COUNT(*) as calls
        FROM inference_costs WHERE created_at > datetime('now', '-24 hours')
    `);

    const burnPerMin = (burn10m?.cost || 0) / 10;
    const timeToZero = burnPerMin > 0 ? Math.floor(creditsCents / burnPerMin) : -1;

    // Per-model breakdown (last 24h)
    const byModel = safeAll(`
        SELECT model, provider, SUM(total_cost_cents) as cost,
               SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
               COUNT(*) as calls
        FROM inference_costs
        WHERE created_at > datetime('now', '-24 hours')
        GROUP BY model ORDER BY cost DESC
    `);

    // On-chain transactions / topups
    const topups = safeAll(`
        SELECT * FROM onchain_transactions ORDER BY created_at DESC LIMIT 20
    `);

    // Spend tracking (if table exists)
    const spendTracking = safeAll(`
        SELECT tool_name, SUM(amount_cents) as total, COUNT(*) as count
        FROM spend_tracking
        GROUP BY tool_name ORDER BY total DESC LIMIT 20
    `);

    res.json({
        credits_cents: creditsCents,
        burn_rate: {
            per_minute_cents: burnPerMin,
            last_10m_cents: burn10m?.cost || 0,
            last_1h_cents: burn1h?.cost || 0,
            last_24h_cents: burn24h?.cost || 0,
            calls_last_10m: burn10m?.calls || 0,
            time_to_zero_minutes: timeToZero,
        },
        by_model: byModel,
        topups,
        spend_by_tool: spendTracking,
    });
});

module.exports = router;
