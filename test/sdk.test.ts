import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb } from "./helpers";
import { CFAgentMail } from "../src/sdk";

describe("Official TypeScript SDK (CFAgentMailClient)", () => {
  let client: CFAgentMail;

  beforeEach(async () => {
    await setupTestDb();
    await clearTestDb();

    // Mock env.EMAIL.send
    (env.EMAIL as any) = {
      send: vi.fn().mockResolvedValue({ messageId: `msg_${crypto.randomUUID()}` }),
    };

    // Custom fetch directing SDK calls straight to Worker
    const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const ctx = createExecutionContext();
      const req = new Request(url, init);
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);
      return res;
    };

    client = new CFAgentMail({
      baseUrl: "http://localhost/v1",
      fetch: customFetch as any,
    });
  });

  it("provisions an inbox, sends a message, searches threads, and stages drafts via SDK", async () => {
    // 1. Create Inbox
    const inbox = await client.inboxes.create({
      username: "sdk-agent",
      displayName: "SDK Test Agent",
      metadata: { env: "testing" },
    });
    expect(inbox.email).toBe("sdk-agent@cfagentmail.com");

    // 2. Create Scoped API Key
    const keyResp = await client.inboxes.createApiKey(inbox.id, {
      name: "SDK Agent Key",
    });
    expect(keyResp.apiKey).toContain("am_live_");

    // 3. Send Outbound Message
    const msg = await client.messages.send(inbox.id, {
      to: ["recipient@example.com"],
      subject: "SDK Invoice Q3 Notification",
      text: "Please find your quarterly invoice information attached.",
    });
    expect(msg.subject).toBe("SDK Invoice Q3 Notification");
    expect(msg.direction).toBe("outbound");

    // 4. Reply to Message
    const reply = await client.messages.reply(inbox.id, msg.id, {
      text: "Follow up on previous invoice notice.",
    });
    expect(reply.threadId).toBe(msg.threadId);

    // 5. Search Threads via FTS5
    const searchResults = await client.threads.search(inbox.id, "invoice");
    expect(searchResults.count).toBeGreaterThanOrEqual(1);
    expect(searchResults.threads[0].highlights?.subject?.[0]).toContain("**Invoice**");

    // 6. Stage and Send Draft (HITL)
    const draft = await client.drafts.create(inbox.id, {
      to: ["partner@enterprise.com"],
      subject: "Draft Partnership Proposal",
      text: "Review required before sending.",
    });
    expect(draft.id).toBeDefined();

    const sentDraftMsg = await client.drafts.send(inbox.id, draft.id);
    expect(sentDraftMsg.direction).toBe("outbound");

    // 7. Multi-Tenant Pods via SDK
    const pod = await client.pods.create({
      name: "Enterprise Fleet Pod",
      metadata: { region: "us-west" },
    });
    expect(pod.name).toBe("Enterprise Fleet Pod");

    const podsList = await client.pods.list();
    expect(podsList.count).toBe(1);

    // 8. Access Rules via SDK
    const rule = await client.rules.create(inbox.id, {
      ruleType: "allow",
      pattern: "@trustedcorp.com",
    });
    expect(rule.pattern).toBe("@trustedcorp.com");

    const rulesList = await client.rules.list(inbox.id);
    expect(rulesList.count).toBe(1);

    // 9. Webhooks via SDK
    const webhook = await client.webhooks.create({
      url: "https://api.external.com/webhook",
      events: ["email.received"],
      inboxId: inbox.id,
      secret: "whsec_sdk_test",
    });
    expect(webhook.url).toBe("https://api.external.com/webhook");

    const webhooksList = await client.webhooks.list();
    expect(webhooksList.count).toBe(1);
  });
});
