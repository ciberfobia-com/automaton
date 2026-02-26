/**
 * Automaton Dashboard — Server Entry Point
 *
 * Unified observability dashboard.
 * Reads local SQLite data only. No external dependencies.
 */

const express = require("express");
const path = require("path");
const config = require("./lib/config");
const db = require("./lib/db");

const app = express();
app.use(express.json());

// ─── Open Database ──────────────────────────────────────────
db.open();

// ─── Static Files ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ─── Unified API Routes ─────────────────────────────────────

// Core endpoints (v1 — kept for stability)
app.use("/api", require("./routes/health"));
app.use("/api", require("./routes/status"));
app.use("/api", require("./routes/children"));
app.use("/api", require("./routes/child-details"));
app.use("/api", require("./routes/child-logs"));
app.use("/api", require("./routes/child-resources"));
app.use("/api", require("./routes/child-ledger"));
app.use("/api", require("./routes/turns"));
app.use("/api", require("./routes/policy"));
app.use("/api", require("./routes/heartbeat"));
app.use("/api", require("./routes/wake-events"));
app.use("/api", require("./routes/spend"));
app.use("/api", require("./routes/soul"));
app.use("/api", require("./routes/config-route"));
app.use("/api", require("./routes/mutations"));

// Unified observability endpoints
app.use("/api", require("./routes/derived-health"));
app.use("/api", require("./routes/goals"));
app.use("/api", require("./routes/workers"));
app.use("/api", require("./routes/economy"));
app.use("/api", require("./routes/admin"));
app.use("/api", require("./routes/db-inspector"));
app.use("/api", require("./routes/orchestrator-health"));

// Legacy V2 routes (kept for backward compat, will be deprecated)
app.use("/api/v2/economy", require("./routes/v2/economy"));
app.use("/api/v2/orchestration", require("./routes/v2/orchestration"));
app.use("/api/v2/memory", require("./routes/v2/memory"));
app.use("/api/v2/operations", require("./routes/v2/operations"));
app.use("/api/v2/replication", require("./routes/v2/replication"));
app.use("/api/v2/telemetry", require("./routes/v2/telemetry"));
app.use("/api/v2/admin", require("./routes/v2/admin_actions"));

// ─── SPA Fallback ───────────────────────────────────────────
app.get("*", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Start ──────────────────────────────────────────────────
app.listen(config.port, config.bind, () => {
    console.log(`[dashboard] Listening on http://${config.bind}:${config.port}`);
    console.log(`[dashboard] DB connected: ${db.isConnected()}`);
    console.log(`[dashboard] Mutations: ${config.enableMutations ? "ENABLED" : "disabled"}`);
});
