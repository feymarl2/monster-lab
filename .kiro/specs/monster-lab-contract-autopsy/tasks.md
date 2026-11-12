# Implementation Plan

Conventions: tasks are sequenced so each one builds on the last and ends with something checkable. Tasks marked with `*` are optional (unit tests). Run `npx tsc --noEmit` after each code task. No task may add an API key, environment variable, database, or web3 library. Never add `.kiro` to any ignore file.

- [x] 1. Scaffold the project and configuration
  - [x] 1.1 Create the Next.js App Router + TypeScript + Tailwind project at the repo root
    - Create `package.json` (pinned exact versions of `next`, `react`, `react-dom`, `typescript`, `tailwindcss`, `@types/node`, `@types/react`, `@types/react-dom`, and the Tailwind PostCSS plugin; scripts `dev`, `build`, `start`, `typecheck` = `tsc --noEmit`), `next.config.ts`, `tsconfig.json` with `"strict": true`, `postcss.config.mjs`, and `.gitignore` (node_modules, .next, .vercel, *.log, .env*; MUST NOT contain `.kiro`)
    - Run `npm install` and confirm `package.json` has no `ethers`, `viem`, `web3`, or similar
    - _Requirements: 15.2, 15.4, 15.7, 15.8_
  - [x] 1.2 Create the folder skeleton and shared modules
    - Create `lib/types.ts` (`CheckState`, `PartId`, `VetoCode`, `ScoreBand`, `ChainId`, `ChainInfo`, `CheckResult`, `PartResult`, `VerdictResponse`, `ErrorCode`)
    - Create `lib/constants.ts` with UPPER_SNAKE_CASE constants: `ADDRESS_REGEX`, `HANDLE_REGEX`, `BROWSER_USER_AGENT`, `BSC_RPC_ENDPOINTS` (dataseed2, dataseed3, dataseed4, `https://bsc.publicnode.com`), `BASE_RPC_ENDPOINTS`, `EIP1967_IMPL_SLOT`, `SELECTORS` (`transfer` `0xa9059cbb`, `decimals` `0x313ce567`, `totalSupply` `0x18160ddd`, `owner` `0x8da5cb5b`), `DEAD_ADDRESS`, `CHAINS` (56 BNB Chain / `bsc`, 8453 Base / `base`, with explorer URLs `https://bscscan.com` and `https://basescan.org` used for plain links only), `SCORE_WEIGHTS` (20/20/30/20/10), `TIMEOUTS_MS`, `CACHE_TTL_MS` = 60000, `DISCLAIMER`
    - Verify: `npx tsc --noEmit` passes and `grep -rn "dataseed1" lib app components` returns nothing
    - _Requirements: 1.2, 2.3, 3.7, 3.8, 15.6_
  - [x] 1.3 Create the app shell
    - Create `app/layout.tsx` (title "Monster Lab — contract autopsy", description, viewport meta, dark body, footer disclaimer "Automated checks, not financial advice. Always DYOR."), a minimal `app/page.tsx` placeholder heading, and `app/globals.css` with the Tailwind import
    - Verify: `npm run build` succeeds
    - _Requirements: 12.9, 15.8_

- [x] 2. Implement shared server helpers
  - [x] 2.1 Implement `lib/rpc.ts`
    - `rpcCall(chain, method, params)` using `fetch` JSON-RPC 2.0 with a 4 s `AbortController` timeout per attempt
    - BSC: send `BROWSER_USER_AGENT`, rotate the starting endpoint with a module-level counter, fall back through the list on transport failure; Base: single endpoint with one retry
    - Classify JSON-RPC errors: `code === 3` or message contains `revert` → `{ ok:false, kind:"revert" }` (no rotation); everything else → `transport`
    - Add a module-load assertion that throws if any endpoint URL contains `bsc-dataseed1`
    - Verify with a throwaway `node` call: `eth_getCode` for WBNB on chain 56 returns non-`0x`; USDC on 8453 returns non-`0x`
    - _Requirements: 3.7, 3.8, 3.9, 15.6_
  - [x] 2.2 Implement `lib/cache.ts`
    - Module-level `Map` keyed `${chain}:${address}` (lowercased), 60 s TTL, expired entries deleted on read, cap 500 entries (evict oldest); export `cacheGet` and `cacheSet`
    - Verify: a short script sets then gets (hit), and a get after the TTL is simulated by injecting a timestamp (miss)
    - _Requirements: 9.8, 9.9_
  - [x] 2.3 Implement `withTimeout` and JSON narrowing helpers
    - Add `lib/guards.ts` (`isRecord`, `asString`, `asNumber`, `withTimeout(promise, ms, label)` that resolves to an `unknown` `CheckResult` on timeout or rejection) — no I/O
    - _Requirements: 9.3, 9.4, 15.7_

