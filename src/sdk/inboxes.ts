import type {
  Inbox,
  CreateInboxRequest,
  UpdateInboxRequest,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  ApiKey,
} from "../types";
import type { ClientOptions, RequestOptions } from "./types";

export class InboxesClient {
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

  async create(body?: CreateInboxRequest, reqOpts?: RequestOptions): Promise<Inbox> {
    return this.request<Inbox>("/inboxes", {
      method: "POST",
      body: JSON.stringify(body || {}),
    }, reqOpts);
  }

  async list(params?: { limit?: number; offset?: number }, reqOpts?: RequestOptions): Promise<{ inboxes: Inbox[]; total: number; count: number; has_more: boolean }> {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.offset) query.set("offset", params.offset.toString());
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/inboxes${qs}`, { method: "GET" }, reqOpts);
  }

  async get(inboxId: string, reqOpts?: RequestOptions): Promise<Inbox> {
    return this.request<Inbox>(`/inboxes/${encodeURIComponent(inboxId)}`, { method: "GET" }, reqOpts);
  }

  async update(inboxId: string, body: UpdateInboxRequest, reqOpts?: RequestOptions): Promise<Inbox> {
    return this.request<Inbox>(`/inboxes/${encodeURIComponent(inboxId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }, reqOpts);
  }

  async delete(inboxId: string, reqOpts?: RequestOptions): Promise<{ success: boolean; message: string }> {
    return this.request(`/inboxes/${encodeURIComponent(inboxId)}`, { method: "DELETE" }, reqOpts);
  }

  async createApiKey(inboxId: string, body: CreateApiKeyRequest, reqOpts?: RequestOptions): Promise<CreateApiKeyResponse> {
    return this.request<CreateApiKeyResponse>(`/inboxes/${encodeURIComponent(inboxId)}/api-keys`, {
      method: "POST",
      body: JSON.stringify(body),
    }, reqOpts);
  }

  async listApiKeys(inboxId: string, reqOpts?: RequestOptions): Promise<{ api_keys: ApiKey[]; count: number }> {
    return this.request(`/inboxes/${encodeURIComponent(inboxId)}/api-keys`, { method: "GET" }, reqOpts);
  }

  async deleteApiKey(inboxId: string, keyId: string, reqOpts?: RequestOptions): Promise<{ success: boolean; message: string }> {
    return this.request(`/inboxes/${encodeURIComponent(inboxId)}/api-keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
    }, reqOpts);
  }
}
