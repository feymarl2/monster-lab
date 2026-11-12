import type { ScoreBand, VerdictResponse } from "@/lib/types";

export interface VerdictStampProps {
  verdict: VerdictResponse["verdict"];
  score: number;
  band: ScoreBand;
  slammed: boolean;
}

export default function VerdictStamp({ verdict, score, band, slammed }: VerdictStampProps) {
  const alive = verdict === "ALIVE";
  const color = alive ? "var(--stitch-green)" : "var(--rot-red)";
  const text = alive ? "IT'S ALIVE" : "DEAD ON ARRIVAL";

  return (
    <div className="flex flex-col items-center py-2" data-verdict={verdict}>
      <div
        className={`${slammed ? "stamp-slam" : "stamp-resting"} rounded-lg border-4 px-5 py-2 text-center`}
        style={{ borderColor: color, color, boxShadow: `0 0 18px ${color}55` }}
      >
        <p className="text-3xl font-black leading-none tracking-wide sm:text-4xl">{text}</p>
      </div>
      <p className="mt-3 text-6xl font-black leading-none tabular-nums" style={{ color }}>
        {score}
        <span className="text-2xl font-bold text-[var(--lab-muted)]">/100</span>
      </p>
      <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-[var(--lab-muted)]">{band}</p>
    </div>
  );
}
