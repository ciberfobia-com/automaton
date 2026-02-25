const { db } = require("../db");

/**
 * Worker Telemetry Repository
 * Safely extracts deep real-time metrics for both local and cloud workers.
 */
class WorkerRepo {
    /**
     * Get a comprehensive timeline and status view of all workers.
     */
    static getWorkerTelemetry() {
        return db.transaction(() => {
            // 1. Get all recorded children/workers
            const workers = db.prepare(`
                SELECT id, sandbox_id, address, name, status, created_at, last_checked
                FROM children
                ORDER BY created_at DESC
            `).all();

            // 2. Map workers to their current executing tasks
            const activeTasks = db.prepare(`
                SELECT id as task_id, title as task_title, goal_id, agent_role, assigned_to, started_at, status as task_status
                FROM task_graph
                WHERE status = 'running' OR status = 'assigned'
            `).all();

            const taskMap = new Map();
            for (const t of activeTasks) {
                if (t.assigned_to) taskMap.set(t.assigned_to, t);
            }

            // 3. Map recent tool calls to see what they are currently doing
            // Note: workers log tool calls referencing their sandbox/address
            const recentTools = db.prepare(`
                SELECT tool_name, created_at, recipient
                FROM spend_tracking
                WHERE tool_name IN ('spawn_child', 'message_child', 'exec', 'write_file', 'transfer_credits')
                AND created_at > datetime('now', '-1 hour')
                ORDER BY created_at DESC
            `).all();

            // 4. Calculate total spent per child via ledger
            const childSpend = db.prepare(`
                SELECT address, SUM(amount_cents) as total_spent
                FROM child_ledger
                GROUP BY address
            `).all();

            const spendMap = new Map();
            for (const c of childSpend) {
                spendMap.set(c.address, c.total_spent);
            }

            // 5. Build combined worker telemetry
            return workers.map(w => {
                const currentTask = taskMap.get(w.address) || taskMap.get(`local://${w.sandbox_id}`) || null;
                const totalSpent = spendMap.get(w.address) || 0;

                // Try to find the last action involving this worker
                const lastAction = recentTools.find(t => t.recipient === w.sandbox_id || t.recipient === w.address);

                const runtimeType = w.address?.startsWith('local://') ? 'Local Worker' : 'Cloud Conway VM';

                return {
                    worker_id: w.id,
                    sandbox_id: w.sandbox_id,
                    name: w.name,
                    role: currentTask ? currentTask.agent_role : 'generalist',
                    address: w.address,
                    status: w.status,
                    runtime_type: runtimeType,
                    current_task: currentTask ? {
                        id: currentTask.task_id,
                        title: currentTask.task_title,
                        goal_id: currentTask.goal_id,
                        status: currentTask.task_status,
                        duration_seconds: currentTask.started_at ?
                            Math.floor((Date.now() - new Date(currentTask.started_at).getTime()) / 1000) : 0
                    } : null,
                    total_spent_cents: totalSpent,
                    last_seen_action: lastAction ? {
                        tool: lastAction.tool_name,
                        time: lastAction.created_at
                    } : null,
                    last_checked: w.last_checked,
                    created_at: w.created_at
                };
            });
        })();
    }
}

module.exports = { WorkerRepo };
