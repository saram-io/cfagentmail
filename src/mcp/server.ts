import { CFAgentMail } from "../sdk";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "cfagentmail_create_inbox",
    description: "Provision a new programmable AI agent email inbox.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "Custom username (e.g. support-bot)" },
        domain: { type: "string", description: "Email domain (defaults to configured domain)" },
        displayName: { type: "string", description: "Human-friendly display name" },
        metadata: { type: "object", description: "Custom key-value metadata tags" },
      },
    },
  },
  {
    name: "cfagentmail_list_inboxes",
    description: "List available agent email inboxes with pagination.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of inboxes to return (default 20)" },
        offset: { type: "number", description: "Offset for pagination" },
      },
    },
  },
  {
    name: "cfagentmail_send_email",
    description: "Send an outbound email from an agent inbox.",
    inputSchema: {
      type: "object",
      properties: {
        inboxId: { type: "string", description: "Sender inbox ID or email address" },
        to: { type: "array", items: { type: "string" }, description: "Recipient email addresses" },
        subject: { type: "string", description: "Email subject line" },
        text: { type: "string", description: "Plain text body" },
        html: { type: "string", description: "HTML formatted body (optional)" },
        cc: { type: "array", items: { type: "string" }, description: "CC recipient addresses (optional)" },
      },
      required: ["inboxId", "to", "subject", "text"],
    },
  },
  {
    name: "cfagentmail_reply_email",
    description: "Reply to an email and preserve the conversation thread.",
    inputSchema: {
      type: "object",
      properties: {
        inboxId: { type: "string", description: "Inbox ID" },
        messageId: { type: "string", description: "Message ID being replied to" },
        text: { type: "string", description: "Reply plain text body" },
        html: { type: "string", description: "Reply HTML body (optional)" },
        replyAll: { type: "boolean", description: "Whether to reply to all recipients" },
      },
      required: ["inboxId", "messageId", "text"],
    },
  },
  {
    name: "cfagentmail_list_threads",
    description: "List conversation threads within an agent inbox.",
    inputSchema: {
      type: "object",
      properties: {
        inboxId: { type: "string", description: "Inbox ID" },
        labels: { type: "array", items: { type: "string" }, description: "Filter by labels (e.g. INBOX, IMPORTANT)" },
        limit: { type: "number", description: "Limit number of threads" },
      },
      required: ["inboxId"],
    },
  },
  {
    name: "cfagentmail_get_thread",
    description: "Get full chronological message history for a conversation thread.",
    inputSchema: {
      type: "object",
      properties: {
        inboxId: { type: "string", description: "Inbox ID" },
        threadId: { type: "string", description: "Thread ID" },
      },
      required: ["inboxId", "threadId"],
    },
  },
  {
    name: "cfagentmail_search_emails",
    description: "Perform full-text search across subject and email content with keyword highlights.",
    inputSchema: {
      type: "object",
      properties: {
        inboxId: { type: "string", description: "Inbox ID" },
        query: { type: "string", description: "Search query keywords" },
        limit: { type: "number", description: "Max results" },
      },
      required: ["inboxId", "query"],
    },
  },
  {
    name: "cfagentmail_create_draft",
    description: "Stage an email draft for Human-In-The-Loop (HITL) review.",
    inputSchema: {
      type: "object",
      properties: {
        inboxId: { type: "string", description: "Inbox ID" },
        to: { type: "array", items: { type: "string" }, description: "Recipient addresses" },
        subject: { type: "string", description: "Draft subject" },
        text: { type: "string", description: "Draft body text" },
      },
      required: ["inboxId", "to", "subject", "text"],
    },
  },
  {
    name: "cfagentmail_send_draft",
    description: "Execute and send an approved draft.",
    inputSchema: {
      type: "object",
      properties: {
        inboxId: { type: "string", description: "Inbox ID" },
        draftId: { type: "string", description: "Draft ID to dispatch" },
      },
      required: ["inboxId", "draftId"],
    },
  },
  {
    name: "cfagentmail_analyze_email",
    description: "Extract AI intelligence: 1-sentence summary, sentiment, urgency score (1-5), and category labels.",
    inputSchema: {
      type: "object",
      properties: {
        inboxId: { type: "string", description: "Inbox ID" },
        messageId: { type: "string", description: "Message ID to analyze" },
      },
      required: ["inboxId", "messageId"],
    },
  },
  {
    name: "cfagentmail_create_rule",
    description: "Create an allowlist or blocklist security rule for an inbox.",
    inputSchema: {
      type: "object",
      properties: {
        inboxId: { type: "string", description: "Inbox ID" },
        ruleType: { type: "string", enum: ["allow", "block"], description: "Rule type" },
        pattern: { type: "string", description: "Email address or domain pattern (e.g. *@spammer.org, @trusted.com)" },
        action: { type: "string", enum: ["reject", "spam"], description: "Action if blocked" },
      },
      required: ["inboxId", "ruleType", "pattern"],
    },
  },
];

export class McpServer {
  private client: CFAgentMail;

  constructor(options: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch } = {}) {
    this.client = new CFAgentMail(options);
  }

  async handleRequest(request: { jsonrpc: string; id?: string | number; method: string; params?: any }): Promise<any> {
    const { id, method, params } = request;

    try {
      if (method === "initialize") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: "cfagentmail",
              version: "0.5.0",
            },
            capabilities: {
              tools: {},
              resources: {},
            },
          },
        };
      }

      if (method === "notifications/initialized") {
        return null;
      }

      if (method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: MCP_TOOLS,
          },
        };
      }

      if (method === "tools/call") {
        const { name, arguments: args } = params || {};
        const result = await this.executeTool(name, args || {});
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      }

      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method '${method}' not found`,
        },
      };
    } catch (err: any) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: err.message || "Internal error",
        },
      };
    }
  }

  private async executeTool(name: string, args: any): Promise<any> {
    switch (name) {
      case "cfagentmail_create_inbox":
        return this.client.inboxes.create(args);

      case "cfagentmail_list_inboxes":
        return this.client.inboxes.list(args);

      case "cfagentmail_send_email":
        return this.client.messages.send(args.inboxId, {
          to: args.to,
          subject: args.subject,
          text: args.text,
          html: args.html,
          cc: args.cc,
        });

      case "cfagentmail_reply_email":
        return this.client.messages.reply(args.inboxId, args.messageId, {
          text: args.text,
          html: args.html,
          replyAll: args.replyAll,
        });

      case "cfagentmail_list_threads":
        return this.client.threads.list(args.inboxId, {
          labels: args.labels,
          limit: args.limit,
        });

      case "cfagentmail_get_thread":
        return this.client.threads.get(args.inboxId, args.threadId);

      case "cfagentmail_search_emails":
        return this.client.threads.search(args.inboxId, args.query, {
          limit: args.limit,
        });

      case "cfagentmail_create_draft":
        return this.client.drafts.create(args.inboxId, {
          to: args.to,
          subject: args.subject,
          text: args.text,
        });

      case "cfagentmail_send_draft":
        return this.client.drafts.send(args.inboxId, args.draftId);

      case "cfagentmail_analyze_email":
        return this.client.messages.analyze(args.inboxId, args.messageId);

      case "cfagentmail_create_rule":
        return this.client.rules.create(args.inboxId, {
          ruleType: args.ruleType,
          pattern: args.pattern,
          action: args.action,
        });

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
