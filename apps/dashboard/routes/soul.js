const { Router } = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../lib/db");
const config = require("../lib/config");
const router = Router();

router.get("/soul", (_req, res) => {
    // Try reading SOUL.md from disk first
    const soulPaths = [
        path.join(config.automatonDir, "SOUL.md"),
        path.join(process.cwd(), "SOUL.md"),
    ];

    let soulContent = null;
    let soulSource = null;

    for (const p of soulPaths) {
        if (fs.existsSync(p)) {
            try {
                soulContent = fs.readFileSync(p, "utf-8");
                soulSource = p;
                break;
            } catch { /* ignore */ }
        }
    }

    // Fallback: latest soul_history entry
    if (!soulContent) {
        const latest = db.safeGet("SELECT * FROM soul_history ORDER BY version DESC LIMIT 1");
        if (latest) {
            soulContent = latest.content;
            soulSource = "soul_history (database)";
        }
    }

    res.json({
        content: soulContent,
        source: soulSource,
        currentVersion: (() => {
            const row = db.safeGet("SELECT MAX(version) as v FROM soul_history");
            return row ? row.v : null;
        })(),
    });
});

router.get("/soul/history", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);

    const rows = db.safeAll(
        "SELECT * FROM soul_history ORDER BY version DESC LIMIT ?",
        [limit]
    );

    res.json(rows);
});

module.exports = router;
