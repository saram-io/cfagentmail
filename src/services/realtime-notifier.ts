import type { RealtimeEvent, RealtimeEventType } from "../types";
import { dispatchWebhookEvents } from "./webhook-dispatcher";

export async function emitEvent(
  env: Env,
  eventType: RealtimeEventType,
  inboxId: string,
  data: Record<string, any>,
  ctx?: { waitUntil?: (promise: Promise<any>) => void } | ExecutionContext
): Promise<void> {
  const timestamp = Date.now();
  const event: RealtimeEvent = {
    type: eventType,
    inboxId,
    timestamp,
    data,
  };

  const notifyTasks = async () => {
    // 1. Broadcast to Inbox-scoped Durable Object
    try {
      if (env.REALTIME_DO) {
        const id = env.REALTIME_DO.idFromName(inboxId);
        const inboxStub = env.REALTIME_DO.get(id);
        await inboxStub.broadcastEvent(event);
      }
    } catch (err) {
      console.error(`[Realtime] Failed to broadcast to inbox DO ${inboxId}:`, err);
    }

    // 2. Broadcast to Org-wide Durable Object
    try {
      if (env.REALTIME_DO) {
        const id = env.REALTIME_DO.idFromName("org_global");
        const orgStub = env.REALTIME_DO.get(id);
        await orgStub.broadcastEvent(event);
      }
    } catch (err) {
      console.error("[Realtime] Failed to broadcast to org DO:", err);
    }

    // 3. Dispatch to Webhooks
    try {
      await dispatchWebhookEvents(env.DB, eventType, inboxId, data);
    } catch (err) {
      console.error("[Webhooks] Error dispatching webhook events:", err);
    }
  };

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(notifyTasks());
  } else {
    await notifyTasks();
  }
}
