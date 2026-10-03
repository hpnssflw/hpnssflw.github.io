import { describe, expect, it } from "vitest";
import { FEED_PER_SOURCE, labSlides, shuffled, telegramSlides } from "./home-feed";
import type { PostMeta } from "./posts";
import type { TelegramPost } from "./telegram-post";

const post = (i: number): PostMeta => ({
  slug: `post-${i}`,
  date: `2026-0${(i % 9) + 1}`,
  dateLabel: "Sep 2026",
  title: `Post ${i}`,
  tag: "tag",
  excerpt: `Excerpt ${i}`,
  subtitle: "",
  description: "",
});

const tg = (id: number, links = 2): TelegramPost => ({
  id,
  url: `https://t.me/hypnosisflow/${id}`,
  date: "2026-09-30T04:09:28+00:00",
  title: "Research digest — 2 items",
  links: Array.from({ length: links }, (_, i) => ({ text: `link ${i}`, href: `https://x.test/${i}` })),
  items: Array.from({ length: links }, (_, i) => ({
    title: `Item ${i}`,
    href: `https://x.test/${i}`,
    section: "AI Engineering",
    summary: `What item ${i} is.`,
  })),
});

describe("labSlides", () => {
  it("takes the newest five posts, linking inside the site", () => {
    const slides = labSlides([0, 1, 2, 3, 4, 5, 6].map(post));
    expect(slides).toHaveLength(FEED_PER_SOURCE);
    expect(slides[0]).toEqual({
      key: "lab:post-0",
      source: "lab",
      href: "/lab/post-0/",
      external: false,
      dateLabel: "Sep 2026",
      tag: "tag",
      title: "Post 0",
      excerpt: "Excerpt 0",
    });
  });
});

describe("telegramSlides", () => {
  it("shapes a digest post like a LAB post: its first item, the item's section as the tag", () => {
    const [slide] = telegramSlides([tg(94, 5)]);
    expect(slide).toEqual({
      key: "tg:94",
      source: "telegram",
      href: "https://t.me/hypnosisflow/94",
      external: true,
      dateLabel: "Sep 2026",
      tag: "AI Engineering",
      title: "Item 0",
      excerpt: "What item 0 is.",
    });
  });

  it("falls back to the post's first line and link titles without items", () => {
    const [slide] = telegramSlides([{ ...tg(95, 2), items: [] }]);
    expect(slide).toMatchObject({
      tag: null,
      title: "Research digest — 2 items",
      excerpt: "link 0 · link 1",
    });
  });

  it("skips a header-only post (a long digest's first message)", () => {
    const header = { ...tg(90, 0), title: "Research digest — 22 items" };
    expect(telegramSlides([header, tg(91)]).map((s) => s.key)).toEqual(["tg:91"]);
  });

  it("takes at most five posts", () => {
    expect(telegramSlides([1, 2, 3, 4, 5, 6, 7].map((id) => tg(id)))).toHaveLength(FEED_PER_SOURCE);
  });
});

describe("shuffled", () => {
  it("keeps every item exactly once and leaves the input alone", () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = shuffled(input);
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("is a Fisher–Yates shuffle driven by the given random source", () => {
    // random() = 0 always swaps each position with the first: [b, c, d, a].
    expect(shuffled(["a", "b", "c", "d"], () => 0)).toEqual(["b", "c", "d", "a"]);
    // random() just under 1 never moves anything.
    expect(shuffled(["a", "b", "c", "d"], () => 0.9999)).toEqual(["a", "b", "c", "d"]);
  });
});
