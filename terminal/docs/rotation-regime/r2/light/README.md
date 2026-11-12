# Rotation & Pivot Intelligence · R2 light-theme product proof

**Fixture/local product preview only. Not current market data, not an authenticated production path, not a signed-in deployment proof, and not product or release acceptance.**

## What these twelve captures are

Twelve real Chromium captures of the existing R2 **Opening-range pivot preview** under the
app's **light theme root**, at the three source-owned responsive viewports — desktop
1440×900, tablet 820×1180, mobile 390×844 — in English and Chinese. **Six fresh browser
contexts were executed**; each context shows both required states:

| state | file pattern | what the state proves |
|---|---|---|
| normal qualified preview | `<viewport>-<lang>-preview.png` | the reconstructed completed-bar chart, its causal known-at origin, the sector control and the bilingual readouts all under the light theme root |
| existing missing-SPY benchmark | `<viewport>-<lang>-missing-spy.png` | the existing missing-benchmark state withholds the inadmissible chart and outcome and states the bilingual qualification |

The journey is the incumbent product path — `/discover?tab=rs-pivot` → ready, enabled
**Open rotation monitor** → the real R1+R2 monitor → select **XLK** and **XLP** → inspect
the chart and readouts → close and return — driven by the incumbent synthetic 5m fixture and
the incumbent fixed clock. No production data fetch, credential, account, purchase or
external provider was used. The separately owned external Brain widget is untouched; no R2
qualification, entitlement or reader decision was stubbed.

## Executed proof

- **Tested source:** commit `dcd4f4071db4f6512bd0e843a502c259371648ba` (tree
  `b3d05755eb8ea9362175fda4120ed5de2fb85d8a`) — the two-parent merge of the original R2
  head `c0baec65eb10ae53771ba7edb7c212e31289dbd2` with the frozen protected Terminal
  master `293602908b6b009922b17c9ff613d6e27d201e9a`. The four R2 production blobs are
  byte-identical to the original candidate.
- **Browser:** Chromium 149.0.7827.55 (Playwright 1.61.1, revision 1228), one worker,
  one owner-reserved loopback port `32181`, `--workers=1 --retries=0`.
- **Result: 6 passed, 0 skipped, 0 flaky, 0 retried, 0 unexpected** (16.7 s), two cases
  (EN, ZH) expanded across three projects, each case producing both states.
- **Command shape actually executed** from `terminal/`:

  ```bash
  CI=1 TERMINAL_E2E_PORT=32181 \
  npm run test:e2e:responsive -- e2e/rotation-monitor.spec.ts \
    --grep "R2 light-theme product proof" \
    --project=desktop --project=tablet --project=mobile \
    --workers=1 --retries=0
  ```

- Each case asserts: the responsive chart is visible and the SVG viewBox matches the
  measured container width; the document does not overflow the viewport; the support and
  resistance level lines start **exactly** at the known-at marker and strictly to the right
  of the first reconstructed bar (no earlier-bar look-ahead); the sector control is enabled
  and the real reader updates when **XLP** is selected and returns on **XLK**; the Chinese
  view shows Chinese strings and never leaks the English title (and the reverse); the
  normal close path returns to the closed monitor; the missing-SPY state withholds the chart
  and both readouts and states the bilingual qualification; the applied theme root is still
  `light` at capture time; and **zero** unexpected browser page errors.
- `npx tsc --noEmit --incremental false` exit 0; `npx eslint e2e/rotation-monitor.spec.ts`
  exit 0.

## Theme and language readback — applied, not requested

The stored appearance and language preferences are set **before navigation**
(`theme=light`, `theme_auto=0`, `mm.lang=en|zh`). Storage alone leaves `layout.tsx`'s
server dark attribute unchanged, so the app's **existing CSS theme root**
(`document.documentElement[data-theme]`) is set explicitly — the same applied-theme switch
the accepted terminal light/dark evidence uses. The applied theme is then **read back and
asserted**, never inferred from a file name: every one of the six cases recorded
`data-theme="light"` with `data-lang="en"` or `"zh"`, and that readback is attached to the
test result as `actual-theme` with the element's computed foreground and background.

### Observed limitation (disclosed, production code untouched)

The applied theme root really is `light`, but the **Terminal product surface is dark-only
by design** — `terminal/app/settings.css` states that the macro `html[data-theme="light"]`
branch is not ported, and the core `:root` tokens are not overridden for a light root
outside the shared-shell beta and the options-companion subtree. The captured R2 preview
therefore **retains the Terminal's own dark material** under the light root: the attached
computed foreground is `rgb(214, 218, 227)`, the dark `--text` token. The same is already
true of the accepted master-branch light/dark evidence for the market-risk surface, whose
light and dark captures share one sha256.

Consequently these captures prove **legibility and correctness of the R2 product path under
the light theme root** — geometry, bilingual qualification, responsive fit, controls and
zero browser errors — and they do **not** claim a redesigned light palette for the Terminal
core. No production source, styling, dependency, entitlement, data or collector file was
changed for this proof; if a genuinely light-material Terminal surface is required, that is
the separate shared-shell beta surface and a separate admitted change.

## Provenance

Operation `rotation-pivot-watch-r2-20261103-sol-001`; original branch
`sol/web-rotation-pivot-watch-r2-20261103-sol-001`; original PR
`mastermindx-market-intelligence/mastermind-terminal#1281` (Draft). `manifest.json` in this
directory carries the per-artifact sha256 digests, byte counts, pixel dimensions, state,
language and theme readback. Fixture prices are **not** current market data.
