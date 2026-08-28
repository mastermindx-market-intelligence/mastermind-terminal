"use client";
import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { isAccountOwner } from "@/lib/accountIdentity";
import {
  currentOwnerToken, ownerTokenIsCurrent, persistMetaPrefs, persistTradeTypes, useAccountPrefs,
  type OwnerToken,
} from "@/lib/useMarketPrefs";
import { FOLLOW_IDS, FOLLOW_TKEY, type FollowId } from "@/lib/markets";
import { DeliveryNote, Group, IconCheck, Row, SectionHead } from "./icons";
import type { SectionProps } from "./types";

// ── Preferences ──────────────────────────────────────────────────────────────
// Ported from the macro dashboard's desk-prefs + `_renderSDPrefs`. These are the
// two questions signup asks (markets you follow / what you trade), editable ever
// after, plus appearance and language.
//
// Every edit here is delivered by ONE owner-bound serialized pump (E2, see
// lib/prefDelivery.ts). This section used to run its own `auth.updateUser()`
// alongside the store's, which meant two concurrent writes to one authority and
// two different notions of "saved":
//
//   * `toggleFollow` flashed "Saved" the instant `setFollowed()` returned — a
//     synchronous call whose network half had not even been attempted, let alone
//     acknowledged. A failure was invisible.
//   * `toggleTrade` fired its own debounced `updateUser` and read `{ error }`
//     correctly, but the 500 ms timer resolved the ACCOUNT at execution time, so
//     a sign-out or account switch inside the window wrote one user's answer into
//     whatever session existed when it fired.
//
// Now: the change applies locally at once, the note says `Saving…`, and it says
// `Saved` only when the authority acknowledged it.

const TRADES: [string, string][] = [
  ["stocks", "acsTrStocks"],
  ["options", "acsTrOptions"],
  ["crypto", "acsTrCrypto"],
];

type ThemeChoice = "light" | "auto" | "dark";

function Chip({
  on, label, onClick, groupLabel,
}: { on: boolean; label: string; onClick: () => void; groupLabel?: string }) {
  return (
    <button
      type="button"
      className="acs-pchip"
      aria-pressed={on}
      aria-label={groupLabel ? `${groupLabel}: ${label}` : undefined}
      onClick={onClick}
    >
      <span className="box"><IconCheck /></span>
      {label}
    </button>
  );
}

