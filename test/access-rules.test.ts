import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb, createMockEmailMessage } from "./helpers";
import { getMessage, listMessages } from "../src/db/queries";

describe("Access Rules & Security Policies (Allow/Block Lists)", () => {
  let testInboxId: string;

  beforeEach(async () => {
    await setupTestDb();
    await clearTestDb();

    const ctx = createExecutionContext();
    const req = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "secure-agent",
        displayName: "Security Tester",
      }),
    });
    const res = await worker.fetch(req, env, ctx);
    const data = (await res.json()) as any;
    testInboxId = data.id;
  });

  it("creates, lists, and deletes access rules for an inbox", async () => {
    const ctx = createExecutionContext();

    // 1. Create block rule
    const createReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ruleType: "block",
        pattern: "*@spammer.org",
        action: "reject",
      }),
    });
    const createRes = await worker.fetch(createReq, env, ctx);
    expect(createRes.status).toBe(201);
    const rule = (await createRes.json()) as any;
    expect(rule.pattern).toBe("*@spammer.org");
    expect(rule.rule_type).toBe("block");

    // 2. List rules
    const listReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/rules`);
    const listRes = await worker.fetch(listReq, env, ctx);
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as any;
    expect(listData.count).toBe(1);
    expect(listData.rules[0].id).toBe(rule.id);

    // 3. Delete rule
    const delReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/rules/${rule.id}`, {
      method: "DELETE",
    });
    const delRes = await worker.fetch(delReq, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(delRes.status).toBe(200);
  });

  it("enforces allowlist policy on incoming emails (rejects non-whitelisted senders)", async () => {
    const ctx = createExecutionContext();

    // Add allow rule for trusted domain only
    await worker.fetch(
      new Request(`http://localhost/v1/inboxes/${testInboxId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleType: "allow",
          pattern: "@trustedpartner.com",
        }),
      }),
      env,
      ctx
    );

    // 1. Send email from untrusted sender -> should be rejected
    const untrustedEmail = createMockEmailMessage({
      from: "stranger@random.com",
      to: testInboxId,
      rawMime: `From: stranger@random.com\r\nTo: ${testInboxId}\r\nSubject: Hi\r\n\r\nTest body`,
    });
    await worker.email(untrustedEmail, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(untrustedEmail.rejected).toBeDefined();

    // Verify message was not saved
    const messagesAfterReject = await listMessages(env.DB, testInboxId);
    expect(messagesAfterReject.total).toBe(0);

    // 2. Send email from trusted sender -> should be accepted
    const trustedEmail = createMockEmailMessage({
      from: "alice@trustedpartner.com",
      to: testInboxId,
      rawMime: `From: alice@trustedpartner.com\r\nTo: ${testInboxId}\r\nSubject: Important Update\r\n\r\nPartnership details`,
    });
    await worker.email(trustedEmail, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(trustedEmail.rejected).toBeUndefined();

    const messagesAfterAllow = await listMessages(env.DB, testInboxId);
    expect(messagesAfterAllow.total).toBe(1);
  });

  it("enforces blocklist policy with spam tagging action", async () => {
    const ctx = createExecutionContext();

    // Add block rule with action: 'spam'
    await worker.fetch(
      new Request(`http://localhost/v1/inboxes/${testInboxId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleType: "block",
          pattern: "promo@marketing.com",
          action: "spam",
        }),
      }),
      env,
      ctx
    );

    // Send email from promo sender
    const spamEmail = createMockEmailMessage({
      from: "promo@marketing.com",
      to: testInboxId,
      rawMime: `From: promo@marketing.com\r\nTo: ${testInboxId}\r\nSubject: Special Offer 50% Off\r\n\r\nBuy now!`,
    });
    await worker.email(spamEmail, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(spamEmail.rejected).toBeUndefined();

    // Verify message was saved with SPAM label
    const messages = await listMessages(env.DB, testInboxId);
    expect(messages.total).toBe(1);
    const msg = messages.messages[0];
    expect(msg.labels).toContain("SPAM");
    expect(msg.isRead).toBe(true);
  });
});
