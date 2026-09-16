import type { Metadata } from "next";
import AgentWidget from "@/components/AgentWidget";

export const metadata: Metadata = {
  title: "A Research Agent",
  description:
    "A living plan for a background agent that watches web products, AI engineering, and tooling.",
  openGraph: {
    title: "A Research Agent",
    description:
      "A living plan for a background agent that watches web products, AI engineering, and tooling.",
    type: "article",
  },
};

export default function ResearchAgentPage() {
  return (
    <article className="post">
      <div className="wrap">
        <h1>A Research Agent</h1>
        <p className="subtitle">
          A living plan for a background agent that watches web products, AI
          engineering, and tooling so research doesn&apos;t compete with
          writing time.
        </p>

        <AgentWidget variant="dashboard" />

        <div className="body">
          <h2 id="goal">
            <span className="num">01</span>Goal
          </h2>
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

          <h2 id="sources">
            <span className="num">02</span>Sources
          </h2>
          <p>
            Five kinds of source, each with a different signal-to-noise ratio:
          </p>
          <ul>
            <li>
              Hacker News — via the public Algolia search API, filtered to each
              topic&apos;s keywords.
            </li>
            <li>
              Blog and RSS feeds — a curated list maintained by hand, the
              highest-signal source once it exists.
            </li>
            <li>
              Repo releases — a version bump on a handful of watched repos per
              topic is unambiguous news in a way a blog post isn&apos;t.
            </li>
            <li>
              A handful of subreddits per topic — chosen once, revisited later if
              the signal is bad.
            </li>
            <li>
              Web search — broad net via a search API with a freshness filter,
              catches whatever isn&apos;t already covered above.
            </li>
          </ul>
          <p>
            Every source has to return a publish date for anything it surfaces —
            undated items get dropped rather than risk something stale reading as
            current.
          </p>

          <h2 id="pipeline">
            <span className="num">03</span>Pipeline
          </h2>
          <p>Six stages, each one a small, replaceable piece:</p>
          <ul>
            <li>
              Collect — each source connector runs independently and returns a
              flat list of candidate links, each with a publish date.
            </li>
            <li>
              Recency window — anything published outside the topic&apos;s
              freshness window gets dropped, unless it&apos;s since gained enough
              traction to earn a second look.
            </li>
            <li>
              Dedupe — every link&apos;s URL gets hashed against a store of
              what&apos;s already been sent; only new links continue.
            </li>
            <li>
              Rank — one call per topic reads that topic&apos;s whole surviving
              batch at once and ranks it, rather than scoring each item in
              isolation, so &quot;relevant this week&quot; means the same thing
              every week; a one-line summary and score come back per item, and
              anything below the threshold or past the per-topic cap gets
              dropped.
            </li>
            <li>
              Assemble — surviving items get grouped by topic into a digest,
              ordered by relevance within each group.
            </li>
            <li>
              Deliver — the digest goes out by email on a fixed schedule.
            </li>
          </ul>

          <h2 id="stack">
            <span className="num">04</span>Proposed stack
          </h2>
          <ul>
            <li>
              A single Python script, run on a schedule rather than a long-lived
              service — nothing here needs to be always-on.
            </li>
            <li>
              <code>feedparser</code> for RSS/blog sources, the Hacker News
              Algolia API, Reddit&apos;s public JSON endpoints, and the GitHub
              releases API for the aggregators, a search API with a freshness
              filter for the broad net.
            </li>
            <li>
              A flat JSON file (or SQLite if it outgrows that) holding seen-URL
              hashes and score history — the whole point of dedupe is state that
              survives between runs.
            </li>
            <li>
              DeepSeek for summarization and relevance scoring — cheap enough at
              this volume that ranking quality is the thing worth tuning, not
              price.
            </li>
            <li>
              GitHub Actions on a schedule for the trigger; SMTP for delivery,
              decoupled onto its own coarser cadence so collection can run more
              often than the inbox needs to hear from it.
            </li>
          </ul>

          <h2 id="cadence">
            <span className="num">05</span>Cadence &amp; format
          </h2>
          <p>
            Collection and ranking run every four hours — frequent enough that
            the live status above reflects what&apos;s actually happening right
            now. The email digest stays coarser, rolling up everything new once a
            day, so the inbox doesn&apos;t get six emails for one afternoon&apos;s
            reading. Each digest groups items under the three topic headers, one
            line of summary and a link each.
          </p>

          <h2 id="open-questions">What&apos;s still open</h2>
          <ul>
            <li>
              Whether once-a-day is the right email rollup — watch whether the
              inbox feels stale or noisy and adjust from there.
            </li>
            <li>
              Resurfacing — a link dismissed once shouldn&apos;t come back just
              because dedupe only tracks URLs verbatim.
            </li>
            <li>
              Budget — search and LLM calls cost money per run, and collection
              now runs six times a day instead of once a week; worth watching
              GitHub Actions minutes and DeepSeek spend as this settles in.
            </li>
          </ul>

          <h2 id="status">Status</h2>
          <p>
            Running — the pipeline runs end to end on Hacker News alone, on a
            schedule: collect, filter for recency, dedupe, rank with DeepSeek,
            hold in a pending queue, and deliver by email once a day. The live
            status above reflects the actual current state of that schedule.
            Reddit, RSS, release watching, and web search are next.
          </p>
        </div>
      </div>
    </article>
  );
}
