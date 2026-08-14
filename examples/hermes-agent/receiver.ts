/**
 * CFAgentMail -> Hermes Agent Local Webhook Receiver Bridge
 *
 * Runs locally alongside your Hermes Agent.
 * Receives incoming CFAgentMail webhooks forwarded through Cloudflare Tunnel,
 * verifies HMAC-SHA256 signatures, formats the prompt for Hermes,
 * and triggers your local Hermes agent.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Configuration from environment variables
const PORT = parseInt(process.env.HERMES_BRIDGE_PORT || "8788", 10);
const WEBHOOK_SECRET = process.env.CFAGENTMAIL_WEBHOOK_SECRET || "whsec_hermes_local_secret";
const CFAGENTMAIL_API_URL = process.env.CFAGENTMAIL_API_URL || "https://api.yourdomain.com";
const CFAGENTMAIL_API_KEY = process.env.CFAGENTMAIL_API_KEY || "";
const HERMES_GATEWAY_URL = process.env.HERMES_GATEWAY_URL || "http://localhost:8080/webhook";
const EXECUTE_HERMES_CLI = process.env.EXECUTE_HERMES_CLI === "true";

// Helper: Verify HMAC-SHA256 signature
function verifySignature(signatureHeader: string | undefined, rawBody: string, secret: string): boolean {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => part.split("=") as [string, string])
  );

  if (!parts.t || !parts.v1) return false;

  const hmac = createHmac("sha256", secret);
  hmac.update(`${parts.t}.${rawBody}`);
  const expectedSig = hmac.digest("hex");

  return parts.v1 === expectedSig;
}

// Format incoming CFAgentMail event into a clean prompt for Hermes Agent
function formatHermesPrompt(event: any): string {
  const data = event.data || {};
  const from = typeof data.from === "object" ? `${data.from.name || ""} <${data.from.email}>` : data.from;
  const subject = data.subject || "(no subject)";
  const snippet = data.snippet || "";
  const threadId = data.thread_id || "";
  const messageId = data.message_id || "";
  const inboxId = event.inboxId || "";

  return `[NEW EMAIL RECEIVED]
Inbox: ${inboxId}
From: ${from}
Subject: ${subject}
Message ID: ${messageId}
Thread ID: ${threadId}

Content Snippet:
${snippet}

Instruction:
Review the incoming email and decide if a response or action is required.
If replying, you can use the CFAgentMail API or MCP tools to send a reply to thread ${threadId}.`;
}

// HTTP Server
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "healthy", service: "cfagentmail-hermes-bridge" }));
    return;
  }

  if (req.method === "POST" && (req.url === "/webhook" || req.url === "/")) {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
    });

    req.on("end", async () => {
      try {
        const signature = req.headers["x-cfagentmail-signature"] as string | undefined;

        // Verify cryptographic signature
        if (WEBHOOK_SECRET && !verifySignature(signature, rawBody, WEBHOOK_SECRET)) {
          console.warn("[Hermes Bridge] Signature verification failed!");
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid HMAC signature" }));
          return;
        }

        const event = JSON.parse(rawBody);
        console.log(`[Hermes Bridge] Received valid event: ${event.type} for inbox: ${event.inboxId}`);

        if (event.type === "email.received") {
          const hermesPrompt = formatHermesPrompt(event);
          console.log(`[Hermes Bridge] Triggering Hermes Agent:\n${hermesPrompt}`);

          // Option A: Forward to Hermes Gateway HTTP webhook
          if (HERMES_GATEWAY_URL) {
            try {
              const forwardRes = await fetch(HERMES_GATEWAY_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  event: "email.received",
                  prompt: hermesPrompt,
                  metadata: event,
                }),
              });
              console.log(`[Hermes Bridge] Forwarded to Hermes Gateway: HTTP ${forwardRes.status}`);
            } catch (gwErr) {
              console.warn(`[Hermes Bridge] Could not reach Hermes Gateway at ${HERMES_GATEWAY_URL}:`, gwErr);
            }
          }

          // Option B: Run Hermes CLI directly if enabled
          if (EXECUTE_HERMES_CLI) {
            try {
              console.log("[Hermes Bridge] Spawning Hermes CLI execution...");
              const { stdout } = await execAsync(`hermes run "${hermesPrompt.replace(/"/g, '\\"')}"`);
              console.log("[Hermes CLI Output]:", stdout);
            } catch (cliErr) {
              console.error("[Hermes CLI Error]:", cliErr);
            }
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "success", received: true }));
      } catch (err: any) {
        console.error("[Hermes Bridge] Error processing webhook:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "Internal error" }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` CFAgentMail -> Hermes Agent Local Bridge`);
  console.log(` Listening on: http://localhost:${PORT}/webhook`);
  console.log(` Cloudflare Tunnel Forward Target: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
