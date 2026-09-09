import { describe, expect, it } from "vitest";
import { formatDateLabel, getAllPosts, getPost, getPostSlugs } from "./posts";

describe("formatDateLabel", () => {
  it("renders YYYY-MM as 'Mon YYYY'", () => {
    expect(formatDateLabel("2026-08")).toBe("Aug 2026");
    expect(formatDateLabel("2026-01")).toBe("Jan 2026");
    expect(formatDateLabel("2025-12")).toBe("Dec 2025");
  });
});

describe("posts index", () => {
  it("exposes the seed post with parsed frontmatter", () => {
    const post = getPost("cheap-models-strong-graphs");
    expect(post).toMatchObject({
      slug: "cheap-models-strong-graphs",
      title: "Cheap Models, Strong Graphs",
      tag: "AI AGENTS",
      date: "2026-08",
      dateLabel: "Aug 2026",
    });
    expect(post.excerpt.length).toBeGreaterThan(0);
    expect(post.description.length).toBeGreaterThan(0);
  });

  it("getPostSlugs and getAllPosts agree on the slug set", () => {
    const slugs = getPostSlugs().sort();
    const fromAll = getAllPosts()
      .map((p) => p.slug)
      .sort();
    expect(fromAll).toEqual(slugs);
  });

  it("orders posts newest first", () => {
    const dates = getAllPosts().map((p) => p.date);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });
});
