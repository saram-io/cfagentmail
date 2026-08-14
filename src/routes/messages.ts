import { Hono } from "hono";
import { z } from "zod";
import {
  getInbox,
  createMessage,
  getMessage,
  listMessages,
  updateMessage,
  deleteMessage,
  getOrCreateThread,
  createAttachment,
  getAttachment,
  searchMessages,
} from "../db/queries";
import { sendEmailViaBinding } from "../services/email-sender";
import { saveAttachment, getAttachmentObject, getRawEmail } from "../services/storage";
import type { SendMessageRequest } from "../types";

const messagesRouter = new Hono<{ Bindings: Env }>();

const sendMessageSchema = z.object({
  to: z.union([z.string(), z.array(z.string()), z.array(z.object({ email: z.string(), name: z.string().optional() }))]),
  cc: z.union([z.string(), z.array(z.string()), z.array(z.object({ email: z.string(), name: z.string().optional() }))]).optional(),
  bcc: z.union([z.string(), z.array(z.string()), z.array(z.object({ email: z.string(), name: z.string().optional() }))]).optional(),
  replyTo: z.union([z.string(), z.object({ email: z.string(), name: z.string().optional() })]).optional(),
  subject: z.string(),
  text: z.string().optional(),
  html: z.string().optional(),
  labels: z.array(z.string()).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        content: z.string(), // base64 or text
        type: z.string().optional(),
        disposition: z.enum(["attachment", "inline"]).optional(),
        contentId: z.string().optional(),
      })
    )
    .optional(),
  headers: z.record(z.string()).optional(),
});

const replyMessageSchema = z.object({
  text: z.string().optional(),
  html: z.string().optional(),
  replyAll: z.boolean().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        content: z.string(),
        type: z.string().optional(),
        disposition: z.enum(["attachment", "inline"]).optional(),
        contentId: z.string().optional(),
      })
    )
    .optional(),
});

const updateMessageSchema = z.object({
  isRead: z.boolean().optional(),
  labels: z.array(z.string()).optional(),
});

// GET /v1/inboxes/:inbox_id/messages/search - Full-text search messages
messagesRouter.get("/:inbox_id/messages/search", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const q = c.req.query("q") || "";
  const limitQuery = parseInt(c.req.query("limit") || "20", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const { results, total } = await searchMessages(c.env.DB, q, inbox.id, limit, offset);

  return c.json({
    messages: results.map((m) => ({
      message_id: m.id,
      id: m.id,
      inbox_id: m.inboxId,
      thread_id: m.threadId,
      from: m.from,
      to: m.to,
      cc: m.cc,
      bcc: m.bcc,
      subject: m.subject,
      snippet: m.snippet,
      has_attachments: m.hasAttachments,
      direction: m.direction,
      labels: m.labels,
      is_read: m.isRead,
      highlights: m.highlights,
      created_at: new Date(m.createdAt).toISOString(),
    })),
    count: results.length,
    total,
  });
});

// POST /v1/inboxes/:inbox_id/messages - Send email
messagesRouter.post("/:inbox_id/messages", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const reqData: SendMessageRequest = parsed.data as any;
  const sender = {
    email: inbox.email,
    name: inbox.displayName || undefined,
  };

  let outboundResult;
  try {
    outboundResult = await sendEmailViaBinding(c.env.EMAIL, sender, reqData);
  } catch (err: any) {
    return c.json({ error: { code: "SEND_FAILED", message: err.message } }, 500);
  }

  const messageId = `msg_${crypto.randomUUID()}`;
  const snippet = reqData.text ? reqData.text.slice(0, 160) : reqData.html?.replace(/<[^>]*>?/gm, " ").slice(0, 160) || null;

  const thread = await getOrCreateThread(
    c.env.DB,
    inbox.id,
    reqData.subject,
    snippet,
    reqData.headers?.["In-Reply-To"],
    reqData.headers?.["References"],
    ["INBOX", "SENT"]
  );

  const normalizeToArray = (val: any) => {
    if (!val) return [];
    if (typeof val === "string") return [{ email: val }];
    if (Array.isArray(val)) {
      return val.map((v) => (typeof v === "string" ? { email: v } : v));
    }
    return [val];
  };

  const toList = normalizeToArray(reqData.to);
  const ccList = normalizeToArray(reqData.cc);
  const bccList = normalizeToArray(reqData.bcc);
  const replyToList = normalizeToArray(reqData.replyTo);
  const hasAttachments = (reqData.attachments?.length || 0) > 0;

  const created = await createMessage(c.env.DB, {
    id: messageId,
    inboxId: inbox.id,
    threadId: thread.id,
    messageIdHeader: outboundResult.messageId ? `<${outboundResult.messageId}>` : null,
    inReplyTo: reqData.headers?.["In-Reply-To"],
    referencesHeader: reqData.headers?.["References"],
    fromAddress: sender.email,
    fromName: sender.name,
    toAddresses: toList,
    ccAddresses: ccList.length > 0 ? ccList : undefined,
    bccAddresses: bccList.length > 0 ? bccList : undefined,
    replyToAddresses: replyToList.length > 0 ? replyToList : undefined,
    subject: reqData.subject,
    textBody: reqData.text || null,
    htmlBody: reqData.html || null,
    snippet,
    hasAttachments,
    direction: "outbound",
    labels: reqData.labels || ["SENT"],
    isRead: true,
  });

  if (hasAttachments && reqData.attachments) {
    for (const att of reqData.attachments) {
      const attId = `att_${crypto.randomUUID()}`;
      const r2Key = await saveAttachment(
        c.env.ATTACHMENTS,
        inbox.id,
        messageId,
        attId,
        att.filename,
        att.type || "application/octet-stream",
        att.content
      );

      await createAttachment(c.env.DB, {
        id: attId,
        messageId,
        filename: att.filename,
        contentType: att.type || "application/octet-stream",
        sizeBytes: typeof att.content === "string" ? att.content.length : 0,
        disposition: att.disposition || "attachment",
        contentId: att.contentId,
        r2Key,
      });
    }
  }

  return c.json(
    {
      message_id: created.id,
      id: created.id,
      inbox_id: created.inboxId,
      thread_id: created.threadId,
      from: created.from,
      to: created.to,
      cc: created.cc,
      bcc: created.bcc,
      subject: created.subject,
      text: created.text,
      html: created.html,
      snippet: created.snippet,
      has_attachments: created.hasAttachments,
      direction: created.direction,
      labels: created.labels,
      created_at: new Date(created.createdAt).toISOString(),
    },
    201
  );
});

