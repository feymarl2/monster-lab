import type { CheckResult } from "./types";

// Pure helpers: JSON narrowing and timeout wrapper. No I/O.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Parse a numeric value that may arrive as a number or a numeric string. */
export function asNumeric(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function unknownResult<D = unknown>(finding: string): CheckResult<D> {
  return { state: "unknown", finding };
}

/**
 * Resolves with the promise's value, or with an `unknown` CheckResult on timeout or rejection.
 * A failed read must never become healthy.
 */
export function withTimeout<T extends CheckResult>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<CheckResult> {
  return new Promise<CheckResult>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ state: "unknown", finding: `${label} timed out — this check is unavailable` });
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve({ state: "unknown", finding: `${label} failed — this check is unavailable` });
      },
    );
  });
}
