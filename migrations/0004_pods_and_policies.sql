-- CFAgentMail Phase 4 Schema: Multi-Tenant Pods, Access Policies, and AI Insights

-- 1. Create Pods table
CREATE TABLE IF NOT EXISTS pods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 2. Alter inboxes and api_keys to support multi-tenant pod association
ALTER TABLE inboxes ADD COLUMN pod_id TEXT REFERENCES pods(id) ON DELETE CASCADE;
ALTER TABLE api_keys ADD COLUMN pod_id TEXT REFERENCES pods(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_inboxes_pod_id ON inboxes(pod_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_pod_id ON api_keys(pod_id);

-- 3. Create Access Rules table (allowlist and blocklist security policies)
CREATE TABLE IF NOT EXISTS access_rules (
    id TEXT PRIMARY KEY,
    inbox_id TEXT REFERENCES inboxes(id) ON DELETE CASCADE,
    pod_id TEXT REFERENCES pods(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('allow', 'block')),
    pattern TEXT NOT NULL, -- sender email (e.g. user@domain.com) or wildcard/domain (e.g. *@spam.com, @domain.com)
    action TEXT NOT NULL DEFAULT 'reject' CHECK (action IN ('reject', 'spam')),
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_rules_inbox_id ON access_rules(inbox_id);
CREATE INDEX IF NOT EXISTS idx_access_rules_pod_id ON access_rules(pod_id);

-- 4. Create AI Insights table for email intelligence
CREATE TABLE IF NOT EXISTS ai_insights (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    sentiment TEXT NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative')),
    urgency INTEGER NOT NULL CHECK (urgency BETWEEN 1 AND 5),
    labels TEXT NOT NULL, -- JSON array of labels, e.g. ["SUPPORT", "URGENT"]
    action_item TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_message_id ON ai_insights(message_id);
