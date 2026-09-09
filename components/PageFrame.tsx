"use client";

import { usePathname } from "next/navigation";

/**
 * Adds the `.home` class on the "/" route only, so `.home .wrap` can widen
 * the hero/feed/footer to `--measure-wide` while every other route keeps the
 * narrow reading column. Server-rendered `children` pass straight through.
 */
export default function PageFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  return <div className={isHome ? "home" : undefined}>{children}</div>;
}
