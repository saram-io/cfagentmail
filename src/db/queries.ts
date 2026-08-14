import type {
  Inbox,
  Thread,
  Message,
  MessageAttachmentMeta,
  ApiKey,
  Draft,
  ThreadSearchResult,
  MessageSearchResult,
  ListThreadsOptions,
  UpdateInboxRequest,
  Webhook,
  WebhookDelivery,
  CreateWebhookRequest,
  UpdateWebhookRequest,
  Pod,
  AccessRule,
  AiInsight,
  CreatePodRequest,
  UpdatePodRequest,
  CreateAccessRuleRequest,
} from "../types";
import { saveAttachment } from "../services/storage";
import { sendEmailViaBinding } from "../services/email-sender";

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
    podId?: string | null;
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
      `INSERT INTO inboxes (id, pod_id, email, username, domain, display_name, metadata, client_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.podId || null,
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
    podId: data.podId || null,
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

  let updatedPodId = existing.podId;
  if (updates.podId !== undefined) {
    updatedPodId = updates.podId;
  }

  await db
    .prepare(
      `UPDATE inboxes 
       SET display_name = ?, pod_id = ?, metadata = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(updatedDisplayName, updatedPodId || null, metadataStr, now, existing.id)
    .run();

  return {
    ...existing,
    displayName: updatedDisplayName,
    podId: updatedPodId || null,
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
    podId: row.pod_id || null,
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
  referencesHeader?: string | null,
  labels: string[] = ["INBOX"]
): Promise<Thread> {
  const now = Date.now();

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

  const threadId = `th_${crypto.randomUUID()}`;
  const labelsStr = JSON.stringify(labels);
  await db
    .prepare(
      `INSERT INTO threads (id, inbox_id, subject, snippet, last_message_at, message_count, labels, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
    )
    .bind(threadId, inboxId, subject || "(no subject)", snippet, now, labelsStr, now, now)
    .run();

  return {
    id: threadId,
    inboxId,
    subject: subject || "(no subject)",
    snippet,
    lastMessageAt: now,
    messageCount: 1,
    labels,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getThread(
  db: D1Database,
  threadId: string,
  inboxId?: string
): Promise<Thread | null> {
  let query = "SELECT * FROM threads WHERE id = ?";
  const params: any[] = [threadId];

  if (inboxId) {
    query += " AND inbox_id = ?";
    params.push(inboxId);
  }

  const row = await db.prepare(query).bind(...params).first<any>();
  if (!row) return null;

  // Retrieve all messages in this thread in chronological order
  const msgResults = await db
    .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC")
    .bind(threadId)
    .all<any>();

  const messages: Message[] = [];
  for (const mRow of msgResults.results || []) {
    const attachments = await listAttachmentsByMessageId(db, mRow.id);
    const msg = mapMessageRow(mRow);
    msg.attachments = attachments;
    messages.push(msg);
  }

  const thread = mapThreadRow(row);
  thread.messages = messages;
  return thread;
}

export async function listThreads(
  db: D1Database,
  inboxId: string | null = null,
  options: ListThreadsOptions = {}
): Promise<{ threads: Thread[]; total: number }> {
  const limit = Math.min(Math.max(options.limit || 20, 1), 100);
  const offset = Math.max(options.offset || 0, 0);
  const direction = options.ascending ? "ASC" : "DESC";

  const conditions: string[] = [];
  const params: any[] = [];

  if (inboxId) {
    conditions.push("inbox_id = ?");
    params.push(inboxId);
  }

  if (options.before) {
    conditions.push("last_message_at < ?");
    params.push(options.before);
  }

  if (options.after) {
    conditions.push("last_message_at > ?");
    params.push(options.after);
  }

  if (options.subject) {
    conditions.push("subject LIKE ?");
    params.push(`%${options.subject}%`);
  }

  if (options.labels && options.labels.length > 0) {
    // Check if thread contains any of the labels
    const labelChecks = options.labels.map(() => "labels LIKE ?").join(" OR ");
    conditions.push(`(${labelChecks})`);
    options.labels.forEach((l) => params.push(`%"${l}"%`));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count total
  const countRow = await db
    .prepare(`SELECT COUNT(*) as count FROM threads ${whereClause}`)
    .bind(...params)
    .first<{ count: number }>();
  const total = countRow?.count || 0;

  // Query records
  const query = `
    SELECT * FROM threads 
    ${whereClause} 
    ORDER BY last_message_at ${direction} 
    LIMIT ? OFFSET ?
  `;
  const queryParams = [...params, limit, offset];

  const results = await db.prepare(query).bind(...queryParams).all<any>();
  const threads = (results.results || []).map(mapThreadRow);

  return { threads, total };
}

export async function updateThread(
  db: D1Database,
  threadId: string,
  updates: { labels?: string[] },
  inboxId?: string
): Promise<Thread | null> {
  const existing = await getThread(db, threadId, inboxId);
  if (!existing) return null;

  const now = Date.now();
  let updatedLabels = existing.labels || ["INBOX"];
  if (updates.labels !== undefined) {
    updatedLabels = updates.labels;
  }

  await db
    .prepare(
      `UPDATE threads 
       SET labels = ?, updated_at = ? 
       WHERE id = ?`
    )
    .bind(JSON.stringify(updatedLabels), now, threadId)
    .run();

  return {
    ...existing,
    labels: updatedLabels,
    updatedAt: now,
  };
}

export async function deleteThread(
  db: D1Database,
  threadId: string,
  inboxId?: string
): Promise<boolean> {
  let query = "DELETE FROM threads WHERE id = ?";
  const params: any[] = [threadId];

  if (inboxId) {
    query += " AND inbox_id = ?";
    params.push(inboxId);
  }

  const res = await db.prepare(query).bind(...params).run();
  return (res.meta?.changes ?? 0) > 0;
}

function mapThreadRow(row: any): Thread {
  return {
    id: row.id,
    inboxId: row.inbox_id,
    subject: row.subject,
    snippet: row.snippet,
    lastMessageAt: row.last_message_at,
    messageCount: row.message_count,
    labels: row.labels ? JSON.parse(row.labels) : ["INBOX"],
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
    labels?: string[];
    isRead?: boolean;
  }
): Promise<Message> {
  const now = Date.now();
  const hasAtt = msg.hasAttachments ? 1 : 0;
  const isRead = msg.isRead ? 1 : 0;
  const labelsStr = JSON.stringify(msg.labels || (msg.direction === "draft" ? ["DRAFT"] : ["INBOX"]));

  await db
    .prepare(
      `INSERT INTO messages (
        id, inbox_id, thread_id, message_id_header, in_reply_to, references_header,
        from_address, from_name, to_addresses, cc_addresses, bcc_addresses, reply_to_addresses,
        subject, text_body, html_body, snippet, raw_r2_key, has_attachments, direction, labels, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      labelsStr,
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
    labels: msg.labels || (msg.direction === "draft" ? ["DRAFT"] : ["INBOX"]),
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
    .prepare("SELECT COUNT(*) as count FROM messages WHERE inbox_id = ? AND direction != 'draft'")
    .bind(inboxId)
    .first<{ count: number }>();
  const total = countRow?.count || 0;

  const results = await db
    .prepare(
      "SELECT * FROM messages WHERE inbox_id = ? AND direction != 'draft' ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(inboxId, limit, offset)
    .all<any>();

  const messages = (results.results || []).map(mapMessageRow);
  return { messages, total };
}

export async function updateMessage(
  db: D1Database,
  messageId: string,
  updates: { isRead?: boolean; labels?: string[] },
  inboxId?: string
): Promise<Message | null> {
  const existing = await getMessage(db, messageId, inboxId);
  if (!existing) return null;

  let isRead = existing.isRead;
  if (updates.isRead !== undefined) {
    isRead = updates.isRead;
  }

  let labels = existing.labels || ["INBOX"];
  if (updates.labels !== undefined) {
    labels = updates.labels;
  }

  await db
    .prepare(
      `UPDATE messages 
       SET is_read = ?, labels = ? 
       WHERE id = ?`
    )
    .bind(isRead ? 1 : 0, JSON.stringify(labels), messageId)
    .run();

  return {
    ...existing,
    isRead,
    labels,
  };
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
    labels: row.labels ? JSON.parse(row.labels) : ["INBOX"],
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  };
}

// -----------------------------
// Full-Text Search (SQLite FTS5)
// -----------------------------

export async function searchMessages(
  db: D1Database,
  query: string,
  inboxId?: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ results: MessageSearchResult[]; total: number }> {
  // Format query for FTS5 (sanitizing and quoting phrases or terms)
  const sanitized = query.replace(/[^\w\s@.-]/g, " ").trim();
  if (!sanitized) {
    return { results: [], total: 0 };
  }

  const ftsQuery = sanitized
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term}"*`)
    .join(" AND ");

  let countSql = `
    SELECT COUNT(*) as count 
    FROM messages_fts 
    WHERE messages_fts MATCH ?
  `;
  const countParams: any[] = [ftsQuery];

  if (inboxId) {
    countSql = `
      SELECT COUNT(*) as count 
      FROM messages_fts 
      WHERE messages_fts MATCH ? AND inbox_id = ?
    `;
    countParams.push(inboxId);
  }

  const countRow = await db.prepare(countSql).bind(...countParams).first<{ count: number }>();
  const total = countRow?.count || 0;

  let searchSql = `
    SELECT 
      m.*,
      snippet(messages_fts, 3, '**', '**', '...', 16) as subject_highlight,
      snippet(messages_fts, 4, '**', '**', '...', 32) as body_highlight,
      messages_fts.rank
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.message_id
    WHERE messages_fts MATCH ?
  `;
  const searchParams: any[] = [ftsQuery];

  if (inboxId) {
    searchSql += " AND messages_fts.inbox_id = ?";
    searchParams.push(inboxId);
  }

  searchSql += " ORDER BY messages_fts.rank LIMIT ? OFFSET ?";
  searchParams.push(limit, offset);

  const queryResults = await db.prepare(searchSql).bind(...searchParams).all<any>();

  const results: MessageSearchResult[] = [];
  for (const row of queryResults.results || []) {
    const msg = mapMessageRow(row);
    const attachments = await listAttachmentsByMessageId(db, row.id);
    msg.attachments = attachments;

    const highlights: Record<string, string[]> = {};
    if (row.subject_highlight && row.subject_highlight.includes("**")) {
      highlights.subject = [row.subject_highlight];
    }
    if (row.body_highlight && row.body_highlight.includes("**")) {
      highlights.text = [row.body_highlight];
    }

    results.push({
      ...msg,
      highlights: Object.keys(highlights).length > 0 ? highlights : undefined,
    });
  }

  return { results, total };
}

export async function searchThreads(
  db: D1Database,
  query: string,
  inboxId?: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ results: ThreadSearchResult[]; total: number }> {
  const sanitized = query.replace(/[^\w\s@.-]/g, " ").trim();
  if (!sanitized) {
    return { results: [], total: 0 };
  }

  const ftsQuery = sanitized
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term}"*`)
    .join(" AND ");

  let searchSql = `
    SELECT 
      messages_fts.thread_id,
      messages_fts.message_id,
      messages_fts.rank,
      snippet(messages_fts, 3, '**', '**', '...', 16) as subject_highlight,
      snippet(messages_fts, 4, '**', '**', '...', 32) as body_highlight
    FROM messages_fts
    WHERE messages_fts MATCH ?
  `;
  const searchParams: any[] = [ftsQuery];

  if (inboxId) {
    searchSql += " AND messages_fts.inbox_id = ?";
    searchParams.push(inboxId);
  }

  searchSql += " ORDER BY messages_fts.rank ASC LIMIT 200";

  const queryResults = await db.prepare(searchSql).bind(...searchParams).all<any>();

  // Aggregate unique thread IDs preserving relevance order
  const threadMap = new Map<string, { subjectHighlight?: string; bodyHighlight?: string }>();
  for (const row of queryResults.results || []) {
    if (!threadMap.has(row.thread_id)) {
      threadMap.set(row.thread_id, {
        subjectHighlight: row.subject_highlight,
        bodyHighlight: row.body_highlight,
      });
    }
  }

  const uniqueThreadIds = Array.from(threadMap.keys());
  const total = uniqueThreadIds.length;
  const paginatedIds = uniqueThreadIds.slice(offset, offset + limit);

  const results: ThreadSearchResult[] = [];
  for (const threadId of paginatedIds) {
    const thread = await getThread(db, threadId, inboxId);
    if (!thread) continue;

    const meta = threadMap.get(threadId);
    const highlights: Record<string, string[]> = {};

    if (meta?.subjectHighlight && meta.subjectHighlight.includes("**")) {
      highlights.subject = [meta.subjectHighlight];
    }
    if (meta?.bodyHighlight && meta.bodyHighlight.includes("**")) {
      highlights.text = [meta.bodyHighlight];
    }

    results.push({
      ...thread,
      highlights: Object.keys(highlights).length > 0 ? highlights : undefined,
    });
  }

  return { results, total };
}

