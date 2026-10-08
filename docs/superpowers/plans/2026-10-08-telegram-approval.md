# Telegram Approval (sub-project C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bot asks Artem about each new queue item in his private chat with Approve / Reject buttons; the agent reads his taps through `getUpdates` at the start of each real run, merges them with the site's `decisions.json` (latest action wins), and the control room shows both.

**Architecture:** A small Bot API client (`agent/bot_api.py`) is shared by digest delivery and the new `agent/telegram_review.py`, which owns `<data-dir>/telegram.json` (update offset, Telegram decisions, ask messages), reads taps, sends asks and edits them. `agent/approval.py` gains `merge_decisions`; `engine.run_real` collects taps before review, applies the merged decisions through the unchanged `inbox.apply_decisions`, and asks/updates after delivery. The site reads `agent/telegram.json` from `agent-data` and merges it with `decisions.json` through a TypeScript mirror pinned to the same shared cases.

**Tech Stack:** Python 3.12 (`requests`, pytest), Next.js App Router + TypeScript (Vitest), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-08-telegram-approval-design.md` — read it first.

## Global Constraints

- The agent never writes `decisions.json`, and the site gets no new token (`CLAUDE.md`).
- `decisions.json` v1 is unchanged; `inbox.apply_decisions` is unchanged.
- `run-result.json` stays `schema_version: 2`; only additions (`config.approval.telegram`, review notes `telegram_taps` / `asked`, failures with `source: "telegram"`). An older `run-result.json` without them must still parse on the site.
- The owner's chat id lives only in the environment (`TELEGRAM_OWNER_CHAT_ID`); it never appears in `telegram.json`, `run-result.json`, events, stdout or failures. Errors never carry the bot token.
- Failures carry the exception class only (`tally.fail`), as today.
- `--preview` and `--dry-run` never touch Telegram; `--offline` refuses a preset with `approval.telegram`.
- Demo goldens (`agent/tests/fixtures/{newsroom,agro}-demo/golden/`) stay byte-identical. Tony's goldens change only where Task 5 says.
- `max_asks_per_run` for Tony: `10`. Ask order: newest `pending_since` first.
- Status lines and buttons (en / ru) exactly as the spec's table: `✅ Approve` / `✅ Одобрить`, `❌ Reject` / `❌ Отклонить`, `↩ Undo` / `↩ Отменить`, `✅ Approved — goes out with the next digest` / `✅ Одобрено — уйдёт со следующим дайджестом`, `📤 Sent dd.mm` / `📤 Отправлено dd.mm`, `❌ Rejected` / `❌ Отклонено`, `⌛ Expired` / `⌛ Истекло`.
- No new dependencies (Python or npm). Don't add Tailwind / CSS-in-JS; no CSS changes are needed.
- Work in the worktree `C:\A\polozov\.claude\worktrees\stories` (branch `worktree-stories`). Nothing goes to `main` without Artem's word.
- Python: `agent/venv/Scripts/python -m pytest agent/tests -q`. Site: `npm test`, `npm run build`.
- Commit per task, staging only that task's files; never stage `.claude/settings.local.json`. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `agent/bot_api.py` (new) | One Bot API call: POST, 429 retried once, token-free `BotApiError` with Telegram's `description` |
| `agent/deliver.py` | Digest delivery; its Telegram posts now go through `bot_api.call` |
| `agent/inbox.py` | `DecisionEntry` (decision + `at`), `parse_decision_entries`, `load_decision_entries` |
| `agent/approval.py` | Adapters gain `load_entries()`; new `merge_decisions` |
| `agent/preset.py` | `TelegramApprovalConfig`, `approval.telegram` block, `--offline` refuses it |
| `agent/paths.py` | `DataPaths.telegram` |
| `agent/run_result.py` | `config.approval.telegram` (env names and the cap) |
| `agent/telegram_review.py` (new) | `telegram.json` store, taps, ask rendering, `TelegramReview` (collect / ask / update / save), `review_for` |
| `agent/context.py` | `Adapters.review` |
| `agent/engine.py` | Taps before review, merged decisions, asks and updates after delivery |
| `agent/presets/tony.yaml` | Tony's `approval.telegram` block |
| `.github/workflows/agent-run.yml`, `.gitignore` | Carry `agent/telegram.json`; pass `TELEGRAM_OWNER_CHAT_ID` |
| `agent/tests/fixtures/approval-merge.json` (new) | Shared merge cases, run by pytest and Vitest |
| `agent/tests/conftest.py` | `FakeBot`, `tap()`, `OWNER`; Tony harness serves the Bot API |
| `lib/telegram-decisions.ts` (new) | `TELEGRAM_URL`, `parseTelegramDecisions`, `mergeDecisions` |
| `lib/queue-view.ts` | `allowedActions` |
| `lib/run-result.ts`, `lib/config-view.ts`, `lib/control-room-text.ts`, `components/ConfigSpine.tsx` | `approval.telegram` in the config spine |
| `components/ControlRoom.tsx`, `components/QueuePane.tsx` | Merged statuses, `· telegram`, actions for Telegram-decided rows |

---

### Task 1: Bot API client

**Files:**
- Create: `agent/bot_api.py`
- Modify: `agent/deliver.py`
- Test: `agent/tests/test_bot_api.py`

**Interfaces:**
- Produces: `bot_api.call(token: str, method: str, payload: dict) -> object` (Telegram's `result`); `bot_api.BotApiError(RuntimeError)` with `.description: str`; `bot_api.TIMEOUT_SECONDS = 10`.

- [ ] **Step 1: Write the failing tests**

`agent/tests/test_bot_api.py`:

```python
import pytest
import requests

from agent import bot_api
from agent.tests.conftest import FakeResponse

TOKEN = "123:secret"


def _post_returning(*responses, calls=None):
    queue = list(responses)

    def post(url, json=None, timeout=None):
        if calls is not None:
            calls.append((url, json, timeout))
        response = queue.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    return post


def test_call_posts_the_payload_and_returns_the_result(monkeypatch):
    calls = []
    monkeypatch.setattr(requests, "post", _post_returning(FakeResponse(200, {"ok": True, "result": {"message_id": 7}}), calls=calls))
    assert bot_api.call(TOKEN, "sendMessage", {"chat_id": 1, "text": "hi"}) == {"message_id": 7}
    assert calls == [("https://api.telegram.org/bot123:secret/sendMessage", {"chat_id": 1, "text": "hi"}, 10)]


def test_a_429_is_retried_once_after_retry_after(monkeypatch):
    slept = []
    monkeypatch.setattr(bot_api.time, "sleep", slept.append)
    monkeypatch.setattr(
        requests,
        "post",
        _post_returning(
            FakeResponse(429, {"ok": False, "parameters": {"retry_after": 3}}),
            FakeResponse(200, {"ok": True, "result": True}),
        ),
    )
    assert bot_api.call(TOKEN, "editMessageText", {}) is True
    assert slept == [3.0]


def test_errors_carry_status_and_description_but_never_the_token(monkeypatch):
    body = {"ok": False, "description": "Bad Request: message is not modified"}
    monkeypatch.setattr(requests, "post", _post_returning(FakeResponse(400, body)))
    with pytest.raises(bot_api.BotApiError) as error:
        bot_api.call(TOKEN, "editMessageText", {})
    assert "HTTP 400" in str(error.value)
    assert TOKEN not in str(error.value)
    assert error.value.description == "Bad Request: message is not modified"


def test_a_network_error_never_carries_the_url(monkeypatch):
    failure = requests.ConnectionError(f"https://api.telegram.org/bot{TOKEN}/getUpdates unreachable")
    monkeypatch.setattr(requests, "post", _post_returning(failure))
    with pytest.raises(bot_api.BotApiError) as error:
        bot_api.call(TOKEN, "getUpdates", {})
    assert str(error.value) == "Telegram request failed"
    assert error.value.description == ""


def test_a_200_without_ok_is_an_error(monkeypatch):
    monkeypatch.setattr(requests, "post", _post_returning(FakeResponse(200, {"ok": False, "description": "nope"})))
    with pytest.raises(bot_api.BotApiError, match="getUpdates"):
        bot_api.call(TOKEN, "getUpdates", {})
```

- [ ] **Step 2: Run them to see them fail**

Run: `agent/venv/Scripts/python -m pytest agent/tests/test_bot_api.py -q`
Expected: FAIL — `ImportError: cannot import name 'bot_api'`.

- [ ] **Step 3: Write `agent/bot_api.py`**

```python
"""One Telegram Bot API call: a POST, a 429 retried once after its
retry_after hint, and errors that never carry the bot token -- it's in
the request URL, so neither the URL nor a requests exception's own str()
is ever used. Digest delivery (agent/deliver.py) and Telegram approval
(agent/telegram_review.py) both call through here."""

from __future__ import annotations

import time

import requests

API_URL = "https://api.telegram.org/bot{token}/{method}"
TIMEOUT_SECONDS = 10


class BotApiError(RuntimeError):
    """A failed call. str() is the HTTP status plus Telegram's JSON error
    body; .description is Telegram's own error text ("" when there is
    none). Neither contains the token."""

    def __init__(self, message: str, description: str = "") -> None:
        super().__init__(message)
        self.description = description


def call(token: str, method: str, payload: dict):
    url = API_URL.format(token=token, method=method)
    try:
        response = requests.post(url, json=payload, timeout=TIMEOUT_SECONDS)
        if response.status_code == 429:
            time.sleep(retry_after_seconds(response))
            response = requests.post(url, json=payload, timeout=TIMEOUT_SECONDS)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise BotApiError(safe_error_message(exc), _description(exc.response)) from None
    body = _json(response)
    if not isinstance(body, dict) or body.get("ok") is not True:
        raise BotApiError(f"Telegram API error: {method} answered without ok", _description(response))
    return body.get("result")


def retry_after_seconds(response: requests.Response) -> float:
    try:
        return float(response.json()["parameters"]["retry_after"])
    except (ValueError, KeyError, TypeError):
        return 1.0


def safe_error_message(exc: requests.RequestException) -> str:
    """Only the parts of a requests exception that can't contain the
    token: the HTTP status and Telegram's JSON error body."""
    response = exc.response
    if response is not None:
        return f"Telegram API error: HTTP {response.status_code}: {response.text}"
    return "Telegram request failed"


def _json(response):
    try:
        return response.json()
    except ValueError:
        return None


def _description(response) -> str:
    body = _json(response) if response is not None else None
    description = body.get("description") if isinstance(body, dict) else None
    return description if isinstance(description, str) else ""
```

- [ ] **Step 4: Route `deliver.py`'s Telegram posts through it**

In `agent/deliver.py`: replace `import requests` with `from agent import bot_api`; delete `SEND_MESSAGE_URL`, `_send_one`, `_post`, `_retry_after_seconds` and `_safe_error_message`; keep `INTER_MESSAGE_DELAY_SECONDS`, `FileDelivery` and `delivery_for` as they are. `TelegramDelivery.send` becomes:

```python
    def send(self, messages: list[str], run_id: str) -> None:
        token = os.environ[self.bot_token_env]
        for index, message in enumerate(messages):
            bot_api.call(
                token,
                "sendMessage",
                {"chat_id": self.chat, "text": message, "parse_mode": "HTML", "disable_web_page_preview": True},
            )
            if index < len(messages) - 1:
                time.sleep(INTER_MESSAGE_DELAY_SECONDS)
