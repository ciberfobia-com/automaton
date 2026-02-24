const { Router } = require("express");
const router = Router();

const startTime = Date.now();

router.get("/health", (_req, res) => {
    res.json({
        ok: true,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
    });
});

module.exports = router;
