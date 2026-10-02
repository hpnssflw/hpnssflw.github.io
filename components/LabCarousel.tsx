"use client";

import Link from "next/link";
import { useState } from "react";
import type { PostMeta } from "@/lib/posts";

type Slide = Pick<PostMeta, "slug" | "title" | "excerpt" | "dateLabel" | "tag">;

/**
 * Home page LAB card: one post at a time. The comet's CSS animation along
 * the bottom edge is the timer — the card advances when it ends
 * (`--comet-duration` on `.lab-card` in globals.css), so pausing the
 * animation on hover/focus pauses the rotation too. Every slide stays in
 * the DOM, stacked in one grid cell, so the card keeps the height of its
 * longest post and never jumps.
 */
export default function LabCarousel({ posts }: { posts: Slide[] }) {
  const [index, setIndex] = useState(0);
  if (posts.length === 0) return null;

  return (
    <div className="lab-card">
      <div className="lab-slides">
        {posts.map((post, i) => (
          <article
            key={post.slug}
            className={i === index ? "lab-slide is-active" : "lab-slide"}
          >
            <div className="lab-card-meta">
              <span className="date">{post.dateLabel}</span>
              <span className="sep">·</span>
              <span className="tag">{post.tag}</span>
              <Link className="card-action" href={`/lab/${post.slug}/`}>
                Read <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <p className="lab-card-title">{post.title}</p>
            <p className="lab-card-excerpt">{post.excerpt}</p>
          </article>
        ))}
      </div>
      {posts.length > 1 && (
        <div className="card-comet" aria-hidden="true">
          {/* Keyed by index so each slide remounts the comet and restarts it. */}
          <span
            key={index}
            className="card-comet-run"
            onAnimationEnd={() => setIndex((i) => (i + 1) % posts.length)}
          />
        </div>
      )}
    </div>
  );
}
