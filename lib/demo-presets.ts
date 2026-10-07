import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RUN_RESULT_SCHEMA, type RunResult, parseRunResult } from "./run-result";

// The demo section's presets (/researcher/demo/<slug>/), read at build
// time from their committed goldens — run1.json and run2.json, recorded by
// agent/tests/test_presets_offline.py — so a re-recorded golden updates
// the demo. A golden that doesn't parse fails the build. Server-only
// (node:fs): DemoRoom imports the types alone.

export const DEMO_SLUGS = ["newsroom-demo", "agro-demo"];

export interface Demo {
  slug: string;
  run1: RunResult;
  run2: RunResult;
}

export interface DemoLink {
  slug: string;
  name: string;
}

function readRun(root: string, slug: string, file: string): RunResult {
  const path = join(root, "agent", "tests", "fixtures", slug, "golden", file);
  const run = parseRunResult(JSON.parse(readFileSync(path, "utf8")));
  if (!run) throw new Error(`demo ${slug}: ${file} is not a schema-${RUN_RESULT_SCHEMA} run result`);
  return run;
}

export function loadDemo(slug: string, root: string = process.cwd()): Demo {
  if (!DEMO_SLUGS.includes(slug)) throw new Error(`${slug} is not a demo preset (lib/demo-presets.ts)`);
  return { slug, run1: readRun(root, slug, "run1.json"), run2: readRun(root, slug, "run2.json") };
}

export function demoLinks(root: string = process.cwd()): DemoLink[] {
  return DEMO_SLUGS.map((slug) => ({ slug, name: loadDemo(slug, root).run1.preset.name }));
}
