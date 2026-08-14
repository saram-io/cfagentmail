import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb } from "./helpers";

describe("Scoped API Keys REST API & Auth Middleware", () => {
  let inbox1Id: string;
  let inbox2Id: string;

  beforeEach(async () => {
    await setupTestDb();
    await clearTestDb();

    // Create Inbox 1
    const ctx1 = createExecutionContext();
    const req1 = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "tenant1-agent" }),
    });
    const res1 = await worker.fetch(req1, env, ctx1);
    const data1 = (await res1.json()) as any;
    inbox1Id = data1.id;

    // Create Inbox 2
    const ctx2 = createExecutionContext();
    const req2 = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "tenant2-agent" }),
    });
    const res2 = await worker.fetch(req2, env, ctx2);
    const data2 = (await res2.json()) as any;
    inbox2Id = data2.id;
  });

  it("creates an inbox-scoped API key and accesses allowed inbox", async () => {
    const ctx = createExecutionContext();

    // 1. Create scoped API key for inbox 1
    const keyReq = new Request(`http://localhost/v1/inboxes/${inbox1Id}/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Inbox 1 Scoped Key" }),
    });
    const keyRes = await worker.fetch(keyReq, env, ctx);
    expect(keyRes.status).toBe(201);
    const keyData = (await keyRes.json()) as any;
    expect(keyData.api_key).toMatch(/^am_live_/);
    expect(keyData.inbox_id).toBe(inbox1Id);

    const apiKey = keyData.api_key;

    // 2. Access inbox 1 with the scoped API key -> Should succeed (200)
    const accessInbox1Req = new Request(`http://localhost/v1/inboxes/${inbox1Id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const accessInbox1Res = await worker.fetch(accessInbox1Req, env, ctx);
    expect(accessInbox1Res.status).toBe(200);

    // 3. Attempt to access inbox 2 with the scoped API key -> Should be rejected (403 Forbidden)
    const accessInbox2Req = new Request(`http://localhost/v1/inboxes/${inbox2Id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const accessInbox2Res = await worker.fetch(accessInbox2Req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(accessInbox2Res.status).toBe(403);
    const err = (await accessInbox2Res.json()) as any;
    expect(err.error.code).toBe("FORBIDDEN");
  });

  it("lists and deletes scoped API keys", async () => {
    const ctx = createExecutionContext();

    // Create a key
    const createReq = new Request(`http://localhost/v1/inboxes/${inbox1Id}/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Temporary Key" }),
    });
    const createRes = await worker.fetch(createReq, env, ctx);
    const createdKey = (await createRes.json()) as any;

    // List keys
    const listReq = new Request(`http://localhost/v1/inboxes/${inbox1Id}/api-keys`);
    const listRes = await worker.fetch(listReq, env, ctx);
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as any;
    expect(listData.count).toBe(1);
    expect(listData.api_keys[0].name).toBe("Temporary Key");

    // Delete key
    const delReq = new Request(
      `http://localhost/v1/inboxes/${inbox1Id}/api-keys/${createdKey.id}`,
      { method: "DELETE" }
    );
    const delRes = await worker.fetch(delReq, env, ctx);
    expect(delRes.status).toBe(200);

    // List again -> count should be 0
    const listAfterRes = await worker.fetch(listReq, env, ctx);
    await waitOnExecutionContext(ctx);
    const listAfterData = (await listAfterRes.json()) as any;
    expect(listAfterData.count).toBe(0);
  });
});
