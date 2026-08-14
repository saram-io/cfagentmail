// CFAgentMail Core Type Definitions

export interface Pod {
  id: string;
  name: string;
  metadata: Record<string, string | number | boolean | null> | null;
  createdAt: number;
  updatedAt: number;
}

export interface Inbox {
  id: string;
  podId?: string | null;
  email: string;
  username: string;
  domain: string;
  displayName: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
  clientId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Thread {
  id: string;
  inboxId: string;
  subject: string;
  snippet: string | null;
  lastMessageAt: number;
  messageCount: number;
  labels?: string[];
  messages?: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface MessageRecipient {
  email: string;
  name?: string;
}

export interface MessageAttachmentMeta {
  id: string;
  messageId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  disposition: "attachment" | "inline";
  contentId?: string | null;
  r2Key: string;
  createdAt: number;
}

export interface Message {
  id: string;
  inboxId: string;
  threadId: string;
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  from: {
    email: string;
    name?: string;
  };
  to: MessageRecipient[];
  cc?: MessageRecipient[];
  bcc?: MessageRecipient[];
  replyTo?: MessageRecipient[];
  subject: string;
  text?: string | null;
  html?: string | null;
  snippet?: string | null;
  rawR2Key?: string | null;
  hasAttachments: boolean;
  attachments?: MessageAttachmentMeta[];
  direction: "inbound" | "outbound" | "draft";
  labels?: string[];
  isRead: boolean;
  createdAt: number;
}

export interface Draft {
  id: string;
  inboxId: string;
  threadId: string;
  to: MessageRecipient[];
  cc?: MessageRecipient[];
  bcc?: MessageRecipient[];
  replyTo?: MessageRecipient[];
  subject: string;
  text?: string | null;
  html?: string | null;
  inReplyTo?: string | null;
  hasAttachments: boolean;
  attachments?: MessageAttachmentMeta[];
  createdAt: number;
  updatedAt: number;
}

export interface ApiKey {
  id: string;
  inboxId: string | null;
  podId?: string | null;
  name: string;
  prefix: string;
  createdAt: number;
}

export interface AccessRule {
  id: string;
  inboxId: string | null;
  podId: string | null;
  ruleType: "allow" | "block";
  pattern: string;
  action: "reject" | "spam";
  createdAt: number;
}

export interface AiInsight {
  id: string;
  messageId: string;
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  urgency: number; // 1 to 5
  labels: string[];
  actionItem?: string | null;
  createdAt: number;
}

export interface Webhook {
  id: string;
  inboxId: string | null;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  payload: string;
  responseStatus?: number | null;
  responseBody?: string | null;
  durationMs?: number | null;
  error?: string | null;
  createdAt: number;
}

export type RealtimeEventType =
  | "email.received"
  | "email.sent"
  | "draft.created"
  | "draft.updated"
  | "thread.updated"
  | "email.analyzed";

export interface RealtimeEvent {
  type: RealtimeEventType;
  inboxId: string;
  timestamp: number;
  data: Record<string, any>;
}

// Search Results with Highlights
export interface ThreadSearchResult extends Thread {
  highlights?: Record<string, string[]>;
}

export interface MessageSearchResult extends Message {
  highlights?: Record<string, string[]>;
}

// Request / Response payloads

export interface CreatePodRequest {
  name: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface UpdatePodRequest {
  name?: string;
  metadata?: Record<string, string | number | boolean | null> | null;
}

export interface CreateInboxRequest {
  username?: string;
  domain?: string;
  podId?: string;
  displayName?: string;
  metadata?: Record<string, string | number | boolean | null>;
  clientId?: string;
}

export interface UpdateInboxRequest {
  displayName?: string;
  podId?: string | null;
  metadata?: Record<string, string | number | boolean | null> | null;
}

export interface CreateAccessRuleRequest {
  ruleType: "allow" | "block";
  pattern: string;
  action?: "reject" | "spam";
  podId?: string;
}

export interface SendMessageRequest {
  to: string | string[] | MessageRecipient[];
  cc?: string | string[] | MessageRecipient[];
  bcc?: string | string[] | MessageRecipient[];
  replyTo?: string | MessageRecipient;
  subject: string;
  text?: string;
  html?: string;
  labels?: string[];
  attachments?: {
    filename: string;
    content: string;
    type?: string;
    disposition?: "attachment" | "inline";
    contentId?: string;
  }[];
  headers?: Record<string, string>;
}

export interface ReplyMessageRequest {
  text?: string;
  html?: string;
  replyAll?: boolean;
  attachments?: {
    filename: string;
    content: string;
    type?: string;
    disposition?: "attachment" | "inline";
    contentId?: string;
  }[];
}

export interface CreateDraftRequest {
  to?: string | string[] | MessageRecipient[];
  cc?: string | string[] | MessageRecipient[];
  bcc?: string | string[] | MessageRecipient[];
  replyTo?: string | MessageRecipient;
  subject?: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  threadId?: string;
  attachments?: {
    filename: string;
    content: string;
    type?: string;
    disposition?: "attachment" | "inline";
    contentId?: string;
  }[];
}

export interface UpdateDraftRequest {
  to?: string | string[] | MessageRecipient[];
  cc?: string | string[] | MessageRecipient[];
  bcc?: string | string[] | MessageRecipient[];
  replyTo?: string | MessageRecipient;
  subject?: string;
  text?: string;
  html?: string;
  attachments?: {
    filename: string;
    content: string;
    type?: string;
    disposition?: "attachment" | "inline";
    contentId?: string;
  }[];
}

export interface ListThreadsOptions {
  limit?: number;
  offset?: number;
  labels?: string[];
  senders?: string[];
  recipients?: string[];
  subject?: string;
  before?: number;
  after?: number;
  ascending?: boolean;
}

export interface CreateApiKeyRequest {
  name: string;
  podId?: string;
}

export interface CreateApiKeyResponse {
  id: string;
  apiKey: string;
  name: string;
  inboxId: string | null;
  podId?: string | null;
  createdAt: number;
}

export interface CreateWebhookRequest {
  url: string;
  events?: string[];
  inboxId?: string | null;
  secret?: string;
}

export interface UpdateWebhookRequest {
  url?: string;
  events?: string[];
  isActive?: boolean;
}

export interface PaginatedList<T> {
  items: T[];
  count: number;
  hasMore: boolean;
  nextPageToken?: string;
}
