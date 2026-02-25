const db = require('../db');

function getPolicyDecisions(decisionType, limit = 100) {
    if (decisionType) {
        return db.safeAll("SELECT * FROM policy_decisions WHERE decision = ? ORDER BY created_at DESC LIMIT ?", [decisionType, limit]);
    }
    return db.safeAll("SELECT * FROM policy_decisions ORDER BY created_at DESC LIMIT ?", [limit]);
}

function getTurns(limit = 100) {
    return db.safeAll("SELECT * FROM turns ORDER BY timestamp DESC LIMIT ?", [limit]);
}

function getToolCalls(limit = 100) {
    return db.safeAll("SELECT * FROM tool_calls ORDER BY created_at DESC LIMIT ?", [limit]);
}

function getHeartbeatHistory(limit = 100) {
    return db.safeAll("SELECT * FROM heartbeat_history ORDER BY started_at DESC LIMIT ?", [limit]);
}

function getHeartbeatSchedule() {
    return db.safeAll("SELECT * FROM heartbeat_schedule");
}

module.exports = {
    getPolicyDecisions,
    getTurns,
    getToolCalls,
    getHeartbeatHistory,
    getHeartbeatSchedule
};
