# Immutable current-code visual evidence — capture return (worker-001)

Branch `claude/news-current-evidence-20261102-worker-001`, an isolated artifact branch off the
published parent base. This report is a factual execution record. It is not a merge, release,
deploy, CI-green, live-acceptance or production-proof claim.

## Source and base

| Item | Value |
| --- | --- |
| Repository | `mastermindx-market-intelligence/mastermind-terminal` (`https://github.com/mastermindx-market-intelligence/mastermind-terminal.git`) |
| Host | `ubuntu0`, Linux 7.0.0-34-generic x86_64, Ubuntu 24.04.5 LTS, 32 cores, 29 GiB RAM |
| Isolated workspace | `/home/ubuntu0/lanes/repos/mastermind-terminal/.claude/worktrees/news-current-evidence-20261102-worker-001` (repo-local `.claude/worktrees/<task>/` per root `AGENTS.md`) |
| Base commit (HEAD of this branch) | `5c9269d207e4cef89a60c39752d3233fbcb2fdc7` |
| Parent branch | `claude/news-reading-current-20261102-c4` (Draft PR #1207, head `5c9269d207e4cef89a60c39752d3233fbcb2fdc7`) — not merged, not modified, not pushed by this worker |
| Master used | `bf9826e3d52d84458e7498a95c88ea609c14428b` — no other source merged |
| Source snapshot | 1761 keys, canonical SHA256 `250ec240c087a91a1e2544468f4a39f5912971d5dd12bc9c05a724061ce9d4f9` |
| Source digest method | `evidence.sha(Buffer.from(evidence.canonical(evidence.sourceSnapshot(repoRoot))))` |
| Source digest re-verified | identical **before** capture and **after** both captures (no source drift during the run) |
| Flag profile | `{fixture:"terminal-e2e.v1", buildMode:"next-dev", sharedShell:"0", investorShellPreview:"0", theme:"dark"}` — exact match to the required profile |

The parent worktree `news-reading-current-20261102-c4` does not exist on this host; it lives on
the operator host and was left untouched. The only pre-existing listener on this host was another
lane's dev server on port 3199; it was neither used nor affected.

### Parent head advanced during this run — proof still binds

While the captures ran, the parent branch fast-forwarded by one commit
(`995fbb9dc6d9b46a81766a04ac3b1c9026622c15`, "test(news): retain current R3 browser proof and CI
selection proposal"); `5c9269d207e4cef89a60c39752d3233fbcb2fdc7` is its ancestor, so this was a
fast-forward, not a history rewrite. PR #1207 remains Draft and OPEN at that head.

This branch is deliberately based on `5c9269d2`, the exact base specified for this capture. The
parent's new commit changed **93 files, all under `terminal/docs/pr-crops/`** — none inside the
source-locked scope (`terminal/app`, `terminal/components`, `terminal/lib`, `terminal/e2e`) and
none among the 148 explicit `SOURCE_PATHS` entries. This was verified by recomputing the owner's
own snapshot at the parent's new head in a throwaway detached worktree:

```
parent head keys: 1761
parent head sha : 250ec240c087a91a1e2544468f4a39f5912971d5dd12bc9c05a724061ce9d4f9
SAME AS 5c9269d2: true
```

So the source lock is byte-identical at both commits, and this composition still validates against
the parent's current head. If the parent's source scope changes before merge, the lock breaks and
a fresh capture against that head is required — the owner does not restamp, and this worker did
not attempt one. The throwaway worktree used for this check was removed; no repository state was
modified by it.

## Runtime

| Item | Value |
| --- | --- |
| Node / npm | v22.23.3 / 10.9.9 |
| Python | 3.12.3 (owner `visualEvidenceFs.py` primitive) |
| Next.js | 16.2.9, `next dev` (development mode, fixture seams) |
| Playwright | 1.61.1 (`@playwright/test`) |
| Browser | Playwright chromium revision 1228, pre-installed in `~/.cache/ms-playwright`; `Google Chrome for Testing 149.0.7827.55` (headless shell) |
| Install | `npm ci --no-audit --no-fund` in `terminal/` (479 packages) |

No user browser profile or signed-in session was used. All pages were served by owned, isolated
`next dev` servers in this worktree against deterministic fixture seams
(`TERMINAL_E2E_FIXTURE=1`, `TERMINAL_E2E_ENTITLEMENT=unlimited`, `FLOW_FIXTURE=1`,
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `ANALYSIS_LOCAL_PREVIEW=1`, `ADMIN_DEV=1`).

Exported environment: `NODE_OPTIONS=--no-experimental-webstorage`, `MMX_SHARED_SHELL=0`,
`MMX_INVESTOR_SHELL_PREVIEW=0`, `NEXT_TELEMETRY_DISABLED=1` (telemetry only — no runtime, rights
or feed policy was overridden). `CI=1` was set **for the Visual Intelligence packet only**, to force
the isolated owned test server and the 60 s per-test budget; the wrapper already forced
`--workers=1 --retries=0`, and no `--grep` was passed. The PL6 packet ran without `CI=1` because
it owns its server directly.

Ports (both verified free before use, no shared server, no reused session):
PL6 `TERMINAL_CROP_PORT=4177`; Visual Intelligence `--port 4188`.

## Commands actually run

```
# from terminal/
export NODE_OPTIONS=--no-experimental-webstorage MMX_SHARED_SHELL=0 MMX_INVESTOR_SHELL_PREVIEW=0 NEXT_TELEMETRY_DISABLED=1
TERMINAL_PL6_EVIDENCE_OPERATION_ID=news-reading-20261102-c4-pl6-001 \
TERMINAL_CROP_PORT=4177 \
CAPTURE_ONLY=AnalysisWorkspace,ChartChrome,OptionsHubView,SearchModal,StockAnalysis \
node e2e/tools/capture_pl6_batch1.cjs
# → exit 0, {"visualEvidence":"terminal/docs/pr-crops/b-pl-6-batch-1/news-reading-20261102-c4-pl6-001--operation.json","sha256":"3b6c81302f09fd7a6f15b566239a06661086c8698a843c5d22c6d61eb88de0ca","actualCases":20}
# operation window 23:22:45 → 23:23:41 (-0800)

export NODE_OPTIONS=--no-experimental-webstorage MMX_SHARED_SHELL=0 MMX_INVESTOR_SHELL_PREVIEW=0 NEXT_TELEMETRY_DISABLED=1 CI=1
node e2e/tools/capture_visual_evidence.cjs --id news-reading-20261102-c4-vi-001 --port 4188
# → exit 0, {"visualEvidence":"terminal/docs/pr-crops/terminal-visual-intelligence/news-reading-20261102-c4-vi-001--operation.json","sha256":"dc275d0b10c9dec842f1b738cf94809e2ba331a6fda90cb03e321d7dd425becc","actualCases":30}
# operation window 23:24:14 → 23:26:40 (-0800)

npx next typegen     # → exit 0, "Types generated successfully"
npx tsc --noEmit     # → exit 0, no diagnostics
```

The optional `DiscoverLeaders` surface was excluded, as it is outside the owner's required 20.

## New artifacts (owner-generated, immutable v2 operation records)

All files were written by the existing owner only, through the bounded descriptor-relative
`visualEvidenceFs.py` primitive (`O_CREAT|O_EXCL|O_NOFOLLOW`, mode `0400`, readback and hash
binding). No legacy image or metadata file was overwritten; no `CURRENT`/latest pointer was
written; no source, config, test or owner file was changed.

### PL6 packet — 20 actual cases

`terminal/docs/pr-crops/b-pl-6-batch-1/`, prefix `news-reading-20261102-c4-pl6-001--` (43 files:
start + report + operation + 20 case PNG/JSON pairs)

| Artifact | SHA256 |
| --- | --- |
| `news-reading-20261102-c4-pl6-001--operation.json` | `3b6c81302f09fd7a6f15b566239a06661086c8698a843c5d22c6d61eb88de0ca` |
| `news-reading-20261102-c4-pl6-001--start.json` | `594febab0353c2b5c11d30c1fc2cb7c53743633632a271f5cc45bb67cb40540a` |
| `news-reading-20261102-c4-pl6-001--report.json` | `cb9e654914b3e67dd254bd809465dda00d421012eaddbe3be6cba53d89b95977` |

5 surfaces × {desktop 1440×900, mobile 390×844} × {EN, ZH} = **20/20 actual captures**.
Every row: `status=passed`, `expectedStatus=passed`, `retry=0`, `errors=[]`.
Case set (all present, no extras): `capture AnalysisWorkspace`, `capture ChartChrome`,
`capture OptionsHubView`, `capture SearchModal`, `capture StockAnalysis` in each of the four
project×locale combinations. Observed per case: `lang` ∈ {en, zh}, `theme=dark`.
Report schema `terminal.pl6-execution.v1`; no `failed-execution.json` and no `FAIL-*` receipt
were produced (the capture had zero failures).

### Visual Intelligence packet — 30 actual cases

`terminal/docs/pr-crops/terminal-visual-intelligence/`, prefix `news-reading-20261102-c4-vi-001--`
(64 files: start + raw-report + report + operation + 30 case PNG/JSON pairs)

| Artifact | SHA256 |
| --- | --- |
| `news-reading-20261102-c4-vi-001--operation.json` | `dc275d0b10c9dec842f1b738cf94809e2ba331a6fda90cb03e321d7dd425becc` |
| `news-reading-20261102-c4-vi-001--start.json` | `96163417858bbb4a84a89eb248f60577340598f2ffbcbd78b6bedf93c3e631af` |
| `news-reading-20261102-c4-vi-001--report.json` | `a703c90cad44d1d60ed58595d519e9991a4c2478263e4cc97c5a28c5dd3558e0` |
| `news-reading-20261102-c4-vi-001--raw-report.json` | `a703c90cad44d1d60ed58595d519e9991a4c2478263e4cc97c5a28c5dd3558e0` (byte-identical to `report.json`) |

All 10 unchanged incumbent tests × {desktop 1440×900, tablet 820×1180, mobile 390×844} =
**30/30 actual executions**, no `--grep`. Report stats:
`{expected:30, unexpected:0, skipped:0, flaky:0, duration:143755, startTime:"2026-11-02T07:24:14.722Z"}`,
`errors: []`. Every executed file is `visual-intelligence.spec.ts`; 10 distinct titles; 27 EN +
3 ZH (the ZH title in each of the three projects). All 30 PNGs decode with CRC and match their
viewport dimensions exactly.

### Composition

| Artifact | SHA256 |
| --- | --- |
| `terminal/docs/pr-crops/b-pl-6-batch-1/news-reading-20261102-c4-proof-001.composition.json` | `b0aeb69acf17010d7781df02a43d006edd38c4cef7c5c672fed0eec292ccb101` |

Written with the owner's exported `writeComposition` (id `news-reading-20261102-c4-proof-001`,
packet `pl6`, both operation manifest paths and file hashes, 50 explicit per-case selections
derived from `evidence.requirements("pl6")` and `evidence.requirements("vi")` and checked for
exact set equality against the recorded actual cases, and the exact shared profile above). The
owner then read it back itself through `readComposition`: **50 cases** (20 pl6 + 30 vi), 50 unique
keys, 2 operations, every case `passed`/`retry 0`/no errors. No handcrafted format and no
bypass were used.

## Reader validation

Both unchanged readers were executed with
`TERMINAL_EVIDENCE_COMPOSITION=terminal/docs/pr-crops/b-pl-6-batch-1/news-reading-20261102-c4-proof-001.composition.json`:

```
npx vitest run lib/__tests__/b_pl_6Batch1Evidence.test.ts lib/__tests__/visualIntelligenceEvidence.test.ts --minWorkers=1 --maxWorkers=1
→ Test Files 2 passed (2) | Tests 2 passed (2) | Duration 5.75s | exit 0
```

Both readers took their composition branch and observed 20 PL6 and 30 VI cases respectively.

Full current suite, same composition selected:

```
npx vitest run --minWorkers=1 --maxWorkers=1
→ Test Files 1035 passed | 5 skipped (1040)
→ Tests      17587 passed | 47 skipped | 4 todo (17638)
→ Duration   279.19s   (wall clock 280 s)   exit 0
```

**0 failed.** The `READ_FAILED` strings in the log are expected stderr from the
`teamsInvitationsRoute` / `teamsRoute` error-path tests, not failures. The known historical
shell hash locks were not re-confirmed by running the unselected suite; that suite was not run.

## Visual inspection actually performed

I inspected 3 of the 50 images with the image reader and no more. They are real renders, not
blanks: the desktop EN PL6 `capture ChartChrome` crop shows the Day Range control with live
values; the desktop EN VI frame shows the full 1440×900 Mastermind Terminal workspace in dark
theme (NVDA 192.53 / −1.64 %, volume 179.3M, the chart area in its fixture "Intraday feed
unavailable … Back to Daily" state, right rail Intelligence panel, bottom movers ticker); the
mobile ZH VI frame shows the chart-context sheet rendered in Chinese (图表解读 / 所选历史K线 /
趋势 / 动能 / 成交量排名, EMA 20 205.06 and EMA 50 194.31, RSI 14 48.62). Beyond these three I
made **no visual-quality claim**: the other 47 images were verified only by the owner's machine
checks (PNG signature, full CRC decode, dimension bounds, non-uniform pixel content, per-case
observation lang/theme). Parent is expected to inspect the images independently.

## Limits, and what this is not

- These are **actual current-code fixture captures** against an isolated owned `next dev` server.
  They are **not** authenticated production proof: no signed-in journey, no live entitlement, no
  real market data, no deployed build. Production behaviour is not evidenced by this packet.
- The evidence binds the **explicit source seed augmented recursively by current runtime/e2e
  membership** (1761 keys) at exactly commit `5c9269d2`. A later source change invalidates this
  proof and needs its own compatible evidence; this packet is not a restamp of any historical
  record.
- The owner guarantees exclusive creation, non-overwrite and no foreign-descriptor adoption
  under the existing trusted-parent boundary. It does **not** establish authenticity or immutable
  storage against a malicious same-UID process, and it is not a durable operation journal with
  automatic recovery.
- The composition is a composition of two **actual** records; it does not assert that one capture
  executed all 50 cases.
- No CI default activation is authorized and none was made. CI's permanent selector would impose
  full 50-case captures on most future Terminal changes and remains an unapplied operating-policy
  proposal owned by the parent. This locally selected passing run **does not** make CI green and
  grants **no** merge, release, deploy or live-acceptance authority.
- No PR, comment, message, parent push, merge, deploy, live acceptance, or runtime / controller /
  thermal / evidence-policy change was made by this worker. `EVIDENCE_CI_PROPOSAL.md` does not
  exist in this base and was not touched.

## Failures and retained state

None. Both packets completed on their first attempt with exit code 0 and zero failed, skipped or
flaky cases, so no failed/incomplete operation prefix exists and no operation ID was reused,
overwritten or silently rerun. No retry was performed.

## Changes made by this worker

No source, config, test, owner, or legacy-evidence change. The only new tracked content is:

- `terminal/docs/pr-crops/b-pl-6-batch-1/news-reading-20261102-c4-pl6-001--*` (43 files)
- `terminal/docs/pr-crops/terminal-visual-intelligence/news-reading-20261102-c4-vi-001--*` (64 files)
- `terminal/docs/pr-crops/b-pl-6-batch-1/news-reading-20261102-c4-proof-001.composition.json`
- `terminal/docs/pr-crops/news-reading-current-20261102/IMMUTABLE_CAPTURE_RETURN.md` (this file)

108 owner-generated files plus this report; all 108 untracked paths at commit time matched only
those operation prefixes, the composition, and this report.
