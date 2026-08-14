# CFAgentMail

> An API-first, serverless email platform built for AI agents — running natively on Cloudflare Workers, Cloudflare Email Service, D1 (SQLite), and R2.

CFAgentMail gives AI agents their own programmable inboxes to send, receive, thread, and process emails at edge scale with zero per-seat subscription costs.

---

## Features

- 📬 **Programmatic Inboxes**: Provision tens, hundreds, or thousands of agent inboxes on-demand with custom metadata and auto-generated or custom domains.
- 📥 **Inbound Email Ingestion**: Native Cloudflare Email Routing handler with full MIME decoding (`postal-mime`), attachment extraction, and automatic inbox auto-provisioning.
- 📤 **Outbound Email Delivery**: High-deliverability transactional sending via Cloudflare Email Sending (`send_email` binding) with SPF, DKIM, and DMARC.
- 🧵 **Automatic Conversation Threading**: Group multi-turn messages into threads using RFC 2822 (`Message-ID`, `In-Reply-To`, `References`) headers with subject normalization fallback.
- 📎 **Attachment & Raw EML Storage**: Direct streaming of attachments and raw `.eml` RFC822 files into Cloudflare R2 object storage.
- 🔑 **Fine-Grained Scoped API Keys**: Issue SHA-256 hashed API keys scoped to individual inboxes to enforce least-privilege access for agent fleets.
- 🛡️ **Idempotent Operations**: Avoid duplicate resource creation and double-sends using `clientId` on inboxes and custom idempotency keys.
- 🧪 **100% Tested at the Edge**: Comprehensive test suite running directly inside the real `workerd` runtime using `@cloudflare/vitest-pool-workers`.

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
│  4. Indexing: Persist messages, metadata, and thread associations into Cloudflare D1 (SQLite)    │
│  5. Raw Archive: Store full .eml RFC822 byte stream into Cloudflare R2                           │
└──────────────────────┬───────────────────────────────────────────────┬───────────────────────────┘
                       │                                               │
                       ▼                                               ▼
       ┌───────────────────────────────┐               ┌───────────────────────────┐
       │     Cloudflare D1 (SQLite)    │               │       Cloudflare R2       │
       │   - Inboxes & Metadata        │               │   - Raw .eml MIME files   │
       │   - Threads & Messages        │               │   - Message attachments   │
       │   - Attachments metadata      │               │   - Binary downloads      │
       │   - Scoped API Keys           │               │                           │
       └───────────────────────────────┘               └───────────────────────────┘
                       ▲
                       │
┌──────────────────────┴───────────────────────────────────────────────────────────────────────────┐
│ REST API Clients & Agents (Claude Code, Cursor, LangChain, Python / TS SDKs)                     │
│                                                                                                  │
│  - REST Endpoints: `/v1/inboxes`, `/v1/inboxes/:id/messages`, `/v1/inboxes/:id/api-keys`        │
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
git clone https://github.com/your-username/cfagentmail.git
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
- [ ] **Phase 3**: Real-time WebSockets with Durable Object Hibernation API & Cloudflare Queues for Webhooks.
- [ ] **Phase 4**: Multi-Tenant Pods, Allow/Block Lists, and Workers AI Auto-Labeling.
- [ ] **Phase 5**: Model Context Protocol (MCP) Server and Official TypeScript / Python SDKs.

---

## License

MIT
