# Tony Scraponi Inbox — Moderated Delivery — Design

Sub-project #5 of the Content Direction & Tony Scraponi initiative (see
`docs/tony-scraponi-roadmap.md` and `PROGRESS.md`). Sub-projects #1–#4 are
done; #4 shipped `/researcher/queue/`, a read-only view of the agent's
pending delivery queue. This sub-project is the first control-plane
feature on top of it: the Obsidian plan's "manual approval inbox"
(`Obsidian Vault/tony scraponi/personal-data-collection-agent-plan.md`,
Phase 1), built inside this repo on the existing static-site + JSON files
+ GitHub Actions pattern — no backend.

## Problem

The agent ranks items every 4 hours and sends everything above threshold
to the `@hypnosisflow` Telegram channel on a 24h digest cadence. Nothing
a human decides sits between "DeepSeek scored it ≥ 6" and "it's in the
channel". The queue page shows what's about to go out, but can't stop
any of it.

## Goal

Artem approves or rejects each queued item from `/researcher/queue/`.
Only approved items are delivered. The page stays public and read-only
for everyone else, now with each item's status visible.

## Decisions (settled during brainstorming, 2026-09-28)

- **Moderation happens on the site**, not in Telegram or the local
  panel.
- **Undecided items wait.** Only approved items are ever delivered.
  Undecided items stay queued until `expire_days` (default 7) and are
  then dropped. If Artem doesn't moderate, the channel goes quiet —
  accepted.
- **Approved items go out with the next regular digest** (24h cadence,
  unchanged). No "send now".
