# CFAgentMail

> An API-first, serverless email platform built for AI agents — running natively on Cloudflare Workers, Cloudflare Email Service, D1 (SQLite), R2, and Durable Objects.

CFAgentMail gives AI agents their own programmable inboxes to send, receive, thread, search, and stream emails at edge scale with zero per-seat subscription costs.

---

## Features

- 📬 **Programmatic Inboxes**: Provision tens, hundreds, or thousands of agent inboxes on-demand with custom metadata and auto-generated or custom domains.
- 🏢 **Multi-Tenant Pods**: Group agent fleets and inboxes into isolated organizational workspaces with pod-scoped API key authorization.
- 📥 **Inbound Email Ingestion**: Native Cloudflare Email Routing handler with full MIME decoding (`postal-mime`), attachment extraction, and automatic inbox auto-provisioning.
- 📤 **Outbound Email Delivery**: High-deliverability transactional sending via Cloudflare Email Sending (`send_email` binding) with SPF, DKIM, and DMARC.
- 🛡️ **Access Control Policies**: Inbox and pod-level allowlist/blocklist rules with instant SMTP reject or automated `SPAM` quarantine.
- 🧠 **Workers AI Email Intelligence**: Automatic 1-sentence summaries, sentiment analysis (`positive`/`neutral`/`negative`), urgency scoring (`1-5`), and smart category auto-labeling.
- 🧵 **Automatic Conversation Threading**: Group multi-turn messages into threads using RFC 2822 (`Message-ID`, `In-Reply-To`, `References`) headers with subject normalization fallback.
- 🔍 **SQLite FTS5 Full-Text Search**: Sub-millisecond full-text search across subject and body text with BM25 relevance ranking and keyword highlight snippets (`**term**`).
- 📝 **Drafts & Human-In-The-Loop (HITL)**: Create, stage, review, and edit email drafts before dispatching via supervisor approval.
- ⚡ **Real-Time WebSockets**: Zero-idle-cost WebSocket streaming powered by Cloudflare Durable Object Hibernation API (`/v1/inboxes/:id/ws` and `/v1/ws`).
- 🪝 **HMAC-Signed Webhooks**: Cryptographically verified webhook event dispatching (`email.received`, `email.sent`, `draft.created`, etc.) with delivery tracking.
- 🤖 **Hermes Agent & Local Tunnels**: Out-of-the-box local webhook bridge connecting local autonomous agents (e.g. Nous Hermes Agent) via Cloudflare Tunnel (`cloudflared`).
- 📎 **Attachment & Raw EML Storage**: Direct streaming of attachments and raw `.eml` RFC822 files into Cloudflare R2 object storage.
- 🔑 **Fine-Grained Scoped API Keys**: Issue SHA-256 hashed API keys scoped to individual inboxes or pods to enforce least-privilege access for agent fleets.
- 🛡️ **Idempotent Operations**: Avoid duplicate resource creation and double-sends using `clientId` on inboxes and custom idempotency keys.
- 🧪 **100% Tested at the Edge**: Comprehensive 40-test suite running directly inside the real `workerd` runtime using `@cloudflare/vitest-pool-workers`.

---

## Architecture Overview

