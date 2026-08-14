import { Hono } from "hono";
import { z } from "zod";
import {
  getInbox,
  createApiKeyRecord,
  listApiKeysByInbox,
  deleteApiKey,
} from "../db/queries";

const apiKeysRouter = new Hono<{ Bindings: Env }>();

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
});

// POST /v1/inboxes/:inbox_id/api-keys - Create inbox-scoped key
apiKeysRouter.post("/:inbox_id/api-keys", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const { keyId, rawKey } = await createApiKeyRecord(
    c.env.DB,
    parsed.data.name,
    inbox.id
  );

  return c.json(
    {
      id: keyId,
      api_key_id: keyId,
      api_key: rawKey,
      name: parsed.data.name,
      inbox_id: inbox.id,
      created_at: new Date().toISOString(),
    },
    201
  );
});

// GET /v1/inboxes/:inbox_id/api-keys - List keys for inbox
apiKeysRouter.get("/:inbox_id/api-keys", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const keys = await listApiKeysByInbox(c.env.DB, inbox.id);

  return c.json({
    api_keys: keys.map((k) => ({
      id: k.id,
      api_key_id: k.id,
      name: k.name,
      prefix: k.prefix,
      inbox_id: k.inboxId,
      created_at: new Date(k.createdAt).toISOString(),
    })),
    count: keys.length,
  });
});

// DELETE /v1/inboxes/:inbox_id/api-keys/:key_id - Delete key
apiKeysRouter.delete("/:inbox_id/api-keys/:key_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const keyId = c.req.param("key_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const deleted = await deleteApiKey(c.env.DB, keyId, inbox.id);
  if (!deleted) {
    return c.json({ error: { code: "NOT_FOUND", message: "API key not found" } }, 404);
  }

  return c.json({ success: true, message: "API key deleted" });
});

export { apiKeysRouter };
