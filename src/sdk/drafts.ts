import type {
  Draft,
  CreateDraftRequest,
  UpdateDraftRequest,
  Message,
} from "../types";
import type { ClientOptions, RequestOptions } from "./types";

export class DraftsClient {
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

  async create(inboxId: string, body: CreateDraftRequest, reqOpts?: RequestOptions): Promise<Draft> {
    return this.request<Draft>(`/inboxes/${encodeURIComponent(inboxId)}/drafts`, {
      method: "POST",
      body: JSON.stringify(body),
    }, reqOpts);
  }

  async list(
    inboxId: string,
    params?: { limit?: number; offset?: number },
    reqOpts?: RequestOptions
  ): Promise<{ drafts: Draft[]; count: number; total: number; has_more: boolean }> {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.offset) query.set("offset", params.offset.toString());
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/inboxes/${encodeURIComponent(inboxId)}/drafts${qs}`, { method: "GET" }, reqOpts);
  }

  async get(inboxId: string, draftId: string, reqOpts?: RequestOptions): Promise<Draft> {
    return this.request<Draft>(
      `/inboxes/${encodeURIComponent(inboxId)}/drafts/${encodeURIComponent(draftId)}`,
      { method: "GET" },
      reqOpts
    );
  }

  async update(
    inboxId: string,
    draftId: string,
    body: UpdateDraftRequest,
    reqOpts?: RequestOptions
  ): Promise<Draft> {
    return this.request<Draft>(
      `/inboxes/${encodeURIComponent(inboxId)}/drafts/${encodeURIComponent(draftId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
      reqOpts
    );
  }

  async delete(inboxId: string, draftId: string, reqOpts?: RequestOptions): Promise<{ success: boolean; message: string }> {
    return this.request(
      `/inboxes/${encodeURIComponent(inboxId)}/drafts/${encodeURIComponent(draftId)}`,
      { method: "DELETE" },
      reqOpts
    );
  }

  async send(inboxId: string, draftId: string, reqOpts?: RequestOptions): Promise<Message> {
    return this.request<Message>(
      `/inboxes/${encodeURIComponent(inboxId)}/drafts/${encodeURIComponent(draftId)}/send`,
      { method: "POST" },
      reqOpts
    );
  }
}
