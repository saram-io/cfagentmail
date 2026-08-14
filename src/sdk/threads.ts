import type {
  Thread,
  ThreadSearchResult,
  ListThreadsOptions,
} from "../types";
import type { ClientOptions, RequestOptions } from "./types";

export class ThreadsClient {
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

  async list(
    inboxId: string,
    options?: ListThreadsOptions,
    reqOpts?: RequestOptions
  ): Promise<{ threads: Thread[]; total: number; count: number; has_more: boolean }> {
    const query = new URLSearchParams();
    if (options?.limit) query.set("limit", options.limit.toString());
    if (options?.offset) query.set("offset", options.offset.toString());
    if (options?.labels) query.set("labels", options.labels.join(","));
    if (options?.subject) query.set("subject", options.subject);
    if (options?.ascending !== undefined) query.set("ascending", options.ascending.toString());
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/inboxes/${encodeURIComponent(inboxId)}/threads${qs}`, { method: "GET" }, reqOpts);
  }

  async get(inboxId: string, threadId: string, reqOpts?: RequestOptions): Promise<Thread> {
    return this.request<Thread>(
      `/inboxes/${encodeURIComponent(inboxId)}/threads/${encodeURIComponent(threadId)}`,
      { method: "GET" },
      reqOpts
    );
  }

  async search(
    inboxId: string,
    queryText: string,
    params?: { limit?: number; offset?: number },
    reqOpts?: RequestOptions
  ): Promise<{ threads: ThreadSearchResult[]; total: number; count: number }> {
    const query = new URLSearchParams({ q: queryText });
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.offset) query.set("offset", params.offset.toString());
    return this.request(
      `/inboxes/${encodeURIComponent(inboxId)}/threads/search?${query.toString()}`,
      { method: "GET" },
      reqOpts
    );
  }

  async updateLabels(
    inboxId: string,
    threadId: string,
    labels: string[],
    reqOpts?: RequestOptions
  ): Promise<Thread> {
    return this.request<Thread>(
      `/inboxes/${encodeURIComponent(inboxId)}/threads/${encodeURIComponent(threadId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ labels }),
      },
      reqOpts
    );
  }

  async delete(inboxId: string, threadId: string, reqOpts?: RequestOptions): Promise<{ success: boolean; message: string }> {
    return this.request(
      `/inboxes/${encodeURIComponent(inboxId)}/threads/${encodeURIComponent(threadId)}`,
      { method: "DELETE" },
      reqOpts
    );
  }

  // Org-wide methods
  async listAll(options?: ListThreadsOptions, reqOpts?: RequestOptions): Promise<{ threads: Thread[]; total: number; count: number }> {
    const query = new URLSearchParams();
    if (options?.limit) query.set("limit", options.limit.toString());
    if (options?.offset) query.set("offset", options.offset.toString());
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/threads${qs}`, { method: "GET" }, reqOpts);
  }

  async searchAll(queryText: string, params?: { limit?: number; offset?: number }, reqOpts?: RequestOptions): Promise<{ threads: ThreadSearchResult[]; total: number; count: number }> {
    const query = new URLSearchParams({ q: queryText });
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.offset) query.set("offset", params.offset.toString());
    return this.request(`/threads/search?${query.toString()}`, { method: "GET" }, reqOpts);
  }
}
