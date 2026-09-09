import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const LAB_DIR = path.join(process.cwd(), "content", "lab");

export interface PostMeta {
  slug: string;
  /** Sortable "YYYY-MM" from frontmatter. */
  date: string;
  /** Display form, e.g. "Aug 2026" (uppercased by CSS in the meta line). */
  dateLabel: string;
  title: string;
  tag: string;
  excerpt: string;
  subtitle: string;
  description: string;
}

export function formatDateLabel(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, 1)).toLocaleDateString(
    "en-US",
    { month: "short", year: "numeric", timeZone: "UTC" },
  );
}

function readPost(fileName: string): PostMeta {
  const slug = fileName.replace(/\.mdx$/, "");
  const raw = fs.readFileSync(path.join(LAB_DIR, fileName), "utf8");
  const { data } = matter(raw);
  const date = String(data.date);
  const excerpt = String(data.excerpt ?? "");
  const subtitle = String(data.subtitle ?? excerpt);
  return {
    slug,
    date,
    dateLabel: formatDateLabel(date),
    title: String(data.title ?? slug),
    tag: String(data.tag ?? ""),
    excerpt,
    subtitle,
    description: String(data.description ?? subtitle),
  };
}

function mdxFiles(): string[] {
  return fs.readdirSync(LAB_DIR).filter((f) => f.endsWith(".mdx"));
}

export function getPostSlugs(): string[] {
  return mdxFiles().map((f) => f.replace(/\.mdx$/, ""));
}

/** Newest first. */
export function getAllPosts(): PostMeta[] {
  return mdxFiles()
    .map(readPost)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function getPost(slug: string): PostMeta {
  return readPost(`${slug}.mdx`);
}
