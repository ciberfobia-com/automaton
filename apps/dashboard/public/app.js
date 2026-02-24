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

        // ── Child Detail ──
        async childDetail(id) {
            const data = await api("/children/" + id);
            if (!data || data.error) return `<div class="empty">Child not found</div>`;
            let html = `
        <div class="card-grid">
          <div class="card"><div class="card-label">ID</div><div class="card-value" style="font-size:14px">${esc(data.id)}</div></div>
          <div class="card"><div class="card-label">Name</div><div class="card-value" style="font-size:16px">${esc(data.name)}</div></div>
          <div class="card"><div class="card-label">Status</div><div class="card-value">${statusBadge(data.status)}</div></div>
          <div class="card"><div class="card-label">Address</div><div class="card-value" style="font-size:12px">${esc(data.address)}</div></div>
          <div class="card"><div class="card-label">Funded</div><div class="card-value">${formatCents(data.funded_amount_cents)}</div></div>
          <div class="card"><div class="card-label">Created</div><div class="card-value" style="font-size:13px">${esc(data.created_at)}</div></div>
        </div>`;

            html += `<div class="section-header"><span class="section-title">Genesis Prompt</span></div>`;
            html += `<div class="soul-content">${esc(data.genesis_prompt || "—")}</div>`;

            if (data.lifecycle && data.lifecycle.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Lifecycle Events</span></div>`;
                html += makeTable(
                    [
                        { label: "State", key: "state" },
                        { label: "Reason", key: "reason" },
                        { label: "Timestamp", key: "created_at", render: (r) => timeAgo(r.created_at) },
                    ],
                    data.lifecycle
                );
            }

            if (data.messages && data.messages.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Recent Messages</span></div>`;
                html += makeTable(
                    [
                        { label: "From", key: "from_address", render: (r) => esc((r.from_address || "").slice(0, 12)) },
                        { label: "Content", key: "content", render: (r) => esc((r.content || "").slice(0, 100)) },
                        { label: "Status", key: "status", render: (r) => statusBadge(r.status) },
                        { label: "Received", key: "received_at", render: (r) => timeAgo(r.received_at) },
                    ],
                    data.messages
                );
            }

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

            if (data.dailyTotals && data.dailyTotals.length > 0) {
                html += `<div class="section-header"><span class="section-title">Daily Spend Totals</span></div>`;
                html += makeTable(
                    [
                        { label: "Day", key: "window_day" },
                        { label: "Total", key: "total_cents", render: (r) => formatCents(r.total_cents) },
                        { label: "Transactions", key: "count" },
                    ],
                    data.dailyTotals
                );
            }

            if (data.records && data.records.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Spend Records</span></div>`;
                html += makeTable(
                    [
                        { label: "Tool", key: "tool_name" },
                        { label: "Amount", key: "amount_cents", render: (r) => formatCents(r.amount_cents) },
                        { label: "Category", key: "category" },
                        { label: "Recipient", key: "recipient", render: (r) => esc((r.recipient || "—").slice(0, 20)) },
                        { label: "Domain", key: "domain" },
                        { label: "Day", key: "window_day" },
                    ],
                    data.records
                );
            }

            if (data.transfers && data.transfers.length > 0) {
                html += `<div class="section-header" style="margin-top:24px"><span class="section-title">Transfers / Transactions</span></div>`;
                html += makeTable(
                    [
                        { label: "ID", key: "id", render: (r) => esc((r.id || "").slice(0, 8)) },
                        { label: "Type", key: "type" },
                        { label: "Amount", key: "amount_cents", render: (r) => formatCents(r.amount_cents) },
                        { label: "Balance After", key: "balance_after_cents", render: (r) => formatCents(r.balance_after_cents) },
                        { label: "Description", key: "description", render: (r) => esc((r.description || "").slice(0, 50)) },
                        { label: "Time", key: "created_at", render: (r) => timeAgo(r.created_at) },
                    ],
                    data.transfers
                );
            }

            if (!html) html = `<div class="empty">No ledger data available</div>`;
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
