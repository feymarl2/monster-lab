import { TIMEOUTS_MS } from "../constants";
import { asNumeric, asString, isRecord } from "../guards";
import type { ChainId, CheckResult } from "../types";

// GoPlus token_security. All values are strings; flags are "0"/"1".
// Never code against owner_address, cannot_sell_all, dex (not reliably present).

export interface GoplusHolder {
  address: string;
  balance: string;
}

/** Normalised flags used by the pure scorer. `undefined` = not reported. */
export interface GoplusFlags {
  isHoneypot?: boolean;
  buyTax?: number; // percent, e.g. 5 = 5%
  sellTax?: number;
  isProxy?: boolean;
  isMintable?: boolean;
  selfdestruct?: boolean;
  hiddenOwner?: boolean;
  canTakeBackOwnership?: boolean;
  transferPausable?: boolean;
  tradingCooldown?: boolean;
  isBlacklisted?: boolean;
  slippageModifiable?: boolean;
  antiWhaleModifiable?: boolean;
  creatorPercent?: number; // FRACTION of supply (0.20 = 20%) — verified live 12 Nov 2026
}

export interface GoplusData {
  flags: GoplusFlags;
  holders: GoplusHolder[];
  isProxy?: boolean;
  isOpenSource?: boolean;
  tokenName?: string;
  tokenSymbol?: string;
  holderCount?: number;
  ownerPercent?: number;
  points: number; // earned LEFT ARM points (0-30)
  raised: string[]; // plain-language phrases for each raised risk
}

export const LEFT_ARM_MAX = 30;
export const LEFT_ARM_HEALTHY_MIN = 21;

export interface LeftArmScore {
  earned: number;
  raised: string[]; // plain-language phrases, most severe first
}

/** Pure: applies the design's deduction table. Honeypot handling is done by the caller (state + veto). */
export function scoreLeftArm(flags: GoplusFlags): LeftArmScore {
  let earned = LEFT_ARM_MAX;
  const raised: string[] = [];
  const deduct = (points: number, phrase: string) => {
    earned -= points;
    raised.push(phrase);
  };

  const { buyTax, sellTax } = flags;
  const taxes = [buyTax, sellTax].filter((t): t is number => t !== undefined);
  const maxTax = taxes.length > 0 ? Math.max(...taxes) : undefined;
  if (maxTax !== undefined) {
    if (maxTax >= 10) deduct(15, `the token takes a very high tax on trades (up to ${fmtPct(maxTax)})`);
    else if (maxTax >= 5) deduct(8, `the token takes a noticeable tax on trades (up to ${fmtPct(maxTax)})`);
  }
  if (buyTax !== undefined && sellTax !== undefined && Math.abs(sellTax - buyTax) >= 5) {
    deduct(3, "buying and selling are taxed very differently");
  }
  if (flags.hiddenOwner) deduct(6, "there is a hidden owner who keeps control");
  if (flags.canTakeBackOwnership) deduct(6, "the owner can take back ownership after giving it up");
  if (flags.selfdestruct) deduct(6, "the contract can destroy itself");
  if (flags.isMintable) deduct(4, "the owner can create new tokens");
  if (flags.transferPausable) deduct(4, "the owner can pause all transfers");
  if (flags.creatorPercent !== undefined && flags.creatorPercent > 0.2) {
    deduct(4, `the creator holds ${fmtPct(flags.creatorPercent * 100)} of the supply`);
  }
  if (flags.isBlacklisted) deduct(3, "the owner can block specific wallets from trading");
  if (flags.slippageModifiable) deduct(3, "the owner can change the trading tax at will");
  if (flags.isProxy) deduct(2, "the contract can be swapped for new code later (upgradeable)");
  if (flags.tradingCooldown) deduct(2, "trading has a cooldown between trades");
  if (flags.antiWhaleModifiable) deduct(1, "the owner can change the max trade size");

  return { earned: Math.max(0, earned), raised };
}

