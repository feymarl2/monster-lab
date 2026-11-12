// Shared types only. No logic, no I/O.

export type CheckState = "healthy" | "rotten" | "unknown";
export type PartId = "head" | "heart" | "leftArm" | "rightArm" | "legs";
export type VetoCode = "HONEYPOT" | "TRANSFER_REVERT" | "NO_CODE";
export type ScoreBand = "corpse" | "twitching" | "alive" | "thriving";
export type ChainId = 56 | 8453;

export interface ChainInfo {
  id: ChainId;
  name: "BNB Chain" | "Base";
  slug: "bsc" | "base";
  explorerUrl: string;
}

/** Common result shape returned by every lib/sources/check<Source> function. */
export interface CheckResult<D = unknown> {
  state: CheckState;
  finding: string; // one plain-language sentence
  evidenceUrl?: string;
  data?: D; // source-specific parsed fields (server-side use)
  veto?: VetoCode; // set only by HEART (TRANSFER_REVERT) and LEFT ARM (HONEYPOT)
  notProvided?: boolean; // LEGS only: no handle supplied
}

export interface PartResult {
  part: PartId;
  label: "HEAD" | "HEART" | "LEFT ARM" | "RIGHT ARM" | "LEGS";
  source: "Sourcify" | "On-chain" | "GoPlus" | "DexScreener" | "fxtwitter";
  state: CheckState;
  finding: string;
  evidenceUrl?: string;
  notProvided?: boolean;
  points: number; // earned
  maxPoints: number; // weight (0 for not-provided LEGS)
}

export interface VerdictResponse {
  address: string; // lowercased
  chain: { id: ChainId; name: string; line: string };
  token?: { name?: string; symbol?: string };
  verdict: "ALIVE" | "DEAD";
  score: number; // integer 0-100
  band: ScoreBand;
  vetoes: { code: VetoCode; reason: string }[];
  parts: PartResult[]; // always 5, fixed order
  unavailableCount: number;
  weakerNote?: string;
  meaning: string;
  topFindings: PartId[];
  cached: boolean;
  checkedAt: string; // ISO timestamp
}

export type ErrorCode =
  | "BAD_REQUEST"
  | "INVALID_ADDRESS"
  | "INVALID_HANDLE"
  | "NO_CONTRACT"
  | "CHAIN_DETECTION_UNAVAILABLE"
  | "ALL_SOURCES_DOWN"
  | "INTERNAL";

export interface ErrorResponse {
  error: { code: ErrorCode; message: string };
}
