"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PresetLink } from "@/lib/demo-presets";

/**
 * The preset switch on the control room and the demo pages: a <details>
 * dropdown of plain links, so it works without JS and crawlers follow the
 * links. JS only closes it — on Escape (focus back on the summary), on a
 * press outside it, when keyboard focus leaves it, and on a link click
 * (picking the page you're on remounts nothing, so nothing else would
 * close the list).
 */
export default function PresetSwitch({
  presets,
  current,
  text,
}: {
  presets: PresetLink[];
  current: string;
  text: { label: string; live: string };
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const details = ref.current;
    if (!open || !details) return;
    function onPointerDown(event: PointerEvent) {
      if (details && !details.contains(event.target as Node)) details.open = false;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !details) return;
      details.open = false;
      details.querySelector("summary")?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const name = presets.find((preset) => preset.slug === current)?.name ?? current;

  return (
    <nav className="cr-preset" aria-label={text.label}>
      <details
        ref={ref}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && !event.currentTarget.contains(next)) event.currentTarget.open = false;
        }}
      >
        <summary>
          <span className="tony-name">{name}</span>
        </summary>
        <ul>
          {presets.map((preset) => (
            <li key={preset.slug}>
              <Link
                href={preset.href}
                aria-current={preset.slug === current ? "page" : undefined}
                onClick={() => {
                  if (ref.current) ref.current.open = false;
                }}
              >
                {preset.name}
                {preset.live && <span className="cr-preset-live"> · {text.live}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