- [x] 3. Implement the five source modules (one task per check)
  - [x] 3.1 Implement `lib/sources/sourcify.ts` (HEAD)
    - `checkSourcify(chain, address)` calling `GET https://sourcify.dev/server/v2/contract/{chainId}/{address}`; map statuses per the design table (200 + non-null `match` → healthy; 404 + `match:null` → rotten; else retry once → unknown); `evidenceUrl` = the v2 URL
    - Verify live: WBNB on 56 → healthy; USDC on 8453 → healthy; `0x0000000000000000000000000000000000000001` on 56 → rotten
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 3.2 Implement `lib/sources/goplus.ts` (LEFT ARM)
    - `checkGoplus(chain, address)` with lowercased address; parse the envelope (`code === 1`, `result[address]`); narrow string flags; compute tax from `buy_tax`/`sell_tax` (missing/NaN = "not reported", never 0); apply the deduction table; `is_honeypot === "1"` → rotten + `veto: "HONEYPOT"`; expose `holders`, `is_proxy`, `is_open_source`, `token_name`, `token_symbol` in `data`; plain-language phrases per flag; export pure `scoreLeftArm(flags)` for the Scorer
    - Verify live: WBNB on 56 and USDC on 8453 parse without error; record the observed `creator_percent` format and confirm or correct the unit note in `design.md` "Open points"
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_
  - [x] 3.3 Implement `lib/sources/onchain.ts` (HEART)
    - `detectChain(address, forcedChain?)`: `eth_getCode` BSC then Base; outcomes `{ chain }`, `{ none }` (both `0x`, no probe failed), `{ unavailable }`; a failed BSC probe never allows concluding Base
    - `checkOnchain(chain, address, goplus)`: read the EIP-1967 slot with `eth_getStorageAt` (corroboration only; note proxy in the finding when non-zero; use GoPlus `is_proxy` as primary); pick the first `holders[]` entry with a positive balance; build the `transfer` calldata (`0xa9059cbb` + padded dead address + amount 1); map results: `…01` or `0x` empty → healthy; revert or zero word → rotten + `veto: "TRANSFER_REVERT"`; transport failure or no holder → unknown (no veto); `evidenceUrl` = explorer address page; finding text says "one signal, not proof of safety"
    - Verify live: WBNB on 56 → `detectChain` returns 56 and simulation succeeds; USDC on 8453 → `detectChain` returns 8453; `0x000000000000000000000000000000000000dEaD` → `none` (record the actual result)
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_
  - [x] 3.4 Implement `lib/sources/dexscreener.ts` (RIGHT ARM)
    - `checkDexscreener(chain, address)` using slugs `bsc`/`base`; non-array or malformed → unknown; empty array → rotten "No trading pairs found — there is no market for this token"; top pair by `liquidity.usd`; liquidity < 5000 → rotten with the dollar amount in the finding; export pure `scoreRightArm(pair)` for the Scorer (liquidity + activity − new-pair penalty); `evidenceUrl` = pair `url` or the request URL
    - Verify live: WBNB on 56 and USDC on 8453 return healthy with a pair URL
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [x] 3.5 Implement `lib/sources/fxtwitter.ts` (LEGS)
    - `checkFxtwitter(handle?)`: no handle → `{ state:"unknown", notProvided:true, finding:"No X handle provided — reputation check skipped" }`; else `GET https://api.fxtwitter.com/{username}` with `BROWSER_USER_AGENT`, `redirect: "manual"`, up to 3 attempts (body without `user` = transient); 302 → rotten "handle does not exist on X"; all attempts failed → unknown; success → read `verification.verified`, `followers`, `tweets`, `description`, `website.url`; export pure `scoreLegs(user)`; `evidenceUrl` = `https://x.com/{username}`; the string `vxtwitter` must not appear anywhere in source
    - Verify live with one real handle of a known project (pick one by inspecting a real response, never invent) and with a clearly non-existent handle (expect the 302 path); record both results
    - _Requirements: 2.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 15.6_

