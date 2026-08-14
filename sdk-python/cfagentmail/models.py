"""
CFAgentMail Python SDK Data Models
"""

from typing import List, Optional, Dict, Any, Union
from pydantic import BaseModel, Field


class MessageRecipient(BaseModel):
    email: str
    name: Optional[str] = None


class AttachmentMeta(BaseModel):
    id: str
    message_id: str
    filename: str
    content_type: str
    size_bytes: int
    disposition: str = "attachment"
    content_id: Optional[str] = None
    r2_key: str
    created_at: str


class Inbox(BaseModel):
    id: str
    inbox_id: Optional[str] = None
    email: str
    username: str
    domain: str
    pod_id: Optional[str] = None
    display_name: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    created_at: str
    updated_at: str


class Message(BaseModel):
    id: str
    message_id: Optional[str] = None
    inbox_id: str
    thread_id: str
    from_: Dict[str, Any] = Field(alias="from")
    to: List[MessageRecipient]
    subject: str
    text: Optional[str] = None
    html: Optional[str] = None
    snippet: Optional[str] = None
    direction: str
    labels: Optional[List[str]] = None
    created_at: str


class Thread(BaseModel):
    id: str
    thread_id: Optional[str] = None
    inbox_id: str
    subject: str
    snippet: Optional[str] = None
    last_message_at: str
    message_count: int
    labels: Optional[List[str]] = None
    highlights: Optional[Dict[str, List[str]]] = None
    messages: Optional[List[Message]] = None


class Draft(BaseModel):
    id: str
    draft_id: Optional[str] = None
    inbox_id: str
    thread_id: str
    to: List[MessageRecipient]
    subject: str
    text: Optional[str] = None
    created_at: str
    updated_at: str


class AiInsight(BaseModel):
    id: str
    insight_id: Optional[str] = None
    message_id: str
    summary: str
    sentiment: str
    urgency: int
    labels: List[str]
    action_item: Optional[str] = None
    created_at: str


class Pod(BaseModel):
    id: str
    pod_id: Optional[str] = None
    name: str
    metadata: Optional[Dict[str, Any]] = None
    created_at: str
    updated_at: str


class AccessRule(BaseModel):
    id: str
    rule_id: Optional[str] = None
    inbox_id: Optional[str] = None
    pod_id: Optional[str] = None
    rule_type: str
    pattern: str
    action: str
    created_at: str


class Webhook(BaseModel):
    id: str
    webhook_id: Optional[str] = None
    inbox_id: Optional[str] = None
    url: str
    events: List[str]
    secret: str
    is_active: bool
    created_at: str
    updated_at: str
