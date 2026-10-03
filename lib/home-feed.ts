import type { PostMeta } from "./posts";
import type { TelegramPost } from "./telegram-post";

/**
 * The home LAB card's slides: the newest LAB posts and the newest posts
 * from the agent's Telegram channel, FEED_PER_SOURCE of each, shown in a
 * random order (LabCarousel shuffles them on load). A badge on each slide
 * says where it comes from.
 */
export const FEED_PER_SOURCE = 5;

export interface Slide {
  key: string;
  source: "lab" | "telegram";
  href: string;
  external: boolean;
  dateLabel: string; // "Sep 2026" — month, for both sources
  tag: string | null;
  title: string;
  excerpt: string;
}

export function labSlides(posts: PostMeta[]): Slide[] {
  return posts.slice(0, FEED_PER_SOURCE).map((p) => ({
    key: `lab:${p.slug}`,
    source: "lab",
    href: `/lab/${p.slug}/`,
    external: false,
    dateLabel: p.dateLabel,
    tag: p.tag || null,
    title: p.title,
    excerpt: p.excerpt,
  }));
}

/**
 * Shaped like a LAB post: a digest's first item as the title, its
 * one-line summary as the excerpt, its section as the tag. A post that
 * isn't a digest falls back to its first line and up to three link titles;
 * one with neither items nor links — the header message a long digest
 * starts with — is skipped.
 */
export function telegramSlides(posts: TelegramPost[]): Slide[] {
  return posts
    .filter((p) => p.items.length > 0 || p.links.length > 0)
    .slice(0, FEED_PER_SOURCE)
    .map((p) => {
      const item = p.items[0];
      return {
        key: `tg:${p.id}`,
        source: "telegram",
        href: p.url,
        external: true,
        dateLabel: new Date(p.date).toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }),
        tag: item?.section ?? null,
        title: item?.title ?? p.title,
        excerpt: item
          ? item.summary
          : p.links
              .slice(0, 3)
              .map((l) => l.text)
              .join(" · "),
      };
    });
}

/** Fisher–Yates on a copy; `random` is injectable for tests. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
