import { DurableObject } from "cloudflare:workers";
import type { RealtimeEvent } from "../types";

export class InboxRealtimeDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  // Handle incoming HTTP / WebSocket Upgrade requests
  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket Upgrade header", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Accept WebSocket into Durable Object Hibernation state
    this.ctx.acceptWebSocket(server, ["live-stream"]);

    // Send connection established handshake
    server.send(
      JSON.stringify({
        type: "connected",
        timestamp: Date.now(),
        message: "Connected to CFAgentMail real-time stream",
      })
    );

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // RPC method to broadcast real-time events to all connected clients
  async broadcastEvent(event: RealtimeEvent): Promise<{ clientCount: number }> {
    const sockets = this.ctx.getWebSockets("live-stream");
    const payload = JSON.stringify(event);

    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch (err) {
        console.error("[InboxRealtimeDO] Failed to send to socket:", err);
      }
    }

    return { clientCount: sockets.length };
  }

  // Handle messages received from connected clients (e.g. heartbeat / ping)
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      const data = JSON.parse(text);

      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      }
    } catch {
      // Ignore malformed client messages
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Automatic cleanup handled by DO hibernation
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("[InboxRealtimeDO] WebSocket error:", error);
  }
}
