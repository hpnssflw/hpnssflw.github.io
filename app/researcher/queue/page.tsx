import type { Metadata } from "next";
import ControlRoom from "@/components/ControlRoom";
import { loadAgentConfig } from "@/lib/agent-config";

const description =
  "The research agent's control room: its config, its last run, the moderation queue and two weeks of outcomes.";

export const metadata: Metadata = {
  title: "Tony Scraponi",
  description,
  openGraph: { title: "Tony Scraponi", description, type: "website" },
};

export default function QueuePage() {
  // Read from this repo's agent/ at build time (static export: once).
  return <ControlRoom config={loadAgentConfig()} />;
}
