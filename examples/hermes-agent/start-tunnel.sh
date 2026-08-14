#!/usr/bin/env bash
# ==============================================================================
# CFAgentMail -> Hermes Agent Cloudflare Tunnel Quickstart
# ==============================================================================

set -e

PORT="${HERMES_BRIDGE_PORT:-8788}"
CFAGENTMAIL_API_URL="${CFAGENTMAIL_API_URL:-http://localhost:8787}"
CFAGENTMAIL_API_KEY="${CFAGENTMAIL_API_KEY:-}"
INBOX_ID="${INBOX_ID:-}"
WEBHOOK_SECRET="${CFAGENTMAIL_WEBHOOK_SECRET:-whsec_hermes_local_secret}"

echo "========================================================"
echo " Starting CFAgentMail Local Hermes Agent Bridge"
echo "========================================================"

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "⚠️  cloudflared is not installed."
    echo "   Install it from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/"
    echo "   Or on macOS: brew install cloudflared"
    echo "   Or on Linux: sudo apt install cloudflared / brew install cloudflared"
fi

echo "1. Starting Hermes Local Webhook Bridge on port ${PORT}..."
# In background or separate terminal: npx tsx examples/hermes-agent/receiver.ts &

echo ""
echo "2. Launching Cloudflare Quick Tunnel:"
echo "   Run the following command to expose your local bridge securely to Cloudflare:"
echo ""
echo "   cloudflared tunnel --url http://localhost:${PORT}"
echo ""
echo "3. Once your tunnel URL is ready (e.g., https://abc-xyz.trycloudflare.com), register it:"
echo ""
echo "   curl -X POST ${CFAGENTMAIL_API_URL}/v1/webhooks \\"
echo "     -H 'Authorization: Bearer \${CFAGENTMAIL_API_KEY}' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{"
echo "       \"url\": \"https://YOUR_TUNNEL_URL/webhook\","
echo "       \"events\": [\"email.received\", \"draft.created\"],"
echo "       \"inboxId\": \"${INBOX_ID}\","
echo "       \"secret\": \"${WEBHOOK_SECRET}\""
echo "     }'"
echo ""
echo "========================================================"
