# Today source-readings strip — slice 2 crops (2026-11-01)

**What this is:** a local fixture capture of the real `TodayWorkspace` and `TodayBreadthReading` components.
- Mocked: the Supabase SDK, onboarding and `next/link`.
- `today/capture.mjs` answers every `/api/*` request itself and blocks all non-loopback requests.

**What it is not:** it uses no authentication and no live data, and it makes no beta or production claim. Signed-in beta proof is a separate step after deploy.

**Clocks:** frozen per mode, so every age is reproducible.
- Live-breadth matrix: 2026-11-02T15:30:00Z (Monday 10:30 New York, mid-session).
- Stale, aged and unavailable modes: 2026-11-01T12:00:00Z (Sunday 07:00 New York).

## What changed in the product

1. **The strip is visible.**
   - The source readings moved out of the collapsed `<details>` into the brief card.
   - The brief's "Reading as of" line now carries its age, for example "3 days ago · 1 session old".
2. **Each reading says how old it is, counted in US trading sessions.** The count is New York weekdays strictly between the reading date and today, plus today once it is a weekday at or after 16:00 New York (that session has closed and the reading did not include it).

   | Kind | When | EN | ZH | Ink |
   |---|---|---|---|---|
   | current | 0 sessions, or dated at most one day ahead | Latest session | 最新交易日 | `--text-2` |
   | behind | 1 session | 1 session old | 落后 1 个交易日 | `--text-2` |
   | stale | ≥ 2 sessions | N sessions old — check source | 已落后 N 个交易日，请核对来源 | `--warn` (dark) / `--mx-light-ink-warn` (light) |
   | ahead | dated more than one day after today | Dated after today — check source | 日期晚于今天，请核对来源 | `--warn` (dark) / `--mx-light-ink-warn` (light) |

   - A reading with no date gets no age line, because its clock line already says the source date is unavailable.
   - One day ahead counts as current, so a reading stamped in an Asian time zone is not flagged.
   - Market holidays are not excluded. Before today's close the two-session threshold absorbs one holiday; after the close today's session is counted too, which uses that allowance up. So in a holiday week the count can read one session older than the truth. This errs toward "check source", never toward "current".
3. **One S&P 500 breadth cell.**
   - It reads Macro's public `live.breadth.v1` file through the new session-gated proxy `GET /api/market-breadth`.
   - Without a session the proxy returns 401 locally and never contacts the gateway.
   - The upstream URL is pinned to `https://www.mastermind-x.com/live/breadth.json` and does not follow `BRAIN_GATEWAY_URL` (the file is public and static). Redirects are refused, the fetch has a 5-second deadline, and bodies over 256 KB are rejected.
   - The proxy sends a whitelisted projection only, never per-name membership. A wrong or missing schema, or anything else that does not validate, becomes 503.
   - **Live window.** Like Macro's own reader (`templates/live.js`, 25 minutes), a reading whose build or source clock is more than 25 minutes old is withheld as "Live source is behind". The proxy applies this on the server clock and the page applies it again on the reader's clock, so Friday's file seen on Sunday is never shown as live. A tab left open re-checks the reading when its window closes and when it comes back into view after the machine slept, and a clock more than 5 minutes ahead of the reader is not trusted as live.
   - When the reading is unusable (producer verdict or live window), the cell names the reason family and shows no numbers. The proxy does not send the numbers at all.
   - The cell is not a link and is never zero-filled.

## Matrix (28 cells, all asserted)

- **Mixed strip + live breadth (Monday clock):** 320 / 390 / 820 / 1440 widths × dark / light × EN / ZH (16 cells).
- **Sunday clock, each at 1440 dark EN, 1440 light EN, 390 light ZH and 390 dark ZH (12 cells):**
  - stale strip + breadth withheld by the producer (`session_closed`);
  - aged: Friday's usable file seen on Sunday → withheld as "Live source is behind", plus a reading dated after today (the ahead kind);
  - mixed strip + breadth 503.

**Each cell asserts:**
- The strip is outside `<details>`.
- Cell count = chips + 1.
- The exact freshness `data-kind` list, plus the read-line kind.
- `/api/market-breadth` is requested exactly once, after `/api/shared-shell/today`.
- The breadth cell is not a link.
- Withheld and unavailable states show no `%` and no delay text, and show the expected reason.
- Localized labels are present.
- Research and saved-list siblings are not erased.
- No horizontal overflow, one `<main>`, no page errors.
- WCAG contrast of every freshness label is ≥ 4.5:1 against its nearest opaque background.

**Result:** 28/28 pass; minimum freshness-label contrast is 5.55:1.

The first run failed the contrast gate: current/undated labels in `--muted` measured 4.07:1. That led to the `--text-2` ink above.

## Reproduce

```bash
CAPTURE_SOURCE_HEAD=<sha> node docs/pr-crops/shared-shell-today-strip-freshness-20261101/today/capture.mjs
```

- **Optional:** `CAPTURE_FONTS_CSS` / `CAPTURE_FONTS_DIR` point the harness at the built Inter chunk; otherwise it uses the system fallback font.
- **Receipt:** `capture-receipt.json` holds the sha256 of each source, the harness, `report.json` and every PNG.

## Local test note

- On Node ≥ 22 the jsdom suites need `NODE_OPTIONS=--localstorage-file=<fresh file>`.
- When several suites share one persisted file under parallel workers, one `todayResearchAttention` case can fail on leaked storage.
- Fix: run with a fresh file and `--no-file-parallelism`. CI runs Node 20, which needs neither.
