import type { Outcomes as OutcomesData } from "@/lib/outcomes";

function Histogram({ counts, threshold }: { counts: number[]; threshold: number | null }) {
  const max = Math.max(1, ...counts);
  return (
    <div className="cr-hist" role="img" aria-label={`relevance 1 to 10: ${counts.join(", ")}`}>
      {counts.map((n, i) => (
        <div key={i} className="cr-bar" data-pass={threshold === null ? undefined : i + 1 >= threshold}>
          <span className="cr-bar-n">{n || ""}</span>
          <span className="cr-bar-track">
            <span className="cr-bar-fill" style={{ height: `${(n / max) * 100}%` }} />
          </span>
          <span className="cr-bar-x">{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Two weeks of outcomes for the topics in view (agent/report.py, in the
 * browser): queued items split by what became of them, items scored per
 * day, and the relevance histogram with passing bars in lime.
 */
export default function Outcomes({
  data,
  failed,
  threshold,
}: {
  data: OutcomesData | null;
  failed: boolean;
  threshold: number | null;
}) {
  const today = data?.scoredPerDay.at(-1);
  const dayMax = Math.max(1, ...(data?.scoredPerDay.map((d) => d.count) ?? []));
  return (
    <div className="cr-outcomes">
      <p className="cr-label">Outcomes · 14 days</p>
      {failed ? (
        <p className="agent-unavailable">outcomes unavailable</p>
      ) : data ? (
        <div className="cr-out-grid">
          <div className="cr-out-nums">
            <p>
              <span className="cr-k">queued</span> <b>{data.queued}</b>
            </p>
            <p>
              <span className="inbox-approved">sent {data.sent}</span> ·{" "}
              <span className="inbox-rejected">rejected {data.rejected}</span> · expired {data.expired} · pending{" "}
              {data.pending}
            </p>
            <p>
              <span className="cr-k">scored / day</span>
              <span className="cr-days" aria-hidden="true">
                {data.scoredPerDay.map((d) => (
                  <span
                    key={d.day}
                    className="cr-day"
                    title={`${d.day}: ${d.count}`}
                    style={{ height: `${(d.count / dayMax) * 100}%` }}
                  />
                ))}
              </span>
              today <b>{today?.count ?? 0}</b>
            </p>
          </div>
          <Histogram counts={data.histogram} threshold={threshold} />
        </div>
      ) : null}
    </div>
  );
}
