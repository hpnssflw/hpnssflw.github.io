import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RESEARCHER",
  description: "Data viz, full-stack architecture, and AI agent engineering.",
  openGraph: {
    title: "RESEARCHER — Artem Polozov",
    description: "Data viz, full-stack architecture, and AI agent engineering.",
    type: "website",
    url: "/researcher/",
  },
};

export default function ResearcherIndexPage() {
  return (
    <section id="researcher" className="standalone">
      <div className="wrap">
        <p className="section-label">Researcher</p>
        <ul className="topics">
          <li>
            <span className="topic-name">Data Viz</span>
            <span className="topic-gloss">
              BI dashboards, browser graphics, render-engine performance.
            </span>
          </li>
          <li>
            <span className="topic-name">Full-Stack Architecture</span>
            <span className="topic-gloss">
              trends, architectures, best practices and patterns across the
              modern web stack.
            </span>
          </li>
          <li>
            <Link className="topic-name" href="/researcher/agent/">
              AI Agents &amp; Engineering
            </Link>
            <span className="topic-gloss">
              trends, architectures and patterns for building and running agents
              in production.
            </span>
          </li>
        </ul>

        <Link className="topic-name plan-link" href="/researcher/agent/">
          A Research Agent
        </Link>
      </div>
    </section>
  );
}
