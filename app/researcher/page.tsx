import Link from "next/link";
import type { Metadata } from "next";

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
        <ul className="topics">
          <li>
            <span className="topic-name">Web Products</span>
            <span className="topic-gloss">
              product and web trends, market data, data visualization,
              browser performance, web architecture, SEO.
            </span>
          </li>
          <li>
            <span className="topic-name">Tooling</span>
            <span className="topic-gloss">
              trending GitHub repos, web development tools.
            </span>
          </li>
          <li>
            <Link className="topic-name" href="/researcher/agent/">
              AI Engineering
            </Link>
            <span className="topic-gloss">
              agent and automated pipelines, LLM assistants, self-hosted AI
              platforms, inference optimization.
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