```

The module docstring keeps its first paragraph; add one line: "Telegram posts go through agent/bot_api.py (429 retry, token-free errors)." Then check nothing else used the deleted names:

Run: `git grep -n "_safe_error_message\|_retry_after_seconds\|SEND_MESSAGE_URL\|deliver._post\|_send_one" -- agent`
Expected: no output.

- [ ] **Step 5: Run the tests**

Run: `agent/venv/Scripts/python -m pytest agent/tests -q`
Expected: all pass — including `test_adapters.py`'s Telegram delivery tests (same URLs, payloads and "HTTP 400" error) and Tony's goldens (the digest payload is unchanged).

- [ ] **Step 6: Commit**

```bash
git add agent/bot_api.py agent/deliver.py agent/tests/test_bot_api.py
git commit -m "Share one Bot API client between digest delivery and what comes next"
```

---

### Task 2: Decision entries and the merge

**Files:**
- Modify: `agent/inbox.py`, `agent/approval.py`, `agent/context.py` (docstring of `Adapters.approval`), `agent/tests/test_adapters.py`
- Create: `agent/tests/fixtures/approval-merge.json`, `agent/tests/test_approval_merge.py`

**Interfaces:**
- Produces: `inbox.DecisionEntry(decision: str, at: str)` (frozen dataclass; `decision` is `approve`/`reject`, plus `clear` in Telegram's store); `inbox.parse_decision_entries(raw) -> dict[str, DecisionEntry]`; `inbox.load_decision_entries(url, token) -> dict[str, DecisionEntry]`; `inbox.decisions_of(entries) -> dict[str, str]`; `InboxApproval.load_entries()` / `FileApproval.load_entries() -> dict[str, DecisionEntry]` (raise `inbox.DecisionsUnavailable`); `approval.merge_decisions(site: dict[str, DecisionEntry], telegram: dict[str, DecisionEntry]) -> dict[str, str]`.
- `parse_decisions`, `load_decisions` and the adapters' `load()` keep their current signatures and results.

- [ ] **Step 1: Write the shared merge cases**

`agent/tests/fixtures/approval-merge.json` — the site's entries only ever hold `approve`/`reject`; every time carries an offset (the site writes `Z`, the agent `+00:00`):

```json
{
  "cases": [
    {
      "name": "site only",
      "site": { "https://a": { "decision": "approve", "at": "2026-10-09T08:00:00.000Z" } },
      "telegram": {},
      "expected": { "https://a": "approve" },
      "via_telegram": []
    },
    {
      "name": "telegram only",
      "site": {},
      "telegram": { "https://a": { "decision": "reject", "at": "2026-10-09T08:00:00+00:00" } },
      "expected": { "https://a": "reject" },
      "via_telegram": ["https://a"]
    },
    {
      "name": "a later telegram tap wins",
      "site": { "https://a": { "decision": "approve", "at": "2026-10-09T08:00:00.000Z" } },
      "telegram": { "https://a": { "decision": "reject", "at": "2026-10-09T12:00:00+00:00" } },
      "expected": { "https://a": "reject" },
      "via_telegram": ["https://a"]
    },
    {
      "name": "a later site decision wins",
      "site": { "https://a": { "decision": "reject", "at": "2026-10-09T13:00:00.000Z" } },
      "telegram": { "https://a": { "decision": "approve", "at": "2026-10-09T12:00:00+00:00" } },
      "expected": { "https://a": "reject" },
      "via_telegram": []
    },
    {
      "name": "a tie goes to the site",
      "site": { "https://a": { "decision": "approve", "at": "2026-10-09T12:00:00.000Z" } },
      "telegram": { "https://a": { "decision": "reject", "at": "2026-10-09T12:00:00+00:00" } },
      "expected": { "https://a": "approve" },
      "via_telegram": []
    },
    {
      "name": "undo in telegram takes back an older site approval",
      "site": { "https://a": { "decision": "approve", "at": "2026-10-09T08:00:00.000Z" } },
      "telegram": { "https://a": { "decision": "clear", "at": "2026-10-09T12:00:00+00:00" } },
      "expected": {},
      "via_telegram": []
    },
    {
      "name": "undo with no site entry leaves the item undecided",
      "site": {},
      "telegram": { "https://a": { "decision": "clear", "at": "2026-10-09T12:00:00+00:00" } },
      "expected": {},
      "via_telegram": []
    },
    {
      "name": "an undo older than the site's decision changes nothing",
      "site": { "https://a": { "decision": "reject", "at": "2026-10-09T13:00:00.000Z" } },
      "telegram": { "https://a": { "decision": "clear", "at": "2026-10-09T12:00:00+00:00" } },
      "expected": { "https://a": "reject" },
      "via_telegram": []
    },
    {
      "name": "an unparseable site time counts as the oldest",
      "site": { "https://a": { "decision": "approve", "at": "yesterday" } },
      "telegram": { "https://a": { "decision": "reject", "at": "2026-10-09T12:00:00+00:00" } },
      "expected": { "https://a": "reject" },
      "via_telegram": ["https://a"]
    },
    {
      "name": "several urls at once",
      "site": {
        "https://a": { "decision": "approve", "at": "2026-10-09T08:00:00.000Z" },
        "https://b": { "decision": "reject", "at": "2026-10-09T08:00:00.000Z" }
      },
      "telegram": {
        "https://b": { "decision": "approve", "at": "2026-10-09T12:00:00+00:00" },
        "https://c": { "decision": "approve", "at": "2026-10-09T12:00:00+00:00" }
      },
      "expected": { "https://a": "approve", "https://b": "approve", "https://c": "approve" },
      "via_telegram": ["https://b", "https://c"]
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`agent/tests/test_approval_merge.py`:

```python
import pytest

from agent.approval import merge_decisions
from agent.inbox import DecisionEntry
from agent.tests.conftest import FIXTURES, load_json

CASES = load_json(FIXTURES / "approval-merge.json")["cases"]


def _entries(raw: dict) -> dict[str, DecisionEntry]:
    return {url: DecisionEntry(entry["decision"], entry["at"]) for url, entry in raw.items()}


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_merge_decisions_on_the_shared_cases(case):
    assert merge_decisions(_entries(case["site"]), _entries(case["telegram"])) == case["expected"]
```

Append to `agent/tests/test_adapters.py`:

```python
def test_file_approval_entries_keep_the_time(tmp_path):
    path = tmp_path / "decisions.json"
    path.write_text(
        json.dumps({"version": 1, "decisions": {"https://a": {"decision": "reject", "at": "2026-10-06T00:00:00Z"}}}),
        encoding="utf-8",
    )
    assert approval.FileApproval(path).load_entries() == {"https://a": inbox.DecisionEntry("reject", "2026-10-06T00:00:00Z")}
```

and change `test_inbox_approval_reads_the_token_from_the_named_variable` to patch the entries loader (the adapter now goes through it):

```python
def test_inbox_approval_reads_the_token_from_the_named_variable(monkeypatch):
    seen = {}
    monkeypatch.setattr(inbox, "load_decision_entries", lambda url, token: seen.update(url=url, token=token) or {})
    monkeypatch.setenv("INBOX_TOKEN", "t0k")
    approval.InboxApproval("https://api.github.com/repos/x/y/contents/decisions.json", "INBOX_TOKEN").load()
    assert seen == {"url": "https://api.github.com/repos/x/y/contents/decisions.json", "token": "t0k"}
```

- [ ] **Step 3: Run them to see them fail**

Run: `agent/venv/Scripts/python -m pytest agent/tests/test_approval_merge.py agent/tests/test_adapters.py -q`
Expected: FAIL — `ImportError: cannot import name 'merge_decisions'` / `DecisionEntry`.

- [ ] **Step 4: Implement**

`agent/inbox.py` — add `from dataclasses import dataclass` and, after `DecisionsUnavailable`:

```python
@dataclass(frozen=True)
class DecisionEntry:
    """One decision and when it was made. decisions.json holds approve or
    reject; Telegram's store (agent/telegram_review.py) adds clear (Undo)."""

    decision: str
    at: str
```

Rename the body of `parse_decisions` into `parse_decision_entries` (same validation, but `result[url] = DecisionEntry(entry["decision"], entry["at"])`, return type `dict[str, DecisionEntry]`), then:

```python
def decisions_of(entries: dict[str, DecisionEntry]) -> dict[str, str]:
    return {url: entry.decision for url, entry in entries.items()}


def parse_decisions(raw: object) -> dict[str, str]:
    """Validate a decoded decisions.json payload and return {url: decision}.
    Any shape problem fails the whole file -- no partial application."""
    return decisions_of(parse_decision_entries(raw))
```

Rename `load_decisions` to `load_decision_entries` (same body, `return parse_decision_entries(raw)`, return type `dict[str, DecisionEntry]`), and add:

```python
def load_decisions(url: str, token: str | None) -> dict[str, str]:
    return decisions_of(load_decision_entries(url, token))
```

`agent/approval.py` — the module docstring's second sentence becomes "Each loads {url: DecisionEntry} or raises inbox.DecisionsUnavailable (then nothing is dropped or delivered this run); merge_decisions folds in Telegram's taps and inbox.apply_decisions does the rest." Add `from datetime import datetime, timezone`. Each adapter gets `load_entries` and a derived `load`:

```python
class InboxApproval:
    ...
    def load_entries(self) -> dict[str, inbox.DecisionEntry]:
        return inbox.load_decision_entries(self.decisions_url, os.environ.get(self.token_env))

    def load(self) -> dict[str, str]:
        return inbox.decisions_of(self.load_entries())


class FileApproval:
    ...
    def load_entries(self) -> dict[str, inbox.DecisionEntry]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise inbox.DecisionsUnavailable(f"{self.path.name}: {exc}") from exc
        return inbox.parse_decision_entries(raw)

    def load(self) -> dict[str, str]:
        return inbox.decisions_of(self.load_entries())
```

and at the end of the module:

```python
def merge_decisions(
    site: dict[str, inbox.DecisionEntry], telegram: dict[str, inbox.DecisionEntry]
) -> dict[str, str]:
    """The decisions a run applies: per URL, the later of the site's entry
    and Telegram's (a tie goes to the site); Telegram's "clear" (Undo)
    leaves the item undecided. lib/telegram-decisions.ts mirrors this, and
    agent/tests/fixtures/approval-merge.json pins both."""
    merged: dict[str, str] = {}
    for url in sorted(site.keys() | telegram.keys()):
        ours, theirs = site.get(url), telegram.get(url)
        winner = ours if theirs is None or (ours is not None and _when(ours.at) >= _when(theirs.at)) else theirs
        if winner.decision != "clear":
            merged[url] = winner.decision
    return merged


def _when(at: str) -> datetime:
    """An unparseable time counts as the oldest; one without an offset as UTC."""
    try:
        moment = datetime.fromisoformat(at)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=timezone.utc)
```

`agent/context.py` — `Adapters.approval`'s comment becomes `# load_entries() -> {url: inbox.DecisionEntry}; raises inbox.DecisionsUnavailable`.

- [ ] **Step 5: Run the tests**

Run: `agent/venv/Scripts/python -m pytest agent/tests -q`
Expected: all pass (the engine still calls `load()`; Task 5 switches it).

- [ ] **Step 6: Commit**

```bash
git add agent/inbox.py agent/approval.py agent/context.py agent/tests/test_adapters.py agent/tests/test_approval_merge.py agent/tests/fixtures/approval-merge.json
git commit -m "Keep decision times and merge two decision sources, latest wins"
```

---

### Task 3: The preset's `approval.telegram` block

**Files:**
- Modify: `agent/preset.py`, `agent/paths.py`, `agent/run_result.py`, `agent/tests/test_preset.py`, `agent/tests/test_run_result.py`

**Interfaces:**
- Produces: `preset.TelegramApprovalConfig(bot_token_env: str, owner_chat_env: str, max_asks_per_run: int)` (frozen); `ApprovalConfig.telegram: TelegramApprovalConfig | None = None`; `DataPaths.telegram -> Path` (`<root>/telegram.json`); `run-result.json` `config.approval.telegram = {"bot_token_env", "owner_chat_env", "max_asks_per_run"}` only when the block is present.

- [ ] **Step 1: Write the failing tests**

Append to `agent/tests/test_preset.py` (`TelegramApprovalConfig` joins the `from agent.preset import ...` line):

```python
TELEGRAM_BLOCK = {"bot_token_env": "TELEGRAM_BOT_TOKEN", "owner_chat_env": "TELEGRAM_OWNER_CHAT_ID", "max_asks_per_run": 10}


@pytest.mark.parametrize(
    "approval",
    [
        {"type": "file", "path": "fixtures/decisions.json", "expire_days": 3},
        {"type": "inbox", "decisions_url": "https://x", "expire_days": 7, "token_env": "GITHUB_TOKEN"},
    ],
)
def test_approval_takes_an_optional_telegram_block(tmp_path, approval):
    preset = load_preset(write_preset(tmp_path, dict(VALID, approval=dict(approval, telegram=TELEGRAM_BLOCK))))
    assert preset.approval.telegram == TelegramApprovalConfig("TELEGRAM_BOT_TOKEN", "TELEGRAM_OWNER_CHAT_ID", 10)


def test_approval_without_the_block_has_no_telegram(tmp_path):
    assert load_preset(write_preset(tmp_path, VALID)).approval.telegram is None


@pytest.mark.parametrize(
    ("block", "message"),
    [
        ({k: v for k, v in TELEGRAM_BLOCK.items() if k != "owner_chat_env"}, "approval.telegram.owner_chat_env: required"),
        (dict(TELEGRAM_BLOCK, max_asks_per_run=0), "approval.telegram.max_asks_per_run: expected an integer >= 1"),
        (dict(TELEGRAM_BLOCK, chat="@x"), "approval.telegram.chat: unknown key"),
        ("yes", "approval.telegram: expected a mapping"),
    ],
)
def test_invalid_telegram_blocks_name_the_key(tmp_path, block, message):
    raw = dict(VALID, approval=dict(VALID["approval"], telegram=block))
    with pytest.raises(PresetError, match=message):
        load_preset(write_preset(tmp_path, raw))


def test_offline_refuses_telegram_approval(tmp_path):
    preset = load_preset(write_preset(tmp_path, dict(VALID, approval=dict(VALID["approval"], telegram=TELEGRAM_BLOCK))))
    with pytest.raises(PresetError, match="approval.telegram: --offline can't use Telegram"):
        require_offline(preset)
```

Append to `agent/tests/test_run_result.py` (reuse its existing imports and `write_preset`/`VALID` helpers as the file already does for `test_self_contained_config_shows_telegram_as_coming_soon_and_relative_paths`; check the top of the file for their names):

```python
def test_config_shows_telegram_approval_by_env_names_only(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEGRAM_OWNER_CHAT_ID", "424242")
    block = {"bot_token_env": "TELEGRAM_BOT_TOKEN", "owner_chat_env": "TELEGRAM_OWNER_CHAT_ID", "max_asks_per_run": 10}
    raw = dict(VALID, approval=dict(VALID["approval"], telegram=block))
    config = preset_config(load_preset(write_preset(tmp_path, raw)))
    assert config["approval"]["telegram"] == block
    assert "424242" not in json.dumps(config)


def test_config_without_telegram_approval_has_no_telegram_key(tmp_path):
    assert "telegram" not in preset_config(load_preset(write_preset(tmp_path, VALID)))["approval"]
```

- [ ] **Step 2: Run them to see them fail**

Run: `agent/venv/Scripts/python -m pytest agent/tests/test_preset.py agent/tests/test_run_result.py -q`
Expected: FAIL — `ImportError: cannot import name 'TelegramApprovalConfig'`.

- [ ] **Step 3: Implement**

`agent/preset.py` — before `ApprovalConfig`:

```python
@dataclass(frozen=True)
class TelegramApprovalConfig:
    """`approval.telegram`: the bot asks the owner about each new queue
    item in a private chat (docs/superpowers/specs/2026-10-08-telegram-approval-design.md)."""

    bot_token_env: str  # names of environment variables, never the values
    owner_chat_env: str
    max_asks_per_run: int
```

`ApprovalConfig` gains a last field `telegram: TelegramApprovalConfig | None = None`. In `_approval`, both `_fields` calls take `("telegram",)` as optional keys, and both returned `ApprovalConfig`s pass `telegram=_approval_telegram(section)`. New helper after `_approval`:

```python
def _approval_telegram(section: dict) -> TelegramApprovalConfig | None:
    if "telegram" not in section:
        return None
    where = "approval.telegram"
    raw = _fields(section["telegram"], where, ("bot_token_env", "owner_chat_env", "max_asks_per_run"))
    return TelegramApprovalConfig(
        bot_token_env=_str(raw, "bot_token_env", where),
        owner_chat_env=_str(raw, "owner_chat_env", where),
        max_asks_per_run=_int(raw, "max_asks_per_run", where, minimum=1),
    )
```

In `require_offline`, right after the `approval.type` check:

```python
    if preset.approval.telegram is not None:
        raise PresetError("approval.telegram: --offline can't use Telegram")
```

`agent/paths.py` — after `stories`:

```python
    @property
    def telegram(self) -> Path:
        return self.root / "telegram.json"
```

`agent/run_result.py` — `_approval` becomes:

```python
def _approval(preset: Preset) -> dict:
    approval = preset.approval
    if approval.type == "inbox":
        out = {
            "type": "inbox",
            "decisions_url": approval.decisions_url,
            "token_env": approval.token_env,
            "expire_days": approval.expire_days,
        }
    else:
        out = {"type": "file", "path": _relative(preset, approval.path), "expire_days": approval.expire_days}
    if approval.telegram is not None:
        out["telegram"] = {
            "bot_token_env": approval.telegram.bot_token_env,
            "owner_chat_env": approval.telegram.owner_chat_env,
            "max_asks_per_run": approval.telegram.max_asks_per_run,
        }
    return out
```

- [ ] **Step 4: Run the tests**

Run: `agent/venv/Scripts/python -m pytest agent/tests -q`
Expected: all pass; no golden changes (no preset has the block yet). Confirm: `git status --short agent/tests/fixtures` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add agent/preset.py agent/paths.py agent/run_result.py agent/tests/test_preset.py agent/tests/test_run_result.py
git commit -m "Add an optional approval.telegram block to presets"
```

---

### Task 4: `telegram_review.py` — store, taps, asks and updates

**Files:**
- Create: `agent/telegram_review.py`, `agent/tests/test_telegram_review.py`
- Modify: `agent/tests/conftest.py` (add `OWNER`, `FakeBot`, `tap`)

**Interfaces:**
- Consumes: `bot_api.call`, `bot_api.BotApiError` (Task 1); `inbox.DecisionEntry`, `inbox.DecisionsUnavailable` (Task 2); `preset.TelegramApprovalConfig`, `DataPaths.telegram` (Task 3); `dedupe.url_hash`; `pending.PendingItem`; `run_result.Tally`, `run_result.FEED_SCOPE`; `deliver.INTER_MESSAGE_DELAY_SECONDS`.
- Produces:
  - `TelegramStore(offset: int = 0, decisions: dict[str, DecisionEntry] = {}, messages: dict[str, AskMessage] = {})`, `AskMessage(message_id: int, shown: str)` (dataclasses); `load_store(path) -> TelegramStore` (missing → empty; malformed → `DecisionsUnavailable`); `save_store(path, store)`.
  - `render(item: PendingItem, status: str, language: str, now: datetime) -> tuple[str, dict]` (HTML text, `reply_markup`).
  - `TelegramReview(config, language, path)` with `collect(items, now) -> tuple[dict[str, DecisionEntry], list[PendingItem]]` (raises `DecisionsUnavailable`), `ask(items, decisions: dict[str, str] | None, now, tally) -> int`, `update(before: dict[str, PendingItem], items, decisions: dict[str, str], sent: set[str], rejected: set[str], now, tally) -> None`, `save() -> None`. `ask`/`update`/`save` are called only after a successful `collect`.
  - `review_for(preset, paths) -> TelegramReview | None`.
  - conftest: `OWNER = 1001`; `FakeBot(updates=None)` with `.post` (patch over `requests.post`), `.updates`, `.calls: list[tuple[str, dict]]`, `.fail: dict[str, list[FakeResponse]]` (FIFO per method), `.sent(method) -> list[dict]`; `tap(update_id, data, user=OWNER, chat=OWNER, message_id=1) -> dict`.

- [ ] **Step 1: Add the Bot API fake to `agent/tests/conftest.py`**

After `FakeResponse`:

```python
OWNER = 1001  # the owner's private chat id in tests (TELEGRAM_OWNER_CHAT_ID)


class FakeBot:
    """The Bot API behind requests.post: getUpdates serves `updates` from
    the requested offset, sendMessage numbers messages from 1,
    editMessageText answers ok. `fail[method]` holds responses returned
    instead, first in first out. Records every call as (method, payload)."""

    def __init__(self, updates: list[dict] | None = None):
        self.updates = list(updates or [])
        self.calls: list[tuple[str, dict]] = []
        self.fail: dict[str, list[FakeResponse]] = {}
        self._next_message_id = 1

    def post(self, url, json=None, timeout=None, **kwargs):
        assert url.startswith("https://api.telegram.org/bot"), url
        method = url.rsplit("/", 1)[1]
        self.calls.append((method, json))
        if self.fail.get(method):
            return self.fail[method].pop(0)
        if method == "getUpdates":
            fresh = [u for u in self.updates if u["update_id"] >= json.get("offset", 0)]
            return FakeResponse(200, {"ok": True, "result": fresh[: json.get("limit", 100)]})
        if method == "sendMessage":
            message_id = self._next_message_id
            self._next_message_id += 1
            return FakeResponse(200, {"ok": True, "result": {"message_id": message_id}})
        if method == "editMessageText":
            return FakeResponse(200, {"ok": True, "result": True})
        raise AssertionError(f"unexpected Bot API method {method}")

    def sent(self, method: str) -> list[dict]:
        return [payload for name, payload in self.calls if name == method]


def tap(update_id: int, data: str, user: int = OWNER, chat: int = OWNER, message_id: int = 1) -> dict:
    """A callback_query update: someone pressed an inline button."""
    return {
        "update_id": update_id,
        "callback_query": {
            "id": str(update_id),
            "from": {"id": user},
            "message": {"message_id": message_id, "chat": {"id": chat}},
            "data": data,
        },
    }
```

- [ ] **Step 2: Write the failing tests**

`agent/tests/test_telegram_review.py`:

```python
import json
from datetime import timedelta

import pytest
import requests

from agent import telegram_review
from agent.dedupe import url_hash
from agent.inbox import DecisionEntry, DecisionsUnavailable
from agent.pending import PendingItem
from agent.preset import TelegramApprovalConfig
from agent.run_result import Tally
from agent.telegram_review import AskMessage, TelegramReview, TelegramStore, load_store, render, save_store
from agent.tests.conftest import FROZEN_NOW, OWNER, FakeBot, FakeResponse, tap

CONFIG = TelegramApprovalConfig(bot_token_env="T_TOKEN", owner_chat_env="T_OWNER", max_asks_per_run=2)
A, B, C, D = (f"https://example.com/{x}" for x in "abcd")
NOW = FROZEN_NOW.isoformat()


def item(url: str, hours_ago: int = 1, title: str = "Title", topic: str = "tooling") -> PendingItem:
    since = (FROZEN_NOW - timedelta(hours=hours_ago)).isoformat()
    return PendingItem(url, title, "hn", topic, "Tooling", "Summary.", 8, since)


@pytest.fixture
def bot(monkeypatch):
    fake = FakeBot()
    monkeypatch.setattr(requests, "post", fake.post)
    monkeypatch.setattr(telegram_review.time, "sleep", lambda seconds: None)
    monkeypatch.setenv("T_TOKEN", "123:secret")
    monkeypatch.setenv("T_OWNER", str(OWNER))
    return fake


def new_review(tmp_path) -> TelegramReview:
    return TelegramReview(CONFIG, "en", tmp_path / "telegram.json")


def new_tally() -> Tally:
    return Tally(["tooling"], has_feeds=False)


# --- store -------------------------------------------------------------------


def test_a_missing_store_is_empty_and_a_saved_one_round_trips(tmp_path):
    path = tmp_path / "telegram.json"
    assert load_store(path) == TelegramStore()
    store = TelegramStore(12, {A: DecisionEntry("clear", NOW)}, {A: AskMessage(3, "waiting"), B: AskMessage(4, "gone")})
    save_store(path, store)
    assert load_store(path) == store
    assert json.loads(path.read_text(encoding="utf-8"))["version"] == 1


@pytest.mark.parametrize(
    "content",
    [
        "not json",
        '{"version": 2, "offset": 0, "decisions": {}, "messages": {}}',
        '{"version": 1, "offset": -1, "decisions": {}, "messages": {}}',
        '{"version": 1, "offset": 0, "decisions": {"u": {"decision": "maybe", "at": "x"}}, "messages": {}}',
        '{"version": 1, "offset": 0, "decisions": {}, "messages": {"u": {"message_id": 1, "shown": "lost"}}}',
        '{"version": 1, "offset": 0, "decisions": [], "messages": {}}',
    ],
)
def test_a_malformed_store_makes_telegram_unavailable(tmp_path, content):
    path = tmp_path / "telegram.json"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(DecisionsUnavailable, match="telegram.json"):
        load_store(path)


# --- collect -------------------------------------------------------------------


def test_collect_counts_only_the_owners_taps_and_advances_the_offset(tmp_path, bot):
    bot.updates = [
        tap(5, f"a:{url_hash(A)}"),
        tap(6, f"r:{url_hash(A)}", user=999),  # someone else
        tap(7, f"r:{url_hash(B)}", chat=-100),  # another chat
        tap(8, "a:ffffffffffffffff"),  # no such queue item
        tap(9, f"x:{url_hash(A)}"),  # unknown action
        {"update_id": 10, "message": {"text": "/start"}},  # not a callback
        tap(11, f"u:{url_hash(B)}"),
    ]
    review = new_review(tmp_path)
    decisions, tapped = review.collect([item(A), item(B)], FROZEN_NOW)
    assert decisions == {A: DecisionEntry("approve", NOW), B: DecisionEntry("clear", NOW)}
    assert [i.url for i in tapped] == [A, B]
    assert bot.sent("getUpdates") == [{"offset": 0, "limit": 100, "timeout": 0, "allowed_updates": ["callback_query"]}]
    review.save()
    assert load_store(tmp_path / "telegram.json").offset == 12


def test_the_last_tap_wins_and_rereading_an_unsaved_batch_gives_the_same_decisions(tmp_path, bot):
    bot.updates = [tap(1, f"a:{url_hash(A)}"), tap(2, f"r:{url_hash(A)}")]
    first, _ = new_review(tmp_path).collect([item(A)], FROZEN_NOW)  # not saved: as if the push failed
    again, _ = new_review(tmp_path).collect([item(A)], FROZEN_NOW)
    assert first == again == {A: DecisionEntry("reject", NOW)}


def test_a_saved_offset_skips_taps_already_handled(tmp_path, bot):
    bot.updates = [tap(1, f"a:{url_hash(A)}")]
    review = new_review(tmp_path)
    review.collect([item(A)], FROZEN_NOW)
    review.save()
    later = FROZEN_NOW + timedelta(hours=4)
    decisions, tapped = new_review(tmp_path).collect([item(A)], later)
    assert tapped == [] and decisions == {A: DecisionEntry("approve", NOW)}
    assert bot.sent("getUpdates")[-1]["offset"] == 2


@pytest.mark.parametrize(
    "setup",
    [
        lambda bot, mp: mp.delenv("T_TOKEN"),
        lambda bot, mp: mp.setenv("T_OWNER", "not-a-number"),
        lambda bot, mp: bot.fail.setdefault("getUpdates", []).append(FakeResponse(409, {"ok": False, "description": "Conflict"})),
        lambda bot, mp: bot.fail.setdefault("getUpdates", []).append(FakeResponse(200, {"ok": True, "result": {}})),
    ],
)
def test_collect_is_unavailable_without_token_owner_or_updates(tmp_path, bot, monkeypatch, setup):
    setup(bot, monkeypatch)
    with pytest.raises(DecisionsUnavailable) as error:
        new_review(tmp_path).collect([item(A)], FROZEN_NOW)
    assert "123:secret" not in str(error.value)


# --- render --------------------------------------------------------------------


def test_render_a_waiting_item():
    text, markup = render(item(A, title="Tools & <tricks>"), "waiting", "en", FROZEN_NOW)
    assert text == '<b>Tooling</b> · 8/10 · hn\n<a href="https://example.com/a">Tools &amp; &lt;tricks&gt;</a>\nSummary.'
    assert markup == {
        "inline_keyboard": [
            [
                {"text": "✅ Approve", "callback_data": f"a:{url_hash(A)}"},
                {"text": "❌ Reject", "callback_data": f"r:{url_hash(A)}"},
            ]
        ]
    }


def test_render_status_lines_and_buttons():
    text, markup = render(item(A), "approved", "en", FROZEN_NOW)
    assert text.endswith("\n\n✅ Approved — goes out with the next digest")
    assert markup == {"inline_keyboard": [[{"text": "↩ Undo", "callback_data": f"u:{url_hash(A)}"}]]}
    text, markup = render(item(A), "sent", "ru", FROZEN_NOW)
    assert text.endswith("\n\n📤 Отправлено 06.10") and markup == {"inline_keyboard": []}
    assert render(item(A), "rejected", "en", FROZEN_NOW)[0].endswith("\n\n❌ Rejected")
    assert render(item(A), "expired", "ru", FROZEN_NOW)[0].endswith("\n\n⌛ Истекло")


def test_render_links_only_http_urls():
    text, _ = render(item("javascript:alert(1)", title="T"), "waiting", "en", FROZEN_NOW)
    assert "<a " not in text and "\nT\n" in text


# --- ask -----------------------------------------------------------------------


def test_ask_sends_the_newest_first_up_to_the_cap(tmp_path, bot):
    review = new_review(tmp_path)
    items = [item(A, hours_ago=3), item(B, hours_ago=1), item(C, hours_ago=2)]
    review.collect(items, FROZEN_NOW)
    tally = new_tally()
    assert review.ask(items, {}, FROZEN_NOW, tally) == 2
    sent = bot.sent("sendMessage")
    assert [m["chat_id"] for m in sent] == [OWNER, OWNER]
    assert [m["reply_markup"]["inline_keyboard"][0][0]["callback_data"] for m in sent] == [f"a:{url_hash(B)}", f"a:{url_hash(C)}"]
    assert all(m["parse_mode"] == "HTML" and m["disable_web_page_preview"] is True for m in sent)
    assert review.ask(items, {}, FROZEN_NOW, tally) == 1  # A, next time round
    review.save()
    assert load_store(tmp_path / "telegram.json").messages == {
        B: AskMessage(1, "waiting"),
        C: AskMessage(2, "waiting"),
        A: AskMessage(3, "waiting"),
    }
    review_stage = next(s for s in tally.stages() if s["stage"] == "review")
    assert review_stage["scopes"]["tooling"]["notes"]["asked"] == 3


def test_a_failed_ask_is_retried_and_a_site_approval_is_shown(tmp_path, bot):
    bot.fail["sendMessage"] = [FakeResponse(500, {"ok": False})]
    review = new_review(tmp_path)
    items = [item(A, hours_ago=1), item(B, hours_ago=2)]
    review.collect(items, FROZEN_NOW)
    tally = new_tally()
    assert review.ask(items, {A: "approve"}, FROZEN_NOW, tally) == 1  # A failed, B asked
    assert tally.failures == [{"stage": "review", "scope": "*", "source": "telegram", "error_type": "BotApiError"}]
    assert review.ask(items, {A: "approve"}, FROZEN_NOW, tally) == 1
    last = bot.sent("sendMessage")[-1]
    assert last["reply_markup"] == {"inline_keyboard": [[{"text": "↩ Undo", "callback_data": f"u:{url_hash(A)}"}]]}


# --- update --------------------------------------------------------------------


def _seed(tmp_path, messages: dict, decisions: dict | None = None) -> None:
    save_store(tmp_path / "telegram.json", TelegramStore(0, decisions or {}, messages))


def test_update_edits_changed_statuses_and_finishes_items_that_left(tmp_path, bot):
    _seed(
        tmp_path,
        {A: AskMessage(1, "waiting"), B: AskMessage(2, "waiting"), C: AskMessage(3, "approved"), D: AskMessage(4, "gone")},
        {B: DecisionEntry("reject", NOW)},
    )
    review = new_review(tmp_path)
    before = {i.url: i for i in [item(A), item(B), item(C), item(D)]}
    queued = [item(A), item(C)]
    review.collect(list(before.values()), FROZEN_NOW)
    review.update(before, queued, {A: "approve", C: "approve"}, sent=set(), rejected={B}, now=FROZEN_NOW, tally=new_tally())
    edits = bot.sent("editMessageText")
    assert [(e["message_id"], e["text"].rsplit("\n", 1)[-1]) for e in edits] == [
        (1, "✅ Approved — goes out with the next digest"),
        (2, "❌ Rejected"),
    ]
    assert edits[1]["reply_markup"] == {"inline_keyboard": []}
    review.save()
    store = load_store(tmp_path / "telegram.json")
    assert store.messages == {A: AskMessage(1, "approved"), C: AskMessage(3, "approved")}
    assert store.decisions == {}  # B left the queue


def test_update_marks_sent_and_expired(tmp_path, bot):
    _seed(tmp_path, {A: AskMessage(1, "approved"), B: AskMessage(2, "waiting")})
    review = new_review(tmp_path)
    before = {i.url: i for i in [item(A), item(B)]}
    review.collect(list(before.values()), FROZEN_NOW)
    review.update(before, [], {A: "approve"}, sent={A}, rejected=set(), now=FROZEN_NOW, tally=new_tally())
    assert [e["text"].rsplit("\n", 1)[-1] for e in bot.sent("editMessageText")] == ["📤 Sent 06.10", "⌛ Expired"]


def test_not_modified_counts_as_done_a_gone_message_is_tombstoned_and_other_errors_retry(tmp_path, bot):
    _seed(tmp_path, {A: AskMessage(1, "waiting"), B: AskMessage(2, "waiting"), C: AskMessage(3, "waiting")})
    bot.fail["editMessageText"] = [
        FakeResponse(400, {"ok": False, "description": "Bad Request: message is not modified: specified new message content"}),
        FakeResponse(400, {"ok": False, "description": "Bad Request: message to edit not found"}),
        FakeResponse(500, {"ok": False, "description": "Internal Server Error"}),
    ]
    review = new_review(tmp_path)
    items = [item(A), item(B), item(C)]
    review.collect(items, FROZEN_NOW)
    tally = new_tally()
    review.update({i.url: i for i in items}, items, {A: "approve", B: "approve", C: "approve"}, set(), set(), FROZEN_NOW, tally)
    review.save()
    store = load_store(tmp_path / "telegram.json")
    assert store.messages == {A: AskMessage(1, "approved"), B: AskMessage(2, "gone"), C: AskMessage(3, "waiting")}
    assert [f["source"] for f in tally.failures] == ["telegram"]
    assert review.ask(items, {}, FROZEN_NOW, tally) == 0  # a gone message isn't asked again


def test_a_failed_final_edit_still_drops_the_entry(tmp_path, bot):
    _seed(tmp_path, {A: AskMessage(1, "approved")})
    bot.fail["editMessageText"] = [FakeResponse(500, {"ok": False})]
    review = new_review(tmp_path)
    review.collect([item(A)], FROZEN_NOW)
    review.update({A: item(A)}, [], {}, sent={A}, rejected=set(), now=FROZEN_NOW, tally=new_tally())
    review.save()
    assert load_store(tmp_path / "telegram.json").messages == {}
```

- [ ] **Step 3: Run them to see them fail**

Run: `agent/venv/Scripts/python -m pytest agent/tests/test_telegram_review.py -q`
Expected: FAIL — `ImportError: cannot import name 'telegram_review'`.

- [ ] **Step 4: Write `agent/telegram_review.py`**

```python
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
```

- [ ] **Step 5: Run the tests**

Run: `agent/venv/Scripts/python -m pytest agent/tests/test_telegram_review.py -q`
Expected: PASS. Then the whole suite: `agent/venv/Scripts/python -m pytest agent/tests -q` — all pass, no golden changes.

- [ ] **Step 6: Commit**

```bash
git add agent/telegram_review.py agent/tests/test_telegram_review.py agent/tests/conftest.py
git commit -m "Ask about queue items in Telegram and read the owner's taps"
```

---

### Task 5: Wire it into the run; Tony gets the block

**Files:**
- Modify: `agent/context.py`, `agent/engine.py`, `agent/presets/tony.yaml`, `agent/tests/conftest.py` (Tony harness), `agent/tests/test_tony_characterization.py`, `.github/workflows/agent-run.yml`, `.gitignore`
- Create: `agent/tests/test_telegram_engine.py`
- Re-record: `agent/tests/fixtures/tony/golden/real/{stdout.txt,telegram.json,run-result.json}`, `agent/tests/fixtures/tony/golden/dry/run-result.json`; new `agent/tests/fixtures/tony/golden/real/telegram-store.json`

**Interfaces:**
- Consumes: everything above. `engine.live_adapters` sets `Adapters.review = telegram_review.review_for(preset, paths)`; `offline_adapters` leaves it `None`.
- Produces: `Adapters.review: Any = None`. stdout line after delivery, only with a review: `Telegram: {taps} tap(s) picked up, {asked} item(s) asked.`

- [ ] **Step 1: Write the failing engine test**

`agent/tests/test_telegram_engine.py`:

```python
import json
from datetime import timedelta

import pytest
import requests

from agent import dedupe, engine, pending, summarize, telegram_review
from agent.dedupe import StateEntry, url_hash
from agent.paths import DataPaths
from agent.pending import PendingItem, PendingQueue
from agent.preset import load_preset
from agent.tests.conftest import FROZEN_NOW, OWNER, FakeBot, FakeDeepSeek, FakeResponse, tap

A, B = "https://example.com/a", "https://example.com/b"

PRESET = """\
preset: {slug: t, name: T, language: en}
defaults: {max_age_days: 2, min_relevance: 6, max_items_per_day: 3}
topics:
  - {slug: tooling, name: Tooling, description: Tools., include: [tools], exclude: []}
ranking: {reader: A builder.}
llm: {base_url: "https://api.deepseek.com", model: deepseek-v4-flash, api_key_env: DEEPSEEK_API_KEY}
approval:
  type: file
  path: decisions.json
  expire_days: 7
  telegram: {bot_token_env: T_TOKEN, owner_chat_env: T_OWNER, max_asks_per_run: 10}
delivery: {type: file, title: Digest, cadence_hours: 24}
"""


@pytest.fixture
def setup(tmp_path, monkeypatch):
    (tmp_path / "decisions.json").write_text('{"version": 1, "decisions": {}}', encoding="utf-8")
    (tmp_path / "preset.yaml").write_text(PRESET, encoding="utf-8")
    preset = load_preset(tmp_path / "preset.yaml")
    paths = DataPaths(tmp_path / "data")
    paths.root.mkdir()
    since = (FROZEN_NOW - timedelta(hours=1)).isoformat()
    queue = PendingQueue(None, [PendingItem(u, u[-1].upper(), "hn", "tooling", "Tooling", "S.", 8, since) for u in (A, B)])
    pending.save_pending(paths.pending, queue)
    dedupe.save_state(paths.state, {url_hash(u): StateEntry(since, 10, 0) for u in (A, B)})
    bot = FakeBot()
    llm = FakeDeepSeek({})
    monkeypatch.setattr(requests, "post", bot.post)
    monkeypatch.setattr(telegram_review.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(summarize, "OpenAI", llm)
    monkeypatch.setenv("T_TOKEN", "123:secret")
    monkeypatch.setenv("T_OWNER", str(OWNER))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    yield preset, paths, bot
    assert llm.calls == []


def _run(preset, paths, now):
    engine.run_real(preset, paths, now, engine.live_adapters(preset, paths))


def _store(paths):
    return json.loads(paths.telegram.read_text(encoding="utf-8"))


def test_ask_then_apply_taps_deliver_and_finish_the_messages(setup, capsys):
    preset, paths, bot = setup
    _run(preset, paths, FROZEN_NOW)
    assert [m["text"].split("\n")[1] for m in bot.sent("sendMessage")] == [
        '<a href="https://example.com/b">B</a>',
        '<a href="https://example.com/a">A</a>',
    ]
    assert _store(paths)["messages"] == {A: {"message_id": 2, "shown": "waiting"}, B: {"message_id": 1, "shown": "waiting"}}
    assert "Telegram: 0 tap(s) picked up, 2 item(s) asked." in capsys.readouterr().out

    bot.updates = [
        tap(10, f"a:{url_hash(A)}", message_id=2),
        tap(11, f"r:{url_hash(B)}", message_id=1),
        tap(12, f"a:{url_hash(B)}", user=999),
    ]
    later = FROZEN_NOW + timedelta(hours=1)
    _run(preset, paths, later)
    out = capsys.readouterr().out
    assert "Sent 1 approved items across 1 topics." in out
    assert "Telegram: 2 tap(s) picked up, 0 item(s) asked." in out
    assert (paths.outbox / f"{engine.events.new_run_id(later)}.html").read_text(encoding="utf-8").count("example.com/a") == 1
    edits = {e["message_id"]: e["text"].rsplit("\n", 1)[-1] for e in bot.sent("editMessageText")}
    assert edits == {2: "📤 Sent 06.10", 1: "❌ Rejected"}
    assert _store(paths) == {"version": 1, "offset": 13, "decisions": {}, "messages": {}}
    state = dedupe.load_state(paths.state)
    assert (state[url_hash(A)].times_sent, state[url_hash(B)].dismissed) == (1, "rejected")
    review = next(s for s in json.loads(paths.result.read_text(encoding="utf-8"))["stages"] if s["stage"] == "review")
    assert review["scopes"]["tooling"]["notes"]["telegram_taps"] == 2


def test_a_failed_poll_drops_and_delivers_nothing_and_writes_no_store(setup, capsys):
    preset, paths, bot = setup
    (preset.approval.path).write_text(
        json.dumps({"version": 1, "decisions": {A: {"decision": "approve", "at": "2026-10-06T11:00:00Z"}}}), encoding="utf-8"
    )
    bot.fail["getUpdates"] = [FakeResponse(409, {"ok": False, "description": "Conflict: can't use getUpdates while webhook is active"})]
    _run(preset, paths, FROZEN_NOW)
    out = capsys.readouterr().out
    assert "Inbox decisions unavailable; nothing is dropped or delivered this run" in out
    assert "123:secret" not in out
    assert bot.sent("sendMessage") == [] and not paths.telegram.exists()
    assert not paths.outbox.exists()
    result = json.loads(paths.result.read_text(encoding="utf-8"))
    assert result["failures"] == [{"stage": "review", "scope": "*", "source": "telegram", "error_type": "DecisionsUnavailable"}]


def test_a_failed_site_still_collects_taps_and_asks(setup, capsys):
    preset, paths, bot = setup
    preset.approval.path.write_text("not json", encoding="utf-8")
    bot.updates = [tap(3, f"a:{url_hash(A)}")]
    _run(preset, paths, FROZEN_NOW)
    assert "nothing is dropped or delivered" in capsys.readouterr().out
    assert len(bot.sent("sendMessage")) == 2 and bot.sent("editMessageText") == []
    store = _store(paths)
    assert store["offset"] == 4 and store["decisions"][A]["decision"] == "approve"
    assert not paths.outbox.exists()


def test_preview_and_dry_run_never_touch_telegram(setup, capsys):
    preset, paths, bot = setup
    adapters = engine.live_adapters(preset, paths)
    engine.run_preview(preset, paths, FROZEN_NOW, adapters)
    engine.run_dry(preset, paths, FROZEN_NOW, adapters)
    assert bot.calls == [] and not paths.telegram.exists()
```

- [ ] **Step 2: Run it to see it fail**

Run: `agent/venv/Scripts/python -m pytest agent/tests/test_telegram_engine.py -q`
Expected: FAIL — no asks are sent (`engine` doesn't know about Telegram yet).

- [ ] **Step 3: `Adapters.review` and `live_adapters`**

`agent/context.py` — `Adapters` gains, after `fetcher`:

```python
    review: Any = None  # telegram_review.TelegramReview for presets with approval.telegram, else None
```

`agent/engine.py` — import `approval` and `telegram_review` (`from agent import approval, dedupe, ..., telegram_review` — keep the list alphabetical; `from agent.approval import approval_for` stays), and in `live_adapters` add `review=telegram_review.review_for(preset, paths),`. `offline_adapters` is unchanged (review stays `None`).

- [ ] **Step 4: The review block of `run_real`**

Replace everything from `queued_before_review = ...` through `_tally_review(...)` (engine.py lines 85-101) with:

```python
    queued_before_review = Counter(item.topic for item in queue.items)
    before_review = {item.url: item for item in queue.items}
    review = adapters.review
    decisions: dict[str, str] | None = None
    approved: list[pending.PendingItem] = []
    inbox_drops: list = []
    site = _load_site_decisions(adapters, writer, tally)
    telegram_decisions, taps = (None, 0) if review is None else _collect_taps(review, queue.items, now, writer, tally)
    if site is not None and (review is None or telegram_decisions is not None):
        decisions = approval.merge_decisions(site, telegram_decisions or {})
        approved, inbox_drops = inbox.apply_decisions(queue, decisions, state, now, preset.approval.expire_days)
        for topic_slug, drop in inbox_drops:
            writer.emit_drop("inbox", topic_slug, drop)
        if ctx.stories is not None:
            stories.apply_review(ctx.stories, state, approved, inbox_drops, queue.items)
    _tally_review(tally, queued_before_review, queue, inbox_drops, approved)
```

and add these helpers next to `_tally_review`:

```python
def _load_site_decisions(adapters: Adapters, writer, tally: Tally) -> dict[str, inbox.DecisionEntry] | None:
    try:
        return adapters.approval.load_entries()
    except inbox.DecisionsUnavailable as exc:
        _decisions_unavailable(writer, tally, None, exc)
        return None


def _collect_taps(review, items, now: datetime, writer, tally: Tally) -> tuple[dict[str, inbox.DecisionEntry] | None, int]:
    try:
        decisions, tapped = review.collect(items, now)
    except inbox.DecisionsUnavailable as exc:
        _decisions_unavailable(writer, tally, "telegram", exc)
        return None, 0
    for item in tapped:
        tally.note("review", item.topic, "telegram_taps")
    return decisions, len(tapped)


def _decisions_unavailable(writer, tally: Tally, source: str | None, exc: Exception) -> None:
    writer.emit("inbox", "failed", detail={"error": str(exc)})
    tally.fail("review", FEED_SCOPE, source, exc)
    print(f"Inbox decisions unavailable; nothing is dropped or delivered this run: {exc}")
```

(`Adapters` and `Tally` are already importable: `from agent.context import Adapters, RunContext` and `from agent.run_result import FEED_SCOPE, Tally, ...`.)

- [ ] **Step 5: Asks and updates after delivery**

In `run_real`, add `sent_urls: set[str] = set()` next to `delivered = False`, and in the delivery `else:` branch replace `sent_urls = {item.url for item in approved}` with `sent_urls.update(item.url for item in approved)`. Then, right after the `if due: ... else: print("Nothing delivered ...")` block and before the `for slug, count in Counter(...)` queue tally, add:

```python
    if review is not None and telegram_decisions is not None:
        if decisions is not None:
            rejected_urls = {drop.url for _, drop in inbox_drops if drop.reason == "rejected"}
            review.update(before_review, queue.items, decisions, sent_urls, rejected_urls, now, tally)
        asked = review.ask(queue.items, decisions, now, tally)
        review.save()
        print(f"Telegram: {taps} tap(s) picked up, {asked} item(s) asked.")
```

- [ ] **Step 6: Run the engine test**

Run: `agent/venv/Scripts/python -m pytest agent/tests/test_telegram_engine.py -q`
Expected: PASS.

- [ ] **Step 7: Tony's preset and harness**

`agent/presets/tony.yaml` — under `approval:`, after `expire_days`:

```yaml
  # The bot also asks Artem in his private chat (docs/superpowers/specs/2026-10-08-telegram-approval-design.md);
  # his taps are read at the start of each run and merged with the inbox, latest action wins.
  telegram:
    bot_token_env: TELEGRAM_BOT_TOKEN
    owner_chat_env: TELEGRAM_OWNER_CHAT_ID # repo secret: Artem's private chat with the bot
    max_asks_per_run: 10
```

`agent/tests/conftest.py`, Tony harness: `FakeHttp.__init__` creates `self.bot = FakeBot()`; `FakeHttp.post` becomes `return self.bot.post(url, json=json, timeout=timeout, **kwargs)`; `posts` becomes a property returning `self.bot.sent("sendMessage")` (so the `telegram.json` golden still lists every sendMessage payload — the digest, then the asks). Update `FakeHttp`'s docstring ("records Telegram posts" → "serves the Bot API through FakeBot"). `TonyHarness.__init__` adds `monkeypatch.setenv("TELEGRAM_OWNER_CHAT_ID", str(OWNER))` and `monkeypatch.setattr(telegram_review.time, "sleep", lambda seconds: None)` (import `telegram_review` with `deliver, events, summarize`). `FakeBot` and `OWNER` must be defined above `FakeHttp` in the file.

`agent/tests/test_tony_characterization.py`:
- `test_real_run` adds `GOLDEN / "real" / "telegram-store.json": tony.read("telegram.json"),` to its goldens.
- `test_preview_writes_nothing`: `assert tony.http.posts == []` → `assert tony.http.bot.calls == []`.
- `test_dry_run`: add `assert tony.http.bot.calls == []`.
- The module docstring gains: "Re-recorded once more in sub-project C for Tony's approval.telegram block (asks after the digest, the review line on stdout, config.approval.telegram)."

- [ ] **Step 8: Re-record Tony's goldens and check the diff**

```bash
rm agent/tests/fixtures/tony/golden/real/stdout.txt agent/tests/fixtures/tony/golden/real/telegram.json agent/tests/fixtures/tony/golden/real/run-result.json agent/tests/fixtures/tony/golden/dry/run-result.json
agent/venv/Scripts/python -m pytest agent/tests/test_tony_characterization.py -q
agent/venv/Scripts/python -m pytest agent/tests/test_tony_characterization.py -q
git diff --stat agent/tests/fixtures
git diff agent/tests/fixtures/tony/golden
```

Expected: the first pytest run fails with "recorded new goldens"; the second passes. The diff touches only `real/stdout.txt` (one new line `Telegram: 0 tap(s) picked up, N item(s) asked.`), `real/telegram.json` (the digest payload unchanged, then the ask payloads to chat `1001`), `real/run-result.json` and `dry/run-result.json` (`config.approval.telegram` and `asked` notes on the review stage in the real one), plus the new `real/telegram-store.json` (no chat id: `grep -c 1001 agent/tests/fixtures/tony/golden/real/telegram-store.json` prints `0`). `real/state.json`, `real/pending.json`, `real/status.json`, `real/events.jsonl`, `real/prompts.txt`, every `preview/` and `dry/` file other than `dry/run-result.json`, and every demo golden are unchanged — anything else changing is a regression: stop and investigate.

- [ ] **Step 9: Workflow and `.gitignore`**

`.github/workflows/agent-run.yml`:
- "Move prior state into the code checkout": add `[ -f data/agent/telegram.json ] && cp data/agent/telegram.json code/agent/telegram.json || true`.
- "Run the agent" `env:` add `TELEGRAM_OWNER_CHAT_ID: ${{ secrets.TELEGRAM_OWNER_CHAT_ID }}`.
- "Copy updated state back": add `[ -f code/agent/telegram.json ] && cp code/agent/telegram.json data/agent/telegram.json || true`.
- "Commit and push": add `[ -f agent/telegram.json ] && git add agent/telegram.json || true` after the run-result line.

`.gitignore`: add `agent/telegram.json` after `agent/run-result.json`.

- [ ] **Step 10: Run everything**

Run: `agent/venv/Scripts/python -m pytest agent/tests -q` — all pass.
Run: `npm test` — all pass (the site ignores the new run-result keys until Task 7).

- [ ] **Step 11: Commit**

```bash
git add agent/context.py agent/engine.py agent/presets/tony.yaml agent/tests/conftest.py agent/tests/test_tony_characterization.py agent/tests/test_telegram_engine.py agent/tests/fixtures/tony/golden .github/workflows/agent-run.yml .gitignore
git commit -m "Collect Telegram taps before review and ask after delivery; Tony gets the block"
```

---

### Task 6: Site — Telegram decisions and the merge mirror

**Files:**
- Create: `lib/telegram-decisions.ts`, `lib/telegram-decisions.test.ts`
- Modify: `lib/queue-view.ts`, `lib/queue-view.test.ts`

**Interfaces:**
- Consumes: `Decision`, `DecisionEntry`, `Decisions`, `ItemStatus` from `lib/inbox.ts`; `agent/tests/fixtures/approval-merge.json` (Task 2).
- Produces: `TELEGRAM_URL`; `type TelegramDecision = Decision | "clear"`; `interface TelegramDecisions { decisions: Record<string, { decision: TelegramDecision; at: string }> }`; `parseTelegramDecisions(value: unknown): TelegramDecisions | null`; `interface MergedDecisions { decisions: Decisions; viaTelegram: ReadonlySet<string> }`; `mergeDecisions(site: Decisions, telegram: TelegramDecisions | null): MergedDecisions`; in `lib/queue-view.ts`: `type QueueAction = Decision | "undo"`, `allowedActions(status: ItemStatus, fromTelegram: boolean): QueueAction[]`.

- [ ] **Step 1: Write the failing tests**

`lib/telegram-decisions.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_DECISIONS } from "./inbox";
import { statusCounts } from "./queue-view";
import { mergeDecisions, parseTelegramDecisions } from "./telegram-decisions";

interface MergeCase {
  name: string;
  site: Record<string, { decision: "approve" | "reject"; at: string }>;
  telegram: Record<string, { decision: "approve" | "reject" | "clear"; at: string }>;
  expected: Record<string, string>;
  via_telegram: string[];
}

const CASES: MergeCase[] = JSON.parse(
  readFileSync(join(process.cwd(), "agent", "tests", "fixtures", "approval-merge.json"), "utf8"),
).cases;

describe("mergeDecisions on the shared cases (agent/approval.py's merge_decisions runs them too)", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const merged = mergeDecisions({ version: 1, decisions: c.site }, { decisions: c.telegram });
      const decided = Object.fromEntries(Object.entries(merged.decisions.decisions).map(([url, e]) => [url, e.decision]));
      expect(decided).toEqual(c.expected);
      expect([...merged.viaTelegram].sort()).toEqual([...c.via_telegram].sort());
    });
  }
});

