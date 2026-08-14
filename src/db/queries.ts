import type {
  Inbox,
  Thread,
  Message,
  MessageAttachmentMeta,
  ApiKey,
  CreateInboxRequest,
  UpdateInboxRequest,
} from "../types";

// Helper for SHA-256 hex digest
export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// -----------------------------
// Inboxes
// -----------------------------

export async function createInbox(
  db: D1Database,
  data: {
    id: string;
    email: string;
    username: string;
    domain: string;
    displayName?: string | null;
    metadata?: Record<string, any> | null;
    clientId?: string | null;
  }
): Promise<Inbox> {
  const now = Date.now();
  const metadataStr = data.metadata ? JSON.stringify(data.metadata) : null;

  // If clientId is provided, check for existing inbox (idempotency)
  if (data.clientId) {
    const existing = await db
      .prepare("SELECT * FROM inboxes WHERE client_id = ?")
      .bind(data.clientId)
      .first<any>();

    if (existing) {
      return mapInboxRow(existing);
    }
  }

  await db
    .prepare(
      `INSERT INTO inboxes (id, email, username, domain, display_name, metadata, client_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.email.toLowerCase(),
      data.username.toLowerCase(),
      data.domain.toLowerCase(),
      data.displayName || null,
      metadataStr,
      data.clientId || null,
      now,
      now
    )
    .run();

  return {
    id: data.id,
    email: data.email.toLowerCase(),
    username: data.username.toLowerCase(),
    domain: data.domain.toLowerCase(),
    displayName: data.displayName || null,
    metadata: data.metadata || null,
    clientId: data.clientId || null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getInbox(
  db: D1Database,
  idOrEmail: string
): Promise<Inbox | null> {
  const row = await db
    .prepare(
      "SELECT * FROM inboxes WHERE id = ? OR LOWER(email) = LOWER(?) LIMIT 1"
    )
    .bind(idOrEmail, idOrEmail)
    .first<any>();

  if (!row) return null;
  return mapInboxRow(row);
}

export async function listInboxes(
  db: D1Database,
  limit: number = 20,
  offset: number = 0
): Promise<{ inboxes: Inbox[]; total: number }> {
  const countRow = await db
    .prepare("SELECT COUNT(*) as count FROM inboxes")
    .first<{ count: number }>();
  const total = countRow?.count || 0;

  const results = await db
    .prepare(
      "SELECT * FROM inboxes ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(limit, offset)
    .all<any>();

  const inboxes = (results.results || []).map(mapInboxRow);
  return { inboxes, total };
}

export async function updateInbox(
  db: D1Database,
  idOrEmail: string,
  updates: UpdateInboxRequest
): Promise<Inbox | null> {
  const existing = await getInbox(db, idOrEmail);
  if (!existing) return null;

  const now = Date.now();
  let updatedDisplayName = existing.displayName;
  if (updates.displayName !== undefined) {
    updatedDisplayName = updates.displayName;
  }

  let updatedMetadata = existing.metadata ? { ...existing.metadata } : {};

  if (updates.metadata === null) {
    updatedMetadata = {};
  } else if (updates.metadata !== undefined) {
    for (const [k, v] of Object.entries(updates.metadata)) {
      if (v === null) {
        delete updatedMetadata[k];
      } else {
        updatedMetadata[k] = v;
      }
    }
  }

  const finalMetadata =
    Object.keys(updatedMetadata).length > 0 ? updatedMetadata : null;
  const metadataStr = finalMetadata ? JSON.stringify(finalMetadata) : null;

  await db
    .prepare(
      `UPDATE inboxes 
       SET display_name = ?, metadata = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(updatedDisplayName, metadataStr, now, existing.id)
    .run();

  return {
    ...existing,
    displayName: updatedDisplayName,
    metadata: finalMetadata,
    updatedAt: now,
  };
}

export async function deleteInbox(
  db: D1Database,
  idOrEmail: string
): Promise<boolean> {
  const existing = await getInbox(db, idOrEmail);
  if (!existing) return false;

  await db.prepare("DELETE FROM inboxes WHERE id = ?").bind(existing.id).run();
  return true;
}

function mapInboxRow(row: any): Inbox {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    domain: row.domain,
    displayName: row.display_name,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    clientId: row.client_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// -----------------------------
// Threads
// -----------------------------

export async function getOrCreateThread(
  db: D1Database,
  inboxId: string,
  subject: string,
  snippet: string | null,
  inReplyTo?: string | null,
  referencesHeader?: string | null
): Promise<Thread> {
  const now = Date.now();

  // Try to find matching thread via in_reply_to or references_header in existing messages
  let matchedThreadId: string | null = null;

  if (inReplyTo || referencesHeader) {
    const candidateIds = [
      inReplyTo,
      ...(referencesHeader ? referencesHeader.split(/\s+/) : []),
    ].filter(Boolean);

    for (const ref of candidateIds) {
      if (!ref) continue;
      const cleanRef = ref.trim().replace(/^<|>$/g, "");
      const match = await db
        .prepare(
          `SELECT thread_id FROM messages 
           WHERE inbox_id = ? AND (message_id_header = ? OR message_id_header = ?)
           LIMIT 1`
        )
        .bind(inboxId, ref, `<${cleanRef}>`)
        .first<{ thread_id: string }>();

      if (match?.thread_id) {
        matchedThreadId = match.thread_id;
        break;
      }
    }
  }

  if (matchedThreadId) {
    // Update existing thread
    await db
      .prepare(
        `UPDATE threads 
         SET last_message_at = ?, message_count = message_count + 1, snippet = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(now, snippet || null, now, matchedThreadId)
      .run();

    const threadRow = await db
      .prepare("SELECT * FROM threads WHERE id = ?")
      .bind(matchedThreadId)
      .first<any>();

    return mapThreadRow(threadRow);
  }

  // Create new thread
  const threadId = `th_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO threads (id, inbox_id, subject, snippet, last_message_at, message_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .bind(threadId, inboxId, subject || "(no subject)", snippet, now, now, now)
    .run();

  return {
    id: threadId,
    inboxId,
    subject: subject || "(no subject)",
    snippet,
    lastMessageAt: now,
    messageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getThread(
  db: D1Database,
  threadId: string
): Promise<Thread | null> {
  const row = await db
    .prepare("SELECT * FROM threads WHERE id = ?")
    .bind(threadId)
    .first<any>();

  if (!row) return null;
  return mapThreadRow(row);
}

function mapThreadRow(row: any): Thread {
  return {
    id: row.id,
    inboxId: row.inbox_id,
    subject: row.subject,
    snippet: row.snippet,
    lastMessageAt: row.last_message_at,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// -----------------------------
// Messages
// -----------------------------

export async function createMessage(
  db: D1Database,
  msg: {
    id: string;
    inboxId: string;
    threadId: string;
    messageIdHeader?: string | null;
    inReplyTo?: string | null;
    referencesHeader?: string | null;
    fromAddress: string;
    fromName?: string | null;
    toAddresses: any[];
    ccAddresses?: any[];
    bccAddresses?: any[];
    replyToAddresses?: any[];
    subject: string;
    textBody?: string | null;
    htmlBody?: string | null;
    snippet?: string | null;
    rawR2Key?: string | null;
    hasAttachments?: boolean;
    direction: "inbound" | "outbound" | "draft";
    isRead?: boolean;
  }
): Promise<Message> {
  const now = Date.now();
  const hasAtt = msg.hasAttachments ? 1 : 0;
  const isRead = msg.isRead ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO messages (
        id, inbox_id, thread_id, message_id_header, in_reply_to, references_header,
        from_address, from_name, to_addresses, cc_addresses, bcc_addresses, reply_to_addresses,
        subject, text_body, html_body, snippet, raw_r2_key, has_attachments, direction, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      msg.id,
      msg.inboxId,
      msg.threadId,
      msg.messageIdHeader || null,
      msg.inReplyTo || null,
      msg.referencesHeader || null,
      msg.fromAddress.toLowerCase(),
      msg.fromName || null,
      JSON.stringify(msg.toAddresses || []),
      msg.ccAddresses ? JSON.stringify(msg.ccAddresses) : null,
      msg.bccAddresses ? JSON.stringify(msg.bccAddresses) : null,
      msg.replyToAddresses ? JSON.stringify(msg.replyToAddresses) : null,
      msg.subject,
      msg.textBody || null,
      msg.htmlBody || null,
      msg.snippet || null,
      msg.rawR2Key || null,
      hasAtt,
      msg.direction,
      isRead,
      now
    )
    .run();

  return {
    id: msg.id,
    inboxId: msg.inboxId,
    threadId: msg.threadId,
    messageIdHeader: msg.messageIdHeader || null,
    inReplyTo: msg.inReplyTo || null,
    referencesHeader: msg.referencesHeader || null,
    from: {
      email: msg.fromAddress.toLowerCase(),
      name: msg.fromName || undefined,
    },
    to: msg.toAddresses,
    cc: msg.ccAddresses,
    bcc: msg.bccAddresses,
    replyTo: msg.replyToAddresses,
    subject: msg.subject,
    text: msg.textBody || null,
    html: msg.htmlBody || null,
    snippet: msg.snippet || null,
    rawR2Key: msg.rawR2Key || null,
    hasAttachments: !!msg.hasAttachments,
    direction: msg.direction,
    isRead: !!msg.isRead,
    createdAt: now,
  };
}

export async function getMessage(
  db: D1Database,
  messageId: string,
  inboxId?: string
): Promise<Message | null> {
  let query = "SELECT * FROM messages WHERE id = ?";
  const params: any[] = [messageId];

  if (inboxId) {
    query += " AND inbox_id = ?";
    params.push(inboxId);
  }

  const row = await db.prepare(query).bind(...params).first<any>();
  if (!row) return null;

  const attachments = await listAttachmentsByMessageId(db, row.id);
  const msg = mapMessageRow(row);
  msg.attachments = attachments;
  return msg;
}

export async function listMessages(
  db: D1Database,
  inboxId: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ messages: Message[]; total: number }> {
  const countRow = await db
    .prepare("SELECT COUNT(*) as count FROM messages WHERE inbox_id = ?")
    .bind(inboxId)
    .first<{ count: number }>();
  const total = countRow?.count || 0;

  const results = await db
    .prepare(
      "SELECT * FROM messages WHERE inbox_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(inboxId, limit, offset)
    .all<any>();

  const messages = (results.results || []).map(mapMessageRow);
  return { messages, total };
}

export async function deleteMessage(
  db: D1Database,
  messageId: string,
  inboxId?: string
): Promise<boolean> {
  let query = "DELETE FROM messages WHERE id = ?";
  const params: any[] = [messageId];

  if (inboxId) {
    query += " AND inbox_id = ?";
    params.push(inboxId);
  }

  const result = await db.prepare(query).bind(...params).run();
  return (result.meta?.changes ?? 0) > 0;
}

function mapMessageRow(row: any): Message {
  return {
    id: row.id,
    inboxId: row.inbox_id,
    threadId: row.thread_id,
    messageIdHeader: row.message_id_header,
    inReplyTo: row.in_reply_to,
    referencesHeader: row.references_header,
    from: {
      email: row.from_address,
      name: row.from_name || undefined,
    },
    to: row.to_addresses ? JSON.parse(row.to_addresses) : [],
    cc: row.cc_addresses ? JSON.parse(row.cc_addresses) : undefined,
    bcc: row.bcc_addresses ? JSON.parse(row.bcc_addresses) : undefined,
    replyTo: row.reply_to_addresses
      ? JSON.parse(row.reply_to_addresses)
      : undefined,
    subject: row.subject,
    text: row.text_body,
    html: row.html_body,
    snippet: row.snippet,
    rawR2Key: row.raw_r2_key,
    hasAttachments: row.has_attachments === 1,
    direction: row.direction,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  };
}

// -----------------------------
// Attachments
// -----------------------------

export async function createAttachment(
  db: D1Database,
  att: {
    id: string;
    messageId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    disposition?: "attachment" | "inline";
    contentId?: string | null;
    r2Key: string;
  }
): Promise<MessageAttachmentMeta> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, disposition, content_id, r2_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      att.id,
      att.messageId,
      att.filename,
      att.contentType,
      att.sizeBytes,
      att.disposition || "attachment",
      att.contentId || null,
      att.r2Key,
      now
    )
    .run();

  return {
    id: att.id,
    messageId: att.messageId,
    filename: att.filename,
    contentType: att.contentType,
    sizeBytes: att.sizeBytes,
    disposition: att.disposition || "attachment",
    contentId: att.contentId || null,
    r2Key: att.r2Key,
    createdAt: now,
  };
}

export async function getAttachment(
  db: D1Database,
  attachmentId: string
): Promise<MessageAttachmentMeta | null> {
  const row = await db
    .prepare("SELECT * FROM attachments WHERE id = ?")
    .bind(attachmentId)
    .first<any>();

  if (!row) return null;
  return {
    id: row.id,
    messageId: row.message_id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    disposition: row.disposition,
    contentId: row.content_id,
    r2Key: row.r2_key,
    createdAt: row.created_at,
  };
}

export async function listAttachmentsByMessageId(
  db: D1Database,
  messageId: string
): Promise<MessageAttachmentMeta[]> {
  const results = await db
    .prepare("SELECT * FROM attachments WHERE message_id = ?")
    .bind(messageId)
    .all<any>();

  return (results.results || []).map((row) => ({
    id: row.id,
    messageId: row.message_id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    disposition: row.disposition,
    contentId: row.content_id,
    r2Key: row.r2_key,
    createdAt: row.created_at,
  }));
}

// -----------------------------
// API Keys
// -----------------------------

export async function createApiKeyRecord(
  db: D1Database,
  name: string,
  inboxId: string | null = null
): Promise<{ keyId: string; rawKey: string }> {
  const keyId = `key_${crypto.randomUUID()}`;
  const randomBytes = new Uint8Array(24);
  crypto.getRandomValues(randomBytes);
  const secretPart = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const prefix = "am_live_";
  const rawKey = `${prefix}${secretPart}`;
  const keyHash = await hashApiKey(rawKey);
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO api_keys (id, inbox_id, name, key_hash, prefix, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(keyId, inboxId, name, keyHash, prefix, now)
    .run();

  return { keyId, rawKey };
}

export async function verifyApiKey(
  db: D1Database,
  rawKey: string
): Promise<ApiKey | null> {
  const keyHash = await hashApiKey(rawKey);
  const row = await db
    .prepare("SELECT * FROM api_keys WHERE key_hash = ?")
    .bind(keyHash)
    .first<any>();

  if (!row) return null;
  return {
    id: row.id,
    inboxId: row.inbox_id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.created_at,
  };
}

export async function listApiKeysByInbox(
  db: D1Database,
  inboxId: string
): Promise<ApiKey[]> {
  const results = await db
    .prepare("SELECT * FROM api_keys WHERE inbox_id = ? ORDER BY created_at DESC")
    .bind(inboxId)
    .all<any>();

  return (results.results || []).map((row) => ({
    id: row.id,
    inboxId: row.inbox_id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.created_at,
  }));
}

export async function deleteApiKey(
  db: D1Database,
  keyId: string,
  inboxId?: string
): Promise<boolean> {
  let query = "DELETE FROM api_keys WHERE id = ?";
  const params: any[] = [keyId];

  if (inboxId) {
    query += " AND inbox_id = ?";
    params.push(inboxId);
  }

  const res = await db.prepare(query).bind(...params).run();
  return (res.meta?.changes ?? 0) > 0;
}
