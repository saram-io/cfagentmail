import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb } from "./helpers";
import { computeHmacSha256 } from "../src/services/webhook-dispatcher";

describe("Webhooks & HMAC Event Dispatching", () => {
  let testInboxId: string;
  let originalFetch: any;

  beforeEach(async () => {
    await setupTestDb();
    await clearTestDb();

    // Mock env.EMAIL.send
    (env.EMAIL as any) = {
      send: vi.fn().mockResolvedValue({ messageId: `msg_${crypto.randomUUID()}` }),
    };

    const ctx = createExecutionContext();
    const req = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "webhooks-agent",
        displayName: "Webhooks Tester",
      }),
    });
    const res = await worker.fetch(req, env, ctx);
    const data = (await res.json()) as any;
    testInboxId = data.id;

    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("creates, retrieves, updates, and deletes a webhook subscription", async () => {
    const ctx = createExecutionContext();

    // 1. Create webhook
    const createReq = new Request("http://localhost/v1/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://api.myagent.com/webhook",
        events: ["email.received", "email.sent"],
        inboxId: testInboxId,
        secret: "my-super-secret-key",
      }),
    });
    const createRes = await worker.fetch(createReq, env, ctx);
    expect(createRes.status).toBe(201);
    const webhook = (await createRes.json()) as any;
    expect(webhook.url).toBe("https://api.myagent.com/webhook");
    expect(webhook.secret).toBe("my-super-secret-key");
    expect(webhook.is_active).toBe(true);

    // 2. Get webhook
    const getReq = new Request(`http://localhost/v1/webhooks/${webhook.id}`);
    const getRes = await worker.fetch(getReq, env, ctx);
    expect(getRes.status).toBe(200);
    const retrieved = (await getRes.json()) as any;
    expect(retrieved.id).toBe(webhook.id);

    // 3. Update webhook (disable and change URL)
    const patchReq = new Request(`http://localhost/v1/webhooks/${webhook.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://api.myagent.com/v2/webhook",
        isActive: false,
      }),
    });
    const patchRes = await worker.fetch(patchReq, env, ctx);
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as any;
    expect(updated.url).toBe("https://api.myagent.com/v2/webhook");
    expect(updated.is_active).toBe(false);

    // 4. Delete webhook
    const delReq = new Request(`http://localhost/v1/webhooks/${webhook.id}`, {
      method: "DELETE",
    });
    const delRes = await worker.fetch(delReq, env, ctx);
    expect(delRes.status).toBe(200);

    // 5. Verify deleted
    const getAfterReq = new Request(`http://localhost/v1/webhooks/${webhook.id}`);
    const getAfterRes = await worker.fetch(getAfterReq, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(getAfterRes.status).toBe(404);
  });

  it("dispatches signed webhook request and records delivery logs", async () => {
    const ctx = createExecutionContext();

    const dispatchedRequests: { url: string; headers: Headers; body: string }[] = [];

    // Mock fetch for webhook target endpoint
    globalThis.fetch = vi.fn().mockImplementation(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("api.agentendpoint.com")) {
        dispatchedRequests.push({
          url,
          headers: new Headers(init?.headers),
          body: init?.body as string,
        });
        return new Response(JSON.stringify({ status: "received" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });

    const secret = "whsec_live_test123456";

    // 1. Create active webhook
    const createReq = new Request("http://localhost/v1/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://api.agentendpoint.com/webhook",
        events: ["email.sent"],
        inboxId: testInboxId,
        secret,
      }),
    });
    const createRes = await worker.fetch(createReq, env, ctx);
    const webhook = (await createRes.json()) as any;

    // 2. Send an outbound email to trigger the webhook
    const sendReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["user@external.com"],
        subject: "Webhook Trigger Test Email",
        text: "This email should trigger an email.sent webhook.",
      }),
    });
    await worker.fetch(sendReq, env, ctx);
    await waitOnExecutionContext(ctx);

    // 3. Verify webhook was dispatched
    expect(dispatchedRequests.length).toBe(1);
    const dispatched = dispatchedRequests[0];
    expect(dispatched.url).toBe("https://api.agentendpoint.com/webhook");

    const signatureHeader = dispatched.headers.get("X-CFAgentMail-Signature");
    expect(signatureHeader).not.toBeNull();
    expect(signatureHeader).toContain("t=");
    expect(signatureHeader).toContain("v1=");

    // Verify HMAC-SHA256 signature mathematically
    const sigParts = Object.fromEntries(
      signatureHeader!.split(",").map((part) => part.split("=") as [string, string])
    );
    const computedSig = await computeHmacSha256(
      secret,
      `${sigParts.t}.${dispatched.body}`
    );
    expect(sigParts.v1).toBe(computedSig);

    // 4. Verify delivery was logged in webhook_deliveries table
    const deliveriesReq = new Request(
      `http://localhost/v1/webhooks/${webhook.id}/deliveries`
    );
    const deliveriesRes = await worker.fetch(deliveriesReq, env, ctx);
    expect(deliveriesRes.status).toBe(200);
    const deliveriesData = (await deliveriesRes.json()) as any;

    expect(deliveriesData.count).toBe(1);
    expect(deliveriesData.deliveries[0].event_type).toBe("email.sent");
    expect(deliveriesData.deliveries[0].response_status).toBe(200);
  });
});
