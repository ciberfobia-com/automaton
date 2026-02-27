/**
 * Child Log Viewer — Phase 2
 *
 * GET /api/children/:id/logs?lines=200
 *
 * Reads parent runtime logs via journalctl for entries mentioning the child ID.
 * Falls back to reading log files from common locations if journalctl is unavailable.
 */

const { Router } = require("express");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const db = require("../lib/db");
const router = Router();

// Fallback log file paths (legacy PM2 or manual log files)
const FALLBACK_LOG_PATHS = [
    "/var/log/ciberpadre.log",
    "/root/.pm2/logs/automaton-out.log",
    path.join(os.homedir(), ".pm2", "logs", "automaton-out.log"),
];

// Strip ANSI escape codes
function stripAnsi(str) {
    return str.replace(
        /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
        ""
    );
}

/**
 * Try to read logs from journalctl (systemd).
 * Returns null if journalctl is not available.
 */
function readJournalctl(searchTerms, maxLines) {
    try {
        // Get recent logs from the ciberpadre service
        const raw = execSync(
            `journalctl -u ciberpadre --no-pager -n 5000 --output=short-iso 2>/dev/null`,
            { encoding: "utf-8", timeout: 5000 }
        );
        const allLines = raw.split("\n");
        const matchedLines = [];

        for (const line of allLines) {
            if (!line.trim()) continue;
            const matches = searchTerms.some((term) => line.includes(term));
            if (matches) {
                const clean = stripAnsi(line.trim());
                const tsMatch = clean.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*)/);
                matchedLines.push({
                    raw: clean.slice(0, 500),
                    timestamp: tsMatch ? tsMatch[1] : null,
                    matchedBy: searchTerms.filter((t) => line.includes(t)),
                });
            }
        }

        return {
            available: true,
            source: "journalctl",
            lines: matchedLines.slice(-maxLines),
            totalMatches: matchedLines.length,
        };
    } catch {
        return null;
    }
}

/**
 * Fallback: read from log files on disk.
 */
function readLogFile(searchTerms, maxLines) {
    let logPath = null;
    for (const p of FALLBACK_LOG_PATHS) {
        if (fs.existsSync(p)) {
            logPath = p;
            break;
        }
    }

    if (!logPath) {
        return {
            available: false,
            source: null,
            lines: [],
            totalMatches: 0,
            message: "No log source found. Ensure ciberpadre systemd service is running.",
        };
    }

    try {
        const stat = fs.statSync(logPath);
        const readSize = Math.min(stat.size, 2 * 1024 * 1024);
        const fd = fs.openSync(logPath, "r");
        const buffer = Buffer.alloc(readSize);
        fs.readSync(fd, buffer, 0, readSize, Math.max(0, stat.size - readSize));
        fs.closeSync(fd);

        const allLines = buffer.toString("utf-8").split("\n");
        const matchedLines = [];

        for (const line of allLines) {
            if (!line.trim()) continue;
            const matches = searchTerms.some((term) => line.includes(term));
            if (matches) {
                const clean = stripAnsi(line.trim());
                const tsMatch = clean.match(/^\[([^\]]+)\]/);
                matchedLines.push({
                    raw: clean.slice(0, 500),
                    timestamp: tsMatch ? tsMatch[1] : null,
                    matchedBy: searchTerms.filter((t) => line.includes(t)),
                });
            }
        }

        return {
            available: true,
            source: logPath,
            lines: matchedLines.slice(-maxLines),
            totalMatches: matchedLines.length,
        };
    } catch (err) {
        return {
            available: false,
            source: logPath,
            lines: [],
            totalMatches: 0,
            message: `Failed to parse logs: ${err.message}`,
        };
    }
}

router.get("/children/:id/logs", (req, res) => {
    const { id } = req.params;
    const maxLines = Math.min(parseInt(req.query.lines || "200", 10), 500);

    // Get child metadata for additional search terms
    const child = db.safeGet("SELECT * FROM children WHERE id = ?", [id]);
    const searchTerms = [id];
    if (child) {
        if (child.sandbox_id) searchTerms.push(child.sandbox_id);
        if (child.name) searchTerms.push(child.name);
        if (child.address) searchTerms.push(child.address.slice(0, 12));
    }

    // Try journalctl first, fall back to log files
    const result = readJournalctl(searchTerms, maxLines) || readLogFile(searchTerms, maxLines);

    res.json({
        ...result,
        searchTerms,
        childId: id,
    });
});

module.exports = router;