- [x] 4. Implement the scoring module
  - [x] 4.1 Implement `lib/scoring.ts` (pure, no imports from `lib/sources` I/O paths)
    - `scoreVerdict(input)` computing earned points per part from the design tables (HEAD 20, HEART 20, LEFT ARM 30, RIGHT ARM 20, LEGS 10), `available` = 100 or 90 when LEGS not provided, `score = round(100*earned/available)` clamped 0–100, `unknown` earns 0
    - Vetoes `HONEYPOT`, `TRANSFER_REVERT`, `NO_CODE` with plain-language reasons; verdict `DEAD` if any veto or score < 60 else `ALIVE`; band by score ranges (display only)
    - Build `weakerNote` ("1 check unavailable — verdict is weaker than usual." / "N checks unavailable — …"), `meaning` paragraph via the deterministic template, and `topFindings` ordering (veto cause, rotten by weight, unknown, healthy by weight)
    - Verify: `npx tsc --noEmit`; a throwaway script calls `scoreVerdict` with all-healthy inputs (expect 100, ALIVE, thriving) and with a HONEYPOT veto at score 100 (expect DEAD)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 9.6_
  - [ ]* 4.2 Add unit tests for the scorer
    - Add `vitest` as a pinned devDependency and a `test` script; cover: weights sum to 100; unknown never raises the score; LEGS not-provided rescale (earned 90/90 → 100); each veto forces DEAD at score 100; band boundaries 39/40/59/60/79/80; verdict at exactly 59 and 60; determinism (same input twice → deep-equal output)
    - _Requirements: 10.1–10.9_

- [x] 5. Implement the API route
  - [x] 5.1 Implement `app/api/verdict/route.ts`
    - `export const maxDuration = 30`; `export const dynamic = "force-dynamic"`
    - Parse and validate body (`BAD_REQUEST`, `INVALID_ADDRESS`, `INVALID_HANDLE`, optional `chain` of 56/8453); lowercase address; strip leading `@` from handle
    - Cache lookup for 56 then 8453 before probing; on miss run `detectChain`; map `none` → 404 `NO_CONTRACT`, `unavailable` → 502 `CHAIN_DETECTION_UNAVAILABLE`
    - Start GoPlus first, then run HEAD, HEART (awaiting GoPlus), RIGHT ARM, LEGS in parallel through `Promise.allSettled` with the per-check timeouts from the design; map any rejection to `unknown`; append the `is_open_source` sentence to the HEAD finding
    - Cache the four address-level results only when none is `unknown`; run `scoreVerdict`; if every Check that ran is `unknown` return 502 `ALL_SOURCES_DOWN`; otherwise return the `VerdictResponse` with `cached` and `checkedAt`
    - Wrap everything in try/catch → 500 `INTERNAL` with a generic message
    - _Requirements: 1.5, 1.6, 2.4, 3.1–3.9, 9.1–9.11_
  - [ ] 5.2 Smoke-test the route locally
    - With `npm run dev` running (user starts it; do not start long-running servers from the agent shell), `curl -s -X POST localhost:3000/api/verdict -H 'content-type: application/json' -d '{"address":"0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"}'` returns HTTP 200 with `chain.id` 56 and five parts; invalid address returns 400 `INVALID_ADDRESS`; invalid handle returns 400 `INVALID_HANDLE`; a repeated request returns `cached: true`
    - _Requirements: 1.5, 2.4, 3.3, 9.8_

- [x] 6. Build the UI components
  - [x] 6.1 Implement `components/BodyPart.tsx`
    - Props `{ id, label, state | "pending", finding?, revealed, reducedMotion }`; renders an SVG `<g>` with thread-line draw, then fill (green healthy, red + ooze path rotten, grey unknown/pending); text label HEALTHY / ROTTEN / UNKNOWN plus icon; neutral "not provided" styling for LEGS
    - _Requirements: 11.2, 11.3, 11.6, 11.9_
  - [x] 6.2 Implement `components/Monster.tsx`
    - Inline SVG figure on a slab with five body-part groups (head, heart, left arm, right arm, legs); renders `BodyPart` x5 in fixed order; supports `shaking`; fully grey when nothing is revealed
    - _Requirements: 11.1, 11.5, 11.8, 12.1_
  - [x] 6.3 Implement `components/VerdictStamp.tsx`
    - "IT'S ALIVE" (green) or "DEAD ON ARRIVAL" (red), big score number, band label; slam animation class when `slammed`
    - _Requirements: 12.1, 12.2_
  - [x] 6.4 Implement `components/CheckList.tsx`
    - Five rows with state badge, finding, evidence link (`target="_blank" rel="noopener noreferrer"`); `topFindings` emphasised and first on mobile; veto reasons block above the list
    - _Requirements: 12.4, 12.5, 12.7_
  - [x] 6.5 Implement `components/AddressForm.tsx`
    - Address input (placeholder "Paste a token contract address (0x…)"), optional handle input (label "Project's X handle (optional, for the reputation check)"), STITCH IT button disabled until valid, inline hints, chain result line, 44 px minimum touch targets, mobile-friendly input attributes
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 2.1, 2.2, 2.3, 3.3_

