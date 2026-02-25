const { Router } = require("express");
const economyRepo = require("../../lib/repositories/economy_repo");
const router = Router();

router.get("/overview", (req, res) => {
    res.json(economyRepo.getOverview());
});

router.get("/transactions", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 1000);
    const type = req.query.type;
    res.json(economyRepo.getTransactions(type, limit));
});

router.get("/onchain", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 1000);
    res.json(economyRepo.getOnchainTransactions(limit));
});

router.get("/inference/models", (req, res) => {
    res.json(economyRepo.getModelUsage());
});

router.get("/spend", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 1000);
    res.json(economyRepo.getSpendBreakdown(limit));
});

module.exports = router;
