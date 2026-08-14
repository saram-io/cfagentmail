import { env } from "cloudflare:test";

export const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS inboxes (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL,
    domain TEXT NOT NULL,
    display_name TEXT,
    metadata TEXT,
    client_id TEXT UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_inboxes_email ON inboxes(email)`,
  `CREATE INDEX IF NOT EXISTS idx_inboxes_client_id ON inboxes(client_id)`,
  `CREATE INDEX IF NOT EXISTS idx_inboxes_created_at ON inboxes(created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    inbox_id TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    snippet TEXT,
    last_message_at INTEGER NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_threads_inbox_id ON threads(inbox_id)`,
  `CREATE INDEX IF NOT EXISTS idx_threads_last_message_at ON threads(last_message_at DESC)`,

  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    inbox_id TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    message_id_header TEXT,
    in_reply_to TEXT,
    references_header TEXT,
    from_address TEXT NOT NULL,
    from_name TEXT,
    to_addresses TEXT NOT NULL,
    cc_addresses TEXT,
    bcc_addresses TEXT,
    reply_to_addresses TEXT,
    subject TEXT NOT NULL,
    text_body TEXT,
    html_body TEXT,
    snippet TEXT,
    raw_r2_key TEXT,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'draft')),
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_inbox_id ON messages(inbox_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_message_id_header ON messages(message_id_header)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_in_reply_to ON messages(in_reply_to)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    disposition TEXT NOT NULL DEFAULT 'attachment' CHECK (disposition IN ('attachment', 'inline')),
    content_id TEXT,
    r2_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id)`,

  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    inbox_id TEXT REFERENCES inboxes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_inbox_id ON api_keys(inbox_id)`,
];

export async function setupTestDb() {
  for (const stmt of STATEMENTS) {
    await env.DB.prepare(stmt).run();
  }
}

export async function clearTestDb() {
  const deletes = [
    "DELETE FROM attachments",
    "DELETE FROM messages",
    "DELETE FROM threads",
    "DELETE FROM api_keys",
    "DELETE FROM inboxes",
  ];
  for (const d of deletes) {
    await env.DB.prepare(d).run();
  }
}

export function createMockEmailMessage(opts: {
  from: string;
  to: string;
  rawMime: string;
  headers?: Record<string, string>;
}): ForwardableEmailMessage {
  const headers = new Headers(opts.headers || {});
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(opts.rawMime);

  let rejectedReason: string | undefined;

  return {
    from: opts.from,
    to: opts.to,
    headers,
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(rawBytes);
        controller.close();
      },
    }),
    rawSize: rawBytes.byteLength,
    setReject(reason: string) {
      rejectedReason = reason;
    },
    async forward(rcptTo: string, headers?: Headers) {},
    async reply(message: any) {},
  } as unknown as ForwardableEmailMessage;
}