describe("mergeDecisions", () => {
  it("leaves the site's decisions alone without a Telegram file", () => {
    const site = { version: 1 as const, decisions: { "https://a": { decision: "approve" as const, at: "2026-10-09T08:00:00.000Z" } } };
    expect(mergeDecisions(site, null)).toEqual({ decisions: site, viaTelegram: new Set() });
  });

  it("feeds the queue's status counts", () => {
    const merged = mergeDecisions(EMPTY_DECISIONS, { decisions: { "https://a": { decision: "approve", at: "2026-10-09T12:00:00+00:00" } } });
    const item = { url: "https://a", title: "A", source: "hn", topic: "t", topic_name: "T", summary: "", score: 8, pending_since: "2026-10-09T00:00:00+00:00" };
    expect(statusCounts([item], merged.decisions, "all")).toEqual({ waiting: 0, approved: 1, rejected: 0, all: 1 });
  });
});

describe("parseTelegramDecisions", () => {
  const valid = { version: 1, offset: 4, decisions: { "https://a": { decision: "clear", at: "x" } }, messages: {} };

  it("reads the decisions of a valid file", () => {
    expect(parseTelegramDecisions(valid)).toEqual({ decisions: valid.decisions });
  });

  it.each([
    ["not an object", null],
    ["another version", { ...valid, version: 2 }],
    ["decisions not an object", { ...valid, decisions: [] }],
    ["an unknown decision", { ...valid, decisions: { "https://a": { decision: "maybe", at: "x" } } }],
    ["a missing time", { ...valid, decisions: { "https://a": { decision: "approve" } } }],
  ])("rejects %s", (_name, value) => {
    expect(parseTelegramDecisions(value)).toBeNull();
  });
});
```

Append to `lib/queue-view.test.ts` (add `allowedActions` to its import from `./queue-view`):

```ts
describe("allowedActions", () => {
  it("decides a waiting row", () => {
    expect(allowedActions("waiting", false)).toEqual(["approve", "reject"]);
  });
  it("undoes the site's own decision", () => {
    expect(allowedActions("approved", false)).toEqual(["undo"]);
    expect(allowedActions("rejected", false)).toEqual(["undo"]);
  });
  it("can only flip a Telegram decision", () => {
    expect(allowedActions("approved", true)).toEqual(["reject"]);
    expect(allowedActions("rejected", true)).toEqual(["approve"]);
  });
});
```

(If `lib/queue-view.test.ts` doesn't import `describe`/`it`/`expect` already, it does — it's a Vitest file; keep its existing import line and add `allowedActions` to the `./queue-view` import.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/telegram-decisions.test.ts lib/queue-view.test.ts`
Expected: FAIL — cannot resolve `./telegram-decisions`; `allowedActions` is not exported.

