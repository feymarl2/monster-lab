---
inclusion: always
---

# Tech Stack and Verified Source Facts

## Stack (fixed for v1)
- Next.js (App Router) + TypeScript. One repo holds the page and the API routes.
- Tailwind CSS for styling (dark lab theme, green stitches).
- Inline SVG monster art; no image assets. Parts must be recolourable per check state.
- Deploy target: Vercel free tier.
- ZERO web3 libraries (no ethers, viem, web3.js). All on-chain reads are plain JSON-RPC `fetch` calls with constant selectors.
- ZERO database. Verdicts are computed live; a server-side in-memory cache (60s, keyed by chain+address) covers repeat views.
- ZERO environment variables and ZERO API keys. Every source is keyless; do not add anything that needs a secret.
- License: MIT (LICENSE file at repo root).
- Verdict synthesis is a deterministic rule-based scorer in `lib/scoring.ts`. No external AI API on the critical path.

## Universal rule
If a source errors, times out, or returns an unexpected shape, that check renders UNKNOWN (grey). It is NEVER rendered as SAFE/healthy. A failed read must not inflate the verdict. Show "N check(s) unavailable — verdict is weaker than usual."

## Hard vetoes
`is_honeypot` = "1" (GoPlus), or transfer simulation revert, or no contract code (`eth_getCode` = `0x`) forces DEAD ON ARRIVAL regardless of score.

## Verified facts (do not re-derive; they were checked 12 Nov 2026)

### Sourcify (check a)
- Use API v2 ONLY: `GET https://sourcify.dev/server/v2/contract/{chainId}/{address}`. v1 is REMOVED (`/check-by-addresses` returns 404 "API v1 is removed"). Never use v1 paths. Never use Etherscan/BscScan APIs (they need keys).
- HTTP 200 with non-null `match` = verified (`"match"` or `"exact_match"`). HTTP 404 with `match: null` = unverified. Any other status: retry once, then UNKNOWN.
- Chain IDs: 56 (BSC), 8453 (Base).

### GoPlus (check c)
- `GET https://api.gopluslabs.io/api/v1/token_security/{chainId}?contract_addresses={address}`. Envelope `{"code":1,"message":"OK","result":{...}}`, keyed by the LOWERCASED address. All values are strings; flags are "0"/"1".
- `is_honeypot`, `buy_tax`, `sell_tax`, `is_proxy` are real fields. Also real: `is_mintable`, `selfdestruct`, `hidden_owner`, `can_take_back_ownership`, `transfer_pausable`, `trading_cooldown`, `is_blacklisted`, `slippage_modifiable`, `anti_whale_modifiable`, `creator_percent`, `owner_percent`, `holder_count`, `holders[]`, `is_open_source`.
- Tax comes from GoPlus `buy_tax`/`sell_tax`, NOT from eth_call. A plain `eth_call` of `transfer` returns only a boolean, so tax cannot be measured from it. Do not claim otherwise.
- NOT present (never code against): `owner_address`, `cannot_sell_all`, `dex`.
- `is_open_source` corroborates Sourcify but never replaces it.
- `holders[]` supplies the `from` address for the transfer simulation.

### On-chain reads (check b)
- `eth_getCode`: `0x` = not a contract.
- Proxy detection: EIP-1967 slot `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` via `eth_getStorageAt`. Base USDC reads ZERO at this slot yet is a proxy (non-1967 layout), so GoPlus `is_proxy` is the PRIMARY proxy signal; the slot read is corroboration only, never the sole test.
- Transfer simulation: `eth_call` with `from` = top holder from GoPlus `holders[]`, `to` = token, data = `transfer(address,uint256)` selector `0xa9059cbb` to a dead address with a small amount. `0x…01` = success; revert = honeypot signal. It is one vote, not proof of safety.
- Selectors: `decimals()` `0x313ce567`, `totalSupply()` `0x18160ddd`, `owner()` `0x8da5cb5b` (revert = no owner signal).
- RPC endpoints:
  - BSC: `https://bsc-dataseed2.bnbchain.org`, `https://bsc-dataseed3.bnbchain.org`, `https://bsc-dataseed4.bnbchain.org`, fallback `https://bsc.publicnode.com`. A browser User-Agent header is REQUIRED on BSC requests (UA-less are rejected).
  - `bsc-dataseed1` is BANNED. Never use it, never default to it. Rotate endpoints and keep request volume low.
  - Base: `https://base-rpc.publicnode.com` (no special UA).

### DexScreener (check d)
- `GET https://api.dexscreener.com/token-pairs/v1/{chainSlug}/{tokenAddress}` with slugs `bsc` and `base`. Returns a JSON ARRAY of pairs.
- Use the top pair by `liquidity.usd`. Fields: `liquidity.usd`, `volume.h24`, `txns.h24`, `pairCreatedAt`, `fdv`, `marketCap`, `url` (evidence link).
- Liquidity under $5k = thin (rotten). Non-array or empty array = no market (code defensively; empty-pair shape was not observed).

### X / KOL reputation (check e)
- `GET https://api.fxtwitter.com/{username}` ONLY, with a real browser User-Agent and up to 3 retries (transient bodies without a `user` key happen; take the consistent reading; all fail = UNKNOWN).
- NEVER use `api.vxtwitter.com`. It has served fabricated profile data. This is a standing hard rule.
- A valid-format handle that does not exist returns HTTP 404 `{"code":404,"message":"User not found"}` (observed in the build) = handle does not exist (ROTTEN). An HTTP 302 (redirect to github.com/FxEmbed/FxEmbed) only appears for names that are not valid handles, which the handle regex rejects before any request; treat a 302 as "does not exist" too, defensively. Handle any other non-200/non-JSON response explicitly (retry, then UNKNOWN).
- Fields used: `user.verification.verified`, `followers`, `tweets`, `description`, `website.url`.
- The X handle is OPTIONAL user input. No handle = "not provided" (neutral grey), not a penalty. Never infer a handle from a token name.

### Unverified (do not treat as fact)
Rate limits for every source; DexScreener empty-pair response shape; balance-delta tax simulation (v2 idea only, do not build v1 on it).

## Server-side requirement
All five checks run in the serverless route. The fxtwitter browser UA and BSC UA rules cannot be set reliably from a browser, and direct browser calls would hit CORS. Each check has its own timeout; checks run in parallel.
