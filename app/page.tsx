"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AddressForm, { isValidAddress, isValidHandle } from "@/components/AddressForm";
import CheckList from "@/components/CheckList";
import Monster, { PART_ORDER } from "@/components/Monster";
import VerdictStamp from "@/components/VerdictStamp";
import { DISCLAIMER } from "@/lib/constants";
import type { CheckState, PartId, PartResult, VerdictResponse } from "@/lib/types";

type Phase = "idle" | "loading" | "revealing" | "verdict" | "error";
type ErrorKind = "no-contract" | "lost-power";

const REQUEST_TIMEOUT_MS = 25_000;
const REVEAL_INTERVAL_MS = 600;
const FIRST_REVEAL_DELAY_MS = 350;
const COPIED_MS = 2_000;
const TOTAL_PARTS = 5;

// ---- Runtime guard for the API response (bad shape => "lab lost power") ----

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const STATES: readonly string[] = ["healthy", "rotten", "unknown"];
const BANDS: readonly string[] = ["corpse", "twitching", "alive", "thriving"];
const VETO_CODES: readonly string[] = ["HONEYPOT", "TRANSFER_REVERT", "NO_CODE"];

function isPartResult(v: unknown, expected: PartId): v is PartResult {
  return (
    isObj(v) &&
    v.part === expected &&
    typeof v.label === "string" &&
    typeof v.source === "string" &&
    typeof v.state === "string" &&
    STATES.includes(v.state) &&
    typeof v.finding === "string" &&
    (v.evidenceUrl === undefined || v.evidenceUrl === null || typeof v.evidenceUrl === "string") &&
    (v.notProvided === undefined || typeof v.notProvided === "boolean") &&
    typeof v.points === "number" &&
    typeof v.maxPoints === "number"
  );
}

function isVerdictResponse(v: unknown): v is VerdictResponse {
  if (!isObj(v)) return false;
  if (typeof v.address !== "string") return false;
  if (!isObj(v.chain) || typeof v.chain.name !== "string" || typeof v.chain.line !== "string") return false;
  if (v.verdict !== "ALIVE" && v.verdict !== "DEAD") return false;
  if (typeof v.score !== "number" || !Number.isFinite(v.score)) return false;
  if (typeof v.band !== "string" || !BANDS.includes(v.band)) return false;
  if (typeof v.meaning !== "string") return false;
  if (typeof v.cached !== "boolean" || typeof v.checkedAt !== "string") return false;
  if (typeof v.unavailableCount !== "number") return false;
  if (v.weakerNote !== undefined && v.weakerNote !== null && typeof v.weakerNote !== "string") return false;
  if (v.token !== undefined && v.token !== null) {
    if (!isObj(v.token)) return false;
    if (v.token.name !== undefined && typeof v.token.name !== "string") return false;
    if (v.token.symbol !== undefined && typeof v.token.symbol !== "string") return false;
  }
  if (!Array.isArray(v.vetoes)) return false;
  for (const veto of v.vetoes) {
    if (!isObj(veto) || typeof veto.code !== "string" || !VETO_CODES.includes(veto.code)) return false;
    if (typeof veto.reason !== "string") return false;
  }
  if (!Array.isArray(v.parts) || v.parts.length !== TOTAL_PARTS) return false;
  for (let i = 0; i < TOTAL_PARTS; i++) {
    if (!isPartResult(v.parts[i], PART_ORDER[i].id)) return false;
  }
  if (!Array.isArray(v.topFindings)) return false;
  const ids: string[] = PART_ORDER.map((p) => p.id);
  if (!v.topFindings.every((id) => typeof id === "string" && ids.includes(id))) return false;
  return true;
}

// ---- Copy text ----

const STATE_WORD: Record<CheckState, string> = { healthy: "HEALTHY", rotten: "ROTTEN", unknown: "UNKNOWN" };

function buildCopyText(v: VerdictResponse): string {
  const stamp = v.verdict === "ALIVE" ? "IT'S ALIVE" : "DEAD ON ARRIVAL";
  const lines = [
    `MONSTER LAB VERDICT: ${stamp} (${v.score}/100, ${v.band})`,
    `Chain: ${v.chain.name}`,
    `Address: ${v.address}`,
    ...v.parts.map((p) => `${p.label}: ${p.notProvided ? "UNKNOWN" : STATE_WORD[p.state]} - ${p.finding}`),
  ];
  if (v.weakerNote) lines.push(v.weakerNote);
  lines.push(DISCLAIMER);
  return lines.join("\n");
}

