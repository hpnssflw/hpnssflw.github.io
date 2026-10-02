import { fetchCalendar, GITHUB_LOGIN, placeCells } from "@/lib/github-calendar";

const WEEKS = 26;
const CELL = 6;
const STEP = 8; // cell + 2px gap

/**
 * Server component: runs at build time (see lib/github-calendar.ts) and
 * bakes the last WEEKS weeks into static SVG. Renders nothing when the
 * calendar can't be fetched.
 *
 * Two layers of the same squares: every day in its level's violet, then
 * the active days again, filled with one sheen gradient that slides
 * across the whole grid (SMIL, every 8s) — a single moving highlight
 * rather than per-cell animations. The sheen layer is hidden under
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
        role="img"
        aria-label={`GitHub contributions over the last ${WEEKS} weeks`}
      >
        <defs>
          <linearGradient
            id="gh-sheen"
            gradientUnits="userSpaceOnUse"
            x1={0}
            y1={0}
            x2={width}
            y2={height * 2}
          >
            {/* Colors come from globals.css (.gh-stop-*): attributes can't read CSS variables. */}
            <stop offset="0.38" className="gh-stop-white" stopOpacity={0} />
            <stop offset="0.45" className="gh-stop-pink" stopOpacity={0.55} />
            <stop offset="0.5" className="gh-stop-white" stopOpacity={0.75} />
            <stop offset="0.55" className="gh-stop-cyan" stopOpacity={0.5} />
            <stop offset="0.62" className="gh-stop-white" stopOpacity={0} />
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              values={`${-width} 0; ${width} 0; ${width} 0`}
              keyTimes="0; 0.45; 1"
              dur="8s"
              repeatCount="indefinite"
            />
          </linearGradient>
        </defs>
        <g className="gh-cells">
          {cells.map((c) => (
            <rect key={c.date} className={`l${c.level}`} {...square(c)}>
              <title>{`${c.date}: ${c.count}`}</title>
            </rect>
          ))}
        </g>
        <g className="gh-sheen" fill="url(#gh-sheen)" aria-hidden="true">
          {cells
            .filter((c) => c.level > 0)
            .map((c) => (
              <rect key={c.date} {...square(c)} />
            ))}
        </g>
      </svg>
      <p className="gh-caption">
        github · <span className="gh-total">{calendar.total.toLocaleString("en-US")}</span>{" "}
        in the last year
      </p>
    </div>
  );
}