```
                          ┌────────────────────────────────────────┐
                          │         Inbound Internet Email         │
                          └───────────────────┬────────────────────┘
                                              │ MX Records
                                              ▼
                          ┌────────────────────────────────────────┐
                          │      Cloudflare Email Routing          │
                          │   (Catch-all *@yourdomain.com / rules) │
                          └───────────────────┬────────────────────┘
                                              │ email() handler
                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Cloudflare Worker (cfagentmail Core)                                                             │
│                                                                                                  │
│  1. Ingestion: Buffer `message.raw` -> Parse via `postal-mime` -> Extract reply content          │
│  2. Target Resolution: Match inbox or auto-provision if enabled                                  │
│  3. Attachments: Save binary attachment buffers to Cloudflare R2                                 │
│  4. Indexing: Persist messages & threads into D1 + sync FTS5 search index                        │
│  5. Raw Archive: Store full .eml RFC822 byte stream into Cloudflare R2                           │
│  6. Push Dispatch: Broadcast to Durable Object WebSockets & send HMAC-signed Webhooks            │
└──────────────┬───────────────────────────────┬───────────────────────────────┬───────────────────┘
               │                               │                               │
               ▼                               ▼                               ▼
┌───────────────────────────────┐ ┌───────────────────────────┐ ┌──────────────────────────────────┐
│     Cloudflare D1 (SQLite)    │ │       Cloudflare R2       │ │   Durable Object Hibernation     │
│   - Inboxes & Metadata        │ │   - Raw .eml MIME files   │ │   - Inbox-scoped WebSocket stream│
│   - Threads & Messages        │ │   - Message attachments   │ │   - Org-wide WebSocket stream    │
│   - FTS5 Full-Text Search     │ │   - Binary downloads      │ │   - Real-time event broadcasts   │
│   - Webhooks & Delivery Logs  │ └───────────────────────────┘ └──────────────────────────────────┘
│   - Scoped API Keys           │
└───────────────────────────────┘
               ▲
               │
┌──────────────┴───────────────────────────────────────────────────────────────────────────────────┐
│ REST API Clients & Agents (Claude Code, Cursor, LangChain, Python / TS SDKs)                     │
│                                                                                                  │
│  - REST Endpoints: `/v1/inboxes`, `/v1/threads`, `/v1/drafts`, `/v1/webhooks`, `/v1/api-keys`    │
│  - Outbound Delivery: Native `env.EMAIL.send()` via Cloudflare Email Sending                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Getting Started

### 1. Prerequisites
- Node.js 18+
- [Cloudflare Account](https://dash.cloudflare.com)
- Wrangler CLI (`npm install -g wrangler`)

### 2. Installation
```bash
git clone https://github.com/saram-io/cfagentmail.git
cd cfagentmail
npm install
```

### 3. Generate Worker Types
```bash
npm run types
```

### 4. Apply Database Migrations (Local)
```bash
npm run db:migrate:local
```

### 5. Start Development Server
```bash
npm run dev
```
The REST API will be available at `http://localhost:8787`.

### 6. Run Automated Tests
```bash
npm test
```

---

## API Reference

### Inboxes

#### Create Inbox
```http
POST /v1/inboxes
Content-Type: application/json

{
  "username": "support-agent",
  "domain": "yourdomain.com",
  "displayName": "Customer Support Agent",
  "metadata": {
    "tenant_id": "acme_corp",
    "tier": "enterprise"
  },
  "clientId": "unique-client-req-001"
}
```
*Response (`201 Created`):*
```json
{
  "inbox_id": "support-agent@yourdomain.com",
  "id": "support-agent@yourdomain.com",
  "email": "support-agent@yourdomain.com",
  "username": "support-agent",
  "domain": "yourdomain.com",
  "display_name": "Customer Support Agent",
  "metadata": {
    "tenant_id": "acme_corp",
    "tier": "enterprise"
  },
  "created_at": "2026-08-14T12:00:00.000Z",
  "updated_at": "2026-08-14T12:00:00.000Z"
}
```

#### List Inboxes
```http
GET /v1/inboxes?limit=20&offset=0
```

#### Get Inbox
```http
GET /v1/inboxes/support-agent@yourdomain.com
```

#### Update Inbox Metadata
```http
PATCH /v1/inboxes/support-agent@yourdomain.com
Content-Type: application/json

{
  "displayName": "Senior Support Agent",
  "metadata": {
    "tier": "enterprise-plus",
    "old_key": null
  }
}
```

#### Delete Inbox
```http
DELETE /v1/inboxes/support-agent@yourdomain.com
```

---

### Messages

#### Send Message
```http
POST /v1/inboxes/support-agent@yourdomain.com/messages
Content-Type: application/json

{
  "to": ["user@example.com"],
  "cc": ["lead@example.com"],
  "subject": "Your Ticket Has Been Resolved",
  "text": "Hello! Your ticket is resolved. See attached summary.",
  "html": "<p>Hello! Your ticket is <strong>resolved</strong>.</p>",
  "attachments": [
    {
      "filename": "summary.txt",
      "content": "VGlja2V0IFN1bW1hcnk6IEFsbCBnb29kIQ==",
      "type": "text/plain"
    }
  ]
}
```

#### List Messages
```http
GET /v1/inboxes/support-agent@yourdomain.com/messages?limit=20
```

#### Search Messages (FTS5)
```http
GET /v1/inboxes/support-agent@yourdomain.com/messages/search?q=invoice
```

#### Get Message
```http
GET /v1/inboxes/support-agent@yourdomain.com/messages/msg_12345
```

