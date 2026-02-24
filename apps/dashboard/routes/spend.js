/**
 * Ledger & Spend Routes
 *
 * Merges all financial data sources:
 *   1. kv store — current balances (credits, USDC, survival tier)
 *   2. transactions — topups, transfers, purchases, payments
 *   3. spend_tracking — per-tool spend with daily/hourly windows
 *   4. inference_costs — per-call model costs
 *   5. onchain_transactions — blockchain ops
 *   6. PM2 logs — fallback for topup events not persisted to DB
 */

const { Router } = require("express");
const db = require("../lib/db");
const logParser = require("../lib/log-parser");
const router = Router();

router.get("/spend", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 1000);

    // ── 1. Current Balances (from KV store) ────────────────
    const kvGet = (key) => {
        const row = db.safeGet("SELECT value, updated_at FROM kv WHERE key = ?", [key]);
        return row ? { value: row.value, updatedAt: row.updated_at } : null;
    };

    const balances = {
        credits: kvGet("credits_balance"),
        usdc: kvGet("usdc_balance"),
        survivalTier: kvGet("survival_tier"),
        lastTopupAttempt: kvGet("last_auto_topup_attempt"),
        lastInlineTopup: kvGet("last_inline_topup_attempt"),
    };

    // ── 2. Transactions (topups, transfers, purchases) ─────
    const transactions = db.safeAll(
        "SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?",
        [limit]
    );

    // Break down by type for frontend tabs
    const topups = transactions.filter(
        (t) => t.type === "topup" || t.type === "credit_purchase"
    );
    const transfers = transactions.filter(
        (t) => t.type === "transfer_in" || t.type === "transfer_out"
    );
    const payments = transactions.filter(
        (t) => t.type === "x402_payment" || t.type === "inference"
    );

    // ── 3. Spend Tracking (per-tool spend) ─────────────────
    const spendRecords = db.safeAll(
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

    // ── 4. Inference Costs (per-call model costs) ──────────
    const inferenceCosts = db.safeAll(
        "SELECT * FROM inference_costs ORDER BY created_at DESC LIMIT ?",
        [Math.min(limit, 100)]
    );

    // Inference daily summary
    const inferenceDailySummary = db.safeAll(
        `SELECT date(created_at) as day,
            SUM(cost_cents) as total_cents,
            SUM(input_tokens) as total_input_tokens,
            SUM(output_tokens) as total_output_tokens,
            COUNT(*) as call_count
     FROM inference_costs
     GROUP BY date(created_at)
     ORDER BY day DESC
     LIMIT 30`
    );

    // Model breakdown
    const modelBreakdown = db.safeAll(
        `SELECT model, provider,
            SUM(cost_cents) as total_cents,
            SUM(input_tokens) as total_input_tokens,
            SUM(output_tokens) as total_output_tokens,
            COUNT(*) as call_count
     FROM inference_costs
     GROUP BY model, provider
     ORDER BY total_cents DESC
     LIMIT 20`
    );

    // ── 5. On-chain Transactions ───────────────────────────
    const onchainTxs = db.safeAll(
        "SELECT * FROM onchain_transactions ORDER BY created_at DESC LIMIT ?",
        [Math.min(limit, 50)]
    );

    // ── 6. Children funding summary ────────────────────────
    const childrenFunding = db.safeAll(
        "SELECT id, name, status, funded_amount_cents, created_at FROM children ORDER BY created_at DESC"
    );

    // ── 7. PM2 Log-derived events (fallback) ───────────────
    const logEvents = logParser.getTopupEvents();

    res.json({
        balances,
        transactions: { all: transactions, topups, transfers, payments },
        spendTracking: { records: spendRecords, dailyTotals },
        inference: { costs: inferenceCosts, dailySummary: inferenceDailySummary, modelBreakdown },
        onchain: onchainTxs,
        childrenFunding,
        logDerived: logEvents,
    });
});

module.exports = router;
