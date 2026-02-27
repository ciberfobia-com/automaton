/**
 * Automaton Dashboard — Unified Frontend
 *
 * Vanilla JS, hash-based routing, manual refresh only.
 * Single sidebar: Overview, Goals, Workers, Economy, Activity, Diagnostics, DB Inspector, Heartbeat, Soul, Config
 */

(function () {
    "use strict";

    let currentSection = "overview";

    // ─── Helpers ────────────────────────────────────────
    async function api(path) {
        try {
            const res = await fetch("/api" + path);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            console.error(`API error: ${path}`, err);
            return null;
        }
    }

    async function apiPost(path, body) {
        try {
            const res = await fetch("/api" + path, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            return await res.json();
        } catch (err) {
            console.error(`API POST error: ${path}`, err);
            return null;
        }
    }

    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }

    function esc(str) {
        if (str == null) return "";
        const d = document.createElement("div");
        d.textContent = String(str);
        return d.innerHTML;
    }

    function badge(text, type) {
        return `<span class="badge badge-${type}">${esc(text)}</span>`;
    }

    function stateBadge(state) {
        const map = {
            running: "green", waking: "blue", sleeping: "yellow",
            low_compute: "yellow", critical: "red", dead: "red", setup: "blue",
            healthy: "green", stale: "yellow", zombie: "red", idle: "blue",
            progressing: "green", dispatch_failure: "red", worker_stall: "red",
            stalled: "yellow", blocked: "yellow",
        };
        return badge(state, map[state] || "blue");
    }

    function statusBadge(status) {
        const map = {
            alive: "green", active: "green", running: "green", completed: "green",
            spawning: "blue", starting: "blue", pending: "blue", assigned: "blue",
            dead: "red", failed: "red", stopped: "red", cancelled: "red",
            allow: "green", deny: "red",
        };
        return badge(status, map[status] || "yellow");
    }

    function timeAgo(ts) {
        if (!ts) return "—";
        const d = new Date(ts);
        if (isNaN(d.getTime())) return esc(ts);
        const s = Math.floor((Date.now() - d.getTime()) / 1000);
        if (s < 60) return `${s}s ago`;
        if (s < 3600) return `${Math.floor(s / 60)}m ago`;
        if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
        return `${Math.floor(s / 86400)}d ago`;
    }

    function formatMs(ms) {
        if (ms == null || ms < 0) return "—";
        if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
        if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
        return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
    }

    function formatCents(c) {
        if (c == null) return "—";
        return "$" + (Number(c) / 100).toFixed(2);
    }

    function jsonToggle(id) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle("open");
    }

    function jsonBlock(obj, id) {
        const str = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
        return `<span class="json-toggle" onclick="window.__jsonToggle('${id}')">▶ JSON</span>
            <div class="json-block" id="${id}">${esc(str)}</div>`;
    }

    window.__jsonToggle = jsonToggle;

    function makeTable(headers, rows) {
        if (!rows || rows.length === 0) {
            return `<div class="empty">No data available</div>`;
        }
        let html = `<div class="table-wrap"><table><thead><tr>`;
        for (const h of headers) html += `<th>${esc(h.label)}</th>`;
        html += `</tr></thead><tbody>`;
        for (const row of rows) {
            html += `<tr>`;
            for (const h of headers) {
                html += `<td>${h.render ? h.render(row) : esc(row[h.key])}</td>`;
            }
            html += `</tr>`;
        }
        html += `</tbody></table></div>`;
        return html;
    }

    // ─── Admin Mutators ───────────────────────────────────────

    window.__adminUnassign = async (taskId) => {
        if (!confirm(`Unassign task ${taskId}? It will return to the orchestrator queue.`)) return;
        const r = await apiPost("/admin/unassign_task", { taskId });
        if (r?.error) alert(`Error: ${r.error}`);
        else navigate();
    };

    window.__adminFail = async (taskId) => {
        const reason = prompt(`Reason for marking task ${taskId} failed:`, "Admin override");
        if (!reason) return;
        const r = await apiPost("/admin/mark_task_failed", { taskId, reason });
        if (r?.error) alert(`Error: ${r.error}`);
        else navigate();
    };

    window.__adminRequeue = async (taskId) => {
        if (!confirm(`Requeue task ${taskId}? It will return to pending for re-dispatch.`)) return;
        const r = await apiPost("/admin/requeue_task", { taskId });
        if (r?.error) alert(`Error: ${r.error}`);
        else navigate();
    };

    // ─── Sections ───────────────────────────────────────

    const sections = {

        // ══════════════════════════════════════════════════
        //  OVERVIEW — merged Status + Loop Inspector
        // ══════════════════════════════════════════════════
        async overview() {
            const [status, health, econ, orch] = await Promise.all([
                api("/status"),
                api("/health/derived"),
                api("/economy/overview"),
                api("/orchestrator/health"),
            ]);

            let html = "";

            // Cycle detection banner
            if (orch?.cycleDetected) {
                html += `<div class="card" style="border-color:var(--red); margin-bottom:20px; background:rgba(255,59,48,0.08)">
                    <div class="card-label" style="color:var(--red)">🔄 CYCLE DETECTED — Orchestrator Stuck</div>
                    <div class="card-sub" style="color:var(--red)">
                        Tasks are being recovered from dead workers repeatedly without progress.
                        ${orch.totalStaleRecoveries} total stale recoveries detected.
                        The system will auto-fail tasks after max retries.
                    </div>
                </div>`;
            }

            // System health banner
            if (health?.summary) {
                const s = health.summary;
                const color = s.overall === "critical" ? "var(--red)" : s.overall === "warning" ? "var(--yellow)" : "var(--green)";
                html += `<div class="card" style="border-color:${color}; margin-bottom:20px">
                    <div class="card-label" style="color:${color}">System Health: ${s.overall.toUpperCase()}</div>
                    <div class="card-sub">
                        ${s.critical_tasks} critical tasks · ${s.zombie_workers} zombies · ${s.stalled_goals} stalled goals · ${s.warning_tasks} warnings
                    </div>
                </div>`;
            }

            // Core metrics
            if (status) {
                html += `<div class="card-grid">
                    <div class="card"><div class="card-label">Agent State</div><div class="card-value">${stateBadge(status.agentState)}</div></div>
                    <div class="card"><div class="card-label">Credits</div><div class="card-value">${esc(status.creditsBalance || "—")}</div></div>
                    <div class="card"><div class="card-label">USDC</div><div class="card-value">${esc(status.usdcBalance || "—")}</div></div>
                    <div class="card"><div class="card-label">Survival Tier</div><div class="card-value">${esc(status.survivalTier || "—")}</div></div>
                    <div class="card"><div class="card-label">Model</div><div class="card-value" style="font-size:14px">${esc(status.currentModel || "—")}</div></div>
                    <div class="card"><div class="card-label">Last Turn</div><div class="card-value" style="font-size:14px">${timeAgo(status.lastTurnTimestamp)}</div></div>
                    <div class="card"><div class="card-label">Total Turns</div><div class="card-value">${esc(status.turnCount)}</div></div>
                    <div class="card"><div class="card-label">DB</div><div class="card-value">${status.dbConnected ? badge("Connected", "green") : badge("Disconnected", "red")}</div></div>
                </div>`;
            }

            // Orchestrator status
            if (orch) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Orchestrator</span></div>`;
                const phaseColor = orch.phase === "executing" ? "green" : orch.phase === "failed" ? "red" : orch.phase === "idle" ? "blue" : "yellow";
                html += `<div class="card-grid">
                    <div class="card"><div class="card-label">Phase</div><div class="card-value">${badge(orch.phase, phaseColor)}</div></div>
                    <div class="card"><div class="card-label">Active Goal</div><div class="card-value" style="font-size:13px">${orch.activeGoal ? `<a href="#goal/${orch.activeGoal.id}" style="color:var(--accent)">${esc(orch.activeGoal.title?.slice(0, 40))}</a>` : "—"}</div></div>
                    <div class="card"><div class="card-label">Replans</div><div class="card-value">${esc(orch.replanCount)}</div></div>
                    <div class="card" style="border-color:${orch.totalStaleRecoveries > 0 ? 'var(--yellow)' : ''}"><div class="card-label">Stale Recoveries</div><div class="card-value" style="color:${orch.totalStaleRecoveries > 0 ? 'var(--red)' : ''}">${esc(orch.totalStaleRecoveries)}</div></div>
                </div>`;

                // Stale recovery details
                if (orch.staleRecoveries?.length > 0) {
                    html += makeTable([
                        { label: "Task", key: "taskTitle", render: (r) => `<a href="#goal/${orch.goalId}" style="color:var(--accent)">${esc(r.taskTitle?.slice(0, 40))}</a>` },
                        { label: "Status", key: "taskStatus", render: (r) => statusBadge(r.taskStatus) },
                        { label: "Recovery Attempts", key: "count", render: (r) => `<strong style="color:${r.count >= 2 ? 'var(--red)' : ''}">${r.count}/${r.maxRetries}</strong>` },
                        { label: "Exhausted", key: "exhausted", render: (r) => r.exhausted ? badge("YES", "red") : badge("No", "green") },
                        { label: "Last Recovery", key: "lastRecovery", render: (r) => timeAgo(r.lastRecovery) },
                    ], orch.staleRecoveries);
                }
            }

            // Burn rate
            if (econ?.burn_rate) {
                const b = econ.burn_rate;
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Burn Rate</span></div>`;
                html += `<div class="card-grid">
                    <div class="card"><div class="card-label">Per Minute</div><div class="card-value" style="color:var(--red)">${formatCents(b.per_minute_cents)}</div></div>
                    <div class="card"><div class="card-label">Last 10m</div><div class="card-value">${formatCents(b.last_10m_cents)}</div><div class="card-sub">${b.calls_last_10m} calls</div></div>
                    <div class="card"><div class="card-label">Last Hour</div><div class="card-value">${formatCents(b.last_1h_cents)}</div></div>
                    <div class="card"><div class="card-label">Last 24h</div><div class="card-value">${formatCents(b.last_24h_cents)}</div></div>
                    <div class="card"><div class="card-label">Time to Zero</div><div class="card-value" style="color:${b.time_to_zero_minutes > 0 && b.time_to_zero_minutes < 60 ? 'var(--red)' : ''}">${b.time_to_zero_minutes < 0 ? '∞' : b.time_to_zero_minutes + 'm'}</div></div>
                </div>`;
            }

            return html || `<div class="empty">Unable to load overview</div>`;
        },

        // ══════════════════════════════════════════════════
        //  GOALS — unified list + detail drilldown
        // ══════════════════════════════════════════════════
        async goals() {
            const goals = await api("/goals");
            if (!goals) return `<div class="empty">Unable to load goals</div>`;

            let html = `<div class="section-header"><span class="section-title">Goals</span></div>`;
            html += makeTable([
                { label: "Title", key: "title", render: (r) => `<a href="#goal/${r.id}" style="color:var(--accent)">${esc(r.title)}</a>` },
                { label: "Status", key: "status", render: (r) => statusBadge(r.status) },
                { label: "Tasks", key: "task_count", render: (r) => `${r.completed_tasks || 0}/${r.task_count} done · ${r.failed_tasks || 0} failed · ${r.blocked_tasks || 0} blocked` },
                { label: "Cost", key: "total_cost_cents", render: (r) => formatCents(r.total_cost_cents) },
                { label: "Created", key: "created_at", render: (r) => timeAgo(r.created_at) },
            ], goals);
            return html;
        },

        // Goal detail drilldown
        async goalDetail(id) {
            const data = await api("/goals/" + id);
            if (!data) return `<div class="empty">Goal not found</div>`;

            let html = `<div style="margin-bottom:16px">
                <span style="font-size:20px;font-weight:700">${esc(data.goal.title)}</span>
                <span style="margin-left:12px">${statusBadge(data.goal.status)}</span>
            </div>`;

            // Task health table
            html += `<div class="section-header"><span class="section-title">Tasks (${data.tasks.length})</span></div>`;
            html += makeTable([
                { label: "Title", key: "title" },
                {
                    label: "Status", key: "status", render: (r) => {
                        let b = statusBadge(r.status);
                        if (r.dispatch_failed) b += ` ${badge("DISPATCH FAILED", "red")}`;
                        if (r.timed_out) b += ` ${badge("TIMED OUT", "red")}`;
                        return b;
                    }
                },
                { label: "Assigned To", key: "assigned_to", render: (r) => r.assigned_to ? esc(r.assigned_to.slice(0, 20)) : "—" },
                { label: "Dispatch Age", key: "dispatch_age_ms", render: (r) => r.dispatch_age_ms != null ? `<span style="color:${r.dispatch_failed ? 'var(--red)' : ''}">${formatMs(r.dispatch_age_ms)}</span>` : "—" },
                { label: "Run Age", key: "run_age_ms", render: (r) => r.run_age_ms != null ? `<span style="color:${r.timed_out ? 'var(--red)' : ''}">${formatMs(r.run_age_ms)}</span>` : "—" },
                { label: "Retries", key: "retries_remaining", render: (r) => `${r.retry_count || 0}/${r.max_retries || 0}` },
                { label: "Cost", key: "actual_cost_cents", render: (r) => formatCents(r.actual_cost_cents) },
                {
                    label: "Actions", key: "_act", render: (r) => {
                        if (r.status === "assigned" || r.status === "running") {
                            return `<div style="display:flex;gap:4px">
                            <button class="btn" style="padding:2px 6px;font-size:11px" onclick="window.__adminUnassign('${r.id}')">Unassign</button>
                            <button class="btn" style="padding:2px 6px;font-size:11px;background:var(--red)" onclick="window.__adminFail('${r.id}')">Fail</button>
                        </div>`;
                        }
                        return "—";
                    }
                },
            ], data.tasks);

            // Events
            if (data.events?.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Event Timeline</span></div>`;
                html += makeTable([
                    { label: "Type", key: "type", render: (r) => badge(r.type, "blue") },
                    { label: "Content", key: "content", render: (r) => esc((r.content || "").slice(0, 100)) },
                    { label: "Tokens", key: "token_count" },
                    { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
                ], data.events);
            }

            // Cost breakdown
            if (data.cost_breakdown?.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Cost by Model</span></div>`;
                html += makeTable([
                    { label: "Model", key: "model" },
                    { label: "Cost", key: "cost", render: (r) => formatCents(r.cost) },
                    { label: "Tokens", key: "tokens", render: (r) => (r.tokens || 0).toLocaleString() },
                    { label: "Calls", key: "calls" },
                ], data.cost_breakdown);
            }

            return html;
        },

        // ══════════════════════════════════════════════════
        //  WORKERS — unified children + health
        // ══════════════════════════════════════════════════
        async workers() {
            const data = await api("/workers");
            if (!data) return `<div class="empty">Unable to load workers</div>`;

            let html = `<div class="section-header"><span class="section-title">Workers (${data.length})</span></div>`;
            html += makeTable([
                { label: "Name", key: "name", render: (r) => `<a href="#child/${r.id}" style="color:var(--accent)">${esc(r.name || r.id.slice(0, 8))}</a>` },
                { label: "Health", key: "derived_status", render: (r) => stateBadge(r.derived_status) },
                { label: "DB Status", key: "db_status", render: (r) => statusBadge(r.db_status) },
                { label: "Runtime", key: "runtime", render: (r) => badge(r.runtime, r.runtime === "local" ? "yellow" : "green") },
                { label: "Silence", key: "silence_ms", render: (r) => r.silence_ms >= 0 ? formatMs(r.silence_ms) : "—" },
                { label: "Tasks", key: "tasks", render: (r) => r.tasks.length > 0 ? r.tasks.map(t => `${statusBadge(t.status)} ${esc(t.title?.slice(0, 30) || "")}`).join("<br>") : "—" },
                { label: "Spent", key: "total_spent_cents", render: (r) => formatCents(r.total_spent_cents) },
                { label: "Last Checked", key: "last_checked", render: (r) => timeAgo(r.last_checked) },
            ], data);
            return html;
        },

        // ══════════════════════════════════════════════════
        //  ECONOMY — merged Ledger + Economy
        // ══════════════════════════════════════════════════
        async economy() {
            const [econ, ledger] = await Promise.all([
                api("/economy/overview"),
                api("/spend?limit=200"),
            ]);

            let html = "";

            // Burn gauges
            if (econ) {
                html += `<div class="section-header"><span class="section-title">Burn Rate & Credits</span></div>`;
                html += `<div class="card-grid">
                    <div class="card"><div class="card-label">Credits Balance</div><div class="card-value">${formatCents(econ.credits_cents)}</div></div>
                    <div class="card"><div class="card-label">Burn / Min</div><div class="card-value" style="color:var(--red)">${formatCents(econ.burn_rate.per_minute_cents)}</div></div>
                    <div class="card"><div class="card-label">Time to Zero</div><div class="card-value">${econ.burn_rate.time_to_zero_minutes < 0 ? '∞' : econ.burn_rate.time_to_zero_minutes + 'm'}</div></div>
                    <div class="card"><div class="card-label">Last 24h</div><div class="card-value">${formatCents(econ.burn_rate.last_24h_cents)}</div></div>
                </div>`;

                // Per-model
                if (econ.by_model?.length > 0) {
                    html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Cost by Model (24h)</span></div>`;
                    html += makeTable([
                        { label: "Model", key: "model" },
                        { label: "Provider", key: "provider" },
                        { label: "Cost", key: "cost", render: (r) => formatCents(r.cost) },
                        { label: "In Tokens", key: "input_tokens", render: (r) => (r.input_tokens || 0).toLocaleString() },
                        { label: "Out Tokens", key: "output_tokens", render: (r) => (r.output_tokens || 0).toLocaleString() },
                        { label: "Calls", key: "calls" },
                    ], econ.by_model);
                }

                // Spend by tool
                if (econ.spend_by_tool?.length > 0) {
                    html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Spend by Tool</span></div>`;
                    html += makeTable([
                        { label: "Tool", key: "tool_name" },
                        { label: "Total", key: "total", render: (r) => formatCents(r.total) },
                        { label: "Count", key: "count" },
                    ], econ.spend_by_tool);
                }

                // Topups
                if (econ.topups?.length > 0) {
                    html += `<div class="section-header" style="margin-top:24px"><span class="section-title">On-chain Transactions</span></div>`;
                    html += makeTable([
                        { label: "Operation", key: "operation" },
                        { label: "Status", key: "status", render: (r) => statusBadge(r.status || "confirmed") },
                        { label: "Chain", key: "chain" },
                        { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
                    ], econ.topups);
                }
            }

            // Legacy ledger data
            if (ledger) {
                const txns = ledger.transactions || {};
                if (txns.all?.length > 0) {
                    html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Transaction History (${txns.all.length})</span></div>`;
                    html += makeTable([
                        {
                            label: "Type", key: "type", render: (r) => {
                                const m = { topup: "green", credit_purchase: "blue", transfer_in: "green", transfer_out: "yellow", x402_payment: "red", inference: "red" };
                                return badge(r.type, m[r.type] || "blue");
                            }
                        },
                        { label: "Amount", key: "amount_cents", render: (r) => formatCents(r.amount_cents) },
                        { label: "Balance After", key: "balance_after_cents", render: (r) => formatCents(r.balance_after_cents) },
                        { label: "Description", key: "description", render: (r) => esc((r.description || "").slice(0, 80)) },
                        { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
                    ], txns.all);
                }
            }

            return html || `<div class="empty">No economy data</div>`;
        },

        // ══════════════════════════════════════════════════
        //  ACTIVITY — turns + policy
        // ══════════════════════════════════════════════════
        async activity() {
            const [turns, policy] = await Promise.all([
                api("/turns?limit=30"),
                api("/policy?limit=30"),
            ]);

            let html = `<div class="section-header"><span class="section-title">Recent Turns</span></div>`;
            html += makeTable([
                { label: "ID", key: "id", render: (r) => esc((r.id || "").slice(0, 8)) },
                { label: "State", key: "state", render: (r) => stateBadge(r.state) },
                { label: "Input Source", key: "input_source" },
                { label: "Cost", key: "cost_cents", render: (r) => formatCents(r.cost_cents) },
                { label: "Time", key: "timestamp", render: (r) => timeAgo(r.timestamp) },
                {
                    label: "Tools", key: "tool_calls", render: (r) => {
                        try {
                            const tc = typeof r.tool_calls === "string" ? JSON.parse(r.tool_calls) : r.tool_calls;
                            return Array.isArray(tc) ? tc.map(t => t.name || t).join(", ") : "—";
                        } catch { return "—"; }
                    }
                },
                { label: "Detail", key: "_json", render: (r) => jsonBlock(r, "turn-" + (r.id || Math.random())) },
            ], turns || []);

            html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Policy Decisions</span></div>`;
            html += makeTable([
                { label: "Tool", key: "tool_name" },
                { label: "Decision", key: "decision", render: (r) => statusBadge(r.decision) },
                {
                    label: "Risk", key: "risk_level", render: (r) => {
                        const m = { low: "green", medium: "yellow", high: "red", critical: "red" };
                        return badge(r.risk_level, m[r.risk_level] || "blue");
                    }
                },
                { label: "Reason", key: "reason", render: (r) => esc((r.reason || "").slice(0, 80)) },
                { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
            ], policy || []);
            return html;
        },

        // ══════════════════════════════════════════════════
        //  DIAGNOSTICS — stalls, zombies, admin controls
        // ══════════════════════════════════════════════════
        async diagnostics() {
            const health = await api("/health/derived");
            if (!health) return `<div class="empty">Unable to load diagnostics</div>`;

            const s = health.summary;
            let html = `<div class="section-header"><span class="section-title">System Diagnostics</span></div>`;

            // Summary cards
            const sc = (val, color) => `<span style="font-size:28px;font-weight:700;color:var(--${color})">${val}</span>`;
            const dd = s.dispatch_deadlocks || 0;
            html += `<div class="card-grid">
                <div class="card" style="border-color:${s.critical_tasks > 0 ? 'var(--red)' : ''}">
                    <div class="card-label">Critical Tasks</div><div class="card-value">${sc(s.critical_tasks, s.critical_tasks > 0 ? "red" : "green")}</div></div>
                <div class="card" style="border-color:${dd > 0 ? 'var(--red)' : ''}">
                    <div class="card-label">Dispatch Deadlocks</div><div class="card-value">${sc(dd, dd > 0 ? "red" : "green")}</div>
                    <div class="card-sub">assigned but never started</div></div>
                <div class="card" style="border-color:${s.zombie_workers > 0 ? 'var(--red)' : ''}">
                    <div class="card-label">Zombie Workers</div><div class="card-value">${sc(s.zombie_workers, s.zombie_workers > 0 ? "red" : "green")}</div></div>
                <div class="card" style="border-color:${s.stalled_goals > 0 ? 'var(--yellow)' : ''}">
                    <div class="card-label">Stalled Goals</div><div class="card-value">${sc(s.stalled_goals, s.stalled_goals > 0 ? "yellow" : "green")}</div></div>
            </div>`;

            // Dispatch Deadlocks (dedicated section)
            const deadlocks = health.tasks.filter(t => t.severity === "dispatch_deadlock");
            if (deadlocks.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title" style="color:var(--red)">🔒 Dispatch Deadlocks (${deadlocks.length})</span></div>`;
                html += `<div class="card" style="border-color:var(--red);margin-bottom:16px"><div class="card-sub" style="color:var(--red)">These tasks were assigned to a worker but never started. The worker likely crashed or was restarted. Use "Requeue" to return them to pending for re-dispatch.</div></div>`;
                html += makeTable([
                    { label: "Title", key: "title" },
                    { label: "Status", key: "status", render: (r) => statusBadge(r.status) + ` ${badge("DEADLOCK", "red")}` },
                    { label: "Assigned To", key: "assigned_to", render: (r) => r.assigned_to ? `<code style="font-size:11px">${esc(r.assigned_to)}</code>` : "—" },
                    { label: "Dispatch Age", key: "dispatch_age_ms", render: (r) => `<strong style="color:var(--red)">${formatMs(r.dispatch_age_ms)}</strong>` },
                    {
                        label: "Actions", key: "_act", render: (r) => `<div style="display:flex;gap:4px">
                        <button class="btn" style="padding:2px 6px;font-size:11px;background:var(--accent)" onclick="window.__adminRequeue('${r.id}')">⟲ Requeue</button>
                        <button class="btn" style="padding:2px 6px;font-size:11px" onclick="window.__adminUnassign('${r.id}')">Unassign</button>
                        <button class="btn" style="padding:2px 6px;font-size:11px;background:var(--red)" onclick="window.__adminFail('${r.id}')">Fail</button>
                    </div>` },
                ], deadlocks);
            }

            // Other problem tasks (non-deadlock)
            const problemTasks = health.tasks.filter(t => t.severity !== "ok" && t.severity !== "dispatch_deadlock");
            if (problemTasks.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Problem Tasks</span></div>`;
                html += makeTable([
                    { label: "Title", key: "title" },
                    {
                        label: "Status", key: "status", render: (r) => {
                            let b = statusBadge(r.status);
                            if (r.timed_out) b += ` ${badge("TIMED OUT", "red")}`;
                            return b;
                        }
                    },
                    { label: "Worker", key: "assigned_to", render: (r) => r.assigned_to ? esc(r.assigned_to.slice(0, 25)) : "—" },
                    { label: "Run Age", key: "run_age_ms", render: (r) => r.run_age_ms != null ? `<strong style="color:var(--red)">${formatMs(r.run_age_ms)}</strong>` : "—" },
                    {
                        label: "Actions", key: "_act", render: (r) => `<div style="display:flex;gap:4px">
                        <button class="btn" style="padding:2px 6px;font-size:11px" onclick="window.__adminUnassign('${r.id}')">Unassign</button>
                        <button class="btn" style="padding:2px 6px;font-size:11px;background:var(--red)" onclick="window.__adminFail('${r.id}')">Mark Failed</button>
                    </div>` },
                ], problemTasks);
            }

            // Problem workers
            const problemWorkers = health.workers.filter(w => w.derived_status === "zombie" || w.derived_status === "stale");
            if (problemWorkers.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Problem Workers</span></div>`;
                html += makeTable([
                    { label: "Name", key: "name", render: (r) => esc(r.name || r.id.slice(0, 8)) },
                    { label: "Health", key: "derived_status", render: (r) => stateBadge(r.derived_status) },
                    { label: "Runtime", key: "runtime", render: (r) => badge(r.runtime, "blue") },
                    { label: "Silence", key: "silence_ms", render: (r) => `<strong style="color:var(--red)">${formatMs(r.silence_ms)}</strong>` },
                    { label: "Tasks", key: "assigned_tasks", render: (r) => (r.assigned_tasks || []).map(t => `${statusBadge(t.status)} ${esc(t.title)}`).join("<br>") || "—" },
                ], problemWorkers);
            }

            // Problem goals
            const problemGoals = health.goals.filter(g => g.derived_status !== "progressing");
            if (problemGoals.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Problem Goals</span></div>`;
                html += makeTable([
                    { label: "Title", key: "title", render: (r) => `<a href="#goal/${r.id}" style="color:var(--accent)">${esc(r.title)}</a>` },
                    { label: "Status", key: "derived_status", render: (r) => stateBadge(r.derived_status) },
                    { label: "Dispatch Fails", key: "dispatch_failures" },
                    { label: "Timed Out", key: "timed_out_tasks" },
                    { label: "Blocked", key: "blocked_tasks" },
                    { label: "Event Silence", key: "event_silence_ms", render: (r) => formatMs(r.event_silence_ms) },
                ], problemGoals);
            }

            if (problemTasks.length === 0 && problemWorkers.length === 0 && problemGoals.length === 0) {
                html += `<div class="empty" style="margin-top:24px;color:var(--green)">✓ All systems nominal. No stalls, zombies, or dispatch failures detected.</div>`;
            }

            // ── Debug Log — system snapshot for AI analysis ──
            html += `<div class="nav-separator" style="margin:32px 0 16px"></div>`;
            html += `<div class="section-header"><span class="section-title">📋 Debug Log — System Snapshot</span></div>`;
            html += `<div class="card-sub" style="margin-bottom:12px">
                Generate a plain-text snapshot of the entire system state. Copy and paste into an AI tool for error analysis.
            </div>`;
            html += `<div class="debug-log-toolbar">
                <div style="display:flex;gap:6px">
                    <button class="btn ${window.__debugMinutes === 2 ? 'active' : ''}" onclick="window.__loadDebugLog(2)">Last 2 min</button>
                    <button class="btn ${window.__debugMinutes === 5 || !window.__debugMinutes ? 'active' : ''}" onclick="window.__loadDebugLog(5)">Last 5 min</button>
                    <button class="btn ${window.__debugMinutes === 10 ? 'active' : ''}" onclick="window.__loadDebugLog(10)">Last 10 min</button>
                    <button class="btn ${window.__debugMinutes === 30 ? 'active' : ''}" onclick="window.__loadDebugLog(30)">Last 30 min</button>
                    <button class="btn ${window.__debugMinutes === 60 ? 'active' : ''}" onclick="window.__loadDebugLog(60)">Last 1 hour</button>
                </div>
                <button class="btn" onclick="window.__copyDebugLog()" id="copyDebugBtn" style="display:${window.__debugLogText ? 'inline-flex' : 'none'}">📋 Copy to Clipboard</button>
            </div>`;

            if (window.__debugLogText) {
                html += `<pre class="debug-log-viewer" id="debugLogContent">${esc(window.__debugLogText)}</pre>`;
            } else if (window.__debugLoading) {
                html += `<div class="debug-log-viewer" style="text-align:center;padding:40px;color:var(--text-muted)">Loading snapshot…</div>`;
            } else {
                html += `<div class="debug-log-viewer" style="text-align:center;padding:40px;color:var(--text-muted)">Click a time window button above to generate a snapshot</div>`;
            }

            return html;
        },

        // ══════════════════════════════════════════════════
        //  DB INSPECTOR
        // ══════════════════════════════════════════════════
        async db_inspector() {
            const table = window.__dbTable || "task_graph";
            const offset = window.__dbOffset || 0;
            const data = await api(`/db/${table}?offset=${offset}`);

            let html = `<div class="section-header" style="display:flex;justify-content:space-between;align-items:center">
                <span class="section-title">Database Inspector</span>
                <select class="btn" onchange="window.__switchDbTable(this.value)">`;

            const tables = ["goals", "task_graph", "children", "child_lifecycle_events", "turns", "tool_calls",
                "event_stream", "heartbeat_history", "inference_costs", "spend_tracking", "onchain_transactions",
                "child_ledger", "policy_decisions", "kv"];
            for (const t of tables) {
                html += `<option value="${t}" ${table === t ? "selected" : ""}>${t}</option>`;
            }
            html += `</select></div>`;

            if (!data || data.error) {
                return html + `<div class="empty">${data ? esc(data.error) : "Failed to load"}</div>`;
            }

            html += `<div class="card-sub" style="margin-bottom:12px">Rows ${offset}–${offset + data.limit} of ${data.total_rows}</div>`;

            if (data.data.length > 0) {
                const keys = Object.keys(data.data[0]);
                html += makeTable(keys.map(k => ({
                    label: k, key: k,
                    render: (r) => {
                        if (r[k] === null) return `<span style="color:var(--text-muted)">null</span>`;
                        const s = String(r[k]);
                        return s.length > 60 ? esc(s.slice(0, 60)) + "…" : esc(s);
                    }
                })), data.data);
            } else {
                html += `<div class="empty">Table is empty</div>`;
            }

            html += `<div style="display:flex;gap:8px;margin-top:16px">
                <button class="btn" onclick="window.__dbSetOffset(${Math.max(0, offset - data.limit)})" ${offset === 0 ? "disabled" : ""}>← Previous</button>
                <button class="btn" onclick="window.__dbSetOffset(${offset + data.limit})" ${(offset + data.limit) >= data.total_rows ? "disabled" : ""}>Next →</button>
            </div>`;
            return html;
        },

        // ══════════════════════════════════════════════════
        //  HEARTBEAT — keep existing
        // ══════════════════════════════════════════════════
        async heartbeat() {
            const data = await api("/heartbeat");
            if (!data) return `<div class="empty">Unable to load heartbeat data</div>`;
            let html = "";
            if (data.schedule?.length > 0) {
                html += `<div class="section-header"><span class="section-title">Schedule</span></div>`;
                html += makeTable([
                    { label: "Task", key: "task_name" },
                    { label: "Cron", key: "cron_expression" },
                    { label: "Enabled", key: "enabled", render: (r) => r.enabled ? badge("Yes", "green") : badge("No", "red") },
                    { label: "Next Run", key: "next_run_at", render: (r) => timeAgo(r.next_run_at) },
                    { label: "Last Run", key: "last_run_at", render: (r) => timeAgo(r.last_run_at) },
                    { label: "Runs", key: "run_count" },
                    { label: "Fails", key: "fail_count" },
                ], data.schedule);
            }
            if (data.history?.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">History</span></div>`;
                html += makeTable([
                    { label: "Task", key: "task_name" },
                    { label: "Result", key: "result", render: (r) => esc((r.result || "—").slice(0, 50)) },
                    { label: "Duration", key: "duration_ms", render: (r) => r.duration_ms != null ? r.duration_ms + "ms" : "—" },
                    { label: "Error", key: "error", render: (r) => r.error ? `<span style="color:var(--red)">${esc(r.error.slice(0, 50))}</span>` : "—" },
                    { label: "Started", key: "started_at", render: (r) => timeAgo(r.started_at) },
                ], data.history);
            }
            return html || `<div class="empty">No heartbeat data available</div>`;
        },

        // ══════════════════════════════════════════════════
        //  SOUL — keep existing
        // ══════════════════════════════════════════════════
        async soul() {
            const [soul, history] = await Promise.all([api("/soul"), api("/soul/history?limit=20")]);
            let html = "";
            if (soul?.content) {
                html += `<div class="section-header"><span class="section-title">Current SOUL.md</span></div>`;
                html += `<div class="card-sub" style="margin-bottom:12px">Source: ${esc(soul.source)} · Version: ${esc(soul.currentVersion)}</div>`;
                html += `<div class="soul-content">${esc(soul.content)}</div>`;
            } else html += `<div class="empty">No SOUL.md found</div>`;
            if (history?.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Soul History</span></div>`;
                html += makeTable([
                    { label: "Version", key: "version" },
                    { label: "Source", key: "change_source" },
                    { label: "Reason", key: "change_reason", render: (r) => esc((r.change_reason || "—").slice(0, 60)) },
                    { label: "Created", key: "created_at", render: (r) => timeAgo(r.created_at) },
                ], history);
            }
            return html;
        },

        // ══════════════════════════════════════════════════
        //  CONFIG — keep existing
        // ══════════════════════════════════════════════════
        async config() {
            const data = await api("/config");
            if (!data) return `<div class="empty">Unable to load config</div>`;
            let html = `<div class="section-header"><span class="section-title">Configuration</span></div>`;
            html += `<div class="card-grid">`;
            for (const key of Object.keys(data)) {
                const val = data[key];
                const display = typeof val === "object" && val !== null ? JSON.stringify(val, null, 2) : String(val);
                html += `<div class="card"><div class="card-label">${esc(key)}</div>
                    <div class="card-value" style="font-size:${display.length > 30 ? '11' : '14'}px;word-break:break-all">
                    ${val === "[REDACTED]" ? '<span style="color:var(--red)">[REDACTED]</span>' : esc(display)}
                    </div></div>`;
            }
            html += `</div>`;
            html += `<div style="margin-top:20px">${jsonBlock(data, "config-full")}</div>`;
            return html;
        },

        // ══════════════════════════════════════════════════
        //  SOCIAL — messaging, worker comms, inbox
        // ══════════════════════════════════════════════════
        async social() {
            const data = await api("/social");
            if (!data) return `<div class="empty">Unable to load social data</div>`;

            let html = "";

            // Stats cards
            const s = data.stats || {};
            html += `<div class="card-grid">
                <div class="card"><div class="card-label">📬 Inbox Total</div><div class="card-value">${s.inbox_total || 0}</div></div>
                <div class="card"><div class="card-label">⏳ Pending</div><div class="card-value" style="color:${s.inbox_pending > 0 ? 'var(--yellow)' : 'var(--green)'}">${s.inbox_pending || 0}</div></div>
                <div class="card"><div class="card-label">📝 Worker Logs</div><div class="card-value">${s.worker_logs || 0}</div></div>
                <div class="card"><div class="card-label">📡 Task Events</div><div class="card-value">${s.task_events || 0}</div></div>
                <div class="card"><div class="card-label">🔗 Active Channels</div><div class="card-value">${s.active_channels || 0}</div></div>
            </div>`;

            // Communication channels
            const channels = data.channels || [];
            if (channels.length > 0) {
                html += `<div class="section-header"><span class="section-title">🔗 Communication Channels</span></div>`;
                html += makeTable([
                    { label: "Name", key: "name", render: (r) => `<a href="#child/${r.address?.replace('local://', '')}" style="color:var(--accent)">${esc(r.name)}</a>` },
                    { label: "Address", key: "address", render: (r) => `<span style="font-family:var(--mono);font-size:11px">${esc((r.address || "").slice(0, 30))}</span>` },
                    { label: "Status", key: "status", render: (r) => statusBadge(r.status) },
                    { label: "Role", key: "role", render: (r) => badge(r.role || "generalist", "blue") },
                    { label: "Events", key: "event_count" },
                    { label: "Last Activity", key: "last_activity", render: (r) => r.last_activity ? timeAgo(r.last_activity) : "—" },
                ], channels);
            }

            // Worker event timeline (most important for debugging)
            const events = data.workerEvents || [];
            if (events.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">📡 Worker Event Stream (${events.length})</span></div>`;
                html += `<div class="worker-timeline">`;
                for (const ev of events.slice(0, 100)) {
                    const content = ev.content || "";
                    const evType = ev.type || "unknown";

                    let icon = "📋", color = "var(--text-muted)", cls = "";
                    if (evType === "task_completed") { icon = "✅"; color = "var(--green)"; cls = "success"; }
                    else if (evType === "task_failed") { icon = "❌"; color = "var(--red)"; cls = "error"; }
                    else if (evType === "task_assigned") { icon = "📤"; color = "var(--accent)"; cls = "spawn"; }
                    else if (content.includes("SPAWNED")) { icon = "🚀"; color = "var(--accent)"; cls = "spawn"; }
                    else if (content.includes("CLAIMED")) { icon = "✅"; color = "var(--green)"; cls = "success"; }
                    else if (content.includes("FAILED") || content.includes("CRASHED") || content.includes("ERROR")) { icon = "❌"; color = "var(--red)"; cls = "error"; }
                    else if (content.includes("Turn")) { icon = "🧠"; color = "#a78bfa"; cls = "inference"; }
                    else if (content.includes("COMPLETED") || content.includes("DONE")) { icon = "🎉"; color = "var(--green)"; cls = "success"; }
                    else if (content.includes("tool")) { icon = "🔧"; color = "#60a5fa"; cls = "tool"; }

                    const workerName = (ev.agent_address || "").replace("local://", "").slice(-12);

                    html += `<div class="wt-item ${cls}">
                        <div class="wt-icon" style="color:${color}">${icon}</div>
                        <div class="wt-body">
                            <div class="wt-header">
                                <span class="wt-turn-badge">${esc(workerName)}</span>
                                <span class="wt-type" style="color:${color}">${esc(evType)}</span>
                                <span class="wt-time">${timeAgo(ev.created_at)}</span>
                            </div>
                            <div class="wt-content">${esc(content.slice(0, 300))}</div>
                        </div>
                    </div>`;
                }
                html += `</div>`;
            } else {
                html += `<div class="empty" style="margin-top:24px">No worker events yet — workers haven't produced any logs</div>`;
            }

            // Inbox messages
            const inbox = data.inbox || [];
            if (inbox.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">📬 Inbox Messages (${inbox.length})</span></div>`;
                html += makeTable([
                    { label: "From", key: "from_address", render: (r) => `<span style="font-family:var(--mono);font-size:11px">${esc((r.from_address || "").slice(0, 20))}</span>` },
                    { label: "To", key: "to_address", render: (r) => r.to_address ? `<span style="font-family:var(--mono);font-size:11px">${esc(r.to_address.slice(0, 20))}</span>` : "—" },
                    { label: "Status", key: "status", render: (r) => statusBadge(r.status || "received") },
                    { label: "Content", key: "content", render: (r) => esc((r.content || "").slice(0, 100)) },
                    { label: "Received", key: "received_at", render: (r) => timeAgo(r.received_at) },
                ], inbox);
            } else {
                html += `<div class="empty" style="margin-top:24px">No inbox messages</div>`;
            }

            return html;
        },

        // ══════════════════════════════════════════════════
        //  CHILD DETAIL — keep tabbed detail view
        // ══════════════════════════════════════════════════
        async childDetail(id) {
            const [details, logs, resources, ledger] = await Promise.all([
                api("/children/" + id + "/details"),
                api("/children/" + id + "/logs?lines=200"),
                api("/children/" + id + "/resources"),
                api("/children/" + id + "/ledger"),
            ]);
            if (!details || details.error) return `<div class="empty">Child not found</div>`;

            const tab = window.__childTab || "overview";
            let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <div><span style="font-size:20px;font-weight:700">${esc(details.name)}</span>
                <span style="margin-left:12px">${statusBadge(details.status)}</span></div>
                <button class="btn btn-refresh" onclick="window.__refresh()">↻ Refresh</button>
            </div>`;

            const tabs = [
                { key: "overview", label: "Overview" },
                { key: "turns", label: "Turns" },
                { key: "logs", label: "Logs" },
                { key: "resources", label: "Resources" },
                { key: "ledger", label: "Ledger" },
            ];
            html += `<div class="tab-bar">`;
            for (const t of tabs) html += `<button class="tab-btn ${tab === t.key ? 'active' : ''}" onclick="window.__switchChildTab('${t.key}')">${t.label}</button>`;
            html += `</div><div id="childTabContent">`;

            if (tab === "overview") html += renderChildOverview(details);
            else if (tab === "turns") html += renderChildTurns(details);
            else if (tab === "logs") html += renderChildLogs(logs);
            else if (tab === "resources") html += renderChildResources(resources);
            else if (tab === "ledger") html += renderChildLedger(ledger);

            html += `</div>`;
            return html;
        },

        // ══════════════════════════════════════════════════
        //  CONWAY CLOUD — live infrastructure from Conway API
        // ══════════════════════════════════════════════════
        async conway_cloud() {
            const [status, sandboxes, creditsHistory, pricing] = await Promise.allSettled([
                api("/conway/status"),
                api("/conway/sandboxes"),
                api("/conway/credits/history?limit=30"),
                api("/conway/credits/pricing"),
            ]).then(results => results.map(r => r.status === "fulfilled" ? r.value : null));

            let html = "";

            // Connection status
            if (!status || !status.connected) {
                const reason = status?.reason || "Conway API proxy not configured";
                html += `<div class="card" style="border-color:var(--red);margin-bottom:16px">
                    <div class="card-label" style="color:var(--red)">⚠ Conway API Not Connected</div>
                    <div class="card-sub">${esc(reason)}</div>
                    <div class="card-sub" style="margin-top:8px">Set <code>CONWAY_API_KEY</code> environment variable on the VPS to enable live Conway data.</div>
                </div>`;
            } else {
                html += `<div class="card" style="border-color:var(--green);margin-bottom:16px">
                    <div class="card-label" style="color:var(--green)">✓ Conway API Connected</div>
                    <div class="card-sub">API: ${esc(status.api_url)}</div>
                    ${status.credits ? `<div class="card-sub">Live Balance: <strong>${formatCents(status.credits.creditsCents || 0)}</strong></div>` : ""}
                </div>`;
            }

            // Live Sandboxes
            html += `<div class="section-header"><span class="section-title">☁️ Conway Sandboxes (Live)</span></div>`;
            const sbxData = sandboxes?.data || sandboxes || [];
            if (Array.isArray(sbxData) && sbxData.length > 0) {
                html += makeTable([
                    { label: "ID", key: "id", render: (r) => `<code style="font-size:11px">${esc((r.short_id || r.id || "").slice(0, 20))}</code>` },
                    { label: "Name", key: "name", render: (r) => esc(r.name || "—") },
                    { label: "Status", key: "status", render: (r) => statusBadge(r.status) },
                    { label: "vCPU", key: "vcpu", render: (r) => r.vcpu || "—" },
                    { label: "RAM", key: "memory_mb", render: (r) => r.memory_mb ? `${r.memory_mb}MB` : "—" },
                    { label: "Disk", key: "disk_gb", render: (r) => r.disk_gb ? `${r.disk_gb}GB` : "—" },
                    { label: "Region", key: "region", render: (r) => esc(r.region || "—") },
                    { label: "Terminal", key: "terminal_url", render: (r) => r.terminal_url ? `<a href="${esc(r.terminal_url)}" target="_blank" style="color:var(--accent)">Open ↗</a>` : "—" },
                ], sbxData);
            } else if (sandboxes?.error) {
                html += `<div class="empty" style="color:var(--red)">${esc(sandboxes.error)}</div>`;
            } else {
                html += `<div class="empty">No sandboxes found. Padre hasn't created any Conway VMs (or API not connected).</div>`;
            }

            // Credits Transaction History
            html += `<div class="section-header" style="margin-top:24px"><span class="section-title">💳 Credits Transaction History (Conway)</span></div>`;
            const txns = creditsHistory?.data || creditsHistory || [];
            if (Array.isArray(txns) && txns.length > 0) {
                html += makeTable([
                    {
                        label: "Type", key: "type", render: (r) => {
                            const colors = { inference: "blue", topup: "green", credit_purchase: "green", transfer_out: "red", transfer_in: "green", sandbox: "yellow" };
                            return badge(r.type || "unknown", colors[r.type] || "blue");
                        }
                    },
                    {
                        label: "Amount", key: "amount", render: (r) => {
                            const cents = r.amount_cents || r.amount || 0;
                            const color = cents < 0 ? "var(--red)" : "var(--green)";
                            return `<span style="color:${color};font-weight:600">${formatCents(cents)}</span>`;
                        }
                    },
                    { label: "Description", key: "description", render: (r) => esc((r.description || r.model || "").slice(0, 60)) },
                    { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at || r.timestamp) },
                ], txns);
            } else if (creditsHistory?.error) {
                html += `<div class="empty" style="color:var(--red)">${esc(creditsHistory.error)}</div>`;
            } else {
                html += `<div class="empty">No transaction history available.</div>`;
            }

            // Pricing tiers
            if (pricing && !pricing.error) {
                const tiers = pricing?.data || pricing?.tiers || pricing || [];
                if (Array.isArray(tiers) && tiers.length > 0) {
                    html += `<div class="section-header" style="margin-top:24px"><span class="section-title">📊 VM Pricing Tiers</span></div>`;
                    html += makeTable([
                        { label: "vCPU", key: "vcpu" },
                        { label: "RAM", key: "memory_mb", render: (r) => r.memory_mb ? `${r.memory_mb}MB` : "—" },
                        { label: "Disk", key: "disk_gb", render: (r) => r.disk_gb ? `${r.disk_gb}GB` : "—" },
                        { label: "Cost/Month", key: "monthly_cost", render: (r) => r.monthly_cost ? `$${r.monthly_cost}` : formatCents(r.cost_cents) },
                    ], tiers);
                }
            }

            return html || `<div class="empty">Conway Cloud data unavailable</div>`;
        },
    };

    // ─── Child Tab Renderers (kept from original) ────────

    function renderChildOverview(d) {
        let h = `<div class="card-grid">
            <div class="card"><div class="card-label">ID</div><div class="card-value" style="font-size:12px">${esc(d.id)}</div></div>
            <div class="card"><div class="card-label">Address</div><div class="card-value" style="font-size:11px">${esc(d.address)}</div></div>
            <div class="card"><div class="card-label">Sandbox</div><div class="card-value" style="font-size:12px">${esc(d.sandbox_id)}</div></div>
            <div class="card"><div class="card-label">Status</div><div class="card-value">${statusBadge(d.status)}</div></div>
            <div class="card"><div class="card-label">Funded</div><div class="card-value">${formatCents(d.funded_amount_cents)}</div></div>
            <div class="card"><div class="card-label">Turn Count</div><div class="card-value">${d.turn_count || 0}</div></div>
            <div class="card"><div class="card-label">Total Spent</div><div class="card-value">${formatCents(d.total_spent_credits)}</div></div>
            <div class="card"><div class="card-label">Created</div><div class="card-value" style="font-size:13px">${timeAgo(d.created_at)}</div></div>
        </div>`;
        if (d.goal_title) {
            h += `<div class="card" style="margin-bottom:20px"><div class="card-label">🎯 Assigned Goal</div>
                <div class="card-value" style="font-size:15px">${esc(d.goal_title)}</div>
                <div class="card-sub">${d.goal_id ? esc(d.goal_id) : ""} · ${statusBadge(d.goal_status || "active")}</div></div>`;
        }
        if (d.current_task) {
            h += `<div class="card" style="margin-bottom:20px"><div class="card-label">📋 Current Task</div>
                <div class="card-value" style="font-size:14px">${esc(d.current_task.title)}</div>
                <div class="card-sub">Priority: ${d.current_task.priority} · ${statusBadge(d.current_task.status)}</div></div>`;
        }
        if (d.tools_used_last_5?.length > 0) {
            h += `<div class="card" style="margin-bottom:20px"><div class="card-label">🔧 Recent Tools</div>
                <div class="card-sub">${d.tools_used_last_5.map(t => badge(t, "blue")).join(" ")}</div></div>`;
        }
        if (d.lifecycle?.length > 0) {
            h += `<div class="section-header" style="margin-top:24px"><span class="section-title">Lifecycle</span></div><div class="timeline">`;
            for (const e of d.lifecycle.slice(0, 20)) {
                const cls = (e.to_state === "failed" || e.to_state === "unhealthy") ? "error" : (e.to_state === "healthy" || e.to_state === "funded") ? "success" : "";
                h += `<div class="timeline-item ${cls}"><strong>${esc(e.from_state)}</strong> → ${statusBadge(e.to_state)}
                    ${e.reason ? `<span style="margin-left:8px;color:var(--text-muted)">${esc(e.reason.slice(0, 80))}</span>` : ""}
                    <div class="timeline-ts">${timeAgo(e.created_at)}</div></div>`;
            }
            h += `</div>`;
        }
        return h;
    }

    function renderChildTurns(d) {
        let h = "";

        // ── Visual Event Timeline ──
        if (d.events?.length > 0) {
            h += `<div class="section-header"><span class="section-title">📡 Activity Timeline (${d.events.length})</span></div>`;
            h += `<div class="worker-timeline">`;
            for (const ev of d.events) {
                const content = ev.content || "";
                const evType = ev.type || "unknown";

                // Classify event for styling
                let icon = "📋", color = "var(--text-muted)", cls = "";
                if (content.includes("SPAWNED")) { icon = "🚀"; color = "var(--accent)"; cls = "spawn"; }
                else if (content.includes("CLAIMED")) { icon = "✅"; color = "var(--green)"; cls = "success"; }
                else if (content.includes("INFERENCE FAILED") || content.includes("CLAIM FAILED") || content.includes("ERROR") || content.includes("error")) { icon = "❌"; color = "var(--red)"; cls = "error"; }
                else if (content.includes("Turn") && content.includes("calling inference")) { icon = "🧠"; color = "#a78bfa"; cls = "inference"; }
                else if (content.includes("tool") || content.includes("exec") || content.includes("write_file") || content.includes("read_file")) { icon = "🔧"; color = "#60a5fa"; cls = "tool"; }
                else if (content.includes("COMPLETE") || content.includes("SUCCESS")) { icon = "🎉"; color = "var(--green)"; cls = "success"; }
                else if (evType === "worker_log") { icon = "📝"; color = "var(--text-muted)"; cls = "log"; }

                // Parse turn number from content
                const turnMatch = content.match(/Turn (\d+)\/(\d+)/);
                const turnLabel = turnMatch ? `<span class="wt-turn-badge">T${turnMatch[1]}/${turnMatch[2]}</span>` : "";

                // Format content for display
                let displayContent = content;
                // Strip redundant prefixes
                displayContent = displayContent.replace(/^(SPAWNED|CLAIMED|Turn \d+\/\d+)\s*[-—]\s*/, "");

                h += `<div class="wt-item ${cls}">
                    <div class="wt-icon" style="color:${color}">${icon}</div>
                    <div class="wt-body">
                        <div class="wt-header">
                            ${turnLabel}
                            <span class="wt-type" style="color:${color}">${esc(evType)}</span>
                            <span class="wt-time">${timeAgo(ev.created_at)}</span>
                        </div>
                        <div class="wt-content">${esc(displayContent.slice(0, 300))}</div>
                        ${ev.token_count ? `<div class="wt-tokens">${ev.token_count} tokens</div>` : ""}
                    </div>
                </div>`;
            }
            h += `</div>`;
        }

        // ── Tasks section ──
        if (d.tasks?.length > 0) {
            h += `<div class="section-header" style="margin-top:24px"><span class="section-title">📋 Assigned Tasks</span></div>`;
            h += makeTable([
                { label: "Title", key: "title" },
                { label: "Status", key: "status", render: (r) => statusBadge(r.status) },
                { label: "Priority", key: "priority" },
                { label: "Cost", key: "actual_cost_cents", render: (r) => formatCents(r.actual_cost_cents) },
            ], d.tasks);
        }
        return h || `<div class="empty">No activity data</div>`;
    }

    function renderChildLogs(data) {
        if (!data) return `<div class="empty">Unable to load logs</div>`;
        if (!data.available) return `<div class="card" style="background:var(--bg-input)"><div class="card-label">📄 Logs</div><div class="card-sub">${esc(data.message || "Logs unavailable")}</div></div>`;
        let h = `<div class="card-sub" style="margin-bottom:12px">Source: <strong>${esc(data.source)}</strong> · ${data.totalMatches} matches</div>`;
        if (data.lines.length === 0) return h + `<div class="empty">No log entries found</div>`;

        h += `<div class="worker-log-viewer">`;
        for (const line of data.lines) {
            // Try to parse JSON log entries
            let parsed = null;
            const jsonMatch = (line.raw || "").match(/\{.*"message".*\}/);
            if (jsonMatch) {
                try { parsed = JSON.parse(jsonMatch[0]); } catch { /* not JSON */ }
            }

            if (parsed) {
                const lvl = parsed.level || "info";
                const lvlColor = lvl === "error" ? "var(--red)" : lvl === "warn" ? "var(--yellow)" : "var(--text-muted)";
                const msg = parsed.message || "";
                const mod = parsed.module || "";

                h += `<div class="wlog-entry ${lvl === "error" ? "wlog-error" : lvl === "warn" ? "wlog-warn" : ""}">
                    <span class="wlog-time">${esc(parsed.timestamp ? parsed.timestamp.slice(11, 19) : "")}</span>
                    <span class="wlog-level" style="color:${lvlColor}">${esc(lvl.toUpperCase())}</span>
                    ${mod ? `<span class="wlog-module">${esc(mod)}</span>` : ""}
                    <span class="wlog-msg">${esc(msg.slice(0, 200))}</span>
                </div>`;
            } else {
                h += `<div class="wlog-entry"><span class="wlog-time">${line.timestamp ? esc(line.timestamp.slice(11, 19)) : ""}</span><span class="wlog-msg">${esc((line.raw || "").slice(0, 200))}</span></div>`;
            }
        }
        return h + `</div>`;
    }

    function renderChildResources(data) {
        if (!data) return `<div class="empty">Unable to load resources</div>`;
        if (data.error) return `<div class="empty">${esc(data.error)}</div>`;
        return `<div class="card-grid">
            <div class="card"><div class="card-label">Status</div><div class="card-value">${statusBadge(data.status)}</div></div>
            <div class="card"><div class="card-label">Uptime</div><div class="card-value">${data.uptime_seconds != null ? Math.floor(data.uptime_seconds / 60) + "m" : "—"}</div></div>
            <div class="card"><div class="card-label">Restarts</div><div class="card-value">${data.restart_count ?? "—"}</div></div>
            <div class="card"><div class="card-label">State Transitions</div><div class="card-value">${data.totalStateTransitions || 0}</div></div>
        </div>`;
    }

    function renderChildLedger(data) {
        if (!data) return `<div class="empty">Unable to load ledger</div>`;
        if (data.error) return `<div class="empty">${esc(data.error)}</div>`;
        let h = `<div class="card-grid"><div class="card"><div class="card-label">Initial Funding</div><div class="card-value">${formatCents(data.funding?.funded_amount_cents)}</div></div></div>`;
        if (data.transactions?.length > 0) {
            h += `<div class="section-header" style="margin-top:24px"><span class="section-title">Transactions (${data.transactions.length})</span></div>`;
            h += makeTable([
                { label: "Type", key: "type", render: (r) => badge(r.type, r.type === "topup" ? "green" : "blue") },
                { label: "Amount", key: "amount_cents", render: (r) => formatCents(r.amount_cents) },
                { label: "Description", key: "description", render: (r) => esc((r.description || "").slice(0, 80)) },
                { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
            ], data.transactions);
        }
        return h;
    }

    // ─── Child/Goal Tab Switching ────────────────────────
    window.__childTab = "overview";
    window.__switchChildTab = (tab) => { window.__childTab = tab; navigate(); };

    // ─── DB Inspector State ─────────────────────────────
    window.__dbTable = "task_graph";
    window.__dbOffset = 0;
    window.__dbSetOffset = (o) => { window.__dbOffset = o; navigate(); };
    window.__switchDbTable = (t) => { window.__dbTable = t; window.__dbOffset = 0; navigate(); };

    // ─── Debug Log State ────────────────────────────────
    window.__debugLogText = "";
    window.__debugMinutes = 0;
    window.__debugLoading = false;

    window.__loadDebugLog = async (minutes) => {
        window.__debugMinutes = minutes;
        window.__debugLoading = true;
        window.__debugLogText = "";
        navigate(); // re-render to show loading state
        try {
            const resp = await fetch(`/api/diagnostics/snapshot?minutes=${minutes}`);
            window.__debugLogText = await resp.text();
        } catch (err) {
            window.__debugLogText = `Error loading snapshot: ${err.message}`;
        }
        window.__debugLoading = false;
        navigate(); // re-render with content
    };

    window.__copyDebugLog = async () => {
        try {
            await navigator.clipboard.writeText(window.__debugLogText);
            const btn = document.getElementById("copyDebugBtn");
            if (btn) {
                btn.textContent = "✓ Copied!";
                setTimeout(() => { btn.textContent = "📋 Copy to Clipboard"; }, 2000);
            }
        } catch {
            // Fallback for older browsers
            const ta = document.createElement("textarea");
            ta.value = window.__debugLogText;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            const btn = document.getElementById("copyDebugBtn");
            if (btn) {
                btn.textContent = "✓ Copied!";
                setTimeout(() => { btn.textContent = "📋 Copy to Clipboard"; }, 2000);
            }
        }
    };

    // ─── Router ─────────────────────────────────────────

    function getRoute() {
        const hash = window.location.hash.slice(1) || "overview";
        if (hash.startsWith("child/")) return { section: "childDetail", param: hash.slice(6) };
        if (hash.startsWith("goal/")) return { section: "goalDetail", param: hash.slice(5) };
        return { section: hash, param: null };
    }

    async function navigate() {
        const { section, param } = getRoute();
        currentSection = section;

        if (section !== "childDetail") window.__childTab = "overview";

        $$(".nav-link").forEach((el) => {
            el.classList.toggle("active", el.dataset.section === section);
        });

        const titles = {
            overview: "Overview",
            goals: "Goals",
            goalDetail: "Goal Detail",
            workers: "Workers",
            economy: "Economy",
            activity: "Activity",
            diagnostics: "Diagnostics",
            db_inspector: "DB Inspector",
            heartbeat: "Heartbeat",
            soul: "Soul",
            config: "Config",
            social: "Social",
            childDetail: "Child Detail",
            conway_cloud: "Conway Cloud",
        };
        $("#pageTitle").textContent = titles[section] || section;

        const content = $("#content");
        content.innerHTML = `<div class="loading">Loading…</div>`;

        const renderFn = sections[section];
        if (!renderFn) {
            content.innerHTML = `<div class="empty">Unknown section: ${esc(section)}</div>`;
            return;
        }

        try {
            content.innerHTML = await renderFn(param);
        } catch (err) {
            content.innerHTML = `<div class="empty">Error: ${esc(err.message)}</div>`;
        }
    }

    // ─── Refresh ────────────────────────────────────────
    window.__refresh = () => navigate();

    // ─── Health Check ───────────────────────────────────
    async function checkHealth() {
        try {
            const data = await api("/health");
            const b = $("#connBadge");
            const t = $("#connText");
            if (data?.ok) {
                b.className = "connection-badge connected";
                t.textContent = "Connected";
            } else {
                b.className = "connection-badge disconnected";
                t.textContent = "Disconnected";
            }
        } catch {
            $("#connBadge").className = "connection-badge disconnected";
            $("#connText").textContent = "Disconnected";
        }
    }

    // ─── Init ───────────────────────────────────────────
    window.addEventListener("hashchange", navigate);
    checkHealth();
    navigate();
})();
