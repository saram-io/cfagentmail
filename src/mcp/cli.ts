#!/usr/bin/env node
/**
 * CFAgentMail Model Context Protocol (MCP) stdio Transport Server
 *
 * Use with Claude Desktop, Cursor, Claude Code, Goose, Windsurf, or Hermes.
 */

import * as readline from "node:readline";
import { McpServer } from "./server";

const API_KEY = process.env.CFAGENTMAIL_API_KEY || "";
const BASE_URL = process.env.CFAGENTMAIL_BASE_URL || "https://api.yourdomain.com/v1";

const server = new McpServer({
  apiKey: API_KEY,
  baseUrl: BASE_URL,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", async (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const request = JSON.parse(trimmed);
    const response = await server.handleRequest(request);
    if (response) {
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  } catch (err: any) {
    const errorResponse = {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
        data: err.message,
      },
    };
    process.stdout.write(JSON.stringify(errorResponse) + "\n");
  }
});
