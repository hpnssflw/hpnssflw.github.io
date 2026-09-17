# Telegram Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead SMTP delivery path with a Telegram Bot API publisher that posts the agent's rolled-up digest to a public Telegram channel, and sync the site/docs so the channel is discoverable and the narrative no longer describes email delivery.

**Architecture:** `agent/digest.py` and `agent/deliver.py` are rewritten in place (same module names, same call sites in `agent/main.py`) — `digest.build` now returns Telegram-ready HTML messages instead of an email `(subject, body)` tuple, and `deliver.send` POSTs them to the Telegram Bot API via `requests` instead of `smtplib`. The existing pending-queue/rollup-cadence gate (`agent/pending.py`) is untouched — only the transport at the end of it changes. Delivery-related field names that said "email" (`email_cadence_hours`, `last_email_at` as exposed on `status.json`, `pending_email_count`) become delivery-neutral, flowing through `agent/config.py`, `agent/status_export.py`, and the site's `lib/agent-status.ts`.

**Tech Stack:** Python (agent — `requests`, already a dependency; stdlib `html.escape`), Next.js/TypeScript (site — `lib/agent-status.ts`, `components/AgentWidget.tsx`, `components/SiteFooter.tsx`), Markdown (`docs/agent-plan.md`), Vitest (`lib/agent-status.test.ts`).

## Global Constraints

