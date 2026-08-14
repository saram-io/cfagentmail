import type {
  Message,
  SendMessageRequest,
  ReplyMessageRequest,
  AiInsight,
} from "../types";
import type { ClientOptions, RequestOptions } from "./types";

export class MessagesClient {
  private baseUrl: string;
  private apiKey?: string;
  private fetchFn: typeof fetch;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl || "http://localhost:8787/v1";
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetch || globalThis.fetch.bind(globalThis);
  }

  private async request<T>(path: string, init?: RequestInit, reqOpts?: RequestOptions): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      ...(reqOpts?.headers || {}),
    };

    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init?.headers as any),
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as any)?.error?.message || `HTTP ${res.status} error`);
    }

    return data as T;
  }

  async send(inboxId: string, body: SendMessageRequest, reqOpts?: RequestOptions): Promise<Message> {
    return this.request<Message>(`/inboxes/${encodeURIComponent(inboxId)}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }, reqOpts);
  }

  async reply(inboxId: string, messageId: string, body: ReplyMessageRequest, reqOpts?: RequestOptions): Promise<Message> {
    return this.request<Message>(
      `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/reply`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      reqOpts
    );
  }

  async list(
    inboxId: string,
    params?: { limit?: number; offset?: number },
    reqOpts?: RequestOptions
  ): Promise<{ messages: Message[]; total: number; count: number; has_more: boolean }> {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.offset) query.set("offset", params.offset.toString());
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/inboxes/${encodeURIComponent(inboxId)}/messages${qs}`, { method: "GET" }, reqOpts);
  }

  async get(inboxId: string, messageId: string, reqOpts?: RequestOptions): Promise<Message> {
    return this.request<Message>(
      `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "GET" },
      reqOpts
    );
  }

  async delete(inboxId: string, messageId: string, reqOpts?: RequestOptions): Promise<{ success: boolean; message: string }> {
    return this.request(
      `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE" },
      reqOpts
    );
  }

  async analyze(inboxId: string, messageId: string, reqOpts?: RequestOptions): Promise<AiInsight> {
    return this.request<AiInsight>(
      `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/analyze`,
      { method: "POST" },
      reqOpts
    );
  }

  async getInsight(inboxId: string, messageId: string, reqOpts?: RequestOptions): Promise<AiInsight> {
    return this.request<AiInsight>(
      `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/insight`,
      { method: "GET" },
      reqOpts
    );
  }
}
