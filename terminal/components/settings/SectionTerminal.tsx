"use client";
import { useState } from "react";
import { useAccountPrefs } from "@/lib/useMarketPrefs";
import { isAccountOwner } from "@/lib/accountIdentity";
import { ALL_MARKETS, MARKET_TKEY } from "@/lib/markets";
import { TF_CANONICAL_ORDER } from "@/lib/startTf";
import { DeliveryNote, IconCheck, SectionHead } from "./icons";
import type { SectionProps } from "./types";

// ── Terminal ─────────────────────────────────────────────────────────────────
// NEW section — no macro counterpart. This is where the old SettingsMenu's
// Terminal-only controls moved: which markets exist for this user at all, the
// timeframe the Terminal opens on, and the up/down colour convention.
//
// Everything here persists through lib/useMarketPrefs (localStorage + Supabase
// user_metadata), so there is no save button and nothing to wire beyond the
// store calls.

export default function SectionTerminal({ t, identity, onClose }: SectionProps) {
  const { prefs, terminal, toggle, setStartTf, setUpDown, sync, owner, retrySync } = useAccountPrefs(identity);
  const guest = !isAccountOwner(owner);
  // E2: these controls apply locally the moment they are clicked, but "Saved" is a claim about
  // the ACCOUNT — reported from the delivery pump's acknowledgement, not from having fired a
  // request. Shown only once the user has actually changed something in this section.
  // Per GROUP, not per section: the two groups sit side by side in the desktop grid, so one
  // shared note under the right-hand column would report a left-hand column edit.
  const [touched, setTouched] = useState({ markets: false, chart: false });
  const mark = <T,>(group: "markets" | "chart", fn: (v: T) => void) => (v: T) => {
    setTouched((s) => (s[group] ? s : { ...s, [group]: true }));
    fn(v);
  };
  const note = (show: boolean) => (
    <DeliveryNote phase={sync.phase} guest={guest} show={show} t={t} onRetry={retrySync} />
  );

  return (
    <>
      <SectionHead title={t("acsTerminal")} sub={t("acsTerminalIntro")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        <div className="acs-terminal-grid">
          <section className="acs-terminal-group" aria-labelledby="acs-markets-title">
            <div className="acs-control-heading">
              <h3 id="acs-markets-title">{t("acsMarketsSearch")}</h3>
              <p>{t("acsMarketsSearchHelp")}</p>
            </div>
            {prefs.autoNarrowed && <p className="acs-control-help">{t("mktAutoNarrowed")}</p>}
            <div className="acs-market-list">
              {ALL_MARKETS.map(m => {
                const on = prefs.enabled.includes(m);
                const isHome = prefs.home === m;
                return (
                  <button
                    key={m}
                    type="button"
                    className="acs-check"
                    aria-pressed={on}
                    aria-disabled={isHome || undefined}
                    title={isHome ? t("mktHomeNote") : undefined}
                    onClick={() => { if (!isHome) mark("markets", toggle)(m); }}
                  >
                    <span className="acs-market-label">{t(MARKET_TKEY[m])}</span>
                    {isHome && <span className="acs-tag">{t("mktHome")}</span>}
                    <span className="box" aria-hidden="true"><IconCheck /></span>
                  </button>
                );
              })}
            </div>
            <p className="acs-control-help">{t("acsMarketsSearchOnly")}</p>
            {note(touched.markets)}
          </section>

          <section className="acs-terminal-group" aria-label={t("acsChartGroup")}>
            <div className="acs-control-heading">
              <h3 id="acs-timeframe-title">{t("acsDefaultTimeframe")}</h3>
              <p id="acs-timeframe-help">{t("acsTimeframeHelp")}</p>
            </div>
            {/* This preference deliberately does not retime an already open chart. */}
            <div className="acs-tfg" role="group" aria-labelledby="acs-timeframe-title" aria-describedby="acs-timeframe-help">
              {TF_CANONICAL_ORDER.map(tf => (
                <button
                  key={tf}
                  type="button"
                  className={terminal.startTf === tf ? "on" : ""}
                  aria-pressed={terminal.startTf === tf}
                  onClick={() => mark("chart", setStartTf)(tf)}
                >{tf}</button>
              ))}
            </div>
            <div className="acs-color-setting">
              <h3 id="acs-colors-title">{t("updownColors")}</h3>
              <div className="acs-color-options" role="group" aria-labelledby="acs-colors-title">
                {(["west", "east"] as const).map(convention => (
                  <button
                    key={convention}
                    type="button"
                    className={`acs-color-option${terminal.updown === convention ? " active" : ""}`}
                    aria-pressed={terminal.updown === convention}
                    onClick={() => mark("chart", setUpDown)(convention)}
                  >
                    {/* Fixed semantic swatches: --up/--down swap with this setting. */}
                    <i aria-hidden="true" style={{ background: convention === "west" ? "#26c281" : "#f0566b" }} />
                    {t(convention === "west" ? "greenUp" : "redUp")}
                    <span className="acs-color-check" aria-hidden="true"><IconCheck /></span>
                  </button>
                ))}
              </div>
              <p className="acs-control-help">{t("acsColorsHelp")}</p>
            </div>
            {note(touched.chart)}
          </section>
        </div>
      </div>
    </>
  );
}
