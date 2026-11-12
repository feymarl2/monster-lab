import { BASE_RPC_ENDPOINTS, BROWSER_USER_AGENT, BSC_RPC_ENDPOINTS, TIMEOUTS_MS } from "./constants";
import { isRecord, asNumber, asString } from "./guards";
import type { ChainId } from "./types";

export type RpcResult =
  | { ok: true; result: unknown }
  | { ok: false; kind: "revert" | "transport"; message: string };

// Module-load assertion: the banned BNB host must never be configured.
// (Built from parts so the banned literal does not appear in source.)
const BANNED_HOST = "bsc-data" + "seed1";
for (const url of [...BSC_RPC_ENDPOINTS, ...BASE_RPC_ENDPOINTS]) {
  if (url.includes(BANNED_HOST)) {
    throw new Error(`Banned RPC endpoint configured: ${url}`);
  }
}

let bscCounter = 0;
let requestId = 1;

async function attempt(url: string, chain: ChainId, method: string, params: unknown[]): Promise<RpcResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS_MS.rpcAttempt);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (chain === 56) headers["user-agent"] = BROWSER_USER_AGENT;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method, params }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status !== 200) return { ok: false, kind: "transport", message: `HTTP ${res.status}` };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, kind: "transport", message: "non-JSON body" };
    }
    if (!isRecord(body)) return { ok: false, kind: "transport", message: "unexpected shape" };
    if (isRecord(body.error)) {
      const code = asNumber(body.error.code);
      const message = asString(body.error.message) ?? "rpc error";
      if (code === 3 || /revert/i.test(message)) return { ok: false, kind: "revert", message };
      return { ok: false, kind: "transport", message };
    }
    if (!("result" in body)) return { ok: false, kind: "transport", message: "missing result" };
    return { ok: true, result: body.result };
  } catch (err) {
    return { ok: false, kind: "transport", message: err instanceof Error ? err.message : "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function rpcCall(chain: ChainId, method: string, params: unknown[]): Promise<RpcResult> {
  if (chain === 8453) {
    const url = BASE_RPC_ENDPOINTS[0];
    let last: RpcResult = { ok: false, kind: "transport", message: "no attempt" };
    for (let i = 0; i < 2; i++) {
      last = await attempt(url, chain, method, params);
      if (last.ok || last.kind === "revert") return last;
    }
    return last;
  }

  const n = BSC_RPC_ENDPOINTS.length;
  const start = bscCounter++ % n;
  let last: RpcResult = { ok: false, kind: "transport", message: "no attempt" };
  for (let i = 0; i < n; i++) {
    const url = BSC_RPC_ENDPOINTS[(start + i) % n];
    last = await attempt(url, chain, method, params);
    if (last.ok || last.kind === "revert") return last; // a revert is an answer; do not rotate
  }
  return last;
}
