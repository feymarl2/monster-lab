import { SCORE_WEIGHTS } from "./constants";
import { asNumber, isRecord } from "./guards";
import type { CheckResult, PartId, ScoreBand, VetoCode } from "./types";

// PURE: no I/O, no clock, no randomness. Identical input -> identical output.
// Per-part point values are computed by each source module (scoreLeftArm, scoreRightArm,
// scoreLegs) and carried on `CheckResult.data.points`; HEAD and HEART are all-or-nothing on state.

export interface ScoreInput {
  hasCode: boolean;
  parts: Record<PartId, CheckResult>;
  legsProvided: boolean;
}

export interface ScoreOutput {
  score: number;
  band: ScoreBand;
  verdict: "ALIVE" | "DEAD";
  vetoes: { code: VetoCode; reason: string }[];
  points: Record<PartId, { earned: number; max: number }>;
  unavailableCount: number;
  weakerNote?: string;
  meaning: string;
  topFindings: PartId[];
}

export const PART_ORDER: readonly PartId[] = ["head", "heart", "leftArm", "rightArm", "legs"];
export const ALIVE_THRESHOLD = 60;

export const VETO_REASONS: Record<VetoCode, string> = {
  HONEYPOT: "GoPlus flags this token as a honeypot — buyers may not be able to sell.",
  TRANSFER_REVERT: "A real holder's transfer was blocked in simulation — transfers appear restricted.",
  NO_CODE: "There is no contract code at this address.",
};

const VETO_PART: Record<VetoCode, PartId> = {
  HONEYPOT: "leftArm",
  TRANSFER_REVERT: "heart",
  NO_CODE: "heart",
};

const POSITIVE_PHRASE: Record<PartId, string> = {
  head: "its source code is verified",
  heart: "a real holder could move it in simulation",
  leftArm: "its security flags look mostly clean",
  rightArm: "it has a real market with liquidity",
  legs: "its X account looks established",
};

export function bandFor(score: number): ScoreBand {
  if (score >= 80) return "thriving";
  if (score >= 60) return "alive";
  if (score >= 40) return "twitching";
  return "corpse";
}

function pointsFromData(result: CheckResult): number {
  if (!isRecord(result.data)) return 0;
  return asNumber(result.data.points) ?? 0;
}

function earnedFor(part: PartId, result: CheckResult): number {
  if (result.state === "unknown") return 0; // a failed read never earns points
  const max = SCORE_WEIGHTS[part];
  let earned: number;
  if (part === "head" || part === "heart") earned = result.state === "healthy" ? max : 0;
  else earned = pointsFromData(result);
  return Math.min(max, Math.max(0, Math.round(earned)));
}

function stripEnd(text: string): string {
  return text.replace(/[.\s]+$/, "");
}

export function scoreVerdict(input: ScoreInput): ScoreOutput {
  const { parts, hasCode, legsProvided } = input;

  const points = {} as Record<PartId, { earned: number; max: number }>;
  let earnedTotal = 0;
  let available = 0;
  for (const part of PART_ORDER) {
    const max = part === "legs" && !legsProvided ? 0 : SCORE_WEIGHTS[part];
    const earned = part === "legs" && !legsProvided ? 0 : earnedFor(part, parts[part]);
    points[part] = { earned, max };
    earnedTotal += earned;
    available += max;
  }
  // available is 100, or 90 when LEGS is not provided. Unknown parts keep their weight here.
  const score = Math.min(100, Math.max(0, Math.round((100 * earnedTotal) / available)));

  const vetoCodes: VetoCode[] = [];
  if (!hasCode || parts.heart.veto === "NO_CODE") vetoCodes.push("NO_CODE");
  if (parts.heart.veto === "TRANSFER_REVERT") vetoCodes.push("TRANSFER_REVERT");
  if (parts.leftArm.veto === "HONEYPOT") vetoCodes.push("HONEYPOT");
  const vetoes = vetoCodes.map((code) => ({ code, reason: VETO_REASONS[code] }));

  const verdict: "ALIVE" | "DEAD" = vetoes.length > 0 || score < ALIVE_THRESHOLD ? "DEAD" : "ALIVE";
  const band = bandFor(score);

  const isUnavailable = (part: PartId): boolean => parts[part].state === "unknown" && !parts[part].notProvided;
  const unavailableCount = PART_ORDER.filter(isUnavailable).length;
  const weakerNote =
    unavailableCount > 0
      ? `${unavailableCount} ${unavailableCount === 1 ? "check" : "checks"} unavailable — verdict is weaker than usual.`
      : undefined;

  // Top findings: (1) veto cause, (2) rotten by weight, (3) unknown, (4) healthy by weight.
  const byWeight = (a: PartId, b: PartId) => SCORE_WEIGHTS[b] - SCORE_WEIGHTS[a];
  const candidates = PART_ORDER.filter((p) => !(p === "legs" && !legsProvided));
  const vetoParts = new Set<PartId>(vetoCodes.map((c) => VETO_PART[c]));
  const topFindings: PartId[] = [
    ...candidates.filter((p) => vetoParts.has(p)).sort(byWeight),
    ...candidates.filter((p) => !vetoParts.has(p) && parts[p].state === "rotten").sort(byWeight),
    ...candidates.filter((p) => !vetoParts.has(p) && parts[p].state === "unknown").sort(byWeight),
    ...candidates.filter((p) => !vetoParts.has(p) && parts[p].state === "healthy").sort(byWeight),
  ].slice(0, 3);

  // "What this means": deterministic template.
  const sentences: string[] = [];
  if (verdict === "ALIVE") sentences.push("This token looks alive.");
  else if (vetoes.length > 0) sentences.push(`This token is dead on arrival: ${vetoes[0].reason}`);
  else sentences.push(`This token scores ${score}/100, below the ${ALIVE_THRESHOLD} needed to be called alive.`);

  const healthy = candidates.filter((p) => parts[p].state === "healthy").sort(byWeight).slice(0, 2);
  if (healthy.length > 0) {
    sentences.push(`Good signs: ${healthy.map((p) => POSITIVE_PHRASE[p]).join(" and ")}.`);
  }
  const rotten = candidates
    .filter((p) => parts[p].state === "rotten" && !(vetoes.length > 0 && p === VETO_PART[vetoCodes[0]]))
    .sort(byWeight)
    .slice(0, 2);
  if (rotten.length > 0) {
    sentences.push(`Problems: ${rotten.map((p) => stripEnd(parts[p].finding)).join("; ")}.`);
  }
  if (weakerNote) sentences.push(weakerNote);
  if (verdict === "ALIVE") sentences.push("Alive today does not mean safe forever — check the evidence links.");

  return {
    score,
    band,
    verdict,
    vetoes,
    points,
    unavailableCount,
    weakerNote,
    meaning: sentences.join(" "),
    topFindings,
  };
}
