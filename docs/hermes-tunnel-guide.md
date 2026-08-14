# Connecting Local Hermes Agent to CFAgentMail via Cloudflare Tunnel

This guide walks through connecting **Hermes Agent** (running locally on your development machine) to **CFAgentMail** (running on Cloudflare Workers) using **Cloudflare Tunnel (`cloudflared`)** and **HMAC-signed Webhooks**.

---

## Architecture Flow

```
┌───────────────────────────────────────────────────────────┐
│ Cloudflare Edge (CFAgentMail Worker)                      │
│                                                           │
│ 1. Inbound email arrives at agent inbox                   │
│ 2. MIME parsing + D1 indexing + AI analysis               │
│ 3. CFAgentMail dispatches HMAC-signed Webhook             │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼ HTTPS Webhook Request (X-CFAgentMail-Signature)
┌───────────────────────────────────────────────────────────┐
│ Cloudflare Tunnel Edge                                    │
│ (https://your-tunnel.trycloudflare.com / custom domain)   │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼ Secure WireGuard / QUIC Tunnel
┌───────────────────────────────────────────────────────────┐
│ Local Machine                                             │
│                                                           │
│ 1. cloudflared daemon (forwards to localhost:8788)        │
│ 2. CFAgentMail Hermes Bridge (verifies signature & parses)│
│ 3. Hermes Gateway / CLI executes agent response workflow  │
│ 4. Hermes calls CFAgentMail REST API / MCP to reply       │
└───────────────────────────────────────────────────────────┘
```

---

## Step-by-Step Setup

### Step 1: Start the Local Hermes Bridge

In your `cfagentmail` project repository:

```bash
export HERMES_BRIDGE_PORT=8788
export CFAGENTMAIL_WEBHOOK_SECRET="whsec_my_super_secret_key"
export HERMES_GATEWAY_URL="http://localhost:8080/webhook"
# Optional: Set EXECUTE_HERMES_CLI=true to run `hermes run` directly

npx tsx examples/hermes-agent/receiver.ts
```

The bridge server will start on `http://localhost:8788/webhook`.

---

### Step 2: Launch Cloudflare Tunnel

Open a new terminal and run `cloudflared` to create a secure, public tunnel to your local bridge:

#### Quick Tunnel (No configuration needed)
```bash
cloudflared tunnel --url http://localhost:8788
```
`cloudflared` will print a public URL, for example:
```
https://brave-falcon-123.trycloudflare.com
```

#### Dedicated / Named Tunnel (Custom Domain)
If you have a custom domain on Cloudflare:
```bash
cloudflared tunnel run my-hermes-tunnel
```
Routing to `https://hermes.yourdomain.com/webhook`.

---

### Step 3: Register the Webhook in CFAgentMail

Subscribe your Cloudflare Tunnel URL to email events in CFAgentMail:

```bash
curl -X POST https://api.yourdomain.com/v1/webhooks \
  -H "Authorization: Bearer am_live_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://brave-falcon-123.trycloudflare.com/webhook",
    "events": ["email.received", "draft.created"],
    "inboxId": "hermes-agent@yourdomain.com",
    "secret": "whsec_my_super_secret_key"
  }'
```

*Response (`201 Created`):*
```json
{
  "webhook_id": "wh_9a8b7c6d",
  "id": "wh_9a8b7c6d",
  "url": "https://brave-falcon-123.trycloudflare.com/webhook",
  "events": ["email.received", "draft.created"],
  "is_active": true
}
```

---

### Step 4: Configure Hermes Agent Tools

In your Hermes Agent configuration file (`~/.hermes/config.yaml`), enable the gateway and provide CFAgentMail API tools:

```yaml
gateway:
  enabled: true
  port: 8080
  routes:
    - path: "/webhook"
      events:
        - "email.received"

tools:
  - name: "cfagentmail"
    type: "rest_api"
    base_url: "https://api.yourdomain.com/v1"
    headers:
      Authorization: "Bearer am_live_your_api_key"
    endpoints:
      - name: "get_thread"
        method: "GET"
        path: "/inboxes/{inbox_id}/threads/{thread_id}"
      - name: "reply_message"
        method: "POST"
        path: "/inboxes/{inbox_id}/messages/{message_id}/reply"
```

---

### Step 5: Test the Integration

You can trigger a test webhook dispatch using CFAgentMail's test endpoint:

```bash
curl -X POST https://api.yourdomain.com/v1/webhooks/wh_9a8b7c6d/test \
  -H "Authorization: Bearer am_live_your_api_key"
```

You will see the webhook arrive in your local bridge terminal with verified cryptographic signature:
```
[Hermes Bridge] Received valid event: email.received for inbox: hermes-agent@yourdomain.com
[Hermes Bridge] Triggering Hermes Agent:
[NEW EMAIL RECEIVED]
Inbox: hermes-agent@yourdomain.com
From: Customer <user@example.com>
Subject: Need support with API
...
```

Hermes Agent will now autonomously process and respond to incoming emails in real-time on your local machine!
