const { db } = require("../db");

/**
 * Loop Telemetry Repository
 * Provides real-time visibility into the Parent Agent ReAct cycle.
 */
class LoopRepo {
    static getRealtimeLoop() {
        return db.transaction(() => {
            // 1. Core State
            const state = db.prepare("SELECT value FROM kv WHERE key = 'agent_state'").get()?.value || 'unknown';
            const sleepUntil = db.prepare("SELECT value FROM kv WHERE key = 'sleep_until'").get()?.value;
            const orchestratorLastTickRaw = db.prepare("SELECT value FROM kv WHERE key = 'orchestrator.last_tick'").get()?.value;

            let orchestratorPhase = 'unknown';
            let orchestratorAssignments = 0;
            if (orchestratorLastTickRaw) {
                try {
                    const tick = JSON.parse(orchestratorLastTickRaw);
                    orchestratorPhase = tick.phase || 'unknown';
                    orchestratorAssignments = tick.tasksAssigned || 0;
                } catch (e) { }
            }

            // 2. Active Goal Context
            const activeGoal = db.prepare(`SELECT id, title, status FROM goals WHERE status = 'active' LIMIT 1`).get();

            // 3. Last N Turns
            const turns = db.prepare(`
                SELECT id, timestamp, state, input_source, thinking, cost_cents 
                FROM turns 
                ORDER BY timestamp DESC LIMIT 10
            `).all();

            // 4. Last N Tool Calls
            const toolCalls = db.prepare(`
                SELECT tc.name as tool_name, tc.result, tc.error, tc.created_at, t.thinking
                FROM tool_calls tc
                JOIN turns t ON tc.turn_id = t.id
                ORDER BY tc.created_at DESC LIMIT 15
            `).all();

            // 5. Burn Rate Calculation (Last 10 minutes)
            const burn10mRow = db.prepare(`
                SELECT SUM(cost_cents) as recent_cost
                FROM inference_costs
                WHERE created_at > datetime('now', '-10 minutes')
            `).get();
            const recentCostCents = burn10mRow?.recent_cost || 0;
            const burnRatePerMinute = recentCostCents / 10.0;

            // 6. Current Balances (to estimate time to zero)
            const creditsRow = db.prepare("SELECT value FROM kv WHERE key = 'auto_credits'").get();
            let currentCreditsCents = 0;
            if (creditsRow && creditsRow.value) {
                try {
                    currentCreditsCents = JSON.parse(creditsRow.value).cents || 0;
                } catch (e) { }
            }

            let estimatedMinutesToZero = -1;
            if (burnRatePerMinute > 0 && currentCreditsCents > 0) {
                estimatedMinutesToZero = Math.floor(currentCreditsCents / burnRatePerMinute);
            }

            return {
                agent_state: state,
                sleep_until: sleepUntil,
                orchestrator_phase: orchestratorPhase,
                recent_assignments: orchestratorAssignments,
                active_goal: activeGoal || null,
                recent_turns: turns,
                recent_tools: toolCalls.map(tc => ({
                    tool: tc.tool_name,
                    success: !tc.error,
                    excerpt: tc.error || (tc.result ? tc.result.slice(0, 100) : ''),
                    thinking: tc.thinking ? tc.thinking.slice(0, 100) : '',
                    time: tc.created_at
                })),
                burn_metrics: {
                    cost_last_10_minutes_cents: recentCostCents,
                    burn_rate_per_minute_cents: burnRatePerMinute,
                    estimated_minutes_to_zero_credits: estimatedMinutesToZero
                }
            };
        })();
    }
}

module.exports = { LoopRepo };
