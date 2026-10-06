import type { Text } from "@/lib/control-room-text";
import type { TopicFilter } from "@/lib/pipeline-stages";

/** "all" plus one chip per topic, each with its queue count; filters the whole page. */
export default function TopicChips({
  topics,
  counts,
  topic,
  onPick,
  text,
}: {
  topics: { slug: string; name: string }[];
  counts: Record<string, number>;
  topic: TopicFilter;
  onPick: (topic: TopicFilter) => void;
  text: Text["topics"];
}) {
  const options: [TopicFilter, string][] = [["all", text.all], ...topics.map((t): [TopicFilter, string] => [t.slug, t.name])];
  return (
    <div className="cr-chips cr-topics" role="group" aria-label={text.label}>
      {options.map(([key, label]) => (
        <button key={key} type="button" className="cr-chip" aria-pressed={topic === key} onClick={() => onPick(key)}>
          {label} <span className="cr-chip-n">{counts[key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
