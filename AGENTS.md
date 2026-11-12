# Monster Lab

Monster Lab is a Kiroween 2026 (Frankenstein category) entry: paste a token contract address and five incompatible sources (Sourcify, on-chain JSON-RPC, GoPlus, DexScreener, fxtwitter) are stitched into one verdict, IT'S ALIVE or DEAD ON ARRIVAL. Next.js App Router + TypeScript + Tailwind, deployed on Vercel.

## Steering files to respect
- `.kiro/steering/product.md` — purpose, users, goals, non-goals, verdict rules, judging criteria
- `.kiro/steering/tech.md` — exact stack and the verified source facts (endpoints, fields, UA rules, bans)
- `.kiro/steering/structure.md` — file tree, frontend/serverless split, naming, `/.kiro` rule

## Hard rules
- Keyless sources only: no API keys, no env vars, no database, no web3 libraries.
- No wallet actions: no connect, sign, approve, swap, or any on-chain write.
- No invented data: never fabricate addresses, handles, results, or findings; demo addresses must be real and verified.
- UNKNOWN on source failure: a failed or timed-out source renders UNKNOWN, never SAFE.
- Sourcify v2 only; fxtwitter only (never vxtwitter) with a browser User-Agent; never use bsc-dataseed1.
- Never gitignore `/.kiro`.
