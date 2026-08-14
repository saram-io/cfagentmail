import type {
  Pod,
  CreatePodRequest,
  UpdatePodRequest,
  Inbox,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
} from "../types";
import type { ClientOptions, RequestOptions } from "./types";

export class PodsClient {
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

  async create(body: CreatePodRequest, reqOpts?: RequestOptions): Promise<Pod> {
    return this.request<Pod>("/pods", {
      method: "POST",
      body: JSON.stringify(body),
    }, reqOpts);
  }

  async list(params?: { limit?: number; offset?: number }, reqOpts?: RequestOptions): Promise<{ pods: Pod[]; count: number; total: number; has_more: boolean }> {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.offset) query.set("offset", params.offset.toString());
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/pods${qs}`, { method: "GET" }, reqOpts);
  }

  async get(podId: string, reqOpts?: RequestOptions): Promise<Pod> {
    return this.request<Pod>(`/pods/${encodeURIComponent(podId)}`, { method: "GET" }, reqOpts);
  }

  async update(podId: string, body: UpdatePodRequest, reqOpts?: RequestOptions): Promise<Pod> {
    return this.request<Pod>(`/pods/${encodeURIComponent(podId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }, reqOpts);
  }

  async delete(podId: string, reqOpts?: RequestOptions): Promise<{ success: boolean; message: string }> {
    return this.request(`/pods/${encodeURIComponent(podId)}`, { method: "DELETE" }, reqOpts);
  }

  async listInboxes(podId: string, params?: { limit?: number; offset?: number }, reqOpts?: RequestOptions): Promise<{ inboxes: Inbox[]; count: number; total: number; has_more: boolean }> {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.offset) query.set("offset", params.offset.toString());
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/pods/${encodeURIComponent(podId)}/inboxes${qs}`, { method: "GET" }, reqOpts);
  }

  async createApiKey(podId: string, body: CreateApiKeyRequest, reqOpts?: RequestOptions): Promise<CreateApiKeyResponse> {
    return this.request<CreateApiKeyResponse>(`/pods/${encodeURIComponent(podId)}/api-keys`, {
      method: "POST",
      body: JSON.stringify(body),
    }, reqOpts);
  }
}
