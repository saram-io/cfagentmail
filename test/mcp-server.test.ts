import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { setupTestDb, clearTestDb } from "./helpers";
import { McpServer, MCP_TOOLS } from "../src/mcp/server";

describe("Model Context Protocol (MCP) Server", () => {
  let mcpServer: McpServer;

  beforeEach(async () => {
    await setupTestDb();
    await clearTestDb();

    (env.EMAIL as any) = {
      send: vi.fn().mockResolvedValue({ messageId: `msg_${crypto.randomUUID()}` }),
    };

    const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const ctx = createExecutionContext();
      const req = new Request(url, init);
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);
      return res;
    };

    mcpServer = new McpServer({
      baseUrl: "http://localhost/v1",
      fetch: customFetch as any,
    });
  });

  it("handles initialize and tools/list requests correctly", async () => {
    // 1. Initialize
    const initRes = await mcpServer.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    expect(initRes.result.serverInfo.name).toBe("cfagentmail");
    expect(initRes.result.capabilities.tools).toBeDefined();

    // 2. Tools List
    const toolsRes = await mcpServer.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(toolsRes.result.tools.length).toBe(MCP_TOOLS.length);
    const toolNames = toolsRes.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("cfagentmail_create_inbox");
    expect(toolNames).toContain("cfagentmail_send_email");
    expect(toolNames).toContain("cfagentmail_reply_email");
    expect(toolNames).toContain("cfagentmail_search_emails");
    expect(toolNames).toContain("cfagentmail_create_draft");
    expect(toolNames).toContain("cfagentmail_analyze_email");
  });

  it("executes tools/call for inbox creation, outbound send, and email search", async () => {
    // 1. Tool Call: create_inbox
    const createInboxRes = await mcpServer.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "cfagentmail_create_inbox",
        arguments: {
          username: "mcp-agent",
          displayName: "MCP Robot",
        },
      },
    });
    expect(createInboxRes.result.content[0].type).toBe("text");
    const inboxData = JSON.parse(createInboxRes.result.content[0].text);
    expect(inboxData.email).toBe("mcp-agent@cfagentmail.com");

    // 2. Tool Call: send_email
    const sendRes = await mcpServer.handleRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "cfagentmail_send_email",
        arguments: {
          inboxId: inboxData.id,
          to: ["client@mcp.com"],
          subject: "MCP Protocol Test Email",
          text: "This email was dispatched via Model Context Protocol.",
        },
      },
    });
    const msgData = JSON.parse(sendRes.result.content[0].text);
    expect(msgData.subject).toBe("MCP Protocol Test Email");

    // 3. Tool Call: search_emails
    const searchRes = await mcpServer.handleRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "cfagentmail_search_emails",
        arguments: {
          inboxId: inboxData.id,
          query: "protocol",
        },
      },
    });
    const searchData = JSON.parse(searchRes.result.content[0].text);
    expect(searchData.count).toBeGreaterThanOrEqual(1);

    // 4. Tool Call: analyze_email
    const analyzeRes = await mcpServer.handleRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "cfagentmail_analyze_email",
        arguments: {
          inboxId: inboxData.id,
          messageId: msgData.id,
        },
      },
    });
    const analyzeData = JSON.parse(analyzeRes.result.content[0].text);
    expect(analyzeData.summary).toBeDefined();
    expect(analyzeData.urgency).toBeDefined();
  });
});
