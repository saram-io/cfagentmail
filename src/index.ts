import { Hono } from "hono";
import { cors } from "hono/cors";
import { inboxesRouter } from "./routes/inboxes";
import { messagesRouter } from "./routes/messages";
import { apiKeysRouter } from "./routes/api-keys";
import { threadsRouter, orgThreadsRouter } from "./routes/threads";
import { draftsRouter, orgDraftsRouter } from "./routes/drafts";
import { webhooksRouter } from "./routes/webhooks";
import { podsRouter } from "./routes/pods";
import { rulesRouter } from "./routes/rules";
import { authMiddleware } from "./middleware/auth";
import { parseRawEmail } from "./services/email-parser";
import { saveRawEmail, saveAttachment } from "./services/storage";
import { emitEvent } from "./services/realtime-notifier";
import { evaluateAccessPolicy } from "./services/access-controller";
import { analyzeEmailContent } from "./services/ai-classifier";
import {
  getInbox,
  createInbox,
  getOrCreateThread,
  createMessage,
  createAttachment,
  saveAiInsightRecord,
  updateMessage,
} from "./db/queries";

// Export Durable Object class so Cloudflare Workers runtime can instantiate it
export { InboxRealtimeDO } from "./durable-objects/realtime";

// Initialize Hono REST App
const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

// Health check endpoint
app.get("/v1/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "cfagentmail",
    version: "0.4.0",
  });
});

// Auth inspection endpoint
app.get("/v1/auth/me", authMiddleware, (c) => {
  const auth = c.get("auth" as any);
  return c.json({
    authenticated: true,
    auth,
  });
});

// WebSocket Real-time stream endpoints
// 1. Inbox-scoped stream: /v1/inboxes/:inbox_id/ws
app.get("/v1/inboxes/:inbox_id/ws", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  if (!c.env.REALTIME_DO) {
    return c.text("Real-time Durable Objects not configured", 500);
  }

  const id = c.env.REALTIME_DO.idFromName(inbox.id);
  const stub = c.env.REALTIME_DO.get(id);
  return stub.fetch(c.req.raw);
});

// 2. Org-wide global stream: /v1/ws
app.get("/v1/ws", async (c) => {
  if (!c.env.REALTIME_DO) {
    return c.text("Real-time Durable Objects not configured", 500);
  }

  const id = c.env.REALTIME_DO.idFromName("org_global");
  const stub = c.env.REALTIME_DO.get(id);
  return stub.fetch(c.req.raw);
});

// Apply auth middleware to all /v1 endpoints
app.use("/v1/inboxes/*", authMiddleware);
app.use("/v1/threads/*", authMiddleware);
app.use("/v1/threads", authMiddleware);
app.use("/v1/drafts/*", authMiddleware);
app.use("/v1/drafts", authMiddleware);
app.use("/v1/webhooks/*", authMiddleware);
app.use("/v1/webhooks", authMiddleware);
app.use("/v1/pods/*", authMiddleware);
app.use("/v1/pods", authMiddleware);

// Mount Inbox-scoped routes
app.route("/v1/inboxes", inboxesRouter);
app.route("/v1/inboxes", messagesRouter);
app.route("/v1/inboxes", threadsRouter);
app.route("/v1/inboxes", draftsRouter);
app.route("/v1/inboxes", apiKeysRouter);
app.route("/v1/inboxes", rulesRouter);

// Mount Org-wide / Pod routes (for supervisor agents)
app.route("/v1/threads", orgThreadsRouter);
app.route("/v1/drafts", orgDraftsRouter);
app.route("/v1/webhooks", webhooksRouter);
app.route("/v1/pods", podsRouter);

// Global 404 handler
app.notFound((c) => {
  return c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404);
});

// Global Error handler
app.onError((err, c) => {
  console.error("API Error:", err);
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: err.message || "An unexpected error occurred",
      },
    },
    500
  );
});

