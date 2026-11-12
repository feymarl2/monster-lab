import { NextResponse } from "next/server";
import { cacheGet, cacheSet, type AddressChecks } from "@/lib/cache";
import { ADDRESS_REGEX, CHAINS, HANDLE_REGEX, SCORE_WEIGHTS, TIMEOUTS_MS } from "@/lib/constants";
import { isRecord, withTimeout } from "@/lib/guards";
import { scoreVerdict } from "@/lib/scoring";
import { checkDexscreener } from "@/lib/sources/dexscreener";
import { checkFxtwitter } from "@/lib/sources/fxtwitter";
import { checkGoplus, type GoplusData } from "@/lib/sources/goplus";
import { checkOnchain, detectChain } from "@/lib/sources/onchain";
import { checkSourcify } from "@/lib/sources/sourcify";
import type {
  ChainId,
  CheckResult,
  ErrorCode,
  ErrorResponse,
  PartId,
  PartResult,
  VerdictResponse,
} from "@/lib/types";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

function fail(status: number, code: ErrorCode, message: string): NextResponse<ErrorResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}

const PART_META: Record<PartId, Pick<PartResult, "label" | "source">> = {
  head: { label: "HEAD", source: "Sourcify" },
  heart: { label: "HEART", source: "On-chain" },
  leftArm: { label: "LEFT ARM", source: "GoPlus" },
  rightArm: { label: "RIGHT ARM", source: "DexScreener" },
  legs: { label: "LEGS", source: "fxtwitter" },
};

function settle(r: PromiseSettledResult<CheckResult>, label: string): CheckResult {
  if (r.status === "fulfilled") return r.value;
  return { state: "unknown", finding: `${label} failed — this check is unavailable` };
}

