import type {
  Webhook,
  WebhookDelivery,
  CreateWebhookRequest,
  UpdateWebhookRequest,
} from "../types";
import type { ClientOptions, RequestOptions } from "./types";

export class WebhooksClient {
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

  async create(body: CreateWebhookRequest, reqOpts?: RequestOptions): Promise<Webhook> {
    return this.request<Webhook>("/webhooks", {
      method: "POST",
      body: JSON.stringify(body),
    }, reqOpts);
  }

  async list(params?: { limit?: number; offset?: number }, reqOpts?: RequestOptions): Promise<{ webhooks: Webhook[]; count: number; total: number }> {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.offset) query.set("offset", params.offset.toString());
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/webhooks${qs}`, { method: "GET" }, reqOpts);
  }

  async get(webhookId: string, reqOpts?: RequestOptions): Promise<Webhook> {
    return this.request<Webhook>(`/webhooks/${encodeURIComponent(webhookId)}`, { method: "GET" }, reqOpts);
  }

  async update(webhookId: string, body: UpdateWebhookRequest, reqOpts?: RequestOptions): Promise<Webhook> {
    return this.request<Webhook>(`/webhooks/${encodeURIComponent(webhookId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }, reqOpts);
  }

  async delete(webhookId: string, reqOpts?: RequestOptions): Promise<{ success: boolean; message: string }> {
    return this.request(`/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE" }, reqOpts);
  }

  async listDeliveries(
    webhookId: string,
    params?: { limit?: number; offset?: number },
    reqOpts?: RequestOptions
  ): Promise<{ deliveries: WebhookDelivery[]; count: number; total: number }> {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.offset) query.set("offset", params.offset.toString());
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/webhooks/${encodeURIComponent(webhookId)}/deliveries${qs}`, { method: "GET" }, reqOpts);
  }

  async testPing(webhookId: string, reqOpts?: RequestOptions): Promise<any> {
    return this.request(`/webhooks/${encodeURIComponent(webhookId)}/test`, { method: "POST" }, reqOpts);
  }
}
