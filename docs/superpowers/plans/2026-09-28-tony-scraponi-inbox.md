# Tony Scraponi Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Artem approves or rejects each queued research item on `/researcher/queue/`, and the agent delivers only approved items to Telegram.

**Architecture:** Decisions live in `decisions.json` in a new public repo, `hpnssflw/tony-inbox`, written only by the site's owner mode (a fine-grained PAT scoped to that repo, kept in `localStorage`) and read only by the agent at the start of each run. The agent drops rejected and expired items (marking them `dismissed` in `state.json` so they never re-queue) and delivers only approved items on the existing 24h cadence. The public page merges `pending.json` and `decisions.json` client-side to show each item's status.

**Tech Stack:** Python agent (`requests`, `pyyaml` — already dependencies), Next.js 16 static export + React 19 client components, Vitest 4, GitHub Contents API, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md`

## Global Constraints

- Decisions repo: `hpnssflw/tony-inbox`, public, default branch `main`, file `decisions.json` at the repo root. Initial content: `{"version": 1, "decisions": {}}`.
- `decisions.json` shape: `{"version": 1, "decisions": {"<item url>": {"decision": "approve" | "reject", "at": "<ISO 8601>"}}}`. Undo deletes the entry. Any invalid part fails the whole file — no partial application.
- The site is the **only writer** of `decisions.json`; the agent only reads it. `pending.json`/`state.json` stay agent-only. `.github/workflows/agent-run.yml` is **not** changed.
- Only approved items are ever delivered. Undecided items wait until `expire_days` (default **7**) and are then dropped. Approved items never expire.
- Delivery cadence stays `delivery_cadence_hours: 24`. No approved items → delivery not due, `last_email_at` untouched.
- Agent can't read/validate `decisions.json` → nothing rejected, expired, or delivered that run; an `("inbox", "failed")` event records why.
- `pending.json` and `status.json` schemas are unchanged.
- Site token: `localStorage` key `tony-inbox-token`; sent only to `https://api.github.com`. All `localStorage` access wrapped in try/catch.
- No new Python or npm dependencies. No Tailwind/CSS-in-JS/component library — styles go in `app/globals.css`, following its case system (meta/chrome UPPERCASE, content lowercase, via `text-transform` only).
- Python on this machine is `py -3` (CI uses `python`). Throwaway verification scripts live in `.superpowers/sdd/2026-09-28-tony-scraponi-inbox/` (git-ignored) and run from the worktree root with `py -3 - < <script>` so the repo root is on `sys.path`.
- All work happens in the worktree `C:\A\polozov\.claude\worktrees\tony-scraponi` on branch `worktree-tony-scraponi`. Nothing touches `main` until Task 5.
- Never stage `.claude/settings.local.json`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- After each task: update the sub-project #5 status line in `PROGRESS.md` in the task's commit, then stop and hand off per `CLAUDE.md` ("Clean context after each micro-task").

---

### Task 1: Agent — decisions loading/applying, `dismissed` state, config

