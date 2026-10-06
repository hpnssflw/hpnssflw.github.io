import type { Metadata } from "next";
import ControlRoom from "@/components/ControlRoom";
import { loadSchedule } from "@/lib/agent-schedule";

const description =
  "The research agent's control room: its config, its last run, the moderation queue and two weeks of outcomes.";

export const metadata: Metadata = {
  title: "Tony Scraponi",
  description,
  openGraph: { title: "Tony Scraponi", description, type: "website" },
};

export default function QueuePage() {
  // The workflow's cron line, read from this repo at build time (static
  // export: once); everything else is fetched by the page.
  return <ControlRoom schedule={loadSchedule()} />;
}
