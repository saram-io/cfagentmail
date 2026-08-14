import { Hono } from "hono";
import { z } from "zod";
import {
  getInbox,
  getThread,
  listThreads,
  updateThread,
  deleteThread,
  searchThreads,
  getAttachment,
} from "../db/queries";
import { getAttachmentObject } from "../services/storage";

const threadsRouter = new Hono<{ Bindings: Env }>();

const updateThreadSchema = z.object({
  labels: z.array(z.string()).optional(),
});

// GET /v1/inboxes/:inbox_id/threads/search - Full-text search in inbox
threadsRouter.get("/:inbox_id/threads/search", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const q = c.req.query("q") || "";
  const limitQuery = parseInt(c.req.query("limit") || "20", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const { results, total } = await searchThreads(c.env.DB, q, inbox.id, limit, offset);

  return c.json({
    threads: results.map((t) => ({
      thread_id: t.id,
      id: t.id,
      inbox_id: t.inboxId,
      subject: t.subject,
      snippet: t.snippet,
      last_message_at: new Date(t.lastMessageAt).toISOString(),
      message_count: t.messageCount,
      labels: t.labels,
      highlights: t.highlights,
      created_at: new Date(t.createdAt).toISOString(),
      updated_at: new Date(t.updatedAt).toISOString(),
    })),
    count: results.length,
    total,
  });
});

// GET /v1/inboxes/:inbox_id/threads - List threads in inbox
threadsRouter.get("/:inbox_id/threads", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const limitQuery = parseInt(c.req.query("limit") || "20", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const subject = c.req.query("subject");
  const labelsQuery = c.req.query("labels");
  const labels = labelsQuery ? labelsQuery.split(",").map((l) => l.trim()) : undefined;
  const ascending = c.req.query("ascending") === "true";
  const before = c.req.query("before") ? parseInt(c.req.query("before")!, 10) : undefined;
  const after = c.req.query("after") ? parseInt(c.req.query("after")!, 10) : undefined;

  const { threads, total } = await listThreads(c.env.DB, inbox.id, {
    limit,
    offset,
    subject,
    labels,
    ascending,
    before,
    after,
  });

  return c.json({
    threads: threads.map((t) => ({
      thread_id: t.id,
      id: t.id,
      inbox_id: t.inboxId,
      subject: t.subject,
      snippet: t.snippet,
      last_message_at: new Date(t.lastMessageAt).toISOString(),
      message_count: t.messageCount,
      labels: t.labels,
      created_at: new Date(t.createdAt).toISOString(),
      updated_at: new Date(t.updatedAt).toISOString(),
    })),
    count: threads.length,
    total,
    has_more: offset + threads.length < total,
  });
});

// GET /v1/inboxes/:inbox_id/threads/:thread_id - Get thread details with all messages
threadsRouter.get("/:inbox_id/threads/:thread_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const threadId = c.req.param("thread_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const thread = await getThread(c.env.DB, threadId, inbox.id);
  if (!thread) {
    return c.json({ error: { code: "NOT_FOUND", message: "Thread not found" } }, 404);
  }

  return c.json({
    thread_id: thread.id,
    id: thread.id,
    inbox_id: thread.inboxId,
    subject: thread.subject,
    snippet: thread.snippet,
    last_message_at: new Date(thread.lastMessageAt).toISOString(),
    message_count: thread.messageCount,
    labels: thread.labels,
    messages: (thread.messages || []).map((m) => ({
      message_id: m.id,
      id: m.id,
      inbox_id: m.inboxId,
      thread_id: m.threadId,
      from: m.from,
      to: m.to,
      cc: m.cc,
      bcc: m.bcc,
      subject: m.subject,
      text: m.text,
      html: m.html,
      snippet: m.snippet,
      has_attachments: m.hasAttachments,
      attachments: m.attachments?.map((a) => ({
        attachment_id: a.id,
        id: a.id,
        filename: a.filename,
        content_type: a.contentType,
        size: a.sizeBytes,
        disposition: a.disposition,
        content_id: a.contentId,
      })),
      direction: m.direction,
      labels: m.labels,
      is_read: m.isRead,
      created_at: new Date(m.createdAt).toISOString(),
    })),
    created_at: new Date(thread.createdAt).toISOString(),
    updated_at: new Date(thread.updatedAt).toISOString(),
  });
});

// GET /v1/inboxes/:inbox_id/threads/:thread_id/attachments/:attachment_id - Download thread attachment
threadsRouter.get("/:inbox_id/threads/:thread_id/attachments/:attachment_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const threadId = c.req.param("thread_id");
  const attachmentId = c.req.param("attachment_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const thread = await getThread(c.env.DB, threadId, inbox.id);
  if (!thread) {
    return c.json({ error: { code: "NOT_FOUND", message: "Thread not found" } }, 404);
  }

  const att = await getAttachment(c.env.DB, attachmentId);
  if (!att) {
    return c.json({ error: { code: "NOT_FOUND", message: "Attachment not found" } }, 404);
  }

  const r2Obj = await getAttachmentObject(c.env.ATTACHMENTS, att.r2Key);
  if (!r2Obj) {
    return c.json({ error: { code: "NOT_FOUND", message: "Attachment not found in storage" } }, 404);
  }

  return new Response(r2Obj.body as any, {
    headers: {
      "Content-Type": att.contentType,
      "Content-Disposition": `${att.disposition}; filename="${att.filename}"`,
    },
  });
});

