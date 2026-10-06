import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSchedule } from "./agent-schedule";

/** A throwaway repo root holding only agent-run.yml. */
function repoWith(workflow: string): string {
  const root = mkdtempSync(join(tmpdir(), "agent-schedule-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "agent-run.yml"), workflow);
  return root;
}

describe("loadSchedule", () => {
  it("reads this repo's agent-run.yml", () => {
    expect(loadSchedule()).toEqual({ minute: 0, hourStep: 4, hour: null });
  });

  it("reads a fixture's cron line", () => {
    expect(loadSchedule(repoWith('on:\n  schedule:\n    - cron: "15 */6 * * *"\n'))).toEqual({ minute: 15, hourStep: 6, hour: null });
  });

  it.each([
    ["no cron line", "on: push\n", /found 0/],
    ["two cron lines", 'on:\n  schedule:\n    - cron: "0 */4 * * *"\n    - cron: "0 9 * * *"\n', /found 2/],
    ["an unsupported cron", 'on:\n  schedule:\n    - cron: "0 9 * * 1"\n', /unsupported cron/],
  ])("fails on %s", (_, workflow, message) => {
    expect(() => loadSchedule(repoWith(workflow))).toThrow(message);
  });
});