- **Actions: approve, reject, undo** (undo clears a decision on an
  item that hasn't been delivered yet). No summary editing — that's a
  later Composer sub-project.
- **Decisions live in a separate public repo, `hpnssflw/tony-inbox`**,
  written by the site with a fine-grained PAT scoped to that repo only.
  Rejected alternatives: a decisions file on `agent-data` (the PAT
  would need `Contents: write` on the site repo, which can push to
  `main` and so change agent code that runs in Actions with the
  Telegram/DeepSeek secrets), and `repository_dispatch` per click (same
  token scope problem, plus a workflow run per click).

## Architecture

Two stores, one writer each:

| File | Where | Only writer | Readers |
|---|---|---|---|
| `agent/pending.json`, `agent/state.json` | `agent-data` branch of `hpnssflw/hpnssflw.github.io` | agent workflow | site (pending only) |
| `decisions.json` | default branch of `hpnssflw/tony-inbox` | site (owner mode) | agent, site |

No file has two writers, so the agent's push to `agent-data` and the
site's writes to `tony-inbox` can't race. `agent-run.yml` is unchanged.

### `decisions.json`

```json
{
  "version": 1,
  "decisions": {
    "https://news.ycombinator.com/item?id=123": { "decision": "approve", "at": "2026-09-28T12:00:00Z" },
    "https://github.com/foo/bar": { "decision": "reject", "at": "2026-09-28T12:01:00Z" }
  }
}
```

- Keyed by item URL — the same identity `pending.json` and the dedupe
  state already use.
- `decision` is exactly `"approve"` or `"reject"`. Undo deletes the
  entry.
- A file that fails validation (wrong `version`, non-object
  `decisions`, any entry whose `decision` isn't one of the two values or
  whose `at` isn't a string) is treated as unreadable as a whole — no
  partial application.
- On every write, the site prunes an entry only if its URL is not in the
  `pending.json` the tab has loaded AND its `at` is older than the tab's
  queue-load time minus a 10-minute grace period (covers
  raw.githubusercontent's ~5-min cache and clock skew between devices).
  A stale tab must not delete a decision it can't vouch for — made on
  another tab or device for an item queued after this tab loaded — so
  the file stays bounded by the queue without erasing input it hasn't
  seen.
- Initial content when the repo is created: `{"version": 1, "decisions": {}}`.

## Agent changes (Python)

### New: `agent/inbox.py`

- `load_decisions(url, token) -> dict[str, str]` — `GET` the
  GitHub Contents API URL with `Accept: application/vnd.github.raw+json`
  and, when `token` is set, `Authorization: Bearer <token>` (the
  workflow already exports `GITHUB_TOKEN`; authenticated reads avoid the
  60/h anonymous limit shared across Actions runner IPs). Uses
  `requests`, timeout 15s. Returns `{url: "approve" | "reject"}`; raises
  `DecisionsUnavailable` (message = the reason) on any network error,
  non-200 status, JSON error, or failed validation, so the run log can
  say why.
- `apply_decisions(queue, decisions, state, now, expire_days) ->
  (approved: list[PendingItem], drops: list[tuple[str, Drop]])` — pure,
  mutates `queue` and `state` in place, returns drops paired with their
  topic slug for the event log:
  - item with `reject` → removed from `queue.items`,
    `dedupe.dismiss_url(state, url, "rejected")`, drop reason `rejected`;
  - item with `approve` → kept in the queue, returned in `approved`
    (approved items never expire);
  - undecided item with `pending_since` older than `expire_days` days →
    removed, `dismiss_url(state, url, "expired")`, drop reason `expired`;
  - other undecided items → untouched;
  - decisions for URLs not in the queue → ignored.

### `agent/dedupe.py`

- `StateEntry` gains `dismissed: str | None = None` (`"rejected"` or
  `"expired"`). The default keeps existing `state.json` files loading.
- New `dismiss_url(state, url, reason)`. Like `mark_sent_url`, it
  raises `KeyError` for a URL that `record_seen` never recorded — the
  same "surface pipeline bugs loudly" stance.
- `filter_seen` also drops entries with `dismissed` set, reason
  `dismissed`, detail `{"dismissed": <reason>}`. Without this a rejected
  HN item still inside the recency window gets re-collected, re-ranked
  and put back in the inbox on the next run.
- `Drop.reason`'s value-list comment in `agent/sources/base.py` gains
  `rejected | expired | dismissed`.

### `agent/pending.py`

- The delivery gate takes the approved list instead of looking at the
  whole queue: due when there is at least one approved item and either
  delivery has never happened or `delivery_cadence_hours` have passed
  since `last_email_at`. No approved items → not due, and
  `last_email_at` is untouched.

### `agent/config.py`, `agent/defaults.yaml`

```yaml
inbox:
  decisions_url: https://api.github.com/repos/hpnssflw/tony-inbox/contents/decisions.json
  expire_days: 7
```

Loaded into a new `InboxConfig` on the settings object.

### `agent/main.py` — `run_real`

1. After loading the queue: `decisions = inbox.load_decisions(...)`.
   - `DecisionsUnavailable` → emit `("inbox", "failed")` with the error detail, set
     `approved = []`, and skip `apply_decisions` entirely: nothing is
     rejected, expired or delivered this run.
   - Otherwise `apply_decisions`, emitting each drop with
     `writer.emit_drop("inbox", topic, drop)`.
2. Collection and ranking are unchanged; new items enter the queue
   undecided.
3. Delivery: if due (per the new gate), group **only the approved
   items**, build and send. On success: `mark_sent_url` each, remove
   exactly those items from `queue.items`, set `last_email_at`. On
   failure: nothing changes; retried next run, as today.
4. `run_dry` is unchanged.

`status.json`'s schema is unchanged. `status_export` already lists drop
events with their `reason` in `recent_events` (no `stage` field), so
`rejected`/`expired` show up in the dashboard ticker; the funnel counts
only read `date_guard` and `dedupe` drops, so `inbox` drops don't skew
them. `dismissed` drops are counted under `dedupe`, which is correct —
they aren't new.

## Site changes

### `/researcher/queue/` — one page, two modes

**Public (everyone):** fetches `pending.json` (as today) and
`https://raw.githubusercontent.com/hpnssflw/tony-inbox/main/decisions.json`
in parallel. Each item shows a status: `approved`, `waiting`, or
`rejected` (visible until the next agent run removes it). If
`decisions.json` fails to load, the queue still renders, without
statuses. Raw's ~5 min cache is acceptable for public viewing.

**Owner (PAT in `localStorage`):**

- A small `owner` link at the bottom of the page opens a PAT field.
  Saving validates the token with a `GET` of `decisions.json` via the
  Contents API; 401/403 shows an error and nothing is stored. `sign out`
  removes it. `localStorage` access is wrapped in try/catch; failure
  means public mode.
- In owner mode, `decisions.json` is read through the Contents API with
  the token (fresh, plus its `sha`). If that read fails, the owner bar
  shows the error and the buttons are disabled.
- A 401/403 on any later read or write (token expired or revoked)
  removes the stored token, drops back to public mode, and says why.
- Per item: `approve` / `reject`, or `undo` once decided.
- Each click writes immediately: `PUT` the new content (decision
  applied, then pruned against the loaded queue) with the last known
  `sha` and a commit message `approve: <title>` / `reject: <title>` /
  `undo: <title>`, truncated to 72 characters.
- On a `409`/`422` (stale `sha`, e.g. a second tab): re-read, re-apply
  the click, retry once. A second failure shows an error and reverts
  the optimistic UI state.
- A note under the list: approved items go out with the next digest;
  the agent picks decisions up on its 4-hourly run.

### Units

- `lib/inbox.ts` — pure helpers: `Decisions` types, `isDecisions`
  guard, `setDecision(decisions, url, decision | null, now)` (returns a
  new object; `null` = undo), `pruneDecisions(decisions, liveUrls)`,
  `itemStatus(decisions, url)`, `serializeDecisions`, `commitMessage`,
  repo/path/raw-URL constants; plus two thin fetchers —
  `fetchPublicDecisions()` (raw URL, `null` on any failure) and
  `fetchOwnerDecisions(token)` (Contents API, returns decisions + `sha`,
  throws on failure or a malformed file).
- `lib/github-contents.ts` — thin `fetch` wrapper: `getFile(repo, path,
  token) -> { text, sha }` and `putFile(repo, path, text, sha, message,
  token) -> { sha }`, UTF-8-safe base64 (titles carry non-ASCII),
  distinct errors for auth failure (401/403) and conflict (409/422).
- `components/PendingQueue.tsx` — extended with statuses and the
  owner-mode wiring.
- `components/InboxControls.tsx` — per-item buttons and the owner
  bar/token form.
- `app/globals.css` — status and button styles on existing tokens.

### Security

- Leaked token blast radius: approve/reject on `tony-inbox` — items that
  are already public and already passed the relevance threshold.
- React escapes everything rendered; no `dangerouslySetInnerHTML`.
- The token is sent only to `api.github.com`.

## Error handling summary

| Failure | Result |
|---|---|
| Agent can't read or validate `decisions.json` | `inbox/failed` event; nothing rejected, expired, or delivered this run |
| Telegram send fails | nothing changes; retried next run (as today) |
| Public page can't load `decisions.json` | queue renders without statuses |
| Owner-mode read fails (non-auth) | error in owner bar; buttons disabled |
| Owner write conflict | one re-read + retry, then error + revert |
| PAT rejected when entered | error; token not stored |
| PAT rejected later (401/403) | token removed; back to public mode with a message |

## Testing

- **Agent** — no pytest in `agent/` and no new dependency. Synthetic
  no-network checks in the plan's verification steps, as in earlier
  agent plans: approve, reject, undo (entry absent), expiry, approved
  items not expiring, `load_decisions` raising `DecisionsUnavailable`
  for a bad payload and the run then delivering and dropping nothing, an old
  `state.json` without `dismissed` loading, a rejected URL re-collected
  and dropped by `filter_seen` as `dismissed`, the delivery gate with 0
  approved items.
- **Site** — Vitest for `lib/inbox.ts` (guard accept/reject paths,
  set/undo, prune, status) and `lib/github-contents.ts` (mocked `fetch`:
  success, 401, 409, UTF-8 round-trip). `npm run build` + `npm run
  serve` for both modes.
- **Live** — after deploy: approve one item and reject another on the
  real page, trigger `agent-run.yml` by `workflow_dispatch`, confirm on
  `agent-data` that the rejected item left `pending.json` and is
  `dismissed` in `state.json`, and that the approved item is either
  delivered (if the 24h cadence was due) or still queued with status
  `approved`.

## Rollout

1. Create `hpnssflw/tony-inbox` (public) with the initial
   `decisions.json` — `gh repo create`, confirmed with Artem first.
2. Implement on the `worktree-tony-scraponi` branch.
3. Merge agent and site changes into `main` together and push once: the
   site deploys immediately, the agent switches on its next run. The
   items currently queued become undecided and wait.
4. Artem creates the PAT in GitHub's UI (fine-grained, repository access
   only `hpnssflw/tony-inbox`, `Contents: Read and write`, expiry his
   choice) and enters it on the page.
5. Live check (above).

## Docs

- `PROGRESS.md` — sub-project #5 section and "How to resume".
- `docs/tony-scraponi-roadmap.md` — add #5.
- `docs/agent-plan.md` and `app/researcher/agent/page.tsx` — delivery
  now requires approval (the `CLAUDE.md` sync rule).
- `CLAUDE.md` — a bullet on `tony-inbox`: the site is the only writer
  of `decisions.json`, the agent only reads it, and the PAT is scoped
  to that repo alone.

## Out of scope

Summary editing (Composer), "send now", a Telegram DM when items are
waiting for review (likely the most useful follow-up — without it the
channel can go quiet unnoticed), topic/source management, new source
types, X publishing, an `approved_count` in `status.json`.
