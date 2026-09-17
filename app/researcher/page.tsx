import Link from "next/link";
import type { Metadata } from "next";
import ResearcherTopics from "@/components/ResearcherTopics";

export const metadata: Metadata = {
  title: "RESEARCHER",
  description: "Web products, AI engineering, and tooling.",
  openGraph: {
    title: "RESEARCHER — Artem Polozov",
    description: "Web products, AI engineering, and tooling.",
    type: "website",
    url: "/researcher/",
  },
};

export default function ResearcherIndexPage() {
  return (
    <section id="researcher" className="standalone">
      <div className="wrap">
        <p className="section-label">Researcher</p>
        <ResearcherTopics />

        <Link className="topic-name plan-link" href="/researcher/agent/">
          A Research Agent
        </Link>

        <Link className="topic-name plan-link" href="/researcher/queue/">
          Research Queue
        </Link>
      </div>
    </section>
  );
}