/** Append GoPlus is_open_source agreement/disagreement to the HEAD finding. Never changes state. */
function withOpenSourceNote(head: CheckResult, goplus: CheckResult): CheckResult {
  if (head.state === "unknown") return head;
  const data = isRecord(goplus.data) ? (goplus.data as unknown as GoplusData) : undefined;
  const openSource = data?.isOpenSource;
  if (openSource === undefined) return head;
  let note: string;
  if (head.state === "healthy") {
    note = openSource ? " GoPlus agrees." : " GoPlus does not list it as open source.";
  } else {
    note = openSource ? " GoPlus lists it as open source, so this may be a Sourcify gap." : " GoPlus agrees.";
  }
  const base = /[.!?]$/.test(head.finding) ? head.finding : head.finding + ".";
  return { ...head, finding: base + note };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // --- Parse and validate ---
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, "BAD_REQUEST", "Request body must be valid JSON.");
    }
    if (!isRecord(body)) return fail(400, "BAD_REQUEST", "Request body must be a JSON object.");

    const rawAddress = body.address;
    if (typeof rawAddress !== "string" || !ADDRESS_REGEX.test(rawAddress.trim())) {
      return fail(400, "INVALID_ADDRESS", "Address must be 0x followed by 40 hex characters.");
    }
    const address = rawAddress.trim().toLowerCase();

    let handle: string | undefined;
    const rawHandle = body.xHandle;
    if (rawHandle !== undefined && rawHandle !== null && rawHandle !== "") {
      const stripped = typeof rawHandle === "string" ? rawHandle.trim().replace(/^@/, "") : "";
      if (stripped !== "") {
        if (!HANDLE_REGEX.test(stripped)) {
          return fail(400, "INVALID_HANDLE", "X handle must be 1-15 letters, numbers, or underscores.");
        }
        handle = stripped;
      }
    }

    let forcedChain: ChainId | undefined;
    if (body.chain !== undefined && body.chain !== null) {
      if (body.chain !== 56 && body.chain !== 8453) {
        return fail(400, "BAD_REQUEST", "chain, if given, must be 56 or 8453.");
      }
      forcedChain = body.chain;
    }

    // --- Cache lookup (56 then 8453) before probing the chain ---
    let chain: ChainId | undefined;
    let cached: AddressChecks | undefined;
    for (const candidate of forcedChain !== undefined ? [forcedChain] : ([56, 8453] as ChainId[])) {
      const hit = cacheGet(candidate, address);
      if (hit) {
        chain = candidate;
        cached = hit;
        break;
      }
    }

    // --- Chain detection on miss ---
    if (!chain) {
      const detected = await detectChain(address, forcedChain);
      if ("none" in detected) {
        return fail(404, "NO_CONTRACT", "No contract found at this address on BNB Chain or Base.");
      }
      if ("unavailable" in detected) {
        return fail(502, "CHAIN_DETECTION_UNAVAILABLE", "Could not determine the chain right now. Try again.");
      }
      chain = detected.chain;
    }

    // --- Run checks ---
    let head: CheckResult;
    let heart: CheckResult;
    let leftArm: CheckResult;
    let rightArm: CheckResult;
    let legs: CheckResult;
    let token: AddressChecks["token"];
    let checkedAt: string;

    if (cached) {
      ({ head, heart, leftArm, rightArm, token, checkedAt } = cached);
      legs = await withTimeout(checkFxtwitter(handle), TIMEOUTS_MS.fxtwitter, "X lookup");
    } else {
      const resolvedChain = chain;
      const goplusP = withTimeout(checkGoplus(resolvedChain, address), TIMEOUTS_MS.goplus, "GoPlus");
      const headP = withTimeout(checkSourcify(resolvedChain, address), TIMEOUTS_MS.sourcify, "Sourcify");
      const heartP = withTimeout(
        goplusP.then((g) =>
          withTimeout(checkOnchain(resolvedChain, address, g), TIMEOUTS_MS.onchain, "On-chain read"),
        ),
        TIMEOUTS_MS.heart,
        "On-chain read",
      );
      const armP = withTimeout(checkDexscreener(resolvedChain, address), TIMEOUTS_MS.dexscreener, "DexScreener");
      const legsP = withTimeout(checkFxtwitter(handle), TIMEOUTS_MS.fxtwitter, "X lookup");

      const results = await Promise.allSettled([headP, heartP, goplusP, armP, legsP]);
      const rawHead = settle(results[0], "Sourcify");
      heart = settle(results[1], "On-chain read");
      leftArm = settle(results[2], "GoPlus");
      rightArm = settle(results[3], "DexScreener");
      legs = settle(results[4], "X lookup");
      head = withOpenSourceNote(rawHead, leftArm);

      const gp = isRecord(leftArm.data) ? (leftArm.data as unknown as GoplusData) : undefined;
      token = gp ? { name: gp.tokenName, symbol: gp.tokenSymbol } : undefined;
      checkedAt = new Date().toISOString();

      // Never pin a transient failure: cache only when no address-level part is unknown.
      if ([head, heart, leftArm, rightArm].every((r) => r.state !== "unknown")) {
        cacheSet(resolvedChain, address, { head, heart, leftArm, rightArm, token, checkedAt });
      }
    }

    // --- Every check that ran is unknown -> ALL_SOURCES_DOWN ---
    const ran = [head, heart, leftArm, rightArm, ...(legs.notProvided ? [] : [legs])];
    if (ran.every((r) => r.state === "unknown")) {
      return fail(502, "ALL_SOURCES_DOWN", "Every data source failed. Try again in a moment.");
    }

    // --- Score ---
    const legsProvided = !legs.notProvided;
    const scored = scoreVerdict({
      hasCode: true, // detectChain / cache hit confirmed contract code
      parts: { head, heart, leftArm, rightArm, legs },
      legsProvided,
    });

    const partResults: Record<PartId, CheckResult> = { head, heart, leftArm, rightArm, legs };
    const order: PartId[] = ["head", "heart", "leftArm", "rightArm", "legs"];
    const parts: PartResult[] = order.map((id) => ({
      part: id,
      ...PART_META[id],
      state: partResults[id].state,
      finding: partResults[id].finding,
      evidenceUrl: partResults[id].evidenceUrl,
      notProvided: partResults[id].notProvided,
      points: scored.points[id].earned,
      maxPoints: id === "legs" && !legsProvided ? 0 : SCORE_WEIGHTS[id],
    }));

    const info = CHAINS[chain];
    const response: VerdictResponse = {
      address,
      chain: { id: info.id, name: info.name, line: `Found on ${info.name}` },
      token: token && (token.name || token.symbol) ? token : undefined,
      verdict: scored.verdict,
      score: scored.score,
      band: scored.band,
      vetoes: scored.vetoes,
      parts,
      unavailableCount: scored.unavailableCount,
      weakerNote: scored.weakerNote,
      meaning: scored.meaning,
      topFindings: scored.topFindings,
      cached: cached !== undefined,
      checkedAt,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("verdict route failed:", err instanceof Error ? err.message : "unknown error");
    return fail(500, "INTERNAL", "Something went wrong in the lab. Try again.");
  }
}