#### Reply to Message
```http
POST /v1/inboxes/support-agent@yourdomain.com/messages/msg_12345/reply
Content-Type: application/json

{
  "text": "Glad we could help! Let us know if you need anything else.",
  "replyAll": false
}
```

#### Download Attachment
```http
GET /v1/inboxes/support-agent@yourdomain.com/messages/msg_12345/attachments/att_67890
```

#### Download Raw MIME (.eml)
```http
GET /v1/inboxes/support-agent@yourdomain.com/messages/msg_12345/raw
```

---

### Threads & Full-Text Search

#### Search Threads (FTS5 with Highlights)
```http
GET /v1/inboxes/support-agent@yourdomain.com/threads/search?q=invoice
```
*Response (`200 OK`):*
```json
{
  "threads": [
    {
      "thread_id": "th_12345",
      "id": "th_12345",
      "inbox_id": "support-agent@yourdomain.com",
      "subject": "Quarterly Invoice INV-2026-Q3",
      "snippet": "Please find attached your invoice...",
      "last_message_at": "2026-08-14T12:00:00.000Z",
      "message_count": 2,
      "labels": ["INBOX"],
      "highlights": {
        "subject": ["Quarterly **Invoice** INV-2026-Q3"],
        "text": ["Please find attached your **invoice** for services..."]
      }
    }
  ],
  "count": 1,
  "total": 1
}
```

#### Org-Wide Search Threads
```http
GET /v1/threads/search?q=migration
```

#### List Threads (with Filters)
```http
GET /v1/inboxes/support-agent@yourdomain.com/threads?limit=20&labels=INBOX,IMPORTANT&ascending=false
```

#### Get Thread (Chronological Message Tree)
```http
GET /v1/inboxes/support-agent@yourdomain.com/threads/th_12345
```

---

### Drafts (Human-In-The-Loop)

#### Create Draft
```http
POST /v1/inboxes/support-agent@yourdomain.com/drafts
Content-Type: application/json

{
  "to": ["client@example.com"],
  "subject": "Discount Proposal",
  "text": "Proposed 15% discount for annual contract."
}
```

#### Update Draft (HITL Review / Editing)
```http
PATCH /v1/inboxes/support-agent@yourdomain.com/drafts/draft_12345
Content-Type: application/json

{
  "subject": "Approved Discount Proposal",
  "text": "Approved 20% discount for annual contract."
}
```

#### Send Draft (Execution)
```http
POST /v1/inboxes/support-agent@yourdomain.com/drafts/draft_12345/send
```

---

### Multi-Tenant Pods

Pods provide workspace-level and tenant-level isolation for grouping inboxes, threads, and API keys.

#### Create Pod
```http
POST /v1/pods
Content-Type: application/json

{
  "name": "Acme Corp Fleet",
  "metadata": {
    "tier": "enterprise",
    "region": "us-east"
  }
}
```

#### List Inboxes in Pod
```http
GET /v1/pods/pod_12345/inboxes
```

#### Create Pod-Scoped API Key
```http
POST /v1/pods/pod_12345/api-keys
Content-Type: application/json

{
  "name": "Fleet Agent Supervisor Key"
}
```

---

### Access Rules & Policies (Allow / Block Lists)

Protect agent inboxes from unwanted senders, spam, or restrict communication to trusted partners.

#### Create Allowlist Rule (Only allow specific domain)
```http
POST /v1/inboxes/support-agent@yourdomain.com/rules
Content-Type: application/json

{
  "ruleType": "allow",
  "pattern": "@trustedpartner.com"
}
```

#### Create Blocklist Rule (Reject spammers or tag as SPAM)
```http
POST /v1/inboxes/support-agent@yourdomain.com/rules
Content-Type: application/json

{
  "ruleType": "block",
  "pattern": "*@spammarketing.org",
  "action": "spam"
}
```

---

### Workers AI Auto-Labeling & Email Intelligence

Extract actionable intelligence, summaries, sentiment, and categories automatically using Cloudflare Workers AI.