- [ ] **Step 3: Implement**

`lib/telegram-decisions.ts`:

```ts
import type { Decision, DecisionEntry, Decisions } from "./inbox";

/**
 * The agent's record of Telegram approvals: agent/telegram.json on the
 * agent-data branch (docs/superpowers/specs/2026-10-08-telegram-approval-design.md).
 * The site reads only its decisions. mergeDecisions mirrors
 * agent/approval.py's merge_decisions; both run the shared cases in
 * agent/tests/fixtures/approval-merge.json, so change them together.
 */
export const TELEGRAM_URL =
  "https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/telegram.json";

export type TelegramDecision = Decision | "clear";

export interface TelegramDecisions {
  decisions: Record<string, { decision: TelegramDecision; at: string }>;
}

export interface MergedDecisions {
  decisions: Decisions;
  /** URLs whose decision came from Telegram. */
  viaTelegram: ReadonlySet<string>;
}

function isEntry(value: unknown): value is { decision: TelegramDecision; at: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  return (e.decision === "approve" || e.decision === "reject" || e.decision === "clear") && typeof e.at === "string";
}

/** telegram.json's decisions; null when the file is malformed (one bad entry fails it, as in the agent). */
export function parseTelegramDecisions(value: unknown): TelegramDecisions | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return null;
  const decisions = raw.decisions;
  if (typeof decisions !== "object" || decisions === null || Array.isArray(decisions)) return null;
  if (!Object.values(decisions).every(isEntry)) return null;
  return { decisions: decisions as TelegramDecisions["decisions"] };
}

/** An unparseable time counts as the oldest. */
function when(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -Infinity : t;
}

/** Per URL, the later of the site's entry and Telegram's wins (a tie goes to the site); Telegram's "clear" (Undo) leaves the item undecided. */
export function mergeDecisions(site: Decisions, telegram: TelegramDecisions | null): MergedDecisions {
  const merged: Record<string, DecisionEntry> = {};
  const viaTelegram = new Set<string>();
  const fromTelegram = telegram?.decisions ?? {};
  for (const url of new Set([...Object.keys(site.decisions), ...Object.keys(fromTelegram)])) {
    const ours = site.decisions[url];
    const theirs = fromTelegram[url];
    if (theirs === undefined || (ours !== undefined && when(ours.at) >= when(theirs.at))) {
      merged[url] = ours;
      continue;
    }
    if (theirs.decision === "clear") continue;
    merged[url] = { decision: theirs.decision, at: theirs.at };
    viaTelegram.add(url);
  }
  return { decisions: { version: 1, decisions: merged }, viaTelegram };
}
```

