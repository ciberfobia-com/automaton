const db = require('../db');

function getChildren() {
    return db.safeAll("SELECT * FROM children ORDER BY created_at DESC");
}

function getChildLifecycleEvents(childId) {
    return db.safeAll("SELECT * FROM child_lifecycle_events WHERE child_id = ? ORDER BY created_at ASC", [childId]);
}

function getReputation() {
    return db.safeAll("SELECT * FROM reputation ORDER BY created_at DESC LIMIT 100");
}

function getRegistry() {
    return db.safeAll("SELECT * FROM registry");
}

module.exports = {
    getChildren,
    getChildLifecycleEvents,
    getReputation,
    getRegistry
};
