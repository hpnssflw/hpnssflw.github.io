export type Topic = {
  name: string;
  gloss: string;
  href?: string;
};

export const topics: Topic[] = [
  {
    name: "Web Products",
    gloss:
      "product and web trends, market data, data visualization, browser performance, web architecture, SEO.",
  },
  {
    name: "Tooling",
    gloss: "trending GitHub repos, web development tools.",
  },
  {
    name: "AI Engineering",
    gloss:
      "agent and automated pipelines, LLM assistants, self-hosted AI platforms, inference optimization.",
    href: "/researcher/agent/",
  },
];
