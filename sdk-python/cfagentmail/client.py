"""
CFAgentMail Python Client
"""

from typing import List, Optional, Dict, Any, Union
import httpx
from .models import (
    Inbox,
    Message,
    Thread,
    Draft,
    AiInsight,
    Pod,
    AccessRule,
    Webhook,
)


class InboxesAPI:
    def __init__(self, client: "CFAgentMail"):
        self._client = client

    def create(
        self,
        username: Optional[str] = None,
        domain: Optional[str] = None,
        pod_id: Optional[str] = None,
        display_name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        client_id: Optional[str] = None,
    ) -> Inbox:
        payload = {}
        if username:
            payload["username"] = username
        if domain:
            payload["domain"] = domain
        if pod_id:
            payload["podId"] = pod_id
        if display_name:
            payload["displayName"] = display_name
        if metadata:
            payload["metadata"] = metadata
        if client_id:
            payload["clientId"] = client_id

        data = self._client._post("/inboxes", json=payload)
        return Inbox(**data)

    def list(self, limit: int = 20, offset: int = 0) -> List[Inbox]:
        data = self._client._get("/inboxes", params={"limit": limit, "offset": offset})
        return [Inbox(**item) for item in data.get("inboxes", [])]

    def get(self, inbox_id: str) -> Inbox:
        data = self._client._get(f"/inboxes/{inbox_id}")
        return Inbox(**data)

    def delete(self, inbox_id: str) -> bool:
        data = self._client._delete(f"/inboxes/{inbox_id}")
        return data.get("success", False)


class MessagesAPI:
    def __init__(self, client: "CFAgentMail"):
        self._client = client

    def send(
        self,
        inbox_id: str,
        to: Union[str, List[str]],
        subject: str,
        text: Optional[str] = None,
        html: Optional[str] = None,
        cc: Optional[List[str]] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> Message:
        payload = {
            "to": [to] if isinstance(to, str) else to,
            "subject": subject,
        }
        if text:
            payload["text"] = text
        if html:
            payload["html"] = html
        if cc:
            payload["cc"] = cc
        if attachments:
            payload["attachments"] = attachments

        data = self._client._post(f"/inboxes/{inbox_id}/messages", json=payload)
        return Message(**data)

    def reply(
        self,
        inbox_id: str,
        message_id: str,
        text: Optional[str] = None,
        html: Optional[str] = None,
        reply_all: bool = False,
    ) -> Message:
        payload = {"replyAll": reply_all}
        if text:
            payload["text"] = text
        if html:
            payload["html"] = html

        data = self._client._post(
            f"/inboxes/{inbox_id}/messages/{message_id}/reply", json=payload
        )
        return Message(**data)

    def list(self, inbox_id: str, limit: int = 20, offset: int = 0) -> List[Message]:
        data = self._client._get(
            f"/inboxes/{inbox_id}/messages", params={"limit": limit, "offset": offset}
        )
        return [Message(**item) for item in data.get("messages", [])]

    def analyze(self, inbox_id: str, message_id: str) -> AiInsight:
        data = self._client._post(f"/inboxes/{inbox_id}/messages/{message_id}/analyze")
        return AiInsight(**data)


class ThreadsAPI:
    def __init__(self, client: "CFAgentMail"):
        self._client = client

    def list(
        self, inbox_id: str, limit: int = 20, offset: int = 0
    ) -> List[Thread]:
        data = self._client._get(
            f"/inboxes/{inbox_id}/threads", params={"limit": limit, "offset": offset}
        )
        return [Thread(**item) for item in data.get("threads", [])]

    def get(self, inbox_id: str, thread_id: str) -> Thread:
        data = self._client._get(f"/inboxes/{inbox_id}/threads/{thread_id}")
        return Thread(**data)

    def search(self, inbox_id: str, query: str, limit: int = 20) -> List[Thread]:
        data = self._client._get(
            f"/inboxes/{inbox_id}/threads/search",
            params={"q": query, "limit": limit},
        )
        return [Thread(**item) for item in data.get("threads", [])]


class DraftsAPI:
    def __init__(self, client: "CFAgentMail"):
        self._client = client

    def create(
        self,
        inbox_id: str,
        to: Union[str, List[str]],
        subject: str,
        text: Optional[str] = None,
    ) -> Draft:
        payload = {
            "to": [to] if isinstance(to, str) else to,
            "subject": subject,
            "text": text,
        }
        data = self._client._post(f"/inboxes/{inbox_id}/drafts", json=payload)
        return Draft(**data)

    def send(self, inbox_id: str, draft_id: str) -> Message:
        data = self._client._post(f"/inboxes/{inbox_id}/drafts/{draft_id}/send")
        return Message(**data)


class PodsAPI:
    def __init__(self, client: "CFAgentMail"):
        self._client = client

    def create(self, name: str, metadata: Optional[Dict[str, Any]] = None) -> Pod:
        payload = {"name": name}
        if metadata:
            payload["metadata"] = metadata
        data = self._client._post("/pods", json=payload)
        return Pod(**data)

    def list(self, limit: int = 50, offset: int = 0) -> List[Pod]:
        data = self._client._get("/pods", params={"limit": limit, "offset": offset})
        return [Pod(**item) for item in data.get("pods", [])]


class CFAgentMail:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.yourdomain.com/v1",
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        self._http = httpx.Client(base_url=self.base_url, headers=headers, timeout=timeout)

        self.inboxes = InboxesAPI(self)
        self.messages = MessagesAPI(self)
        self.threads = ThreadsAPI(self)
        self.drafts = DraftsAPI(self)
        self.pods = PodsAPI(self)

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        res = self._http.get(path, params=params)
        res.raise_for_status()
        return res.json()

    def _post(self, path: str, json: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        res = self._http.post(path, json=json)
        res.raise_for_status()
        return res.json()

    def _patch(self, path: str, json: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        res = self._http.patch(path, json=json)
        res.raise_for_status()
        return res.json()

    def _delete(self, path: str) -> Dict[str, Any]:
        res = self._http.delete(path)
        res.raise_for_status()
        return res.json()
