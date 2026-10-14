# Telegram Approval (sub-project C) — Design

The content engine's sub-project C (`docs/tony-scraponi-roadmap.md`,
"Content engine (sub-projects A–D)"), designed after A, D and B shipped.
It builds on A (`docs/superpowers/specs/2026-10-06-content-engine-core-design.md`,
the approval and delivery adapters), on #5's inbox
(`docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md`) and on
D's control room on `run-result.json`
(`docs/superpowers/specs/2026-10-06-preset-switcher-design.md`).

| # | Sub-project | Status |
|---|---|---|
| A | Engine core + presets | shipped 2026-10-06 |
| B | Stories | shipped 2026-10-08 |
| **C** | Telegram approval buttons (this spec) | shipped 2026-10-14 |
| D | Preset switcher + demo section | shipped 2026-10-07 |

The roadmap's C also named "several delivery targets per preset". Artem
deferred that on 2026-10-08: there's no second target to deliver to yet.
It becomes its own later sub-project.

## Problem

Tony's moderation has stalled. #6's watch (2026-10-05..08) queued 30
items, 10 a day at most, and none of them was approved or rejected; the
last digest went out on 2026-09-30. Approving takes opening
`/researcher/queue/` and signing in to owner mode, and nothing tells
Artem that items are waiting. Undecided items expire after 7 days, so
good items are lost.

## Goal

The bot sends Artem each new queue item in a private chat, with Approve
and Reject buttons. The agent picks up his taps on its next run and
applies them like the site's decisions. Owner mode on the site keeps
working, and the control room shows decisions from both places.

## Decisions

Settled with Artem, 2026-10-08:

- **Private chat, one message per item.** Each new queue item is a
  message from the bot in Artem's private chat with it. The public
  channel `@hypnosisflow` is unchanged and only ever gets the digest.
- **Polling, no new infrastructure.** The agent reads taps through the
  Bot API's `getUpdates` at the start of each real run. A tap shows no
  reaction right away: its message updates on the next run, up to 4 h
  later (longer when GitHub skips cron slots). A webhook (a Cloudflare
  Worker) would answer at once but adds a service holding the bot token
  and a `tony-inbox` token; a separate fast-polling workflow would race
  `agent-run.yml` for `agent-data`. Both rejected.
- **Both sources.** Owner mode on the site still writes `decisions.json`
  in `hpnssflw/tony-inbox`. Taps go to the agent's own file on
  `agent-data`. Per item, the latest action wins.
- **The agent never writes `decisions.json`.** Writing it would put a
  `tony-inbox` token next to the Telegram and DeepSeek secrets, which
  `CLAUDE.md` forbids. The site gets no new token either.
- **Delivery targets are out of scope** (see above).

## Preset

`approval` gains an optional `telegram` block. Everything else in the
section, and `decisions.json` v1, stay as they are:

```yaml
approval:
  type: inbox
  decisions_url: https://api.github.com/repos/hpnssflw/tony-inbox/contents/decisions.json
  token_env: GITHUB_TOKEN
  expire_days: 7
  telegram:
    bot_token_env: TELEGRAM_BOT_TOKEN
    owner_chat_env: TELEGRAM_OWNER_CHAT_ID # Artem's private chat with the bot
    max_asks_per_run: 10
```

- All three keys are required inside the block; `max_asks_per_run` is an
  integer ≥ 1. An unknown key is a `PresetError`, like everywhere else in
  `agent/preset.py`.
- The block works with either approval `type` (`inbox` or `file`).
  `--offline` refuses a preset that has it (`preset.require_offline`):
  the demos stay on files.
- `--preview` and `--dry-run` never touch Telegram.
- The owner's chat id lives only in the environment (a repo secret in
  CI). It never appears in any file the agent writes: `run-result.json`
  names the variable, as it does for the other secrets.

Tony's preset gets the block. The demos don't.

## Data: `<data-dir>/telegram.json`

The agent's own record of the Telegram side, written by real runs only
and published to `agent-data` with `state.json`:

