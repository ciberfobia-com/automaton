const { Router } = require("express");
const orchestrationRepo = require("../../lib/repositories/orchestration_repo");
const router = Router();

router.get("/goals", (req, res) => {
    res.json(orchestrationRepo.getGoals());
});

router.get("/goals/:id/tasks", (req, res) => {
    res.json(orchestrationRepo.getTasksForGoal(req.params.id));
});

router.get("/timeline", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 1000);
    res.json(orchestrationRepo.getTimeline(limit));
});

module.exports = router;
