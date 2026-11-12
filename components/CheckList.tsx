import type { CheckState, PartId, PartResult, VerdictResponse } from "@/lib/types";

export interface CheckListProps {
  parts: PartResult[];
  topFindings: PartId[];
  vetoes: VerdictResponse["vetoes"];
}

const BADGE: Record<CheckState, { word: string; icon: string; color: string }> = {
  healthy: { word: "HEALTHY", icon: "✓", color: "var(--stitch-green)" },
  rotten: { word: "ROTTEN", icon: "✗", color: "var(--rot-red)" },
  unknown: { word: "UNKNOWN", icon: "?", color: "var(--unknown-grey)" },
};

export default function CheckList({ parts, topFindings, vetoes }: CheckListProps) {
  // Top findings first (in priority order), then the rest in fixed part order.
  const byId = new Map(parts.map((p) => [p.part, p] as const));
  const top = topFindings.map((id) => byId.get(id)).filter((p): p is PartResult => p !== undefined);
  const rest = parts.filter((p) => !topFindings.includes(p.part));
  const ordered = [...top, ...rest];
  const topSet = new Set(topFindings);

  return (
    <section aria-label="Findings">
      {vetoes.length > 0 && (
        <div
          className="mb-3 rounded-lg border-2 p-3"
          style={{ borderColor: "var(--rot-red)", background: "rgba(255,66,87,0.1)" }}
          role="group"
          aria-label="Hard vetoes"
        >
          <p className="text-sm font-black uppercase tracking-wider" style={{ color: "var(--rot-red)" }}>
            Veto — this forces DEAD ON ARRIVAL
          </p>
          <ul className="mt-1 space-y-1 text-sm">
            {vetoes.map((v) => (
              <li key={v.code}>{v.reason}</li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-2">
        {ordered.map((p) => {
          const badge = p.notProvided
            ? { word: "NOT PROVIDED", icon: "–", color: "var(--unknown-grey)" }
            : BADGE[p.state];
          const emphasised = topSet.has(p.part);
          return (
            <li
              key={p.part}
              className={`rounded-lg border p-3 ${emphasised ? "border-2" : ""}`}
              style={{
                borderColor: emphasised ? badge.color : "var(--lab-border)",
                background: "var(--lab-surface)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold tracking-wide">
                  {p.label} <span className="font-normal text-[var(--lab-muted)]">· {p.source}</span>
                </span>
                <span
                  className="whitespace-nowrap rounded px-2 py-0.5 text-xs font-black"
                  style={{ color: badge.color, border: `1px solid ${badge.color}` }}
                >
                  {badge.icon} {badge.word}
                </span>
              </div>
              <p className={`mt-1 ${emphasised ? "text-base" : "text-sm"} text-[var(--lab-text)]`}>{p.finding}</p>
              {p.evidenceUrl && (
                <a
                  href={p.evidenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex min-h-[44px] items-center text-sm underline underline-offset-2"
                  style={{ color: "var(--stitch-green)" }}
                >
                  View evidence
                  <span className="sr-only"> for {p.label} (opens in a new tab)</span>
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
