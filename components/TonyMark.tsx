import { useId } from "react";

/**
 * Tony Scraponi's mark: a spy — a lime fedora with a band, dark glasses —
 * for a scraper with a mobster's name. Now and then the hat tips and a
 * glint crosses the lenses ("The spy" in globals.css; off under reduced
 * motion). Used by the home teaser and the control room's pulse.
 */
export default function TonyMark({ size = 28 }: { size?: number }) {
  const clipId = `tony-lenses-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="app-icon" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <circle cx="10.9" cy="19" r="2.6" />
          <circle cx="17.1" cy="19" r="2.6" />
        </clipPath>
      </defs>
      <rect x="0.5" y="0.5" width="27" height="27" rx="6" className="app-icon-tile" />
      <g className="tony-hat">
        <path d="M8.5 13.2 C8.5 9.6 10.4 7.6 14 7.6 C17.6 7.6 19.5 9.6 19.5 13.2 Z" className="tony-hat-crown" />
        <path d="M11 9.6 Q14 11.2 17 9.6" className="tony-hat-dent" />
        <path d="M8.7 11.9 L19.3 11.9" className="tony-hat-band" />
        <path d="M4.6 13.5 Q14 17.4 23.4 13.5 Q14 15.4 4.6 13.5 Z" className="tony-hat-brim" />
      </g>
      <circle cx="10.9" cy="19" r="2.6" className="tony-lens" />
      <circle cx="17.1" cy="19" r="2.6" className="tony-lens" />
      <path d="M13.5 18.6 Q14 18.1 14.5 18.6" className="tony-bridge" />
      <g clipPath={`url(#${clipId})`}>
        <rect x="6" y="14" width="2.2" height="10" className="tony-glint" />
      </g>
    </svg>
  );
}
