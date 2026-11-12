import type { ChainId, ChainInfo, PartId } from "./types";

export const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
export const HANDLE_REGEX = /^[A-Za-z0-9_]{1,15}$/;

// Real browser UA. Required on BSC RPC requests and for fxtwitter.
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// The first BNB dataseed host is BANNED (403s after sustained polling). Never add it to this list.
export const BSC_RPC_ENDPOINTS: readonly string[] = [
  "https://bsc-dataseed2.bnbchain.org",
  "https://bsc-dataseed3.bnbchain.org",
  "https://bsc-dataseed4.bnbchain.org",
  "https://bsc.publicnode.com",
];
export const BASE_RPC_ENDPOINTS: readonly string[] = ["https://base-rpc.publicnode.com"];

export const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export const SELECTORS = {
  transfer: "0xa9059cbb",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
  owner: "0x8da5cb5b",
} as const;

export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

export const CHAINS: Record<ChainId, ChainInfo> = {
  56: { id: 56, name: "BNB Chain", slug: "bsc", explorerUrl: "https://bscscan.com" },
  8453: { id: 8453, name: "Base", slug: "base", explorerUrl: "https://basescan.org" },
};

export const SCORE_WEIGHTS: Record<PartId, number> = {
  head: 20,
  heart: 20,
  leftArm: 30,
  rightArm: 20,
  legs: 10,
};

export const TIMEOUTS_MS = {
  rpcAttempt: 4_000,
  chainDetection: 8_000,
  sourcifyAttempt: 6_000,
  sourcify: 14_000,
  goplus: 8_000,
  dexscreener: 8_000,
  onchain: 8_000,
  heart: 16_000,
  fxtwitterAttempt: 4_000,
  fxtwitter: 14_000,
  routeDeadline: 20_000,
} as const;

export const CACHE_TTL_MS = 60_000;
export const CACHE_MAX_ENTRIES = 500;

export const DISCLAIMER = "Automated checks, not financial advice. Always DYOR.";
