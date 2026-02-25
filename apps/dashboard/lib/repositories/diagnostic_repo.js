const { db } = require("../db");

/**
 * Diagnostics Telemetry Repository
 * Logic Layer for detecting Stalled Workers, Zombie Workers, and Blocked Goals.
 */
class DiagnosticRepo {
    static getSystemDiagnostics() {
        return db.transaction(() => {
            // 1. Fetch Raw Data
            const activeTasks = db.prepare(`
                SELECT id, title, goal_id, assigned_to, started_at
                FROM task_graph
                WHERE status = 'running' OR status = 'assigned'
            `).all();

            const children = db.prepare(`
                SELECT id, sandbox_id, address, status, last_checked
                FROM children
                WHERE status IN ('healthy', 'funded', 'spawning')
            `).all();

            const recentTurns = db.prepare(`
                SELECT id, timestamp
                FROM turns
                ORDER BY timestamp DESC LIMIT 50
            `).all();
            const lastTurnTime = recentTurns.length > 0 ? new Date(recentTurns[0].timestamp).getTime() : 0;

            const activeGoals = db.prepare(`
                SELECT id, title
                FROM goals 
                WHERE status = 'active'
            `).all();

            // Detect Stalled Workers (Local & Cloud)
            // A worker is stalled if it has an active task but hasn't made progress
            // in > 5 minutes (based on task started_at if local, or missing recent turns).
            const stalledWorkers = [];
            const now = Date.now();
            const FIVE_MINUTES = 5 * 60 * 1000;
            const TEN_MINUTES = 10 * 60 * 1000;

            for (const t of activeTasks) {
                if (!t.assigned_to) continue; // Task is active but not assigned? Anomaly, but not a worker issue.

                // If it's a local worker, it runs in the background. We check if the task has been running too long.
                const taskAge = t.started_at ? now - new Date(t.started_at).getTime() : 0;

                if (taskAge > FIVE_MINUTES) {
                    stalledWorkers.push({
                        type: 'stalled_worker',
                        worker_address: t.assigned_to,
                        issue: `Task '${t.title}' assigned for > 5 minutes without completion.`,
                        task_id: t.id,
                        goal_id: t.goal_id,
                        duration_minutes: Math.floor(taskAge / 60000)
                    });
                }
            }

            // Detect Zombie Workers (Cloud primarily)
            // Marked healthy but no updates to last_checked in > 10m
            const zombieWorkers = [];
            for (const c of children) {
                const checkedAge = c.last_checked ? now - new Date(c.last_checked).getTime() : now; // If never checked, assume it's dead

                if (checkedAge > TEN_MINUTES) {
                    zombieWorkers.push({
                        type: 'zombie_worker',
                        worker_address: c.address,
                        sandbox_id: c.sandbox_id,
                        issue: `Worker marked ${c.status} but no health check updates in > 10 minutes.`,
                        checked_age_minutes: Math.floor(checkedAge / 60000)
                    });
                }
            }

            // Detect Blocked Goals
            // An active goal with assigned tasks that has seen no global turn activity > 10m or
            // is stuck in a repetitive fail loop.
            const blockedGoals = [];
            for (const g of activeGoals) {
                // Check if any of its tasks are in the stalled list
                const stalledTasksForGoal = stalledWorkers.filter(w => w.goal_id === g.id);

                if (stalledTasksForGoal.length > 0) {
                    blockedGoals.push({
                        type: 'blocked_goal',
                        goal_id: g.id,
                        issue: `Goal has ${stalledTasksForGoal.length} stalled tasks preventing progress.`,
                        stalled_tasks: stalledTasksForGoal.map(st => st.task_id)
                    });
                } else {
                    // Check if the agent is awake but completely idle while goal is active
                    const globalIdleTime = now - lastTurnTime;
                    if (globalIdleTime > TEN_MINUTES) {
                        blockedGoals.push({
                            type: 'blocked_goal',
                            goal_id: g.id,
                            issue: `Goal is active but Parent Agent hasn't taken a turn in > 10 minutes.`,
                            idle_time_minutes: Math.floor(globalIdleTime / 60000)
                        });
                    }
                }
            }


            return {
                timestamp: new Date().toISOString(),
                summary: {
                    total_stalled: stalledWorkers.length,
                    total_zombies: zombieWorkers.length,
                    total_blocked_goals: blockedGoals.length
                },
                diagnostics: [
                    ...stalledWorkers,
                    ...zombieWorkers,
                    ...blockedGoals
                ]
            };
        })();
    }
}

module.exports = { DiagnosticRepo };
