/**
 * Dashboard Configuration
 *
 * Reads environment variables with sensible defaults.
 */

const path = require("path");
const os = require("os");

const home = os.homedir() || "/root";

const config = {
  port: parseInt(process.env.DASHBOARD_PORT || "4020", 10),
  bind: process.env.DASHBOARD_BIND || "0.0.0.0",
  stateDbPath: process.env.DASHBOARD_STATE_DB_PATH || path.join(home, ".automaton", "state.db"),
  ownerToken: process.env.DASHBOARD_OWNER_TOKEN || "",
  enableMutations: (process.env.DASHBOARD_ENABLE_MUTATIONS || "false").toLowerCase() === "true",
  automatonDir: process.env.DASHBOARD_AUTOMATON_DIR || path.join(home, ".automaton"),
};

module.exports = config;
