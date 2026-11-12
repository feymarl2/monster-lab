import { CACHE_MAX_ENTRIES, CACHE_TTL_MS } from "./constants";
import type { ChainId, CheckResult } from "./types";

export interface AddressChecks {
  head: CheckResult;
  heart: CheckResult;
  leftArm: CheckResult;
  rightArm: CheckResult;
  token?: { name?: string; symbol?: string };
  checkedAt: string;
}

interface Entry {
  value: AddressChecks;
  storedAt: number;
}

const store = new Map<string, Entry>();

function key(chain: ChainId, address: string): string {
  return `${chain}:${address.toLowerCase()}`;
}

/** `now` is injectable for testing TTL expiry. */
export function cacheGet(chain: ChainId, address: string, now: number = Date.now()): AddressChecks | undefined {
  const k = key(chain, address);
  const entry = store.get(k);
  if (!entry) return undefined;
  if (now - entry.storedAt >= CACHE_TTL_MS) {
    store.delete(k);
    return undefined;
  }
  return entry.value;
}

export function cacheSet(chain: ChainId, address: string, value: AddressChecks, now: number = Date.now()): void {
  const k = key(chain, address);
  store.delete(k); // re-insert so Map order reflects age
  store.set(k, { value, storedAt: now });
  while (store.size > CACHE_MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}