`lib/queue-view.ts` — change the first import to `import { type Decision, type Decisions, type ItemStatus, itemStatus } from "./inbox";` and append:

```ts
export type QueueAction = Decision | "undo";

/**
 * What the owner can do to a row: decide a waiting one; undo the site's
 * own decision; flip a Telegram decision with a newer site one (the site
 * can't undo it — that's Undo in Telegram).
 */
export function allowedActions(status: ItemStatus, fromTelegram: boolean): QueueAction[] {
  if (status === "waiting") return ["approve", "reject"];
  if (!fromTelegram) return ["undo"];
  return [status === "approved" ? "reject" : "approve"];
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/telegram-decisions.ts lib/telegram-decisions.test.ts lib/queue-view.ts lib/queue-view.test.ts
git commit -m "Mirror the decision merge on the site, pinned to the shared cases"
```

---

### Task 7: Site — control room shows Telegram decisions and the config

**Files:**
- Modify: `lib/run-result.ts`, `lib/run-result.test.ts`, `lib/config-view.ts`, `lib/config-view.test.ts`, `lib/control-room-text.ts`, `components/ConfigSpine.tsx`, `components/ControlRoom.tsx`, `components/QueuePane.tsx`

**Interfaces:**
- Consumes: `TELEGRAM_URL`, `parseTelegramDecisions`, `mergeDecisions` (Task 6); `allowedActions`, `QueueAction` (Task 6); Tony's re-recorded `run-result.json` golden (Task 5).
- Produces: `ApprovalResult` members gain `telegram: TelegramApproval | null` (`TelegramApproval = { bot_token_env: string; owner_chat_env: string; max_asks_per_run: number }`); `ConfigView.approval` members gain `telegramAsks: number | null`; text keys `queue.viaTelegram` and `spine.reviewTelegram(asks: number): Part[]` in `en` and `ru`; `QueuePane` optional prop `viaTelegram?: ReadonlySet<string>`.