export default function SectionPreferences({ t, identity, user, onClose, onPatchMeta }: SectionProps) {
  const { lang, setLang } = useLang();
  const { prefs, metaPrefs, setFollowed, setLangPref, sync, owner, retrySync } = useAccountPrefs(identity);
  const guest = !isAccountOwner(owner);

  // Which rows have been edited THIS session, per owner. A control the user has not touched says
  // nothing — a shared lane status pinned under every row would report one row's write as if it
  // were another's.
  const [touched, setTouched] = useState({ follow: false, trades: false, theme: false });

  // `trade_types` is a TOP-LEVEL user_metadata array — a safe whole-value replace
  // (unlike the nested `terminal`/`prefs` blobs, which lib/useMarketPrefs merges).
  const metaTrades = Array.isArray(user?.meta?.trade_types)
    ? (user!.meta.trade_types as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  // Derived, not synced: the account answer shows until the user edits, then the
  // local pick wins. (A props→state useEffect here would both lag the first paint
  // and clobber a live edit when the cached user refreshes.)
  const [pendingTrades, setPendingTrades] = useState<string[] | null>(null);
  const trades = pendingTrades ?? metaTrades;

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // An owner change cancels this section's outstanding deferred mutation and drops the previous
  // owner's un-committed answer. Done DURING RENDER, not in an effect: an effect runs after
  // paint, so the outgoing owner's chips would render for a frame under the incoming owner and
  // the timer would still be live while they did.
  const renderedFor = useRef(owner);
  if (renderedFor.current !== owner) {
    renderedFor.current = owner;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (pendingTrades) setPendingTrades(null);
    if (touched.follow || touched.trades || touched.theme) {
      setTouched({ follow: false, trades: false, theme: false });
    }
  }

  function toggleFollow(id: FollowId) {
    const next = prefs.followed.includes(id)
      ? prefs.followed.filter((f) => f !== id)
      : [...prefs.followed, id];
    setTouched((s) => ({ ...s, follow: true }));
    setFollowed(next);
  }

  // Debounced like macro's `_sdSaveDesk` — a burst of chip taps is one write. The pump would
  // coalesce them anyway; the debounce keeps the request count down for a fast tapper.
  function toggleTrade(id: string) {
    const next = trades.includes(id) ? trades.filter((v) => v !== id) : [...trades, id];
    setPendingTrades(next);
    setTouched((s) => ({ ...s, trades: true }));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (guest) { saveTimer.current = null; return; }
    // E5: the owner is captured HERE, when the user expressed the intent — not read at
    // execution time, when it may name a different account entirely.
    const token: OwnerToken = currentOwnerToken();
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      if (!ownerTokenIsCurrent(token)) return;   // the intent outlived its owner — discard it
      persistTradeTypes(next);
      // Mirror it into the cached profile so the ID card repaints without a second read. This is
      // a LOCAL cache update, not a claim about the authority — that is what the note reports.
      onPatchMeta({ trade_types: next });
    }, 500);
  }

  const themeChoice: ThemeChoice = metaPrefs.themeAuto === "1"
    ? "auto"
    : (metaPrefs.theme === "light" ? "light" : "dark");

  function pickTheme(choice: ThemeChoice) {
    // Matches the macro semantics: `auto` records the flag and lets the dashboard
    // compute the theme from local time; an explicit pick records the theme and
    // clears the flag. Nothing is applied to the Terminal — it has no light mode.
    setTouched((s) => ({ ...s, theme: true }));
    if (choice === "auto") persistMetaPrefs({ themeAuto: "1" });
    else persistMetaPrefs({ theme: choice, themeAuto: "0" });
  }

  function pickLang(l: "en" | "zh") {
    setTouched((s) => ({ ...s, theme: true }));
    setLang(l);       // live UI switch (writes localStorage + <html data-lang>)
    setLangPref(l);   // and the account record the macro dashboard reads
  }

  const note = (show: boolean) => (
    <DeliveryNote phase={sync.phase} guest={guest} show={show} t={t} onRetry={retrySync} />
  );

  return (
    <>
      <SectionHead title={t("acsPrefs")} sub={t("acsPrefsSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        <Group title={t("acsDeskGroup")}>
          <Row label={t("acsMarkets")} desc={t("acsMarketsNote")}>
            <div className="acs-pchips" role="group" aria-label={t("acsMarkets")}>
              {FOLLOW_IDS.map((id) => (
                <Chip
                  key={id}
                  on={prefs.followed.includes(id)}
                  label={t(FOLLOW_TKEY[id])}
                  groupLabel={t("acsMarkets")}
                  onClick={() => toggleFollow(id)}
                />
              ))}
            </div>
            {note(touched.follow)}
          </Row>

          <Row label={t("acsTrades")} desc={t("acsTradesNote")}>
            <div className="acs-pchips" role="group" aria-label={t("acsTrades")}>
              {TRADES.map(([id, key]) => (
                <Chip
                  key={id}
                  on={trades.includes(id)}
                  label={t(key)}
                  groupLabel={t("acsTrades")}
                  onClick={() => toggleTrade(id)}
                />
              ))}
            </div>
            {note(touched.trades)}
          </Row>
        </Group>

        <Group title={t("acsThemeLang")}>
          <Row
            label={t("acsAppearance")}
            desc={t("acsAppearNote")}
            control={
              <span className="acs-seg" role="group" aria-label={t("acsAppearance")}>
                {(["light", "auto", "dark"] as ThemeChoice[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`acs-seg-b${themeChoice === c ? " active" : ""}`}
                    aria-pressed={themeChoice === c}
                    onClick={() => pickTheme(c)}
                  >
                    {t(c === "light" ? "acsThemeLight" : c === "auto" ? "acsThemeAuto" : "acsThemeDark")}
                  </button>
                ))}
              </span>
            }
          />
          <Row
            label={t("language")}
            desc={t("acsLangNote")}
            control={
              <span className="acs-seg" role="group" aria-label={t("language")}>
                <button
                  type="button"
                  className={`acs-seg-b${lang === "en" ? " active" : ""}`}
                  aria-pressed={lang === "en"}
                  onClick={() => pickLang("en")}
                >EN</button>
                <button
                  type="button"
                  className={`acs-seg-b${lang === "zh" ? " active" : ""}`}
                  aria-pressed={lang === "zh"}
                  onClick={() => pickLang("zh")}
                >中文</button>
              </span>
            }
          />
          {note(touched.theme)}
        </Group>
      </div>
    </>
  );
}