// GET /v1/inboxes/:inbox_id/messages - List messages
messagesRouter.get("/:inbox_id/messages", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const limitQuery = parseInt(c.req.query("limit") || "20", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const { messages, total } = await listMessages(c.env.DB, inbox.id, limit, offset);

  return c.json({
    messages: messages.map((m) => ({
      message_id: m.id,
      id: m.id,
      inbox_id: m.inboxId,
      thread_id: m.threadId,
      from: m.from,
      to: m.to,
      cc: m.cc,
      bcc: m.bcc,
      subject: m.subject,
      snippet: m.snippet,
      has_attachments: m.hasAttachments,
      direction: m.direction,
      labels: m.labels,
      is_read: m.isRead,
      created_at: new Date(m.createdAt).toISOString(),
    })),
    count: messages.length,
    total,
    has_more: offset + messages.length < total,
  });
});

// GET /v1/inboxes/:inbox_id/messages/:message_id - Get message
messagesRouter.get("/:inbox_id/messages/:message_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const messageId = c.req.param("message_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const message = await getMessage(c.env.DB, messageId, inbox.id);
  if (!message) {
    return c.json({ error: { code: "NOT_FOUND", message: "Message not found" } }, 404);
  }

  return c.json({
    message_id: message.id,
    id: message.id,
    inbox_id: message.inboxId,
    thread_id: message.threadId,
    message_id_header: message.messageIdHeader,
    in_reply_to: message.inReplyTo,
    references: message.referencesHeader,
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    reply_to: message.replyTo,
    subject: message.subject,
    text: message.text,
    html: message.html,
    snippet: message.snippet,
    has_attachments: message.hasAttachments,
    attachments: message.attachments?.map((a) => ({
      attachment_id: a.id,
      id: a.id,
      filename: a.filename,
      content_type: a.contentType,
      size: a.sizeBytes,
      disposition: a.disposition,
      content_id: a.contentId,
    })),
    direction: message.direction,
    labels: message.labels,
    is_read: message.isRead,
    created_at: new Date(message.createdAt).toISOString(),
  });
});

// PATCH /v1/inboxes/:inbox_id/messages/:message_id - Update message labels / isRead
messagesRouter.patch("/:inbox_id/messages/:message_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const messageId = c.req.param("message_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = updateMessageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const updated = await updateMessage(c.env.DB, messageId, {
    isRead: parsed.data.isRead,
    labels: parsed.data.labels,
  }, inbox.id);

  if (!updated) {
    return c.json({ error: { code: "NOT_FOUND", message: "Message not found" } }, 404);
  }

  return c.json({
    message_id: updated.id,
    id: updated.id,
    inbox_id: updated.inboxId,
    thread_id: updated.threadId,
    is_read: updated.isRead,
    labels: updated.labels,
  });
});

// GET /v1/inboxes/:inbox_id/messages/:message_id/raw - Get raw RFC822 EML
messagesRouter.get("/:inbox_id/messages/:message_id/raw", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const messageId = c.req.param("message_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const message = await getMessage(c.env.DB, messageId, inbox.id);
  if (!message || !message.rawR2Key) {
    return c.json({ error: { code: "NOT_FOUND", message: "Raw message not available" } }, 404);
  }

  const rawObj = await getRawEmail(c.env.ATTACHMENTS, message.rawR2Key);
  if (!rawObj) {
    return c.json({ error: { code: "NOT_FOUND", message: "Raw email object not found in storage" } }, 404);
  }

  return new Response(rawObj.body as any, {
    headers: {
      "Content-Type": "message/rfc822",
      "Content-Disposition": `attachment; filename="${message.id}.eml"`,
    },
  });
});

