import { Hono } from "hono";
import { z } from "zod";
import {
  createPodRecord,
  getPodRecord,
  listPodsRecord,
  updatePodRecord,
  deletePodRecord,
  listInboxesByPodRecord,
  createApiKeyRecord,
} from "../db/queries";

const podsRouter = new Hono<{ Bindings: Env }>();

const createPodSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

const updatePodSchema = z.object({
  name: z.string().min(1).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable().optional(),
});

const createPodKeySchema = z.object({
  name: z.string().min(1),
});

// POST /v1/pods - Create pod
podsRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createPodSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const podId = parsed.data.id || `pod_${crypto.randomUUID()}`;
  const pod = await createPodRecord(c.env.DB, {
    id: podId,
    name: parsed.data.name,
    metadata: parsed.data.metadata,
  });

  return c.json(
    {
      pod_id: pod.id,
      id: pod.id,
      name: pod.name,
      metadata: pod.metadata,
      created_at: new Date(pod.createdAt).toISOString(),
      updated_at: new Date(pod.updatedAt).toISOString(),
    },
    201
  );
});

// GET /v1/pods - List pods
podsRouter.get("/", async (c) => {
  const limitQuery = parseInt(c.req.query("limit") || "50", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const { pods, total } = await listPodsRecord(c.env.DB, limit, offset);

  return c.json({
    pods: pods.map((p) => ({
      pod_id: p.id,
      id: p.id,
      name: p.name,
      metadata: p.metadata,
      created_at: new Date(p.createdAt).toISOString(),
      updated_at: new Date(p.updatedAt).toISOString(),
    })),
    count: pods.length,
    total,
    has_more: offset + pods.length < total,
  });
});

// GET /v1/pods/:pod_id - Get pod
podsRouter.get("/:pod_id", async (c) => {
  const podId = c.req.param("pod_id");
  const pod = await getPodRecord(c.env.DB, podId);
  if (!pod) {
    return c.json({ error: { code: "NOT_FOUND", message: "Pod not found" } }, 404);
  }

  return c.json({
    pod_id: pod.id,
    id: pod.id,
    name: pod.name,
    metadata: pod.metadata,
    created_at: new Date(pod.createdAt).toISOString(),
    updated_at: new Date(pod.updatedAt).toISOString(),
  });
});

// PATCH /v1/pods/:pod_id - Update pod
podsRouter.patch("/:pod_id", async (c) => {
  const podId = c.req.param("pod_id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = updatePodSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const updated = await updatePodRecord(c.env.DB, podId, {
    name: parsed.data.name,
    metadata: parsed.data.metadata,
  });

  if (!updated) {
    return c.json({ error: { code: "NOT_FOUND", message: "Pod not found" } }, 404);
  }

  return c.json({
    pod_id: updated.id,
    id: updated.id,
    name: updated.name,
    metadata: updated.metadata,
    updated_at: new Date(updated.updatedAt).toISOString(),
  });
});

// DELETE /v1/pods/:pod_id - Delete pod
podsRouter.delete("/:pod_id", async (c) => {
  const podId = c.req.param("pod_id");
  const deleted = await deletePodRecord(c.env.DB, podId);

  if (!deleted) {
    return c.json({ error: { code: "NOT_FOUND", message: "Pod not found" } }, 404);
  }

  return c.json({ success: true, message: "Pod deleted" });
});

// GET /v1/pods/:pod_id/inboxes - List all inboxes in pod
podsRouter.get("/:pod_id/inboxes", async (c) => {
  const podId = c.req.param("pod_id");
  const pod = await getPodRecord(c.env.DB, podId);
  if (!pod) {
    return c.json({ error: { code: "NOT_FOUND", message: "Pod not found" } }, 404);
  }

  const limitQuery = parseInt(c.req.query("limit") || "50", 10);
  const limit = Math.min(Math.max(limitQuery, 1), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const { inboxes, total } = await listInboxesByPodRecord(c.env.DB, pod.id, limit, offset);

  return c.json({
    inboxes: inboxes.map((i) => ({
      inbox_id: i.id,
      id: i.id,
      pod_id: i.podId,
      email: i.email,
      username: i.username,
      domain: i.domain,
      display_name: i.displayName,
      metadata: i.metadata,
      created_at: new Date(i.createdAt).toISOString(),
      updated_at: new Date(i.updatedAt).toISOString(),
    })),
    count: inboxes.length,
    total,
    has_more: offset + inboxes.length < total,
  });
});

// POST /v1/pods/:pod_id/api-keys - Create pod-scoped API key
podsRouter.post("/:pod_id/api-keys", async (c) => {
  const podId = c.req.param("pod_id");
  const pod = await getPodRecord(c.env.DB, podId);
  if (!pod) {
    return c.json({ error: { code: "NOT_FOUND", message: "Pod not found" } }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = createPodKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const { keyId, rawKey } = await createApiKeyRecord(c.env.DB, parsed.data.name, null, pod.id);

  return c.json(
    {
      id: keyId,
      api_key_id: keyId,
      api_key: rawKey,
      apiKey: rawKey,
      name: parsed.data.name,
      pod_id: pod.id,
      created_at: new Date().toISOString(),
    },
    201
  );
});

export { podsRouter };
