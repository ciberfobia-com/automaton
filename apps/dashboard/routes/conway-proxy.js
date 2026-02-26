/**
 * Conway Cloud API Proxy
 *
 * Proxies read-only GET requests to Conway Cloud API for dashboard visibility.
 * Uses CONWAY_API_KEY from environment (same key padre uses).
 * Only GET endpoints — no mutations, no credit cost.
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const dashConfig = require("../lib/config");

const router = express.Router();
const CONWAY_API_URL = process.env.CONWAY_API_URL || "https://api.conway.tech/v1";

let _cachedApiKey = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000; // Re-read files every 60s

function getApiKey() {
    // Cache to avoid reading files on every request
    if (_cachedApiKey && (Date.now() - _cacheTime) < CACHE_TTL) return _cachedApiKey;

    // 1. Environment variable
    if (process.env.CONWAY_API_KEY) {
        _cachedApiKey = process.env.CONWAY_API_KEY;
        _cacheTime = Date.now();
        return _cachedApiKey;
    }

    // 2. ~/.automaton/automaton.json → conwayApiKey
    try {
        const automatonPath = path.join(dashConfig.automatonDir, "automaton.json");
        if (fs.existsSync(automatonPath)) {
            const data = JSON.parse(fs.readFileSync(automatonPath, "utf-8"));
            if (data.conwayApiKey) {
                _cachedApiKey = data.conwayApiKey;
                _cacheTime = Date.now();
                return _cachedApiKey;
            }
        }
    } catch { }

    // 3. ~/.automaton/config.json → apiKey (Conway provisioned key)
    try {
        const configPath = path.join(dashConfig.automatonDir, "config.json");
        if (fs.existsSync(configPath)) {
            const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            if (data.apiKey) {
                _cachedApiKey = data.apiKey;
                _cacheTime = Date.now();
                return _cachedApiKey;
            }
        }
    } catch { }

    // 4. KV table fallback
    try {
        const db = require("../lib/db").get();
        const row = db.prepare("SELECT value FROM kv WHERE key = 'conway_api_key'").get();
        if (row?.value) {
            _cachedApiKey = row.value;
            _cacheTime = Date.now();
            return _cachedApiKey;
        }
    } catch { }

    return null;
}

async function conwayGet(apiPath) {
    const apiKey = getApiKey();
    if (!apiKey) return { error: "No CONWAY_API_KEY configured", status: 401 };

    try {
        const url = `${CONWAY_API_URL}${apiPath}`;
        const resp = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            return { error: `Conway API ${resp.status}: ${text.slice(0, 200)}`, status: resp.status };
        }

        return await resp.json();
    } catch (err) {
        return { error: `Conway API unreachable: ${err.message}`, status: 503 };
    }
}

// ── List all sandboxes (VMs padre has created) ──
router.get("/conway/sandboxes", async (req, res) => {
    const result = await conwayGet("/sandboxes");
    if (result.error) return res.status(result.status || 500).json(result);
    res.json(result);
});

// ── Get specific sandbox details ──
router.get("/conway/sandboxes/:id", async (req, res) => {
    const result = await conwayGet(`/sandboxes/${req.params.id}`);
    if (result.error) return res.status(result.status || 500).json(result);
    res.json(result);
});

// ── Live credits balance from Conway ──
router.get("/conway/credits/balance", async (req, res) => {
    const result = await conwayGet("/credits/balance");
    if (result.error) return res.status(result.status || 500).json(result);
    res.json(result);
});

// ── Credits transaction history ──
router.get("/conway/credits/history", async (req, res) => {
    const limit = req.query.limit || 50;
    const offset = req.query.offset || 0;
    const result = await conwayGet(`/credits/history?limit=${limit}&offset=${offset}`);
    if (result.error) return res.status(result.status || 500).json(result);
    res.json(result);
});

// ── Credits pricing tiers ──
router.get("/conway/credits/pricing", async (req, res) => {
    const result = await conwayGet("/credits/pricing");
    if (result.error) return res.status(result.status || 500).json(result);
    res.json(result);
});

// ── Health check: is Conway API reachable + do we have an API key? ──
router.get("/conway/status", async (req, res) => {
    const apiKey = getApiKey();
    if (!apiKey) {
        return res.json({
            connected: false,
            reason: "No CONWAY_API_KEY found in env or KV",
            api_url: CONWAY_API_URL,
        });
    }

    const balance = await conwayGet("/credits/balance");
    if (balance.error) {
        return res.json({
            connected: false,
            reason: balance.error,
            api_url: CONWAY_API_URL,
        });
    }

    res.json({
        connected: true,
        api_url: CONWAY_API_URL,
        credits: balance,
    });
});

module.exports = router;
