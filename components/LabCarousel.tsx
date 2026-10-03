"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { type Slide, shuffled } from "@/lib/home-feed";

// One random order per page load, per slide count: stable across renders
// (useSyncExternalStore needs that), new on every reload.
const permutations = new Map<number, number[]>();
function pagePermutation(n: number): number[] {
  let p = permutations.get(n);
  if (!p) {
    p = shuffled(Array.from({ length: n }, (_, i) => i));
    permutations.set(n, p);
  }
  return p;
}
const noSubscribe = () => () => {};

/**
 * Home page LAB card: one post at a time — LAB posts and Telegram posts
 * mixed (lib/home-feed.ts), each with a badge naming its source. The
 * static HTML and hydration use the given order; the browser then swaps
 * in one shuffled order per page load (a client-only snapshot, so no
 * hydration mismatch). The comet's CSS animation along the
 * bottom edge is the timer — the card advances when it ends
 * (`--comet-duration` on `.lab-card` in globals.css), so pausing the
 * animation on hover/focus pauses the rotation too. Every slide stays in
 * the DOM, stacked in one grid cell, so the card keeps the height of its
 * longest post and never jumps.
 */
export default function LabCarousel({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0);
  const permutation = useSyncExternalStore(
    noSubscribe,
    () => pagePermutation(slides.length),
    () => null,
  );
  const order = permutation ? permutation.map((i) => slides[i]) : slides;
  if (order.length === 0) return null;

  return (
    <div className="lab-card">
      <div className="lab-slides">
        {order.map((slide, i) => (
          <article
            key={slide.key}
            className={i === index ? "lab-slide is-active" : "lab-slide"}
          >
            <div className="lab-card-meta">
              <span className="date">{slide.dateLabel}</span>
              {slide.tag && (
                <>
                  <span className="sep">·</span>
                  <span className="tag">{slide.tag}</span>
                </>
              )}
              {slide.external ? (
                <a className="card-action" href={slide.href}>
                  Open <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <Link className="card-action" href={slide.href}>
                  Read <span aria-hidden="true">↗</span>
                </Link>
              )}
            </div>
            <p className="lab-card-title">{slide.title}</p>
            {slide.excerpt && <p className="lab-card-excerpt">{slide.excerpt}</p>}
            <span className="src-badge">{slide.source}</span>
          </article>
        ))}
      </div>
      {order.length > 1 && (
        <div className="card-comet" aria-hidden="true">
          {/* Keyed by index so each slide remounts the comet and restarts it. */}
          <span
            key={index}
            className="card-comet-run"
            onAnimationEnd={() => setIndex((i) => (i + 1) % order.length)}
          />
        </div>
      )}
    </div>
  );
}
