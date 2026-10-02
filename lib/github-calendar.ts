/**
 * The home hero's mini contribution grid. Fetched once per `next build`
 * (GitHub's GraphQL API needs a token: GITHUB_TOKEN, which Actions
 * provides to the deploy build); deploy.yml rebuilds on a schedule so the
 * baked-in grid stays recent. The calendar is the same one the public
 * profile shows — it includes private contributions only as counts,
 * because the profile shares them — so nothing here is new exposure.
 */

export const GITHUB_LOGIN = "hpnssflw";

export interface Day {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface Calendar {
  total: number; // contributions in the last year
  weeks: Day[][]; // oldest first; the first and last week may be partial
}

export interface Cell extends Day {
  col: number; // week index
  row: number; // weekday, 0 = Sunday
  level: 0 | 1 | 2 | 3 | 4;
}

const QUERY = `query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Structural guard for a GraphQL response. Rebuilds the calendar from the
 * known keys only; anything malformed (or an error response) is null.
 */
export function parseCalendar(json: unknown): Calendar | null {
  const cal = isRecord(json) && isRecord(json.data) && isRecord(json.data.user)
    ? json.data.user.contributionsCollection
    : null;
  const calendar = isRecord(cal) ? cal.contributionCalendar : null;
  if (!isRecord(calendar) || !isCount(calendar.totalContributions)) return null;
  if (!Array.isArray(calendar.weeks) || calendar.weeks.length === 0) return null;

  const weeks: Day[][] = [];
  for (const week of calendar.weeks) {
    if (!isRecord(week) || !Array.isArray(week.contributionDays)) return null;
    const days: Day[] = [];
    for (const day of week.contributionDays) {
      if (!isRecord(day)) return null;
      if (typeof day.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) return null;
      if (!isCount(day.contributionCount)) return null;
      days.push({ date: day.date, count: day.contributionCount });
    }
    weeks.push(days);
  }
  return { total: calendar.totalContributions, weeks };
}

/**
 * 0 for empty days; 1–4 by quartiles of the active days. GitHub's own
 * levels are relative to the busiest day, so one huge day pushes almost
 * everything else to level 1 — quartiles keep the grid readable.
 */
export function levelsOf(counts: number[]): Cell["level"][] {
  const active = counts.filter((n) => n > 0).sort((a, b) => a - b);
  const cut = (p: number) => active[Math.floor(p * (active.length - 1))];
  const [q1, q2, q3] = [cut(0.25), cut(0.5), cut(0.75)];
  return counts.map((n) => (n === 0 ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4));
}

/** One cell per day: weeks are columns, weekdays rows (Sunday on top). */
export function placeCells(weeks: Day[][]): Cell[] {
  const levels = levelsOf(weeks.flat().map((d) => d.count));
  let i = 0;
  return weeks.flatMap((week, col) =>
    week.map((day) => ({
      col,
      row: new Date(`${day.date}T00:00:00Z`).getUTCDay(),
      ...day,
      level: levels[i++],
    })),
  );
}

/** FNV-1a: a stable 32-bit seed from a string. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG, uniform in [0, 1). */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Twinkle {
  duration: number; // seconds per glow cycle, 6–15
  delay: number; // seconds into the cycle at page load, 0–duration
  tone: 0 | 1 | 2; // pink, white, cyan
}

/**
 * One active day's glow: random-looking but seeded by its date, so a
 * build is reproducible and the same day keeps its rhythm across builds.
 * Rounded to 0.1 s to keep the markup short.
 */
export function twinkle(date: string): Twinkle {
  const next = seeded(hash(date));
  const duration = 6 + next() * 9;
  const delay = next() * duration;
  return {
    duration: Math.round(duration * 10) / 10,
    delay: Math.round(delay * 10) / 10,
    tone: Math.floor(next() * 3) as Twinkle["tone"],
  };
}

/**
 * Build-time only. Null — and the grid simply isn't rendered — without a
 * token, on a non-200, or after a second network failure; a GitHub hiccup
 * must never fail the deploy.
 */
export async function fetchCalendar(
  login: string,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Calendar | null> {
  if (!token) {
    console.warn("[github-calendar] GITHUB_TOKEN is not set; skipping the contribution grid");
    return null;
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchImpl("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "hpnssflw.github.io build",
        },
        body: JSON.stringify({ query: QUERY, variables: { login } }),
      });
      if (!res.ok) {
        console.warn(`[github-calendar] GitHub answered ${res.status}; skipping the grid`);
        return null;
      }
      const calendar = parseCalendar(await res.json());
      if (!calendar) console.warn("[github-calendar] unexpected response; skipping the grid");
      return calendar;
    } catch (err) {
      if (attempt === 2) {
        console.warn(`[github-calendar] ${String(err)}; skipping the grid`);
      }
    }
  }
  return null;
}
