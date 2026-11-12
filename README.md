# Monster Lab

Paste a token contract address. Five incompatible data sources are stitched into one verdict: **IT'S ALIVE** or **DEAD ON ARRIVAL**, with a 0–100 score, plain-language reasons, and an evidence link for every finding.

A Kiroween 2026 entry (Frankenstein category). Each check stitches one body part onto a monster; the stamp is the jolt of lightning that brings it alive or declares it dead.

## The five checks (body parts, in reveal order)

| # | Part | Source | What it checks |
|---|------|--------|----------------|
| 1 | HEAD | Sourcify (API v2) | Is the source code verified? |
| 2 | HEART | On-chain JSON-RPC | Contract code exists, EIP-1967 proxy slot, `transfer` simulation from a top holder |
| 3 | LEFT ARM | GoPlus | Honeypot, buy/sell tax, mint, ownership and other security flags |
| 4 | RIGHT ARM | DexScreener | Top-pair liquidity and volume |
| 5 | LEGS | api.fxtwitter.com | X account reputation (only if you supply a handle) |

Each part is HEALTHY (green), ROTTEN (red), or UNKNOWN (grey). If a source errors or times out, that part is UNKNOWN, never healthy, and the verdict says it is weaker than usual. An omitted X handle is neutral, not a penalty.

Supported chains: BNB Chain (56) and Base (8453). There is no chain picker: the API probes BSC first, then Base, and the UI states the detected chain.

## Verdict rules

- IT'S ALIVE: score >= 60 and no hard veto.
- DEAD ON ARRIVAL: score < 60, or any hard veto (GoPlus `is_honeypot` = 1, transfer simulation revert, no contract code).
- Score bands (display labels only): 0–39 corpse, 40–59 twitching, 60–79 alive, 80–100 thriving.
- Scoring is a deterministic rule-based scorer in `lib/scoring.ts`. No AI API is involved.

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
```

Monster Lab is keyless, databaseless, and uses no web3 libraries. There are no API keys and no environment variables. All on-chain reads are plain JSON-RPC `fetch` calls. Verdicts are computed live, with a 60 s in-memory cache per chain and address.

## Demo results (verified live 13 Nov 2026)

| Token | Address | Result |
|-------|---------|--------|
| WBNB (BNB Chain) | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | ALIVE, score 100, thriving. DexScreener top-pair liquidity $36,655,418, 24h volume $4,107,389 |
| USDC (Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | ALIVE, score 98, thriving. Upgradeable-proxy note comes from GoPlus `is_proxy` (the EIP-1967 slot reads zero for this token) |
| SQUID (BNB Chain) | `0xA167d46c9087a1D9ED15d8d08BFB5bA1BcA0C4aE` | DEAD ON ARRIVAL, score 44, twitching, HONEYPOT veto, LEFT ARM rotten, no trading pairs |

Scam example evidence (task 10.3): the raw GoPlus response for SQUID, checked 13 Nov 2026, shows `is_honeypot` "1", `is_mintable` "1", and `holder_count` 18. Verify it yourself:
`https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=0xa167d46c9087a1d9ed15d8d08bfb5ba1bca0c4ae`

Optional X handle example: `@congge918` gives LEGS healthy (verified account, 32,701 followers, 47,192 posts, checked live 13 Nov 2026).

## How Kiro shaped the build

- Specs: `.kiro/specs/monster-lab-contract-autopsy/` (`requirements.md`, `design.md`, `tasks.md`) drove the work task by task, each with a concrete verification step.
- Steering: `.kiro/steering/` (`product.md`, `tech.md`, `structure.md`) held the verified source facts (endpoints, field names, User-Agent rules, banned sources) so they stayed consistent across sessions.
- Hooks: `.kiro/hooks/` has a banned-source guard (no vxtwitter, bsc-dataseed1, Sourcify v1, web3 imports), typecheck-on-save, and a guard that stops `.kiro` from being gitignored.

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, choose "Add New… Project" and import the repo.
3. Keep the detected Next.js settings. Add no environment variables.
4. Deploy.

## License

MIT. See `LICENSE`.

---

Automated checks, not financial advice. Always DYOR.
