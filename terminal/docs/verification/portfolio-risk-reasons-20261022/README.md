# Portfolio Risk: explain unavailable cost weights

Operation: `portfolio-risk-reasons-20261022`. Base: `942eeb526b4fd64b17aa66042c0d0ec2c3a5b94e`.

Risk already refuses cost weights when a positive-cost record has an unknown entry currency, when entry currencies differ, or when the cost overflows. The old concentration card instead claimed that no holding had both shares and a buy price; other cards could claim unreadable security data despite a successful security read.

The correction uses the computation's existing typed refusal reason in unavailable monetary cards, including the existing liquidity explanation under **How to read this exposure**. It searches all gaps, independently of the 20-row display cap. The fallback and `no_size` text describe the absence of a positive cost, covering absent, zero, and negative inputs. Computation, schema, money eligibility, and layout are unchanged. Valid common-currency data retains the existing artifact-specific absence explanations.

## Executed checks

- Focused unit suite: **34 passed**, including eight added cases. The same new tests against the unchanged source produced **7 failed, 27 passed**. Only `portfolioRisk.test.ts` was collected; this is not a second money-suite result.
- Next route type generation and TypeScript: passed. TypeScript passed again with the new browser spec present.
- Added-lines plain-language guard: passed.
- Browser spec: **12 passed in 38.2 seconds** (39.3 seconds for the recorded command), one worker, on a dedicated port. Desktop 1440×900, tablet 820×1180, mobile 390×844; English/Chinese × dark/light. Synthetic isolated fixture records have positive shares and buy price, readable security facts, a USD current quote, and **no entry currency**. The historical currency stays unknown; the three visible cards and existing liquidity details show the correct reason. No page errors or horizontal overflow were observed.
- Scoped ESLint: not a pass. Baseline and candidate report exactly the same unchanged diagnostics at lines162 and297 (`prefer-const`, unused `liquidityReadCost`). Retained logs establish parity.
- `git diff --check`: passed before publication.

## Environment and proof limits

The first browser start ran no tests: Turbopack rejected the dependency symlink outside the workspace root. The workspace then received an APFS clone copy of the existing verified dependencies. Lockfiles matched; the copied dependency metadata and selected package hashes match their source. No application/configuration/assertion change was made for that repair. The failed start and successful run are both retained. All dependency operations were confined to this owned checkout; the source dependency directory was not altered.

Light is a check of Portfolio's existing Paper-token compatibility, not a global theme-setting flow. All twelve original component screenshots are in `crops/`; six views spanning both languages, themes, and every viewport were visually inspected. Text wraps without clipping and card structure is preserved. These are synthetic local browser proofs, not real-account mutations or production deployment proof.

A bounded native source judgment found no blocking issue. The separately requested fresh **Subagent Fabric** review will bind to the published commit; its receipt belongs in the PR. Hosted CI, merge, installation, and live product verification remain separate gates.

## Retained evidence

`verification.json` records original source/blob hashes, commands, versions, all screenshot hashes, and log digests. Logs are deterministic gzip files; the recorded SHA256 values identify both uncompressed and compressed bytes. No private account holdings or credentials are included.
