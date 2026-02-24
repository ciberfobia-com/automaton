/**
 * Child Log Viewer — Phase 2
 *
 * GET /api/children/:id/logs?lines=200
 *
 * Parses parent PM2 logs for entries mentioning the child ID.
 */

const { Router } = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const db = require("../lib/db");
const router = Router();

const LOG_PATHS = [
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

    // Find PM2 log file
    let logPath = null;
    for (const p of LOG_PATHS) {
        if (fs.existsSync(p)) {
            logPath = p;
            break;
        }
    }

    if (!logPath) {
        return res.json({
            available: false,
            path: null,
            lines: [],
            totalMatches: 0,
            message: "PM2 log file not found. Logs are only available on the VPS.",
        });
    }

    try {
        const stat = fs.statSync(logPath);
        // Read last 2MB to search for child entries
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
                // Parse timestamp if present
                const tsMatch = clean.match(/^\[([^\]]+)\]/);
                matchedLines.push({
                    raw: clean.slice(0, 500), // Cap line length
                    timestamp: tsMatch ? tsMatch[1] : null,
                    matchedBy: searchTerms.filter((t) => line.includes(t)),
                });
            }
        }

        // Return last N lines
        const result = matchedLines.slice(-maxLines);

        res.json({
            available: true,
            path: logPath,
            lines: result,
            totalMatches: matchedLines.length,
            searchTerms,
            childId: id,
        });
    } catch (err) {
        res.json({
            available: false,
            path: logPath,
            lines: [],
            totalMatches: 0,
            message: `Failed to parse logs: ${err.message}`,
        });
    }
});

module.exports = router;
