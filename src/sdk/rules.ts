import type {
  AccessRule,
  CreateAccessRuleRequest,
} from "../types";
import type { ClientOptions, RequestOptions } from "./types";

export class RulesClient {
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

  async create(inboxId: string, body: CreateAccessRuleRequest, reqOpts?: RequestOptions): Promise<AccessRule> {
    return this.request<AccessRule>(`/inboxes/${encodeURIComponent(inboxId)}/rules`, {
      method: "POST",
      body: JSON.stringify(body),
    }, reqOpts);
  }

  async list(inboxId: string, reqOpts?: RequestOptions): Promise<{ rules: AccessRule[]; count: number }> {
    return this.request(`/inboxes/${encodeURIComponent(inboxId)}/rules`, { method: "GET" }, reqOpts);
  }

  async delete(inboxId: string, ruleId: string, reqOpts?: RequestOptions): Promise<{ success: boolean; message: string }> {
    return this.request(
      `/inboxes/${encodeURIComponent(inboxId)}/rules/${encodeURIComponent(ruleId)}`,
      { method: "DELETE" },
      reqOpts
    );
  }
}
