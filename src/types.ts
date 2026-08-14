// CFAgentMail Core Type Definitions

export interface Inbox {
  id: string; // usually same as email or unique id
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
  isRead: boolean;
  createdAt: number;
}

export interface ApiKey {
  id: string;
  inboxId: string | null;
  name: string;
  prefix: string;
  createdAt: number;
}

// Request / Response payloads

export interface CreateInboxRequest {
  username?: string;
  domain?: string;
  displayName?: string;
  metadata?: Record<string, string | number | boolean | null>;
  clientId?: string;
}

export interface UpdateInboxRequest {
  displayName?: string;
  metadata?: Record<string, string | number | boolean | null> | null;
}

export interface SendMessageRequest {
  to: string | string[] | MessageRecipient[];
  cc?: string | string[] | MessageRecipient[];
  bcc?: string | string[] | MessageRecipient[];
  replyTo?: string | MessageRecipient;
  subject: string;
  text?: string;
  html?: string;
  attachments?: {
    filename: string;
    content: string; // base64 or plain string
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

export interface CreateApiKeyRequest {
  name: string;
}

export interface CreateApiKeyResponse {
  id: string;
  apiKey: string;
  name: string;
  inboxId: string | null;
  createdAt: number;
}

export interface PaginatedList<T> {
  items: T[];
  count: number;
  hasMore: boolean;
  nextPageToken?: string;
}
