import Link from "next/link";
import { getAllPosts } from "@/lib/posts";

export default function HomePage() {
  const posts = getAllPosts();

  return (
    <>
      <section id="hero">
        <div className="wrap hero-layout">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="portrait"
            src="/photo.jpg"
            width={1242}
            height={1876}
            alt="Artem Polozov"
          />
          <div className="hero-body">
            <p className="role">Digital Craftsman</p>
            <h1>Artem Polozov</h1>
            <p className="hero-text">
              Web products, data visualization, systems integration, AI agent
              orchestration — same instinct applied to different systems:{" "}
              <span className="accent">
                understand how it fails, then build so it doesn&apos;t.
              </span>
            </p>
            <p className="contact mono">
              <a href="mailto:hypnosisflow@gmail.com">hypnosisflow@gmail.com</a>
              {" · "}
              <a href="https://github.com/hpnssflw">github.com/hpnssflw</a>
            </p>
          </div>
        </div>
      </section>

      <section id="researcher">
        <div className="wrap">
          <p className="section-label">
            <Link href="/researcher/">Researcher</Link>
          </p>
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
              <span className="topic-name">AI Agents &amp; Engineering</span>
              <span className="topic-gloss">
                trends, architectures and patterns for building and running
                agents in production.
              </span>
            </li>
          </ul>
          <div id="agent-widget" />
        </div>
      </section>

      <section id="lab">
        <div className="wrap">
          <p className="section-label">
            <Link href="/lab/">Lab</Link>
          </p>
          <ul className="feed">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link href={`/lab/${post.slug}/`}>
                  <span className="meta">
                    <span className="mono date">{post.dateLabel}</span>
                    <span className="mono sep">·</span>
                    <span className="mono tag">{post.tag}</span>
                  </span>
                  <span className="title">{post.title}</span>
                  <span className="excerpt">{post.excerpt}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/lab/" className="all-posts">
            All posts →
          </Link>
        </div>
      </section>
    </>
  );
}
