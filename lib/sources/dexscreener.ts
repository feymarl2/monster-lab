import { CHAINS, TIMEOUTS_MS } from "../constants";
import { asNumeric, asString, isRecord } from "../guards";
import type { ChainId, CheckResult } from "../types";

export const THIN_LIQUIDITY_USD = 5_000;
export const RIGHT_ARM_MAX = 20;
export const RIGHT_ARM_HEALTHY_MIN = 9;

export interface DexPair {
  liquidityUsd: number;
  volumeH24?: number;
  txnsH24?: number; // buys + sells
  pairCreatedAt?: number; // ms epoch
  fdv?: number;
  marketCap?: number;
  url?: string;
}

export interface DexData {
  pair?: DexPair;
  points: number; // earned RIGHT ARM points (0-20)
}

/** Pure. `now` injectable for determinism. */
export function scoreRightArm(pair: DexPair, now: number = Date.now()): number {
  const l = pair.liquidityUsd;
  let liquidity = 0;
  if (l >= 100_000) liquidity = 14;
  else if (l >= 25_000) liquidity = 11;
  else if (l >= THIN_LIQUIDITY_USD) liquidity = 7;

  let activity = 0;
  const txns = pair.txnsH24 ?? 0;
  const vol = pair.volumeH24 ?? 0;
  if (txns >= 50 && vol >= 1_000) activity = 6;
  else if (txns > 0) activity = 3;

  const isNew = pair.pairCreatedAt !== undefined && now - pair.pairCreatedAt < 24 * 60 * 60 * 1000;
  const penalty = isNew ? 4 : 0;
  return Math.min(RIGHT_ARM_MAX, Math.max(0, liquidity + activity - penalty));
}

function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function parsePair(value: unknown): DexPair | undefined {
  if (!isRecord(value)) return undefined;
  const liq = isRecord(value.liquidity) ? asNumeric(value.liquidity.usd) : undefined;
  if (liq === undefined) return undefined;
  const volume = isRecord(value.volume) ? asNumeric(value.volume.h24) : undefined;
  let txns: number | undefined;
  if (isRecord(value.txns) && isRecord(value.txns.h24)) {
    const buys = asNumeric(value.txns.h24.buys);
    const sells = asNumeric(value.txns.h24.sells);
    if (buys !== undefined || sells !== undefined) txns = (buys ?? 0) + (sells ?? 0);
  }
  return {
    liquidityUsd: liq,
    volumeH24: volume,
    txnsH24: txns,
    pairCreatedAt: asNumeric(value.pairCreatedAt),
    fdv: asNumeric(value.fdv),
    marketCap: asNumeric(value.marketCap),
    url: asString(value.url),
  };
}

export async function checkDexscreener(chain: ChainId, address: string): Promise<CheckResult<DexData>> {
  const url = `https://api.dexscreener.com/token-pairs/v1/${CHAINS[chain].slug}/${address.toLowerCase()}`;
  const unavailable: CheckResult<DexData> = {
    state: "unknown",
    finding: "DexScreener market data could not be read — liquidity unknown",
    evidenceUrl: url,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS_MS.dexscreener);
  let body: unknown;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status !== 200) return unavailable;
    body = await res.json();
  } catch {
    return unavailable;
  } finally {
    clearTimeout(timer);
  }

  if (!Array.isArray(body)) return unavailable; // empty-pair shape was never observed; non-array is NOT "no market"
  if (body.length === 0) {
    return {
      state: "rotten",
      finding: "No trading pairs found — there is no market for this token",
      evidenceUrl: url,
      data: { points: 0 },
    };
  }

  const pairs = body.map(parsePair).filter((p): p is DexPair => p !== undefined);
  if (pairs.length === 0) return unavailable; // pairs present but none readable

  const top = pairs.reduce((a, b) => (b.liquidityUsd > a.liquidityUsd ? b : a));
  const evidenceUrl = top.url ?? url;

  if (top.liquidityUsd < THIN_LIQUIDITY_USD) {
    return {
      state: "rotten",
      finding: `Liquidity ${fmtUsd(top.liquidityUsd)} — effectively no market`,
      evidenceUrl,
      data: { pair: top, points: scoreRightArm(top) },
    };
  }

  const points = scoreRightArm(top);
  const vol = top.volumeH24 !== undefined ? `, 24h volume ${fmtUsd(top.volumeH24)}` : "";
  const isNew = top.pairCreatedAt !== undefined && Date.now() - top.pairCreatedAt < 24 * 60 * 60 * 1000;
  const newNote = isNew ? " The market is less than a day old." : "";
  const healthy = points >= RIGHT_ARM_HEALTHY_MIN;
  return {
    state: healthy ? "healthy" : "rotten",
    finding: `Liquidity ${fmtUsd(top.liquidityUsd)}${vol}.${newNote}`,
    evidenceUrl,
    data: { pair: top, points },
  };
}
