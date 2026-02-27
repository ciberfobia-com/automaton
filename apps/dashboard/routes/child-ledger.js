/**
 * Child Financial Trace — Phase 4
 *
 * GET /api/children/:id/ledger
 *
 * Best-effort per-child financial trace from parent state.db.
 */

const { Router } = require("express");
const db = require("../lib/db");
const router = Router();

router.get("/children/:id/ledger", (req, res) => {
    const { id } = req.params;

    let child = db.safeGet("SELECT * FROM children WHERE id = ?", [id]);
    if (!child) child = db.safeGet("SELECT * FROM children WHERE sandbox_id = ?", [id]);
    if (!child) child = db.safeGet("SELECT * FROM children WHERE address = ? OR address = ?", [id, `local://${id}`]);
    if (!child) {
        return res.status(404).json({ error: "Child not found", id });
    }

    // ── Funding from children table ────────────────────
    const fundedCents = child.funded_amount_cents || 0;

    // ── Transactions mentioning this child ─────────────
    const txById = db.safeAll(
        "SELECT * FROM transactions WHERE description LIKE ? ORDER BY created_at DESC",
        [`%${id}%`]
    );
    const txByName = child.name
        ? db.safeAll(
            "SELECT * FROM transactions WHERE description LIKE ? ORDER BY created_at DESC",
            [`%${child.name}%`]
        )
        : [];
    // Dedupe
    const txnIds = new Set(txById.map((t) => t.id));
    const allTxns = [...txById];
    for (const t of txByName) {
        if (!txnIds.has(t.id)) allTxns.push(t);
    }

    // Categorize
    const topups = allTxns.filter(
        (t) => t.type === "topup" || t.type === "credit_purchase"
    );
    const transfers = allTxns.filter(
        (t) => t.type === "transfer_out" || t.type === "transfer_in"
    );

    // ── Task costs from task_graph ─────────────────────
    const taskCosts = db.safeAll(
        `SELECT id, title, status, actual_cost_cents, estimated_cost_cents, created_at, completed_at
     FROM task_graph
     WHERE assigned_to = ?
     ORDER BY created_at DESC`,
        [child.address || ""]
    );

    const totalTaskCostCents = taskCosts.reduce(
        (sum, t) => sum + (t.actual_cost_cents || 0),
        0
    );

    // ── Spend tracking (no actor column — annotate) ────
    const spendNote =
        "Per-child inference and spend tracking is not yet supported in the runtime schema. " +
        "Financial data shown here is derived from transaction descriptions and task_graph costs.";

    res.json({
        childId: id,
        childName: child.name,
        childAddress: child.address,

        funding: {
            funded_amount_cents: fundedCents,
            funded_usd: (fundedCents / 100).toFixed(2),
        },

        transactions: allTxns,
        topups,
        transfers,

        taskCosts: {
            tasks: taskCosts,
            total_cost_cents: totalTaskCostCents,
        },

        inference_costs: [],
        credit_spend: [],

        _note: spendNote,
    });
});

module.exports = router;
