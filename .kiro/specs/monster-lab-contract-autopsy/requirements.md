# Requirements Document

## Introduction

Monster Lab is a Kiroween 2026 (Frankenstein category) web app. A user pastes a token contract address (and, optionally, the project's X handle), taps STITCH IT, and receives one verdict: **IT'S ALIVE** or **DEAD ON ARRIVAL**. The verdict comes with a 0–100 score, a plain-language explanation, and an evidence link for every finding.

Five incompatible, keyless sources are stitched into one verdict. Each source is a body part on the monster:

| Part | Source |
|---|---|
| HEAD | Sourcify v2 source-code verification |
| HEART | On-chain JSON-RPC reads (`eth_getCode`, EIP-1967 slot corroboration, transfer simulation) |
| LEFT ARM | GoPlus token security flags and buy/sell tax |
| RIGHT ARM | DexScreener top-pair liquidity and volume |
| LEGS | fxtwitter X profile reputation (only when a handle is supplied) |

All five checks run server-side, in parallel, behind a single `POST /api/verdict` route. A deterministic rule-based scorer (`lib/scoring.ts`) produces the score and applies hard vetoes. The browser makes exactly one request and then performs a timed, client-side reveal of the finished verdict.

Supported chains for v1: BNB Chain (chain ID 56) and Base (chain ID 8453). There is no chain picker.

Stack constraints (fixed): Next.js App Router, TypeScript strict mode, Tailwind CSS, inline SVG art, Vercel free tier, MIT license, zero web3 libraries, zero database, zero environment variables or API keys.

### Glossary

- **Lab**: the Monster Lab application as a whole (browser UI plus serverless API).
- **Verdict_API**: the route handler at `app/api/verdict/route.ts`.
- **Address_Form**: the `AddressForm` component (paste box, optional X-handle field, STITCH IT button, chain result line).
- **Monster**: the `Monster` SVG component composed of five `BodyPart` components.
- **Scorer**: the pure function module `lib/scoring.ts`.
- **Check**: one of the five source checks. Each returns a `CheckResult` of `{ state: "healthy" | "rotten" | "unknown", finding: string, evidenceUrl?: string, data? }`.
- **Part**: the presentation of one Check on the Monster (HEAD, HEART, LEFT ARM, RIGHT ARM, LEGS).
- **Hard_Veto**: a condition that forces DEAD ON ARRIVAL regardless of score: GoPlus `is_honeypot` = `"1"`, transfer-simulation revert, or no contract code.
- **UNKNOWN**: the grey Part state used when a source errors, times out, returns an unexpected shape, or (for LEGS) when no handle was provided.
- **Score_Band**: display label for the score: 0–39 corpse, 40–59 twitching, 60–79 alive, 80–100 thriving.
- **Browser_UA**: a real desktop-browser `User-Agent` header string held in a single constant.
- **Stamp**: the `VerdictStamp` component showing IT'S ALIVE or DEAD ON ARRIVAL plus the score.

## Requirements

### Requirement 1: Address input and validation

**User Story:** As a token buyer on a phone, I want to paste a contract address and be told immediately if it is malformed, so that I do not wait on a request that cannot succeed.

#### Acceptance Criteria

1. THE Address_Form SHALL provide a single address input with the placeholder "Paste a token contract address (0x…)" and a button labelled "STITCH IT".
2. WHILE the address input value does not match `^0x[0-9a-fA-F]{40}$` (after trimming surrounding whitespace), THE Address_Form SHALL keep the STITCH IT button disabled.
3. WHEN the user has entered a non-empty value that does not match `^0x[0-9a-fA-F]{40}$`, THE Address_Form SHALL show an inline hint beneath the input explaining that an address is "0x followed by 40 hex characters", without reloading the page.
4. WHEN the address input is empty, THE Address_Form SHALL show no error hint.
5. WHEN the Verdict_API receives an address that does not match `^0x[0-9a-fA-F]{40}$`, THE Verdict_API SHALL respond with HTTP 400 and an error body with code `INVALID_ADDRESS` before making any outbound request.
6. THE Verdict_API SHALL normalise every accepted address to lowercase for cache keys, GoPlus lookups, and all outbound requests.
7. THE Address_Form SHALL meet a minimum touch-target height of 44 px for the input and button so it is usable one-handed on a phone.

### Requirement 2: Optional X handle input

**User Story:** As a token buyer, I want to optionally provide the project's X handle, so that the reputation check can run when I know it and stay neutral when I do not.

#### Acceptance Criteria

1. THE Address_Form SHALL provide an optional second input labelled "Project's X handle (optional, for the reputation check)".
2. WHEN the user submits a handle with a leading `@`, THE Lab SHALL strip the leading `@` before sending it.
3. WHEN the handle (after stripping `@` and whitespace) is non-empty and does not match `^[A-Za-z0-9_]{1,15}$`, THE Address_Form SHALL show an inline hint and keep STITCH IT disabled.
4. WHEN the Verdict_API receives a non-empty handle that does not match `^[A-Za-z0-9_]{1,15}$`, THE Verdict_API SHALL respond with HTTP 400 and error code `INVALID_HANDLE`.
5. WHEN the handle is empty or absent, THE Lab SHALL treat the LEGS Check as "not provided" and SHALL NOT infer a handle from a token name, symbol, or any contract-to-handle mapping.

### Requirement 3: Chain auto-detection

**User Story:** As a token buyer, I want the Lab to work out which chain my address lives on, so that I do not need to pick a chain.

#### Acceptance Criteria

1. WHEN a valid address is submitted without an explicit chain, THE Verdict_API SHALL call `eth_getCode` on BNB Chain (56) first and, only if that call returns `0x`, call `eth_getCode` on Base (8453).
2. WHEN `eth_getCode` returns a value other than `0x` for a chain, THE Verdict_API SHALL select that chain and SHALL NOT probe the remaining chain.
3. WHEN a chain is selected, THE Lab SHALL display the plain result line "Found on BNB Chain" or "Found on Base" as appropriate.
4. WHEN `eth_getCode` returns `0x` on both chains and neither probe failed, THE Verdict_API SHALL respond with HTTP 404 and error code `NO_CONTRACT`.
5. IF an `eth_getCode` probe fails (network error, timeout, or unexpected shape) on a chain that would otherwise decide the outcome, THEN THE Verdict_API SHALL respond with HTTP 502 and error code `CHAIN_DETECTION_UNAVAILABLE`, and SHALL NOT report `NO_CONTRACT`.
6. WHERE a request body supplies an optional `chain` of `56` or `8453`, THE Verdict_API SHALL probe only that chain and treat `0x` there as `NO_CONTRACT`.
7. THE Verdict_API SHALL only use the RPC endpoints listed in the design (BSC: `bsc-dataseed2`, `bsc-dataseed3`, `bsc-dataseed4` on `bnbchain.org`, fallback `bsc.publicnode.com`; Base: `base-rpc.publicnode.com`) and SHALL NEVER contact `bsc-dataseed1`.
8. WHEN calling any BSC RPC endpoint, THE Verdict_API SHALL send the Browser_UA header.
9. THE Verdict_API SHALL rotate across the BSC endpoints and fall back to the next endpoint when a call fails with a network error, timeout, non-200 status, or non-revert JSON-RPC error.

### Requirement 4: HEAD — Sourcify verification

**User Story:** As a token buyer, I want to know whether the contract's source code is publicly verified, so that I can inspect what the contract does.

#### Acceptance Criteria

1. THE HEAD Check SHALL request `GET https://sourcify.dev/server/v2/contract/{chainId}/{address}` and SHALL NOT use any Sourcify v1 path, Etherscan API, or BscScan API.
2. WHEN Sourcify responds HTTP 200 with a non-null `match` value (`"match"` or `"exact_match"`), THE HEAD Check SHALL return state `healthy` with the finding "Source code verified on Sourcify".
3. WHEN Sourcify responds HTTP 404 with a JSON body whose `match` is `null`, THE HEAD Check SHALL return state `rotten` with the finding "Source code is not verified — nobody can read what this contract does".
4. IF Sourcify responds with any other status, a non-JSON body, or HTTP 200 with a null or missing `match`, THEN THE HEAD Check SHALL retry once and, if the retry also fails to produce a case covered by criteria 2 or 3, SHALL return state `unknown`.
5. THE HEAD Check SHALL set `evidenceUrl` to the Sourcify v2 URL that was queried.
6. WHERE GoPlus `is_open_source` is available, THE HEAD Check SHALL mention agreement or disagreement in its finding text but SHALL NOT let `is_open_source` change its state.

### Requirement 5: HEART — on-chain reads and transfer simulation

**User Story:** As a token buyer, I want to know whether a real holder can actually transfer the token, so that I am not buying something that cannot be moved.

#### Acceptance Criteria

1. THE HEART Check SHALL confirm contract code on the selected chain via `eth_getCode` using plain JSON-RPC `fetch` with constant selectors and no web3 library.
2. THE HEART Check SHALL read the EIP-1967 implementation slot `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` via `eth_getStorageAt` as corroboration only, and SHALL NOT use a zero reading as evidence that the contract is not a proxy.
3. THE HEART Check SHALL run the transfer simulation as an `eth_call` with `from` set to the first holder with a non-zero balance in the GoPlus `holders[]`, `to` set to the token, and `data` set to the `transfer(address,uint256)` selector `0xa9059cbb` with a dead address and an amount of 1 base unit.
4. WHEN the simulation returns a 32-byte value ending in `01`, or returns empty data (`0x`) without reverting, THE HEART Check SHALL return state `healthy` with a finding stating that a top holder's transfer succeeded and that this is one signal, not proof of safety.
5. WHEN the simulation reverts (JSON-RPC execution-revert error) or returns a 32-byte value of zero, THE HEART Check SHALL return state `rotten` and SHALL report the Hard_Veto `TRANSFER_REVERT`.
6. IF the GoPlus result is unavailable or contains no usable holder, THEN THE HEART Check SHALL skip the simulation and return state `unknown` with a finding stating that no holder was available to simulate.
7. IF the simulation fails for a transport reason (all endpoints failed, timeout, unexpected shape), THEN THE HEART Check SHALL return state `unknown` and SHALL NOT report a Hard_Veto.
8. WHEN the EIP-1967 slot is non-zero, THE HEART Check SHALL note in its finding that the contract is an upgradeable proxy.
9. WHEN the EIP-1967 slot is zero and GoPlus reports `is_proxy` = `"1"`, THE HEART Check SHALL treat the contract as a proxy using the GoPlus value.
10. THE HEART Check SHALL set `evidenceUrl` to the address page on the chain's block explorer (a plain hyperlink, not an API call).

### Requirement 6: LEFT ARM — GoPlus security flags and tax

**User Story:** As a token buyer, I want honeypot, tax, and owner-power red flags in plain language, so that I understand how the token could hurt me.

#### Acceptance Criteria

1. THE LEFT ARM Check SHALL request `GET https://api.gopluslabs.io/api/v1/token_security/{chainId}?contract_addresses={address}` with a lowercased address and read the result keyed by the lowercased address.
2. THE LEFT ARM Check SHALL read these fields as strings and SHALL NOT code against `owner_address`, `cannot_sell_all`, or `dex`: `is_honeypot`, `buy_tax`, `sell_tax`, `is_proxy`, `is_mintable`, `selfdestruct`, `hidden_owner`, `can_take_back_ownership`, `transfer_pausable`, `trading_cooldown`, `is_blacklisted`, `slippage_modifiable`, `anti_whale_modifiable`, `creator_percent`, `owner_percent`, `holder_count`, `holders[]`, `is_open_source`.
3. WHEN `is_honeypot` is `"1"`, THE LEFT ARM Check SHALL return state `rotten` and SHALL report the Hard_Veto `HONEYPOT`.
4. THE LEFT ARM Check SHALL take buy and sell tax only from GoPlus `buy_tax` and `sell_tax` and SHALL NOT claim to measure tax from an `eth_call`.
5. THE LEFT ARM Check SHALL describe each raised risk flag in a plain-language phrase with no unexplained jargon (for example, `is_mintable` = `"1"` becomes "the owner can create new tokens").
6. WHEN the GoPlus envelope `code` is not `1`, the `result` is missing, or the lowercased address key is missing, THE LEFT ARM Check SHALL return state `unknown`.
7. IF the request errors or times out, THEN THE LEFT ARM Check SHALL return state `unknown`.
8. THE LEFT ARM Check SHALL expose the parsed `holders[]` and `is_proxy` and `is_open_source` values through its `data` field so the HEART and HEAD Checks can use them.
9. THE LEFT ARM Check SHALL set `evidenceUrl` to the GoPlus request URL.

### Requirement 7: RIGHT ARM — DexScreener liquidity and volume

**User Story:** As a token buyer, I want to know whether the token has a real market, so that I can tell if I could exit a position.

#### Acceptance Criteria

1. THE RIGHT ARM Check SHALL request `GET https://api.dexscreener.com/token-pairs/v1/{chainSlug}/{tokenAddress}` using slug `bsc` for chain 56 and `base` for chain 8453.
2. WHEN the response is a JSON array with at least one pair, THE RIGHT ARM Check SHALL select the pair with the highest `liquidity.usd` and read `liquidity.usd`, `volume.h24`, `txns.h24`, `pairCreatedAt`, `fdv`, `marketCap`, and `url`.
3. WHEN the selected pair's `liquidity.usd` is below 5000, THE RIGHT ARM Check SHALL return state `rotten` with a finding that states the dollar amount and that the market is thin (for example "Liquidity $312 — effectively no market").
4. WHEN the response is an empty array, THE RIGHT ARM Check SHALL return state `rotten` with the finding "No trading pairs found — there is no market for this token".
5. WHEN the selected pair has `liquidity.usd` of at least 5000 and the checks in the design's RIGHT ARM table award enough points, THE RIGHT ARM Check SHALL return state `healthy`.
6. IF the response is not an array, has an unexpected shape, errors, or times out, THEN THE RIGHT ARM Check SHALL return state `unknown`.
7. THE RIGHT ARM Check SHALL set `evidenceUrl` to the selected pair's `url`; WHEN there is no pair, THE RIGHT ARM Check SHALL set `evidenceUrl` to the DexScreener request URL.

### Requirement 8: LEGS — X reputation via fxtwitter

**User Story:** As a token buyer who knows the project's X handle, I want a reputation signal for that account, so that I can tell a real project presence from an empty or fake one.

#### Acceptance Criteria

1. WHEN no handle was provided, THE LEGS Check SHALL return state `unknown` flagged `notProvided`, with the finding "No X handle provided — reputation check skipped", and the Scorer SHALL NOT penalise it.
2. WHEN a handle was provided, THE LEGS Check SHALL request `GET https://api.fxtwitter.com/{username}` with the Browser_UA header and SHALL NEVER request `api.vxtwitter.com`.
3. THE LEGS Check SHALL make up to 3 attempts and SHALL treat an HTTP 200 JSON body with no `user` key as a transient failure to retry.
4. WHEN an attempt returns HTTP 302 (redirect to `github.com/FxEmbed/FxEmbed`), THE LEGS Check SHALL NOT follow the redirect and SHALL return state `rotten` with the finding that the handle does not exist on X.
5. WHEN an attempt returns a non-200, non-302 status or a non-JSON body, THE LEGS Check SHALL treat it as a failed attempt.
6. IF all 3 attempts fail, THEN THE LEGS Check SHALL return state `unknown`.
7. WHEN at least one attempt returns a well-formed `user`, THE LEGS Check SHALL read `user.verification.verified`, `followers`, `tweets`, `description`, and `website.url`, and SHALL derive state from the points table in the design.
8. THE LEGS Check SHALL set `evidenceUrl` to `https://x.com/{username}`.

### Requirement 9: Single route, parallel execution, timeouts, UNKNOWN rule, cache

**User Story:** As a token buyer, I want a fast answer that never pretends a failed check passed, so that I can trust what I see.

#### Acceptance Criteria

1. THE browser SHALL make exactly one network request per autopsy, `POST /api/verdict` with JSON body `{ address, chain?, xHandle? }`, and SHALL make no direct call to any third-party service.
2. WHEN chain detection succeeds, THE Verdict_API SHALL start the five Checks in parallel (HEART may await the GoPlus result for its holder address while the other work continues).
3. THE Verdict_API SHALL apply a per-check timeout to every Check, with values defined in the design, and SHALL convert a timed-out Check to state `unknown`.
4. IF a Check throws or rejects, THEN THE Verdict_API SHALL convert it to state `unknown` and SHALL NOT let it fail the whole request.
5. THE Lab SHALL NEVER render a failed, timed-out, or malformed source result as `healthy`.
6. WHEN at least one provided Check is `unknown`, THE Verdict_API SHALL include in the response the note "N check(s) unavailable — verdict is weaker than usual." where N is the count of unknown Checks excluding a not-provided LEGS.
7. IF every Check that was run is `unknown`, THEN THE Verdict_API SHALL respond with HTTP 502 and error code `ALL_SOURCES_DOWN`.
8. THE Verdict_API SHALL cache the address-level Check results (HEAD, HEART, LEFT ARM, RIGHT ARM) in server memory for 60 seconds keyed by chain and lowercased address, and SHALL set `cached: true` on responses served from that cache.
9. THE Verdict_API SHALL NOT cache chain-detection failures, `unknown` Check results, or error responses.
10. THE Lab SHALL require no environment variables, API keys, or database.
11. THE Verdict_API SHALL perform all outbound calls only from `lib/sources/*` modules; `lib/scoring.ts` SHALL perform no I/O.

### Requirement 10: Scoring and hard vetoes

**User Story:** As a token buyer, I want a deterministic score with clear vetoes, so that the same token always gets the same verdict from the same data.

#### Acceptance Criteria

1. THE Scorer SHALL compute a score from 0 to 100 using the weights in the design: HEAD 20, HEART 20, LEFT ARM 30, RIGHT ARM 20, LEGS 10.
2. THE Scorer SHALL award points for `unknown` Parts as 0 while keeping their weight in the denominator, so a failed read cannot raise the score.
3. WHEN the LEGS Check is not provided, THE Scorer SHALL remove the LEGS weight from the denominator and scale the score to 100 (score = round(100 × earned ÷ 90)).
4. WHEN the score is 60 or higher and no Hard_Veto is present, THE Scorer SHALL return verdict `ALIVE`.
5. WHEN the score is below 60, THE Scorer SHALL return verdict `DEAD`.
6. WHEN any Hard_Veto is present (`HONEYPOT`, `TRANSFER_REVERT`, or `NO_CODE`), THE Scorer SHALL return verdict `DEAD` regardless of score and SHALL list each veto with a plain-language reason.
7. THE Scorer SHALL assign the Score_Band by score: 0–39 corpse, 40–59 twitching, 60–79 alive, 80–100 thriving, and the band SHALL be a display label only and SHALL NOT decide the verdict.
8. THE Scorer SHALL build the "what this means" paragraph deterministically from the Part results and vetoes without calling any external AI service.
9. THE Scorer SHALL be a pure function: identical inputs SHALL produce identical outputs.

### Requirement 11: Stitch reveal sequence

**User Story:** As a user, I want to watch the monster get stitched together part by part, so that the verdict feels earned and I can see which source said what.

#### Acceptance Criteria

1. WHEN the Verdict_API returns a successful verdict, THE Lab SHALL reveal the Parts client-side in the fixed order HEAD, HEART, LEFT ARM, RIGHT ARM, LEGS, starting about 600 ms apart.
2. WHEN a Part is revealed, THE Monster SHALL animate a thread line drawing across the Part and then colour the Part: green for `healthy`, red with slight ooze for `rotten`, grey for `unknown`.
3. WHEN a Part is revealed, THE Lab SHALL show its one-line finding beneath it.
4. WHILE the reveal is in progress, THE Lab SHALL show a progress line "Stitching… K of 5 parts attached." with K updated as each Part lands.
5. WHILE the request is in flight and before the first Part is revealed, THE Monster SHALL be shown fully grey and unstitched with a waiting message.
6. THE Lab SHALL convey each Part's state with a text label and icon in addition to colour so state is not conveyed by colour alone.
7. WHERE the user's device sets `prefers-reduced-motion: reduce`, THE Lab SHALL replace the thread-draw and shake animations with an instant colour change and SHALL still reveal Parts in order.
8. THE reveal order SHALL be fixed and SHALL NOT be sorted by severity.
9. WHEN LEGS is not provided, THE Monster SHALL still reveal the LEGS Part as neutral grey with the finding "No X handle provided — reputation check skipped".

### Requirement 12: Verdict screen

**User Story:** As a token buyer and as a hackathon judge, I want a verdict screen that reads clearly in a screenshot, so that I can understand and share the result at a glance.

#### Acceptance Criteria

1. WHEN the fifth Part has been revealed, THE Lab SHALL shake the Monster, flicker the lab light, and slam the Stamp.
2. THE Stamp SHALL read "IT'S ALIVE" in green for verdict `ALIVE` and "DEAD ON ARRIVAL" in red for verdict `DEAD`, with the numeric score and the Score_Band label.
3. THE verdict screen SHALL show a "What this means" paragraph of plain language.
4. THE verdict screen SHALL show the findings list for all five Checks, each with its one-line finding and an evidence link that opens in a new tab with `rel="noopener noreferrer"`.
5. WHEN one or more Hard_Veto is present, THE verdict screen SHALL show each veto with its plain-language reason above the findings list.
6. WHEN the response contains the unavailable-checks note, THE verdict screen SHALL show it directly beneath the Stamp.
7. THE verdict screen SHALL show the stamp, score, and the top 3 findings above the fold on a 390 × 844 px mobile viewport. The top 3 are ordered: vetoes, then `rotten` Parts by weight, then `unknown` Parts, then `healthy` Parts by weight.
8. THE verdict screen SHALL show the detected chain line and, when available, the token name and symbol from GoPlus.
9. THE Lab SHALL show the footer disclaimer "Automated checks, not financial advice. Always DYOR." on every screen.

### Requirement 13: Copy verdict and Stitch another

**User Story:** As a user, I want to copy the verdict as plain text and start over, so that I can share the result and check another token.

#### Acceptance Criteria

1. WHEN the user activates "Copy verdict", THE Lab SHALL write a plain-text summary to the clipboard containing the verdict, score, Score_Band, chain, address, one line per Part with its state and finding, the unavailable-checks note when present, and the disclaimer.
2. WHEN the clipboard write succeeds, THE Lab SHALL show a confirmation "Copied!" for about 2 seconds.
3. IF the Clipboard API is unavailable or rejects, THEN THE Lab SHALL fall back to a selectable read-only text area containing the summary and SHALL show "Copy failed — select the text and copy it manually".
4. WHEN the user activates "Stitch another", THE Lab SHALL clear the verdict and error state, return to the idle form with the Monster grey, and focus the address input.
5. THE copied text SHALL contain no emoji-only meaning: state words HEALTHY, ROTTEN, and UNKNOWN SHALL appear as text.

### Requirement 14: Error states

**User Story:** As a user, I want every failure to be explained inline with a way forward, so that I never hit a dead end or a blank monster.

#### Acceptance Criteria

1. WHEN the address is invalid, THE Lab SHALL show the inline hint from Requirement 1 and SHALL NOT call the Verdict_API.
2. WHEN the Verdict_API responds `NO_CONTRACT`, THE Lab SHALL show "No contract found at this address on BNB Chain or Base" with a hint to double-check the address, and the Monster SHALL remain grey.
3. WHEN the Verdict_API responds `CHAIN_DETECTION_UNAVAILABLE`, `ALL_SOURCES_DOWN`, or `INTERNAL`, or the request fails at the network level, THE Lab SHALL show "The lab lost power — try again" with a "Try again" button that resubmits the same inputs.
4. IF the browser request exceeds 25 seconds, THEN THE Lab SHALL abort it and show the same "The lab lost power — try again" state.
5. WHEN a single source is down, THE Lab SHALL render that Part as UNKNOWN (grey), still show a verdict, and show "1 check unavailable — verdict is weaker than usual."
6. WHEN the response body is not valid JSON or does not match the expected shape, THE Lab SHALL treat it as the "lab lost power" state and SHALL NOT render partial data.
7. THE Lab SHALL NEVER display a blank Monster area; every error state SHALL include a message and a next action.
8. WHILE an error is displayed, THE Lab SHALL keep the user's entered address and handle in the form.
9. THE Lab SHALL announce errors and reveal progress to assistive technology through an `aria-live` region.

### Requirement 15: Project constraints and delivery

**User Story:** As a hackathon entrant, I want the repo to satisfy the Kiroween submission rules, so that the entry qualifies.

#### Acceptance Criteria

1. THE repository SHALL include an MIT `LICENSE` file at its root and a `README.md` describing what the app is, how to run it, and where the Kiro usage write-up lives.
2. THE repository SHALL include a committed `/.kiro` directory at its root with these specs, steering files, and hooks, and SHALL NOT list `.kiro` in `.gitignore` or any other ignore file.
3. THE Lab SHALL include no wallet connection, signing, approval, swap, or any on-chain write.
4. THE Lab SHALL include no web3 library (ethers, viem, web3.js, or equivalent) in `package.json`.
5. THE Lab SHALL display no invented, mocked, or placeholder data as a real result; any demo address in the README or UI SHALL be a real address verified during the build.
6. THE Lab SHALL NOT use `api.vxtwitter.com`, Sourcify v1 paths, Etherscan/BscScan APIs, or `bsc-dataseed1` anywhere in source code.
7. THE Lab SHALL build successfully with `next build` under TypeScript strict mode with no use of `any` for external API responses.
8. THE Lab SHALL be deployable to Vercel free tier with no configuration beyond importing the repository.
