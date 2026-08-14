import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb } from "./helpers";

describe("Inboxes REST API", () => {
  beforeEach(async () => {
    await setupTestDb();
    await clearTestDb();
  });

  it("creates a new inbox with custom username and domain", async () => {
    const ctx = createExecutionContext();
    const req = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "test-agent",
        domain: "customdomain.com",
        displayName: "Test Agent",
        metadata: { role: "support", level: 1 },
      }),
    });

    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.email).toBe("test-agent@customdomain.com");
    expect(data.username).toBe("test-agent");
    expect(data.domain).toBe("customdomain.com");
    expect(data.display_name).toBe("Test Agent");
    expect(data.metadata).toEqual({ role: "support", level: 1 });
  });

  it("creates an inbox with auto-generated username and default domain", async () => {
    const ctx = createExecutionContext();
    const req = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.email).toContain("@cfagentmail.com");
    expect(data.username).toMatch(/^agent_/);
  });

  it("enforces idempotency with clientId", async () => {
    const ctx1 = createExecutionContext();
    const req1 = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "idempotent-agent",
        clientId: "client-req-123",
      }),
    });

    const res1 = await worker.fetch(req1, env, ctx1);
    await waitOnExecutionContext(ctx1);
    const data1 = (await res1.json()) as any;

    const ctx2 = createExecutionContext();
    const req2 = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "different-agent",
        clientId: "client-req-123",
      }),
    });

    const res2 = await worker.fetch(req2, env, ctx2);
    await waitOnExecutionContext(ctx2);
    const data2 = (await res2.json()) as any;

    expect(data2.id).toBe(data1.id);
    expect(data2.email).toBe("idempotent-agent@cfagentmail.com");
  });

  it("retrieves an existing inbox by id and email", async () => {
    const ctx = createExecutionContext();
    const createReq = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "lookup-agent" }),
    });
    const createRes = await worker.fetch(createReq, env, ctx);
    const created = (await createRes.json()) as any;

    const getReq = new Request(`http://localhost/v1/inboxes/${created.email}`);
    const getRes = await worker.fetch(getReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(getRes.status).toBe(200);
    const data = (await getRes.json()) as any;
    expect(data.id).toBe(created.id);
    expect(data.email).toBe("lookup-agent@cfagentmail.com");
  });

  it("updates inbox display name and merges metadata", async () => {
    const ctx = createExecutionContext();
    const createReq = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "update-agent",
        metadata: { tag: "v1", env: "test" },
      }),
    });
    const createRes = await worker.fetch(createReq, env, ctx);
    const created = (await createRes.json()) as any;

    const updateReq = new Request(`http://localhost/v1/inboxes/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "Updated Agent",
        metadata: { env: "prod", version: "2.0", tag: null },
      }),
    });
    const updateRes = await worker.fetch(updateReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as any;
    expect(updated.display_name).toBe("Updated Agent");
    expect(updated.metadata).toEqual({ env: "prod", version: "2.0" });
  });

  it("lists inboxes with pagination", async () => {
    const ctx = createExecutionContext();
    for (let i = 1; i <= 3; i++) {
      const createReq = new Request("http://localhost/v1/inboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: `agent-${i}` }),
      });
      await worker.fetch(createReq, env, ctx);
    }

    const listReq = new Request("http://localhost/v1/inboxes?limit=2");
    const listRes = await worker.fetch(listReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(listRes.status).toBe(200);
    const data = (await listRes.json()) as any;
    expect(data.count).toBe(2);
    expect(data.total).toBe(3);
    expect(data.has_more).toBe(true);
  });

  it("deletes an inbox", async () => {
    const ctx = createExecutionContext();
    const createReq = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "delete-me" }),
    });
    const createRes = await worker.fetch(createReq, env, ctx);
    const created = (await createRes.json()) as any;

    const deleteReq = new Request(`http://localhost/v1/inboxes/${created.id}`, {
      method: "DELETE",
    });
    const deleteRes = await worker.fetch(deleteReq, env, ctx);
    expect(deleteRes.status).toBe(200);

    const getReq = new Request(`http://localhost/v1/inboxes/${created.id}`);
    const getRes = await worker.fetch(getReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(getRes.status).toBe(404);
  });
});
