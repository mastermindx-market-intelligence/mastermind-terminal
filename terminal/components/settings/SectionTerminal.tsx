"use client";
import { useState } from "react";
import { useAccountPrefs } from "@/lib/useMarketPrefs";
import { isAccountOwner } from "@/lib/accountIdentity";
import { ALL_MARKETS, MARKET_TKEY } from "@/lib/markets";
import { TF_CANONICAL_ORDER } from "@/lib/startTf";
import { DeliveryNote, Group, IconCheck, Row, SectionHead } from "./icons";
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
      <SectionHead title={t("acsTerminal")} sub={t("acsTerminalSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        <div className="acs-grid">
          {/* ── which markets exist for this user at all ──────────────────────
              Turning one off removes its symbols from search entirely — the
              operator's requirement that a China-only trader can stop seeing US
              names. The derived home market stays un-hideable so nobody can
              strand themselves with an empty universe. */}
          <Group title={t("acsMktGroup")}>
            <Row desc={t("mktSettingsSub")} />
            {prefs.autoNarrowed && <Row desc={t("mktAutoNarrowed")} />}
            {ALL_MARKETS.map((m) => {
              const on = prefs.enabled.includes(m);
              const isHome = prefs.home === m;
              return (
                <div className="acs-row" key={m}>
                  <button
                    type="button"
                    className="acs-check"
                    aria-pressed={on}
                    aria-disabled={isHome || undefined}
                    title={isHome ? t("mktHomeNote") : undefined}
                    onClick={() => { if (!isHome) mark("markets", toggle)(m); }}
                  >
                    <span className="box"><IconCheck /></span>
                    {t(MARKET_TKEY[m])}
                    {isHome && <span className="acs-tag">{t("mktHome")}</span>}
                  </button>
                </div>
              );
            })}
            {note(touched.markets)}
          </Group>

          <Group title={t("acsChartGroup")}>
            {/* Deliberately does NOT retime the chart that is already open: this
                names the timeframe the Terminal OPENS on, and a live re-time
                would silently rewrite the active pane of a deliberate multi-pane
                layout. TerminalShell reads the value at its next mount. */}
            <Row label={t("setStartTf")}>
              <div className="acs-tfg" role="group" aria-label={t("setStartTf")}>
                {TF_CANONICAL_ORDER.map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    className={terminal.startTf === tf ? "on" : ""}
                    aria-pressed={terminal.startTf === tf}
                    onClick={() => mark("chart", setStartTf)(tf)}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </Row>

            <Row
              label={t("updownColors")}
              control={
                <span className="acs-seg" role="group" aria-label={t("updownColors")}>
                  <button
                    type="button"
                    className={`acs-seg-b${terminal.updown === "west" ? " active" : ""}`}
                    aria-pressed={terminal.updown === "west"}
                    onClick={() => mark("chart", setUpDown)("west")}
                  >
                    <i style={{ background: "#26c281" }} />{t("greenUp")}
                  </button>
                  <button
                    type="button"
                    className={`acs-seg-b${terminal.updown === "east" ? " active" : ""}`}
                    aria-pressed={terminal.updown === "east"}
                    onClick={() => mark("chart", setUpDown)("east")}
                  >
                    <i style={{ background: "#f0566b" }} />{t("redUp")}
                  </button>
                </span>
              }
            />
            {note(touched.chart)}
          </Group>
        </div>
      </div>
    </>
  );
}
