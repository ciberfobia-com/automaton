/**
 * Runtime Log Parser
 *
 * Parses automaton runtime logs for financial events (topups, transfers)
 * that may not be persisted to the database.
 *
 * Reads from journalctl (systemd) first, falls back to log files on disk.
 * Returns log-derived events marked with source="logs".
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Fallback log file locations (legacy PM2 or manual log files)
const FALLBACK_LOG_PATHS = [
    "/var/log/ciberpadre.log",
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
 * Read log lines from journalctl (systemd).
 * Returns null if unavailable.
 */
function readJournalctlLines() {
    try {
        const raw = execSync(
            `journalctl -u ciberpadre --no-pager -n 2000 --output=short-iso 2>/dev/null`,
            { encoding: "utf-8", timeout: 5000 }
        );
        return raw.split("\n");
    } catch {
        return null;
    }
}

/**
 * Read log lines from a log file on disk.
 * Returns null if no file is found.
 */
function readLogFileLines() {
    let logPath = null;
    for (const p of FALLBACK_LOG_PATHS) {
        if (fs.existsSync(p)) {
            logPath = p;
            break;
        }
    }
    if (!logPath) return null;

    try {
        const stat = fs.statSync(logPath);
        const readSize = Math.min(stat.size, 500 * 1024);
        const fd = fs.openSync(logPath, "r");
        const buffer = Buffer.alloc(readSize);
        fs.readSync(fd, buffer, 0, readSize, Math.max(0, stat.size - readSize));
        fs.closeSync(fd);
        return { lines: buffer.toString("utf-8").split("\n"), path: logPath };
    } catch {
        return null;
    }
}

/**
 * Parse runtime logs and extract topup/financial events.
 * Tries journalctl first, falls back to log files.
 * Returns at most 100 most recent events.
 */
function getTopupEvents() {
    // Try journalctl first
    const journalLines = readJournalctlLines();
    if (journalLines) {
        const events = parseLines(journalLines);
        return {
            available: true,
            source: "journalctl",
            events: events.slice(-100),
            totalMatches: events.length,
        };
    }

    // Fall back to log files
    const fileResult = readLogFileLines();
    if (!fileResult) {
        return { available: false, source: null, events: [], message: "No log source found" };
    }

    const events = parseLines(fileResult.lines);
    return {
        available: true,
        source: fileResult.path,
        events: events.slice(-100),
        totalMatches: events.length,
    };
}

function parseLines(lines) {
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
                break;
            }
        }
    }
    return events;
}

module.exports = { getTopupEvents };
