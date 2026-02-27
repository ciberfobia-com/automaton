/**
 * Social & Messaging API — inbox, worker comms, event_stream activity
 */
const express = require("express");
const router = express.Router();
const { safeAll, safeGet } = require("../lib/db");

// ─── All messaging: inbox + worker_log events + task_assignment events ───
router.get("/social", (_req, res) => {
    // Inbox messages (parent ↔ external agents)
    const inbox = safeAll(`
        SELECT id, from_address, to_address, content, status, retry_count,
               received_at, processed_at, reply_to
        FROM inbox_messages
        ORDER BY received_at DESC
        LIMIT 100
    `);

    // Worker logs from event_stream (worker → parent visibility)
    const workerEvents = safeAll(`
        SELECT id, type, agent_address, goal_id, task_id, content, token_count, created_at
        FROM event_stream
        WHERE type IN ('worker_log', 'task_completed', 'task_failed', 'task_assigned')
        ORDER BY created_at DESC
        LIMIT 200
    `);

    // Messaging stats
    const inboxTotal = safeGet(`SELECT COUNT(*) as c FROM inbox_messages`) || { c: 0 };
    const inboxPending = safeGet(`SELECT COUNT(*) as c FROM inbox_messages WHERE processed_at IS NULL`) || { c: 0 };
    const workerLogCount = safeGet(`SELECT COUNT(*) as c FROM event_stream WHERE type = 'worker_log'`) || { c: 0 };
    const taskEvents = safeGet(`SELECT COUNT(*) as c FROM event_stream WHERE type IN ('task_completed','task_failed','task_assigned')`) || { c: 0 };

    // Active communication channels (children with recent events)
    const channels = safeAll(`
        SELECT c.name, c.address, c.status, c.role,
               (SELECT COUNT(*) FROM event_stream es WHERE es.agent_address = c.address) as event_count,
               (SELECT MAX(created_at) FROM event_stream es WHERE es.agent_address = c.address) as last_activity
        FROM children c
        ORDER BY last_activity DESC NULLS LAST
    `);

    res.json({
        stats: {
            inbox_total: inboxTotal.c,
            inbox_pending: inboxPending.c,
            worker_logs: workerLogCount.c,
            task_events: taskEvents.c,
            active_channels: channels.filter(c => c.event_count > 0).length,
        },
        channels,
        inbox,
        workerEvents,
    });
});

module.exports = router;
