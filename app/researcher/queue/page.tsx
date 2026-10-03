import type { Metadata } from "next";
import PendingQueue from "@/components/PendingQueue";

export const metadata: Metadata = {
  title: "Research Queue",
  description:
    "What the research agent has ranked and is holding for review and the next Telegram digest.",
  openGraph: {
    title: "Research Queue",
    description:
      "What the research agent has ranked and is holding for review and the next Telegram digest.",
    type: "article",
  },
};

export default function QueuePage() {
  return (
    <article className="post">
      <div className="wrap">
        <h1>Research Queue</h1>
        <p className="subtitle">
          Everything the agent has ranked above threshold, grouped by topic.
          Only what I approve goes out in the next Telegram digest.
        </p>
        <PendingQueue />
      </div>
    </article>
  );
}