- [ ] **Step 1: Write the failing tests**

`lib/run-result.test.ts` — in "reads Tony's real run", the approval expectation becomes:

```ts
    expect(result?.config.approval).toEqual({
      type: "inbox",
      decisions_url: "https://api.github.com/repos/hpnssflw/tony-inbox/contents/decisions.json",
      expire_days: 7,
      telegram: { bot_token_env: "TELEGRAM_BOT_TOKEN", owner_chat_env: "TELEGRAM_OWNER_CHAT_ID", max_asks_per_run: 10 },
    });
```

In "reads both demo presets' runs", after `expect(result?.config.approval.type).toBe("file");` add `expect(result?.config.approval.telegram).toBeNull();`. And a new case in the same `describe`:

```ts
  it("reads a missing or malformed approval.telegram as none", () => {
    const missing = tony();
    delete missing.config.approval.telegram;
    expect(parseRunResult(missing)?.config.approval.telegram).toBeNull();
    const malformed = tony();
    malformed.config.approval.telegram = { bot_token_env: 1 };
    expect(parseRunResult(malformed)?.config.approval.telegram).toBeNull();
  });
```

`lib/config-view.test.ts` — Tony's expectation becomes `expect(view.approval).toEqual({ kind: "inbox", repo: "hpnssflw/tony-inbox", expireDays: 7, telegramAsks: 10 });` and the newsroom one `expect(view.approval).toEqual({ kind: "file", expireDays: 3, telegramAsks: null });`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/run-result.test.ts lib/config-view.test.ts`
Expected: FAIL — `telegram` / `telegramAsks` missing from the parsed objects.

