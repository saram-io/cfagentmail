import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb, createMockEmailMessage } from "./helpers";
import { getInbox, listMessages, getMessage } from "../src/db/queries";

describe("Inbound Email Ingestion Handler", () => {
  beforeEach(async () => {
    await setupTestDb();
    await clearTestDb();
  });

  it("receives an incoming email, auto-provisions inbox, parses MIME, and stores in D1 + R2", async () => {
    const rawMime = [
      'From: "Alice Sender" <alice@external.com>',
      "To: support-agent@cfagentmail.com",
      "Subject: Help needed with account",
      "Message-ID: <msg-alice-001@external.com>",
      "Date: Fri, 14 Aug 2026 12:00:00 +0000",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hi Agent, I need help resetting my API key.",
    ].join("\r\n");

    const mockEmail = createMockEmailMessage({
      from: "alice@external.com",
      to: "support-agent@cfagentmail.com",
      rawMime,
      headers: {
        "message-id": "<msg-alice-001@external.com>",
        subject: "Help needed with account",
      },
    });

    const ctx = createExecutionContext();
    await worker.email(mockEmail, env, ctx);
    await waitOnExecutionContext(ctx);

    // Verify inbox was auto-provisioned
    const inbox = await getInbox(env.DB, "support-agent@cfagentmail.com");
    expect(inbox).not.toBeNull();
    expect(inbox?.email).toBe("support-agent@cfagentmail.com");
    expect(inbox?.username).toBe("support-agent");

    // Verify message was stored in D1
    const { messages } = await listMessages(env.DB, inbox!.id);
    expect(messages.length).toBe(1);
    const msg = messages[0];
    expect(msg.subject).toBe("Help needed with account");
    expect(msg.from.email).toBe("alice@external.com");
    expect(msg.from.name).toBe("Alice Sender");
    expect(msg.direction).toBe("inbound");
    expect(msg.text).toContain("I need help resetting my API key.");
    expect(msg.rawR2Key).toBeDefined();

    // Verify raw MIME in R2
    const fullMsg = await getMessage(env.DB, msg.id, inbox!.id);
    expect(fullMsg?.rawR2Key).toBe(`raw/${inbox!.id}/${msg.id}.eml`);
    const r2Raw = await env.ATTACHMENTS.get(fullMsg!.rawR2Key!);
    expect(r2Raw).not.toBeNull();
    const rawText = await r2Raw!.text();
    expect(rawText).toContain("Help needed with account");
  });

  it("handles incoming email with attachments and stores them in R2", async () => {
    const boundary = "boundary123";
    const rawMime = [
      "From: bob@external.com",
      "To: files-agent@cfagentmail.com",
      "Subject: Project Documents",
      "Message-ID: <msg-bob-002@external.com>",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      "Please find the report attached.",
      `--${boundary}`,
      'Content-Type: text/csv; name="report.csv"',
      'Content-Disposition: attachment; filename="report.csv"',
      "",
      "id,name,value\n1,Widget,42",
      `--${boundary}--`,
    ].join("\r\n");

    const mockEmail = createMockEmailMessage({
      from: "bob@external.com",
      to: "files-agent@cfagentmail.com",
      rawMime,
    });

    const ctx = createExecutionContext();
    await worker.email(mockEmail, env, ctx);
    await waitOnExecutionContext(ctx);

    const inbox = await getInbox(env.DB, "files-agent@cfagentmail.com");
    const { messages } = await listMessages(env.DB, inbox!.id);
    const msg = messages[0];

    expect(msg.hasAttachments).toBe(true);

    const fullMsg = await getMessage(env.DB, msg.id, inbox!.id);
    expect(fullMsg?.attachments?.length).toBe(1);
    expect(fullMsg?.attachments?.[0].filename).toBe("report.csv");
    expect(fullMsg?.attachments?.[0].contentType).toBe("text/csv");

    // Check attachment in R2
    const attObj = await env.ATTACHMENTS.get(fullMsg!.attachments![0].r2Key);
    expect(attObj).not.toBeNull();
    const attContent = await attObj!.text();
    expect(attContent.trim()).toBe("id,name,value\n1,Widget,42");
  });

  it("links reply to existing thread via In-Reply-To header", async () => {
    // 1. Initial message
    const rawMime1 = [
      "From: alice@external.com",
      "To: support@cfagentmail.com",
      "Subject: Thread test",
      "Message-ID: <msg-thread-1@external.com>",
      "Content-Type: text/plain",
      "",
      "Initial question",
    ].join("\r\n");

    const mockEmail1 = createMockEmailMessage({
      from: "alice@external.com",
      to: "support@cfagentmail.com",
      rawMime: rawMime1,
      headers: { "message-id": "<msg-thread-1@external.com>" },
    });

    const ctx1 = createExecutionContext();
    await worker.email(mockEmail1, env, ctx1);
    await waitOnExecutionContext(ctx1);

    // 2. Reply message with In-Reply-To
    const rawMime2 = [
      "From: alice@external.com",
      "To: support@cfagentmail.com",
      "Subject: Re: Thread test",
      "Message-ID: <msg-thread-2@external.com>",
      "In-Reply-To: <msg-thread-1@external.com>",
      "References: <msg-thread-1@external.com>",
      "Content-Type: text/plain",
      "",
      "Follow-up details",
    ].join("\r\n");

    const mockEmail2 = createMockEmailMessage({
      from: "alice@external.com",
      to: "support@cfagentmail.com",
      rawMime: rawMime2,
      headers: {
        "message-id": "<msg-thread-2@external.com>",
        "in-reply-to": "<msg-thread-1@external.com>",
      },
    });

    const ctx2 = createExecutionContext();
    await worker.email(mockEmail2, env, ctx2);
    await waitOnExecutionContext(ctx2);

    const inbox = await getInbox(env.DB, "support@cfagentmail.com");
    const { messages } = await listMessages(env.DB, inbox!.id);

    expect(messages.length).toBe(2);
    // Both messages should share the same thread_id!
    expect(messages[0].threadId).toBe(messages[1].threadId);
  });
});