function fmtPct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded}%`;
}

function flag(rec: Record<string, unknown>, key: string): boolean | undefined {
  const v = asString(rec[key]);
  if (v === "1") return true;
  if (v === "0") return false;
  return undefined;
}

function parseHolders(value: unknown): GoplusHolder[] {
  if (!Array.isArray(value)) return [];
  const out: GoplusHolder[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const address = asString(item.address);
    const balance = asString(item.balance);
    if (address !== undefined && balance !== undefined) out.push({ address, balance });
  }
  return out;
}

export async function checkGoplus(chain: ChainId, address: string): Promise<CheckResult<GoplusData>> {
  const key = address.toLowerCase();
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chain}?contract_addresses=${key}`;
  const unavailable: CheckResult<GoplusData> = {
    state: "unknown",
    finding: "GoPlus security data could not be read — risk flags unknown",
    evidenceUrl: url,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS_MS.goplus);
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

  if (!isRecord(body) || body.code !== 1 || !isRecord(body.result)) return unavailable;
  const rec = body.result[key];
  if (!isRecord(rec)) return unavailable;

  const buyTax = asNumeric(rec.buy_tax);
  const sellTax = asNumeric(rec.sell_tax);
  // GoPlus reports tax as a fraction (0.05 = 5%) — see convert below.
  const flags: GoplusFlags = {
    isHoneypot: flag(rec, "is_honeypot"),
    buyTax: buyTax === undefined ? undefined : buyTax * 100,
    sellTax: sellTax === undefined ? undefined : sellTax * 100,
    isProxy: flag(rec, "is_proxy"),
    isMintable: flag(rec, "is_mintable"),
    selfdestruct: flag(rec, "selfdestruct"),
    hiddenOwner: flag(rec, "hidden_owner"),
    canTakeBackOwnership: flag(rec, "can_take_back_ownership"),
    transferPausable: flag(rec, "transfer_pausable"),
    tradingCooldown: flag(rec, "trading_cooldown"),
    isBlacklisted: flag(rec, "is_blacklisted"),
    slippageModifiable: flag(rec, "slippage_modifiable"),
    antiWhaleModifiable: flag(rec, "anti_whale_modifiable"),
    creatorPercent: asNumeric(rec.creator_percent),
  };

  // Without is_honeypot we cannot say the token is not a honeypot: do not guess.
  if (flags.isHoneypot === undefined) return unavailable;

  const base = {
    flags,
    holders: parseHolders(rec.holders),
    isProxy: flags.isProxy,
    isOpenSource: flag(rec, "is_open_source"),
    tokenName: asString(rec.token_name) || undefined,
    tokenSymbol: asString(rec.token_symbol) || undefined,
    holderCount: asNumeric(rec.holder_count),
    ownerPercent: asNumeric(rec.owner_percent),
  };

  if (flags.isHoneypot) {
    const raised = scoreLeftArm(flags).raised;
    return {
      state: "rotten",
      finding: "GoPlus flags this token as a honeypot — buyers may not be able to sell.",
      evidenceUrl: url,
      veto: "HONEYPOT",
      data: { ...base, points: 0, raised },
    };
  }

  const { earned, raised } = scoreLeftArm(flags);
  const taxText = describeTax(flags.buyTax, flags.sellTax);
  const riskText = raised.length === 0 ? "no owner-power red flags raised" : `${raised.slice(0, 3).join("; ")}`;
  const healthy = earned >= LEFT_ARM_HEALTHY_MIN;
  return {
    state: healthy ? "healthy" : "rotten",
    finding: `${taxText}; ${riskText}.`,
    evidenceUrl: url,
    data: { ...base, points: earned, raised },
  };
}

function describeTax(buy: number | undefined, sell: number | undefined): string {
  if (buy === undefined && sell === undefined) return "Trade tax not reported by GoPlus";
  const b = buy === undefined ? "not reported" : fmtPct(buy);
  const s = sell === undefined ? "not reported" : fmtPct(sell);
  return `Buy tax ${b}, sell tax ${s}`;
}
