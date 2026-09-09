import Link from "next/link";
import type { Metadata } from "next";
import { getAllPosts } from "@/lib/posts";

export const metadata: Metadata = {
  title: "LAB",
  description: "Notes from running things in production.",
  openGraph: {
    title: "LAB — Artem Polozov",
    description: "Notes from running things in production.",
    type: "website",
    url: "/lab/",
  },
};

export default function LabIndexPage() {
  const posts = getAllPosts();

  return (
    <section id="lab" className="standalone">
      <div className="wrap">
        <p className="section-label">Lab</p>
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
      </div>
    </section>
  );
}
