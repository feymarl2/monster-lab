import { CHAINS, DEAD_ADDRESS, EIP1967_IMPL_SLOT, SELECTORS, TIMEOUTS_MS } from "../constants";
import { isRecord } from "../guards";
import { rpcCall } from "../rpc";
import type { ChainId, CheckResult } from "../types";
import type { GoplusData } from "./goplus";

// Plain JSON-RPC only; no web3 library.

export type DetectResult =
  | { chain: ChainId }
  | { none: true }
  | { unavailable: true };

type CodeProbe = "code" | "empty" | "failed";

async function probeCode(chain: ChainId, address: string): Promise<CodeProbe> {
  const r = await rpcCall(chain, "eth_getCode", [address, "latest"]);
  if (!r.ok) return "failed";
  if (typeof r.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(r.result)) return "failed";
  return r.result === "0x" ? "empty" : "code";
}

async function detectInner(address: string, forcedChain?: ChainId): Promise<DetectResult> {
  if (forcedChain !== undefined) {
    const p = await probeCode(forcedChain, address);
    if (p === "code") return { chain: forcedChain };
    return p === "empty" ? { none: true } : { unavailable: true };
  }
  const bsc = await probeCode(56, address);
  if (bsc === "code") return { chain: 56 };
  // A failed BSC probe never lets us conclude Base: a BSC contract would be mislabelled.
  if (bsc === "failed") return { unavailable: true };
  const base = await probeCode(8453, address);
  if (base === "code") return { chain: 8453 };
  return base === "empty" ? { none: true } : { unavailable: true };
}

/** BNB Chain first, then Base. Whole step is capped; on cap → unavailable. */
export async function detectChain(address: string, forcedChain?: ChainId): Promise<DetectResult> {
  const cap = new Promise<DetectResult>((resolve) =>
    setTimeout(() => resolve({ unavailable: true }), TIMEOUTS_MS.chainDetection),
  );
  try {
    return await Promise.race([detectInner(address, forcedChain), cap]);
  } catch {
    return { unavailable: true };
  }
}

export interface OnchainData {
  proxy: boolean;
  slotNonZero?: boolean;
}

function buildTransferCalldata(): string {
  const dead = DEAD_ADDRESS.slice(2).toLowerCase().padStart(64, "0");
  const amount = (1).toString(16).padStart(64, "0");
  return `${SELECTORS.transfer}${dead}${amount}`;
}

export async function checkOnchain(
  chain: ChainId,
  address: string,
  goplus: CheckResult,
): Promise<CheckResult<OnchainData>> {
  const evidenceUrl = `${CHAINS[chain].explorerUrl}/address/${address.toLowerCase()}`;

  // Contract code + EIP-1967 slot (corroboration only), in parallel.
  const [code, slot] = await Promise.all([
    probeCode(chain, address),
    rpcCall(chain, "eth_getStorageAt", [address, EIP1967_IMPL_SLOT, "latest"]),
  ]);

  if (code === "empty") {
    return {
      state: "rotten",
      finding: "There is no contract code at this address.",
      evidenceUrl,
      veto: "NO_CODE",
    };
  }
  if (code === "failed") {
    return { state: "unknown", finding: "The blockchain could not be read — transfer check unavailable", evidenceUrl };
  }

  let slotNonZero: boolean | undefined;
  if (slot.ok && typeof slot.result === "string" && /^0x[0-9a-fA-F]+$/.test(slot.result)) {
    slotNonZero = /[1-9a-fA-F]/.test(slot.result.slice(2));
  }
  const gp = isRecord(goplus.data) ? (goplus.data as unknown as GoplusData) : undefined;
  // GoPlus is the PRIMARY proxy signal; a zero slot never proves "not a proxy".
  const proxy = slotNonZero === true || gp?.isProxy === true;
  const proxyNote = proxy ? " The contract is an upgradeable proxy, so its code can be swapped later." : "";
  const data: OnchainData = { proxy, slotNonZero };

  const holder = gp?.holders.find((h) => {
    const bal = Number.parseFloat(h.balance);
    return Number.isFinite(bal) && bal > 0 && /^0x[0-9a-fA-F]{40}$/.test(h.address);
  });
  if (!holder) {
    return {
      state: "unknown",
      finding: `No holder was available to simulate a transfer.${proxyNote}`,
      evidenceUrl,
      data,
    };
  }

  const sim = await rpcCall(chain, "eth_call", [
    { from: holder.address, to: address.toLowerCase(), data: buildTransferCalldata() },
    "latest",
  ]);

  if (!sim.ok) {
    if (sim.kind === "revert") return revertResult(evidenceUrl, data);
    return {
      state: "unknown",
      finding: `The transfer simulation could not be run — result unknown.${proxyNote}`,
      evidenceUrl,
      data,
    };
  }

  const out = typeof sim.result === "string" ? sim.result : undefined;
  if (out === "0x") return successResult(evidenceUrl, data, proxyNote);
  if (out !== undefined && /^0x[0-9a-fA-F]{64}$/.test(out)) {
    if (/^0x0{64}$/.test(out)) return revertResult(evidenceUrl, data);
    if (out.endsWith("01")) return successResult(evidenceUrl, data, proxyNote);
  }
  return {
    state: "unknown",
    finding: `The transfer simulation returned an unexpected answer — result unknown.${proxyNote}`,
    evidenceUrl,
    data,
  };
}

function successResult(evidenceUrl: string, data: OnchainData, proxyNote: string): CheckResult<OnchainData> {
  return {
    state: "healthy",
    finding: `A top holder's transfer succeeded in simulation — one signal, not proof of safety.${proxyNote}`,
    evidenceUrl,
    data,
  };
}

function revertResult(evidenceUrl: string, data: OnchainData): CheckResult<OnchainData> {
  return {
    state: "rotten",
    finding: "A real holder's transfer was blocked in simulation — transfers appear restricted.",
    evidenceUrl,
    veto: "TRANSFER_REVERT",
    data,
  };
}
