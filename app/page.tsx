import { Fragment } from "react";
import Link from "next/link";
import { labSlides, telegramSlides, FEED_PER_SOURCE } from "@/lib/home-feed";
import { getAllPosts } from "@/lib/posts";
import { fetchRecentPosts, TELEGRAM_CHANNEL } from "@/lib/telegram-post";
import { subtopics, topics } from "@/lib/topics";
import AgentWidget from "@/components/AgentWidget";
import AppsStrip from "@/components/AppsStrip";
import ClaudeActivity from "@/components/ClaudeActivity";
import GitHubGrid from "@/components/GitHubGrid";
import LabCarousel from "@/components/LabCarousel";

export default async function HomePage() {
  // The LAB card mixes LAB posts with the agent channel's latest Telegram
  // posts, read at build time (no slides from Telegram if t.me is down).
  // Twice as many posts as slides: header-only messages get skipped.
  const slides = [
    ...labSlides(getAllPosts()),
    ...telegramSlides(await fetchRecentPosts(TELEGRAM_CHANNEL, FEED_PER_SOURCE * 2)),
  ];

  return (
    <>
      <section id="hero">
        <div className="wrap">
          <div className="hero-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="avatar"
              src="/avatar.jpg"
              width={352}
              height={352}
              alt="Artem Polozov"
            />
            <div className="hero-id">
              <h1>Artem Polozov</h1>
              <p className="hero-roles">
                Web products · data visualization · AI engineering
              </p>
              <p className="hero-thesis accent">
                Understand how it fails, then build so it doesn&apos;t.
              </p>
              <ClaudeActivity />
            </div>
            <nav className="hero-actions" aria-label="Contact">
              <a href="mailto:hypnosisflow@gmail.com">
                Email <span aria-hidden="true">↗</span>
              </a>
              <a href="https://github.com/hpnssflw">
                GitHub <span aria-hidden="true">↗</span>
              </a>
              <a href={`https://t.me/${TELEGRAM_CHANNEL}`}>
                Telegram <span aria-hidden="true">↗</span>
              </a>
            </nav>
            <div className="hero-widgets">
              <GitHubGrid />
            </div>
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
          <LabCarousel slides={slides} />
        </section>
      </div>

      <AppsStrip />
    </>
  );
}