#### Trigger On-Demand AI Analysis
```http
POST /v1/inboxes/support-agent@yourdomain.com/messages/msg_12345/analyze
```
*Response (`200 OK`):*
```json
{
  "insight_id": "ai_98765",
  "id": "ai_98765",
  "message_id": "msg_12345",
  "summary": "Customer requesting urgent invoice adjustment for billing dispute.",
  "sentiment": "negative",
  "urgency": 5,
  "labels": ["URGENT", "BILLING"],
  "action_item": "Verify transaction in billing system.",
  "created_at": "2026-08-14T12:00:00.000Z"
}
```

#### Get Message AI Insight
```http
GET /v1/inboxes/support-agent@yourdomain.com/messages/msg_12345/insight
```

---

### WebSockets (Real-Time Push Stream)

Connect via standard WebSocket with your API key or Bearer token:

#### Inbox-Scoped Real-Time Stream
```
wss://api.yourdomain.com/v1/inboxes/support-agent@yourdomain.com/ws
```

#### Organization-Wide Real-Time Stream
```
wss://api.yourdomain.com/v1/ws
```

*Example Received Event:*
```json
{
  "type": "email.received",
  "inboxId": "support-agent@yourdomain.com",
  "timestamp": 1770984000000,
  "data": {
    "message_id": "msg_12345",
    "thread_id": "th_67890",
    "from": { "email": "user@client.com", "name": "Alice" },
    "subject": "Need help with API integration",
    "snippet": "Hello, I am getting a 401 Unauthorized..."
  }
}
```

---

### Webhooks

#### Create Webhook Subscription
```http
POST /v1/webhooks
Content-Type: application/json

{
  "url": "https://api.myagent.com/webhooks/cfagentmail",
  "events": ["email.received", "email.sent", "draft.created"],
  "inboxId": "support-agent@yourdomain.com",
  "secret": "whsec_custom_secret_key"
}
```
*Response (`201 Created`):*
```json
{
  "webhook_id": "wh_abcd1234",
  "id": "wh_abcd1234",
  "inbox_id": "support-agent@yourdomain.com",
  "url": "https://api.myagent.com/webhooks/cfagentmail",
  "events": ["email.received", "email.sent", "draft.created"],
  "secret": "whsec_custom_secret_key",
  "is_active": true,
  "created_at": "2026-08-14T12:00:00.000Z",
  "updated_at": "2026-08-14T12:00:00.000Z"
}
```

#### List Webhook Delivery History
```http
GET /v1/webhooks/wh_abcd1234/deliveries
```

#### Verifying Webhook Signatures
Every webhook request contains the header:
```
X-CFAgentMail-Signature: t=1770984000000,v1=9f83b2...
```
Compute `HMAC-SHA256(secret, "${timestamp}.${rawBody}")` and verify equality with `v1`.

---

### Local Agent Integration (Hermes Agent & Cloudflare Tunnel)

Run autonomous AI agents like **Hermes Agent** locally on your machine and receive real-time email triggers via **Cloudflare Tunnel (`cloudflared`)**:

1. **Start the local Hermes bridge:**
   ```bash
   export HERMES_BRIDGE_PORT=8788
   export CFAGENTMAIL_WEBHOOK_SECRET="whsec_my_secret"
   npx tsx examples/hermes-agent/receiver.ts
   ```

2. **Open a Cloudflare Quick Tunnel:**
   ```bash
   cloudflared tunnel --url http://localhost:8788
   ```

3. **Register your tunnel URL with CFAgentMail:**
   ```bash
   curl -X POST https://api.yourdomain.com/v1/webhooks \
     -H "Authorization: Bearer am_live_your_key" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://your-tunnel.trycloudflare.com/webhook",
       "events": ["email.received"],
       "inboxId": "hermes@yourdomain.com",
       "secret": "whsec_my_secret"
     }'
   ```

See the full guide in [`docs/hermes-tunnel-guide.md`](docs/hermes-tunnel-guide.md).

---

### API Keys

#### Create Inbox-Scoped API Key
```http
POST /v1/inboxes/support-agent@yourdomain.com/api-keys
Content-Type: application/json

{
  "name": "Production Agent Worker Key"
}
```
*Response (`201 Created`):*
```json
{
  "id": "key_abcd1234",
  "api_key_id": "key_abcd1234",
  "api_key": "am_live_9f83b2...",
  "name": "Production Agent Worker Key",
  "inbox_id": "support-agent@yourdomain.com",
  "created_at": "2026-08-14T12:00:00.000Z"
}
```

#### List API Keys
```http
GET /v1/inboxes/support-agent@yourdomain.com/api-keys
```