- [x] 7. Build the page, state machine, and styling
  - [x] 7.1 Implement `app/page.tsx` state machine
    - Client component with states `idle | loading | revealing | verdict | error`; one `fetch` to `/api/verdict` with 25 s `AbortController`; `isVerdictResponse` runtime guard (bad shape → lost-power error); timed reveal every 600 ms in order HEAD, HEART, LEFT ARM, RIGHT ARM, LEGS (instant, still ordered, with `prefers-reduced-motion`); progress line "Stitching… K of 5 parts attached." in an `aria-live="polite"` region; after the fifth part: shake, light flicker, stamp slam; clear timers on unmount and reset
    - _Requirements: 9.1, 11.1, 11.4, 11.5, 11.7, 12.1, 14.4, 14.6, 14.9_
  - [x] 7.2 Implement the verdict screen and actions
    - Show stamp, score, band, unavailable-checks note, "What this means", chain line, token name/symbol, findings list; "Stitch another" (reset, grey monster, focus address input); "Copy verdict" (plain-text format from the design, "Copied!" for ~2 s, read-only textarea fallback with "Copy failed — select the text and copy it manually")
    - _Requirements: 12.2–12.8, 13.1–13.5_
  - [x] 7.3 Implement all error states
    - Invalid address (inline, no request); `NO_CONTRACT` message with hint; `CHAIN_DETECTION_UNAVAILABLE` / `ALL_SOURCES_DOWN` / `INTERNAL` / network error / timeout → "The lab lost power — try again" with a "Try again" button; inputs preserved; never a blank monster area
    - _Requirements: 14.1–14.9_
  - [x] 7.4 Implement the lab theme in `app/globals.css`
    - Tailwind import, CSS variable tokens (`--stitch-green`, `--rot-red`, `--unknown-grey`, lab-light glow), keyframes `stitch-draw`, `stamp-slam`, `monster-shake`, `lab-flicker`, and a `prefers-reduced-motion` block disabling them; single-column mobile-first layout, max width ~480 px centred
    - Verify in a 390 × 844 viewport that stamp, score, and top 3 findings are above the fold
    - _Requirements: 11.2, 11.7, 12.7_

- [x] 8. Create hooks (use the `createHook` tool; do not hand-write hook JSON)
  - [x] 8.1 Banned-source guard hook
    - Trigger `PostFileSave`, matcher `\.(ts|tsx)$`, command action: `grep -rnE "vxtwitter|bsc-dataseed1|check-by-addresses|etherscan\.io/api|api\.bscscan|from ['\"](ethers|viem|web3)" app lib components && { echo 'Banned source or web3 import found (see .kiro/steering/tech.md)' >&2; exit 1; } || exit 0`
    - _Requirements: 15.4, 15.6_
  - [x] 8.2 Typecheck-on-save hook
    - Trigger `PostFileSave`, matcher `\.(ts|tsx)$`, command `npx tsc --noEmit`
    - _Requirements: 15.7_
  - [x] 8.3 `.kiro` ignore guard hook
    - Trigger `PostFileSave`, matcher `(^|/)\.gitignore$`, command `grep -nE '^\s*/?\.kiro/?\s*$' .gitignore && { echo '.kiro must never be gitignored' >&2; exit 1; } || exit 0`
    - _Requirements: 15.2_
  - [x] 8.4 Verify each hook
    - Save a temp `.ts` file containing the banned string and confirm the guard reports it, then remove the temp file; confirm the hook files exist in `.kiro/hooks/`
    - _Requirements: 15.2_

- [x] 9. README and LICENSE
  - [x] 9.1 Create `LICENSE`
    - Standard MIT text, copyright year 2026, holder name taken from `git config user.name` if set, otherwise ask the user
    - _Requirements: 15.1_
  - [x] 9.2 Create `README.md`
    - What Monster Lab is; the five checks and body parts; how to run (`npm install`, `npm run dev`, `npm run build`); the keyless/databaseless/no-web3 statement; the verdict rules and score bands; the Kiro usage write-up pointer (how specs, steering, and hooks shaped the build, referencing `.kiro/specs/monster-lab-contract-autopsy/`, `.kiro/steering/`, `.kiro/hooks/`); Vercel deploy steps (import repo, no env vars); the footer disclaimer; real demo addresses only (WBNB, USDC, plus the confirmed scam example from task 10.3)
    - _Requirements: 15.1, 15.5, 15.8_