```json
{
  "version": 1,
  "offset": 912345678,
  "decisions": {
    "https://example.com/a": { "decision": "approve", "at": "2026-10-09T08:00:12+00:00" }
  },
  "messages": {
    "https://example.com/a": { "message_id": 42, "shown": "approved" }
  }
}
```

- `offset` — the next `getUpdates` offset (last handled `update_id` + 1),
  or `0` before the first poll.
- `decisions` — the latest tap per URL: `approve`, `reject` or `clear`
  (Undo), and `at`, when the agent picked the tap up (the run's `now`;
  the Bot API gives callback queries no timestamp).
- `messages` — per queue item that has a message: its `message_id` and
  `shown`, the status its text and buttons last showed (`waiting`,
  `approved`, `sent`, `rejected`, `expired`), or `gone` once Telegram
  said the message no longer exists (no more edits, and the item isn't
  asked again).
- Everything in it is public on `agent-data` already (item URLs) or
  harmless without the bot token (message ids, the update offset). No
  chat id, user id, name or token.
- A missing file reads as empty. A malformed one makes the Telegram side
  unavailable (see Failures).
- Entries for URLs that are no longer in the queue are removed once their
  final message edit has been tried.

`agent/paths.py` gains `DataPaths.telegram`.

## The run

`engine.run_real` gains three steps. Everything below happens only when
the preset has `approval.telegram`.

### 1. Collect taps (before review)

- `getUpdates` with `offset` from `telegram.json`, `timeout: 0` and
  `allowed_updates: ["callback_query"]`; handled in `update_id` order.
- A callback counts only if `from.id` and `message.chat.id` both equal
  the owner chat id. Anything else (other users, other chats, messages,
  stale update types) is skipped, but still advances the offset.
- `callback_data` is `a:<url_hash>`, `r:<url_hash>` or `u:<url_hash>`
  (approve, reject, undo → `clear`), with `url_hash` from
  `agent/dedupe.py` (16 hex chars; the whole string fits Telegram's
  64-byte limit). The hash is looked up among the current queue items'
  URLs; an unknown hash (the item has left the queue) is skipped.
- Each counted tap sets `decisions[url] = {decision, at: now}`; several
  taps on one item in one batch → the last one wins.
- The new `offset` is saved with `telegram.json` at the end of the run.
  Telegram drops updates only once a later `getUpdates` passes a higher
  offset, so if the run or its `agent-data` push fails, the next run
  reads the same taps again. Applying them twice gives the same result.
- `answerCallbackQuery` isn't called: by the next run the query is too
  old to answer. The client's progress indicator on the button just
  times out.

### 2. Merge with the site's decisions

`approval.merge_decisions(site, telegram)` — one pure function, mirrored
on the site:

- For each URL, take the site's entry (`approve`/`reject`, with its
  `at`) and Telegram's (`approve`/`reject`/`clear`, with its `at`), and
  keep the one with the later `at` (parsed as datetimes; a tie goes to
  the site). `clear` means undecided.
- The result is the `{url: "approve" | "reject"}` map that
  `inbox.apply_decisions` already takes; that function doesn't change.
- If either source is unavailable, decisions are unavailable as a whole:
  `DecisionsUnavailable`, nothing is dropped or delivered this run, as
  today. Applying only one source could deliver an item rejected in the
  other.
- `run-result.json`'s `queue.items[].decision` carries the merged
  decision.

Known limit: within one run's window, a tap counts as made when the
agent sees it. An item approved in Telegram and then rejected on the
site before the next run ends up approved. That needs both places used
on the same item inside a few hours. It's documented, not fixed.

After `apply_decisions`, Telegram decisions for URLs that left the queue
are removed from `telegram.json`.

### 3. Ask and update (after the queue is final)

After delivery (so `sent` is known) and before saving:

- **Ask.** Queue items without a `messages` entry get a message, newest
  `pending_since` first, at most `max_asks_per_run` per run. When C
  ships, the existing backlog (~64 items) goes out over several runs;
  older items keep expiring as now. Ask messages are paced like digest
  messages (`INTER_MESSAGE_DELAY_SECONDS`).
