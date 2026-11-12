import { BROWSER_USER_AGENT, HANDLE_REGEX, TIMEOUTS_MS } from "../constants";
import { asNumeric, asString, isRecord } from "../guards";
import type { CheckResult } from "../types";

// api.fxtwitter.com ONLY, with a real browser User-Agent. Up to 3 attempts.

export const LEGS_MAX = 10;
export const LEGS_HEALTHY_MIN = 5;
const MAX_ATTEMPTS = 3;

export interface XUser {
  verified: boolean;
  followers?: number;
  tweets?: number;
  description?: string;
  websiteUrl?: string;
}

export interface LegsData {
  user?: XUser;
  points: number; // earned LEGS points (0-10)
}

/** Pure. */
export function scoreLegs(user: XUser): number {
  let pts = 0;
  if (user.verified) pts += 4;
  const f = user.followers ?? 0;
  if (f >= 10_000) pts += 3;
  else if (f >= 1_000) pts += 2;
  else if (f >= 100) pts += 1;
  if ((user.tweets ?? 0) >= 100) pts += 1;
  if ((user.description ?? "").trim() !== "" || (user.websiteUrl ?? "").trim() !== "") pts += 2;
  return Math.min(LEGS_MAX, pts);
}

type Attempt =
  | { kind: "user"; user: XUser }
  | { kind: "missing" } // 302 or explicit 404 "User not found": handle does not exist
  | { kind: "failed" };

function parseUser(body: unknown): XUser | undefined {
  if (!isRecord(body) || !isRecord(body.user)) return undefined;
  const u = body.user;
  const verification = isRecord(u.verification) ? u.verification : undefined;
  const website = isRecord(u.website) ? u.website : undefined;
  return {
    verified: verification?.verified === true,
    followers: asNumeric(u.followers),
    tweets: asNumeric(u.tweets),
    description: asString(u.description),
    websiteUrl: website ? asString(website.url) : undefined,
  };
}

async function attemptOnce(username: string): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS_MS.fxtwitterAttempt);
  try {
    const res = await fetch(`https://api.fxtwitter.com/${username}`, {
      headers: { "user-agent": BROWSER_USER_AGENT, accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 302) return { kind: "missing" };
    if (res.status !== 200 && res.status !== 404) return { kind: "failed" };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { kind: "failed" };
    }
    // Observed live 12 Nov 2026: a well-formed but non-existent handle returns HTTP 404
    // {"code":404,"message":"User not found"}. That explicit body means "does not exist".
    // A bare 404 without that body is just a failed attempt.
    if (res.status === 404) {
      return isRecord(body) && body.code === 404 && body.message === "User not found"
        ? { kind: "missing" }
        : { kind: "failed" };
    }
    const user = parseUser(body); // a body without `user` is a transient failure
    return user ? { kind: "user", user } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkFxtwitter(handle?: string): Promise<CheckResult<LegsData>> {
  if (handle === undefined || handle.trim() === "") {
    return { state: "unknown", notProvided: true, finding: "No X handle provided — reputation check skipped" };
  }
  const username = handle.trim().replace(/^@/, "");
  const evidenceUrl = `https://x.com/${username}`;
  if (!HANDLE_REGEX.test(username)) {
    return { state: "unknown", finding: "That X handle is not valid — reputation check skipped", evidenceUrl };
  }

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const a = await attemptOnce(username);
    if (a.kind === "missing") {
      return {
        state: "rotten",
        finding: `The handle @${username} does not exist on X`,
        evidenceUrl,
        data: { points: 0 },
      };
    }
    if (a.kind === "user") {
      const points = scoreLegs(a.user);
      const bits: string[] = [];
      bits.push(a.user.verified ? "verified account" : "unverified account");
      if (a.user.followers !== undefined) bits.push(`${a.user.followers.toLocaleString("en-US")} followers`);
      if (a.user.tweets !== undefined) bits.push(`${a.user.tweets.toLocaleString("en-US")} posts`);
      return {
        state: points >= LEGS_HEALTHY_MIN ? "healthy" : "rotten",
        finding: `@${username}: ${bits.join(", ")}.`,
        evidenceUrl,
        data: { user: a.user, points },
      };
    }
  }
  return {
    state: "unknown",
    finding: "X profile data could not be read — reputation unknown",
    evidenceUrl,
  };
}
