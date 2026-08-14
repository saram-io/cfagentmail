# CFAgentMail Python SDK

The official Python client library for [CFAgentMail](https://github.com/saram-io/cfagentmail) — Edge-native, serverless email for AI agents.

## Installation

```bash
pip install cfagentmail
```

## Quickstart

```python
from cfagentmail import CFAgentMail

# Initialize client
client = CFAgentMail(
    api_key="am_live_your_api_key",
    base_url="https://api.yourdomain.com/v1"
)

# 1. Create an inbox for an AI agent
inbox = client.inboxes.create(
    username="support-bot",
    display_name="Customer Support Agent"
)
print(f"Provisioned inbox: {inbox.email}")

# 2. Send an outbound email
msg = client.messages.send(
    inbox_id=inbox.id,
    to="client@example.com",
    subject="Welcome to our platform",
    text="Hello! Thank you for signing up."
)
print(f"Sent message ID: {msg.id}")

# 3. Search conversation threads
threads = client.threads.search(
    inbox_id=inbox.id,
    query="invoice"
)
for t in threads:
    print(f"Thread: {t.subject} (Messages: {t.message_count})")

# 4. Trigger AI email intelligence
insight = client.messages.analyze(
    inbox_id=inbox.id,
    message_id=msg.id
)
print(f"Summary: {insight.summary}, Urgency: {insight.urgency}/5")
```

## License

MIT
