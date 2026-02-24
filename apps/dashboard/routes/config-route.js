const { Router } = require("express");
const fs = require("fs");
const path = require("path");
const config = require("../lib/config");
const router = Router();

// Fields that must never be exposed
const SENSITIVE_PATTERNS = [
    "key", "secret", "private", "password", "token", "mnemonic", "seed",
];

function isSensitive(fieldName) {
    const lower = fieldName.toLowerCase();
    return SENSITIVE_PATTERNS.some((p) => lower.includes(p));
}

function sanitizeConfig(obj) {
    if (!obj || typeof obj !== "object") return obj;
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        if (isSensitive(key)) {
            sanitized[key] = "[REDACTED]";
        } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            sanitized[key] = sanitizeConfig(value);
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

router.get("/config", (_req, res) => {
    const configPath = path.join(config.automatonDir, "automaton.json");

    if (!fs.existsSync(configPath)) {
        return res.json({ error: "Config file not found", path: configPath });
    }

    try {
        const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        res.json(sanitizeConfig(raw));
    } catch (err) {
        res.status(500).json({ error: "Failed to read config", message: err.message });
    }
});

module.exports = router;