- [ ] 10. Final build and live-verdict verification
  - [x] 10.1 Static verification
    - Run `npx tsc --noEmit` and `npm run build`; both must pass with no errors
    - `grep -rniE "vxtwitter|bsc-dataseed1|check-by-addresses" app lib components` returns nothing; `package.json` has no web3 library; `.gitignore` does not contain `.kiro`; `LICENSE` is MIT
    - _Requirements: 15.1, 15.2, 15.4, 15.6, 15.7_
  - [ ] 10.2 Live verdicts for the two real test addresses (against `npm run start` after `npm run build`, started by the user)
    - WBNB on BSC: `curl` with `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` must return `chain.id` 56, five parts, HEAD healthy, verdict `ALIVE`, score ≥ 60, no vetoes, and a DexScreener pair URL on RIGHT ARM; LEGS must be `notProvided`
    - USDC on Base: `curl` with `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` must return `chain.id` 8453, five parts, no veto, HEAD healthy; the proxy note must come from GoPlus `is_proxy` even though the EIP-1967 slot reads zero; record the actual score and verdict honestly (do not assert a specific verdict for USDC beyond the facts above)
    - Repeat the WBNB request within 60 s and confirm `cached: true`
    - Pass an optional `xHandle` for a real handle verified in task 3.5 and confirm LEGS returns a non-`notProvided` result
    - _Requirements: 3.1–3.3, 4.2, 5.8, 5.9, 7.5, 9.8, 10.4, 12.2_
  - [x] 10.3 Find and confirm a real scam example
    - Use GoPlus (and a transfer-simulation check) to find a real token with `is_honeypot` = "1" or a high sell tax on BSC or Base; independently confirm the flags in the raw GoPlus response; submit it through `/api/verdict` and confirm verdict `DEAD` with a veto (or sub-60 score) and a rotten LEFT ARM; record the address and the evidence in the README. If none can be confirmed, say so and do not invent one
    - _Requirements: 6.3, 10.5, 10.6, 15.5_
  - [ ] 10.4 Error-state verification
    - Invalid address → 400 `INVALID_ADDRESS`; handle `bad handle!` → 400 `INVALID_HANDLE`; `0x000000000000000000000000000000000000dEaD` (or another address confirmed to have no code on both chains) → 404 `NO_CONTRACT`; simulate a single-source failure (temporarily point one source URL at an unreachable host in a local branch, confirm that part is `unknown`, `weakerNote` is present, the score did not rise, then revert the change)
    - _Requirements: 1.5, 2.4, 3.4, 9.4, 9.5, 9.6, 14.2, 14.5_
  - [ ] 10.5 UI walkthrough at mobile width
    - In a 390 × 844 viewport verify: STITCH IT disabled for invalid input; chain line text; fixed reveal order with ~600 ms spacing and progress line; stamp, score, and top 3 findings above the fold; evidence links open in a new tab; "Copy verdict" produces the documented text and shows "Copied!"; "Stitch another" resets and focuses the input; reduced-motion mode reveals instantly in order; footer disclaimer visible
    - Note: needs a live-browser mobile walkthrough (manual, owner).
    - _Requirements: 1.2, 11.1–11.9, 12.1–12.9, 13.1–13.5, 14.7_
  - [ ] 10.6 Deployment readiness
    - Confirm the repo has no env vars, `.kiro/` is tracked (`git ls-files .kiro` lists specs, steering, and hooks), and the README's Vercel steps are accurate. Importing the repo into Vercel and sharing the public URL is a manual step for the user
    - Note: needs the git repo + Vercel import (manual steps for the owner).
    - _Requirements: 15.2, 15.8_

## Coordinator verification (13 Nov 2026)

Supplied evidence, not re-run in this pass:
- Task 5.2 smoke test passed: WBNB returned 200 with chain 56 and five parts; invalid address returned 400 INVALID_ADDRESS; invalid handle returned 400 INVALID_HANDLE; a repeat request returned cached:true.
- Task 10.2 live verdicts passed: WBNB ALIVE 100, USDC ALIVE 98, SQUID DEAD 44 with HONEYPOT veto.
- Task 10.4 error states passed: NO_CONTRACT 404; single-source DexScreener outage made RIGHT ARM unknown with weakerNote present and score 78 (down from 100), then reverted and rebuilt.
- Task 10.5 left open: needs a live-browser mobile walkthrough (manual, owner).
- Task 10.6 left open: needs the git repo + Vercel import (manual steps for the owner).
