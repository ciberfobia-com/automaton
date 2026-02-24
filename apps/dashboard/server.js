/**
 * Automaton Dashboard — Server Entry Point
 *
 * Self-hosted observability dashboard.
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

// ─── API Routes ─────────────────────────────────────────────
app.use("/api", require("./routes/health"));
app.use("/api", require("./routes/status"));
app.use("/api", require("./routes/children"));
app.use("/api", require("./routes/turns"));
app.use("/api", require("./routes/policy"));
app.use("/api", require("./routes/heartbeat"));
app.use("/api", require("./routes/wake-events"));
app.use("/api", require("./routes/spend"));
app.use("/api", require("./routes/soul"));
app.use("/api", require("./routes/config-route"));
app.use("/api", require("./routes/mutations"));

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
