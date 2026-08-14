import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb, createMockEmailMessage } from "./helpers";
import { listMessages } from "../src/db/queries";

describe("Workers AI Auto-Labeling & Email Intelligence", () => {
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
        username: "ai-agent",
        displayName: "AI Triage Agent",
      }),
    });
    const res = await worker.fetch(req, env, ctx);
    const data = (await res.json()) as any;
    testInboxId = data.id;
  });

  it("automatically analyzes inbound emails and applies AI labels and insights", async () => {
    const ctx = createExecutionContext();

    // Inbound urgent billing email
    const email = createMockEmailMessage({
      from: "customer@corp.com",
      to: testInboxId,
      rawMime: `From: customer@corp.com\r\nTo: ${testInboxId}\r\nSubject: URGENT: Billing error on invoice #9021\r\n\r\nHello, we received an unexpected charge on our credit card for invoice #9021. Please investigate immediately. Thank you!`,
    });

    await worker.email(email, env, ctx);
    await waitOnExecutionContext(ctx);

    // Retrieve saved message
    const msgList = await listMessages(env.DB, testInboxId);
    expect(msgList.total).toBe(1);
    const msg = msgList.messages[0];

    // Verify AI labels were automatically merged
    expect(msg.labels).toContain("URGENT");
    expect(msg.labels).toContain("BILLING");

    // Fetch AI insight endpoint
    const insightReq = new Request(
      `http://localhost/v1/inboxes/${testInboxId}/messages/${msg.id}/insight`
    );
    const insightRes = await worker.fetch(insightReq, env, ctx);
    expect(insightRes.status).toBe(200);

    const insight = (await insightRes.json()) as any;
    expect(insight.message_id).toBe(msg.id);
    expect(insight.urgency).toBeGreaterThanOrEqual(4);
    expect(insight.labels).toContain("URGENT");
    expect(insight.labels).toContain("BILLING");
    expect(insight.action_item).toBeDefined();
  });

  it("supports on-demand AI analysis endpoint POST /analyze", async () => {
    const ctx = createExecutionContext();

    // Inbound general message
    const email = createMockEmailMessage({
      from: "lead@prospective.com",
      to: testInboxId,
      rawMime: `From: lead@prospective.com\r\nTo: ${testInboxId}\r\nSubject: Enterprise Pricing and Demo Request\r\n\r\nWe would love to schedule a demo for our enterprise team of 500 engineers.`,
    });

    await worker.email(email, env, ctx);
    await waitOnExecutionContext(ctx);

    const msgList = await listMessages(env.DB, testInboxId);
    const msg = msgList.messages[0];

    // Trigger on-demand analysis
    const analyzeReq = new Request(
      `http://localhost/v1/inboxes/${testInboxId}/messages/${msg.id}/analyze`,
      { method: "POST" }
    );
    const analyzeRes = await worker.fetch(analyzeReq, env, ctx);
    expect(analyzeRes.status).toBe(200);

    const analyzeData = (await analyzeRes.json()) as any;
    expect(analyzeData.labels).toContain("SALES");
    expect(analyzeData.action_item).toContain("proposal");
  });
});
