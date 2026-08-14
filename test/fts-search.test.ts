import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb } from "./helpers";

describe("SQLite FTS5 Full-Text Search", () => {
  let inbox1Id: string;
  let inbox2Id: string;

  beforeEach(async () => {
    await setupTestDb();
    await clearTestDb();

    // Mock env.EMAIL.send
    (env.EMAIL as any) = {
      send: vi.fn().mockResolvedValue({ messageId: `msg_${crypto.randomUUID()}` }),
    };

    const ctx = createExecutionContext();

    // Create Inbox 1
    const req1 = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "sales-agent" }),
    });
    const res1 = await worker.fetch(req1, env, ctx);
    const data1 = (await res1.json()) as any;
    inbox1Id = data1.id;

    // Create Inbox 2
    const req2 = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "support-agent" }),
    });
    const res2 = await worker.fetch(req2, env, ctx);
    const data2 = (await res2.json()) as any;
    inbox2Id = data2.id;

    // Insert Email 1 in Inbox 1: Invoice related
    const send1 = new Request(`http://localhost/v1/inboxes/${inbox1Id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["finance@client.com"],
        subject: "Quarterly Invoice INV-2026-Q3",
        text: "Please find attached your invoice for services rendered in Q3.",
      }),
    });
    await worker.fetch(send1, env, ctx);

    // Insert Email 2 in Inbox 2: Database outage
    const send2 = new Request(`http://localhost/v1/inboxes/${inbox2Id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["devops@team.com"],
        subject: "Database Cluster Migration Error",
        text: "The PostgreSQL database replica failed during cluster migration.",
      }),
    });
    await worker.fetch(send2, env, ctx);

    // Insert Email 3 in Inbox 1: Contract renewal
    const send3 = new Request(`http://localhost/v1/inboxes/${inbox1Id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["legal@client.com"],
        subject: "Enterprise Contract Renewal Agreement",
        text: "We are excited to discuss the annual contract renewal with terms.",
      }),
    });
    await worker.fetch(send3, env, ctx);
    await waitOnExecutionContext(ctx);
  });

  it("searches threads within a specific inbox with keyword highlights", async () => {
    const ctx = createExecutionContext();

    const searchReq = new Request(
      `http://localhost/v1/inboxes/${inbox1Id}/threads/search?q=invoice`
    );
    const searchRes = await worker.fetch(searchReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(searchRes.status).toBe(200);
    const data = (await searchRes.json()) as any;

    expect(data.count).toBe(1);
    expect(data.threads[0].subject).toBe("Quarterly Invoice INV-2026-Q3");

    // Check keyword highlight wrapping
    expect(data.threads[0].highlights).toBeDefined();
    const subjectHighlight = data.threads[0].highlights.subject?.[0];
    const textHighlight = data.threads[0].highlights.text?.[0];

    expect(
      (subjectHighlight && subjectHighlight.includes("**Invoice**")) ||
      (textHighlight && textHighlight.includes("**invoice**"))
    ).toBe(true);
  });

  it("performs org-wide full-text search across all inboxes", async () => {
    const ctx = createExecutionContext();

    const searchReq = new Request("http://localhost/v1/threads/search?q=migration");
    const searchRes = await worker.fetch(searchReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(searchRes.status).toBe(200);
    const data = (await searchRes.json()) as any;

    expect(data.count).toBe(1);
    expect(data.threads[0].subject).toBe("Database Cluster Migration Error");
    expect(data.threads[0].inbox_id).toBe(inbox2Id);
  });

  it("searches messages with keyword highlights", async () => {
    const ctx = createExecutionContext();

    const msgSearchReq = new Request(
      `http://localhost/v1/inboxes/${inbox1Id}/messages/search?q=contract`
    );
    const msgSearchRes = await worker.fetch(msgSearchReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(msgSearchRes.status).toBe(200);
    const data = (await msgSearchRes.json()) as any;

    expect(data.count).toBe(1);
    expect(data.messages[0].subject).toBe("Enterprise Contract Renewal Agreement");
    expect(data.messages[0].highlights).toBeDefined();
  });
});
