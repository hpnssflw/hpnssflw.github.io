"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Trailing-slash-insensitive path match ("/lab/" and "/lab" are the same). */
function normalize(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

export default function SiteHeader() {
  const pathname = normalize(usePathname());

  const isHome = pathname === "/";
  const inLab = pathname === "/lab" || pathname.startsWith("/lab/");
  const inResearcher =
    pathname === "/researcher" || pathname.startsWith("/researcher/");

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link
          className="brand"
          href="/"
          aria-current={isHome ? "page" : undefined}
        >
          Artem Polozov
        </Link>
        <nav>
          <Link href="/lab/" aria-current={inLab ? "page" : undefined}>
            Lab
          </Link>
          <Link
            href="/researcher/"
            aria-current={inResearcher ? "page" : undefined}
          >
            Researcher
          </Link>
        </nav>
      </div>
    </header>
  );
}
