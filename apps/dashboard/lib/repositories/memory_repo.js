const db = require('../db');

function getSemanticMemory(category) {
    if (category) {
        return db.safeAll("SELECT * FROM semantic_memory WHERE category = ? ORDER BY updated_at DESC", [category]);
    }
    return db.safeAll("SELECT * FROM semantic_memory ORDER BY updated_at DESC LIMIT 200");
}

function getEpisodicMemory(limit = 100) {
    return db.safeAll("SELECT * FROM episodic_memory ORDER BY created_at DESC LIMIT ?", [limit]);
}

function getWorkingMemory() {
    return db.safeAll("SELECT * FROM working_memory ORDER BY priority DESC");
}

module.exports = {
    getSemanticMemory,
    getEpisodicMemory,
    getWorkingMemory
};
