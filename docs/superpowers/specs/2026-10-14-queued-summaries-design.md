# Summaries from the Page Text — Design

Chosen with Artem on 2026-10-14 from `PROGRESS.md`'s candidates, after
he turned down writing summaries himself ("I don't want to write anything
myself").

## Problem

The digest, the Telegram asks and the control room all show each item's
one-sentence summary. DeepSeek writes it in the ranking call, where a
Hacker News link has only its title, points and domain, and a GitHub
repo has its title and a description of up to 280 characters. The prompt
forbids guessing, so most summaries only restate the title. A live
example from `pending.json`: "An OpenAI link titled 'GPT‑6 and
Intelligent UI for everyone,' indicating a major model/platform
release."

## Goal

Every item entering the queue gets a summary written from its page's
text, with no work from Artem. The extra cost stays small: only items
that passed rank and the daily cap are fetched and summarized, about 10
a day for Tony.

## How it works

A new step, **summarize**, between cap and queue. It runs for the items
the cap keeps, in each topic and in the preset feeds' scope:

1. **Fetch.** Get each item's page text with `fulltext.fetch_text(url,
   fetcher)` (trafilatura, through the engine's fetcher with its SSRF
   guard and size cap). Skip the fetch for items from a feed marked
   `full_text: true`: they already carry that text. For a GitHub repo,
   the page text is its README.
2. **Summarize.** One DeepSeek call per scope for the items with text. A
   new system prompt asks for one or two sentences in the preset's
   language: what the thing is and what's new about it, stated only from
   the given text. It returns `null` when the text doesn't say what the
   item is (a paywall, a captcha, a cookie wall). The response is
   validated like the ranking response: ids, a non-empty string or
   `null`, at most `SUMMARY_MAX_CHARS = 400`. One retry, then one call
   per item.
3. **Replace.** A valid summary replaces the ranker's in the
   `RankedItem` before `pending.add_kept`. If the fetch fails, the page
   has no text, the model says `null`, or the call fails, the item keeps
   the ranker's summary. Summarize never drops an item or fails a run.

Nothing else changes. Scores, the rank cache, the cap, approval and
delivery work as before. The Telegram ask goes out after the queue is
final, so it already shows the new summary, and so do the digest and the
control room.

## Preset

An opt-in key under `ranking`:

```yaml
ranking:
  reader: >
    ...
  summarize_queued: true
```

- A boolean, `false` when missing. Tony's preset turns it on.
- The newsroom and agro demos leave it off, so their goldens stay
  byte-identical.
- `--preview` runs it, so previews show the summaries a real run would
  queue. `--dry-run` has no LLM and skips it. `--offline` with the key on
  is a `PresetError`: the demos' fixtures have no summary call.

## Records

- `run-result.json` (schema stays 2): a `summarize` stage between `cap`
  and `queue`, for presets with the key on. Its in/out counts are equal
  (it never drops), and its notes are `summarized`, `kept_rank_summary`
  and `fetch_failed`. Its failures are `stage: "summarize"` with the
  error type only. The site's `lib/run-result.ts` and
  `lib/pipeline-stages.ts` learn the stage. It's a rail cell on
  `/researcher/queue/` only when present (like B's `group` and `facts`),
  so Tony's rail gains one cell.
- `status.json` is unchanged.
- `pending.json` is unchanged in format. Only the `summary` text is
  better.

## Existing queue

No backfill. The ~49 items in the queue keep their summaries and leave
it through approval, rejection or the 7-day expiry. Only new items get
the new summaries.

## Code

- `agent/summarize.py`:
  - `SUMMARY_SYSTEM_PROMPT`, `_build_summary_prompt`,
    `_parse_summary_response` and `summarize_items(items, llm, reader,
    language)`.
  - It reuses `_complete` and `_batch_with_fallback`.
- `agent/ranker.py`:
  - `LiveRanker.summarize(items)`.
  - `FixtureRanker.summarize` raises, since the demos never call it.
- `agent/pipeline.py`: `_summarize(ctx, scope, keep)` is called in
  `_cap_and_queue` before `add_kept`, and in the feeds path before the
  feeds' items are queued.
- `agent/preset.py`: `ranking.summarize_queued`, plus the `--offline`
  refusal.
- `agent/run_result.py`: the stage in the stage order, and the key in
  `config`.
- `agent/presets/tony.yaml`: `summarize_queued: true`.
- Site: the stage label (en/ru) in `lib/control-room-text.ts`, and the
  stage in `lib/pipeline-stages.ts`.
- Docs: `docs/agent-plan.md` and `/researcher/agent/` get a sentence
  each, and `PROGRESS.md` the usual update.

## Testing

- `agent/tests/test_summarize.py`:
  - The prompt carries the text, the language and the reader.
  - The validator accepts `null`, and rejects empty strings, strings over
    400 characters, and wrong ids.
  - It falls back to one call per item.
- `agent/tests/test_pipeline.py` (or a new test file), with a fake
  fetcher and ranker:
  - Kept items get the new summary.
  - A fetch failure, a `null` or a failed call keeps the ranker's
    summary.
  - Items from a full-text feed aren't fetched again.
  - Over-cap and below-threshold items are never fetched.
  - Notes and stage counts are right.
- `agent/tests/test_preset.py`: the key's validation and the
  `--offline` refusal.
- Tony's goldens: the harness fails every fetch, so the summaries stay
  the ranker's. The expected diff is the new `summarize` stage and
  `config.ranking.summarize_queued` in `run-result.json`. Any other
  change is a regression. The demo goldens stay byte-identical.
- Vitest: `lib/run-result.test.ts` and `lib/pipeline-stages.test.ts` for
  the new stage, with and without it.

## Rollout

1. A live `--preview` on a copy of `agent-data`'s state and pending,
   before the push. Artem compares a few old and new summaries. This is
   the one place he looks; nothing to write.
2. Push to `main` and dispatch `agent-run.yml`.
3. Check: `run-result.json` has the `summarize` stage with no failures;
   new rows in `pending.json` and the new Telegram asks read like
   summaries, not title restatements; `/researcher/queue/` shows the
   cell.

## Success criteria

1. New queue items' summaries say what the item is, beyond its title.
2. DeepSeek calls per run grow by at most one per scope, about 10 items
   a day for Tony.
3. No run fails, and no item is lost because of this step.

## Out of scope

Re-scoring with the page text (the score stays the ranker's);
backfilling the current queue; summaries for items below the threshold
or over the cap; editing summaries by hand (turned down).
