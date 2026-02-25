const { Router } = require("express");
const memoryRepo = require("../../lib/repositories/memory_repo");
const router = Router();

router.get("/semantic", (req, res) => {
    res.json(memoryRepo.getSemanticMemory(req.query.category));
});

router.get("/episodic", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 1000);
    res.json(memoryRepo.getEpisodicMemory(limit));
});

router.get("/working", (req, res) => {
    res.json(memoryRepo.getWorkingMemory());
});

module.exports = router;
