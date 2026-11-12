import BodyPart from "./BodyPart";
import type { PartId, PartResult } from "@/lib/types";

export interface MonsterProps {
  parts: Partial<Record<PartId, PartResult>>;
  revealed: PartId[];
  shaking: boolean;
  flicker?: boolean;
  reducedMotion: boolean;
  /** Smaller figure, used on the verdict screen so the stamp stays above the fold. */
  compact?: boolean;
}

// Fixed reveal order. Never sorted by severity.
export const PART_ORDER: { id: PartId; label: string }[] = [
  { id: "head", label: "HEAD" },
  { id: "heart", label: "HEART" },
  { id: "leftArm", label: "LEFT ARM" },
  { id: "rightArm", label: "RIGHT ARM" },
  { id: "legs", label: "LEGS" },
];

export default function Monster({ parts, revealed, shaking, flicker, reducedMotion, compact }: MonsterProps) {
  const anyRevealed = revealed.length > 0;
  const classes = [
    "mx-auto block w-full",
    compact ? "max-h-[210px]" : "max-h-[300px]",
    shaking && !reducedMotion ? "monster-shaking" : "",
    flicker && !reducedMotion ? "lab-flicker" : "",
  ]
    .join(" ")
    .trim();

  return (
    <svg
      viewBox="0 0 320 300"
      className={classes}
      role="img"
      aria-label={
        anyRevealed
          ? `Monster with ${revealed.length} of 5 parts stitched on`
          : "Grey, unstitched monster lying on a slab"
      }
    >
      {/* Slab */}
      <rect x={20} y={268} width={280} height={18} rx={4} fill="#1b262c" stroke="#2c3d46" strokeWidth={2} />
      <rect x={40} y={286} width={14} height={10} fill="#1b262c" />
      <rect x={266} y={286} width={14} height={10} fill="#1b262c" />
      {/* Neck bolts */}
      <rect x={116} y={34} width={9} height={14} rx={2} fill="#4a5a63" />
      <rect x={195} y={34} width={9} height={14} rx={2} fill="#4a5a63" />
      {/* Torso (static; the heart sits inside it) */}
      <rect x={125} y={74} width={70} height={110} rx={10} fill="#1d2a31" stroke="#0b1114" strokeWidth={2} />

      {PART_ORDER.map(({ id, label }) => {
        const result = parts[id];
        const isRevealed = revealed.includes(id) && result !== undefined;
        return (
          <BodyPart
            key={id}
            id={id}
            label={label}
            state={result ? result.state : "pending"}
            finding={isRevealed ? result?.finding : undefined}
            revealed={isRevealed}
            reducedMotion={reducedMotion}
            notProvided={result?.notProvided}
          />
        );
      })}
    </svg>
  );
}