- [ ] **Step 3: Parse and view the block**

`lib/run-result.ts`:

```ts
export interface TelegramApproval {
  bot_token_env: string;
  owner_chat_env: string;
  max_asks_per_run: number;
}

export type ApprovalResult =
  | { type: "inbox"; decisions_url: string; expire_days: number; telegram: TelegramApproval | null }
  | { type: "file"; path: string; expire_days: number; telegram: TelegramApproval | null };
```

and replace `approval()`:

```ts
function telegramApproval(value: unknown): TelegramApproval | null {
  if (value === undefined || value === null) return null;
  const t = rec(value);
  return { bot_token_env: str(t.bot_token_env), owner_chat_env: str(t.owner_chat_env), max_asks_per_run: num(t.max_asks_per_run) };
}

function approval(value: unknown): ApprovalResult {
  const a = rec(value);
  const telegram = optional(() => telegramApproval(a.telegram), null);
  if (a.type === "inbox") return { type: "inbox", decisions_url: str(a.decisions_url), expire_days: num(a.expire_days), telegram };
  if (a.type === "file") return { type: "file", path: str(a.path), expire_days: num(a.expire_days), telegram };
  throw new Malformed();
}
```

`lib/config-view.ts` — `ConfigView.approval` becomes

```ts
  approval:
    | { kind: "inbox"; repo: string; expireDays: number; telegramAsks: number | null }
    | { kind: "file"; expireDays: number; telegramAsks: number | null };
```

and in `configView`:

```ts
    approval:
      approval.type === "inbox"
        ? {
            kind: "inbox",
            repo: INBOX_REPO_RE.exec(approval.decisions_url)?.[1] ?? approval.decisions_url,
            expireDays: approval.expire_days,
            telegramAsks: approval.telegram?.max_asks_per_run ?? null,
          }
        : { kind: "file", expireDays: approval.expire_days, telegramAsks: approval.telegram?.max_asks_per_run ?? null },
```

- [ ] **Step 4: Text, spine, queue**

