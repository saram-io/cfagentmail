-- CFAgentMail Phase 2 Schema: Labels, FTS5 Full-Text Search, and Triggers

-- 1. Add labels column to messages and threads
ALTER TABLE messages ADD COLUMN labels TEXT DEFAULT '["INBOX"]';
ALTER TABLE threads ADD COLUMN labels TEXT DEFAULT '["INBOX"]';

-- 2. Create FTS5 virtual table for full-text search across messages
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    message_id UNINDEXED,
    inbox_id UNINDEXED,
    thread_id UNINDEXED,
    subject,
    body_text,
    from_address,
    to_addresses,
    tokenize = 'porter unicode61'
);

-- 3. Triggers to automatically synchronize messages_fts with messages table
CREATE TRIGGER IF NOT EXISTS trg_messages_ai AFTER INSERT ON messages
BEGIN
    INSERT INTO messages_fts(message_id, inbox_id, thread_id, subject, body_text, from_address, to_addresses)
    VALUES (
        new.id,
        new.inbox_id,
        new.thread_id,
        new.subject,
        COALESCE(new.text_body, ''),
        new.from_address,
        new.to_addresses
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_messages_ad AFTER DELETE ON messages
BEGIN
    DELETE FROM messages_fts WHERE message_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_messages_au AFTER UPDATE ON messages
BEGIN
    DELETE FROM messages_fts WHERE message_id = old.id;
    INSERT INTO messages_fts(message_id, inbox_id, thread_id, subject, body_text, from_address, to_addresses)
    VALUES (
        new.id,
        new.inbox_id,
        new.thread_id,
        new.subject,
        COALESCE(new.text_body, ''),
        new.from_address,
        new.to_addresses
    );
END;