- Telegram messages use `parse_mode: "HTML"`; a single combined message is used when it fits under Telegram's 4096-character limit, otherwise one message per topic (plus a small standalone header message) is sent instead — see spec § `agent/digest.py`.
- No new Python dependencies. `requests` (already in `agent/requirements.txt`) is enough for a single `sendMessage` POST; no `python-telegram-bot` or async client.
- `TELEGRAM_BOT_TOKEN` is a secret (env var only — `agent/.env` locally, a GitHub Actions secret in CI), never written to a YAML file. `telegram_channel` (the channel's public `@handle`) is **not** a secret and lives in `agent/defaults.yaml`, since it's the same handle the site links to publicly.
- Field renames (email → delivery-neutral), exact old → new names:
  - `agent/config.py`: `DeliveryConfig.email_cadence_hours` → `delivery_cadence_hours`; `DeliveryConfig.to`/`.from_` → `telegram_channel`.
  - `agent/status.json` (built by `agent/status_export.py`): `last_email_at` → `last_sent_at`, `email_cadence_hours` → `delivery_cadence_hours`, `pending_email_count` → `pending_count`.
  - `lib/agent-status.ts`'s `AgentStatus` interface and `isAgentStatus` guard, `lib/agent-status.test.ts`'s fixtures, and `components/AgentWidget.tsx`'s field reads, all follow the `status.json` renames above.
  - **Not renamed, on purpose:** `agent/pending.py`'s internal `PendingQueue.last_email_at` field and `is_email_due()` function name stay as-is — they're private implementation detail, not part of the public `status.json` contract, and the spec scoped `pending.py` as "no logic changes." `agent/status_export.py` and `agent/main.py` read `queue.last_email_at` internally but expose it publicly under the new `last_sent_at` key.
- The Telegram channel is **public**, linked from `components/SiteFooter.tsx` only (site-wide footer, not the agent page specifically) — matches the roadmap's "link to the channel on the branding site."
- `agent/deliver.py`'s and `agent/digest.py`'s SMTP/email content is fully replaced, not kept alongside as dead code.
- The bot/channel don't exist yet — `agent/defaults.yaml`'s `telegram_channel` and `components/SiteFooter.tsx`'s Telegram `href` both use the literal placeholder `REPLACE_ME` until Artem creates them (see spec § Prerequisite); a TODO comment in `agent/deliver.py` names the live-verification step to run once they exist, mirroring the pattern the old `deliver.py` used for its never-completed SMTP credentials.
- Never stage `.claude/settings.local.json` when committing.

---

### Task 1: Rewrite `digest.py`/`deliver.py` for Telegram, update config

**Files:**
- Modify: `agent/config.py:20-26` (`DeliveryConfig`), `agent/config.py:49-60` (`load_settings`)
- Modify: `agent/defaults.yaml:15-18` (`delivery:` section)
- Modify: `agent/digest.py` (full rewrite)
- Modify: `agent/deliver.py` (full rewrite)

**Interfaces:**
- Consumes: `agent.pending.PendingItem` (existing dataclass, unchanged — `url`, `title`, `source`, `topic`, `topic_name`, `summary`, `score`, `pending_since`, from `agent/pending.py`).
- Produces:
  - `config.DeliveryConfig(telegram_channel: str, delivery_cadence_hours: int)`
  - `config.Settings(llm: LLMConfig, delivery: DeliveryConfig)` — same shape, `delivery` field's inner type changed.
  - `digest.build(items_by_topic: dict[str, list[PendingItem]]) -> list[str]` — Task 2's `main.py` calls this.
  - `deliver.send(messages: list[str], settings: Settings) -> None` — raises on any failure; Task 2's `main.py` wraps this in try/except. Reads `TELEGRAM_BOT_TOKEN` from `os.environ`.

- [ ] **Step 1: Update `DeliveryConfig` and `load_settings` in `agent/config.py`**

Change (currently lines 20-26):

```python
@dataclass(frozen=True)
class DeliveryConfig:
    to: str
    from_: str
    email_cadence_hours: int
```

to:

```python
@dataclass(frozen=True)
class DeliveryConfig:
    telegram_channel: str
    delivery_cadence_hours: int
```

Change (currently lines 49-60):

```python
def load_settings(defaults_path: Path) -> Settings:
    raw = _load_yaml(defaults_path)
    llm_raw = raw["llm"]
    delivery_raw = raw["delivery"]
    return Settings(
        llm=LLMConfig(base_url=llm_raw["base_url"], model=llm_raw["model"]),
        delivery=DeliveryConfig(
            to=delivery_raw["to"],
            from_=delivery_raw["from"],
            email_cadence_hours=delivery_raw["email_cadence_hours"],
        ),
    )
```

to:

```python
def load_settings(defaults_path: Path) -> Settings:
    raw = _load_yaml(defaults_path)
    llm_raw = raw["llm"]
    delivery_raw = raw["delivery"]
    return Settings(
        llm=LLMConfig(base_url=llm_raw["base_url"], model=llm_raw["model"]),
        delivery=DeliveryConfig(
            telegram_channel=delivery_raw["telegram_channel"],
            delivery_cadence_hours=delivery_raw["delivery_cadence_hours"],
        ),
    )
```

- [ ] **Step 2: Update `agent/defaults.yaml`'s `delivery:` section**

Change (currently lines 15-18):

```yaml
delivery:
  to: hypnosisflow@gmail.com
  from: agent@localhost
  email_cadence_hours: 24 # digest rollup cadence; collection/ranking run every 4h regardless
```

to:

```yaml
delivery:
  telegram_channel: "@REPLACE_ME" # the channel's public handle; not a secret. Set once the bot/channel exist (see agent/deliver.py's TODO).
  delivery_cadence_hours: 24 # digest rollup cadence; collection/ranking run every 4h regardless
```

- [ ] **Step 3: Verify config loads correctly (throwaway script, not committed)**

```bash
python3 - <<'PY'
from pathlib import Path
from agent.config import load_settings

settings = load_settings(Path("agent/defaults.yaml"))
assert settings.delivery.telegram_channel == "@REPLACE_ME", settings.delivery.telegram_channel
assert settings.delivery.delivery_cadence_hours == 24, settings.delivery.delivery_cadence_hours
assert settings.llm.model == "deepseek-v4-flash"  # unchanged by this task, sanity check the rest of load_settings still works
print("OK")
PY
```

Expected: prints `OK`, no assertion errors, no `KeyError`.

- [ ] **Step 4: Rewrite `agent/digest.py`**

```python
"""Assemble the pending queue into Telegram-ready HTML messages
(parse_mode=HTML). Normally returns a single message for the whole run;
falls back to one message per topic if the combined message would exceed
Telegram's per-message character limit."""

from __future__ import annotations

from html import escape

from agent.pending import PendingItem

MESSAGE_LIMIT = 4096


def build(items_by_topic: dict[str, list[PendingItem]]) -> list[str]:
    """Return one or more parse_mode=HTML message bodies, each under
    Telegram's per-message character limit."""
    total = sum(len(items) for items in items_by_topic.values())
    header = f"<b>Research digest — {total} item{'' if total == 1 else 's'}</b>"
    topic_blocks = [_render_topic(name, items) for name, items in items_by_topic.items()]

    combined = "\n\n".join([header, *topic_blocks])
    if len(combined) <= MESSAGE_LIMIT:
        return [combined]
    return [header, *topic_blocks]


def _render_topic(topic_name: str, items: list[PendingItem]) -> str:
    lines = [f"<b>{escape(topic_name)}</b>"]
    for item in items:
        url = escape(item.url, quote=True)
        title = escape(item.title)
        lines.append(f'• <a href="{url}">{title}</a>')
        lines.append(escape(item.summary))
    return "\n".join(lines)
```

- [ ] **Step 5: Verify `digest.build`'s formatting and escaping (throwaway script, not committed)**

```bash
python3 - <<'PY'
from agent.digest import build
from agent.pending import PendingItem

item = PendingItem(
    url="https://example.com/a?x=1&y=2",
    title="<script>alert(1)</script> & friends",
    source="hn", topic="tooling", topic_name="Tooling",
    summary="A <b>bold</b> claim & more.",
    score=8, pending_since="2026-09-17T00:00:00+00:00",
)

messages = build({"Tooling": [item]})
assert len(messages) == 1, messages
msg = messages[0]

assert "<script>" not in msg, "raw title HTML must be escaped"
assert "&lt;script&gt;" in msg
assert "&amp; friends" in msg
assert "&amp;" in msg and "x=1&amp;y=2" in msg, "URL must be HTML-escaped for the href attribute"
assert '<a href="https://example.com/a?x=1&amp;y=2">' in msg
assert "<b>Tooling</b>" in msg
assert "Research digest" in msg and "1 item</b>" in msg

print("OK")
PY
```

Expected: prints `OK`, no assertion errors.

- [ ] **Step 6: Verify the >4096-char fallback splits into one message per topic (throwaway script, not committed)**

```bash
python3 - <<'PY'
from agent.digest import build
from agent.pending import PendingItem

def make_item(i: int) -> PendingItem:
    return PendingItem(
        url=f"https://example.com/{i}",
        title="A" * 200,
        source="hn", topic="tooling", topic_name="Tooling",
        summary="B" * 200,
        score=8, pending_since="2026-09-17T00:00:00+00:00",
    )

many_items = {"Tooling": [make_item(i) for i in range(30)]}
messages = build(many_items)

assert len(messages) > 1, "expected a fallback split for an oversized run"
assert "Research digest" in messages[0]
assert all(len(m) <= 4096 for m in messages), [len(m) for m in messages]
assert any("Tooling" in m for m in messages[1:])

print("OK")
PY
```

Expected: prints `OK`, no assertion errors.

- [ ] **Step 7: Rewrite `agent/deliver.py`**

```python
"""Telegram Bot API delivery for the research digest.

# TODO: not yet verified against a real channel -- TELEGRAM_BOT_TOKEN isn't
# in agent/.env yet, and agent/defaults.yaml's delivery.telegram_channel is
# still the "@REPLACE_ME" placeholder. Once the bot is created (via
# @BotFather), the channel exists, and the bot is added as a channel admin
# (see docs/superpowers/specs/2026-09-17-telegram-delivery-design.md §
# Prerequisite), set both and run `python -m agent --topic <slug>` to send
# a live digest and confirm it lands in the channel.
"""

from __future__ import annotations

import os

import requests

from agent.config import Settings

SEND_MESSAGE_URL = "https://api.telegram.org/bot{token}/sendMessage"


def send(messages: list[str], settings: Settings) -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    url = SEND_MESSAGE_URL.format(token=token)
    for message in messages:
        response = requests.post(
            url,
            json={
                "chat_id": settings.delivery.telegram_channel,
                "text": message,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
            timeout=10,
        )
        response.raise_for_status()
```

- [ ] **Step 8: Verify `deliver.send`'s payload and failure path (throwaway script, not committed)**

```bash
python3 - <<'PY'
import os
import requests
from unittest.mock import patch, MagicMock

os.environ["TELEGRAM_BOT_TOKEN"] = "fake-token"

from agent.config import DeliveryConfig, LLMConfig, Settings
from agent import deliver

settings = Settings(
    llm=LLMConfig(base_url="https://api.deepseek.com", model="deepseek-v4-flash"),
    delivery=DeliveryConfig(telegram_channel="@testchannel", delivery_cadence_hours=24),
)

# Success path: two messages, both posted with the right payload shape.
calls = []

def fake_post(url, json, timeout):
    calls.append((url, json, timeout))
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    return resp

with patch("agent.deliver.requests.post", side_effect=fake_post):
    deliver.send(["<b>msg one</b>", "<b>msg two</b>"], settings)

assert len(calls) == 2, calls
url, payload, timeout = calls[0]
assert url == "https://api.telegram.org/botfake-token/sendMessage"
assert payload["chat_id"] == "@testchannel"
assert payload["text"] == "<b>msg one</b>"
assert payload["parse_mode"] == "HTML"
assert payload["disable_web_page_preview"] is True
assert timeout == 10

# Failure path: a non-2xx response's raise_for_status() must propagate.
def failing_post(url, json, timeout):
    resp = MagicMock()
    resp.raise_for_status.side_effect = requests.exceptions.HTTPError("400 Bad Request")
    return resp

with patch("agent.deliver.requests.post", side_effect=failing_post):
    try:
        deliver.send(["<b>msg</b>"], settings)
        raise AssertionError("expected HTTPError to propagate")
    except requests.exceptions.HTTPError:
        pass

print("OK")
PY
```

Expected: prints `OK`, no assertion errors.

- [ ] **Step 9: Commit**

```bash
git add agent/config.py agent/defaults.yaml agent/digest.py agent/deliver.py
git commit -m "$(cat <<'EOF'
Rewrite digest/deliver for Telegram, replacing dead SMTP path

digest.build now returns HTML-formatted Telegram messages (escaped,
clickable links, split into one message per topic if the combined
digest would exceed Telegram's 4096-char limit) instead of an email
(subject, body) tuple. deliver.send POSTs them to the Telegram Bot
API via requests (no new dependency) instead of smtplib.
DeliveryConfig.telegram_channel/delivery_cadence_hours replace the
email-specific to/from_/email_cadence_hours fields.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire Telegram delivery into `main.py`, rename `status.json` fields

**Files:**
- Modify: `agent/status_export.py:23-31` (`build_status` signature), `agent/status_export.py:87-97` (output dict)
- Modify: `agent/main.py:172-205` (`run_real`'s delivery-due block, `run`/`complete` event detail, `build_status` call site)
- Modify: `.github/workflows/agent-run.yml:44-51` (env secrets)

**Interfaces:**
- Consumes: `config.DeliveryConfig.telegram_channel`/`.delivery_cadence_hours`, `digest.build`, `deliver.send` (Task 1).
- Produces: `agent/status.json` with keys `last_sent_at`, `delivery_cadence_hours`, `pending_count` (replacing `last_email_at`/`email_cadence_hours`/`pending_email_count`) — Task 3's `lib/agent-status.ts` types against these exact names.

- [ ] **Step 1: Rename `build_status`'s cadence parameter and output keys in `agent/status_export.py`**

Change (currently lines 23-31):

```python
def build_status(
    run_events: list[dict[str, Any]],
    topic_names: dict[str, str],
    queue: PendingQueue,
    email_cadence_hours: int,
    cadence_hours: int,
    previous_status: dict[str, Any] | None,
    now: datetime,
) -> dict[str, Any]:
```

to:

```python
def build_status(
    run_events: list[dict[str, Any]],
    topic_names: dict[str, str],
    queue: PendingQueue,
    delivery_cadence_hours: int,
    cadence_hours: int,
    previous_status: dict[str, Any] | None,
    now: datetime,
) -> dict[str, Any]:
```

Change (currently lines 87-97):

```python
    return {
        "updated_at": now.isoformat(),
        "cadence_hours": cadence_hours,
        "streak": streak,
        "last_email_at": queue.last_email_at,
        "email_cadence_hours": email_cadence_hours,
        "pending_email_count": len(queue.items),
        "topics": [
            {"slug": slug, "name": topic_names[slug], "collected": c["collected"], "kept": c["kept"]}
            for slug, c in funnel.items()
        ],
        "funnel": funnel,
        "recent_events": recent_events,
        "run_history": run_history,
    }
```

to:

```python
    return {
        "updated_at": now.isoformat(),
        "cadence_hours": cadence_hours,
        "streak": streak,
        "last_sent_at": queue.last_email_at,
        "delivery_cadence_hours": delivery_cadence_hours,
        "pending_count": len(queue.items),
        "topics": [
            {"slug": slug, "name": topic_names[slug], "collected": c["collected"], "kept": c["kept"]}
            for slug, c in funnel.items()
        ],
        "funnel": funnel,
        "recent_events": recent_events,
        "run_history": run_history,
    }
```

(`queue.last_email_at` stays as the internal attribute name — see Global Constraints; only the public JSON key changes.)

- [ ] **Step 2: Verify `build_status`'s renamed output (throwaway script, not committed)**

```bash
python3 - <<'PY'
from datetime import datetime, timezone

from agent.pending import PendingQueue
from agent.status_export import build_status

queue = PendingQueue(last_email_at="2026-09-16T09:00:00+00:00", items=[])
status = build_status(
    run_events=[{"stage": "run", "event": "complete"}],
    topic_names={"tooling": "Tooling"},
    queue=queue,
    delivery_cadence_hours=24,
    cadence_hours=4,
    previous_status=None,
    now=datetime(2026, 9, 17, 9, 0, tzinfo=timezone.utc),
)

assert status["last_sent_at"] == "2026-09-16T09:00:00+00:00"
assert status["delivery_cadence_hours"] == 24
assert status["pending_count"] == 0
for old_key in ("last_email_at", "email_cadence_hours", "pending_email_count"):
    assert old_key not in status, f"stale key {old_key!r} still present"

print("OK")
PY
```

Expected: prints `OK`, no assertion errors.

- [ ] **Step 3: Update `run_real`'s delivery block in `agent/main.py`**

Change (currently lines 172-205):

```python
    emailed = False
    if pending.is_email_due(queue, now, settings.delivery.email_cadence_hours):
        grouped = pending.group_by_topic(queue)
        subject, body = digest.build(grouped)
        try:
            deliver.send(subject, body, settings)
        except Exception as exc:  # noqa: BLE001 — delivery must never crash a scheduled run; retried once due again next time
            writer.emit("deliver", "failed", detail={"error": str(exc), "items": len(queue.items)})
            print(f"Email delivery failed, will retry next run: {exc}")
        else:
            for item in queue.items:
                dedupe.mark_sent_url(state, item.url)
            total_items = len(queue.items)
            writer.emit("deliver", "sent", detail={"items": total_items, "topics": len(grouped)})
            queue.items = []
            queue.last_email_at = now.isoformat()
            emailed = True
            print(f"Sent {total_items} items across {len(grouped)} topics.")
    else:
        print(f"Nothing emailed this run. Pending queue: {len(queue.items)} item(s).")

    dedupe.save_state(STATE_PATH, state)
    pending.save_pending(PENDING_PATH, queue)
    writer.emit("run", "complete", detail={"emailed": emailed, "pending_total": len(queue.items)})
    writer.close()

    all_topics = config.load_topics(TOPICS_DIR, DEFAULTS_PATH)
    topic_names = {t.slug: t.name for t in all_topics}
    previous_status = json.loads(STATUS_PATH.read_text(encoding="utf-8")) if STATUS_PATH.exists() else None
    run_events = events.read_events(writer.path)
    status = status_export.build_status(
        run_events, topic_names, queue, settings.delivery.email_cadence_hours, 4, previous_status, now
    )
    STATUS_PATH.write_text(json.dumps(status, indent=2, sort_keys=True), encoding="utf-8")
```

to:

```python
    delivered = False
    if pending.is_email_due(queue, now, settings.delivery.delivery_cadence_hours):
        grouped = pending.group_by_topic(queue)
        messages = digest.build(grouped)
        try:
            deliver.send(messages, settings)
        except Exception as exc:  # noqa: BLE001 — delivery must never crash a scheduled run; retried once due again next time
            writer.emit("deliver", "failed", detail={"error": str(exc), "items": len(queue.items)})
            print(f"Telegram delivery failed, will retry next run: {exc}")
        else:
            for item in queue.items:
                dedupe.mark_sent_url(state, item.url)
            total_items = len(queue.items)
            writer.emit("deliver", "sent", detail={"items": total_items, "topics": len(grouped)})
            queue.items = []
            queue.last_email_at = now.isoformat()
            delivered = True
            print(f"Sent {total_items} items across {len(grouped)} topics.")
    else:
        print(f"Nothing delivered this run. Pending queue: {len(queue.items)} item(s).")

    dedupe.save_state(STATE_PATH, state)
    pending.save_pending(PENDING_PATH, queue)
    writer.emit("run", "complete", detail={"delivered": delivered, "pending_total": len(queue.items)})
    writer.close()

    all_topics = config.load_topics(TOPICS_DIR, DEFAULTS_PATH)
    topic_names = {t.slug: t.name for t in all_topics}
    previous_status = json.loads(STATUS_PATH.read_text(encoding="utf-8")) if STATUS_PATH.exists() else None
    run_events = events.read_events(writer.path)
    status = status_export.build_status(
        run_events, topic_names, queue, settings.delivery.delivery_cadence_hours, 4, previous_status, now
    )
    STATUS_PATH.write_text(json.dumps(status, indent=2, sort_keys=True), encoding="utf-8")
```

(`pending.is_email_due`/`queue.last_email_at` keep their existing names — see Global Constraints; only the local `emailed` variable, the `run`/`complete` event's `emailed` detail key, and the user-facing print strings drop the "email" wording, since those are this task's own naming, not `pending.py`'s public interface.)

- [ ] **Step 4: Update `.github/workflows/agent-run.yml`'s secrets**

Change (currently lines 44-51):

```yaml
      - name: Run the agent
        working-directory: code
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SMTP_HOST: ${{ secrets.SMTP_HOST }}
          SMTP_PORT: ${{ secrets.SMTP_PORT }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASSWORD: ${{ secrets.SMTP_PASSWORD }}
        run: python -m agent
```

to:

```yaml
      - name: Run the agent
        working-directory: code
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
        run: python -m agent
```

(Adding the actual `TELEGRAM_BOT_TOKEN` repo secret is a manual step Artem does in GitHub repo settings once the bot exists — same as `DEEPSEEK_API_KEY` was added. Until then this workflow step runs with an empty `TELEGRAM_BOT_TOKEN`, which `deliver.send` turns into a graceful per-run failure, same as the old unset `SMTP_*` secrets did.)

- [ ] **Step 5: Live check against real infrastructure**

```bash
python -m agent --topic ai-engineering
```

Expected: no crash. One of two outcomes, both fine:
- If this run's ranking kept zero items above `min_relevance`, `pending.json` stays empty and delivery isn't attempted (`Nothing delivered this run. Pending queue: 0 item(s).` prints) — the delivery code path itself was already verified with no network in Task 1/Step 8.
- If items were kept, `is_email_due` fires (empty queue was never emailed, so it's due immediately) and `deliver.send` raises `KeyError: 'TELEGRAM_BOT_TOKEN'` (not set locally yet), caught by the `except Exception` block: `Telegram delivery failed, will retry next run: 'TELEGRAM_BOT_TOKEN'` prints, and the run still finishes cleanly (`status.json` written, `pending.json` retains the kept items for next time).

Either way, confirm `agent/status.json` was written and contains `last_sent_at`, `delivery_cadence_hours`, and `pending_count` keys (not the old email-named ones):

```bash
python3 -c "import json; s = json.load(open('agent/status.json')); assert {'last_sent_at','delivery_cadence_hours','pending_count'} <= s.keys(); assert not {'last_email_at','email_cadence_hours','pending_email_count'} & s.keys(); print('OK')"
```

Expected: prints `OK`.

- [ ] **Step 6: Commit**

```bash
git add agent/status_export.py agent/main.py .github/workflows/agent-run.yml
git commit -m "$(cat <<'EOF'
Wire Telegram delivery into run_real, rename status.json fields

main.py's delivery-due block now calls digest.build/deliver.send's
new Telegram signatures. status.json's last_email_at/
email_cadence_hours/pending_email_count become last_sent_at/
delivery_cadence_hours/pending_count, matching config.py's renamed
DeliveryConfig fields. The GitHub Actions workflow drops the four
unused SMTP_* secrets and adds TELEGRAM_BOT_TOKEN.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Rename site fields, add the channel link, sync narrative copy

**Files:**
- Modify: `lib/agent-status.ts:32-43` (`AgentStatus` interface), `lib/agent-status.ts:54-72` (`isAgentStatus`)
- Modify: `lib/agent-status.test.ts:11-25` (`makeStatus` fixture)
- Modify: `components/AgentWidget.tsx:162` (`pending_email_count` read)
- Modify: `components/SiteFooter.tsx` (add the Telegram channel link)
- Modify: `app/researcher/agent/page.tsx:37-38` (Goal), `:113-115` (Deliver stage), `:142-146` (Proposed stack), `:152-159` (Cadence & format), `:163-166` (Open questions), `:178-185` (Status)
- Modify: `docs/agent-plan.md:14-15` (Goal), `:51` (Pipeline § Deliver), `:63` (Proposed stack), `:67-68` (Cadence & format), `:84` (Environment/secrets), `:93` (Task breakdown), `:99` (Open questions), `:106-109` (Status)

**Interfaces:**
- Consumes: `agent/status.json`'s renamed keys `last_sent_at`, `delivery_cadence_hours`, `pending_count` (Task 2's `agent/status_export.py` output).
- Produces: nothing other tasks in this plan depend on — last task in the plan.

- [ ] **Step 1: Rename fields in `lib/agent-status.ts`**

Change (currently lines 32-43):

```ts
export interface AgentStatus {
  cadence_hours: number;
  email_cadence_hours: number;
  streak: number;
  pending_email_count: number;
  updated_at: string;
  last_email_at: string | null;
  topics: TopicStatus[];
  funnel: Record<string, FunnelCounts>;
  recent_events: RecentEvent[];
  run_history: RunHistoryEntry[];
}
```

to:

```ts
export interface AgentStatus {
  cadence_hours: number;
  delivery_cadence_hours: number;
  streak: number;
  pending_count: number;
  updated_at: string;
  last_sent_at: string | null;
  topics: TopicStatus[];
  funnel: Record<string, FunnelCounts>;
  recent_events: RecentEvent[];
  run_history: RunHistoryEntry[];
}
```

Change (currently line 60, inside `isAgentStatus`):

```ts
    typeof s.pending_email_count === "number" &&
```

to:

```ts
    typeof s.pending_count === "number" &&
```

- [ ] **Step 2: Update `lib/agent-status.test.ts`'s fixture**

Change (currently lines 11-25):

```ts
function makeStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    cadence_hours: 4,
    email_cadence_hours: 24,
    streak: 1,
    pending_email_count: 0,
    updated_at: "2026-09-09T08:00:00+00:00",
    last_email_at: null,
    topics: [],
    funnel: {},
    recent_events: [],
    run_history: [],
    ...overrides,
  };
}
```

to:

```ts
function makeStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    cadence_hours: 4,
    delivery_cadence_hours: 24,
    streak: 1,
    pending_count: 0,
    updated_at: "2026-09-09T08:00:00+00:00",
    last_sent_at: null,
    topics: [],
    funnel: {},
    recent_events: [],
    run_history: [],
    ...overrides,
  };
}
```

- [ ] **Step 3: Run the Vitest suite**

```bash
npm test
```

Expected: all tests pass, including every `describe("isAgentStatus", ...)` case in `lib/agent-status.test.ts` (TypeScript would already fail to compile if any renamed field were missed, since `makeStatus`'s return type is `AgentStatus`).

- [ ] **Step 4: Update `components/AgentWidget.tsx`'s field read**

Change (currently line 162):

```tsx
          {status.pending_email_count} queued for next digest
```

to:

```tsx
          {status.pending_count} queued for next digest
```

- [ ] **Step 5: Add the Telegram channel link to `components/SiteFooter.tsx`**

Change (currently the whole file):

```tsx
export default function SiteFooter() {
  return (
    <footer>
      <div className="wrap">
        <p className="mono">
          <a href="mailto:hypnosisflow@gmail.com">hypnosisflow@gmail.com</a>
          {" · "}
          <a href="https://github.com/hpnssflw">github.com/hpnssflw</a>
          {" · © 2026"}
        </p>
      </div>
    </footer>
  );
}
```

to:

```tsx
export default function SiteFooter() {
  return (
    <footer>
      <div className="wrap">
        <p className="mono">
          <a href="mailto:hypnosisflow@gmail.com">hypnosisflow@gmail.com</a>
          {" · "}
          <a href="https://github.com/hpnssflw">github.com/hpnssflw</a>
          {" · "}
          {/* TODO: replace once the channel exists, see agent/deliver.py's TODO */}
          <a href="https://t.me/REPLACE_ME">Telegram</a>
          {" · © 2026"}
        </p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 6: Sync `app/researcher/agent/page.tsx`'s narrative to Telegram**

Change (currently lines 33-43, the Goal section):

```tsx
          <p>
            The agent&apos;s only job is to read so I don&apos;t have to read
            everything myself. It checks every few hours; a curated digest of
            what actually moved in web products, AI engineering, and tooling
            — links and a sentence each — rolls up once a day. Nothing is
            emailed until it&apos;s ready, but nothing here is private either
            — the agent&apos;s full working state (what it found, ranked, and
            is holding for the next digest) is public the moment it&apos;s
            written, not just the summary status the widget above shows. Raw
            material for LAB posts, not a LAB post itself.
          </p>
```

to:

```tsx
          <p>
            The agent&apos;s only job is to read so I don&apos;t have to read
            everything myself. It checks every few hours; a curated digest of
            what actually moved in web products, AI engineering, and tooling
            — links and a sentence each — rolls up once a day. Nothing is
            posted until it&apos;s ready, but nothing here is private either
            — the agent&apos;s full working state (what it found, ranked, and
            is holding for the next digest) is public the moment it&apos;s
            written, not just the summary status the widget above shows. Raw
            material for LAB posts, not a LAB post itself.
          </p>
```

Change (currently lines 113-115):

```tsx
            <li>
              Deliver — the digest goes out by email on a fixed schedule.
            </li>
```

to:

```tsx
            <li>
              Deliver — the digest goes out to a public Telegram channel on
              a fixed schedule.
            </li>
```

Change (currently lines 142-146):

```tsx
            <li>
              GitHub Actions on a schedule for the trigger; SMTP for delivery,
              decoupled onto its own coarser cadence so collection can run more
              often than the inbox needs to hear from it.
            </li>
```

to:

```tsx
            <li>
              GitHub Actions on a schedule for the trigger; the Telegram Bot
              API for delivery, decoupled onto its own coarser cadence so
              collection can run more often than the channel needs to hear
              from it.
            </li>
```

Change (currently lines 152-159):

```tsx
          <p>
            Collection and ranking run every four hours — frequent enough that
            the live status above reflects what&apos;s actually happening right
            now. The email digest stays coarser, rolling up everything new once a
            day, so the inbox doesn&apos;t get six emails for one afternoon&apos;s
            reading. Each digest groups items under the three topic headers, one
            line of summary and a link each.
          </p>
```

to:

```tsx
          <p>
            Collection and ranking run every four hours — frequent enough that
            the live status above reflects what&apos;s actually happening right
            now. The Telegram digest stays coarser, rolling up everything new
            once a day, so the channel doesn&apos;t get six posts for one
            afternoon&apos;s reading. Each digest groups items under the three
            topic headers, one line of summary and a link each.
          </p>
```

Change (currently lines 163-166):

```tsx
            <li>
              Whether once-a-day is the right email rollup — watch whether the
              inbox feels stale or noisy and adjust from there.
            </li>
```

to:

```tsx
            <li>
              Whether once-a-day is the right Telegram rollup — watch whether
              the channel feels stale or noisy and adjust from there.
            </li>
```

Change (currently lines 178-185):

```tsx
          <h2 id="status">Status</h2>
          <p>
            Running — the pipeline runs end to end on Hacker News alone, on a
            schedule: collect, filter for recency, dedupe, rank with DeepSeek,
            hold in a pending queue, and deliver by email once a day. The live
            status above reflects the actual current state of that schedule.
            Reddit, RSS, release watching, and web search are next.
          </p>
```

to (only the delivery clause changes — the "Hacker News alone"/"Reddit, RSS..." wording is a separate, pre-existing staleness from before the themes rework, out of scope for this plan):

```tsx
          <h2 id="status">Status</h2>
          <p>
            Running — the pipeline runs end to end on Hacker News alone, on a
            schedule: collect, filter for recency, dedupe, rank with DeepSeek,
            hold in a pending queue, and deliver to Telegram once a day. The
            live status above reflects the actual current state of that
            schedule. Reddit, RSS, release watching, and web search are next.
          </p>
```

- [ ] **Step 7: Sync `docs/agent-plan.md`'s narrative to Telegram**

Change (currently lines 12-19, the Goal section's email sentences):

```markdown
A background agent that reads so Artem doesn't have to read everything
himself. It checks every 4 hours; a short, curated list of what actually
moved in three topics rolls up into an email once a day — links and a
one-line summary each. Nothing is emailed until it's ready, but nothing
here is private either — the agent's full working state (what it found,
ranked, and is holding for the next digest) is public the moment it's
written, not just the summary status the widget shows. Raw material
for his own LAB writing, not a LAB post itself.
```

to:

```markdown
A background agent that reads so Artem doesn't have to read everything
himself. It checks every 4 hours; a short, curated list of what actually
moved in three topics rolls up into a Telegram post once a day — links and
a one-line summary each. Nothing is posted until it's ready, but nothing
here is private either — the agent's full working state (what it found,
ranked, and is holding for the next digest) is public the moment it's
written, not just the summary status the widget shows. Raw material
for his own LAB writing, not a LAB post itself.
```

Change (currently line 51):

```markdown
6. **Deliver** — the digest goes out by email on a fixed schedule.
```

to:

```markdown
6. **Deliver** — the digest goes out to a public Telegram channel on a fixed schedule.
```

Change (currently line 63):

```markdown
- GitHub Actions on a schedule for the trigger (`0 */4 * * *`); SMTP for delivery on its own, coarser cadence — see `docs/superpowers/specs/2026-08-15-agent-status-widget-design.md`.
```

to:

```markdown
- GitHub Actions on a schedule for the trigger (`0 */4 * * *`); the Telegram Bot API for delivery on its own, coarser cadence — see `docs/superpowers/specs/2026-09-17-telegram-delivery-design.md`.
```

Change (currently lines 67-68):

```markdown
Collection and ranking run every 4 hours; email delivery rolls up
everything new once a day (`email_cadence_hours` in `defaults.yaml`).
```

to:

```markdown
Collection and ranking run every 4 hours; Telegram delivery rolls up
everything new once a day (`delivery_cadence_hours` in `defaults.yaml`).
```

Change (currently line 84):

```markdown
- SMTP host, port, user, password — delivery.
```

to:

```markdown
- `TELEGRAM_BOT_TOKEN` — Telegram Bot API, for delivery.
```

Change (currently line 93):

```markdown
end-to-end on Hacker News only, ranked by DeepSeek and delivered by email.
```

to:

```markdown
end-to-end on Hacker News only, ranked by DeepSeek and delivered by Telegram.
```

Change (currently line 99):

```markdown
- Whether once-a-day is the right email rollup — watch whether the inbox feels stale or noisy and adjust from there.
```

to:

```markdown
- Whether once-a-day is the right Telegram rollup — watch whether the channel feels stale or noisy and adjust from there.
```

Change (currently lines 106-109):

```markdown
v1 code-complete: collect (Hacker News) → recency window → dedupe → rank
(DeepSeek) → assemble → deliver (SMTP), running by hand. The SMTP send
path is implemented but not yet exercised against a real inbox — SMTP
credentials aren't in `agent/.env` yet (see the TODO in
`agent/deliver.py`). Remaining sources, scheduling, and the attention
window are tracked in
`docs/superpowers/specs/2026-08-12-research-agent-design.md`.
```

to:

```markdown
v1 code-complete: collect (Hacker News) → recency window → dedupe → rank
(DeepSeek) → assemble → deliver (Telegram), running by hand. The Telegram
send path is implemented but not yet exercised against a real channel —
the bot/channel don't exist yet (see the TODO in `agent/deliver.py`).
Remaining sources, scheduling, and the attention window are tracked in
`docs/superpowers/specs/2026-08-12-research-agent-design.md`.
```

- [ ] **Step 8: Confirm no stale email/SMTP wording remains in the touched files**

```bash
grep -rniE "email|smtp" lib/agent-status.ts lib/agent-status.test.ts components/AgentWidget.tsx components/SiteFooter.tsx app/researcher/agent/page.tsx docs/agent-plan.md
```

Expected: no output. (If anything prints, a replacement above was missed — fix it before continuing. Case-insensitive so it also catches anything like `Email`.)

- [ ] **Step 9: Build the static export and run the full test suite**

```bash
npm run build
npm test
```

Expected: `npm run build` completes without error (static export into `out/`). `npm test` passes (Vitest — `lib/posts`, `lib/agent-status`).

- [ ] **Step 10: Manually check the rendered pages**

```bash
npm run dev
```

Open `http://localhost:3000/`, `http://localhost:3000/researcher/agent/`, and any other route (e.g. `/lab/`). Confirm the footer on every page shows `hypnosisflow@gmail.com · github.com/hpnssflw · Telegram · © 2026`, the `Telegram` link points at `https://t.me/REPLACE_ME` (placeholder, expected until the channel exists), and `/researcher/agent/`'s copy reads naturally with no leftover "email"/"inbox"/"SMTP" wording. Stop the dev server when done.

