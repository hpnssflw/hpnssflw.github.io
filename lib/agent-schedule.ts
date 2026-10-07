import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type CronSchedule, parseCron } from "./cron";

// The agent's schedule for the control room's pulse and the home agent
// widget's countdown, read at build time from the `cron:` line of
// .github/workflows/agent-run.yml — the one fact about the agent its
// run-result.json (lib/run-result.ts) doesn't carry. Not exactly one such
// line throws, so the build fails instead of a countdown to the wrong
// slot. Server-only (node:fs).

const WORKFLOW = ".github/workflows/agent-run.yml";
const CRON_RE = /^\s*-\s*cron:\s*["']([^"'\r\n]+)["']\s*$/gm;

export function loadSchedule(root: string = process.cwd()): CronSchedule {
  const matches = [...readFileSync(join(root, WORKFLOW), "utf8").matchAll(CRON_RE)];
  if (matches.length !== 1) {
    throw new Error(`agent schedule: expected one cron schedule in ${WORKFLOW}, found ${matches.length}`);
  }
  return parseCron(matches[0][1]);
}
