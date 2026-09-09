"use client";

import { usePathname } from "next/navigation";

/**
 * Adds the `.home` class on the "/" route only. Everything the layout puts
 * on the page — header, content, footer — lives inside this wrapper, so the
 * one class widens the hero/feed/footer *and* the header rule
 * (`.home .wrap`, `.home .site-header-inner`) to `--measure-wide` on the
 * home page while every other route keeps the narrow reading column.
 * Server-rendered `children` pass straight through.
 */
export default function PageFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  return <div className={isHome ? "home" : undefined}>{children}</div>;
}
