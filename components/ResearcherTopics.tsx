import Link from "next/link";
import { topics } from "@/lib/topics";

export default function ResearcherTopics() {
  return (
    <ul className="topics">
      {topics.map((topic) => (
        <li key={topic.name}>
          {topic.href ? (
            <Link className="topic-name" href={topic.href}>
              {topic.name}
            </Link>
          ) : (
            <span className="topic-name">{topic.name}</span>
          )}
          <span className="topic-gloss">{topic.gloss}</span>
        </li>
      ))}
    </ul>
  );
}
