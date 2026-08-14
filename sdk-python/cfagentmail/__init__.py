"""
CFAgentMail Python SDK
"""

from .client import CFAgentMail
from .models import (
    Inbox,
    Message,
    Thread,
    Draft,
    AiInsight,
    Pod,
    AccessRule,
    Webhook,
    MessageRecipient,
    AttachmentMeta,
)

__version__ = "0.5.0"
__all__ = [
    "CFAgentMail",
    "Inbox",
    "Message",
    "Thread",
    "Draft",
    "AiInsight",
    "Pod",
    "AccessRule",
    "Webhook",
    "MessageRecipient",
    "AttachmentMeta",
]
