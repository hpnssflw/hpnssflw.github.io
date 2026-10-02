import { Fragment } from "react";
import { fetchLatestPost, TELEGRAM_CHANNEL } from "@/lib/telegram-post";

const MAX_LINKS = 4;

/**
 * Server component: the latest post in the agent's Telegram channel, read
 * at build time (lib/telegram-post.ts). A flat strip under the home
 * columns — no card: the label row (TELEGRAM: post title · date · open ↗)
 * and the post's links on one line. Renders nothing when the post can't
 * be read.
 */
export default async function TelegramLatest() {
  const post = await fetchLatestPost(TELEGRAM_CHANNEL);
  if (!post) return null;

  const date = new Date(post.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const links = post.links.slice(0, MAX_LINKS);

  return (
    <section id="telegram">
      <div className="wrap">
        <div className="tg-head">
          <p className="section-label">
            <a href={`https://t.me/${TELEGRAM_CHANNEL}`}>Telegram</a>:{" "}
            <span className="section-topics">{post.title}</span>
          </p>
          <p className="tg-meta">
            <time dateTime={post.date}>{date}</time>
            <span className="sep">·</span>
            <a className="card-action" href={post.url}>
              Open <span aria-hidden="true">↗</span>
            </a>
          </p>
        </div>
        {links.length > 0 && (
          <p className="tg-links">
            {links.map((link, i) => (
              <Fragment key={link.href}>
                {i > 0 && <span className="sep"> · </span>}
                <a href={link.href}>{link.text}</a>
              </Fragment>
            ))}
            {post.links.length > MAX_LINKS && (
              <span className="sep"> · +{post.links.length - MAX_LINKS}</span>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