- **Message text** (HTML, escaped like the digest), in the preset's
  language:

  ```
  <b>Tooling</b> · 9/10 · hn
  <a href="https://…">Show HN: Offrun – manage every coding agent from one workspace</a>
  One-sentence summary.
  ```

  The title is a link only for http(s) URLs (the site's M4 rule). A story
  queue entry (stories on) shows its opener's title and summary, as the
  queue does.
- **Buttons and status line** by the item's effective status:

  | Status | Appended line (en / ru) | Buttons |
  |---|---|---|
  | `waiting` | — | ✅ Approve · ❌ Reject |
  | `approved` | ✅ Approved — goes out with the next digest / ✅ Одобрено — уйдёт со следующим дайджестом | ↩ Undo |
  | `sent` | 📤 Sent dd.mm / 📤 Отправлено dd.mm | none |
  | `rejected` | ❌ Rejected / ❌ Отклонено | none |
  | `expired` | ⌛ Expired / ⌛ Истекло | none |

  The status comes from the merged decisions, so a site decision shows
  in Telegram too, and Undo in Telegram takes back a site approval. An
  item that left the queue without being sent or rejected (expired, or
  a stale waiting story pruned in a stories preset) shows `expired`.
- **Update.** Every `messages` entry whose status differs from `shown`
  gets `editMessageText` (text + status line + buttons) and its `shown`
  updated. Items that left the queue this run (sent, rejected, expired)
  are rendered from the queue as it was before review, which the engine
  keeps for the run. Their entries are removed after the final edit.
- **When decisions were unavailable** this run (either source failed):
  updates are skipped, since no status is known. If only the site
  failed, taps were still collected and asks still go out, and
  `telegram.json` is saved with the new taps and offset.

## Failures

The Telegram side never fails a run:

| What fails | Effect |
|---|---|
| `getUpdates` (network, HTTP error, 409 because a webhook is set) or a malformed `telegram.json` | `DecisionsUnavailable`: nothing dropped or delivered, as when `decisions.json` can't be read; failure `review` / `telegram`. Asks and updates are skipped this run. `telegram.json` isn't rewritten. |
| Sending an ask | The item gets no `messages` entry and is asked again next run; failure `review` / `telegram`. The other asks still go out. |
| Editing a message | For an item still in the queue, `shown` stays, so the edit is retried next run; failure `review` / `telegram`. A final edit (the item left the queue this run) is tried once: the entry is removed either way, since the next run has no item to render. If Telegram says the message is gone (deleted by Artem), `shown` becomes `gone`. "Message is not modified" counts as success. |
| Ask message ids never saved (failed push to `agent-data`, or a crash in the guarded block) | Those asks are never edited: their buttons stay live, and taps on them still work (matched by URL hash). |
| A tap older than 24 h before a run reads it | Telegram has dropped it. The item stays undecided and its buttons are still there: tap again. |

Failures carry the error type only, never text (the bot token is in the
request URL), as `tally.fail` does today. Bot API calls reuse
`agent/deliver.py`'s 429-retry-once and token-free error messages.

## `run-result.json`

Schema stays 2; only additions:

- `config.approval.telegram`: `{bot_token_env, owner_chat_env,
  max_asks_per_run}` — variable names, no values.
- The `review` stage's notes: `telegram_taps` (counted taps),
  `asked` (messages sent this run).
- `failures[]` with `stage: "review"`, `source: "telegram"`.

`lib/run-result.ts` reads the new keys leniently: an older
`run-result.json` without them still parses.

## Site

- `lib/telegram-decisions.ts` (+ test): a guard for `telegram.json`
  (only `version` and `decisions` are read) and `mergeDecisions(site,
  telegram)`, which mirrors `approval.merge_decisions` and returns the
  existing `Decisions` shape plus which URLs Telegram decided.
- `agent/tests/fixtures/approval-merge.json`: shared cases (site only,
  Telegram only, both with either later, a tie, `clear` over an older
  approval, `clear` with no site entry) that both pytest and Vitest run,
  so the two mirrors can't drift (like `lib/digest.ts` and the demos'
  `outbox.html`).