**Files:**
- Create: `agent/inbox.py`
- Modify: `agent/dedupe.py` (module docstring, `StateEntry`, new `dismiss_url`, `filter_seen`)
- Modify: `agent/sources/base.py:31` (`Drop.reason` comment)
- Modify: `agent/config.py` (new `InboxConfig`, `Settings.inbox`, `load_settings`)
- Modify: `agent/defaults.yaml` (new `inbox:` block)
- Modify: `PROGRESS.md`, `docs/tony-scraponi-roadmap.md` (sub-project #5 entries)
- Throwaway: `.superpowers/sdd/2026-09-28-tony-scraponi-inbox/task1-check.py`

**Interfaces:**
- Consumes: `agent.pending.PendingItem`, `agent.pending.PendingQueue`, `agent.dedupe.StateEntry`, `agent.dedupe.url_hash`, `agent.sources.base.Drop` (all existing).
- Produces:
  - `dedupe.StateEntry.dismissed: str | None = None`
  - `dedupe.dismiss_url(state: dict[str, StateEntry], url: str, reason: str) -> None`
  - `config.InboxConfig(decisions_url: str, expire_days: int)`; `config.Settings.inbox: InboxConfig`
  - `inbox.DecisionsUnavailable(Exception)`
  - `inbox.parse_decisions(raw: object) -> dict[str, str]`
  - `inbox.load_decisions(url: str, token: str | None) -> dict[str, str]` (raises `DecisionsUnavailable`)
  - `inbox.apply_decisions(queue: PendingQueue, decisions: dict[str, str], state: dict[str, StateEntry], now: datetime, expire_days: int) -> tuple[list[PendingItem], list[tuple[str, Drop]]]`

- [ ] **Step 1: Write the verification script (it must fail first)**

Create `.superpowers/sdd/2026-09-28-tony-scraponi-inbox/task1-check.py`:

```python
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agent import config, dedupe, inbox
from agent.pending import PendingItem, PendingQueue
from agent.sources.base import Candidate

now = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)


def item(url, days_old):
    return PendingItem(
        url=url, title=f"t {url}", source="hacker_news", topic="tooling",
        topic_name="Tooling", summary="s", score=7,
        pending_since=(now - timedelta(days=days_old)).isoformat(),
    )


def fresh_state(urls):
    return {
        dedupe.url_hash(u): dedupe.StateEntry(first_seen=now.isoformat(), last_score=None, times_sent=0)
        for u in urls
    }


# --- config ---
settings = config.load_settings(Path("agent/defaults.yaml"))
assert settings.inbox.decisions_url == "https://api.github.com/repos/hpnssflw/tony-inbox/contents/decisions.json"
assert settings.inbox.expire_days == 7

# --- an old state.json entry (no "dismissed" key) still loads ---
old = dedupe.StateEntry(**{"first_seen": now.isoformat(), "last_score": 5, "times_sent": 0})
assert old.dismissed is None

# --- parse_decisions ---
good = {"version": 1, "decisions": {"https://a": {"decision": "approve", "at": "2026-09-28T12:00:00Z"}}}
assert inbox.parse_decisions(good) == {"https://a": "approve"}
assert inbox.parse_decisions({"version": 1, "decisions": {}}) == {}
for bad in [
    None,
    [],
    {"version": 2, "decisions": {}},
    {"decisions": {}},
    {"version": 1, "decisions": []},
    {"version": 1, "decisions": {"https://a": {"decision": "maybe", "at": "x"}}},
    {"version": 1, "decisions": {"https://a": {"decision": "approve"}}},
    {"version": 1, "decisions": {"https://a": "approve"}},
]:
    try:
        inbox.parse_decisions(bad)
    except inbox.DecisionsUnavailable:
        pass
    else:
        raise AssertionError(f"accepted bad payload: {bad!r}")

# --- load_decisions: a network failure raises (port 9 has nothing listening) ---
try:
    inbox.load_decisions("http://127.0.0.1:9/decisions.json", None)
except inbox.DecisionsUnavailable as exc:
    assert "fetch failed" in str(exc), exc
else:
    raise AssertionError("load_decisions did not raise")

# --- apply_decisions ---
urls = ["https://a", "https://r", "https://w", "https://old", "https://old-approved"]
state = fresh_state(urls)
queue = PendingQueue(last_email_at=None, items=[
    item("https://a", 1), item("https://r", 1), item("https://w", 1),
    item("https://old", 8), item("https://old-approved", 8),
])
decisions = {
    "https://a": "approve", "https://r": "reject",
    "https://old-approved": "approve", "https://not-in-queue": "reject",
}
approved, drops = inbox.apply_decisions(queue, decisions, state, now, expire_days=7)
assert [i.url for i in approved] == ["https://a", "https://old-approved"], approved
assert [i.url for i in queue.items] == ["https://a", "https://w", "https://old-approved"], queue.items
assert [(slug, d.reason, d.url) for slug, d in drops] == [
    ("tooling", "rejected", "https://r"),
    ("tooling", "expired", "https://old"),
], drops
assert state[dedupe.url_hash("https://r")].dismissed == "rejected"
assert state[dedupe.url_hash("https://old")].dismissed == "expired"
assert state[dedupe.url_hash("https://w")].dismissed is None
assert state[dedupe.url_hash("https://a")].dismissed is None

# undo == no entry: a fresh undecided item is left alone
q2 = PendingQueue(last_email_at=None, items=[item("https://w", 1)])
assert inbox.apply_decisions(q2, {}, state, now, expire_days=7) == ([], [])
assert [i.url for i in q2.items] == ["https://w"]


# --- filter_seen drops a dismissed URL that gets re-collected ---
def cand(url):
    return Candidate(url=url, title=f"t {url}", source="hn", topic="tooling",
                     published_at=now, score=50, excerpt=None)


kept, dropped = dedupe.filter_seen([cand("https://r"), cand("https://w")], state)
assert [c.url for c in kept] == ["https://w"], kept
assert [(d.url, d.reason, d.detail) for d in dropped] == [
    ("https://r", "dismissed", {"dismissed": "rejected"}),
], dropped

print("OK")
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `py -3 - < .superpowers/sdd/2026-09-28-tony-scraponi-inbox/task1-check.py`
Expected: `ImportError: cannot import name 'inbox' from 'agent'` (or `AttributeError` on `settings.inbox`).

- [ ] **Step 3: Add `dismissed` to the dedupe state**

In `agent/dedupe.py`, replace the module docstring:

```python
"""Persistent seen-URL state: hashes, first-seen dates, score history,
send counts, and inbox dismissals. filter_seen drops items that were
actually delivered before, or that the inbox dismissed (rejected by
Artem, or expired undecided) — a candidate that was collected and
dropped in a past run for any other reason is not a duplicate, and stays
eligible."""
```

Replace `StateEntry`:

```python
@dataclass
class StateEntry:
    first_seen: str  # ISO 8601
    last_score: int | None
    times_sent: int
    dismissed: str | None = None  # "rejected" | "expired" -- set by the inbox, never cleared
```

Add after `mark_sent_url`:

```python
def dismiss_url(state: dict[str, StateEntry], url: str, reason: str) -> None:
    """Called when the inbox drops a queued item for good -- rejected by
    Artem, or expired undecided. Like mark_sent_url, a KeyError means the
    queue held something record_seen never saw, which is a bug worth
    surfacing loudly. filter_seen reads this so a dismissed item still
    inside the recency window isn't re-collected, re-ranked and re-queued."""
    state[url_hash(url)].dismissed = reason
```

In `filter_seen`, replace the loop body:

```python
    for candidate in candidates:
        entry = state.get(url_hash(candidate.url))
        if entry is not None and entry.times_sent > 0:
            drops.append(
                Drop(
                    url=candidate.url,
                    title=candidate.title,
                    reason="seen",
                    detail={"times_sent": entry.times_sent},
                )
            )
        elif entry is not None and entry.dismissed is not None:
            drops.append(
                Drop(
                    url=candidate.url,
                    title=candidate.title,
                    reason="dismissed",
                    detail={"dismissed": entry.dismissed},
                )
            )
        else:
            kept.append(candidate)
```

- [ ] **Step 4: Document the new drop reasons**

In `agent/sources/base.py`, change the `reason` line of `Drop` to:

```python
    reason: str  # undated | outside_window | below_min_points | seen | dismissed | below_relevance | over_max_items | rejected | expired
```

- [ ] **Step 5: Add the inbox config**

In `agent/config.py`, add after `DeliveryConfig`:

```python
@dataclass(frozen=True)
class InboxConfig:
    decisions_url: str
    expire_days: int
```

Replace `Settings`:

```python
@dataclass(frozen=True)
class Settings:
    llm: LLMConfig
    delivery: DeliveryConfig
    inbox: InboxConfig
```

Replace `load_settings`:

```python
def load_settings(defaults_path: Path) -> Settings:
    raw = _load_yaml(defaults_path)
    llm_raw = raw["llm"]
    delivery_raw = raw["delivery"]
    inbox_raw = raw["inbox"]
    return Settings(
        llm=LLMConfig(base_url=llm_raw["base_url"], model=llm_raw["model"]),
        delivery=DeliveryConfig(
            telegram_channel=delivery_raw["telegram_channel"],
            delivery_cadence_hours=delivery_raw["delivery_cadence_hours"],
        ),
        inbox=InboxConfig(
            decisions_url=inbox_raw["decisions_url"],
            expire_days=inbox_raw["expire_days"],
        ),
    )
```

Append to `agent/defaults.yaml`:

```yaml

inbox:
  # Artem's approve/reject decisions (docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md).
  # Written only by the site's /researcher/queue/ owner mode; the agent only reads it.
  decisions_url: https://api.github.com/repos/hpnssflw/tony-inbox/contents/decisions.json
  expire_days: 7 # undecided items older than this leave the queue for good
```

- [ ] **Step 6: Create `agent/inbox.py`**

```python
"""Artem's approve/reject decisions for the pending queue. The site's
/researcher/queue/ owner mode is the only writer of decisions.json (in
the hpnssflw/tony-inbox repo); the agent only reads it, at the start of
every real run. See
docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md."""

from __future__ import annotations

from datetime import datetime

import requests

from agent import dedupe
from agent.pending import PendingItem, PendingQueue
from agent.sources.base import Drop

DECISION_VALUES = ("approve", "reject")
TIMEOUT_SECONDS = 15


class DecisionsUnavailable(Exception):
    """decisions.json couldn't be fetched or failed validation. The run
    then treats every item as undecided: nothing is dropped or delivered."""


def parse_decisions(raw: object) -> dict[str, str]:
    """Validate a decoded decisions.json payload and return {url: decision}.
    Any shape problem fails the whole file -- no partial application."""
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise DecisionsUnavailable("decisions.json: missing or unsupported version")
    entries = raw.get("decisions")
    if not isinstance(entries, dict):
        raise DecisionsUnavailable("decisions.json: 'decisions' is not an object")
    result: dict[str, str] = {}
    for url, entry in entries.items():
        if (
            not isinstance(entry, dict)
            or entry.get("decision") not in DECISION_VALUES
            or not isinstance(entry.get("at"), str)
        ):
            raise DecisionsUnavailable(f"decisions.json: invalid entry for {url}")
        result[url] = entry["decision"]
    return result


def load_decisions(url: str, token: str | None) -> dict[str, str]:
    """GET decisions.json through the GitHub Contents API (raw media type).
    The token is optional -- the repo is public -- but authenticated reads
    dodge the 60/h anonymous limit that Actions runners share by IP."""
    headers = {
        "Accept": "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        response = requests.get(url, headers=headers, timeout=TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise DecisionsUnavailable(f"decisions.json fetch failed: {exc}") from exc
    if response.status_code != 200:
        raise DecisionsUnavailable(f"decisions.json fetch failed: HTTP {response.status_code}")
    try:
        raw = response.json()
    except ValueError as exc:
        raise DecisionsUnavailable("decisions.json is not valid JSON") from exc
    return parse_decisions(raw)


def apply_decisions(
    queue: PendingQueue,
    decisions: dict[str, str],
    state: dict[str, dedupe.StateEntry],
    now: datetime,
    expire_days: int,
) -> tuple[list[PendingItem], list[tuple[str, Drop]]]:
    """Drop rejected and expired items from the queue (marking them
    dismissed in state so they're never re-queued) and return the approved
    items plus the drops, each paired with its topic slug for the event
    log. Approved items never expire; undecided ones wait up to
    expire_days. Decisions for URLs not in the queue are ignored."""
    approved: list[PendingItem] = []
    drops: list[tuple[str, Drop]] = []
    remaining: list[PendingItem] = []
    for item in queue.items:
        decision = decisions.get(item.url)
        if decision == "reject":
            dedupe.dismiss_url(state, item.url, "rejected")
            drops.append((item.topic, Drop(url=item.url, title=item.title, reason="rejected", detail={})))
            continue
        if decision == "approve":
            approved.append(item)
            remaining.append(item)
            continue
        age_days = (now - datetime.fromisoformat(item.pending_since)).total_seconds() / 86400
        if age_days > expire_days:
            dedupe.dismiss_url(state, item.url, "expired")
            drops.append(
                (
                    item.topic,
                    Drop(
                        url=item.url,
                        title=item.title,
                        reason="expired",
                        detail={"pending_since": item.pending_since},
                    ),
                )
            )
            continue
        remaining.append(item)
    queue.items = remaining
    return approved, drops
```

- [ ] **Step 7: Run the verification script**

Run: `py -3 - < .superpowers/sdd/2026-09-28-tony-scraponi-inbox/task1-check.py`
Expected: prints `OK`.

- [ ] **Step 8: Confirm the existing agent still imports and loads**

Run: `py -3 -c "from agent import main; from pathlib import Path; from agent import config; print(config.load_settings(Path('agent/defaults.yaml')).inbox)"`
Expected: `InboxConfig(decisions_url='https://api.github.com/repos/hpnssflw/tony-inbox/contents/decisions.json', expire_days=7)`.

- [ ] **Step 9: Record sub-project #5 in the status docs**

In `PROGRESS.md`, "Content Direction & Tony Scraponi" section:

- Change `**Status: sub-projects #1-#4 shipped.**` to `**Status: sub-projects #1-#4 shipped; #5 (Inbox) in progress.**`
- After the "LAB backlog posts" bullet (the last bullet before `### How to resume in a new session`), add:

```markdown
- **Sub-project #5, Inbox (moderated delivery): in progress.**
  Task 1 of 5 done.
  Spec: `docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md`.
  Plan: `docs/superpowers/plans/2026-09-28-tony-scraponi-inbox.md`.
  Work happens in the git worktree `.claude/worktrees/tony-scraponi` on
  branch `worktree-tony-scraponi`, not on `main`, until the plan's Task 5
  merges it.
  Latest: Task 1 added `agent/inbox.py` (load/validate/apply decisions), `dismissed` in the dedupe state, and the `inbox:` config block — not yet wired into `run_real`.
  Next: Task 2 (moderated delivery in `run_real`).
```

Later tasks update this bullet by replacing exactly three lines: the `Task N of 5 done.` line, the `Latest:` line, and the `Next:` line.

- In "How to resume", replace the sentence `There's no confirmed next step for this initiative.` with `Sub-project #5 (Inbox) is in progress — see its entry above for the next task; resume it from the worktree, not from main.`

In `docs/tony-scraponi-roadmap.md`, after item 4 (before the `agent/panel.py` paragraph), add:

```markdown
5. **Inbox (moderated delivery).** Approve/reject each queued item on
   `/researcher/queue/`; only approved items go to Telegram. Decisions
   live in a separate public repo, `hpnssflw/tony-inbox`, so the
   browser-held token can't write to this one. Spec:
   `docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md`.
```

- [ ] **Step 10: Commit**

```bash
git add agent/inbox.py agent/dedupe.py agent/sources/base.py agent/config.py agent/defaults.yaml PROGRESS.md docs/tony-scraponi-roadmap.md
git commit -m "Add inbox decisions loading and dismissed state to the agent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Agent — moderated delivery in `run_real`

**Files:**
- Modify: `agent/pending.py` (`is_email_due`, `group_by_topic`)
- Modify: `agent/main.py` (imports, `run_real`)
- Modify: `docs/agent-plan.md`, `app/researcher/agent/page.tsx` (narrative sync — `CLAUDE.md` rule)
- Modify: `PROGRESS.md` (status line)
- Throwaway: `.superpowers/sdd/2026-09-28-tony-scraponi-inbox/task2-check.py`

**Interfaces:**
- Consumes (Task 1): `inbox.load_decisions(url, token) -> dict[str, str]`, `inbox.DecisionsUnavailable`, `inbox.apply_decisions(queue, decisions, state, now, expire_days) -> tuple[list[PendingItem], list[tuple[str, Drop]]]`, `settings.inbox.decisions_url`, `settings.inbox.expire_days`.
- Produces:
  - `pending.is_email_due(approved: list[PendingItem], last_email_at: str | None, now: datetime, cadence_hours: int) -> bool`
  - `pending.group_by_topic(items: list[PendingItem]) -> dict[str, list[PendingItem]]`
  - `run_real` emits `("inbox", "failed")` events and `emit_drop("inbox", topic, drop)` drops with reasons `rejected`/`expired`.

- [ ] **Step 1: Write the end-to-end verification script (it must fail first)**

Create `.superpowers/sdd/2026-09-28-tony-scraponi-inbox/task2-check.py`. It runs the real `run_real` with collection disabled, `load_decisions` and `deliver.send` stubbed, and state files in a temp dir (event logs land in the git-ignored `agent/runs/`):

```python
import json
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agent import dedupe, deliver, inbox, main, pending

tmp = Path(tempfile.mkdtemp())
main.STATE_PATH = tmp / "state.json"
main.PENDING_PATH = tmp / "pending.json"
main.STATUS_PATH = tmp / "status.json"
main.CONNECTORS = {}  # no collection: exercise only the inbox + delivery tail

now = datetime.now(timezone.utc)
URLS = ["https://a", "https://r", "https://w"]


def item(url):
    return pending.PendingItem(
        url=url, title=f"t {url}", source="hacker_news", topic="tooling",
        topic_name="Tooling", summary="s", score=7,
        pending_since=(now - timedelta(days=1)).isoformat(),
    )


def seed(last_email_at):
    state = {
        dedupe.url_hash(u): dedupe.StateEntry(first_seen=now.isoformat(), last_score=None, times_sent=0)
        for u in URLS
    }
    dedupe.save_state(main.STATE_PATH, state)
    pending.save_pending(
        main.PENDING_PATH,
        pending.PendingQueue(last_email_at=last_email_at, items=[item(u) for u in URLS]),
    )


sent = []
deliver.send = lambda messages, settings: sent.append(messages)

# 1. approve a, reject r, w undecided, never delivered before -> a goes out alone
seed(None)
inbox.load_decisions = lambda url, token: {"https://a": "approve", "https://r": "reject"}
main.run_real(None)
q = pending.load_pending(main.PENDING_PATH)
s = dedupe.load_state(main.STATE_PATH)
assert len(sent) == 1, sent
assert "t https://a" in sent[0][0] and "t https://w" not in sent[0][0], sent
assert [i.url for i in q.items] == ["https://w"], q.items
assert q.last_email_at is not None
assert s[dedupe.url_hash("https://a")].times_sent == 1
assert s[dedupe.url_hash("https://r")].dismissed == "rejected"
assert s[dedupe.url_hash("https://w")].times_sent == 0

# 2. decisions unreadable -> nothing dropped, nothing sent
sent.clear()
seed(None)


def unavailable(url, token):
    raise inbox.DecisionsUnavailable("test outage")


inbox.load_decisions = unavailable
main.run_real(None)
q = pending.load_pending(main.PENDING_PATH)
assert sent == [] and len(q.items) == 3 and q.last_email_at is None, (sent, q)

# 3. nothing approved -> not due, last_email_at untouched
sent.clear()
seed("2026-01-01T00:00:00+00:00")
inbox.load_decisions = lambda url, token: {}
main.run_real(None)
q = pending.load_pending(main.PENDING_PATH)
assert sent == [] and q.last_email_at == "2026-01-01T00:00:00+00:00" and len(q.items) == 3, (sent, q)

# 4. approved but the 24h cadence hasn't elapsed -> held, still queued
sent.clear()
seed(now.isoformat())
inbox.load_decisions = lambda url, token: {"https://a": "approve"}
main.run_real(None)
q = pending.load_pending(main.PENDING_PATH)
assert sent == [] and len(q.items) == 3, (sent, q)

# status.json is still written with its unchanged schema
status = json.loads(main.STATUS_PATH.read_text(encoding="utf-8"))
assert "pending_count" in status and "last_sent_at" in status, status.keys()

print("OK")
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `py -3 - < .superpowers/sdd/2026-09-28-tony-scraponi-inbox/task2-check.py`
Expected: `AssertionError` in scenario 1 (today's `run_real` never calls `inbox.load_decisions` and sends all three items).

- [ ] **Step 3: Change the delivery gate and grouping in `agent/pending.py`**

Replace `is_email_due` and `group_by_topic`:

```python
def is_email_due(
    approved: list[PendingItem], last_email_at: str | None, now: datetime, cadence_hours: int
) -> bool:
    """Delivery is due when at least one item is approved and the cadence
    has elapsed (or delivery has never happened). Undecided items never
    make delivery due -- only Artem's approvals do."""
    if not approved:
        return False
    if last_email_at is None:
        return True
    last = datetime.fromisoformat(last_email_at)
    return (now - last).total_seconds() >= cadence_hours * 3600


def group_by_topic(items: list[PendingItem]) -> dict[str, list[PendingItem]]:
    grouped: dict[str, list[PendingItem]] = {}
    for item in items:
        grouped.setdefault(item.topic_name, []).append(item)
    for group in grouped.values():
        group.sort(key=lambda i: i.score, reverse=True)
    return grouped
```

- [ ] **Step 4: Wire the inbox into `run_real`**

In `agent/main.py`, add `import os` after `import json`, and change the agent import line to:

```python
from agent import config, dedupe, date_guard, deliver, digest, events, inbox, pending, status_export, summarize
```

In `run_real`, directly after `queue = pending.load_pending(PENDING_PATH)`, insert:

```python
    try:
        decisions = inbox.load_decisions(settings.inbox.decisions_url, os.environ.get("GITHUB_TOKEN"))
    except inbox.DecisionsUnavailable as exc:
        writer.emit("inbox", "failed", detail={"error": str(exc)})
        print(f"Inbox decisions unavailable; nothing is dropped or delivered this run: {exc}")
        approved: list[pending.PendingItem] = []
    else:
        approved, inbox_drops = inbox.apply_decisions(
            queue, decisions, state, now, settings.inbox.expire_days
        )
        for topic_slug, drop in inbox_drops:
            writer.emit_drop("inbox", topic_slug, drop)
```

Replace the whole delivery block (from `delivered = False` through the `else: print(f"Nothing delivered ...")` branch) with:

```python
    delivered = False
    if pending.is_email_due(approved, queue.last_email_at, now, settings.delivery.delivery_cadence_hours):
        grouped = pending.group_by_topic(approved)
        messages = digest.build(grouped)
        try:
            deliver.send(messages, settings)
        except Exception as exc:  # noqa: BLE001 — delivery must never crash a scheduled run; retried once due again next time
            writer.emit("deliver", "failed", detail={"error": str(exc), "items": len(approved)})
            print(f"Telegram delivery failed, will retry next run: {exc}")
        else:
            for item in approved:
                dedupe.mark_sent_url(state, item.url)
            sent_urls = {item.url for item in approved}
            queue.items = [item for item in queue.items if item.url not in sent_urls]
            queue.last_email_at = now.isoformat()
            writer.emit("deliver", "sent", detail={"items": len(approved), "topics": len(grouped)})
            delivered = True
            print(f"Sent {len(approved)} approved items across {len(grouped)} topics.")
    else:
        print(
            f"Nothing delivered this run. Pending queue: {len(queue.items)} item(s), "
            f"{len(approved)} approved."
        )
```

- [ ] **Step 5: Run the verification scripts**

Run: `py -3 - < .superpowers/sdd/2026-09-28-tony-scraponi-inbox/task2-check.py`
Expected: prints `OK` (plus the run's own `print` lines).

Run: `py -3 - < .superpowers/sdd/2026-09-28-tony-scraponi-inbox/task1-check.py`
Expected: prints `OK`.

- [ ] **Step 6: Sync the agent narrative (docs/agent-plan.md)**

Replace:

```
moved in three topics rolls up into a Telegram post once a day — links and
a one-line summary each. Nothing is posted until it's ready, but nothing
```

with:

```
moved in three topics rolls up into a Telegram post once a day — links and
a one-line summary each, and only the items he's approved on
`/researcher/queue/`. Nothing is posted until it's ready, but nothing
```

Replace:

```
3. **Dedupe** — every link's URL gets hashed against a store of what's already been sent; only new links continue.
```

with:

```
3. **Dedupe** — every link's URL gets hashed against a store of what's already been sent or dismissed from the inbox; only new links continue.
```

Replace:

```
6. **Deliver** — the digest goes out to a public Telegram channel on a fixed schedule.
```

with:

```
6. **Deliver** — the items Artem approved on `/researcher/queue/` go out to a public Telegram channel on a fixed schedule. Rejected items are dismissed for good; undecided ones expire after `inbox.expire_days` — see `docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md`.
```

Replace:

```
Collection and ranking run every 4 hours; Telegram delivery rolls up
everything new once a day (`delivery_cadence_hours` in `defaults.yaml`).
```

with:

```
Collection and ranking run every 4 hours; Telegram delivery rolls up
everything approved once a day (`delivery_cadence_hours` in `defaults.yaml`).
```

- [ ] **Step 7: Sync the public plan page (app/researcher/agent/page.tsx)**

Replace:

```tsx
            — links and a sentence each — rolls up once a day. Nothing is
            posted until it&apos;s ready, but nothing here is private either
```

with:

```tsx
            — links and a sentence each — rolls up once a day, and only what
            I&apos;ve approved on the queue page goes out. Nothing is
            posted until it&apos;s ready, but nothing here is private either
```

Replace:

```tsx
              Deliver — the digest goes out to a public Telegram channel on
              a fixed schedule.
```

with:

```tsx
              Deliver — once a day, the items I&apos;ve approved on the queue
              page go out to a public Telegram channel. Anything I reject
              never comes back; anything I leave undecided for a week drops
              off.
```

Replace:

```tsx
            hold in a pending queue, and deliver to Telegram once a day. The
```

with:

```tsx
            hold in a pending queue for my approval, and deliver what I
            approve to Telegram once a day. The
```

- [ ] **Step 8: Verify the site still builds and tests pass**

Run: `npm test`
Expected: `Test Files  8 passed (8)`, 0 failures.

Run: `npm run build`
Expected: build completes; `/researcher/agent` is listed among the exported routes.

- [ ] **Step 9: Update the status line and commit**

In `PROGRESS.md`'s sub-project #5 bullet, replace three lines:
- `Task 1 of 5 done.` → `Task 2 of 5 done.`
- the `Latest:` line → `Latest: Task 2 wired the inbox into run_real — only approved items are delivered, rejected/expired ones are dismissed, an unreadable decisions.json drops and delivers nothing; agent narrative synced.`
- the `Next:` line → `Next: Task 3 (site libs: lib/inbox.ts, lib/github-contents.ts).`

```bash
git add agent/pending.py agent/main.py docs/agent-plan.md app/researcher/agent/page.tsx PROGRESS.md
git commit -m "Deliver only inbox-approved items from the agent's run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Site — `lib/inbox.ts` and `lib/github-contents.ts`

**Files:**
- Create: `lib/github-contents.ts`, `lib/github-contents.test.ts`
- Create: `lib/inbox.ts`, `lib/inbox.test.ts`
- Modify: `PROGRESS.md` (status line)

**Interfaces:**
- Consumes: nothing from earlier tasks (the shape of `decisions.json` from Global Constraints).
- Produces (`lib/github-contents.ts`):
  - `class GitHubAuthError extends Error` (401/403), `class GitHubConflictError extends Error` (409/422)
  - `encodeBase64Utf8(text: string): string`, `decodeBase64Utf8(b64: string): string`
  - `getFile(repo: string, path: string, token: string): Promise<{ text: string; sha: string }>`
  - `putFile(repo: string, path: string, text: string, sha: string, message: string, token: string): Promise<{ sha: string }>`
- Produces (`lib/inbox.ts`):
  - `DECISIONS_REPO = "hpnssflw/tony-inbox"`, `DECISIONS_PATH = "decisions.json"`, `DECISIONS_RAW_URL`
  - `type Decision = "approve" | "reject"`, `type ItemStatus = "approved" | "rejected" | "waiting"`
  - `interface DecisionEntry { decision: Decision; at: string }`, `interface Decisions { version: 1; decisions: Record<string, DecisionEntry> }`, `interface OwnerSnapshot { decisions: Decisions; sha: string }`
  - `EMPTY_DECISIONS: Decisions`
  - `isDecisions(value: unknown): value is Decisions`
  - `setDecision(decisions: Decisions, url: string, decision: Decision | null, now: Date): Decisions`
  - `pruneDecisions(decisions: Decisions, liveUrls: Iterable<string>): Decisions`
  - `itemStatus(decisions: Decisions | null, url: string): ItemStatus`
  - `serializeDecisions(decisions: Decisions): string`
  - `commitMessage(action: Decision | "undo", title: string): string`
  - `fetchPublicDecisions(): Promise<Decisions | null>`
  - `fetchOwnerDecisions(token: string): Promise<OwnerSnapshot>`

- [ ] **Step 1: Write the failing tests for `lib/github-contents.ts`**

Create `lib/github-contents.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitHubAuthError,
  GitHubConflictError,
  decodeBase64Utf8,
  encodeBase64Utf8,
  getFile,
  putFile,
} from "./github-contents";

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(status: number, body: unknown) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

describe("base64 helpers", () => {
  it("round-trips non-ASCII text", () => {
    const text = "Привет — café ✓ 🚀";
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text);
  });

  it("decodes GitHub's newline-wrapped base64", () => {
    const encoded = encodeBase64Utf8("x".repeat(100));
    const wrapped = encoded.match(/.{1,60}/g)!.join("\n") + "\n";
    expect(decodeBase64Utf8(wrapped)).toBe("x".repeat(100));
  });
});

describe("getFile", () => {
  it("returns decoded text and sha, sending the token as a Bearer header", async () => {
    const fetchMock = respond(200, { content: encodeBase64Utf8("{}\n"), sha: "s1" });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getFile("o/r", "f.json", "tok")).resolves.toEqual({ text: "{}\n", sha: "s1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/o/r/contents/f.json");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init?.cache).toBe("no-store");
  });

  it("throws GitHubAuthError on 401 and 403", async () => {
    vi.stubGlobal("fetch", respond(401, {}));
    await expect(getFile("o/r", "f.json", "tok")).rejects.toBeInstanceOf(GitHubAuthError);
    vi.stubGlobal("fetch", respond(403, {}));
    await expect(getFile("o/r", "f.json", "tok")).rejects.toBeInstanceOf(GitHubAuthError);
  });

  it("throws a plain Error on 404", async () => {
    vi.stubGlobal("fetch", respond(404, {}));
    const err = await getFile("o/r", "f.json", "tok").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GitHubAuthError);
    expect(err).not.toBeInstanceOf(GitHubConflictError);
  });

  it("throws on an unexpected response body", async () => {
    vi.stubGlobal("fetch", respond(200, { sha: "s1" }));
    await expect(getFile("o/r", "f.json", "tok")).rejects.toThrow("unexpected response");
  });
});

