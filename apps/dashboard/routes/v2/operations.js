const { Router } = require("express");
const operationsRepo = require("../../lib/repositories/operations_repo");
const router = Router();

router.get("/policy", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 1000);
    res.json(operationsRepo.getPolicyDecisions(req.query.decision, limit));
});

router.get("/turns", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 1000);
    res.json(operationsRepo.getTurns(limit));
});

router.get("/tool_calls", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 1000);
    res.json(operationsRepo.getToolCalls(limit));
});

router.get("/heartbeat", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 1000);
    res.json({
        schedule: operationsRepo.getHeartbeatSchedule(),
        history: operationsRepo.getHeartbeatHistory(limit)
    });
});

module.exports = router;
