import type { CSSProperties } from "react";
import type { Text } from "@/lib/control-room-text";
import type { StageKey, StageNumbers } from "@/lib/pipeline-stages";

/**
 * The stages of the last run, left to right (nine; ten with stories):
 * each a number and a muted line of what it removed. A stage that failed
 * this run turns red. Clicking one highlights its row in the config spine.
 */
export default function PipelineRail({
  stages,
  active,
  onPick,
  titles,
  text,
}: {
  stages: StageNumbers[];
  active: StageKey | null;
  onPick: (key: StageKey) => void;
  titles: Partial<Record<StageKey, string>>;
  text: Text;
}) {
  return (
    <ol className="cr-rail" aria-label={text.rail.label} style={{ "--rail-cells": stages.length } as CSSProperties}>
      {stages.map((stage) => (
        <li key={stage.key}>
          <button
            type="button"
            className="cr-node"
            aria-pressed={active === stage.key}
            data-failed={stage.failed !== null}
            title={titles[stage.key]}
            onClick={() => onPick(stage.key)}
          >
            <span className="cr-label">{text.stages[stage.key]}</span>
            <span className="cr-node-n">{stage.value}</span>
            <span className="cr-node-line">{stage.failed !== null ? text.rail.failed(stage.failed) : stage.line}</span>
          </button>
        </li>
      ))}
      <li className="card-comet" aria-hidden="true">
        <span className="card-comet-run" />
      </li>
    </ol>
  );
}
