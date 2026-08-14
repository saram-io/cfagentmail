import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb } from "./helpers";

describe("Messages & Attachments REST API", () => {
  let testInboxId: string;

  beforeEach(async () => {
    await setupTestDb();
    await clearTestDb();

    // Mock env.EMAIL.send
    (env.EMAIL as any) = {
      send: vi.fn().mockResolvedValue({ messageId: `msg_${crypto.randomUUID()}` }),
    };

    // Create a test inbox
    const ctx = createExecutionContext();
    const req = new Request("http://localhost/v1/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "outbound-agent",
        displayName: "Outbound Agent",
      }),
    });
    const res = await worker.fetch(req, env, ctx);
    const data = (await res.json()) as any;
    testInboxId = data.id;
  });

  it("sends an outbound email and stores message + attachments", async () => {
    const ctx = createExecutionContext();
    const sendReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["customer@example.com"],
        cc: ["manager@example.com"],
        subject: "Welcome to Our Platform",
        text: "Hello! Welcome aboard.",
        html: "<p>Hello! Welcome aboard.</p>",
        attachments: [
          {
            filename: "welcome.txt",
            content: "V2VsY29tZSB0byBDRkFnZW50TWFpbCE=", // Base64: "Welcome to CFAgentMail!"
            type: "text/plain",
          },
        ],
      }),
    });

    const sendRes = await worker.fetch(sendReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(sendRes.status).toBe(201);
    const msg = (await sendRes.json()) as any;
    expect(msg.subject).toBe("Welcome to Our Platform");
    expect(msg.direction).toBe("outbound");
    expect(msg.from.email).toBe("outbound-agent@cfagentmail.com");
    expect(msg.to).toEqual([{ email: "customer@example.com" }]);
    expect(msg.has_attachments).toBe(true);

    // Verify env.EMAIL.send was called
    expect(env.EMAIL.send).toHaveBeenCalledTimes(1);

    // Retrieve message details
    const getReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/messages/${msg.id}`);
    const getRes = await worker.fetch(getReq, env, ctx);
    expect(getRes.status).toBe(200);
    const details = (await getRes.json()) as any;
    expect(details.attachments.length).toBe(1);
    expect(details.attachments[0].filename).toBe("welcome.txt");

    // Download attachment from R2
    const attId = details.attachments[0].id;
    const downloadReq = new Request(
      `http://localhost/v1/inboxes/${testInboxId}/messages/${msg.id}/attachments/${attId}`
    );
    const downloadRes = await worker.fetch(downloadReq, env, ctx);
    expect(downloadRes.status).toBe(200);
    const downloadedText = await downloadRes.text();
    expect(downloadedText).toBe("Welcome to CFAgentMail!");
  });

  it("replies to an email and preserves conversation thread", async () => {
    const ctx = createExecutionContext();

    // Send original email
    const originalReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["client@example.com"],
        subject: "Invoice #101",
        text: "Please find your invoice attached.",
      }),
    });
    const originalRes = await worker.fetch(originalReq, env, ctx);
    const original = (await originalRes.json()) as any;

    // Send reply
    const replyReq = new Request(
      `http://localhost/v1/inboxes/${testInboxId}/messages/${original.id}/reply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Thank you for the prompt payment!",
        }),
      }
    );
    const replyRes = await worker.fetch(replyReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(replyRes.status).toBe(201);
    const reply = (await replyRes.json()) as any;
    expect(reply.subject).toBe("Re: Invoice #101");
    expect(reply.thread_id).toBe(original.thread_id);
    expect(reply.to).toEqual([{ email: "outbound-agent@cfagentmail.com" }]); // Replying to sender
  });

  it("lists messages within an inbox", async () => {
    const ctx = createExecutionContext();
    for (let i = 1; i <= 2; i++) {
      const sendReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "user@example.com",
          subject: `Message ${i}`,
          text: `Body ${i}`,
        }),
      });
      await worker.fetch(sendReq, env, ctx);
    }

    const listReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/messages`);
    const listRes = await worker.fetch(listReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(listRes.status).toBe(200);
    const data = (await listRes.json()) as any;
    expect(data.count).toBe(2);
    expect(data.messages[0].subject).toBe("Message 2");
  });

  it("deletes a message", async () => {
    const ctx = createExecutionContext();
    const sendReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "user@example.com",
        subject: "To be deleted",
        text: "Bye",
      }),
    });
    const sendRes = await worker.fetch(sendReq, env, ctx);
    const msg = (await sendRes.json()) as any;

    const delReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/messages/${msg.id}`, {
      method: "DELETE",
    });
    const delRes = await worker.fetch(delReq, env, ctx);
    expect(delRes.status).toBe(200);

    const getReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/messages/${msg.id}`);
    const getRes = await worker.fetch(getReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(getRes.status).toBe(404);
  });
});