// PATCH /v1/inboxes/:inbox_id/threads/:thread_id - Update thread
threadsRouter.patch("/:inbox_id/threads/:thread_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const threadId = c.req.param("thread_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = updateThreadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const updated = await updateThread(c.env.DB, threadId, { labels: parsed.data.labels }, inbox.id);
  if (!updated) {
    return c.json({ error: { code: "NOT_FOUND", message: "Thread not found" } }, 404);
  }

  return c.json({
    thread_id: updated.id,
    id: updated.id,
    inbox_id: updated.inboxId,
    subject: updated.subject,
    labels: updated.labels,
    updated_at: new Date(updated.updatedAt).toISOString(),
  });
});

// DELETE /v1/inboxes/:inbox_id/threads/:thread_id - Delete thread
threadsRouter.delete("/:inbox_id/threads/:thread_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const threadId = c.req.param("thread_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const deleted = await deleteThread(c.env.DB, threadId, inbox.id);
  if (!deleted) {
    return c.json({ error: { code: "NOT_FOUND", message: "Thread not found" } }, 404);
  }

  return c.json({ success: true, message: "Thread deleted" });
});

// -------------------------------------------------------------
// Organization-Wide Threads Endpoints (Supervisor / Fleet View)
// -------------------------------------------------------------

const orgThreadsRouter = new Hono<{ Bindings: Env }>();

// GET /v1/threads/search - Org-wide search
orgThreadsRouter.get("/search", async (c) => {
  const q = c.req.query("q") || "";
  const limitQuery = parseInt(c.req.query("limit") || "20", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const { results, total } = await searchThreads(c.env.DB, q, undefined, limit, offset);

  return c.json({
    threads: results.map((t) => ({
      thread_id: t.id,
      id: t.id,
      inbox_id: t.inboxId,
      subject: t.subject,
      snippet: t.snippet,
      last_message_at: new Date(t.lastMessageAt).toISOString(),
      message_count: t.messageCount,
      labels: t.labels,
      highlights: t.highlights,
      created_at: new Date(t.createdAt).toISOString(),
      updated_at: new Date(t.updatedAt).toISOString(),
    })),
    count: results.length,
    total,
  });
});

// GET /v1/threads - Org-wide list
orgThreadsRouter.get("/", async (c) => {
  const limitQuery = parseInt(c.req.query("limit") || "20", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const subject = c.req.query("subject");
  const labelsQuery = c.req.query("labels");
  const labels = labelsQuery ? labelsQuery.split(",").map((l) => l.trim()) : undefined;
  const ascending = c.req.query("ascending") === "true";
  const before = c.req.query("before") ? parseInt(c.req.query("before")!, 10) : undefined;
  const after = c.req.query("after") ? parseInt(c.req.query("after")!, 10) : undefined;

  const { threads, total } = await listThreads(c.env.DB, null, {
    limit,
    offset,
    subject,
    labels,
    ascending,
    before,
    after,
  });

  return c.json({
    threads: threads.map((t) => ({
      thread_id: t.id,
      id: t.id,
      inbox_id: t.inboxId,
      subject: t.subject,
      snippet: t.snippet,
      last_message_at: new Date(t.lastMessageAt).toISOString(),
      message_count: t.messageCount,
      labels: t.labels,
      created_at: new Date(t.createdAt).toISOString(),
      updated_at: new Date(t.updatedAt).toISOString(),
    })),
    count: threads.length,
    total,
    has_more: offset + threads.length < total,
  });
});

// GET /v1/threads/:thread_id - Org-wide get single thread
orgThreadsRouter.get("/:thread_id", async (c) => {
  const threadId = c.req.param("thread_id");
  const thread = await getThread(c.env.DB, threadId);

  if (!thread) {
    return c.json({ error: { code: "NOT_FOUND", message: "Thread not found" } }, 404);
  }

  return c.json({
    thread_id: thread.id,
    id: thread.id,
    inbox_id: thread.inboxId,
    subject: thread.subject,
    snippet: thread.snippet,
    last_message_at: new Date(thread.lastMessageAt).toISOString(),
    message_count: thread.messageCount,
    labels: thread.labels,
    messages: (thread.messages || []).map((m) => ({
      message_id: m.id,
      id: m.id,
      inbox_id: m.inboxId,
      thread_id: m.threadId,
      from: m.from,
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
      snippet: m.snippet,
      has_attachments: m.hasAttachments,
      direction: m.direction,
      labels: m.labels,
      is_read: m.isRead,
      created_at: new Date(m.createdAt).toISOString(),
    })),
    created_at: new Date(thread.createdAt).toISOString(),
    updated_at: new Date(thread.updatedAt).toISOString(),
  });
});

// DELETE /v1/threads/:thread_id - Org-wide delete thread
orgThreadsRouter.delete("/:thread_id", async (c) => {
  const threadId = c.req.param("thread_id");
  const deleted = await deleteThread(c.env.DB, threadId);

  if (!deleted) {
    return c.json({ error: { code: "NOT_FOUND", message: "Thread not found" } }, 404);
  }

  return c.json({ success: true, message: "Thread deleted" });
});

export { threadsRouter, orgThreadsRouter };
