const db = require('../db');

function getGoals() {
    return db.safeAll(`
        SELECT g.*, 
               (SELECT SUM(actual_cost_cents) FROM task_graph t WHERE t.goal_id = g.id) as total_cost_cents,
               (SELECT COUNT(*) FROM task_graph t WHERE t.goal_id = g.id) as task_count,
               (SELECT COUNT(*) FROM task_graph t WHERE t.goal_id = g.id AND t.status = 'completed') as completed_tasks
        FROM goals g
        ORDER BY created_at DESC
    `);
}

function getTasksForGoal(goalId) {
    return db.safeAll("SELECT * FROM task_graph WHERE goal_id = ? ORDER BY created_at ASC", [goalId]);
}

function getTimeline(limit = 200) {
    return db.safeAll("SELECT * FROM event_stream ORDER BY created_at DESC LIMIT ?", [limit]);
}

module.exports = {
    getGoals,
    getTasksForGoal,
    getTimeline
};
