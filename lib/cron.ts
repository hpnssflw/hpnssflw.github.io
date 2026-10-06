// The agent's schedule, from the `cron:` line of
// .github/workflows/agent-run.yml. Only the two shapes this repo would use
// are supported — every N hours at minute M, and once a day at H:M — and
// anything else throws, so lib/agent-config.ts fails the build instead of
// the control room counting down to the wrong time. UTC, like Actions.

export interface CronSchedule {
  minute: number;
  /** Runs every `hourStep` hours from 00:00 UTC; null for a daily run. */
  hourStep: number | null;
  /** The daily run's hour; null when `hourStep` is set. */
  hour: number | null;
}

function field(value: string, min: number, max: number, expr: string): number {
  const n = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!(n >= min && n <= max)) throw new Error(`unsupported cron "${expr}"`);
  return n;
}

export function parseCron(expr: string): CronSchedule {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5 || parts.slice(2).some((part) => part !== "*")) {
    throw new Error(`unsupported cron "${expr}"`);
  }
  const minute = field(parts[0], 0, 59, expr);
  const step = /^\*\/(\d+)$/.exec(parts[1]);
  if (step) return { minute, hourStep: field(step[1], 1, 23, expr), hour: null };
  return { minute, hourStep: null, hour: field(parts[1], 0, 23, expr) };
}

/** The first scheduled slot strictly after `now`. */
export function nextRun(schedule: CronSchedule, now: Date): Date {
  const slot = new Date(now.getTime());
  slot.setUTCMinutes(schedule.minute, 0, 0);
  for (let i = 0; i <= 48; i++) {
    const hour = slot.getUTCHours();
    const due = schedule.hourStep !== null ? hour % schedule.hourStep === 0 : hour === schedule.hour;
    if (due && slot.getTime() > now.getTime()) return slot;
    slot.setUTCHours(hour + 1);
  }
  throw new Error("no cron slot within 48 hours");
}
