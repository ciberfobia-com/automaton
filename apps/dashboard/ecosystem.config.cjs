// PM2 Ecosystem File — Dashboard
// Usage: pm2 start apps/dashboard/ecosystem.config.cjs
const path = require("path");
module.exports = {
    apps: [
        {
            name: "dashboard",
            script: "server.js",
            cwd: path.resolve(__dirname),
            env: {
                DASHBOARD_PORT: 4020,
                DASHBOARD_BIND: "0.0.0.0",
                DASHBOARD_STATE_DB_PATH: path.join(require("os").homedir(), ".automaton", "state.db"),
                DASHBOARD_ENABLE_MUTATIONS: "false",
                // DASHBOARD_OWNER_TOKEN: set via environment or pm2 set
            },
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "150M",
        },
    ],
};
