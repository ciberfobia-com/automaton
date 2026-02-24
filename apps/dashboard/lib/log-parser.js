/**
 * PM2 Log Parser
 *
 * Parses automaton PM2 logs for financial events (topups, transfers)
 * that may not be persisted to the database.
 *
 * Returns log-derived events marked with source="logs".
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// Common PM2 log locations
const LOG_PATHS = [
    "/root/.pm2/logs/automaton-out.log",
    path.join(os.homedir(), ".pm2", "logs", "automaton-out.log"),
];

// Patterns to extract financial events from logs
const PATTERNS = [
    {
        // "Bootstrap topup: +$5 credits from USDC" or "Bootstrap topup: credits=$0.00, USDC=$6.00, buying $5"
        regex: /\[([^\]]+)\]\s*(?:Bootstrap topup[:\s]+(.+))/i,
        type: "topup",
        subtype: "bootstrap",
    },
    {
        // "Credit topup successful: $5 USD → 500 credits cents"
        regex: /\[([^\]]+)\]\s*(?:Credit topup successful[:\s]+(.+))/i,
        type: "topup",
        subtype: "credit_purchase",
    },
    {
        // "Auto-topup successful: $5 USD → 500 credit cents"
        regex: /\[([^\]]+)\]\s*(?:Auto-topup successful[:\s]+(.+))/i,
        type: "topup",
        subtype: "auto_topup",
    },
    {
        // "[AUTO-TOPUP] Bought $5 credits from USDC mid-loop"
        regex: /\[([^\]]+)\]\s*\[AUTO-TOPUP\]\s*(.+)/i,
        type: "topup",
        subtype: "inline_topup",
    },
    {
        // "topup_credits" tool result lines
        regex: /\[([^\]]+)\]\s*(?:topup_credits[:\s]+(.+))/i,
        type: "topup",
        subtype: "tool_topup",
    },
];

// Extract dollar amounts from text
function extractAmounts(text) {
    const amounts = {};
    const usdMatch = text.match(/\$([0-9]+(?:\.[0-9]+)?)\s*(?:USD)?/i);
    if (usdMatch) amounts.amountUsd = parseFloat(usdMatch[1]);

    const centsMatch = text.match(/([0-9]+)\s*(?:credits?\s*cents|credit\s*cents)/i);
    if (centsMatch) amounts.creditsCents = parseInt(centsMatch[1], 10);

    const creditsMatch = text.match(/([0-9]+)\s*credits(?!\s*cent)/i);
    if (creditsMatch) amounts.credits = parseInt(creditsMatch[1], 10);

    return amounts;
}

/**
 * Parse PM2 logs and extract topup/financial events.
 * Returns at most 100 most recent events.
 */
function getTopupEvents() {
    let logPath = null;
    for (const p of LOG_PATHS) {
        if (fs.existsSync(p)) {
            logPath = p;
            break;
        }
    }

    if (!logPath) {
        return { available: false, path: null, events: [], message: "PM2 log file not found" };
    }

    try {
        const stat = fs.statSync(logPath);
        // Only read last 500KB to avoid memory issues on large logs
        const readSize = Math.min(stat.size, 500 * 1024);
        const fd = fs.openSync(logPath, "r");
        const buffer = Buffer.alloc(readSize);
        fs.readSync(fd, buffer, 0, readSize, Math.max(0, stat.size - readSize));
        fs.closeSync(fd);

        const lines = buffer.toString("utf-8").split("\n");
        const events = [];

        for (const line of lines) {
            for (const pattern of PATTERNS) {
                const match = line.match(pattern.regex);
                if (match) {
                    const timestamp = match[1] || null;
                    const detail = match[2] || line;
                    const amounts = extractAmounts(detail);
                    events.push({
                        source: "logs",
                        type: pattern.type,
                        subtype: pattern.subtype,
                        timestamp,
                        detail: detail.trim(),
                        ...amounts,
                        rawLine: line.trim().slice(0, 300),
                    });
                    break; // Only match first pattern per line
                }
            }
        }

        // Return latest 100
        return {
            available: true,
            path: logPath,
            events: events.slice(-100),
            totalMatches: events.length,
        };
    } catch (err) {
        return {
            available: false,
            path: logPath,
            events: [],
            message: `Failed to parse logs: ${err.message}`,
        };
    }
}

module.exports = { getTopupEvents };
