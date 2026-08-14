import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb } from "./helpers";

describe("Conversation Threading REST API", () => {
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
      body: JSON.stringify({ username: "agent-threads-1" }),
    });
    const res1 = await worker.fetch(req1, env, ctx);
    const data1 = (await res1.json()) as any;
    inbox1Id = data1.id;

    // Create Inbox 2
    const req2 = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "agent-threads-2" }),
    });
    const res2 = await worker.fetch(req2, env, ctx);
    const data2 = (await res2.json()) as any;
    inbox2Id = data2.id;
  });

  it("lists threads scoped to an inbox and across the whole organization", async () => {
    const ctx = createExecutionContext();

    // Send an email in Inbox 1 (initiates thread 1)
    const sendReq1 = new Request(`http://localhost/v1/inboxes/${inbox1Id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["clientA@example.com"],
        subject: "Thread A Subject",
        text: "Message in thread A",
      }),
    });
    await worker.fetch(sendReq1, env, ctx);

    // Send an email in Inbox 2 (initiates thread 2)
    const sendReq2 = new Request(`http://localhost/v1/inboxes/${inbox2Id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["clientB@example.com"],
        subject: "Thread B Subject",
        text: "Message in thread B",
      }),
    });
    await worker.fetch(sendReq2, env, ctx);
    await waitOnExecutionContext(ctx);

    // 1. List threads in Inbox 1 -> should have 1 thread
    const listInbox1Req = new Request(`http://localhost/v1/inboxes/${inbox1Id}/threads`);
    const listInbox1Res = await worker.fetch(listInbox1Req, env, ctx);
    expect(listInbox1Res.status).toBe(200);
    const inbox1Data = (await listInbox1Res.json()) as any;
    expect(inbox1Data.count).toBe(1);
    expect(inbox1Data.threads[0].subject).toBe("Thread A Subject");

    // 2. List threads Org-wide -> should have 2 threads across both inboxes
    const listOrgReq = new Request("http://localhost/v1/threads");
    const listOrgRes = await worker.fetch(listOrgReq, env, ctx);
    expect(listOrgRes.status).toBe(200);
    const orgData = (await listOrgRes.json()) as any;
    expect(orgData.count).toBe(2);
  });

  it("retrieves a thread with its messages in chronological order", async () => {
    const ctx = createExecutionContext();

    // 1. Send initial message
    const sendReq = new Request(`http://localhost/v1/inboxes/${inbox1Id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["client@example.com"],
        subject: "Project Kickoff",
        text: "Initial kickoff email.",
      }),
    });
    const sendRes = await worker.fetch(sendReq, env, ctx);
    const msg1 = (await sendRes.json()) as any;

    // 2. Send a reply to message 1
    const replyReq = new Request(
      `http://localhost/v1/inboxes/${inbox1Id}/messages/${msg1.id}/reply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Reply follow-up email.",
        }),
      }
    );
    const replyRes = await worker.fetch(replyReq, env, ctx);
    const msg2 = (await replyRes.json()) as any;
    await waitOnExecutionContext(ctx);

    // 3. Get thread by ID
    const getThreadReq = new Request(
      `http://localhost/v1/inboxes/${inbox1Id}/threads/${msg1.thread_id}`
    );
    const getThreadRes = await worker.fetch(getThreadReq, env, ctx);
    expect(getThreadRes.status).toBe(200);
    const thread = (await getThreadRes.json()) as any;

    expect(thread.id).toBe(msg1.thread_id);
    expect(thread.message_count).toBe(2);
    expect(thread.messages.length).toBe(2);
    expect(thread.messages[0].id).toBe(msg1.id);
    expect(thread.messages[1].id).toBe(msg2.id);
  });

  it("updates thread labels and deletes thread", async () => {
    const ctx = createExecutionContext();

    const sendReq = new Request(`http://localhost/v1/inboxes/${inbox1Id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["client@example.com"],
        subject: "Status Update",
        text: "Everything on track.",
      }),
    });
    const sendRes = await worker.fetch(sendReq, env, ctx);
    const msg = (await sendRes.json()) as any;

    // Update thread labels
    const patchReq = new Request(
      `http://localhost/v1/inboxes/${inbox1Id}/threads/${msg.thread_id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labels: ["INBOX", "IMPORTANT", "PROJECT_X"],
        }),
      }
    );
    const patchRes = await worker.fetch(patchReq, env, ctx);
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as any;
    expect(updated.labels).toEqual(["INBOX", "IMPORTANT", "PROJECT_X"]);

    // Delete thread
    const delReq = new Request(
      `http://localhost/v1/inboxes/${inbox1Id}/threads/${msg.thread_id}`,
      { method: "DELETE" }
    );
    const delRes = await worker.fetch(delReq, env, ctx);
    expect(delRes.status).toBe(200);

    // Verify thread is gone
    const getReq = new Request(
      `http://localhost/v1/inboxes/${inbox1Id}/threads/${msg.thread_id}`
    );
    const getRes = await worker.fetch(getReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(getRes.status).toBe(404);
  });
});
