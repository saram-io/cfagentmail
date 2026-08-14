-- CFAgentMail Phase 3 Schema: Webhook Subscriptions and Delivery Logs

CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    inbox_id TEXT REFERENCES inboxes(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    events TEXT NOT NULL, -- JSON array of events, e.g. ["email.received", "email.sent"]
    secret TEXT NOT NULL, -- HMAC secret key
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhooks_inbox_id ON webhooks(inbox_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_is_active ON webhooks(is_active);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    duration_ms INTEGER,
    error TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at DESC);
