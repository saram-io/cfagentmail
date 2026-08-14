import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb } from "./helpers";

describe("Multi-Tenant Pods REST API & Authorization", () => {
  beforeEach(async () => {
    await setupTestDb();
    await clearTestDb();
  });

  it("creates, lists, updates, and deletes a pod", async () => {
    const ctx = createExecutionContext();

    // 1. Create pod
    const createReq = new Request("http://localhost/v1/pods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Acme Corp Fleet",
        metadata: { tier: "enterprise", region: "us-east" },
      }),
    });
    const createRes = await worker.fetch(createReq, env, ctx);
    expect(createRes.status).toBe(201);
    const createdPod = (await createRes.json()) as any;
    expect(createdPod.name).toBe("Acme Corp Fleet");
    expect(createdPod.metadata.tier).toBe("enterprise");

    // 2. List pods
    const listReq = new Request("http://localhost/v1/pods");
    const listRes = await worker.fetch(listReq, env, ctx);
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as any;
    expect(listData.count).toBe(1);
    expect(listData.pods[0].id).toBe(createdPod.id);

    // 3. Get pod
    const getReq = new Request(`http://localhost/v1/pods/${createdPod.id}`);
    const getRes = await worker.fetch(getReq, env, ctx);
    expect(getRes.status).toBe(200);
    const retrievedPod = (await getRes.json()) as any;
    expect(retrievedPod.id).toBe(createdPod.id);

    // 4. Update pod
    const patchReq = new Request(`http://localhost/v1/pods/${createdPod.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Acme Corp Global Fleet",
        metadata: { tier: "enterprise-plus" },
      }),
    });
    const patchRes = await worker.fetch(patchReq, env, ctx);
    expect(patchRes.status).toBe(200);
    const updatedPod = (await patchRes.json()) as any;
    expect(updatedPod.name).toBe("Acme Corp Global Fleet");
    expect(updatedPod.metadata.tier).toBe("enterprise-plus");

    // 5. Delete pod
    const delReq = new Request(`http://localhost/v1/pods/${createdPod.id}`, {
      method: "DELETE",
    });
    const delRes = await worker.fetch(delReq, env, ctx);
    expect(delRes.status).toBe(200);

    // 6. Verify deleted
    const getAfterReq = new Request(`http://localhost/v1/pods/${createdPod.id}`);
    const getAfterRes = await worker.fetch(getAfterReq, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(getAfterRes.status).toBe(404);
  });

  it("provisions inboxes within a pod and enforces pod-scoped API key authorization", async () => {
    const ctx = createExecutionContext();

    // 1. Create Pod A and Pod B
    const podARes = await worker.fetch(
      new Request("http://localhost/v1/pods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Pod Alpha" }),
      }),
      env,
      ctx
    );
    const podA = (await podARes.json()) as any;

    const podBRes = await worker.fetch(
      new Request("http://localhost/v1/pods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Pod Beta" }),
      }),
      env,
      ctx
    );
    const podB = (await podBRes.json()) as any;

    // 2. Create Inbox in Pod A
    const inboxARes = await worker.fetch(
      new Request("http://localhost/v1/inboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "agent-alpha-1",
          podId: podA.id,
        }),
      }),
      env,
      ctx
    );
    const inboxA = (await inboxARes.json()) as any;
    expect(inboxA.pod_id).toBe(podA.id);

    // 3. Create Inbox in Pod B
    const inboxBRes = await worker.fetch(
      new Request("http://localhost/v1/inboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "agent-beta-1",
          podId: podB.id,
        }),
      }),
      env,
      ctx
    );
    const inboxB = (await inboxBRes.json()) as any;
    expect(inboxB.pod_id).toBe(podB.id);

    // 4. List inboxes in Pod A
    const listPodAInboxesRes = await worker.fetch(
      new Request(`http://localhost/v1/pods/${podA.id}/inboxes`),
      env,
      ctx
    );
    const podAInboxes = (await listPodAInboxesRes.json()) as any;
    expect(podAInboxes.count).toBe(1);
    expect(podAInboxes.inboxes[0].id).toBe(inboxA.id);

    // 5. Create Pod A-scoped API Key
    const keyRes = await worker.fetch(
      new Request(`http://localhost/v1/pods/${podA.id}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Pod A Fleet Key" }),
      }),
      env,
      ctx
    );
    expect(keyRes.status).toBe(201);
    const keyData = (await keyRes.json()) as any;
    const podAKey = keyData.api_key;

    // 6. Access Inbox A using Pod A Key -> Allowed (200)
    const accessInboxARes = await worker.fetch(
      new Request(`http://localhost/v1/inboxes/${inboxA.id}`, {
        headers: { Authorization: `Bearer ${podAKey}` },
      }),
      env,
      ctx
    );
    expect(accessInboxARes.status).toBe(200);

    // 7. Access Inbox B using Pod A Key -> Forbidden (403)
    const accessInboxBRes = await worker.fetch(
      new Request(`http://localhost/v1/inboxes/${inboxB.id}`, {
        headers: { Authorization: `Bearer ${podAKey}` },
      }),
      env,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(accessInboxBRes.status).toBe(403);
  });
});
