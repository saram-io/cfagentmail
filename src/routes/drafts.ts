import { Hono } from "hono";
import { z } from "zod";
import {
  getInbox,
  createDraft,
  getDraft,
  listDrafts,
  updateDraft,
  deleteDraft,
  sendDraft,
  createAttachment,
} from "../db/queries";
import { saveAttachment } from "../services/storage";

const draftsRouter = new Hono<{ Bindings: Env }>();

const draftRecipientSchema = z.union([
  z.string(),
  z.object({ email: z.string(), name: z.string().optional() }),
]);

const createDraftSchema = z.object({
  to: z.union([z.string(), z.array(draftRecipientSchema)]).optional(),
  cc: z.union([z.string(), z.array(draftRecipientSchema)]).optional(),
  bcc: z.union([z.string(), z.array(draftRecipientSchema)]).optional(),
  replyTo: draftRecipientSchema.optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  inReplyTo: z.string().optional(),
  threadId: z.string().optional(),
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

const updateDraftSchema = z.object({
  to: z.union([z.string(), z.array(draftRecipientSchema)]).optional(),
  cc: z.union([z.string(), z.array(draftRecipientSchema)]).optional(),
  bcc: z.union([z.string(), z.array(draftRecipientSchema)]).optional(),
  replyTo: draftRecipientSchema.optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
});

const normalizeRecipients = (val: any) => {
  if (!val) return [];
  if (typeof val === "string") return [{ email: val }];
  if (Array.isArray(val)) {
    return val.map((v) => (typeof v === "string" ? { email: v } : v));
  }
  return [val];
};

// POST /v1/inboxes/:inbox_id/drafts - Create draft
draftsRouter.post("/:inbox_id/drafts", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = createDraftSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const draftId = `draft_${crypto.randomUUID()}`;
  const toList = normalizeRecipients(parsed.data.to);
  const ccList = normalizeRecipients(parsed.data.cc);
  const bccList = normalizeRecipients(parsed.data.bcc);
  const replyToList = normalizeRecipients(parsed.data.replyTo);
  const hasAttachments = (parsed.data.attachments?.length || 0) > 0;

  const draft = await createDraft(c.env.DB, {
    id: draftId,
    inboxId: inbox.id,
    threadId: parsed.data.threadId,
    to: toList,
    cc: ccList.length > 0 ? ccList : undefined,
    bcc: bccList.length > 0 ? bccList : undefined,
    replyTo: replyToList.length > 0 ? replyToList : undefined,
    subject: parsed.data.subject,
    text: parsed.data.text,
    html: parsed.data.html,
    inReplyTo: parsed.data.inReplyTo,
    hasAttachments,
  });

  // Save attachments
  if (hasAttachments && parsed.data.attachments) {
    for (const att of parsed.data.attachments) {
      const attId = `att_${crypto.randomUUID()}`;
      const r2Key = await saveAttachment(
        c.env.ATTACHMENTS,
        inbox.id,
        draftId,
        attId,
        att.filename,
        att.type || "application/octet-stream",
        att.content
      );

      await createAttachment(c.env.DB, {
        id: attId,
        messageId: draftId,
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
      draft_id: draft.id,
      id: draft.id,
      inbox_id: draft.inboxId,
      thread_id: draft.threadId,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      reply_to: draft.replyTo,
      subject: draft.subject,
      text: draft.text,
      html: draft.html,
      in_reply_to: draft.inReplyTo,
      has_attachments: draft.hasAttachments,
      created_at: new Date(draft.createdAt).toISOString(),
      updated_at: new Date(draft.updatedAt).toISOString(),
    },
    201
  );
});

// GET /v1/inboxes/:inbox_id/drafts - List drafts
draftsRouter.get("/:inbox_id/drafts", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const limitQuery = parseInt(c.req.query("limit") || "20", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const { drafts, total } = await listDrafts(c.env.DB, inbox.id, limit, offset);

  return c.json({
    drafts: drafts.map((d) => ({
      draft_id: d.id,
      id: d.id,
      inbox_id: d.inboxId,
      thread_id: d.threadId,
      to: d.to,
      subject: d.subject,
      text: d.text,
      has_attachments: d.hasAttachments,
      created_at: new Date(d.createdAt).toISOString(),
      updated_at: new Date(d.updatedAt).toISOString(),
    })),
    count: drafts.length,
    total,
    has_more: offset + drafts.length < total,
  });
});

// GET /v1/inboxes/:inbox_id/drafts/:draft_id - Get draft
draftsRouter.get("/:inbox_id/drafts/:draft_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const draftId = c.req.param("draft_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const draft = await getDraft(c.env.DB, draftId, inbox.id);
  if (!draft) {
    return c.json({ error: { code: "NOT_FOUND", message: "Draft not found" } }, 404);
  }

  return c.json({
    draft_id: draft.id,
    id: draft.id,
    inbox_id: draft.inboxId,
    thread_id: draft.threadId,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    reply_to: draft.replyTo,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
    in_reply_to: draft.inReplyTo,
    has_attachments: draft.hasAttachments,
    attachments: draft.attachments?.map((a) => ({
      attachment_id: a.id,
      id: a.id,
      filename: a.filename,
      content_type: a.contentType,
      size: a.sizeBytes,
    })),
    created_at: new Date(draft.createdAt).toISOString(),
    updated_at: new Date(draft.updatedAt).toISOString(),
  });
});

// PATCH /v1/inboxes/:inbox_id/drafts/:draft_id - Update draft
draftsRouter.patch("/:inbox_id/drafts/:draft_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const draftId = c.req.param("draft_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = updateDraftSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const toList = parsed.data.to ? normalizeRecipients(parsed.data.to) : undefined;
  const ccList = parsed.data.cc ? normalizeRecipients(parsed.data.cc) : undefined;
  const bccList = parsed.data.bcc ? normalizeRecipients(parsed.data.bcc) : undefined;
  const replyToList = parsed.data.replyTo ? normalizeRecipients(parsed.data.replyTo) : undefined;

  const updated = await updateDraft(
    c.env.DB,
    draftId,
    {
      to: toList,
      cc: ccList,
      bcc: bccList,
      replyTo: replyToList,
      subject: parsed.data.subject,
      text: parsed.data.text,
      html: parsed.data.html,
    },
    inbox.id
  );

  if (!updated) {
    return c.json({ error: { code: "NOT_FOUND", message: "Draft not found" } }, 404);
  }

  return c.json({
    draft_id: updated.id,
    id: updated.id,
    inbox_id: updated.inboxId,
    thread_id: updated.threadId,
    to: updated.to,
    cc: updated.cc,
    bcc: updated.bcc,
    reply_to: updated.replyTo,
    subject: updated.subject,
    text: updated.text,
    html: updated.html,
    updated_at: new Date(updated.updatedAt).toISOString(),
  });
});

// DELETE /v1/inboxes/:inbox_id/drafts/:draft_id - Delete draft
draftsRouter.delete("/:inbox_id/drafts/:draft_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const draftId = c.req.param("draft_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const deleted = await deleteDraft(c.env.DB, draftId, inbox.id);
  if (!deleted) {
    return c.json({ error: { code: "NOT_FOUND", message: "Draft not found" } }, 404);
  }

  return c.json({ success: true, message: "Draft discarded" });
});

