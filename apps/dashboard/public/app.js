/**
 * Automaton Dashboard — Frontend Application
 *
 * Vanilla JS, hash-based routing, manual refresh only.
 * No polling, no websockets, no SSE.
 */

(function () {
    "use strict";

    // ─── State ──────────────────────────────────────────
    let currentSection = "status";

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
        };
        return badge(state, map[state] || "blue");
    }

    function statusBadge(status) {
        const map = {
            alive: "green", active: "green", running: "green",
            spawning: "blue", starting: "blue",
            dead: "red", failed: "red", stopped: "red",
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

    // Expose for inline onclick
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

    // ─── Sections ───────────────────────────────────────

    const sections = {
        // ── Status ──
        async status() {
            const data = await api("/status");
            if (!data) return `<div class="empty">Unable to load status</div>`;
            return `
        <div class="card-grid">
          <div class="card">
            <div class="card-label">Agent State</div>
            <div class="card-value">${stateBadge(data.agentState)}</div>
          </div>
          <div class="card">
            <div class="card-label">Credits Balance</div>
            <div class="card-value">${esc(data.creditsBalance || "—")}</div>
          </div>
          <div class="card">
            <div class="card-label">USDC Balance</div>
            <div class="card-value">${esc(data.usdcBalance || "—")}</div>
          </div>
          <div class="card">
            <div class="card-label">Survival Tier</div>
            <div class="card-value">${esc(data.survivalTier || "—")}</div>
          </div>
          <div class="card">
            <div class="card-label">Current Model</div>
            <div class="card-value" style="font-size:16px">${esc(data.currentModel || "—")}</div>
          </div>
          <div class="card">
            <div class="card-label">Last Turn</div>
            <div class="card-value" style="font-size:14px">${timeAgo(data.lastTurnTimestamp)}</div>
            <div class="card-sub">${esc(data.lastTurnTimestamp || "")}</div>
          </div>
          <div class="card">
            <div class="card-label">Total Turns</div>
            <div class="card-value">${esc(data.turnCount)}</div>
          </div>
          <div class="card">
            <div class="card-label">Dashboard Uptime</div>
            <div class="card-value">${Math.floor(data.uptime / 60)}m</div>
          </div>
        </div>
        <div class="card">
          <div class="card-label">Database</div>
          <div class="card-value">${data.dbConnected ? badge("Connected", "green") : badge("Disconnected", "red")}</div>
        </div>`;
        },

        // ── Children ──
        async children() {
            const data = await api("/children");
            if (!data) return `<div class="empty">Unable to load children</div>`;
            return makeTable(
                [
                    { label: "ID", key: "id", render: (r) => `<a href="#child/${r.id}" style="color:var(--accent)">${esc(r.id?.slice(0, 8))}…</a>` },
                    { label: "Name", key: "name" },
                    { label: "Status", key: "status", render: (r) => statusBadge(r.status) },
                    { label: "Address", key: "address", render: (r) => esc((r.address || "").slice(0, 10)) + "…" },
                    { label: "Funded", key: "funded_amount_cents", render: (r) => formatCents(r.funded_amount_cents) },
                    { label: "Created", key: "created_at", render: (r) => timeAgo(r.created_at) },
                    { label: "Last Checked", key: "last_checked", render: (r) => timeAgo(r.last_checked) },
                ],
                data
            );
        },

        // ── Child Detail (Tabbed — Phase 6) ──
        async childDetail(id) {
            // Load all data in parallel
            const [details, logs, resources, ledger] = await Promise.all([
                api("/children/" + id + "/details"),
                api("/children/" + id + "/logs?lines=200"),
                api("/children/" + id + "/resources"),
                api("/children/" + id + "/ledger"),
            ]);

            if (!details || details.error) return `<div class="empty">Child not found</div>`;

            // Remember current tab
            const tab = window.__childTab || "overview";

            // ── Build Header ──
            let html = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div>
            <span style="font-size:20px;font-weight:700">${esc(details.name)}</span>
            <span style="margin-left:12px">${statusBadge(details.status)}</span>
            ${details.role ? `<span style="margin-left:8px">${badge(details.role, "blue")}</span>` : ""}
          </div>
          <div class="auto-refresh-wrap">
            <button class="btn btn-auto ${window.__autoRefresh ? 'on' : ''}" onclick="window.__toggleAutoRefresh()">
              Auto ↻ ${window.__autoRefresh ? 'ON' : 'OFF'}
            </button>
            <button class="btn btn-refresh" onclick="window.__refresh()">↻ Refresh</button>
          </div>
        </div>`;

            // ── Tab Bar ──
            const tabs = [
                { key: "overview", label: "Overview" },
                { key: "turns", label: "Turns" },
                { key: "logs", label: "Logs" },
                { key: "resources", label: "Resources" },
                { key: "ledger", label: "Ledger" },
            ];
            html += `<div class="tab-bar">`;
            for (const t of tabs) {
                html += `<button class="tab-btn ${tab === t.key ? 'active' : ''}" onclick="window.__switchChildTab('${t.key}')">${t.label}</button>`;
            }
            html += `</div>`;

            // ── Tab Content ──
            html += `<div id="childTabContent">`;

            if (tab === "overview") {
                html += renderChildOverview(details);
            } else if (tab === "turns") {
                html += renderChildTurns(details);
            } else if (tab === "logs") {
                html += renderChildLogs(logs);
            } else if (tab === "resources") {
                html += renderChildResources(resources);
            } else if (tab === "ledger") {
                html += renderChildLedger(ledger);
            }

            html += `</div>`;
            return html;
        },

        // ── Activity ──
        async activity() {
            const [turns, policy] = await Promise.all([
                api("/turns?limit=30"),
                api("/policy?limit=30"),
            ]);

            let html = `<div class="section-header"><span class="section-title">Recent Turns</span></div>`;
            html += makeTable(
                [
                    { label: "ID", key: "id", render: (r) => esc((r.id || "").slice(0, 8)) },
                    { label: "State", key: "state", render: (r) => stateBadge(r.state) },
                    { label: "Input Source", key: "input_source" },
                    { label: "Cost", key: "cost_cents", render: (r) => formatCents(r.cost_cents) },
                    { label: "Timestamp", key: "timestamp", render: (r) => timeAgo(r.timestamp) },
                    {
                        label: "Tools", key: "tool_calls", render: (r) => {
                            try {
                                const tc = typeof r.tool_calls === "string" ? JSON.parse(r.tool_calls) : r.tool_calls;
                                return Array.isArray(tc) ? tc.map(t => t.name || t).join(", ") : "—";
                            } catch { return "—"; }
                        }
                    },
                    { label: "Detail", key: "_json", render: (r, i) => jsonBlock(r, "turn-" + (r.id || Math.random())) },
                ],
                turns || []
            );

            html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Policy Decisions</span></div>`;
            html += makeTable(
                [
                    { label: "Tool", key: "tool_name" },
                    { label: "Decision", key: "decision", render: (r) => statusBadge(r.decision) },
                    {
                        label: "Risk", key: "risk_level", render: (r) => {
                            const m = { low: "green", medium: "yellow", high: "red", critical: "red" };
                            return badge(r.risk_level, m[r.risk_level] || "blue");
                        }
                    },
                    { label: "Reason", key: "reason", render: (r) => esc((r.reason || "").slice(0, 80)) },
                    { label: "Latency", key: "latency_ms", render: (r) => r.latency_ms != null ? r.latency_ms + "ms" : "—" },
                    { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
                ],
                policy || []
            );

            return html;
        },

        // ── Heartbeat ──
        async heartbeat() {
            const data = await api("/heartbeat");
            if (!data) return `<div class="empty">Unable to load heartbeat data</div>`;

            let html = "";

            if (data.schedule && data.schedule.length > 0) {
                html += `<div class="section-header"><span class="section-title">Schedule</span></div>`;
                html += makeTable(
                    [
                        { label: "Task", key: "task_name" },
                        { label: "Cron", key: "cron_expression" },
                        { label: "Enabled", key: "enabled", render: (r) => r.enabled ? badge("Yes", "green") : badge("No", "red") },
                        { label: "Priority", key: "priority" },
                        { label: "Next Run", key: "next_run_at", render: (r) => timeAgo(r.next_run_at) },
                        { label: "Last Run", key: "last_run_at", render: (r) => timeAgo(r.last_run_at) },
                        { label: "Last Result", key: "last_result", render: (r) => esc((r.last_result || "—").slice(0, 40)) },
                        { label: "Runs", key: "run_count" },
                        { label: "Fails", key: "fail_count" },
                    ],
                    data.schedule
                );
            }

            if (data.entries && data.entries.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Legacy Entries</span></div>`;
                html += makeTable(
                    [
                        { label: "Name", key: "name" },
                        { label: "Schedule", key: "schedule" },
                        { label: "Task", key: "task" },
                        { label: "Enabled", key: "enabled", render: (r) => r.enabled ? badge("Yes", "green") : badge("No", "red") },
                        { label: "Last Run", key: "last_run", render: (r) => timeAgo(r.last_run) },
                        { label: "Next Run", key: "next_run", render: (r) => timeAgo(r.next_run) },
                    ],
                    data.entries
                );
            }

            if (data.history && data.history.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Recent History</span></div>`;
                html += makeTable(
                    [
                        { label: "Task", key: "task_name" },
                        { label: "Result", key: "result", render: (r) => esc((r.result || "—").slice(0, 50)) },
                        { label: "Duration", key: "duration_ms", render: (r) => r.duration_ms != null ? r.duration_ms + "ms" : "—" },
                        { label: "Error", key: "error", render: (r) => r.error ? `<span style="color:var(--red)">${esc(r.error.slice(0, 50))}</span>` : "—" },
                        { label: "Started", key: "started_at", render: (r) => timeAgo(r.started_at) },
                    ],
                    data.history
                );
            }

            if (!html) html = `<div class="empty">No heartbeat data available</div>`;
            return html;
        },

        // ── Ledger ──
        async ledger() {
            const data = await api("/spend?limit=200");
            if (!data) return `<div class="empty">Unable to load ledger data</div>`;

            let html = "";

            // ── Balances ──────────────────────────────────────
            const b = data.balances || {};
            html += `<div class="section-header"><span class="section-title">Current Balances</span></div>`;
            html += `<div class="card-grid">`;
            html += `<div class="card">
              <div class="card-label">Credits Balance</div>
              <div class="card-value">${b.credits ? esc(b.credits.value) : "—"}</div>
              ${b.credits ? `<div class="card-sub">Updated ${timeAgo(b.credits.updatedAt)}</div>` : ""}
            </div>`;
            html += `<div class="card">
              <div class="card-label">USDC Balance</div>
              <div class="card-value">${b.usdc ? esc(b.usdc.value) : "—"}</div>
              ${b.usdc ? `<div class="card-sub">Updated ${timeAgo(b.usdc.updatedAt)}</div>` : ""}
            </div>`;
            html += `<div class="card">
              <div class="card-label">Survival Tier</div>
              <div class="card-value">${b.survivalTier ? stateBadge(b.survivalTier.value) : "—"}</div>
            </div>`;
            html += `<div class="card">
              <div class="card-label">Last Auto-Topup</div>
              <div class="card-value" style="font-size:13px">${b.lastTopupAttempt ? timeAgo(b.lastTopupAttempt.value) : "—"}</div>
            </div>`;
            html += `</div>`;

            // ── Topups ────────────────────────────────────────
            const txns = data.transactions || {};
            if (txns.topups && txns.topups.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">💳 Topups & Credit Purchases</span></div>`;
                html += makeTable(
                    [
                        { label: "Type", key: "type", render: (r) => badge(r.type, r.type === "topup" ? "green" : "blue") },
                        { label: "Amount", key: "amount_cents", render: (r) => formatCents(r.amount_cents) },
                        { label: "Balance After", key: "balance_after_cents", render: (r) => formatCents(r.balance_after_cents) },
                        { label: "Description", key: "description", render: (r) => esc((r.description || "").slice(0, 60)) },
                        { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
                    ],
                    txns.topups
                );
            }

            // ── Transfers ─────────────────────────────────────
            if (txns.transfers && txns.transfers.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">🔄 Transfers</span></div>`;
                html += makeTable(
                    [
                        { label: "Type", key: "type", render: (r) => badge(r.type, r.type === "transfer_in" ? "green" : "yellow") },
                        { label: "Amount", key: "amount_cents", render: (r) => formatCents(r.amount_cents) },
                        { label: "Balance After", key: "balance_after_cents", render: (r) => formatCents(r.balance_after_cents) },
                        { label: "Description", key: "description", render: (r) => esc((r.description || "").slice(0, 60)) },
                        { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
                    ],
                    txns.transfers
                );
            }

            // ── Payments ──────────────────────────────────────
            if (txns.payments && txns.payments.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">💸 Payments</span></div>`;
                html += makeTable(
                    [
                        { label: "Type", key: "type", render: (r) => badge(r.type, "red") },
                        { label: "Amount", key: "amount_cents", render: (r) => formatCents(r.amount_cents) },
                        { label: "Balance After", key: "balance_after_cents", render: (r) => formatCents(r.balance_after_cents) },
                        { label: "Description", key: "description", render: (r) => esc((r.description || "").slice(0, 60)) },
                        { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
                    ],
                    txns.payments
                );
            }

            // ── All Transactions (unified timeline) ───────────
            if (txns.all && txns.all.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">📜 All Transactions (${txns.all.length})</span></div>`;
                html += makeTable(
                    [
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
                        { label: "Detail", key: "_j", render: (r) => jsonBlock(r, "txn-" + (r.id || Math.random())) },
                    ],
                    txns.all
                );
            }

            // ── Spend Tracking ────────────────────────────────
            const st = data.spendTracking || {};
            if (st.dailyTotals && st.dailyTotals.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">📅 Daily Spend Totals</span></div>`;
                html += makeTable(
                    [
                        { label: "Day", key: "window_day" },
                        { label: "Total", key: "total_cents", render: (r) => formatCents(r.total_cents) },
                        { label: "Records", key: "count" },
                    ],
                    st.dailyTotals
                );
            }

            if (st.records && st.records.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">🧾 Spend Records</span></div>`;
                html += makeTable(
                    [
                        { label: "Tool", key: "tool_name" },
                        { label: "Amount", key: "amount_cents", render: (r) => formatCents(r.amount_cents) },
                        {
                            label: "Category", key: "category", render: (r) => {
                                const m = { transfer: "yellow", x402: "red", inference: "blue", other: "blue" };
                                return badge(r.category, m[r.category] || "blue");
                            }
                        },
                        { label: "Recipient", key: "recipient", render: (r) => esc((r.recipient || "—").slice(0, 20)) },
                        { label: "Domain", key: "domain" },
                        { label: "Day", key: "window_day" },
                    ],
                    st.records
                );
            }

            // ── Inference Costs ───────────────────────────────
            const inf = data.inference || {};
            if (inf.modelBreakdown && inf.modelBreakdown.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">🤖 Inference Cost by Model</span></div>`;
                html += makeTable(
                    [
                        { label: "Model", key: "model" },
                        { label: "Provider", key: "provider" },
                        { label: "Total Cost", key: "total_cents", render: (r) => formatCents(r.total_cents) },
                        { label: "Input Tokens", key: "total_input_tokens", render: (r) => (r.total_input_tokens || 0).toLocaleString() },
                        { label: "Output Tokens", key: "total_output_tokens", render: (r) => (r.total_output_tokens || 0).toLocaleString() },
                        { label: "Calls", key: "call_count" },
                    ],
                    inf.modelBreakdown
                );
            }

            if (inf.dailySummary && inf.dailySummary.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">📊 Inference Daily Summary</span></div>`;
                html += makeTable(
                    [
                        { label: "Day", key: "day" },
                        { label: "Total Cost", key: "total_cents", render: (r) => formatCents(r.total_cents) },
                        { label: "Input Tokens", key: "total_input_tokens", render: (r) => (r.total_input_tokens || 0).toLocaleString() },
                        { label: "Output Tokens", key: "total_output_tokens", render: (r) => (r.total_output_tokens || 0).toLocaleString() },
                        { label: "Calls", key: "call_count" },
                    ],
                    inf.dailySummary
                );
            }

            if (inf.costs && inf.costs.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">📋 Recent Inference Calls</span></div>`;
                html += makeTable(
                    [
                        { label: "Model", key: "model" },
                        { label: "Cost", key: "cost_cents", render: (r) => formatCents(r.cost_cents) },
                        { label: "In Tokens", key: "input_tokens", render: (r) => (r.input_tokens || 0).toLocaleString() },
                        { label: "Out Tokens", key: "output_tokens", render: (r) => (r.output_tokens || 0).toLocaleString() },
                        { label: "Latency", key: "latency_ms", render: (r) => r.latency_ms != null ? r.latency_ms + "ms" : "—" },
                        { label: "Task", key: "task_type" },
                        { label: "Tier", key: "tier" },
                        { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
                    ],
                    inf.costs
                );
            }

            // ── On-chain Transactions ─────────────────────────
            if (data.onchain && data.onchain.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">⛓️ On-chain Transactions</span></div>`;
                html += makeTable(
                    [
                        { label: "Tx Hash", key: "tx_hash", render: (r) => esc((r.tx_hash || "").slice(0, 14)) + "…" },
                        { label: "Chain", key: "chain" },
                        { label: "Operation", key: "operation" },
                        {
                            label: "Status", key: "status", render: (r) => {
                                const m = { confirmed: "green", pending: "yellow", failed: "red" };
                                return badge(r.status, m[r.status] || "blue");
                            }
                        },
                        { label: "Gas", key: "gas_used" },
                        { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
                    ],
                    data.onchain
                );
            }

            // ── Children Funding ──────────────────────────────
            if (data.childrenFunding && data.childrenFunding.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">🧬 Children Funding</span></div>`;
                html += makeTable(
                    [
                        { label: "Name", key: "name" },
                        { label: "Status", key: "status", render: (r) => statusBadge(r.status) },
                        { label: "Funded", key: "funded_amount_cents", render: (r) => formatCents(r.funded_amount_cents) },
                        { label: "Created", key: "created_at", render: (r) => timeAgo(r.created_at) },
                    ],
                    data.childrenFunding
                );
            } else {
                html += `<div class="card" style="margin-top:24px;background:var(--bg-input);border-color:var(--yellow)">
                  <div class="card-label" style="color:var(--yellow)">⚠ Children Ledger</div>
                  <div class="card-sub">No children found. Child-specific ledger will appear once children are spawned.</div>
                </div>`;
            }

            // ── Log-Derived Events ────────────────────────────
            const ld = data.logDerived || {};
            if (ld.available && ld.events && ld.events.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">📄 Log-Derived Topup Events (${ld.totalMatches} total)</span></div>`;
                html += `<div class="card-sub" style="margin-bottom:12px;color:var(--yellow)">Source: ${esc(ld.path)} · These events are parsed from PM2 logs as a fallback</div>`;
                html += makeTable(
                    [
                        { label: "Source", key: "source", render: (r) => badge(r.source, "yellow") },
                        { label: "Type", key: "subtype", render: (r) => badge(r.subtype, "blue") },
                        { label: "Amount USD", key: "amountUsd", render: (r) => r.amountUsd != null ? "$" + r.amountUsd : "—" },
                        { label: "Credits ¢", key: "creditsCents" },
                        { label: "Detail", key: "detail", render: (r) => esc((r.detail || "").slice(0, 80)) },
                        { label: "Timestamp", key: "timestamp", render: (r) => timeAgo(r.timestamp) },
                    ],
                    ld.events
                );
            } else if (ld.available === false) {
                html += `<div class="card" style="margin-top:24px;background:var(--bg-input);border-color:var(--text-muted)">
                  <div class="card-label">Log Fallback</div>
                  <div class="card-sub">${esc(ld.message || "PM2 logs not available on this machine")}</div>
                </div>`;
            }

            // Nothing at all?
            const hasAny = (txns.all && txns.all.length) || (st.records && st.records.length)
                || (inf.costs && inf.costs.length) || (data.onchain && data.onchain.length)
                || (ld.events && ld.events.length);
            if (!hasAny && !b.credits) {
                html += `<div class="empty" style="margin-top:24px">No financial data found in any source. The database may not have recorded any transactions yet.</div>`;
            }

            return html;
        },

        // ── Soul ──
        async soul() {
            const [soul, history] = await Promise.all([
                api("/soul"),
                api("/soul/history?limit=20"),
            ]);

            let html = "";

            if (soul && soul.content) {
                html += `<div class="section-header"><span class="section-title">Current SOUL.md</span></div>`;
                html += `<div class="card-sub" style="margin-bottom:12px">Source: ${esc(soul.source)} · Version: ${esc(soul.currentVersion)}</div>`;
                html += `<div class="soul-content">${esc(soul.content)}</div>`;
            } else {
                html += `<div class="empty">No SOUL.md found</div>`;
            }

            if (history && history.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Soul History</span></div>`;
                html += makeTable(
                    [
                        { label: "Version", key: "version" },
                        { label: "Source", key: "change_source" },
                        { label: "Reason", key: "change_reason", render: (r) => esc((r.change_reason || "—").slice(0, 60)) },
                        { label: "Hash", key: "content_hash", render: (r) => esc((r.content_hash || "").slice(0, 12)) },
                        { label: "Approved By", key: "approved_by", render: (r) => esc((r.approved_by || "—").slice(0, 12)) },
                        { label: "Created", key: "created_at", render: (r) => timeAgo(r.created_at) },
                        { label: "Content", key: "_json", render: (r) => jsonBlock(r.content, "soul-v" + r.version) },
                    ],
                    history
                );
            }

            return html;
        },

        // ── Config ──
        async config() {
            const data = await api("/config");
            if (!data) return `<div class="empty">Unable to load config</div>`;

            let html = `<div class="section-header"><span class="section-title">Sanitized Configuration</span></div>`;

            // Render as a key-value card grid
            const keys = Object.keys(data);
            html += `<div class="card-grid">`;
            for (const key of keys) {
                const val = data[key];
                const display = typeof val === "object" && val !== null
                    ? JSON.stringify(val, null, 2)
                    : String(val);
                html += `
          <div class="card">
            <div class="card-label">${esc(key)}</div>
            <div class="card-value" style="font-size:${display.length > 30 ? '11' : '14'}px; word-break:break-all">
              ${val === "[REDACTED]" ? '<span style="color:var(--red)">[REDACTED]</span>' : esc(display)}
            </div>
          </div>`;
            }
            html += `</div>`;

            html += `<div style="margin-top:20px">${jsonBlock(data, "config-full")}</div>`;
            return html;
        },
    };

    // ─── Child Tab Renderers ────────────────────────────

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

        // Goal
        if (d.goal_title) {
            h += `<div class="card" style="margin-bottom:20px"><div class="card-label">🎯 Assigned Goal</div>
              <div class="card-value" style="font-size:15px">${esc(d.goal_title)}</div>
              <div class="card-sub">${d.goal_id ? esc(d.goal_id) : ""} · ${statusBadge(d.goal_status || "active")}</div>
            </div>`;
        }

        // Current task
        if (d.current_task) {
            h += `<div class="card" style="margin-bottom:20px"><div class="card-label">📋 Current Task</div>
              <div class="card-value" style="font-size:14px">${esc(d.current_task.title)}</div>
              <div class="card-sub">Priority: ${d.current_task.priority} · ${statusBadge(d.current_task.status)}</div>
            </div>`;
        }

        // State summary
        if (d.state_summary) {
            h += `<div class="card" style="margin-bottom:20px"><div class="card-label">State Summary</div>
              <div class="card-sub" style="font-size:14px">${esc(d.state_summary)}</div></div>`;
        }

        // Tools used
        if (d.tools_used_last_5 && d.tools_used_last_5.length > 0) {
            h += `<div class="card" style="margin-bottom:20px"><div class="card-label">🔧 Recent Tools Used</div>
              <div class="card-sub">${d.tools_used_last_5.map(t => badge(t, "blue")).join(" ")}</div></div>`;
        }

        // ── FAILURE DIAGNOSTICS (Phase 5) ──
        if (d.failureDiagnostics) {
            const fd = d.failureDiagnostics;
            h += `<div class="section-header" style="margin-top:24px"><span class="section-title" style="color:var(--red)">🚨 Failure Diagnostics</span></div>`;
            h += `<div class="card-grid">
              <div class="card" style="border-color:var(--red)"><div class="card-label">Failure Reason</div>
                <div class="card-sub" style="color:var(--red)">${esc(fd.failureReason || "Unknown")}</div></div>
              <div class="card" style="border-color:var(--red)"><div class="card-label">Failure Time</div>
                <div class="card-sub">${timeAgo(fd.failureTime)}</div></div>
              <div class="card"><div class="card-label">Credits at Failure</div>
                <div class="card-value">${formatCents(fd.creditsAtFailure)}</div></div>
              <div class="card"><div class="card-label">Restart Attempts</div>
                <div class="card-value">${fd.restartCount}</div></div>
            </div>`;

            if (fd.lastErrors && fd.lastErrors.length > 0) {
                h += `<div class="section-header" style="margin-top:16px"><span class="section-title">Last Errors</span></div>`;
                h += makeTable([
                    { label: "State", key: "state", render: (r) => badge(r.state, "red") },
                    { label: "Reason", key: "reason", render: (r) => `<span style="color:var(--red)">${esc((r.reason || "").slice(0, 120))}</span>` },
                    { label: "Time", key: "timestamp", render: (r) => timeAgo(r.timestamp) },
                    { label: "Meta", key: "metadata", render: (r) => r.metadata ? jsonBlock(r.metadata, "err-" + Math.random()) : "—" },
                ], fd.lastErrors);
            }
        }

        // ── Lifecycle Timeline ──
        if (d.lifecycle && d.lifecycle.length > 0) {
            h += `<div class="section-header" style="margin-top:24px"><span class="section-title">Lifecycle Timeline</span></div>`;
            h += `<div class="timeline">`;
            for (const e of d.lifecycle.slice(0, 20)) {
                const cls = (e.to_state === "failed" || e.to_state === "unhealthy") ? "error"
                    : (e.to_state === "healthy" || e.to_state === "funded") ? "success" : "";
                h += `<div class="timeline-item ${cls}">
                  <strong>${esc(e.from_state)}</strong> → ${statusBadge(e.to_state)}
                  ${e.reason ? `<span style="margin-left:8px;color:var(--text-muted)">${esc(e.reason.slice(0, 80))}</span>` : ""}
                  <div class="timeline-ts">${timeAgo(e.created_at)} · ${esc(e.created_at)}</div>
                </div>`;
            }
            h += `</div>`;
        }

        return h;
    }

    function renderChildTurns(d) {
        let h = "";
        // Events from event_stream
        if (d.events && d.events.length > 0) {
            h += `<div class="section-header"><span class="section-title">Activity Events (${d.events.length})</span></div>`;
            h += makeTable([
                { label: "Type", key: "type", render: (r) => badge(r.type, "blue") },
                { label: "Content", key: "content", render: (r) => esc((r.content || "").slice(0, 120)) },
                { label: "Goal", key: "goal_id", render: (r) => r.goal_id ? esc(r.goal_id.slice(0, 8)) : "—" },
                { label: "Tokens", key: "token_count" },
                { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
            ], d.events);
        }

        // Tool calls referencing this child
        if (d.recent_turns && d.recent_turns.length > 0) {
            h += `<div class="section-header" style="margin-top:24px"><span class="section-title">Parent Tool Calls Referencing Child</span></div>`;
            h += makeTable([
                { label: "Tool", key: "tool_name" },
                { label: "Cost", key: "cost_cents", render: (r) => formatCents(r.cost_cents) },
                { label: "Duration", key: "duration_ms", render: (r) => r.duration_ms != null ? r.duration_ms + "ms" : "—" },
                { label: "Time", key: "timestamp", render: (r) => timeAgo(r.timestamp) },
            ], d.recent_turns);
        }

        // Tasks
        if (d.tasks && d.tasks.length > 0) {
            h += `<div class="section-header" style="margin-top:24px"><span class="section-title">Assigned Tasks</span></div>`;
            h += makeTable([
                { label: "Title", key: "title" },
                { label: "Status", key: "status", render: (r) => statusBadge(r.status) },
                { label: "Priority", key: "priority" },
                { label: "Est. Cost", key: "estimated_cost_cents", render: (r) => formatCents(r.estimated_cost_cents) },
                { label: "Actual Cost", key: "actual_cost_cents", render: (r) => formatCents(r.actual_cost_cents) },
                { label: "Created", key: "created_at", render: (r) => timeAgo(r.created_at) },
            ], d.tasks);
        }

        if (!h) h = `<div class="empty">No activity data available for this child</div>`;
        return h;
    }

    function renderChildLogs(data) {
        if (!data) return `<div class="empty">Unable to load logs</div>`;
        if (!data.available) {
            return `<div class="card" style="background:var(--bg-input)">
              <div class="card-label">📄 Log Viewer</div>
              <div class="card-sub">${esc(data.message || "Logs unavailable")}</div>
            </div>`;
        }

        let h = `<div class="card-sub" style="margin-bottom:12px">
          Source: <strong>${esc(data.path)}</strong> · ${data.totalMatches} matching lines
          · Search terms: ${(data.searchTerms || []).map(t => badge(t, "blue")).join(" ")}
        </div>`;

        if (data.lines.length === 0) {
            h += `<div class="empty">No log entries found matching this child</div>`;
        } else {
            h += `<div class="log-viewer">`;
            for (const line of data.lines) {
                h += `<div class="log-line">`;
                if (line.timestamp) h += `<span class="log-ts">[${esc(line.timestamp)}] </span>`;
                h += esc(line.raw);
                h += `</div>`;
            }
            h += `</div>`;
        }
        return h;
    }

    function renderChildResources(data) {
        if (!data) return `<div class="empty">Unable to load resources</div>`;
        if (data.error) return `<div class="empty">${esc(data.error)}</div>`;

        let h = `<div class="card-grid">
          <div class="card"><div class="card-label">Status</div><div class="card-value">${statusBadge(data.status)}</div></div>
          <div class="card"><div class="card-label">Uptime</div><div class="card-value">${data.uptime_seconds != null ? Math.floor(data.uptime_seconds / 60) + "m" : "—"}</div></div>
          <div class="card"><div class="card-label">Restart Count</div><div class="card-value">${data.restart_count != null ? data.restart_count : "—"}</div></div>
          <div class="card"><div class="card-label">State Transitions</div><div class="card-value">${data.totalStateTransitions || 0}</div></div>
          <div class="card"><div class="card-label">Memory</div><div class="card-value" style="font-size:14px">${data.memory_mb != null ? data.memory_mb + " MB" : "N/A"}</div>
            <div class="card-sub">E2B sandbox — no PM2 metrics</div></div>
          <div class="card"><div class="card-label">CPU</div><div class="card-value" style="font-size:14px">${data.cpu_percent != null ? data.cpu_percent + "%" : "N/A"}</div>
            <div class="card-sub">E2B sandbox — no PM2 metrics</div></div>
        </div>`;

        // Task stats
        const t = data.tasks || {};
        h += `<div class="section-header" style="margin-top:24px"><span class="section-title">Task Completion</span></div>`;
        h += `<div class="card-grid">
          <div class="card"><div class="card-label">Total Tasks</div><div class="card-value">${t.total || 0}</div></div>
          <div class="card"><div class="card-label">Completed</div><div class="card-value" style="color:var(--green)">${t.completed || 0}</div></div>
          <div class="card"><div class="card-label">Failed</div><div class="card-value" style="color:var(--red)">${t.failed || 0}</div></div>
          <div class="card"><div class="card-label">Running</div><div class="card-value" style="color:var(--accent)">${t.running || 0}</div></div>
        </div>`;

        // State timeline as table
        if (data.stateTimeline && data.stateTimeline.length > 0) {
            h += `<div class="section-header" style="margin-top:24px"><span class="section-title">State Timeline</span></div>`;
            h += makeTable([
                { label: "From", key: "from" },
                { label: "To", key: "to", render: (r) => statusBadge(r.to) },
                { label: "Reason", key: "reason", render: (r) => esc((r.reason || "").slice(0, 80)) },
                { label: "Time", key: "timestamp", render: (r) => timeAgo(r.timestamp) },
            ], data.stateTimeline);
        }

        return h;
    }

    function renderChildLedger(data) {
        if (!data) return `<div class="empty">Unable to load ledger</div>`;
        if (data.error) return `<div class="empty">${esc(data.error)}</div>`;

        let h = "";

        // Funding
        h += `<div class="card-grid">
          <div class="card"><div class="card-label">Initial Funding</div>
            <div class="card-value">${formatCents(data.funding?.funded_amount_cents)}</div>
            <div class="card-sub">$${esc(data.funding?.funded_usd || "0")} USD</div></div>
        </div>`;

        // Transactions
        if (data.transactions && data.transactions.length > 0) {
            h += `<div class="section-header" style="margin-top:24px"><span class="section-title">Transactions Referencing Child (${data.transactions.length})</span></div>`;
            h += makeTable([
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
            ], data.transactions);
        }

        // Task costs
        if (data.taskCosts?.tasks && data.taskCosts.tasks.length > 0) {
            h += `<div class="section-header" style="margin-top:24px"><span class="section-title">Task Costs (Total: ${formatCents(data.taskCosts.total_cost_cents)})</span></div>`;
            h += makeTable([
                { label: "Title", key: "title" },
                { label: "Status", key: "status", render: (r) => statusBadge(r.status) },
                { label: "Est. Cost", key: "estimated_cost_cents", render: (r) => formatCents(r.estimated_cost_cents) },
                { label: "Actual Cost", key: "actual_cost_cents", render: (r) => formatCents(r.actual_cost_cents) },
                { label: "Completed", key: "completed_at", render: (r) => timeAgo(r.completed_at) },
            ], data.taskCosts.tasks);
        }

        // Note about limitations
        if (data._note) {
            h += `<div class="card" style="margin-top:24px;background:var(--bg-input);border-color:var(--yellow)">
              <div class="card-label" style="color:var(--yellow)">⚠ Data Limitation</div>
              <div class="card-sub">${esc(data._note)}</div>
            </div>`;
        }

        if (!data.transactions?.length && !data.taskCosts?.tasks?.length) {
            h += `<div class="empty" style="margin-top:24px">No financial trace data found for this child</div>`;
        }

        return h;
    }

    // ─── Child Tab Switching ────────────────────────────

    window.__childTab = "overview";

    window.__switchChildTab = (tab) => {
        window.__childTab = tab;
        navigate();
    };

    // ─── Auto Refresh ───────────────────────────────────

    window.__autoRefresh = false;
    let autoRefreshTimer = null;

    window.__toggleAutoRefresh = () => {
        window.__autoRefresh = !window.__autoRefresh;
        if (window.__autoRefresh) {
            autoRefreshTimer = setInterval(() => {
                if (currentSection === "childDetail") navigate();
            }, 10000);
        } else {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
        navigate(); // Re-render to update button state
    };

    // ─── Router ─────────────────────────────────────────

    function getRoute() {
        const hash = window.location.hash.slice(1) || "status";
        // Handle child detail: #child/SOME_ID
        if (hash.startsWith("child/")) {
            return { section: "childDetail", param: hash.slice(6) };
        }
        return { section: hash, param: null };
    }

    async function navigate() {
        const { section, param } = getRoute();
        currentSection = section;

        // Clear auto-refresh when leaving child detail
        if (section !== "childDetail" && autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
            window.__autoRefresh = false;
        }
        // Reset child tab when navigating away
        if (section !== "childDetail") {
            window.__childTab = "overview";
        }

        // Update active nav
        $$(".nav-link").forEach((el) => {
            el.classList.toggle("active", el.dataset.section === section);
        });

        // Title
        const titles = {
            status: "Status",
            children: "Children",
            childDetail: "Child Detail",
            activity: "Activity",
            heartbeat: "Heartbeat",
            ledger: "Ledger",
            soul: "Soul",
            config: "Config",
        };
        $("#pageTitle").textContent = titles[section] || section;

        // Render
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
            if (data && data.ok) {
                b.className = "connection-badge connected";
                t.textContent = "Connected";
            } else {
                b.className = "connection-badge disconnected";
                t.textContent = "Disconnected";
            }
        } catch {
            const b = $("#connBadge");
            const t = $("#connText");
            b.className = "connection-badge disconnected";
            t.textContent = "Disconnected";
        }
    }

    // ─── Init ───────────────────────────────────────────

    window.addEventListener("hashchange", navigate);
    checkHealth();
    navigate();
})();
