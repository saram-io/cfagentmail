import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb } from "./helpers";

describe("Drafts & Human-In-The-Loop Workflow", () => {
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
        username: "drafts-agent",
        displayName: "Drafts Tester",
      }),
    });
    const res = await worker.fetch(req, env, ctx);
    const data = (await res.json()) as any;
    testInboxId = data.id;
  });

  it("creates, retrieves, updates, and deletes a draft", async () => {
    const ctx = createExecutionContext();

    // 1. Create Draft
    const createReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["approver@company.com"],
        subject: "Draft Proposal v1",
        text: "Please review this proposal before I send it to client.",
      }),
    });
    const createRes = await worker.fetch(createReq, env, ctx);
    expect(createRes.status).toBe(201);
    const draft = (await createRes.json()) as any;
    expect(draft.subject).toBe("Draft Proposal v1");
    expect(draft.to).toEqual([{ email: "approver@company.com" }]);

    // 2. Get Draft
    const getReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/drafts/${draft.id}`);
    const getRes = await worker.fetch(getReq, env, ctx);
    expect(getRes.status).toBe(200);
    const retrieved = (await getRes.json()) as any;
    expect(retrieved.id).toBe(draft.id);

    // 3. Update Draft (Human-In-The-Loop review edits)
    const patchReq = new Request(
      `http://localhost/v1/inboxes/${testInboxId}/drafts/${draft.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: "Approved Proposal v2",
          text: "Updated proposal with approved discount.",
        }),
      }
    );
    const patchRes = await worker.fetch(patchReq, env, ctx);
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as any;
    expect(updated.subject).toBe("Approved Proposal v2");
    expect(updated.text).toBe("Updated proposal with approved discount.");

    // 4. List Drafts
    const listReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/drafts`);
    const listRes = await worker.fetch(listReq, env, ctx);
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as any;
    expect(listData.count).toBe(1);

    // 5. Delete Draft
    const delReq = new Request(
      `http://localhost/v1/inboxes/${testInboxId}/drafts/${draft.id}`,
      { method: "DELETE" }
    );
    const delRes = await worker.fetch(delReq, env, ctx);
    expect(delRes.status).toBe(200);

    // 6. Verify Draft is deleted
    const getAfterReq = new Request(
      `http://localhost/v1/inboxes/${testInboxId}/drafts/${draft.id}`
    );
    const getAfterRes = await worker.fetch(getAfterReq, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(getAfterRes.status).toBe(404);
  });

  it("sends a draft via HITL execution and transitions it to outbound message", async () => {
    const ctx = createExecutionContext();

    // 1. Create draft
    const createReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: ["client@acme.com"],
        subject: "Final Contract Document",
        text: "Please find attached our finalized agreement.",
      }),
    });
    const createRes = await worker.fetch(createReq, env, ctx);
    const draft = (await createRes.json()) as any;

    // 2. Human or supervisory agent sends the draft
    const sendDraftReq = new Request(
      `http://localhost/v1/inboxes/${testInboxId}/drafts/${draft.id}/send`,
      { method: "POST" }
    );
    const sendDraftRes = await worker.fetch(sendDraftReq, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(sendDraftRes.status).toBe(200);
    const sent = (await sendDraftRes.json()) as any;
    expect(sent.direction).toBe("outbound");
    expect(sent.labels).toContain("SENT");

    // Verify email binding was dispatched
    expect(env.EMAIL.send).toHaveBeenCalledTimes(1);

    // Verify it is no longer listed under drafts
    const listDraftsReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/drafts`);
    const listDraftsRes = await worker.fetch(listDraftsReq, env, ctx);
    const draftsData = (await listDraftsRes.json()) as any;
    expect(draftsData.count).toBe(0);

    // Verify it now appears under messages list
    const listMsgsReq = new Request(`http://localhost/v1/inboxes/${testInboxId}/messages`);
    const listMsgsRes = await worker.fetch(listMsgsReq, env, ctx);
    const msgsData = (await listMsgsRes.json()) as any;
    expect(msgsData.count).toBe(1);
    expect(msgsData.messages[0].id).toBe(draft.id);
  });
});
