const db = require('../db');

function getOverview() {
    return {
        credits: db.safeGet("SELECT value, updated_at FROM kv WHERE key = 'credits_balance'"),
        usdc: db.safeGet("SELECT value, updated_at FROM kv WHERE key = 'usdc_balance'"),
        lifetimeSpend: db.safeGet("SELECT SUM(amount_cents) as total FROM spend_tracking")?.total || 0,
        lifetimeRevenue: db.safeGet("SELECT SUM(amount_cents) as total FROM transactions WHERE type IN ('topup', 'transfer_in')")?.total || 0,
    };
}

function getTransactions(type, limit = 100) {
    if (type) {
        return db.safeAll("SELECT * FROM transactions WHERE type = ? ORDER BY created_at DESC LIMIT ?", [type, limit]);
    }
    return db.safeAll("SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?", [limit]);
}

function getOnchainTransactions(limit = 100) {
    return db.safeAll("SELECT * FROM onchain_transactions ORDER BY created_at DESC LIMIT ?", [limit]);
}

function getModelUsage() {
    return db.safeAll(`
        SELECT model, provider, tier,
               SUM(input_tokens) as total_input,
               SUM(output_tokens) as total_output,
               SUM(cost_cents) as total_cost,
               COUNT(*) as call_count
        FROM inference_costs
        GROUP BY model, provider, tier
        ORDER BY total_cost DESC
    `);
}

function getSpendBreakdown(limit = 100) {
    return db.safeAll("SELECT * FROM spend_tracking ORDER BY created_at DESC LIMIT ?", [limit]);
}

module.exports = {
    getOverview,
    getTransactions,
    getOnchainTransactions,
    getModelUsage,
    getSpendBreakdown
};
