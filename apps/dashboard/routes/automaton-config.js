/**
 * Automaton Config Route
 *
 * Reads ~/.automaton/automaton.json and config.json to expose
 * safe configuration data in the dashboard.
 * Private keys and full API keys are ALWAYS redacted.
 */

const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const config = require("../lib/config");

function redactKey(key) {
    if (!key || typeof key !== "string") return "—";
    if (key.length <= 12) return key.slice(0, 4) + "***";
    return key.slice(0, 8) + "***" + key.slice(-4);
}

function readJsonSafe(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return null;
    }
}

// ── Full safe config ──
router.get("/automaton/config", (req, res) => {
    const automatonPath = path.join(config.automatonDir, "automaton.json");
    const conwayConfigPath = path.join(config.automatonDir, "config.json");

    const automaton = readJsonSafe(automatonPath);
    const conwayConfig = readJsonSafe(conwayConfigPath);

    if (!automaton && !conwayConfig) {
        return res.json({
            error: "No config files found",
            searchedPaths: [automatonPath, conwayConfigPath],
        });
    }

    const safe = {};

    if (automaton) {
        safe.identity = {
            name: automaton.name || "—",
            walletAddress: automaton.walletAddress || "—",
            creatorAddress: automaton.creatorAddress || "—",
            registeredWithConway: automaton.registeredWithConway || false,
            version: automaton.version || "—",
            sandboxId: automaton.sandboxId || "(none — local mode)",
            conwayApiUrl: automaton.conwayApiUrl || "—",
            conwayApiKey: redactKey(automaton.conwayApiKey),
            socialRelayUrl: automaton.socialRelayUrl || "—",
        };

        safe.modelStrategy = automaton.modelStrategy || {
            inferenceModel: automaton.inferenceModel || "—",
            maxTokensPerTurn: automaton.maxTokensPerTurn || 4096,
        };

        safe.treasuryPolicy = automaton.treasuryPolicy || null;

        safe.soulConfig = automaton.soulConfig || null;

        safe.operational = {
            maxChildren: automaton.maxChildren || 3,
            childSandboxMemoryMb: automaton.childSandboxMemoryMb || 1024,
            logLevel: automaton.logLevel || "info",
            dbPath: automaton.dbPath || "—",
            heartbeatConfigPath: automaton.heartbeatConfigPath || "—",
            skillsDir: automaton.skillsDir || "—",
        };

        // Genesis prompt — public mission statement, not secret
        safe.genesisPrompt = automaton.genesisPrompt || null;
    }

    if (conwayConfig) {
        safe.conwayProvision = {
            apiKey: redactKey(conwayConfig.apiKey),
            walletAddress: conwayConfig.walletAddress || "—",
            provisionedAt: conwayConfig.provisionedAt || "—",
        };
    }

    // Check wallet.json exists (never read contents)
    const walletPath = path.join(config.automatonDir, "wallet.json");
    safe.walletFileExists = fs.existsSync(walletPath);

    res.json(safe);
});

module.exports = router;