export default function Page() {
  const [address, setAddress] = useState("");
  const [handle, setHandle] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [verdict, setVerdict] = useState<VerdictResponse | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [shaking, setShaking] = useState(false);
  const [flicker, setFlicker] = useState(false);
  const [slammed, setSlammed] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);

  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
  }, []);

  // prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Clear timers and abort any in-flight request on unmount.
  useEffect(() => {
    return () => {
      clearTimers();
      abortRef.current?.abort();
    };
  }, [clearTimers]);

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  }, []);

  const finishReveal = useCallback(
    (reduced: boolean) => {
      setPhase("verdict");
      setSlammed(true);
      if (!reduced) {
        setShaking(true);
        setFlicker(true);
        later(() => setShaking(false), 600);
        later(() => setFlicker(false), 950);
      }
    },
    [later],
  );

  const startReveal = useCallback(
    (reduced: boolean) => {
      setPhase("revealing");
      setRevealedCount(0);
      if (reduced) {
        // Instant, still ordered: all five land in fixed order in one update.
        setRevealedCount(TOTAL_PARTS);
        finishReveal(true);
        return;
      }
      for (let k = 1; k <= TOTAL_PARTS; k++) {
        later(
          () => {
            setRevealedCount(k);
            if (k === TOTAL_PARTS) finishReveal(false);
          },
          FIRST_REVEAL_DELAY_MS + (k - 1) * REVEAL_INTERVAL_MS,
        );
      }
    },
    [finishReveal, later],
  );

  const submit = useCallback(async () => {
    // Client-side validation: no request for an invalid address or handle.
    if (!isValidAddress(address) || !isValidHandle(handle)) return;

    clearTimers();
    abortRef.current?.abort();
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    setPhase("loading");
    setVerdict(null);
    setErrorKind(null);
    setErrorMessage("");
    setRevealedCount(0);
    setShaking(false);
    setFlicker(false);
    setSlammed(false);
    setCopied(false);
    setCopyFallback(null);

    const strippedHandle = handle.trim().replace(/^@/, "");
    const payload: { address: string; xHandle?: string } = { address: address.trim() };
    if (strippedHandle !== "") payload.xHandle = strippedHandle;

    const lostPower = () => {
      setErrorKind("lost-power");
      setErrorMessage("The lab lost power — try again");
      setPhase("error");
    };

    try {
      const res = await fetch("/api/verdict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        if (requestId === requestIdRef.current) lostPower();
        return;
      }
      if (requestId !== requestIdRef.current) return;

      if (!res.ok) {
        const code = isObj(body) && isObj(body.error) ? body.error.code : undefined;
        if (code === "NO_CONTRACT") {
          setErrorKind("no-contract");
          setErrorMessage("No contract found at this address on BNB Chain or Base");
          setPhase("error");
        } else {
          lostPower();
        }
        return;
      }
      if (!isVerdictResponse(body)) {
        lostPower();
        return;
      }
      setVerdict(body);
      startReveal(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      // Network error or 25 s abort (superseded requests are ignored via requestId).
      if (requestId === requestIdRef.current) lostPower();
    } finally {
      clearTimeout(timeout);
    }
  }, [address, handle, clearTimers, startReveal]);

  const reset = useCallback(() => {
    clearTimers();
    abortRef.current?.abort();
    requestIdRef.current++;
    setPhase("idle");
    setVerdict(null);
    setErrorKind(null);
    setErrorMessage("");
    setRevealedCount(0);
    setShaking(false);
    setFlicker(false);
    setSlammed(false);
    setCopied(false);
    setCopyFallback(null);
    setAddress("");
    setHandle("");
    // Focus after the form is back in the DOM.
    setTimeout(() => addressInputRef.current?.focus(), 0);
  }, [clearTimers]);

  const copyVerdict = useCallback(async () => {
    if (!verdict) return;
    const text = buildCopyText(verdict);
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(text);
      setCopyFallback(null);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      setCopied(false);
      setCopyFallback(text);
    }
  }, [verdict]);

  // ---- Derived view data ----
  const partsById: Partial<Record<PartId, PartResult>> = {};
  if (verdict) for (const p of verdict.parts) partsById[p.part] = p;
  const revealed: PartId[] = PART_ORDER.slice(0, revealedCount).map((p) => p.id);
  const busy = phase === "loading" || phase === "revealing";
  const showForm = phase !== "verdict";

  let liveText = "";
  if (phase === "loading") liveText = "Warming up the lab…";
  else if (phase === "revealing") liveText = `Stitching… ${revealedCount} of ${TOTAL_PARTS} parts attached.`;
  else if (phase === "verdict" && verdict)
    liveText = `Verdict: ${verdict.verdict === "ALIVE" ? "It's alive" : "Dead on arrival"}, score ${verdict.score} out of 100.`;
  else if (phase === "error") liveText = errorMessage;

  const tokenLabel = verdict?.token
    ? [verdict.token.name, verdict.token.symbol ? `(${verdict.token.symbol})` : undefined].filter(Boolean).join(" ")
    : "";

  return (
    <main className="lab-shell py-4">
      <header className="mb-2 text-center">
        <h1 className="lab-glow-text text-3xl font-black tracking-wider">MONSTER LAB</h1>
        {phase !== "verdict" && (
          <p className="text-sm text-[var(--lab-muted)]">
            Paste a token contract. Five sources get stitched into one verdict.
          </p>
        )}
      </header>

      <div aria-live="polite" role="status" className={phase === "idle" ? "sr-only" : "mb-2 text-center text-sm text-[var(--lab-muted)]"}>
        {liveText}
      </div>

      <Monster
        parts={partsById}
        revealed={revealed}
        shaking={shaking}
        flicker={flicker}
        reducedMotion={reducedMotion}
        compact={phase === "verdict"}
      />

      {phase === "loading" && (
        <p className="mt-2 text-center text-sm text-[var(--lab-muted)]">Warming up the lab…</p>
      )}

      {phase === "revealing" && (
        <ul className="mt-2 space-y-1 text-sm">
          {PART_ORDER.slice(0, revealedCount).map(({ id, label }) => {
            const p = partsById[id];
            return p ? (
              <li key={id}>
                <span className="font-bold">{label}:</span> {p.finding}
              </li>
            ) : null;
          })}
        </ul>
      )}

      {phase === "error" && (
        <div
          role="alert"
          className="lab-panel mt-3 p-4 text-center"
          style={{ borderColor: errorKind === "no-contract" ? "var(--unknown-grey)" : "var(--rot-red)" }}
        >
          <p className="text-base font-bold">{errorMessage}</p>
          {errorKind === "no-contract" ? (
            <p className="mt-1 text-sm text-[var(--lab-muted)]">
              Double-check the address — it may belong to another network or contain a typo.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              className="mt-3 min-h-[44px] rounded-lg px-6 font-black tracking-wider text-black focus:outline-2 focus:outline-offset-2 focus:outline-white"
              style={{ background: "var(--stitch-green)" }}
            >
              Try again
            </button>
          )}
        </div>
      )}

      {showForm && (
        <div className="mt-4">
          <AddressForm
            address={address}
            handle={handle}
            onAddressChange={setAddress}
            onHandleChange={setHandle}
            onSubmit={() => void submit()}
            disabled={busy}
            chainLine={phase === "revealing" ? verdict?.chain.line : undefined}
            addressInputRef={addressInputRef}
          />
        </div>
      )}

      {phase === "verdict" && verdict && (
        <div className="mt-2">
          <VerdictStamp verdict={verdict.verdict} score={verdict.score} band={verdict.band} slammed={slammed} />

          {verdict.weakerNote && (
            <p className="mt-1 text-center text-sm font-semibold" style={{ color: "var(--unknown-grey)" }}>
              {verdict.weakerNote}
            </p>
          )}

          <p className="mt-2 text-center text-sm font-semibold" style={{ color: "var(--stitch-green)" }}>
            {verdict.chain.line}
            {tokenLabel && <span className="text-[var(--lab-text)]"> · {tokenLabel}</span>}
          </p>

          <div className="mt-3">
            <CheckList parts={verdict.parts} topFindings={verdict.topFindings} vetoes={verdict.vetoes} />
          </div>

          <section className="lab-panel mt-4 p-4" aria-label="What this means">
            <h2 className="text-sm font-black uppercase tracking-wider text-[var(--lab-muted)]">What this means</h2>
            <p className="mt-1 text-base">{verdict.meaning}</p>
          </section>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => void copyVerdict()}
              className="min-h-[44px] rounded-lg border-2 px-3 font-bold focus:outline-2 focus:outline-offset-2 focus:outline-white"
              style={{ borderColor: "var(--stitch-green)", color: "var(--stitch-green)" }}
            >
              {copied ? "Copied!" : "Copy verdict"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="min-h-[44px] rounded-lg px-3 font-black text-black focus:outline-2 focus:outline-offset-2 focus:outline-white"
              style={{ background: "var(--stitch-green)" }}
            >
              Stitch another
            </button>
          </div>

          {copyFallback !== null && (
            <div className="mt-3" role="alert">
              <p className="text-sm" style={{ color: "var(--rot-red)" }}>
                Copy failed — select the text and copy it manually
              </p>
              <textarea
                readOnly
                aria-label="Verdict text"
                value={copyFallback}
                rows={10}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-1 w-full rounded-lg border bg-[var(--lab-surface-2)] p-2 font-mono text-xs"
                style={{ borderColor: "var(--lab-border)" }}
              />
            </div>
          )}
        </div>
      )}
    </main>
  );
}
