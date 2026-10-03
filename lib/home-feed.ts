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
  dateLabel: string; // "Sep 2026" for LAB (month), "Sep 30" for Telegram (day)
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

/** A post's first line as the title; up to three of its link titles as the excerpt. */
export function telegramSlides(posts: TelegramPost[]): Slide[] {
  return posts.slice(0, FEED_PER_SOURCE).map((p) => ({
    key: `tg:${p.id}`,
    source: "telegram",
    href: p.url,
    external: true,
    dateLabel: new Date(p.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
    tag: null,
    title: p.title,
    excerpt: p.links
      .slice(0, 3)
      .map((l) => l.text)
      .join(" · "),
  }));
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