// -----------------------------
// Drafts & Human-In-The-Loop
// -----------------------------

export async function createDraft(
  db: D1Database,
  draft: {
    id: string;
    inboxId: string;
    threadId?: string;
    to: any[];
    cc?: any[];
    bcc?: any[];
    replyTo?: any[];
    subject?: string;
    text?: string | null;
    html?: string | null;
    inReplyTo?: string | null;
    hasAttachments?: boolean;
  }
): Promise<Draft> {
  const now = Date.now();
  const threadId = draft.threadId || `th_${crypto.randomUUID()}`;

  // If thread doesn't exist, create it
  const existingThread = await db
    .prepare("SELECT * FROM threads WHERE id = ?")
    .bind(threadId)
    .first<any>();

  if (!existingThread) {
    await db
      .prepare(
        `INSERT INTO threads (id, inbox_id, subject, snippet, last_message_at, message_count, labels, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, '["DRAFT"]', ?, ?)`
      )
      .bind(
        threadId,
        draft.inboxId,
        draft.subject || "(Draft subject)",
        draft.text?.slice(0, 160) || null,
        now,
        now,
        now
      )
      .run();
  }

  const inbox = await getInbox(db, draft.inboxId);
  const fromEmail = inbox?.email || draft.inboxId;

  await db
    .prepare(
      `INSERT INTO messages (
        id, inbox_id, thread_id, in_reply_to, from_address, to_addresses, cc_addresses, bcc_addresses,
        reply_to_addresses, subject, text_body, html_body, snippet, has_attachments, direction, labels, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', '["DRAFT"]', 1, ?)`
    )
    .bind(
      draft.id,
      draft.inboxId,
      threadId,
      draft.inReplyTo || null,
      fromEmail,
      JSON.stringify(draft.to || []),
      draft.cc ? JSON.stringify(draft.cc) : null,
      draft.bcc ? JSON.stringify(draft.bcc) : null,
      draft.replyTo ? JSON.stringify(draft.replyTo) : null,
      draft.subject || "(Draft subject)",
      draft.text || null,
      draft.html || null,
      draft.text?.slice(0, 160) || null,
      draft.hasAttachments ? 1 : 0,
      now
    )
    .run();

  return {
    id: draft.id,
    inboxId: draft.inboxId,
    threadId,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    replyTo: draft.replyTo,
    subject: draft.subject || "(Draft subject)",
    text: draft.text || null,
    html: draft.html || null,
    inReplyTo: draft.inReplyTo || null,
    hasAttachments: !!draft.hasAttachments,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getDraft(
  db: D1Database,
  draftId: string,
  inboxId?: string
): Promise<Draft | null> {
  let query = "SELECT * FROM messages WHERE id = ? AND direction = 'draft'";
  const params: any[] = [draftId];

  if (inboxId) {
    query += " AND inbox_id = ?";
    params.push(inboxId);
  }

  const row = await db.prepare(query).bind(...params).first<any>();
  if (!row) return null;

  const attachments = await listAttachmentsByMessageId(db, row.id);

  return {
    id: row.id,
    inboxId: row.inbox_id,
    threadId: row.thread_id,
    to: row.to_addresses ? JSON.parse(row.to_addresses) : [],
    cc: row.cc_addresses ? JSON.parse(row.cc_addresses) : undefined,
    bcc: row.bcc_addresses ? JSON.parse(row.bcc_addresses) : undefined,
    replyTo: row.reply_to_addresses ? JSON.parse(row.reply_to_addresses) : undefined,
    subject: row.subject,
    text: row.text_body,
    html: row.html_body,
    inReplyTo: row.in_reply_to,
    hasAttachments: row.has_attachments === 1,
    attachments,
    createdAt: row.created_at,
    updatedAt: row.created_at,
  };
}

export async function listDrafts(
  db: D1Database,
  inboxId: string | null = null,
  limit: number = 20,
  offset: number = 0
): Promise<{ drafts: Draft[]; total: number }> {
  let countSql = "SELECT COUNT(*) as count FROM messages WHERE direction = 'draft'";
  const params: any[] = [];

  if (inboxId) {
    countSql += " AND inbox_id = ?";
    params.push(inboxId);
  }

  const countRow = await db.prepare(countSql).bind(...params).first<{ count: number }>();
  const total = countRow?.count || 0;

  let query = "SELECT * FROM messages WHERE direction = 'draft'";
  if (inboxId) {
    query += " AND inbox_id = ?";
  }
  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  const queryParams = [...params, limit, offset];

  const results = await db.prepare(query).bind(...queryParams).all<any>();

  const drafts = (results.results || []).map((row) => ({
    id: row.id,
    inboxId: row.inbox_id,
    threadId: row.thread_id,
    to: row.to_addresses ? JSON.parse(row.to_addresses) : [],
    cc: row.cc_addresses ? JSON.parse(row.cc_addresses) : undefined,
    bcc: row.bcc_addresses ? JSON.parse(row.bcc_addresses) : undefined,
    replyTo: row.reply_to_addresses ? JSON.parse(row.reply_to_addresses) : undefined,
    subject: row.subject,
    text: row.text_body,
    html: row.html_body,
    inReplyTo: row.in_reply_to,
    hasAttachments: row.has_attachments === 1,
    createdAt: row.created_at,
    updatedAt: row.created_at,
  }));

  return { drafts, total };
}

export async function updateDraft(
  db: D1Database,
  draftId: string,
  updates: {
    to?: any[];
    cc?: any[];
    bcc?: any[];
    replyTo?: any[];
    subject?: string;
    text?: string | null;
    html?: string | null;
  },
  inboxId?: string
): Promise<Draft | null> {
  const existing = await getDraft(db, draftId, inboxId);
  if (!existing) return null;

  const now = Date.now();
  const to = updates.to !== undefined ? updates.to : existing.to;
  const cc = updates.cc !== undefined ? updates.cc : existing.cc;
  const bcc = updates.bcc !== undefined ? updates.bcc : existing.bcc;
  const replyTo = updates.replyTo !== undefined ? updates.replyTo : existing.replyTo;
  const subject = updates.subject !== undefined ? updates.subject : existing.subject;
  const text = updates.text !== undefined ? updates.text : existing.text;
  const html = updates.html !== undefined ? updates.html : existing.html;
  const snippet = text ? text.slice(0, 160) : null;

  await db
    .prepare(
      `UPDATE messages 
       SET to_addresses = ?, cc_addresses = ?, bcc_addresses = ?, reply_to_addresses = ?,
           subject = ?, text_body = ?, html_body = ?, snippet = ?
       WHERE id = ? AND direction = 'draft'`
    )
    .bind(
      JSON.stringify(to || []),
      cc ? JSON.stringify(cc) : null,
      bcc ? JSON.stringify(bcc) : null,
      replyTo ? JSON.stringify(replyTo) : null,
      subject,
      text,
      html,
      snippet,
      draftId
    )
    .run();

  return {
    ...existing,
    to,
    cc,
    bcc,
    replyTo,
    subject,
    text,
    html,
    updatedAt: now,
  };
}

export async function sendDraft(
  db: D1Database,
  emailBinding: SendEmail,
  draftId: string,
  inboxId?: string
): Promise<Message> {
  const draft = await getDraft(db, draftId, inboxId);
  if (!draft) {
    throw new Error("Draft not found");
  }

  const inbox = await getInbox(db, draft.inboxId);
  if (!inbox) {
    throw new Error("Associated inbox not found");
  }

  const sender = {
    email: inbox.email,
    name: inbox.displayName || undefined,
  };

  const extraHeaders: Record<string, string> = {};
  if (draft.inReplyTo) {
    extraHeaders["In-Reply-To"] = draft.inReplyTo;
    extraHeaders["References"] = draft.inReplyTo;
  }

  // Dispatch email via Cloudflare Email Sending
  const outboundResult = await sendEmailViaBinding(
    emailBinding,
    sender,
    {
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      replyTo: draft.replyTo?.[0]?.email,
      subject: draft.subject,
      text: draft.text || undefined,
      html: draft.html || undefined,
    },
    extraHeaders
  );

  const now = Date.now();
  const messageIdHeader = outboundResult.messageId ? `<${outboundResult.messageId}>` : null;

  // Convert message status from draft to outbound
  await db
    .prepare(
      `UPDATE messages 
       SET direction = 'outbound', labels = '["SENT"]', message_id_header = ?
       WHERE id = ?`
    )
    .bind(messageIdHeader, draftId)
    .run();

  // Update thread
  await db
    .prepare(
      `UPDATE threads 
       SET last_message_at = ?, labels = '["INBOX", "SENT"]', updated_at = ? 
       WHERE id = ?`
    )
    .bind(now, now, draft.threadId)
    .run();

  const msg = await getMessage(db, draftId, inbox.id);
  return msg!;
}

export async function deleteDraft(
  db: D1Database,
  draftId: string,
  inboxId?: string
): Promise<boolean> {
  let query = "DELETE FROM messages WHERE id = ? AND direction = 'draft'";
  const params: any[] = [draftId];

  if (inboxId) {
    query += " AND inbox_id = ?";
    params.push(inboxId);
  }

  const res = await db.prepare(query).bind(...params).run();
  return (res.meta?.changes ?? 0) > 0;
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
  inboxId: string | null = null,
  podId: string | null = null
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
      `INSERT INTO api_keys (id, inbox_id, pod_id, name, key_hash, prefix, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(keyId, inboxId, podId, name, keyHash, prefix, now)
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
    podId: row.pod_id,
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
    podId: row.pod_id,
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

// -----------------------------
// Webhooks
// -----------------------------

export async function createWebhookRecord(
  db: D1Database,
  data: {
    id: string;
    inboxId?: string | null;
    url: string;
    events: string[];
    secret: string;
    isActive?: boolean;
  }
): Promise<Webhook> {
  const now = Date.now();
  const eventsStr = JSON.stringify(data.events || []);
  const isActiveNum = data.isActive === false ? 0 : 1;

  await db
    .prepare(
      `INSERT INTO webhooks (id, inbox_id, url, events, secret, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.inboxId || null,
      data.url,
      eventsStr,
      data.secret,
      isActiveNum,
      now,
      now
    )
    .run();

  return {
    id: data.id,
    inboxId: data.inboxId || null,
    url: data.url,
    events: data.events,
    secret: data.secret,
    isActive: isActiveNum === 1,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getWebhook(
  db: D1Database,
  webhookId: string,
  inboxId?: string
): Promise<Webhook | null> {
  let query = "SELECT * FROM webhooks WHERE id = ?";
  const params: any[] = [webhookId];

  if (inboxId) {
    query += " AND (inbox_id = ? OR inbox_id IS NULL)";
    params.push(inboxId);
  }

  const row = await db.prepare(query).bind(...params).first<any>();
  if (!row) return null;
  return mapWebhookRow(row);
}

export async function listWebhooks(
  db: D1Database,
  inboxId?: string | null,
  limit: number = 50,
  offset: number = 0
): Promise<{ webhooks: Webhook[]; total: number }> {
  let countSql = "SELECT COUNT(*) as count FROM webhooks";
  const params: any[] = [];

  if (inboxId) {
    countSql += " WHERE inbox_id = ? OR inbox_id IS NULL";
    params.push(inboxId);
  }

  const countRow = await db.prepare(countSql).bind(...params).first<{ count: number }>();
  const total = countRow?.count || 0;

  let query = "SELECT * FROM webhooks";
  if (inboxId) {
    query += " WHERE inbox_id = ? OR inbox_id IS NULL";
  }
  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  const queryParams = [...params, limit, offset];

  const results = await db.prepare(query).bind(...queryParams).all<any>();
  const webhooks = (results.results || []).map(mapWebhookRow);

  return { webhooks, total };
}

export async function updateWebhookRecord(
  db: D1Database,
  webhookId: string,
  updates: UpdateWebhookRequest,
  inboxId?: string
): Promise<Webhook | null> {
  const existing = await getWebhook(db, webhookId, inboxId);
  if (!existing) return null;

  const now = Date.now();
  const url = updates.url !== undefined ? updates.url : existing.url;
  const events = updates.events !== undefined ? updates.events : existing.events;
  const isActive = updates.isActive !== undefined ? updates.isActive : existing.isActive;

  await db
    .prepare(
      `UPDATE webhooks 
       SET url = ?, events = ?, is_active = ?, updated_at = ? 
       WHERE id = ?`
    )
    .bind(url, JSON.stringify(events), isActive ? 1 : 0, now, webhookId)
    .run();

  return {
    ...existing,
    url,
    events,
    isActive,
    updatedAt: now,
  };
}

export async function deleteWebhookRecord(
  db: D1Database,
  webhookId: string,
  inboxId?: string
): Promise<boolean> {
  let query = "DELETE FROM webhooks WHERE id = ?";
  const params: any[] = [webhookId];

  if (inboxId) {
    query += " AND (inbox_id = ? OR inbox_id IS NULL)";
    params.push(inboxId);
  }

  const res = await db.prepare(query).bind(...params).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function listActiveWebhooksForEvent(
  db: D1Database,
  eventType: string,
  inboxId: string
): Promise<Webhook[]> {
  const results = await db
    .prepare(
      `SELECT * FROM webhooks 
       WHERE is_active = 1 
         AND (inbox_id = ? OR inbox_id IS NULL) 
         AND (events LIKE ? OR events LIKE '%"*"%')`
    )
    .bind(inboxId, `%"${eventType}"%`)
    .all<any>();

  return (results.results || []).map(mapWebhookRow);
}

export async function recordWebhookDelivery(
  db: D1Database,
  data: {
    id: string;
    webhookId: string;
    eventType: string;
    payload: string;
    responseStatus?: number | null;
    responseBody?: string | null;
    durationMs?: number | null;
    error?: string | null;
  }
): Promise<WebhookDelivery> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, response_status, response_body, duration_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.webhookId,
      data.eventType,
      data.payload,
      data.responseStatus || null,
      data.responseBody || null,
      data.durationMs || null,
      data.error || null,
      now
    )
    .run();

  return {
    id: data.id,
    webhookId: data.webhookId,
    eventType: data.eventType,
    payload: data.payload,
    responseStatus: data.responseStatus || null,
    responseBody: data.responseBody || null,
    durationMs: data.durationMs || null,
    error: data.error || null,
    createdAt: now,
  };
}

export async function listWebhookDeliveries(
  db: D1Database,
  webhookId: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ deliveries: WebhookDelivery[]; total: number }> {
  const countRow = await db
    .prepare("SELECT COUNT(*) as count FROM webhook_deliveries WHERE webhook_id = ?")
    .bind(webhookId)
    .first<{ count: number }>();
  const total = countRow?.count || 0;

  const results = await db
    .prepare(
      `SELECT * FROM webhook_deliveries 
       WHERE webhook_id = ? 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`
    )
    .bind(webhookId, limit, offset)
    .all<any>();

  const deliveries = (results.results || []).map((row) => ({
    id: row.id,
    webhookId: row.webhook_id,
    eventType: row.event_type,
    payload: row.payload,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    durationMs: row.duration_ms,
    error: row.error,
    createdAt: row.created_at,
  }));

  return { deliveries, total };
}

function mapWebhookRow(row: any): Webhook {
  return {
    id: row.id,
    inboxId: row.inbox_id,
    url: row.url,
    events: row.events ? JSON.parse(row.events) : [],
    secret: row.secret,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// -----------------------------
// Pods (Multi-Tenant Isolation)
// -----------------------------

export async function createPodRecord(
  db: D1Database,
  data: {
    id: string;
    name: string;
    metadata?: Record<string, any> | null;
  }
): Promise<Pod> {
  const now = Date.now();
  const metaStr = data.metadata ? JSON.stringify(data.metadata) : null;

  await db
    .prepare(
      `INSERT INTO pods (id, name, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(data.id, data.name, metaStr, now, now)
    .run();

  return {
    id: data.id,
    name: data.name,
    metadata: data.metadata || null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getPodRecord(
  db: D1Database,
  podId: string
): Promise<Pod | null> {
  const row = await db
    .prepare("SELECT * FROM pods WHERE id = ?")
    .bind(podId)
    .first<any>();

  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPodsRecord(
  db: D1Database,
  limit: number = 50,
  offset: number = 0
): Promise<{ pods: Pod[]; total: number }> {
  const countRow = await db.prepare("SELECT COUNT(*) as count FROM pods").first<{ count: number }>();
  const total = countRow?.count || 0;

  const results = await db
    .prepare("SELECT * FROM pods ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .bind(limit, offset)
    .all<any>();

  const pods = (results.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return { pods, total };
}

export async function updatePodRecord(
  db: D1Database,
  podId: string,
  updates: UpdatePodRequest
): Promise<Pod | null> {
  const existing = await getPodRecord(db, podId);
  if (!existing) return null;

  const now = Date.now();
  let updatedName = existing.name;
  if (updates.name !== undefined) {
    updatedName = updates.name;
  }

  let updatedMetadata = existing.metadata ? { ...existing.metadata } : {};
  if (updates.metadata === null) {
    updatedMetadata = {};
  } else if (updates.metadata !== undefined) {
    for (const [k, v] of Object.entries(updates.metadata)) {
      if (v === null) delete updatedMetadata[k];
      else updatedMetadata[k] = v;
    }
  }

  const finalMetadata = Object.keys(updatedMetadata).length > 0 ? updatedMetadata : null;
  const metaStr = finalMetadata ? JSON.stringify(finalMetadata) : null;

  await db
    .prepare(
      `UPDATE pods 
       SET name = ?, metadata = ?, updated_at = ? 
       WHERE id = ?`
    )
    .bind(updatedName, metaStr, now, podId)
    .run();

  return {
    ...existing,
    name: updatedName,
    metadata: finalMetadata,
    updatedAt: now,
  };
}

export async function deletePodRecord(
  db: D1Database,
  podId: string
): Promise<boolean> {
  const res = await db.prepare("DELETE FROM pods WHERE id = ?").bind(podId).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function listInboxesByPodRecord(
  db: D1Database,
  podId: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ inboxes: Inbox[]; total: number }> {
  const countRow = await db
    .prepare("SELECT COUNT(*) as count FROM inboxes WHERE pod_id = ?")
    .bind(podId)
    .first<{ count: number }>();
  const total = countRow?.count || 0;

  const results = await db
    .prepare("SELECT * FROM inboxes WHERE pod_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .bind(podId, limit, offset)
    .all<any>();

  const inboxes = (results.results || []).map(mapInboxRow);
  return { inboxes, total };
}

// -----------------------------
// Access Rules (Allow / Block Lists)
// -----------------------------

export async function createAccessRuleRecord(
  db: D1Database,
  data: {
    id: string;
    inboxId?: string | null;
    podId?: string | null;
    ruleType: "allow" | "block";
    pattern: string;
    action?: "reject" | "spam";
  }
): Promise<AccessRule> {
  const now = Date.now();
  const action = data.action || (data.ruleType === "allow" ? "reject" : "reject");

  await db
    .prepare(
      `INSERT INTO access_rules (id, inbox_id, pod_id, rule_type, pattern, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.inboxId || null,
      data.podId || null,
      data.ruleType,
      data.pattern.toLowerCase().trim(),
      action,
      now
    )
    .run();

  return {
    id: data.id,
    inboxId: data.inboxId || null,
    podId: data.podId || null,
    ruleType: data.ruleType,
    pattern: data.pattern.toLowerCase().trim(),
    action,
    createdAt: now,
  };
}

export async function listAccessRules(
  db: D1Database,
  inboxId?: string | null,
  podId?: string | null
): Promise<AccessRule[]> {
  let query = "SELECT * FROM access_rules WHERE 1=1";
  const params: any[] = [];

  if (inboxId) {
    query += " AND (inbox_id = ? OR inbox_id IS NULL)";
    params.push(inboxId);
  }

  if (podId) {
    query += " AND (pod_id = ? OR pod_id IS NULL)";
    params.push(podId);
  }

  query += " ORDER BY created_at DESC";

  const results = await db.prepare(query).bind(...params).all<any>();

  return (results.results || []).map((row) => ({
    id: row.id,
    inboxId: row.inbox_id,
    podId: row.pod_id,
    ruleType: row.rule_type,
    pattern: row.pattern,
    action: row.action,
    createdAt: row.created_at,
  }));
}

export async function listAccessRulesForInbox(
  db: D1Database,
  inboxId: string,
  podId?: string | null
): Promise<AccessRule[]> {
  let query = "SELECT * FROM access_rules WHERE (inbox_id = ? OR inbox_id IS NULL)";
  const params: any[] = [inboxId];

  if (podId) {
    query += " OR pod_id = ?";
    params.push(podId);
  }

  query += " ORDER BY created_at DESC";

  const results = await db.prepare(query).bind(...params).all<any>();

  return (results.results || []).map((row) => ({
    id: row.id,
    inboxId: row.inbox_id,
    podId: row.pod_id,
    ruleType: row.rule_type,
    pattern: row.pattern,
    action: row.action,
    createdAt: row.created_at,
  }));
}

export async function deleteAccessRuleRecord(
  db: D1Database,
  ruleId: string,
  inboxId?: string
): Promise<boolean> {
  let query = "DELETE FROM access_rules WHERE id = ?";
  const params: any[] = [ruleId];

  if (inboxId) {
    query += " AND (inbox_id = ? OR inbox_id IS NULL)";
    params.push(inboxId);
  }

  const res = await db.prepare(query).bind(...params).run();
  return (res.meta?.changes ?? 0) > 0;
}

// -----------------------------
// AI Insights
// -----------------------------

export async function saveAiInsightRecord(
  db: D1Database,
  data: {
    id: string;
    messageId: string;
    summary: string;
    sentiment: "positive" | "neutral" | "negative";
    urgency: number;
    labels: string[];
    actionItem?: string | null;
  }
): Promise<AiInsight> {
  const now = Date.now();
  const labelsStr = JSON.stringify(data.labels || []);

  await db
    .prepare(
      `INSERT INTO ai_insights (id, message_id, summary, sentiment, urgency, labels, action_item, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET
         summary = excluded.summary,
         sentiment = excluded.sentiment,
         urgency = excluded.urgency,
         labels = excluded.labels,
         action_item = excluded.action_item`
    )
    .bind(
      data.id,
      data.messageId,
      data.summary,
      data.sentiment,
      data.urgency,
      labelsStr,
      data.actionItem || null,
      now
    )
    .run();

  return {
    id: data.id,
    messageId: data.messageId,
    summary: data.summary,
    sentiment: data.sentiment,
    urgency: data.urgency,
    labels: data.labels,
    actionItem: data.actionItem || null,
    createdAt: now,
  };
}

export async function getAiInsightRecord(
  db: D1Database,
  messageId: string
): Promise<AiInsight | null> {
  const row = await db
    .prepare("SELECT * FROM ai_insights WHERE message_id = ?")
    .bind(messageId)
    .first<any>();

  if (!row) return null;

  return {
    id: row.id,
    messageId: row.message_id,
    summary: row.summary,
    sentiment: row.sentiment,
    urgency: row.urgency,
    labels: row.labels ? JSON.parse(row.labels) : [],
    actionItem: row.action_item,
    createdAt: row.created_at,
  };
}