// GET /v1/inboxes/:inbox_id/messages/:message_id/attachments/:attachment_id - Download attachment
messagesRouter.get("/:inbox_id/messages/:message_id/attachments/:attachment_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const messageId = c.req.param("message_id");
  const attachmentId = c.req.param("attachment_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const att = await getAttachment(c.env.DB, attachmentId);
  if (!att || att.messageId !== messageId) {
    return c.json({ error: { code: "NOT_FOUND", message: "Attachment not found" } }, 404);
  }

  const r2Obj = await getAttachmentObject(c.env.ATTACHMENTS, att.r2Key);
  if (!r2Obj) {
    return c.json({ error: { code: "NOT_FOUND", message: "Attachment object not found in storage" } }, 404);
  }

  return new Response(r2Obj.body as any, {
    headers: {
      "Content-Type": att.contentType,
      "Content-Disposition": `${att.disposition}; filename="${att.filename}"`,
    },
  });
});

// POST /v1/inboxes/:inbox_id/messages/:message_id/reply - Reply to message
messagesRouter.post("/:inbox_id/messages/:message_id/reply", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const messageId = c.req.param("message_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const original = await getMessage(c.env.DB, messageId, inbox.id);
  if (!original) {
    return c.json({ error: { code: "NOT_FOUND", message: "Original message not found" } }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = replyMessageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const replyTo = [original.from.email];
  const ccList: string[] = [];

  if (parsed.data.replyAll) {
    for (const recipient of original.to) {
      if (recipient.email.toLowerCase() !== inbox.email.toLowerCase() && !replyTo.includes(recipient.email)) {
        ccList.push(recipient.email);
      }
    }
    if (original.cc) {
      for (const recipient of original.cc) {
        if (recipient.email.toLowerCase() !== inbox.email.toLowerCase() && !ccList.includes(recipient.email)) {
          ccList.push(recipient.email);
        }
      }
    }
  }

  const subject = original.subject.startsWith("Re:") ? original.subject : `Re: ${original.subject}`;
  const inReplyTo = original.messageIdHeader || undefined;
  const references = [original.referencesHeader, original.messageIdHeader].filter(Boolean).join(" ") || undefined;

  const extraHeaders: Record<string, string> = {};
  if (inReplyTo) extraHeaders["In-Reply-To"] = inReplyTo;
  if (references) extraHeaders["References"] = references;

  const sendPayload: SendMessageRequest = {
    to: replyTo,
    cc: ccList.length > 0 ? ccList : undefined,
    subject,
    text: parsed.data.text,
    html: parsed.data.html,
    attachments: parsed.data.attachments,
    headers: extraHeaders,
  };

  const sender = {
    email: inbox.email,
    name: inbox.displayName || undefined,
  };

  let outboundResult;
  try {
    outboundResult = await sendEmailViaBinding(c.env.EMAIL, sender, sendPayload, extraHeaders);
  } catch (err: any) {
    return c.json({ error: { code: "SEND_FAILED", message: err.message } }, 500);
  }

  const newMsgId = `msg_${crypto.randomUUID()}`;
  const snippet = parsed.data.text ? parsed.data.text.slice(0, 160) : parsed.data.html?.replace(/<[^>]*>?/gm, " ").slice(0, 160) || null;

  await getOrCreateThread(c.env.DB, inbox.id, subject, snippet, inReplyTo, references, ["INBOX", "SENT"]);

  const created = await createMessage(c.env.DB, {
    id: newMsgId,
    inboxId: inbox.id,
    threadId: original.threadId,
    messageIdHeader: outboundResult.messageId ? `<${outboundResult.messageId}>` : null,
    inReplyTo,
    referencesHeader: references,
    fromAddress: sender.email,
    fromName: sender.name,
    toAddresses: replyTo.map((e) => ({ email: e })),
    ccAddresses: ccList.map((e) => ({ email: e })),
    subject,
    textBody: parsed.data.text || null,
    htmlBody: parsed.data.html || null,
    snippet,
    hasAttachments: (parsed.data.attachments?.length || 0) > 0,
    direction: "outbound",
    labels: ["SENT"],
    isRead: true,
  });

  return c.json(
    {
      message_id: created.id,
      id: created.id,
      inbox_id: created.inboxId,
      thread_id: created.threadId,
      from: created.from,
      to: created.to,
      subject: created.subject,
      text: created.text,
      html: created.html,
      snippet: created.snippet,
      direction: created.direction,
      labels: created.labels,
      created_at: new Date(created.createdAt).toISOString(),
    },
    201
  );
});

// DELETE /v1/inboxes/:inbox_id/messages/:message_id - Delete message
messagesRouter.delete("/:inbox_id/messages/:message_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const messageId = c.req.param("message_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const deleted = await deleteMessage(c.env.DB, messageId, inbox.id);
  if (!deleted) {
    return c.json({ error: { code: "NOT_FOUND", message: "Message not found" } }, 404);
  }

  return c.json({ success: true, message: "Message deleted" });
});

export { messagesRouter };
