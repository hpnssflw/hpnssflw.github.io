// RESEARCHER site copy only — distinct from agent/topics/*.yaml (the agent's own topic config) and lib/agent-status.ts's TopicStatus, deliberately not reconciled with either (see the design spec).
export type Topic = {
  name: string;
  subtopics: string[];
  href?: string;
};

export const topics: Topic[] = [
  {
    name: "Web Products",
    subtopics: [
      "product and web trends",
      "market data",
      "data visualization",
      "browser performance",
      "web architecture",
      "SEO",
    ],
  },
  {
    name: "Tooling",
    subtopics: ["trending GitHub repos", "web development tools"],
  },
  {
    name: "AI Engineering",
    subtopics: [
      "agent and automated pipelines",
      "LLM assistants",
      "self-hosted AI platforms",
      "inference optimization",
    ],
    href: "/researcher/agent/",
  },
];

/** A topic's subtopics as the one-line description /researcher/ shows. */
export function gloss(topic: Topic): string {
  return `${topic.subtopics.join(", ")}.`;
}

/** Every subtopic across all topics, in topic order — home's tag list. */
export const subtopics: string[] = topics.flatMap((t) => t.subtopics);