(If `next dev`'s TCP handshake hangs in this environment, per `CLAUDE.md`, kill node and retry, or fall back to the `npm run build` output already confirmed in Step 9 plus a read-through of the diffs.)

- [ ] **Step 11: Commit**

```bash
git add lib/agent-status.ts lib/agent-status.test.ts components/AgentWidget.tsx components/SiteFooter.tsx app/researcher/agent/page.tsx docs/agent-plan.md
git commit -m "$(cat <<'EOF'
Add Telegram channel link, sync site/docs narrative off email

lib/agent-status.ts, its test fixture, and AgentWidget.tsx follow
status.json's field renames from the previous commit.
SiteFooter.tsx gets a site-wide Telegram channel link (placeholder
URL until the channel exists). /researcher/agent/'s pipeline,
stack, cadence, and status copy, plus docs/agent-plan.md's matching
sections, no longer describe email/SMTP delivery.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan housekeeping (not a task — do after Task 3's commit)

Update `PROGRESS.md`'s "Content Direction & Tony Scraponi" section: mark
sub-project #2 (Telegram delivery) as shipped-pending-live-verification —
code-complete and committed, but the live send to a real channel is
deferred until Artem creates the bot/channel (per this plan's Task 1 Step
7 TODO and Task 2 Step 5's note), same shape as the original v1 plan's
deferred SMTP step. Note the three commits above. Update "Active
sub-project" to point at #3 (Blog content & direction) per
`docs/tony-scraponi-roadmap.md`'s ordering — pending the user's
confirmation that #3 is still next, per `CLAUDE.md`'s session-start
protocol. Per `CLAUDE.md`'s "Clean context after each micro-task" rule,
remind the user to `/clear` and hand off a self-contained prompt for that
confirmation step, rather than starting sub-project #3's brainstorming in
the same session.