describe("putFile", () => {
  it("PUTs base64 content with the previous sha and returns the new sha", async () => {
    const fetchMock = respond(200, { content: { sha: "s2" } });
    vi.stubGlobal("fetch", fetchMock);
    await expect(putFile("o/r", "f.json", "ü\n", "s1", "approve: x", "tok")).resolves.toEqual({
      sha: "s2",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/o/r/contents/f.json");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({
      message: "approve: x",
      content: encodeBase64Utf8("ü\n"),
      sha: "s1",
    });
  });

  it("throws GitHubConflictError on 409 and 422", async () => {
    vi.stubGlobal("fetch", respond(409, {}));
    await expect(putFile("o/r", "f.json", "x", "s1", "m", "tok")).rejects.toBeInstanceOf(
      GitHubConflictError,
    );
    vi.stubGlobal("fetch", respond(422, {}));
    await expect(putFile("o/r", "f.json", "x", "s1", "m", "tok")).rejects.toBeInstanceOf(
      GitHubConflictError,
    );
  });

  it("throws GitHubAuthError on 401", async () => {
    vi.stubGlobal("fetch", respond(401, {}));
    await expect(putFile("o/r", "f.json", "x", "s1", "m", "tok")).rejects.toBeInstanceOf(
      GitHubAuthError,
    );
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/github-contents.test.ts`
Expected: FAIL — `Failed to resolve import "./github-contents"`.

- [ ] **Step 3: Implement `lib/github-contents.ts`**

```ts
/**
 * Minimal GitHub Contents API client for the inbox's owner mode
 * (/researcher/queue/). The token only ever goes to api.github.com, in
 * the Authorization header.
 */

const API = "https://api.github.com";

/** 401/403: the token is missing, expired, revoked, or lacks access. */
export class GitHubAuthError extends Error {
  name = "GitHubAuthError";
}

/** 409/422: the file changed since its sha was read (e.g. another tab). */
export class GitHubConflictError extends Error {
  name = "GitHubConflictError";
}

export interface FileSnapshot {
  text: string;
  sha: string;
}

function headers(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function toError(res: Response, what: string): Error {
  if (res.status === 401 || res.status === 403) {
    return new GitHubAuthError(`${what}: ${res.status}`);
  }
  if (res.status === 409 || res.status === 422) {
    return new GitHubConflictError(`${what}: ${res.status}`);
  }
  return new Error(`${what}: ${res.status}`);
}

/** btoa only takes Latin-1, and item titles carry any Unicode. */
export function encodeBase64Utf8(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** GitHub wraps base64 content at 60 columns; whitespace is stripped first. */
export function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export async function getFile(repo: string, path: string, token: string): Promise<FileSnapshot> {
  const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    headers: headers(token),
    cache: "no-store",
  });
  if (!res.ok) throw toError(res, `GET ${path}`);
  const body = (await res.json()) as { content?: unknown; sha?: unknown };
  if (typeof body.content !== "string" || typeof body.sha !== "string") {
    throw new Error(`GET ${path}: unexpected response`);
  }
  return { text: decodeBase64Utf8(body.content), sha: body.sha };
}

export async function putFile(
  repo: string,
  path: string,
  text: string,
  sha: string,
  message: string,
  token: string,
): Promise<{ sha: string }> {
  const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: encodeBase64Utf8(text), sha }),
  });
  if (!res.ok) throw toError(res, `PUT ${path}`);
  const body = (await res.json()) as { content?: { sha?: unknown } };
  if (typeof body.content?.sha !== "string") {
    throw new Error(`PUT ${path}: unexpected response`);
  }
  return { sha: body.content.sha };
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run lib/github-contents.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Write the failing tests for `lib/inbox.ts`**

Create `lib/inbox.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubAuthError, encodeBase64Utf8 } from "./github-contents";
import {
  DECISIONS_RAW_URL,
  type Decisions,
  EMPTY_DECISIONS,
  commitMessage,
  fetchOwnerDecisions,
  fetchPublicDecisions,
  isDecisions,
  itemStatus,
  pruneDecisions,
  serializeDecisions,
  setDecision,
} from "./inbox";

const NOW = new Date("2026-09-28T12:00:00.000Z");

function makeDecisions(entries: Decisions["decisions"] = {}): Decisions {
  return { version: 1, decisions: entries };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isDecisions", () => {
  it("accepts an empty and a filled file", () => {
    expect(isDecisions(EMPTY_DECISIONS)).toBe(true);
    expect(
      isDecisions(
        makeDecisions({
          "https://a": { decision: "approve", at: "x" },
          "https://b": { decision: "reject", at: "y" },
        }),
      ),
    ).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isDecisions(null)).toBe(false);
    expect(isDecisions("nope")).toBe(false);
    expect(isDecisions([])).toBe(false);
  });

  it("rejects a wrong or missing version", () => {
    expect(isDecisions({ version: 2, decisions: {} })).toBe(false);
    expect(isDecisions({ decisions: {} })).toBe(false);
  });

  it("rejects a non-object or array decisions map", () => {
    expect(isDecisions({ version: 1, decisions: [] })).toBe(false);
    expect(isDecisions({ version: 1, decisions: null })).toBe(false);
  });

  it("rejects an unknown decision value or a missing at", () => {
    expect(isDecisions(makeDecisions({ "https://a": { decision: "maybe", at: "x" } as never }))).toBe(
      false,
    );
    expect(isDecisions({ version: 1, decisions: { "https://a": { decision: "approve" } } })).toBe(
      false,
    );
  });
});

describe("setDecision", () => {
  it("records a decision with an ISO timestamp", () => {
    expect(setDecision(EMPTY_DECISIONS, "https://a", "approve", NOW)).toEqual(
      makeDecisions({ "https://a": { decision: "approve", at: "2026-09-28T12:00:00.000Z" } }),
    );
  });

  it("overwrites an earlier decision", () => {
    const before = makeDecisions({ "https://a": { decision: "approve", at: "old" } });
    expect(setDecision(before, "https://a", "reject", NOW).decisions["https://a"]).toEqual({
      decision: "reject",
      at: "2026-09-28T12:00:00.000Z",
    });
  });

  it("removes the entry on undo (null)", () => {
    const before = makeDecisions({ "https://a": { decision: "approve", at: "old" } });
    expect(setDecision(before, "https://a", null, NOW)).toEqual(EMPTY_DECISIONS);
  });

  it("does not mutate its input", () => {
    const before = makeDecisions({ "https://a": { decision: "approve", at: "x" } });
    const snapshot = structuredClone(before);
    setDecision(before, "https://a", null, NOW);
    setDecision(before, "https://b", "reject", NOW);
    expect(before).toEqual(snapshot);
  });
});

describe("pruneDecisions", () => {
  it("keeps only URLs still in the queue", () => {
    const before = makeDecisions({
      "https://live": { decision: "approve", at: "x" },
      "https://gone": { decision: "reject", at: "y" },
    });
    expect(pruneDecisions(before, ["https://live", "https://other"])).toEqual(
      makeDecisions({ "https://live": { decision: "approve", at: "x" } }),
    );
  });
});

describe("itemStatus", () => {
  const decisions = makeDecisions({
    "https://a": { decision: "approve", at: "x" },
    "https://r": { decision: "reject", at: "y" },
  });

  it("maps decisions to statuses", () => {
    expect(itemStatus(decisions, "https://a")).toBe("approved");
    expect(itemStatus(decisions, "https://r")).toBe("rejected");
    expect(itemStatus(decisions, "https://w")).toBe("waiting");
  });

  it("treats missing decisions as waiting", () => {
    expect(itemStatus(null, "https://a")).toBe("waiting");
  });
});

describe("serializeDecisions", () => {
  it("round-trips through JSON.parse and ends with a newline", () => {
    const d = makeDecisions({ "https://a": { decision: "approve", at: "x" } });
    const text = serializeDecisions(d);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(d);
  });
});

describe("commitMessage", () => {
  it("keeps short messages as-is", () => {
    expect(commitMessage("approve", "Short title")).toBe("approve: Short title");
    expect(commitMessage("undo", "Short title")).toBe("undo: Short title");
  });

  it("truncates to 72 characters with an ellipsis", () => {
    const msg = commitMessage("reject", "x".repeat(200));
    expect(msg).toHaveLength(72);
    expect(msg.startsWith("reject: xxx")).toBe(true);
    expect(msg.endsWith("…")).toBe(true);
  });
});

describe("fetchPublicDecisions", () => {
  it("returns the parsed file from the raw URL", async () => {
    const d = makeDecisions({ "https://a": { decision: "approve", at: "x" } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(d), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPublicDecisions()).resolves.toEqual(d);
    expect(fetchMock).toHaveBeenCalledWith(DECISIONS_RAW_URL, { cache: "no-store" });
  });

  it("returns null on a 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(fetchPublicDecisions()).resolves.toBeNull();
  });

  it("returns null on a malformed file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ version: 9 }), { status: 200 })),
    );
    await expect(fetchPublicDecisions()).resolves.toBeNull();
  });

  it("returns null when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    await expect(fetchPublicDecisions()).resolves.toBeNull();
  });
});

describe("fetchOwnerDecisions", () => {
  it("returns decisions and sha from the Contents API", async () => {
    const d = makeDecisions({ "https://a": { decision: "reject", at: "x" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ content: encodeBase64Utf8(serializeDecisions(d)), sha: "abc" }),
            { status: 200 },
          ),
      ),
    );
    await expect(fetchOwnerDecisions("tok")).resolves.toEqual({ decisions: d, sha: "abc" });
  });

  it("throws on a malformed file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ content: encodeBase64Utf8('{"version":9}'), sha: "abc" }), {
            status: 200,
          }),
      ),
    );
    await expect(fetchOwnerDecisions("tok")).rejects.toThrow("decisions.json is malformed");
  });

  it("passes auth failures through as GitHubAuthError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(fetchOwnerDecisions("tok")).rejects.toBeInstanceOf(GitHubAuthError);
  });
});
```

- [ ] **Step 6: Run to confirm failure**

Run: `npx vitest run lib/inbox.test.ts`
Expected: FAIL — `Failed to resolve import "./inbox"`.

- [ ] **Step 7: Implement `lib/inbox.ts`**

```ts
import { getFile } from "./github-contents";

/**
 * The Tony Scraponi inbox's decisions file (hpnssflw/tony-inbox). The
 * site's /researcher/queue/ owner mode is its only writer; the agent
 * reads it at the start of every run and delivers approved items only.
 * See docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md.
 */
export const DECISIONS_REPO = "hpnssflw/tony-inbox";
export const DECISIONS_PATH = "decisions.json";
export const DECISIONS_RAW_URL = `https://raw.githubusercontent.com/${DECISIONS_REPO}/main/${DECISIONS_PATH}`;

export type Decision = "approve" | "reject";
export type ItemStatus = "approved" | "rejected" | "waiting";

export interface DecisionEntry {
  decision: Decision;
  at: string;
}

export interface Decisions {
  version: 1;
  decisions: Record<string, DecisionEntry>;
}

export interface OwnerSnapshot {
  decisions: Decisions;
  sha: string;
}

export const EMPTY_DECISIONS: Decisions = { version: 1, decisions: {} };

const COMMIT_MESSAGE_MAX = 72;

function isDecisionEntry(value: unknown): value is DecisionEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (e.decision === "approve" || e.decision === "reject") && typeof e.at === "string";
}