`lib/control-room-text.ts`:
- `en.queue`: after `undo: "undo",` add `viaTelegram: "telegram",`; `ru.queue`: after its `undo` add `viaTelegram: "в telegram",`.
- `en.spine`: after `reviewFile` add
  ```ts
    reviewTelegram: (asks: number): Part[] => [" · and telegram buttons, up to ", { v: asks }, " new a run"],
  ```
  `ru.spine`: after its `reviewFile` add
  ```ts
    reviewTelegram: (asks: number): Part[] => [" · и кнопки в telegram, до ", { v: asks }, " новых за прогон"],
  ```

`components/ConfigSpine.tsx` — the review row's `parts` become:

```tsx
          parts={[
            ...(config.approval.kind === "inbox"
              ? text.reviewInbox(config.approval.repo, config.approval.expireDays)
              : text.reviewFile(config.approval.expireDays)),
            ...(config.approval.telegramAsks !== null ? text.reviewTelegram(config.approval.telegramAsks) : []),
          ]}
```

`components/QueuePane.tsx`:
- Imports: `import { type Decision, type Decisions, itemStatus } from "@/lib/inbox";` stays; the `@/lib/queue-view` import adds `type QueueAction, allowedActions`.
- Module constants above the component:
  ```tsx
  const NO_URLS: ReadonlySet<string> = new Set();
  const ACTION_KEYS: Record<QueueAction, string> = { approve: "a", reject: "r", undo: "u" };
  const ACTION_CLASS: Record<QueueAction, string> = {
    approve: "inbox-button cr-approve",
    reject: "inbox-button cr-reject",
    undo: "inbox-button",
  };
  ```
- New prop (destructured `viaTelegram = NO_URLS`, typed `/** URLs whose decision came from Telegram: labelled, and the owner can only flip them. */ viaTelegram?: ReadonlySet<string>;`).
- The keyboard branch for `a`/`r`/`u` becomes:
  ```tsx
      } else if ((key === "a" || key === "r" || key === "u") && canDecide && !busy && selected) {
        const action: QueueAction = key === "a" ? "approve" : key === "r" ? "reject" : "undo";
        const status = itemStatus(decisions, selected.url);
        if (allowedActions(status, viaTelegram.has(selected.url)).includes(action)) {
          onDecide(selected, action === "undo" ? null : action);
        }
      } else {
  ```
  and `viaTelegram` joins the effect's dependency list.
- The row's decision label becomes:
  ```tsx
                    {decisions && status !== "waiting" && (
                      <span className={`cr-decision inbox-${status}`}>
                        {text.statuses[status]}
                        {viaTelegram.has(item.url) && ` · ${text.viaTelegram}`}
                      </span>
                    )}
  ```
- The `{canDecide && (status === "waiting" ? (<>…</>) : (<button …undo…/>))}` block becomes:
  ```tsx
                        {canDecide &&
                          allowedActions(status, viaTelegram.has(item.url)).map((action) => (
                            <button
                              key={action}
                              type="button"
                              className={ACTION_CLASS[action]}
                              disabled={busy}
                              onClick={(event) => {
                                event.stopPropagation();
                                onDecide(item, action === "undo" ? null : action);
                              }}
                            >
                              <kbd>{ACTION_KEYS[action]}</kbd> {text[action]}
                            </button>
                          ))}
  ```
- The component's doc comment gains: "A row decided in Telegram says so, and the owner can only flip it (Undo for it is in Telegram)."

`components/ControlRoom.tsx`:
- Imports: `import { TELEGRAM_URL, mergeDecisions, parseTelegramDecisions } from "@/lib/telegram-decisions";`.
- After `const inbox = useInbox(...)`:
  ```tsx
  const telegram = useJson(TELEGRAM_URL, parseTelegramDecisions);
  const merged = useMemo(
    () => (inbox.decisions ? mergeDecisions(inbox.decisions, telegram.data) : null),
    [inbox.decisions, telegram.data],
  );
  const decisions = merged?.decisions ?? null;
  ```
- Every other `inbox.decisions` in the component (`visibleItems`, `buildStages`, `statusCounts`, `QueuePane decisions=`) becomes `decisions`; `QueuePane` also gets `viaTelegram={merged?.viaTelegram}`.
- The doc comment's "the queue from pending.json with the inbox's decisions" becomes "the queue from pending.json with the inbox's decisions merged with Telegram's (agent/telegram.json; a missing file means none)".

`components/DemoRoom.tsx` is unchanged (the prop is optional).

- [ ] **Step 5: Run the tests and the build**

Run: `npm test` — all pass.
Run: `npm run build` — succeeds; the route list still includes `/researcher/queue` and both demo routes.

- [ ] **Step 6: Check the page against the live data**

Run `npm run serve` (background) and load `http://localhost:3000/researcher/queue/` headlessly (see the memory note on headless Chrome + CDP; a `next dev` hang means use build + serve). Before C's first live run `agent/telegram.json` 404s on `agent-data`: expected — the queue renders exactly as before (same row count as `pending.json`, no `· telegram` labels, status chips present), and the config spine's review line has no Telegram part yet (the live `run-result.json` predates the block). Stop the server afterwards.

- [ ] **Step 7: Commit**

```bash
git add lib/run-result.ts lib/run-result.test.ts lib/config-view.ts lib/config-view.test.ts lib/control-room-text.ts components/ConfigSpine.tsx components/ControlRoom.tsx components/QueuePane.tsx
git commit -m "Show Telegram decisions and the Telegram approval config in the control room"
```

---

### Task 8: Docs

**Files:**
- Modify: `CLAUDE.md`, `PROGRESS.md`, `docs/agent-plan.md`, `app/researcher/agent/page.tsx`, `docs/tony-scraponi-roadmap.md`

- [ ] **Step 1: `CLAUDE.md`**

In the "Tony Scraponi inbox's decisions" bullet, after "...delivers approved items only (rejected/expired → `dismissed` in `state.json`).", add: "Since sub-project C the bot also asks Artem about each new queue item in his private chat; the agent reads his taps with `getUpdates` at the start of each run and keeps them in `agent/telegram.json` on `agent-data` (update offset, Telegram decisions, ask message ids — never a chat id or token; the owner's chat id is the repo secret `TELEGRAM_OWNER_CHAT_ID`). Per item the later of the site's and Telegram's decision wins: `agent/approval.py`'s `merge_decisions` and `lib/telegram-decisions.ts`'s `mergeDecisions` are pinned to `agent/tests/fixtures/approval-merge.json` — change them together. A webhook set on the bot breaks `getUpdates` (409) and blocks delivery." Add `lib/telegram-decisions` to the `npm test` module list.

- [ ] **Step 2: `docs/agent-plan.md` and `app/researcher/agent/page.tsx`**

In `docs/agent-plan.md`'s "Presets and engine" section, add a short paragraph: approval has a second source — Telegram buttons in the owner's private chat (`approval.telegram`), read by polling at each run; merged with the inbox, latest action wins; asks capped per run; `telegram.json` in the data dir. In `app/researcher/agent/page.tsx`, where the moderation / inbox step is described, add one sentence in the page's voice: Artem can approve or reject each item from Telegram too; the agent picks the taps up on its next run. Keep both high-level.

- [ ] **Step 3: `docs/tony-scraponi-roadmap.md`**

C's line becomes: "**C. Approval: Telegram buttons** — shipped: asks in the owner's private chat, polled each run, merged with the inbox. Spec: `docs/superpowers/specs/2026-10-08-telegram-approval-design.md`." Add a new line after it: "**E. Several delivery targets per preset** — split out of C on 2026-10-08; waits for a real second target."

- [ ] **Step 4: `PROGRESS.md`**

Under "Content Direction & Tony Scraponi", a bullet **Content engine, sub-project C (Telegram approval): built, not pushed** — spec and plan paths; what it does (one paragraph from the spec's Goal and The run); test counts (pytest and Vitest, from the last runs); the Tony golden diff (Task 5 Step 8); the rollout steps still to do (Task 9). Update the status line and "How to resume" (next: C's rollout on Artem's word).

- [ ] **Step 5: Verify and commit**

Run: `npm run build` (the agent page still builds) and `agent/venv/Scripts/python -m pytest agent/tests -q`.

```bash
git add CLAUDE.md PROGRESS.md docs/agent-plan.md app/researcher/agent/page.tsx docs/tony-scraponi-roadmap.md
git commit -m "Document Telegram approval"
```

---

### Task 9: Rollout (with Artem, on his word)

Nothing here is code. Every step that touches GitHub settings, secrets or `main` needs Artem's go-ahead in the session.

- [ ] **Step 1: Owner chat id and webhook check**

Artem sends `/start` to the bot (the one that posts to `@hypnosisflow`) in a private chat. Then, from a scratch script that reads `TELEGRAM_BOT_TOKEN` from `C:\A\polozov\agent\.env` without printing it: call `getWebhookInfo` (expect `"url": ""`) and `getUpdates` **without** an offset (this confirms nothing) and print only `message.chat.id` of updates whose `message.chat.type` is `private` and whose text is `/start`. Show Artem the id; on his word:

```bash
gh secret set TELEGRAM_OWNER_CHAT_ID --repo hpnssflw/hpnssflw.github.io --body <id>
```

The secret must exist before the push: without it every run finds decisions unavailable and delivers nothing.

- [ ] **Step 2: Push**

On Artem's word: merge `origin/main` into the branch if it moved (`git fetch origin main`, `git merge origin/main`, rerun both test suites), then push as a fast-forward: `git push origin HEAD:main`. Check the deploy run succeeds and Pages `build_type` is still `workflow` (`gh api repos/hpnssflw/hpnssflw.github.io/pages --jq .build_type`).

- [ ] **Step 3: First run**

Dispatch `agent-run.yml` (`gh workflow run agent-run.yml --repo hpnssflw/hpnssflw.github.io`), wait for success (`gh run list --workflow agent-run.yml --limit 1`). Check:
- Artem got up to 10 asks in the private chat, newest first.
- `git fetch origin agent-data` → `git show origin/agent-data:agent/telegram.json`: `messages` for the asked items (`offset` stays 0 if `/start` was sent more than 24 h before this run: getUpdates then returns nothing, which is not a failure), and the chat id absent (search for it).
- `git show origin/agent-data:agent/run-result.json`: `config.approval.telegram` present, `failures: []`.

- [ ] **Step 4: Taps and second run**

Artem approves one item and rejects another in Telegram. Dispatch again (or wait for the cron). Check:
- Both messages edited: `✅ Approved — goes out with the next digest` with ↩ Undo; `❌ Rejected` without buttons.
- `state.json` on `agent-data`: the rejected item has `dismissed: "rejected"`.
- `/researcher/queue/` (live): the approved row shows `approved · telegram`; the config spine's review line ends with the Telegram part.
- When the next digest is due, it carries the approved item and its message turns to `📤 Sent dd.mm`.

- [ ] **Step 5: Record**

Add the live check to C's bullet in `PROGRESS.md` (run ids, what was seen), change "built, not pushed" to "shipped" there, in `docs/tony-scraponi-roadmap.md`'s C line and in the spec's status table, drop anything else that still says "not pushed" or "designing", commit (`Record Telegram approval's live check`) and push on Artem's word.
