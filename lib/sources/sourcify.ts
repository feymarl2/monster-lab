import { TIMEOUTS_MS } from "../constants";
import { asString, isRecord } from "../guards";
import type { ChainId, CheckResult } from "../types";

// Sourcify API v2 ONLY. v1 is removed. Never use Etherscan/BscScan APIs (they need keys).

const VERIFIED = "Source code verified on Sourcify";
const UNVERIFIED = "Source code is not verified — nobody can read what this contract does";
const UNREACHABLE = "Sourcify could not be reached — verification status unknown";

type Attempt = "verified" | "unverified" | "failed";

async function attemptOnce(url: string): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS_MS.sourcifyAttempt);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return "failed";
    }
    if (!isRecord(body)) return "failed";
    if (res.status === 200) {
      const match = asString(body.match);
      return match !== undefined ? "verified" : "failed"; // null/missing match is not a verdict
    }
    if (res.status === 404 && "match" in body && body.match === null) return "unverified";
    return "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

export async function checkSourcify(chain: ChainId, address: string): Promise<CheckResult> {
  const url = `https://sourcify.dev/server/v2/contract/${chain}/${address.toLowerCase()}`;
  let outcome = await attemptOnce(url);
  if (outcome === "failed") outcome = await attemptOnce(url); // retry once
  if (outcome === "verified") return { state: "healthy", finding: VERIFIED, evidenceUrl: url };
  if (outcome === "unverified") return { state: "rotten", finding: UNVERIFIED, evidenceUrl: url };
  return { state: "unknown", finding: UNREACHABLE, evidenceUrl: url };
}
