const { Router } = require("express");
const config = require("../lib/config");
const router = Router();

// ─── Auth Middleware ────────────────────────────────────────
function requireMutations(req, res, next) {
    if (!config.enableMutations) {
        return res.status(403).json({
            error: "Mutations are disabled",
            hint: "Set DASHBOARD_ENABLE_MUTATIONS=true to enable",
        });
    }

    const token = req.headers["x-owner-token"];
    if (!config.ownerToken || token !== config.ownerToken) {
        return res.status(403).json({ error: "Invalid or missing X-Owner-Token" });
    }

    next();
}

// ─── Mutation Endpoints ─────────────────────────────────────

router.post("/children/spawn", requireMutations, (_req, res) => {
    res.status(501).json({ error: "Not implemented — spawn requires runtime orchestration" });
});

router.post("/children/:id/message", requireMutations, (_req, res) => {
    res.status(501).json({ error: "Not implemented — message requires runtime orchestration" });
});

router.post("/children/:id/start", requireMutations, (_req, res) => {
    res.status(501).json({ error: "Not implemented — start requires runtime orchestration" });
});

router.post("/children/:id/fund", requireMutations, (_req, res) => {
    res.status(501).json({ error: "Not implemented — fund requires runtime orchestration" });
});

router.post("/children/prune-dead", requireMutations, (_req, res) => {
    res.status(501).json({ error: "Not implemented — prune requires runtime orchestration" });
});

module.exports = router;
