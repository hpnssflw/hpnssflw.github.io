"""Telegram approval (docs/superpowers/specs/2026-10-08-telegram-approval-design.md):
the bot asks the owner about each new queue item in his private chat, with
Approve / Reject buttons, and the agent picks up his taps through
getUpdates at the start of each real run. <data-dir>/telegram.json is this
side's record -- the update offset, Telegram's decisions, and which
message asks about which item. It's published on agent-data, so it holds
no chat id, user id or token."""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from html import escape
from pathlib import Path

from agent import bot_api
from agent.dedupe import url_hash
from agent.deliver import INTER_MESSAGE_DELAY_SECONDS
from agent.inbox import DecisionEntry, DecisionsUnavailable
from agent.paths import DataPaths
from agent.pending import PendingItem
from agent.preset import Preset, TelegramApprovalConfig
from agent.run_result import FEED_SCOPE, Tally

STATUSES = ("waiting", "approved", "sent", "rejected", "expired")
SHOWN = (*STATUSES, "gone")  # gone: Telegram says the message no longer exists
STORE_DECISIONS = ("approve", "reject", "clear")
TAP_DECISIONS = {"a": "approve", "r": "reject", "u": "clear"}
UPDATES_LIMIT = 100  # one getUpdates per run: a second call would confirm taps not yet saved
NOT_MODIFIED = "message is not modified"
GONE = ("message to edit not found", "message can't be edited")

LABELS = {
    "en": {
        "approve": "✅ Approve",
        "reject": "❌ Reject",
        "undo": "↩ Undo",
        "approved": "✅ Approved — goes out with the next digest",
        "sent": "📤 Sent {date}",
        "rejected": "❌ Rejected",
        "expired": "⌛ Expired",
    },
    "ru": {
        "approve": "✅ Одобрить",
        "reject": "❌ Отклонить",
        "undo": "↩ Отменить",
        "approved": "✅ Одобрено — уйдёт со следующим дайджестом",
        "sent": "📤 Отправлено {date}",
        "rejected": "❌ Отклонено",
        "expired": "⌛ Истекло",
    },
}


@dataclass
class AskMessage:
    message_id: int
    shown: str  # one of SHOWN: what its text and buttons last showed


@dataclass
class TelegramStore:
    offset: int = 0  # the next getUpdates offset
    decisions: dict[str, DecisionEntry] = field(default_factory=dict)  # url -> latest tap
    messages: dict[str, AskMessage] = field(default_factory=dict)  # url -> its ask


def load_store(path: Path) -> TelegramStore:
    """A missing file is an empty store; a malformed one makes the
    Telegram side unavailable for the run."""
    if not path.exists():
        return TelegramStore()
    try:
        return _parse_store(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError, TypeError) as exc:
        raise DecisionsUnavailable(f"telegram.json: {exc}") from None