// POST /v1/inboxes/:inbox_id/drafts/:draft_id/send - Send draft (Human-In-The-Loop execution)
draftsRouter.post("/:inbox_id/drafts/:draft_id/send", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const draftId = c.req.param("draft_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  try {
    const sentMessage = await sendDraft(c.env.DB, c.env.EMAIL, draftId, inbox.id);
    return c.json({
      message_id: sentMessage.id,
      id: sentMessage.id,
      inbox_id: sentMessage.inboxId,
      thread_id: sentMessage.threadId,
      from: sentMessage.from,
      to: sentMessage.to,
      subject: sentMessage.subject,
      text: sentMessage.text,
      html: sentMessage.html,
      direction: sentMessage.direction,
      labels: sentMessage.labels,
      created_at: new Date(sentMessage.createdAt).toISOString(),
    });
  } catch (err: any) {
    return c.json({ error: { code: "SEND_DRAFT_FAILED", message: err.message } }, 400);
  }
});

// -------------------------------------------------------------
// Organization-Wide Drafts Endpoints
// -------------------------------------------------------------

const orgDraftsRouter = new Hono<{ Bindings: Env }>();

// GET /v1/drafts - Org-wide list drafts
orgDraftsRouter.get("/", async (c) => {
  const limitQuery = parseInt(c.req.query("limit") || "20", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const { drafts, total } = await listDrafts(c.env.DB, null, limit, offset);

  return c.json({
    drafts: drafts.map((d) => ({
      draft_id: d.id,
      id: d.id,
      inbox_id: d.inboxId,
      thread_id: d.threadId,
      to: d.to,
      subject: d.subject,
      text: d.text,
      has_attachments: d.hasAttachments,
      created_at: new Date(d.createdAt).toISOString(),
      updated_at: new Date(d.updatedAt).toISOString(),
    })),
    count: drafts.length,
    total,
    has_more: offset + drafts.length < total,
  });
});

// GET /v1/drafts/:draft_id - Org-wide get draft
orgDraftsRouter.get("/:draft_id", async (c) => {
  const draftId = c.req.param("draft_id");
  const draft = await getDraft(c.env.DB, draftId);

  if (!draft) {
    return c.json({ error: { code: "NOT_FOUND", message: "Draft not found" } }, 404);
  }

  return c.json({
    draft_id: draft.id,
    id: draft.id,
    inbox_id: draft.inboxId,
    thread_id: draft.threadId,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    reply_to: draft.replyTo,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
    in_reply_to: draft.inReplyTo,
    has_attachments: draft.hasAttachments,
    created_at: new Date(draft.createdAt).toISOString(),
    updated_at: new Date(draft.updatedAt).toISOString(),
  });
});

export { draftsRouter, orgDraftsRouter };
