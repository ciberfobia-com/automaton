const { Router } = require("express");
const lifecycleRepo = require("../../lib/repositories/lifecycle_repo");
const router = Router();

router.get("/children", (req, res) => {
    res.json(lifecycleRepo.getChildren());
});

router.get("/children/:id/lifecycle", (req, res) => {
    res.json(lifecycleRepo.getChildLifecycleEvents(req.params.id));
});

router.get("/reputation", (req, res) => {
    res.json(lifecycleRepo.getReputation());
});

router.get("/registry", (req, res) => {
    res.json(lifecycleRepo.getRegistry());
});

module.exports = router;
