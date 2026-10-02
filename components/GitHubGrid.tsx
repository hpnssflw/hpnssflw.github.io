import type { CSSProperties } from "react";
import { fetchCalendar, GITHUB_LOGIN, placeCells, twinkle } from "@/lib/github-calendar";

const WEEKS = 26;
const CELL = 8;
const STEP = 10; // cell + 2px gap

/**
 * Server component: runs at build time (see lib/github-calendar.ts) and
 * bakes the last WEEKS weeks into static SVG. Renders nothing when the
 * calendar can't be fetched.
 *
 * Two layers of the same squares: every day in its level's violet, then
 * a glow layer over the active days — each square fades up in pink, white
 * or cyan and back, on its own seeded rhythm (twinkle()), forever, through
 * a soft bloom filter. The glow layer is hidden under
 * prefers-reduced-motion (globals.css).
 */
export default async function GitHubGrid() {
  const calendar = await fetchCalendar(GITHUB_LOGIN, process.env.GITHUB_TOKEN);
  if (!calendar) return null;

  const cells = placeCells(calendar.weeks.slice(-WEEKS));
  const cols = cells.length ? cells[cells.length - 1].col + 1 : 0;
  const width = cols * STEP - (STEP - CELL);
  const height = 7 * STEP - (STEP - CELL);
  const square = (c: (typeof cells)[number]) => ({
    x: c.col * STEP,
    y: c.row * STEP,
    width: CELL,
    height: CELL,
    rx: 1,
  });

  return (
    <div className="gh">
      <svg
        className="gh-grid"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        overflow="visible"
        role="img"
        aria-label={`GitHub contributions over the last ${WEEKS} weeks`}
      >
        <defs>
          <filter id="gh-bloom" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="gh-cells">
          {cells.map((c) => (
            <rect key={c.date} className={`l${c.level}`} {...square(c)}>
              <title>{`${c.date}: ${c.count}`}</title>
            </rect>
          ))}
        </g>
        <g className="gh-glow" filter="url(#gh-bloom)" aria-hidden="true">
          {cells
            .filter((c) => c.level > 0)
            .map((c) => {
              const t = twinkle(c.date);
              const style: CSSProperties = {
                animationDuration: `${t.duration}s`,
                animationDelay: `-${t.delay}s`,
              };
              return (
                <rect
                  key={c.date}
                  className={`l${c.level} t${t.tone}`}
                  style={style}
                  {...square(c)}
                />
              );
            })}
        </g>
      </svg>
      <p className="gh-caption">
        github · <span className="gh-total">{calendar.total.toLocaleString("en-US")}</span>{" "}
        in the last year
      </p>
    </div>
  );
}