#### Delete API Key
```http
DELETE /v1/inboxes/support-agent@yourdomain.com/api-keys/key_abcd1234
```

---

## Model Context Protocol (MCP) Server

CFAgentMail includes an official Model Context Protocol (MCP) server that enables AI tools and assistants like **Claude Desktop**, **Cursor**, **Claude Code**, **Goose**, **Hermes**, and **Windsurf** to manage agent mailboxes natively.

### 1. Claude Desktop Configuration
Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cfagentmail": {
      "command": "npx",
      "args": ["-y", "tsx", "/path/to/cfagentmail/src/mcp/cli.ts"],
      "env": {
        "CFAGENTMAIL_API_KEY": "am_live_your_api_key",
        "CFAGENTMAIL_BASE_URL": "https://api.yourdomain.com/v1"
      }
    }
  }
}
```

### 2. Cursor IDE Configuration
In Cursor Settings > **Features** > **MCP Servers**, add a new server:
- **Type**: `command`
- **Command**: `npx -y tsx /path/to/cfagentmail/src/mcp/cli.ts`
- **Environment Variables**:
  - `CFAGENTMAIL_API_KEY`: `am_live_your_api_key`
  - `CFAGENTMAIL_BASE_URL`: `https://api.yourdomain.com/v1`

---

## Official SDKs

### TypeScript / JavaScript SDK

```bash
npm install cfagentmail
```

```typescript
import { CFAgentMail } from "cfagentmail";

const client = new CFAgentMail({
  apiKey: "am_live_your_api_key",
  baseUrl: "https://api.yourdomain.com/v1",
});

// Create an inbox
const inbox = await client.inboxes.create({
  username: "support-agent",
  displayName: "Support Agent",
});

// Send an email
const message = await client.messages.send(inbox.id, {
  to: ["customer@example.com"],
  subject: "Ticket #1024 Update",
  text: "Your issue has been resolved.",
});

// Search threads via FTS5
const results = await client.threads.search(inbox.id, "resolved");
console.log(results.threads[0].highlights);
```

---

### Python SDK

```bash
pip install cfagentmail
```

```python
from cfagentmail import CFAgentMail

client = CFAgentMail(
    api_key="am_live_your_api_key",
    base_url="https://api.yourdomain.com/v1"
)

# Create an inbox
inbox = client.inboxes.create(username="triage-bot")

# Send message
msg = client.messages.send(
    inbox_id=inbox.id,
    to="client@corp.com",
    subject="Welcome",
    text="Welcome aboard!"
)

# Run AI intelligence
insight = client.messages.analyze(inbox_id=inbox.id, message_id=msg.id)
print(f"Summary: {insight.summary}, Urgency: {insight.urgency}/5")
```

---

## Production Deployment to Cloudflare

### 1. Enable Cloudflare Email Sending
Onboard your domain onto Cloudflare Email Sending:
```bash
npx wrangler email sending enable yourdomain.com
```

### 2. Configure Cloudflare Email Routing
1. In Cloudflare Dashboard, go to **Compute & AI** > **Email Service** > **Email Routing**.
2. Add a **Catch-all rule** routing `*@yourdomain.com` to Worker `cfagentmail`.

### 3. Create Cloudflare D1 & R2 Resources
```bash
# Create D1 database
npx wrangler d1 create cfagentmail-db

# Create R2 bucket
npx wrangler r2 bucket create cfagentmail-attachments
```
Update `database_id` in [`wrangler.jsonc`](wrangler.jsonc) with the returned ID.

### 4. Run Remote Migrations
```bash
npm run db:migrate:remote
```

### 5. Deploy Worker
```bash
npm run deploy
```

---

## Roadmap

- [x] **Phase 1**: Core Mailbox & Ingestion Engine (D1 schema, Email Routing handler, Email Sending binding, R2 storage, REST API).
- [x] **Phase 2**: Full-Text Search with SQLite FTS5, Conversation Threading, and Drafts / HITL Workflow.
- [x] **Phase 3**: Real-time WebSockets with Durable Object Hibernation API & HMAC-Signed Webhook Subscriptions.
- [x] **Phase 4**: Multi-Tenant Pods, Allow/Block Lists, and Workers AI Auto-Labeling.
- [x] **Phase 5**: Model Context Protocol (MCP) Server and Official TypeScript / Python SDKs.

---

## License

MIT