export default {
  // HTTP Fetch Handler
  fetch: app.fetch,

  // Cloudflare Email Routing Ingestion Handler
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      console.log(`[CFAgentMail Inbound] Received email from ${message.from} to ${message.to}`);

      // 1. Buffer raw MIME stream (must be buffered once before consumption)
      const rawBuffer = await new Response(message.raw).arrayBuffer();

      // 2. Parse MIME structure
      const parsed = await parseRawEmail(rawBuffer);

      // 3. Resolve Target Inbox
      const recipientAddress = message.to.toLowerCase();
      let inbox = await getInbox(env.DB, recipientAddress);

      if (!inbox) {
        if (env.ALLOW_AUTO_PROVISION_INBOX === "true") {
          const [username, domain] = recipientAddress.split("@");
          console.log(`[CFAgentMail Inbound] Auto-provisioning inbox for ${recipientAddress}`);
          inbox = await createInbox(env.DB, {
            id: recipientAddress,
            email: recipientAddress,
            username: username || "agent",
            domain: domain || env.DEFAULT_DOMAIN || "cfagentmail.com",
            displayName: username,
            metadata: { auto_provisioned: true },
          });
        } else {
          console.warn(`[CFAgentMail Inbound] Inbox not found for ${recipientAddress}. Rejecting.`);
          message.setReject(`Inbox ${recipientAddress} does not exist.`);
          return;
        }
      }

      // 4. Access Policy Evaluation (Allowlist & Blocklist)
      const policy = await evaluateAccessPolicy(env.DB, inbox.id, inbox.podId, message.from);
      if (!policy.allowed || policy.action === "reject") {
        console.warn(`[CFAgentMail Inbound] Message from ${message.from} rejected by policy: ${policy.reason}`);
        message.setReject(policy.reason || "Rejected by inbox security policy.");
        return;
      }

      const isSpam = policy.action === "spam";
      const initialLabels = isSpam ? ["SPAM"] : ["INBOX"];

      // 5. Generate Message & Thread IDs
      const messageId = `msg_${crypto.randomUUID()}`;

      // 6. Store Raw Email in R2
      const rawR2Key = await saveRawEmail(env.ATTACHMENTS, inbox.id, messageId, rawBuffer);

      // 7. Create or Match Thread
      const thread = await getOrCreateThread(
        env.DB,
        inbox.id,
        parsed.subject,
        parsed.snippet,
        parsed.inReplyTo,
        parsed.referencesHeader,
        initialLabels
      );

      // 8. Persist Inbound Message to D1 (must be created before attachments due to foreign key)
      const hasAttachments = parsed.attachments.length > 0;
      const createdMsg = await createMessage(env.DB, {
        id: messageId,
        inboxId: inbox.id,
        threadId: thread.id,
        messageIdHeader: parsed.messageIdHeader,
        inReplyTo: parsed.inReplyTo,
        referencesHeader: parsed.referencesHeader,
        fromAddress: parsed.from.email || message.from,
        fromName: parsed.from.name,
        toAddresses: parsed.to.length > 0 ? parsed.to : [{ email: message.to }],
        ccAddresses: parsed.cc.length > 0 ? parsed.cc : undefined,
        bccAddresses: parsed.bcc.length > 0 ? parsed.bcc : undefined,
        replyToAddresses: parsed.replyTo.length > 0 ? parsed.replyTo : undefined,
        subject: parsed.subject,
        textBody: parsed.text,
        htmlBody: parsed.html,
        snippet: parsed.snippet,
        rawR2Key,
        hasAttachments,
        direction: "inbound",
        labels: initialLabels,
        isRead: isSpam,
      });

      // 9. Store Attachments in R2 and insert records in D1
      if (hasAttachments) {
        for (const att of parsed.attachments) {
          const attId = `att_${crypto.randomUUID()}`;
          const r2Key = await saveAttachment(
            env.ATTACHMENTS,
            inbox.id,
            messageId,
            attId,
            att.filename,
            att.mimeType,
            att.content
          );

          await createAttachment(env.DB, {
            id: attId,
            messageId,
            filename: att.filename,
            contentType: att.mimeType,
            sizeBytes: att.size,
            disposition: att.disposition,
            contentId: att.contentId,
            r2Key,
          });
        }
      }

      // 10. AI Auto-Labeling and Intelligence Analysis
      if (!isSpam) {
        const analysis = await analyzeEmailContent(
          (env as any).AI,
          parsed.subject,
          parsed.text || parsed.snippet || ""
        );

        const insightId = `ai_${crypto.randomUUID()}`;
        await saveAiInsightRecord(env.DB, {
          id: insightId,
          messageId: createdMsg.id,
          summary: analysis.summary,
          sentiment: analysis.sentiment,
          urgency: analysis.urgency,
          labels: analysis.labels,
          actionItem: analysis.actionItem,
        });

        // Merge AI discovered labels onto message
        const mergedLabels = Array.from(new Set([...initialLabels, ...analysis.labels]));
        await updateMessage(env.DB, createdMsg.id, { labels: mergedLabels }, inbox.id);
      }

      console.log(`[CFAgentMail Inbound] Successfully saved message ${messageId} to inbox ${inbox.id} in thread ${thread.id}`);

      // 11. Emit real-time WebSocket and Webhook events
      await emitEvent(
        env,
        "email.received",
        inbox.id,
        {
          message_id: createdMsg.id,
          thread_id: thread.id,
          from: createdMsg.from,
          to: createdMsg.to,
          subject: createdMsg.subject,
          snippet: createdMsg.snippet,
        },
        ctx
      );
    } catch (error) {
      console.error("[CFAgentMail Inbound] Error processing incoming email:", error);
    }
  },
} satisfies ExportedHandler<Env>;
