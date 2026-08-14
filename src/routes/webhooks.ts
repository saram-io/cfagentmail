import { Hono } from "hono";
import { z } from "zod";
import {
  createWebhookRecord,
  getWebhook,
  listWebhooks,
  updateWebhookRecord,
  deleteWebhookRecord,
  listWebhookDeliveries,
  getInbox,
} from "../db/queries";
import { dispatchWebhookEvents } from "../services/webhook-dispatcher";

const webhooksRouter = new Hono<{ Bindings: Env }>();

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).default(["*"]),
  inboxId: z.string().optional(),
  secret: z.string().optional(),
});

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

// POST /v1/webhooks - Create webhook
webhooksRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  let inboxId: string | null = null;
  if (parsed.data.inboxId) {
    const inbox = await getInbox(c.env.DB, parsed.data.inboxId);
    if (!inbox) {
      return c.json({ error: { code: "NOT_FOUND", message: "Target inbox not found" } }, 404);
    }
    inboxId = inbox.id;
  }

  const webhookId = `wh_${crypto.randomUUID()}`;
  const secret = parsed.data.secret || `whsec_${crypto.randomUUID().replace(/-/g, "")}`;

  const webhook = await createWebhookRecord(c.env.DB, {
    id: webhookId,
    inboxId,
    url: parsed.data.url,
    events: parsed.data.events,
    secret,
    isActive: true,
  });

  return c.json(
    {
      webhook_id: webhook.id,
      id: webhook.id,
      inbox_id: webhook.inboxId,
      url: webhook.url,
      events: webhook.events,
      secret: webhook.secret,
      is_active: webhook.isActive,
      created_at: new Date(webhook.createdAt).toISOString(),
      updated_at: new Date(webhook.updatedAt).toISOString(),
    },
    201
  );
});

// GET /v1/webhooks - List webhooks
webhooksRouter.get("/", async (c) => {
  const inboxId = c.req.query("inbox_id") || undefined;
  const limitQuery = parseInt(c.req.query("limit") || "50", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const { webhooks, total } = await listWebhooks(c.env.DB, inboxId, limit, offset);

  return c.json({
    webhooks: webhooks.map((w) => ({
      webhook_id: w.id,
      id: w.id,
      inbox_id: w.inboxId,
      url: w.url,
      events: w.events,
      secret: w.secret,
      is_active: w.isActive,
      created_at: new Date(w.createdAt).toISOString(),
      updated_at: new Date(w.updatedAt).toISOString(),
    })),
    count: webhooks.length,
    total,
    has_more: offset + webhooks.length < total,
  });
});

// GET /v1/webhooks/:webhook_id - Get webhook
webhooksRouter.get("/:webhook_id", async (c) => {
  const webhookId = c.req.param("webhook_id");
  const webhook = await getWebhook(c.env.DB, webhookId);

  if (!webhook) {
    return c.json({ error: { code: "NOT_FOUND", message: "Webhook not found" } }, 404);
  }

  return c.json({
    webhook_id: webhook.id,
    id: webhook.id,
    inbox_id: webhook.inboxId,
    url: webhook.url,
    events: webhook.events,
    secret: webhook.secret,
    is_active: webhook.isActive,
    created_at: new Date(webhook.createdAt).toISOString(),
    updated_at: new Date(webhook.updatedAt).toISOString(),
  });
});

// PATCH /v1/webhooks/:webhook_id - Update webhook
webhooksRouter.patch("/:webhook_id", async (c) => {
  const webhookId = c.req.param("webhook_id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const updated = await updateWebhookRecord(c.env.DB, webhookId, {
    url: parsed.data.url,
    events: parsed.data.events,
    isActive: parsed.data.isActive,
  });

  if (!updated) {
    return c.json({ error: { code: "NOT_FOUND", message: "Webhook not found" } }, 404);
  }

  return c.json({
    webhook_id: updated.id,
    id: updated.id,
    inbox_id: updated.inboxId,
    url: updated.url,
    events: updated.events,
    is_active: updated.isActive,
    updated_at: new Date(updated.updatedAt).toISOString(),
  });
});

// DELETE /v1/webhooks/:webhook_id - Delete webhook
webhooksRouter.delete("/:webhook_id", async (c) => {
  const webhookId = c.req.param("webhook_id");
  const deleted = await deleteWebhookRecord(c.env.DB, webhookId);

  if (!deleted) {
    return c.json({ error: { code: "NOT_FOUND", message: "Webhook not found" } }, 404);
  }

  return c.json({ success: true, message: "Webhook deleted" });
});

// GET /v1/webhooks/:webhook_id/deliveries - List deliveries
webhooksRouter.get("/:webhook_id/deliveries", async (c) => {
  const webhookId = c.req.param("webhook_id");
  const webhook = await getWebhook(c.env.DB, webhookId);
  if (!webhook) {
    return c.json({ error: { code: "NOT_FOUND", message: "Webhook not found" } }, 404);
  }

  const limitQuery = parseInt(c.req.query("limit") || "20", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const { deliveries, total } = await listWebhookDeliveries(c.env.DB, webhook.id, limit, offset);

  return c.json({
    deliveries: deliveries.map((d) => ({
      delivery_id: d.id,
      id: d.id,
      webhook_id: d.webhookId,
      event_type: d.eventType,
      payload: JSON.parse(d.payload),
      response_status: d.responseStatus,
      duration_ms: d.durationMs,
      error: d.error,
      created_at: new Date(d.createdAt).toISOString(),
    })),
    count: deliveries.length,
    total,
    has_more: offset + deliveries.length < total,
  });
});

// POST /v1/webhooks/:webhook_id/test - Trigger test webhook
webhooksRouter.post("/:webhook_id/test", async (c) => {
  const webhookId = c.req.param("webhook_id");
  const webhook = await getWebhook(c.env.DB, webhookId);
  if (!webhook) {
    return c.json({ error: { code: "NOT_FOUND", message: "Webhook not found" } }, 404);
  }

  const targetInboxId = webhook.inboxId || "test-agent@cfagentmail.com";
  await dispatchWebhookEvents(c.env.DB, "email.received", targetInboxId, {
    test: true,
    message: "Test webhook event triggered from CFAgentMail",
  });

  return c.json({
    success: true,
    message: "Test event dispatched",
  });
});

export { webhooksRouter };
