# Telegram delivery

## Purpose

Replace the dead SMTP delivery path with a Telegram publisher: the research
agent posts its rolled-up digest to a public Telegram channel instead of
emailing it. This is sub-project #2 of the Content Direction & Tony
Scraponi initiative (`docs/tony-scraponi-roadmap.md`). The channel becomes
a second public surface for the agent alongside the dashboard — visible,
joinable, and linked from the site — rather than a private inbox only
Artem sees.

## Background

`agent/deliver.py`/`digest.py` (SMTP) never sent a real email — credentials
were never configured, and the user decided against email/push delivery
entirely on 2026-08-17, then asked for Telegram specifically on 2026-09-16
as part of this initiative (see the `project-agent-delivery-pivot` memory
for the full history). Everything else about the pipeline this spec touches
— the pending-queue/rollup-cadence decoupling from
`2026-08-15-agent-status-widget-design.md` § Email delivery decoupling — is
unchanged and not re-litigated here; only the transport at the end of that
pipeline changes.

## Delivery model

A single public Telegram channel, not a private chat. The bot posts to it;
anyone can join via a link on the site. This matches the roadmap's own
wording ("a Telegram publisher for the agent, plus a link to the channel on
the branding site") and keeps the agent's public-proof posture (established
by the status widget/dashboard) consistent: the digest itself becomes
visible, not just the fact that runs are happening.

