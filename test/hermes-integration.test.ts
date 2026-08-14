import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb } from "./helpers";
import { computeHmacSha256 } from "../src/services/webhook-dispatcher";

describe("Hermes Agent Local Tunnel & Webhook Integration", () => {
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
        username: "hermes-bot",
        displayName: "Hermes Agent",
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

  it("dispatches webhook to Cloudflare Tunnel URL and verifies HMAC for Hermes bridge", async () => {
    const ctx = createExecutionContext();
    const secret = "whsec_hermes_tunnel_secret_999";
    const tunnelUrl = "https://brave-falcon-123.trycloudflare.com/webhook";

    const receivedPayloads: { url: string; headers: Headers; body: string }[] = [];

    // Mock Cloudflare Tunnel HTTP endpoint
    globalThis.fetch = vi.fn().mockImplementation(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === tunnelUrl) {
        receivedPayloads.push({
          url,
          headers: new Headers(init?.headers),
          body: init?.body as string,
        });
        return new Response(JSON.stringify({ status: "success", agent: "hermes" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });

    // 1. Register Webhook with Cloudflare Tunnel URL
    const createReq = new Request("http://localhost/v1/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: tunnelUrl,
        events: ["email.sent", "email.received"],
        inboxId: testInboxId,
        secret,
      }),
    });
    const createRes = await worker.fetch(createReq, env, ctx);
    expect(createRes.status).toBe(201);
    const webhook = (await createRes.json()) as any;

    // 2. Trigger test webhook ping (POST /v1/webhooks/:webhook_id/test)
    const testReq = new Request(`http://localhost/v1/webhooks/${webhook.id}/test`, {
      method: "POST",
    });
    const testRes = await worker.fetch(testReq, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(testRes.status).toBe(200);

    // 3. Verify tunnel received the request with valid signature
    expect(receivedPayloads.length).toBe(1);
    const payload = receivedPayloads[0];
    expect(payload.url).toBe(tunnelUrl);

    const sigHeader = payload.headers.get("X-CFAgentMail-Signature");
    expect(sigHeader).toBeDefined();

    const parts = Object.fromEntries(
      sigHeader!.split(",").map((p) => p.split("=") as [string, string])
    );
    const expectedSig = await computeHmacSha256(secret, `${parts.t}.${payload.body}`);
    expect(parts.v1).toBe(expectedSig);

    const parsedEvent = JSON.parse(payload.body);
    expect(parsedEvent.type).toBe("email.received");
  });
});