- `/researcher/queue/` fetches `agent/telegram.json` from `agent-data`
  client-side, next to `pending.json`, and computes each row's status
  from the merged decisions. A missing or malformed file means "no
  Telegram decisions", not an error.
- A row decided in Telegram shows its status with `· telegram`.
  Owner mode can still approve or reject it (a newer site entry wins).
  The site's Undo takes back only the site's own decision. To make a
  Telegram-decided item undecided again, use Undo in Telegram.
- The config spine shows `approval.telegram` when present.
- The demos have no `telegram` block and don't change.

## Workflow and secrets

- `agent-run.yml` copies `agent/telegram.json` from the data checkout in
  and back out, and adds it to the commit when present, like
  `run-result.json`. It passes the new secret `TELEGRAM_OWNER_CHAT_ID`.
- Before the rollout Artem sends `/start` to the bot in a private chat.
  His chat id is read once with `getUpdates` from a local shell (it
  confirms nothing: no offset is passed) and stored with
  `gh secret set TELEGRAM_OWNER_CHAT_ID`. `getWebhookInfo` is checked at
  the same time: a set webhook would make `getUpdates` fail with 409.

## Testing

- `agent/tests/test_telegram_approval.py`, against a fake Bot API
  (records calls, scripted responses): owner-only taps (wrong user, wrong
  chat, malformed data, unknown hash, non-callback updates — all skipped,
  offset still advances); the same batch read twice gives the same
  decisions; the merge cases from `approval-merge.json`; asks newest
  first and capped; a failed ask is retried next run; edits only on a
  status change; a deleted message is dropped; "not modified" is
  success; a failed poll → nothing dropped or delivered, no asks,
  `telegram.json` untouched.
- An engine test over two runs: run 1 asks; taps approve one item and
  reject another; run 2 applies them, delivers the approved item when
  due, edits both messages to `sent` / `rejected` and prunes their
  entries.
- `agent/tests/test_preset.py`: the block's validation; `--offline`
  refuses it.
- Tony's characterization goldens are re-recorded: the harness fakes the
  Bot API's `getUpdates`, `sendMessage` and `editMessageText` next to
  delivery. The expected diff is `config.approval.telegram`, the review
  notes and the fake's ask calls; anything else changing is a regression.
  The demo goldens stay byte-identical.
- Vitest: `lib/telegram-decisions.test.ts` (guard, the shared merge
  cases), `lib/queue-view.test.ts` (statuses and counts with Telegram
  decisions), `lib/run-result.test.ts` (the new keys, and their absence).

## Rollout

1. Artem: `/start` to the bot; chat id → `TELEGRAM_OWNER_CHAT_ID`;
   webhook checked.
2. Push to `main` on Artem's word, dispatch `agent-run.yml` by hand.
3. Check: up to 10 ask messages in the private chat, newest first;
   `agent-data` has `agent/telegram.json` with `messages` and no chat
   id; `run-result.json` has `config.approval.telegram` and no failures.
4. Artem approves one item and rejects another in Telegram; dispatch
   again (or wait for the cron).
5. Check: both messages edited (`✅ Approved…` with Undo, `❌ Rejected`
   without buttons); the rejected item is `dismissed: rejected` in
   `state.json`; `/researcher/queue/` shows the approved row as approved
   `· telegram`; the next due digest carries it and its message turns to
   `📤 Sent`.

## Success criteria

1. Artem decides queue items from Telegram without opening the site, and
   the next run applies those decisions.
2. Over the first week, `python -m agent report` shows sent or rejected
   items instead of everything pending or expired.
3. No run fails, and nothing is delivered that was rejected in either
   place.

## Out of scope

Several delivery targets per preset (its own sub-project later); instant
feedback on a tap (a webhook); `answerCallbackQuery`; Telegram approval in
the offline demos; editing summaries from Telegram; a "clear" decision in
`decisions.json` (the site can't undo a Telegram decision); Telegram
asks grouped into one message; anyone but the owner deciding.