Cadence is unchanged from the existing design: collection/ranking keep
running every 4 hours; delivery stays on its own coarser rollup (default
24h, `agent/pending.json`'s existing gate logic). Telegram is a drop-in
replacement for the transport at the end of that gate, not a redesign of
when things go out.

## Prerequisite (outside this repo)

Before the live-send verification step, Artem creates the bot (via
`@BotFather`), creates the public channel, and adds the bot as a channel
admin. This is a manual, one-time setup step — same shape as the
never-completed "add SMTP credentials" step it replaces. Until it's done,
`TELEGRAM_BOT_TOKEN` won't exist in `agent/.env`, and delivery will
gracefully fail and retry next run, the same way the SMTP path did when
unconfigured.

## Components

### `agent/digest.py` (rewritten)

Same responsibility — assemble the pending queue into deliverable content —
different output shape. `build(items_by_topic: dict[str, list[PendingItem]])`
returns `list[str]` (one or more Telegram messages, `parse_mode=HTML`)
instead of the old `(subject, plain_text_body)` tuple:

- Normally **one message for the whole run**: topic names as `<b>bold</b>`
  headers, each item as `<a href="...">title</a>` followed by its one-line
  summary.
- If the combined message would exceed Telegram's 4096-character limit,
  fall back to **one message per topic** instead. This is the only
  branching the module needs — no arbitrary chunking within a topic.
- Every piece of LLM-derived or source-derived text (title, summary) is run
  through `html.escape()` before interpolation, and the URL is escaped for
  use inside the `href` attribute. This is the same discipline
  `assets/agent-widget.js` already applies to `status.json` content before
  rendering it — untrusted text, whether from a ranked HN title or a
  DeepSeek summary, must not be trusted as pre-formed HTML.
- No more "subject line" concept — Telegram messages don't have one. The
  digest's item count still appears, as a bold first line of the message
  body (e.g. `<b>Research digest — 7 items</b>`).

### `agent/deliver.py` (rewritten)

Same responsibility — send — different transport. `send(messages: list[str],
settings: Settings) -> None` POSTs each message to the Telegram Bot API's
`sendMessage` endpoint via `requests` (already in `requirements.txt` — no
new dependency):

```
POST https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage
{"chat_id": settings.delivery.telegram_channel, "text": message, "parse_mode": "HTML"}
```

Raises on any non-2xx response or request exception; `main.py`'s existing
try/except around the delivery call catches it, logs a `deliver`/`failed`
event, and leaves the queue untouched for a retry next run — same pattern
as the SMTP path, just a different exception type. If some messages in a
multi-message batch already sent before a later one fails, the retry will
re-send the successful ones too (duplicate posts in the channel) — accepted
as a rare, low-stakes edge case (multi-message only happens when a single
run's queue is unusually large) rather than something worth building
partial-send tracking for.

### `agent/config.py`

`DeliveryConfig`:
- `to`/`from_` (email-specific) → `telegram_channel: str` (the channel's
  public `@handle` — not a secret; it's the same handle the site links to).
- `email_cadence_hours` → `delivery_cadence_hours` (same meaning: the
  digest rollup interval, decoupled from the 4h collection cadence).

`Settings`/`load_settings` updated to match.

### `agent/defaults.yaml`

```yaml
delivery:
  telegram_channel: "@<handle>"   # placeholder until the channel exists
  delivery_cadence_hours: 24
```

### `agent/status_export.py` / `agent/pending.py`

No logic changes — `pending.py`'s queue/gate mechanics are transport-
agnostic already. Field renames flow through from `config.py`:
`last_email_at` → `last_sent_at`, `email_cadence_hours` (param) →
`delivery_cadence_hours`, `pending_email_count` → `pending_count` in the
`status.json` output.

### `agent/status.json` (data contract change)

```jsonc
{
  // ...unchanged fields (updated_at, cadence_hours, streak, topics, funnel, recent_events, run_history)...
  "last_sent_at": "2026-09-17T09:00:00Z",   // was last_email_at
  "delivery_cadence_hours": 24,              // was email_cadence_hours
  "pending_count": 7                         // was pending_email_count
}
```

### `lib/agent-status.ts` / `components/AgentWidget.tsx`

`AgentStatus` interface and `isAgentStatus` guard updated for the renamed
fields. `DashboardBody`'s `{status.pending_email_count} queued for next
digest` → `{status.pending_count} queued for next digest` — copy unchanged,
concept is still accurate (a rollup digest, just posted to Telegram now).

### `main.py`

Same call sites — `digest.build(grouped)` → `deliver.send(messages,
settings)` — updated for the new signatures. The `emailed` local variable
and its uses (`writer.emit("deliver", "sent", ...)`, `print(f"Sent {n}
items...")`) get renamed to drop the email-specific name (`delivered`),
consistent with the rest of the rename; behavior unchanged.

### `.github/workflows/agent-run.yml`

Drop the four `SMTP_*` secret lines. Add:
```yaml
TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
```
`TELEGRAM_BOT_TOKEN` added as a new repo secret (manual step, same as
`DEEPSEEK_API_KEY` was).

### `components/SiteFooter.tsx`

Add the channel link alongside the existing email/GitHub links:

```tsx
<a href="mailto:hypnosisflow@gmail.com">hypnosisflow@gmail.com</a>
{" · "}
<a href="https://github.com/hpnssflw">github.com/hpnssflw</a>
{" · "}
<a href="https://t.me/<handle>">Telegram</a>
{" · © 2026"}
```

Site-wide, since `SiteFooter` renders on every route via the root layout —
consistent with how the footer already surfaces every other public contact
point.

### `app/researcher/agent/page.tsx` (narrative sync)

- "Deliver" pipeline stage: *"the digest goes out by email on a fixed
  schedule"* → *"the digest goes out to a public Telegram channel on a
  fixed schedule."*
- "Proposed stack": *"SMTP for delivery, decoupled onto its own coarser
  cadence..."* → *"the Telegram Bot API for delivery, decoupled onto its
  own coarser cadence..."*
- "Cadence & format": *"The email digest stays coarser..."* / *"the inbox
  doesn't get six emails..."* → reworded for the channel, not an inbox.
- "What's still open": *"Whether once-a-day is the right email rollup..."*
  → *"...right Telegram rollup..."*.
- "Status": *"...hold in a pending queue, and deliver by email once a
  day."* → *"...deliver to Telegram once a day."*

Not touched by this spec, flagged for a later pass: this page's "Sources"
section still describes six kinds of source (including Reddit/RSS/web
search, none of which exist) — stale from before the themes rework
(sub-project #1), unrelated to delivery, out of scope here.

## Module layout (changed files)

```
agent/
├── main.py                 # digest.build/deliver.send call sites updated for new signatures
├── config.py                # DeliveryConfig: telegram_channel, delivery_cadence_hours
├── defaults.yaml              # delivery: telegram_channel, delivery_cadence_hours
├── digest.py                   # rewritten: HTML-formatted Telegram messages, not email subject/body
├── deliver.py                    # rewritten: Telegram Bot API sendMessage via requests, not SMTP
└── status_export.py                # renamed fields in build_status's output

.github/workflows/agent-run.yml   # SMTP_* secrets dropped, TELEGRAM_BOT_TOKEN added

lib/agent-status.ts         # AgentStatus interface + isAgentStatus: renamed fields
components/AgentWidget.tsx  # pending_email_count -> pending_count
components/SiteFooter.tsx   # + Telegram channel link
app/researcher/agent/page.tsx  # narrative sync: email -> Telegram wording
```

## Out of scope

- Any change to the pending-queue/rollup-cadence mechanism itself
  (`agent/pending.py`) — this spec only swaps the transport at the end of
  it.
- `app/researcher/agent/page.tsx`'s stale "Sources" section (six kinds,
  most unbuilt) — pre-existing gap from before the themes rework, unrelated
  to delivery.
- Per-item real-time posting — rejected during brainstorming in favor of
  keeping the existing rollup cadence.
- Anything from the Tony Scraponi MVP (sub-project #4) — this only adds a
  delivery transport, not a control/monitoring surface.

## Testing / verification

No automated test suite, consistent with the rest of the repo.

- **`digest.py`** — synthetic, no-network: HTML escaping of titles/
  summaries containing special characters, correct topic grouping and
  ordering, and the >4096-character fallback producing one message per
  topic instead of one combined message.
- **`deliver.py`** — synthetic: payload shape sent to `requests.post`
  (mocked), and that a non-2xx response or request exception raises
  (so `main.py`'s existing catch-and-retry path engages).
- **Live send** — once the bot/channel prerequisite is done: one real
  `python -m agent --topic <slug>` run with `delivery_cadence_hours`
  temporarily lowered, confirming an actual message lands in the channel
  with correct formatting (bold headers, clickable links, escaped text)
  and `pending.json`/`status.json` update correctly afterward.
- **Site**: `npm run build && npm run serve`, visually confirm the footer
  link on any page and the reworded agent-page copy at `/researcher/agent/`.
  `npm test` (Vitest) — no `lib/agent-status.ts` test file exists yet to
  update; if one is added as part of implementation it should cover the
  renamed fields.

## Open questions

- Whether the 24h rollup cadence still feels right once digests are
  visible in a public channel rather than a private inbox — a stale-
  feeling channel is more visible than a stale inbox. Revisit after a
  week of real posts, same as the original email-cadence open question
  this carries forward.
- Whether the channel should ever get a description/pinned message
  explaining what the agent is (linking back to `/researcher/agent/`) —
  a reasonable follow-up, not required for this spec to ship.
