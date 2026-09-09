import type { MDXComponents } from "mdx/types";

/**
 * Global MDX component overrides. The LAB post body is wrapped in
 * `<div className="post"><div className="wrap"><div className="body">` by the
 * route, so the site's existing `.post .body …` rules in globals.css style
 * these elements — no per-element styling is needed here. `Num` is a small
 * helper for the manually-numbered section headings.
 */
export function Num({ children }: { children: React.ReactNode }) {
  return <span className="num">{children}</span>;
}

const components: MDXComponents = { Num };

export function useMDXComponents(): MDXComponents {
  return components;
}