def save_store(path: Path, store: TelegramStore) -> None:
    raw = {
        "version": 1,
        "offset": store.offset,
        "decisions": {url: asdict(entry) for url, entry in sorted(store.decisions.items())},
        "messages": {url: asdict(message) for url, message in sorted(store.messages.items())},
    }
    path.write_text(json.dumps(raw, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def _parse_store(raw) -> TelegramStore:
    if not isinstance(raw, dict) or type(raw.get("version")) is not int or raw["version"] != 1:
        raise ValueError("missing or unsupported version")
    offset = raw.get("offset")
    if type(offset) is not int or offset < 0:
        raise ValueError("offset is not a non-negative integer")
    decisions = {}
    for url, entry in _mapping(raw, "decisions").items():
        if not isinstance(entry, dict) or entry.get("decision") not in STORE_DECISIONS or not isinstance(entry.get("at"), str):
            raise ValueError(f"invalid decision for {url}")
        decisions[url] = DecisionEntry(entry["decision"], entry["at"])
    messages = {}
    for url, entry in _mapping(raw, "messages").items():
        if not isinstance(entry, dict) or type(entry.get("message_id")) is not int or entry.get("shown") not in SHOWN:
            raise ValueError(f"invalid message for {url}")
        messages[url] = AskMessage(entry["message_id"], entry["shown"])
    return TelegramStore(offset, decisions, messages)


def _mapping(raw: dict, key: str) -> dict:
    value = raw.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"'{key}' is not an object")
    return value


def render(item: PendingItem, status: str, language: str, now: datetime) -> tuple[str, dict]:
    """An ask's text (parse_mode=HTML) and inline keyboard for `status`."""
    words = LABELS[language]
    title = escape(item.title)
    link = f'<a href="{escape(item.url, quote=True)}">{title}</a>' if item.url.startswith(("http://", "https://")) else title
    text = f"<b>{escape(item.topic_name)}</b> · {item.score}/10 · {escape(item.source)}\n{link}\n{escape(item.summary)}"
    if status != "waiting":
        text += "\n\n" + words[status].format(date=now.strftime("%d.%m"))
    digest = url_hash(item.url)
    if status == "waiting":
        keyboard = [[
            {"text": words["approve"], "callback_data": f"a:{digest}"},
            {"text": words["reject"], "callback_data": f"r:{digest}"},
        ]]
    elif status == "approved":
        keyboard = [[{"text": words["undo"], "callback_data": f"u:{digest}"}]]
    else:
        keyboard = []
    return text, {"inline_keyboard": keyboard}


def apply_taps(store: TelegramStore, updates: list, owner: int, items: list[PendingItem], now: datetime) -> list[PendingItem]:
    """Record the owner's taps on current queue items (the last tap on an
    item wins) and move the offset past every update read. Returns the
    tapped items, one per tap."""
    by_hash = {url_hash(item.url): item for item in items}
    valid = [u for u in updates if isinstance(u, dict) and type(u.get("update_id")) is int]
    tapped = []
    for update in sorted(valid, key=lambda u: u["update_id"]):
        store.offset = max(store.offset, update["update_id"] + 1)
        item, decision = _tap(update.get("callback_query"), owner, by_hash)
        if item is not None:
            store.decisions[item.url] = DecisionEntry(decision, now.isoformat())
            tapped.append(item)
    return tapped


def _tap(query, owner: int, by_hash: dict[str, PendingItem]):
    if not isinstance(query, dict):
        return None, None
    sender, message = query.get("from"), query.get("message")
    if not isinstance(sender, dict) or not isinstance(message, dict) or not isinstance(message.get("chat"), dict):
        return None, None
    if sender.get("id") != owner or message["chat"].get("id") != owner:
        return None, None
    data = query.get("data")
    if not isinstance(data, str):
        return None, None
    action, _, digest = data.partition(":")
    decision, item = TAP_DECISIONS.get(action), by_hash.get(digest)
    if decision is None or item is None:
        return None, None
    return item, decision


class TelegramReview:
    """One run's Telegram side. collect() first; ask(), update() and
    save() only after it succeeded."""

    def __init__(self, config: TelegramApprovalConfig, language: str, path: Path) -> None:
        self.config = config
        self.language = language
        self.path = path
        self._store: TelegramStore | None = None
        self._token = ""
        self._owner = 0
        self._sends = 0

    def collect(self, items: list[PendingItem], now: datetime) -> tuple[dict[str, DecisionEntry], list[PendingItem]]:
        """Read new taps on `items` and record them. Returns Telegram's
        decisions (every URL it holds one for) and the items tapped this
        run. Raises DecisionsUnavailable: no token or owner chat id, a
        malformed telegram.json, or getUpdates failing (a webhook set on
        the bot answers 409)."""
        token = os.environ.get(self.config.bot_token_env, "")
        owner = os.environ.get(self.config.owner_chat_env, "").strip()
        if not token:
            raise DecisionsUnavailable(f"{self.config.bot_token_env} is not set")
        if not re.fullmatch(r"-?\d+", owner):
            raise DecisionsUnavailable(f"{self.config.owner_chat_env} is not set to a chat id")
        store = load_store(self.path)
        try:
            updates = bot_api.call(
                token,
                "getUpdates",
                {"offset": store.offset, "limit": UPDATES_LIMIT, "timeout": 0, "allowed_updates": ["callback_query"]},
            )
        except bot_api.BotApiError as exc:
            raise DecisionsUnavailable(f"telegram getUpdates failed: {exc}") from None
        if not isinstance(updates, list):
            raise DecisionsUnavailable("telegram getUpdates: result is not a list")
        tapped = apply_taps(store, updates, int(owner), items, now)
        self._store, self._token, self._owner = store, token, int(owner)
        return dict(store.decisions), tapped

    def ask(self, items: list[PendingItem], decisions: dict[str, str] | None, now: datetime, tally: Tally) -> int:
        """Send an ask for queue items that have none, newest first, at
        most max_asks_per_run. A failed send leaves the item to the next run."""
        store = self._ready()
        fresh = sorted((i for i in items if i.url not in store.messages), key=lambda i: (i.pending_since, i.url), reverse=True)
        asked = 0
        for item in fresh[: self.config.max_asks_per_run]:
            status = "approved" if decisions and decisions.get(item.url) == "approve" else "waiting"
            text, markup = render(item, status, self.language, now)
            try:
                result = self._send("sendMessage", {"chat_id": self._owner, "text": text, **_HTML, "reply_markup": markup})
            except bot_api.BotApiError as exc:
                tally.fail("review", FEED_SCOPE, "telegram", exc)
                continue
            message_id = result.get("message_id") if isinstance(result, dict) else None
            if type(message_id) is not int:
                tally.fail("review", FEED_SCOPE, "telegram", bot_api.BotApiError("sendMessage: no message_id"))
                continue
            store.messages[item.url] = AskMessage(message_id, status)
            tally.note("review", item.topic, "asked")
            asked += 1
        return asked

    def update(
        self,
        before: dict[str, PendingItem],
        items: list[PendingItem],
        decisions: dict[str, str],
        sent: set[str],
        rejected: set[str],
        now: datetime,
        tally: Tally,
    ) -> None:
        """Bring every ask to its item's status after review and delivery.
        `before` is the queue as it was before review: items that left it
        this run get a final edit (tried once), then their entries go."""
        store = self._ready()
        queued = {item.url: item for item in items}
        store.decisions = {url: entry for url, entry in store.decisions.items() if url in queued}
        for url, message in list(store.messages.items()):
            if url in queued:
                item, status = queued[url], ("approved" if decisions.get(url) == "approve" else "waiting")
            elif url in before:
                item = before[url]
                status = "sent" if url in sent else "rejected" if url in rejected else "expired"
            else:
                item, status = None, None
            if item is not None and message.shown not in (status, "gone"):
                self._edit(message, item, status, now, tally)
            if url not in queued:
                del store.messages[url]

    def save(self) -> None:
        save_store(self.path, self._ready())

    def _edit(self, message: AskMessage, item: PendingItem, status: str, now: datetime, tally: Tally) -> None:
        """A failed edit leaves `shown` as it was: retried next run while the
        item is queued; update() drops a final one's entry either way."""
        text, markup = render(item, status, self.language, now)
        payload = {"chat_id": self._owner, "message_id": message.message_id, "text": text, **_HTML, "reply_markup": markup}
        try:
            self._send("editMessageText", payload)
        except bot_api.BotApiError as exc:
            if NOT_MODIFIED in exc.description:
                message.shown = status
            elif any(phrase in exc.description for phrase in GONE):
                message.shown = "gone"
            else:
                tally.fail("review", FEED_SCOPE, "telegram", exc)
            return
        message.shown = status

    def _send(self, method: str, payload: dict):
        if self._sends:
            time.sleep(INTER_MESSAGE_DELAY_SECONDS)
        self._sends += 1
        return bot_api.call(self._token, method, payload)

    def _ready(self) -> TelegramStore:
        if self._store is None:
            raise RuntimeError("TelegramReview.collect() must succeed first")
        return self._store


_HTML = {"parse_mode": "HTML", "disable_web_page_preview": True}


def review_for(preset: Preset, paths: DataPaths) -> TelegramReview | None:
    if preset.approval.telegram is None:
        return None
    return TelegramReview(preset.approval.telegram, preset.language, paths.telegram)
