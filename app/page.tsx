import { Fragment } from "react";
import Link from "next/link";
import { getAllPosts } from "@/lib/posts";
import { subtopics, topics } from "@/lib/topics";
import AgentWidget from "@/components/AgentWidget";
import LabCarousel from "@/components/LabCarousel";

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
              {" · "}
              <Link href="/now/">now →</Link>
            </p>
          </div>
        </div>
      </section>

      <div className="wrap home-columns">
        <section id="researcher">
          <p className="section-label">
            <Link href="/researcher/">Researcher</Link>:{" "}
            <span className="section-topics">
              {topics.map((topic, i) => (
                <Fragment key={topic.name}>
                  {i > 0 && ", "}
                  {topic.href ? (
                    <Link href={topic.href}>{topic.name}</Link>
                  ) : (
                    topic.name
                  )}
                </Fragment>
              ))}
              .
            </span>
          </p>
          <AgentWidget variant="compact" />
          <p className="subtopic-tags">{subtopics.join(", ")}.</p>
        </section>

        <section id="lab">
          <p className="section-label">
            <Link href="/lab/">
              Lab:{" "}
              <span className="section-topics">takes on experience.</span>
            </Link>
          </p>
          <LabCarousel posts={posts} />
        </section>
      </div>
    </>
  );
}
