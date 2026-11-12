import type { CheckState, PartId } from "@/lib/types";

export interface BodyPartProps {
  id: PartId;
  label: string;
  state: CheckState | "pending";
  finding?: string;
  revealed: boolean;
  reducedMotion: boolean;
  /** LEGS only: no handle supplied. Rendered neutral, never as a penalty. */
  notProvided?: boolean;
}

interface Geometry {
  shapes: { x: number; y: number; width: number; height: number; rx: number }[];
  thread: string;
  ooze: { x: number; y: number };
  text: { x: number; y: number; anchor: "start" | "end" };
}

// Figure is centred at x = 160 in a 320 x 300 viewBox (see Monster.tsx).
const GEOMETRY: Record<PartId, Geometry> = {
  head: {
    shapes: [{ x: 125, y: 10, width: 70, height: 60, rx: 12 }],
    thread: "M125 40 L137 34 L149 46 L161 34 L173 46 L185 34 L195 40",
    ooze: { x: 145, y: 70 },
    text: { x: 210, y: 36, anchor: "start" },
  },
  heart: {
    shapes: [],
    thread: "M144 112 L152 106 L160 114 L168 106 L176 112",
    ooze: { x: 160, y: 134 },
    text: { x: 210, y: 166, anchor: "start" },
  },
  leftArm: {
    shapes: [{ x: 55, y: 90, width: 70, height: 20, rx: 10 }],
    thread: "M70 100 L80 94 L90 106 L100 94 L110 106 L120 100",
    ooze: { x: 80, y: 110 },
    text: { x: 8, y: 130, anchor: "start" },
  },
  rightArm: {
    shapes: [{ x: 195, y: 90, width: 70, height: 20, rx: 10 }],
    thread: "M200 100 L210 94 L220 106 L230 94 L240 106 L250 100",
    ooze: { x: 230, y: 110 },
    text: { x: 312, y: 130, anchor: "end" },
  },
  legs: {
    shapes: [
      { x: 130, y: 185, width: 25, height: 80, rx: 8 },
      { x: 165, y: 185, width: 25, height: 80, rx: 8 },
    ],
    thread: "M130 225 L142 219 L155 231 M165 225 L177 219 L190 231",
    ooze: { x: 142, y: 265 },
    text: { x: 210, y: 226, anchor: "start" },
  },
};

const HEART_PATH = "M160 136 C138 118 136 98 150 96 C155 95 159 98 160 103 C161 98 165 95 170 96 C184 98 182 118 160 136 Z";

const STATE_FILL: Record<CheckState | "pending", string> = {
  healthy: "var(--stitch-green)",
  rotten: "var(--rot-red)",
  unknown: "var(--unknown-grey)",
  pending: "#2a343a",
};

const STATE_WORD: Record<CheckState, string> = {
  healthy: "HEALTHY",
  rotten: "ROTTEN",
  unknown: "UNKNOWN",
};

const STATE_ICON: Record<CheckState, string> = {
  healthy: "✓",
  rotten: "✗",
  unknown: "?",
};

export default function BodyPart({
  id,
  label,
  state,
  finding,
  revealed,
  reducedMotion,
  notProvided,
}: BodyPartProps) {
  const g = GEOMETRY[id];
  const effective: CheckState | "pending" = revealed ? state : "pending";
  const fill = STATE_FILL[effective];

  let stateText = "WAITING";
  if (effective !== "pending") {
    stateText = notProvided ? "– NOT PROVIDED" : `${STATE_ICON[effective]} ${STATE_WORD[effective]}`;
  }
  const textColor = effective === "pending" || notProvided ? "var(--unknown-grey)" : fill;

  const threadClass = ["thread-line", "thread-drawn", reducedMotion ? "" : "thread-draw"].join(" ").trim();
  const drip = g.ooze;

  return (
    <g data-part={id} data-state={effective}>
      <title>{finding ? `${label}: ${finding}` : label}</title>
      {g.shapes.map((s, i) => (
        <rect
          key={i}
          className="part-fill"
          x={s.x}
          y={s.y}
          width={s.width}
          height={s.height}
          rx={s.rx}
          style={{ fill }}
          stroke="#0b1114"
          strokeWidth={2}
        />
      ))}
      {id === "heart" && (
        <path className="part-fill" d={HEART_PATH} style={{ fill }} stroke="#0b1114" strokeWidth={2} />
      )}
      {revealed && <path className={threadClass} d={g.thread} pathLength={1} />}
      <path
        className={`ooze${revealed && effective === "rotten" ? " ooze-on" : ""}`}
        d={`M${drip.x} ${drip.y} q-5 10 0 18 q5 -8 0 -18 z`}
        fill="var(--rot-red)"
      />
      <text
        x={g.text.x}
        y={g.text.y}
        textAnchor={g.text.anchor}
        fontSize={10}
        fontWeight={700}
        fill="#cfd8dc"
        letterSpacing={1}
      >
        {label}
      </text>
      <text
        x={g.text.x}
        y={g.text.y + 13}
        textAnchor={g.text.anchor}
        fontSize={10}
        fontWeight={700}
        style={{ fill: textColor }}
      >
        {stateText}
      </text>
    </g>
  );
}
