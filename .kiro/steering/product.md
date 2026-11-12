---
inclusion: always
---

# Product: Monster Lab

## Purpose
Monster Lab is a contract-autopsy verdict app. A user pastes a token contract address and five incompatible data sources are stitched into ONE verdict: **IT'S ALIVE** or **DEAD ON ARRIVAL**. The verdict comes with a 0–100 score, plain-language reasons, and evidence links for every finding.

The five "body parts" (fixed reveal order):
1. HEAD — Sourcify source-code verification
2. HEART — on-chain transfer simulation (eth_getCode, EIP-1967 slot, transfer sim)
3. LEFT ARM — GoPlus security flags and buy/sell tax
4. RIGHT ARM — DexScreener liquidity and volume
5. LEGS — X/KOL reputation via api.fxtwitter.com (only if the user supplies a handle)

Supported chains for v1: BNB Chain (56) and Base (8453). No chain picker: the API probes BSC first, then Base, via `eth_getCode`; whichever returns code wins, and the UI states the detected chain.

## Target users
- Token buyers: people (often on a phone, one-handed) who want a fast, plain-language sanity check before buying a token. They need zero setup, no wallet connect, no login.
- Hackathon judges: they need a working public URL, a clear end-to-end demo, a visible `/.kiro` directory, and a verdict screen that reads clearly in a screenshot.

## Goals
- Paste address, tap STITCH IT, get a verdict in seconds.
- Every finding is plain-language and carries an evidence link so users can verify rather than trust.
- Honest about uncertainty: a source that fails shows UNKNOWN (grey), and the verdict says it is weaker.
- Works the moment it deploys: keyless, databaseless, one Vercel URL.
- Playful-horror lab theme, but findings are dead serious and jargon-free.
- Shareable verdict screen (big stamp, score, top 3 findings above the fold on mobile, "Copy verdict").

## Non-goals
- No wallet connection, signing, swaps, approvals, or any on-chain write.
- No financial advice; footer disclaimer: "Automated checks, not financial advice. Always DYOR."
- No accounts, persistence, history, or database in v1.
- No chain picker, no chains beyond BSC and Base in v1.
- No inferring an X handle from a token name; no contract-to-handle mapping.
- No LLM on the critical path; the verdict is a deterministic rule-based scorer.
- No invented, mocked, or placeholder data presented as real results.

## Verdict rules (product-level)
- IT'S ALIVE: score >= 60 and no hard veto.
- DEAD ON ARRIVAL: score < 60, or any hard veto (`is_honeypot` = 1, transfer-sim revert, no contract code).
- Score bands are display labels only: 0–39 corpse, 40–59 twitching, 60–79 alive, 80–100 thriving. Vetoes decide the stamp.
- Each part is HEALTHY (green), ROTTEN (red), or UNKNOWN (grey). An omitted X handle renders neutral, never a penalty.

## Kiroween category fit: Frankenstein
The app literally stitches five incompatible sources (Sourcify, JSON-RPC, GoPlus, DexScreener, fxtwitter) into one living verdict. The UI makes this the metaphor: each check result stitches one body part onto a monster, and the stamp is the jolt of lightning that brings it alive or declares it dead.

## Judging criteria
- Working app: a public Vercel URL with free judge access until judging ends. It must succeed on a real good token (e.g. WBNB on BSC) and flag a real bad one (a verified honeypot or high-tax token found and confirmed during the build, never invented).
- Demo video: under 3 minutes, public on YouTube, screen recording plus text overlays, showing the app end to end (safe case, scam case, `/.kiro` in the repo).
- Kiro usage: the repo must have `/.kiro` at its root with specs (`requirements.md`, `design.md`, `tasks.md`), steering, and hooks genuinely produced while building. The submission write-up explains how specs, steering, and hooks shaped the build.
- Open source: public GitHub repo with a visible MIT LICENSE.