/** Mirrors agent/inbox.py's parse_decisions: any bad part fails the whole file. */
export function isDecisions(value: unknown): value is Decisions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  if (d.version !== 1) return false;
  if (typeof d.decisions !== "object" || d.decisions === null || Array.isArray(d.decisions)) {
    return false;
  }
  return Object.values(d.decisions).every(isDecisionEntry);
}

/** Returns a new Decisions; `null` is undo (the entry is removed). */
export function setDecision(
  decisions: Decisions,
  url: string,
  decision: Decision | null,
  now: Date,
): Decisions {
  const next = { ...decisions.decisions };
  if (decision === null) delete next[url];
  else next[url] = { decision, at: now.toISOString() };
  return { version: 1, decisions: next };
}

/** Drops entries for URLs no longer queued, so the file stays bounded by the queue. */
export function pruneDecisions(decisions: Decisions, liveUrls: Iterable<string>): Decisions {
  const live = new Set(liveUrls);
  const next: Record<string, DecisionEntry> = {};
  for (const [url, entry] of Object.entries(decisions.decisions)) {
    if (live.has(url)) next[url] = entry;
  }
  return { version: 1, decisions: next };
}

export function itemStatus(decisions: Decisions | null, url: string): ItemStatus {
  const entry = decisions?.decisions[url];
  if (entry?.decision === "approve") return "approved";
  if (entry?.decision === "reject") return "rejected";
  return "waiting";
}

