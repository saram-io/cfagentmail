import { Hono } from "hono";
import { z } from "zod";
import {
  createInbox,
  getInbox,
  listInboxes,
  updateInbox,
  deleteInbox,
} from "../db/queries";

const inboxesRouter = new Hono<{ Bindings: Env }>();

const createInboxSchema = z.object({
  username: z.string().min(1).max(64).optional(),
  domain: z.string().min(1).max(255).optional(),
  displayName: z.string().max(255).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  clientId: z.string().max(255).optional(),
});

const updateInboxSchema = z.object({
  displayName: z.string().max(255).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable().optional(),
});

// POST /v1/inboxes - Create inbox
inboxesRouter.post("/", async (c) => {
  let body: any = {};
  try {
    const text = await c.req.text();
    if (text) {
      body = JSON.parse(text);
    }
  } catch {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, 400);
  }

  const parsed = createInboxSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const domain = parsed.data.domain || c.env.DEFAULT_DOMAIN || "cfagentmail.com";
  const username =
    parsed.data.username ||
    `agent_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

  const email = `${username}@${domain}`.toLowerCase();
  const id = email;

  const inbox = await createInbox(c.env.DB, {
    id,
    email,
    username,
    domain,
    displayName: parsed.data.displayName || null,
    metadata: parsed.data.metadata || null,
    clientId: parsed.data.clientId || null,
  });

  return c.json(
    {
      inbox_id: inbox.id,
      id: inbox.id,
      email: inbox.email,
      username: inbox.username,
      domain: inbox.domain,
      display_name: inbox.displayName,
      metadata: inbox.metadata,
      created_at: new Date(inbox.createdAt).toISOString(),
      updated_at: new Date(inbox.updatedAt).toISOString(),
    },
    201
  );
});

// GET /v1/inboxes - List inboxes
inboxesRouter.get("/", async (c) => {
  const limitQuery = parseInt(c.req.query("limit") || "20", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const { inboxes, total } = await listInboxes(c.env.DB, limit, offset);

  return c.json({
    inboxes: inboxes.map((inbox) => ({
      inbox_id: inbox.id,
      id: inbox.id,
      email: inbox.email,
      username: inbox.username,
      domain: inbox.domain,
      display_name: inbox.displayName,
      metadata: inbox.metadata,
      created_at: new Date(inbox.createdAt).toISOString(),
      updated_at: new Date(inbox.updatedAt).toISOString(),
    })),
    count: inboxes.length,
    total,
    has_more: offset + inboxes.length < total,
  });
});

// GET /v1/inboxes/:inbox_id - Get inbox
inboxesRouter.get("/:inbox_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);

  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  return c.json({
    inbox_id: inbox.id,
    id: inbox.id,
    email: inbox.email,
    username: inbox.username,
    domain: inbox.domain,
    display_name: inbox.displayName,
    metadata: inbox.metadata,
    created_at: new Date(inbox.createdAt).toISOString(),
    updated_at: new Date(inbox.updatedAt).toISOString(),
  });
});

// PATCH /v1/inboxes/:inbox_id - Update inbox
inboxesRouter.patch("/:inbox_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const body = await c.req.json().catch(() => ({}));

  const parsed = updateInboxSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const updated = await updateInbox(c.env.DB, inboxId, {
    displayName: parsed.data.displayName,
    metadata: parsed.data.metadata,
  });

  if (!updated) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  return c.json({
    inbox_id: updated.id,
    id: updated.id,
    email: updated.email,
    username: updated.username,
    domain: updated.domain,
    display_name: updated.displayName,
    metadata: updated.metadata,
    created_at: new Date(updated.createdAt).toISOString(),
    updated_at: new Date(updated.updatedAt).toISOString(),
  });
});

// DELETE /v1/inboxes/:inbox_id - Delete inbox
inboxesRouter.delete("/:inbox_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const deleted = await deleteInbox(c.env.DB, inboxId);

  if (!deleted) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  return c.json({ success: true, message: "Inbox deleted" });
});

export { inboxesRouter };
