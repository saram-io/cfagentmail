import { listActiveWebhooksForEvent, recordWebhookDelivery } from "../db/queries";
import type { RealtimeEventType } from "../types";

export async function computeHmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function dispatchWebhookEvents(
  db: D1Database,
  eventType: RealtimeEventType,
  inboxId: string,
  eventData: Record<string, any>
): Promise<void> {
  const webhooks = await listActiveWebhooksForEvent(db, eventType, inboxId);
  if (!webhooks || webhooks.length === 0) {
    return;
  }

  const timestamp = Date.now();
  const payloadObject = {
    id: `evt_${crypto.randomUUID()}`,
    type: eventType,
    inbox_id: inboxId,
    created_at: new Date(timestamp).toISOString(),
    data: eventData,
  };
  const payloadString = JSON.stringify(payloadObject);

  for (const webhook of webhooks) {
    const deliveryId = `del_${crypto.randomUUID()}`;
    const startTime = Date.now();

    try {
      const signature = await computeHmacSha256(webhook.secret, `${timestamp}.${payloadString}`);

      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "CFAgentMail-Webhook/1.0",
          "X-CFAgentMail-Signature": `t=${timestamp},v1=${signature}`,
          "X-CFAgentMail-Event": eventType,
          "X-CFAgentMail-Delivery": deliveryId,
        },
        body: payloadString,
      });

      const durationMs = Date.now() - startTime;
      const responseBody = await response.text().catch(() => "");

      await recordWebhookDelivery(db, {
        id: deliveryId,
        webhookId: webhook.id,
        eventType,
        payload: payloadString,
        responseStatus: response.status,
        responseBody: responseBody.slice(0, 1000),
        durationMs,
      });
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      await recordWebhookDelivery(db, {
        id: deliveryId,
        webhookId: webhook.id,
        eventType,
        payload: payloadString,
        responseStatus: 0,
        error: err.message || "Failed to connect to webhook endpoint",
        durationMs,
      });
    }
  }
}