export function serializeDecisions(decisions: Decisions): string {
  return `${JSON.stringify(decisions, null, 2)}\n`;
}

export function commitMessage(action: Decision | "undo", title: string): string {
  const message = `${action}: ${title}`;
  return message.length <= COMMIT_MESSAGE_MAX
    ? message
    : `${message.slice(0, COMMIT_MESSAGE_MAX - 1)}…`;
}

/** Public read through raw.githubusercontent (≈5 min cache). Any failure → null. */
export async function fetchPublicDecisions(): Promise<Decisions | null> {
  try {
    const res = await fetch(DECISIONS_RAW_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isDecisions(data) ? data : null;
  } catch {
    return null;
  }
}

/** Owner read through the Contents API: fresh, and with the sha a write needs. */
export async function fetchOwnerDecisions(token: string): Promise<OwnerSnapshot> {
  const file = await getFile(DECISIONS_REPO, DECISIONS_PATH, token);
  const data: unknown = JSON.parse(file.text);
  if (!isDecisions(data)) throw new Error("decisions.json is malformed");
  return { decisions: data, sha: file.sha };
}
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: `Test Files  10 passed (10)`, 0 failures.

Run: `npx eslint lib`
Expected: no output (clean).

- [ ] **Step 9: Update the status line and commit**

In `PROGRESS.md`'s sub-project #5 bullet, replace three lines:
- `Task 2 of 5 done.` → `Task 3 of 5 done.`
- the `Latest:` line → `Latest: Task 3 added lib/github-contents.ts and lib/inbox.ts (Vitest-covered).`
- the `Next:` line → `Next: Task 4 (statuses and owner mode on /researcher/queue/).`

```bash
git add lib/github-contents.ts lib/github-contents.test.ts lib/inbox.ts lib/inbox.test.ts PROGRESS.md
git commit -m "Add inbox decisions and GitHub Contents helpers for the site

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Site — statuses and owner mode on `/researcher/queue/`

**Files:**
- Create: `components/InboxControls.tsx`
- Modify: `components/PendingQueue.tsx` (full rewrite below)
- Modify: `app/researcher/queue/page.tsx` (subtitle + metadata description)
- Modify: `app/globals.css` (append an Inbox section at the end)
- Modify: `PROGRESS.md` (status line)
- Throwaway: `.superpowers/sdd/2026-09-28-tony-scraponi-inbox/inbox-check.mjs`

**Interfaces:**
- Consumes (Task 3): everything listed under Task 3's "Produces".
- Produces:
  - `components/InboxControls.tsx`: `readToken(): string | null`, `writeToken(token: string): void`, `clearToken(): void`, `InboxItemActions({ status, disabled, onDecide })`, `InboxOwnerBar({ signedIn, error, onSignIn, onSignOut })`
  - DOM hooks for checks: status tags `.inbox-status.inbox-approved|inbox-rejected|inbox-waiting`, per-item `.inbox-actions`, owner bar `.inbox-owner`, token input `.inbox-token`, errors `.inbox-error`.

- [ ] **Step 1: Create `components/InboxControls.tsx`**

```tsx
"use client";

import { type FormEvent, useState } from "react";
import type { Decision, ItemStatus } from "@/lib/inbox";

const TOKEN_KEY = "tony-inbox-token";

/* localStorage can throw (blocked site data, some private modes); any
   failure just means public mode. */

export function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Not persisted: owner mode lasts for this page view only.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

export function InboxItemActions({
  status,
  disabled,
  onDecide,
}: {
  status: ItemStatus;
  disabled: boolean;
  onDecide: (decision: Decision | null) => void;
}) {
  return (
    <div className="inbox-actions">
      {status === "waiting" ? (
        <>
          <button
            type="button"
            className="inbox-button"
            disabled={disabled}
            onClick={() => onDecide("approve")}
          >
            approve
          </button>
          <button
            type="button"
            className="inbox-button"
            disabled={disabled}
            onClick={() => onDecide("reject")}
          >
            reject
          </button>
        </>
      ) : (
        <button
          type="button"
          className="inbox-button"
          disabled={disabled}
          onClick={() => onDecide(null)}
        >
          undo
        </button>
      )}
    </div>
  );
}

export function InboxOwnerBar({
  signedIn,
  error,
  onSignIn,
  onSignOut,
}: {
  signedIn: boolean;
  error: string | null;
  onSignIn: (token: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = draft.trim();
    if (!candidate) return;
    setChecking(true);
    await onSignIn(candidate);
    setChecking(false);
    setDraft("");
  }

  return (
    <div className="inbox-owner">
      {signedIn ? (
        <>
          <p className="inbox-note">
            approved items go out with the next digest; the agent picks up
            decisions on its run every 4 hours.
          </p>
          <button type="button" className="inbox-button" onClick={onSignOut}>
            sign out
          </button>
        </>
      ) : open ? (
        <form className="inbox-token-form" onSubmit={submit}>
          <input
            type="password"
            className="inbox-token"
            aria-label="GitHub token for hpnssflw/tony-inbox"
            placeholder="github token"
            autoComplete="off"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="inbox-button" disabled={checking}>
            {checking ? "checking" : "save"}
          </button>
        </form>
      ) : (
        <button type="button" className="inbox-button" onClick={() => setOpen(true)}>
          owner
        </button>
      )}
      {error && <p className="inbox-error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `components/PendingQueue.tsx`**

State is only set inside async callbacks and event handlers (never synchronously in the effect body), and the stored token is read in the effect, not during render, so the static export's prerendered HTML and the first client render match.

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  type PendingItem,
  type PendingQueue as PendingQueueData,
  PENDING_URL,
  groupByTopic,
  isPendingQueue,
} from "@/lib/pending-queue";
import {
  type Decision,
  type Decisions,
  type OwnerSnapshot,
  DECISIONS_PATH,
  DECISIONS_REPO,
  commitMessage,
  fetchOwnerDecisions,
  fetchPublicDecisions,
  itemStatus,
  pruneDecisions,
  serializeDecisions,
  setDecision,
} from "@/lib/inbox";
import { GitHubAuthError, GitHubConflictError, putFile } from "@/lib/github-contents";
import {
  InboxItemActions,
  InboxOwnerBar,
  clearToken,
  readToken,
  writeToken,
} from "@/components/InboxControls";

function Unavailable() {
  return <p className="agent-unavailable mono">queue unavailable</p>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "something went wrong";
}

export default function PendingQueue() {
  const [queue, setQueue] = useState<PendingQueueData | null>(null);
  const [failed, setFailed] = useState(false);
  const [publicDecisions, setPublicDecisions] = useState<Decisions | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [owner, setOwner] = useState<OwnerSnapshot | null>(null);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(PENDING_URL, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`pending fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        if (isPendingQueue(data)) setQueue(data);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    fetchPublicDecisions().then((decisions) => {
      if (!cancelled) setPublicDecisions(decisions);
    });

    const stored = readToken();
    if (stored) {
      fetchOwnerDecisions(stored)
        .then((snapshot) => {
          if (cancelled) return;
          setToken(stored);
          setOwner(snapshot);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (err instanceof GitHubAuthError) {
            clearToken();
            setOwnerError("token rejected — signed out");
          } else {
            setToken(stored);
            setOwnerError(errorMessage(err));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn(candidate: string) {
    setOwnerError(null);
    try {
      const snapshot = await fetchOwnerDecisions(candidate);
      writeToken(candidate);
      setToken(candidate);
      setOwner(snapshot);
    } catch (err) {
      setOwnerError(err instanceof GitHubAuthError ? "token rejected — not saved" : errorMessage(err));
    }
  }

  function signOut() {
    clearToken();
    setToken(null);
    setOwner(null);
    setOwnerError(null);
  }

  async function decide(item: PendingItem, decision: Decision | null) {
    if (!token || !owner || !queue) return;
    const liveUrls = queue.items.map((i) => i.url);
    const apply = (base: Decisions) =>
      pruneDecisions(setDecision(base, item.url, decision, new Date()), liveUrls);
    const message = commitMessage(decision ?? "undo", item.title);
    const previous = owner;
    const optimistic = apply(previous.decisions);

    setBusyUrl(item.url);
    setOwnerError(null);
    setOwner({ decisions: optimistic, sha: previous.sha });
    try {
      try {
        const { sha } = await putFile(
          DECISIONS_REPO,
          DECISIONS_PATH,
          serializeDecisions(optimistic),
          previous.sha,
          message,
          token,
        );
        setOwner({ decisions: optimistic, sha });
      } catch (err) {
        if (!(err instanceof GitHubConflictError)) throw err;
        // Stale sha (e.g. another tab wrote first): re-read, re-apply, retry once.
        const fresh = await fetchOwnerDecisions(token);
        const retried = apply(fresh.decisions);
        const { sha } = await putFile(
          DECISIONS_REPO,
          DECISIONS_PATH,
          serializeDecisions(retried),
          fresh.sha,
          message,
          token,
        );
        setOwner({ decisions: retried, sha });
      }
    } catch (err) {
      if (err instanceof GitHubAuthError) {
        clearToken();
        setToken(null);
        setOwner(null);
        setOwnerError("token rejected — signed out");
      } else {
        setOwner(previous);
        setOwnerError(errorMessage(err));
      }
    } finally {
      setBusyUrl(null);
    }
  }

  if (failed) return <Unavailable />;
  if (!queue) return null;

  const decisions = owner?.decisions ?? publicDecisions;
  const lastSent = queue.last_email_at
    ? new Date(queue.last_email_at).toLocaleDateString()
    : "never";
  const grouped = groupByTopic(queue);

  return (
    <div id="pending-queue">
      <p className="agent-muted mono">
        {queue.items.length} queued · last sent {lastSent}
      </p>
      {queue.items.length === 0 ? (
        <p className="agent-muted">nothing queued right now</p>
      ) : (
        Object.entries(grouped).map(([topicName, items]) => (
          <div key={topicName}>
            <h2 className="section-label">{topicName}</h2>
            <ul className="feed">
              {items.map((item) => {
                const status = itemStatus(decisions, item.url);
                return (
                  <li key={item.url}>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <span className="meta">
                        <span className="mono date">
                          {new Date(item.pending_since).toLocaleDateString()}
                        </span>
                        <span className="mono sep">·</span>
                        <span className="mono tag">{item.source}</span>
                        <span className="mono sep">·</span>
                        <span className="mono tag">score {item.score}</span>
                        {decisions && (
                          <>
                            <span className="mono sep">·</span>
                            <span className={`mono tag inbox-status inbox-${status}`}>
                              {status}
                            </span>
                          </>
                        )}
                      </span>
                      <span className="title">{item.title}</span>
                      <span className="excerpt">{item.summary}</span>
                    </a>
                    {token && (
                      <InboxItemActions
                        status={status}
                        disabled={owner === null || busyUrl !== null}
                        onDecide={(d) => void decide(item, d)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
      <InboxOwnerBar
        signedIn={token !== null}
        error={ownerError}
        onSignIn={signIn}
        onSignOut={signOut}
      />
    </div>
  );
}
```

- [ ] **Step 3: Update the page copy in `app/researcher/queue/page.tsx`**

Replace both occurrences of the metadata description string
`"What the research agent has ranked and is holding for the next Telegram digest."`
with
`"What the research agent has ranked and is holding for review and the next Telegram digest."`

Replace the subtitle text:

```tsx
          Everything the agent has ranked above threshold, grouped by topic,
          waiting for the next Telegram digest to go out.
```

with:

```tsx
          Everything the agent has ranked above threshold, grouped by topic.
          Only what I approve goes out in the next Telegram digest.
```

- [ ] **Step 4: Append the Inbox styles to the end of `app/globals.css`**

```css

/* --- Inbox (researcher/queue) --------------------------------------
   Statuses reuse the agent widget's lime/red palette break (see its
   comment above): approved = lime, rejected = red, waiting keeps the
   default muted .tag. Buttons follow .now-play: bare mono uppercase
   text, no chrome. Owner-mode prose stays lowercase per the case
   system; buttons are chrome, so UPPERCASE. */

.inbox-approved {
  color: var(--agent-lime);
}

.inbox-rejected {
  color: var(--agent-red);
}

.inbox-actions {
  display: flex;
  gap: 20px;
  margin-top: 12px;
}

.inbox-button {
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text);
  padding: 4px 0;
  background: none;
  border: 0;
  cursor: pointer;
  transition: color 0.25s ease;
}

.inbox-button:hover,
.inbox-button:focus-visible {
  color: var(--text-strong);
}

.inbox-button:focus-visible {
  outline: 1px solid var(--muted);
  outline-offset: 4px;
}

.inbox-button:disabled {
  color: var(--muted);
  cursor: default;
}

.inbox-owner {
  margin-top: 48px;
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  color: var(--muted);
}

.inbox-note,
.inbox-error {
  margin: 0 0 8px;
  line-height: 1.8;
  text-transform: lowercase;
}

.inbox-error {
  color: var(--agent-red);
  margin-top: 8px;
}

.inbox-token-form {
  display: flex;
  gap: 12px;
  align-items: center;
}

.inbox-token {
  flex: 1;
  min-width: 0;
  max-width: 360px;
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  color: var(--text);
  background: var(--agent-bg);
  border: 1px solid var(--agent-border);
  border-radius: 4px;
  padding: 8px 10px;
}

.inbox-token:focus-visible {
  outline: 1px solid var(--muted);
  outline-offset: 2px;
}
```

- [ ] **Step 5: Tests, lint, build**

Run: `npm test`
Expected: `Test Files  10 passed (10)`.

Run: `npx eslint components lib app`
Expected: no output.

Run: `npm run build`
Expected: build succeeds; `/researcher/queue` is among the exported routes.

- [ ] **Step 6: Browser checks against the static export**

Run `npm run serve` (in the background) and read the port from its output (3000 is often taken; see the memory note on headless checks). `tony-inbox` doesn't exist yet, so the public decisions fetch 404s — that is the path under test here; the real-repo owner flow is checked in Task 5.

Copy the CDP harness from `C:\A\polozov\.superpowers\sdd\2026-09-28-now-page\now-check.mjs` (headless Chrome on port 9333, `send`/`evaluate` helpers) to `.superpowers/sdd/2026-09-28-tony-scraponi-inbox/inbox-check.mjs` and replace its checks with the ones below, run with `node --experimental-websocket inbox-check.mjs <baseUrl> .superpowers/sdd/2026-09-28-tony-scraponi-inbox`. Each check navigates to `<baseUrl>/researcher/queue/`, waits until `#pending-queue` exists, then asserts via `Runtime.evaluate`:

1. **Public, decisions unavailable:** `document.querySelectorAll('#pending-queue .feed li').length` equals the live `pending.json` item count (fetch `https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/pending.json` in the script to compare); `.inbox-status` count is 0; `.inbox-actions` count is 0; a `.inbox-owner button` with text `owner` exists.
2. **Public, decisions available (intercepted):** before navigating, `Fetch.enable({ patterns: [{ urlPattern: "*tony-inbox*decisions.json*" }] })` and answer `Fetch.requestPaused` with `Fetch.fulfillRequest` (status 200, base64 body of `{"version":1,"decisions":{"<url of first li>":{"decision":"approve","at":"2026-09-28T00:00:00Z"},"<url of second li>":{"decision":"reject","at":"2026-09-28T00:00:00Z"}}}` — take the two URLs from check 1). Expect exactly one `.inbox-approved`, one `.inbox-rejected`, the rest `.inbox-waiting`; the first two render their text uppercase (`getComputedStyle(el).textTransform === "uppercase"`) and `.inbox-approved`'s computed color is `rgb(124, 252, 0)`. `Fetch.disable` afterwards.
3. **Bad token at sign-in:** click the `owner` button, set `.inbox-token`'s value to `github_pat_invalid` via the native value setter + an `input` event, submit the form, wait up to 10s for `.inbox-error`. Expect its text `token rejected — not saved`, `localStorage.getItem("tony-inbox-token") === null`, no `.inbox-actions`.
4. **Stale stored token:** `localStorage.setItem("tony-inbox-token", "github_pat_invalid")`, reload, wait for `.inbox-error`. Expect `token rejected — signed out`, `localStorage.getItem("tony-inbox-token") === null`, no `.inbox-actions`.
5. **Mobile:** `Emulation.setDeviceMetricsOverride({ width: 375, height: 800, deviceScaleFactor: 2, mobile: true })`, open the token form, expect `document.documentElement.scrollWidth <= 375`; save a screenshot to `.superpowers/sdd/2026-09-28-tony-scraponi-inbox/queue-375.png` and look at it.

Expected: all five pass. Stop `serve` and headless Chrome afterwards.

- [ ] **Step 7: Update the status line and commit**

In `PROGRESS.md`'s sub-project #5 bullet, replace three lines:
- `Task 3 of 5 done.` → `Task 4 of 5 done.`
- the `Latest:` line → `Latest: Task 4 added statuses and owner mode (approve/reject/undo) to /researcher/queue/ — checked headlessly against the static export, before tony-inbox exists.`
- the `Next:` line → `Next: Task 5 (create tony-inbox, PAT, merge, push, live check).`

```bash
git add components/InboxControls.tsx components/PendingQueue.tsx app/researcher/queue/page.tsx app/globals.css PROGRESS.md
git commit -m "Add inbox statuses and owner-mode moderation to the queue page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rollout — create `tony-inbox`, owner check, docs, merge, push, live check

**Files:**
- Modify: `CLAUDE.md` (new convention bullet)
- Modify: `PROGRESS.md` (shipped status, "How to resume")
- External: new GitHub repo `hpnssflw/tony-inbox`; push to `hpnssflw/hpnssflw.github.io` `main`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: the live feature.

- [ ] **Step 1: Create the decisions repo (confirm with Artem first — outward action)**

Ask Artem to confirm creating the public repo `hpnssflw/tony-inbox`. Then:

```bash
gh repo create hpnssflw/tony-inbox --public --description "Approve/reject decisions for the research agent's queue, written by hpnssflw.github.io/researcher/queue/"
printf '{\n  "version": 1,\n  "decisions": {}\n}\n' > .superpowers/sdd/2026-09-28-tony-scraponi-inbox/decisions.json
gh api -X PUT repos/hpnssflw/tony-inbox/contents/decisions.json \
  -f message="Initial empty decisions file" \
  -f content="$(base64 -w0 .superpowers/sdd/2026-09-28-tony-scraponi-inbox/decisions.json)"
gh api repos/hpnssflw/tony-inbox --jq .default_branch
curl -s https://raw.githubusercontent.com/hpnssflw/tony-inbox/main/decisions.json
```

Expected: default branch `main` (if it's anything else, stop and ask Artem — `DECISIONS_RAW_URL` assumes `main`); the curl prints the empty decisions file.

Then confirm the agent reads it live:

```bash
py -3 -c "from pathlib import Path; from agent import config, inbox; s = config.load_settings(Path('agent/defaults.yaml')); print(inbox.load_decisions(s.inbox.decisions_url, None))"
```

Expected: `{}`.

- [ ] **Step 2: Artem creates the PAT (manual — Claude cannot do this)**

Give Artem these exact settings, and ask him to keep the token to himself (enter it only on the page, never paste it into the chat):

- https://github.com/settings/personal-access-tokens/new
- Token name: `tony-inbox owner mode`
- Resource owner: `hpnssflw`
- Expiration: his choice
- Repository access: **Only select repositories** → `hpnssflw/tony-inbox`
- Repository permissions: **Contents → Read and write** (Metadata → Read-only is added automatically). Nothing else.

- [ ] **Step 3: Owner-mode check against the real repo (local build)**

`npm run build`, then `npm run serve`; Artem opens `http://localhost:<port>/researcher/queue/` in his own browser, clicks `owner`, saves the token. Ask him to make **real** decisions (they take effect on the live agent after Step 7): approve one item, reject another, and approve-then-undo a third. Then verify:

```bash
gh api repos/hpnssflw/tony-inbox/commits --jq '.[].commit.message'
gh api repos/hpnssflw/tony-inbox/contents/decisions.json --jq .content | base64 -d
```

Expected: four commits from his clicks above `Initial empty decisions file` — listed newest first: `undo: …`, `approve: …`, `reject: …`, `approve: …` (order depends on how he clicked) — and the file holds exactly the approved and rejected entries, nothing for the undone item.

Conflict path: while Artem stays on the page, make an out-of-band commit that keeps the content but changes the sha:

```bash
SHA=$(gh api repos/hpnssflw/tony-inbox/contents/decisions.json --jq .sha)
gh api repos/hpnssflw/tony-inbox/contents/decisions.json --jq .content | base64 -d > .superpowers/sdd/2026-09-28-tony-scraponi-inbox/current.json
printf '\n' >> .superpowers/sdd/2026-09-28-tony-scraponi-inbox/current.json
gh api -X PUT repos/hpnssflw/tony-inbox/contents/decisions.json -f message="Conflict test" -f sha="$SHA" \
  -f content="$(base64 -w0 .superpowers/sdd/2026-09-28-tony-scraponi-inbox/current.json)"
```

Ask Artem to click one more decision without reloading. Expected: it succeeds with no error shown (409 → re-read → retry), and the file afterwards contains all his decisions. Then confirm the agent parses the real file:

```bash
py -3 -c "from pathlib import Path; from agent import config, inbox; s = config.load_settings(Path('agent/defaults.yaml')); print(inbox.load_decisions(s.inbox.decisions_url, None))"
```

Expected: a dict with his decisions.

- [ ] **Step 4: Docs — `CLAUDE.md` and `PROGRESS.md`**

In `CLAUDE.md`, "Conventions actually used in this repo", after the `/now/` presence-data bullet, add:

```markdown
- **The Tony Scraponi inbox's decisions live in a separate public repo,
  `hpnssflw/tony-inbox`** (`decisions.json` on its `main`). The site's
  `/researcher/queue/` owner mode is its only writer, with a
  fine-grained PAT scoped to that repo alone and kept in the owner's
  `localStorage`; the agent only reads it at the start of each run and
  delivers approved items only (rejected/expired → `dismissed` in
  `state.json`). Never make the agent write `decisions.json`, and never
  give the site a token for this repo.
```

In `PROGRESS.md`'s sub-project #5 bullet, replace three lines:
- `Task 4 of 5 done.` → `Task 5 in progress.`
- the `Latest:` line → `Latest: hpnssflw/tony-inbox created; owner mode verified locally against it (approve/reject/undo, conflict retry).`
- the `Next:` line → `Next: Task 5 Steps 5–8 (merge main, push, live check).`

```bash
git add CLAUDE.md PROGRESS.md
git commit -m "Document the tony-inbox decisions repo convention

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Bring in `main` and re-verify**

```bash
git merge main
```

Resolve any conflict (most likely `PROGRESS.md`: keep both sides' entries). Then:

Run: `npm test` — Expected: all files pass, 0 failures.
Run: `npm run build` — Expected: success.
Run: `py -3 - < .superpowers/sdd/2026-09-28-tony-scraponi-inbox/task1-check.py` and `... task2-check.py` — Expected: `OK` twice.

- [ ] **Step 6: Push to `main` (confirm with Artem first — deploys the site and changes live agent behavior)**

```bash
git push origin HEAD:main
gh run list --workflow deploy.yml --limit 1
```

Expected: the push fast-forwards `origin/main` (if it's rejected as non-fast-forward, `git fetch origin && git merge origin/main`, re-run Step 5's checks, push again); the Deploy site run completes with `success` (`gh run watch <id>`).

- [ ] **Step 7: Live check**

1. Open https://hpnssflw.github.io/researcher/queue/ (headless check, or Artem in his browser): items show `APPROVED`/`REJECTED`/`WAITING` tags matching `decisions.json` (raw cache may lag ~5 min). Artem signs in once more on the live origin (localStorage is per-origin).
2. Trigger the agent: `gh workflow run agent-run.yml`, then `gh run watch <id>` → `success`.
3. Verify on `agent-data`:

```bash
gh api "repos/hpnssflw/hpnssflw.github.io/contents/agent/pending.json?ref=agent-data" --jq .content | base64 -d > .superpowers/sdd/2026-09-28-tony-scraponi-inbox/live-pending.json
gh api "repos/hpnssflw/hpnssflw.github.io/contents/agent/state.json?ref=agent-data" --jq .content | base64 -d > .superpowers/sdd/2026-09-28-tony-scraponi-inbox/live-state.json
py -3 - <<'PY'
import json
from pathlib import Path
from agent import config, dedupe, inbox

d = Path(".superpowers/sdd/2026-09-28-tony-scraponi-inbox")
pending = json.loads((d / "live-pending.json").read_text(encoding="utf-8"))
state = json.loads((d / "live-state.json").read_text(encoding="utf-8"))
settings = config.load_settings(Path("agent/defaults.yaml"))
decisions = inbox.load_decisions(settings.inbox.decisions_url, None)
queued = {i["url"] for i in pending["items"]}
print("last_email_at:", pending["last_email_at"], "| queued:", len(queued))
for url, decision in decisions.items():
    entry = state.get(dedupe.url_hash(url), {})
    print(
        decision,
        "| queued" if url in queued else "| not queued",
        "| times_sent", entry.get("times_sent"),
        "| dismissed", entry.get("dismissed"),
        "|", url,
    )
PY
```

Expected: every `reject` line reads `not queued` and `dismissed rejected`. Every `approve` line is either `not queued`, `times_sent 1`, with `last_email_at` at this run (delivered — Artem confirms it in the `@hypnosisflow` channel), or `queued`, `times_sent 0` (held because the 24h cadence wasn't due yet). Say which one happened. (`decisions.json` still lists these entries because the site prunes only when it writes.)

- [ ] **Step 8: Mark shipped and hand off**

In `PROGRESS.md`: section status `**Status: sub-projects #1-#5 shipped.**`; sub-project #5 bullet → `**Sub-project #5, Inbox (moderated delivery): shipped.**` with a sentence on the live check result (which items, delivered or held); "How to resume" → replace the in-progress sentence with `Sub-project #5 (Inbox) is shipped; there's no confirmed next step for this initiative — candidates: a Telegram DM when items await review, summary editing, topic/source management.`

```bash
git add PROGRESS.md
git commit -m "Reconcile status docs with the inbox shipping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

Tell Artem: the main checkout at `C:\A\polozov` is now behind `origin/main` — run `git pull --ff-only` there. Remove the worktree (`ExitWorktree` with `remove`) only when he asks.
