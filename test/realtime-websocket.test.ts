import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb } from "./helpers";

describe("Real-Time WebSockets via Durable Object Hibernation", () => {
  let testInboxId: string;

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
        username: "realtime-agent",
        displayName: "Realtime Tester",
      }),
    });
    const res = await worker.fetch(req, env, ctx);
    const data = (await res.json()) as any;
    testInboxId = data.id;
  });

  it("upgrades HTTP connection to WebSocket on inbox-scoped stream", async () => {
    const ctx = createExecutionContext();

    const wsReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/ws`, {
      headers: {
        Upgrade: "websocket",
      },
    });

    const wsRes = await worker.fetch(wsReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(wsRes.status).toBe(101);
    expect(wsRes.webSocket).toBeDefined();

    const ws = wsRes.webSocket!;
    ws.accept();

    // Receive initial connection message
    const messages: any[] = [];
    ws.addEventListener("message", (evt) => {
      messages.push(JSON.parse(evt.data as string));
    });

    // Send a ping to test hibernation message handler
    ws.send(JSON.stringify({ type: "ping" }));

    // Wait a brief tick for message processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].type).toBe("connected");
  });

  it("broadcasts real-time events to connected WebSocket clients when email is received or sent", async () => {
    const ctx = createExecutionContext();

    // Connect WebSocket
    const wsReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/ws`, {
      headers: { Upgrade: "websocket" },
    });
    const wsRes = await worker.fetch(wsReq, env, ctx);
    const ws = wsRes.webSocket!;
    ws.accept();

    const receivedEvents: any[] = [];
    ws.addEventListener("message", (evt) => {
      const data = JSON.parse(evt.data as string);
      receivedEvents.push(data);
    });

    // Send an outbound email from the inbox
    const sendReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["client@example.com"],
        subject: "Realtime Notification Test",
        text: "Testing WebSocket push events.",
      }),
    });
    await worker.fetch(sendReq, env, ctx);
    await waitOnExecutionContext(ctx);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify email.sent event was received over WebSocket
    const sentEvent = receivedEvents.find((e) => e.type === "email.sent");
    expect(sentEvent).toBeDefined();
    expect(sentEvent.inboxId).toBe(testInboxId);
    expect(sentEvent.data.subject).toBe("Realtime Notification Test");
  });

  it("handles org-wide global WebSocket stream", async () => {
    const ctx = createExecutionContext();

    const wsReq = new Request("http://localhost/v1/ws", {
      headers: { Upgrade: "websocket" },
    });
    const wsRes = await worker.fetch(wsReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(wsRes.status).toBe(101);
    expect(wsRes.webSocket).toBeDefined();

    const ws = wsRes.webSocket!;
    ws.accept();

    const receivedEvents: any[] = [];
    ws.addEventListener("message", (evt) => {
      receivedEvents.push(JSON.parse(evt.data as string));
    });

    // Broadcast direct event to org_global DO
    const id = env.REALTIME_DO.idFromName("org_global");
    const stub = env.REALTIME_DO.get(id);
    await stub.broadcastEvent({
      type: "email.received",
      inboxId: testInboxId,
      timestamp: Date.now(),
      data: { subject: "Global Alert" },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const globalEvent = receivedEvents.find((e) => e.type === "email.received");
    expect(globalEvent).toBeDefined();
    expect(globalEvent.data.subject).toBe("Global Alert");
  });
});
