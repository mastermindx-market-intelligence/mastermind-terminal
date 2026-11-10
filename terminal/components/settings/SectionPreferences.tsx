"use client";
import { useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useOptionalSharedShellPresentation } from "@/components/chrome/shared-shell/SharedShellPresentation";
import { identityOwnerKey, isAccountOwner } from "@/lib/accountIdentity";
import {
  currentOwnerToken, ownerTokenIsCurrent, persistMetaPrefs, persistTradeTypes, useAccountPrefs,
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
  const presentation = useOptionalSharedShellPresentation();
  const { prefs, metaPrefs, setFollowed, setLangPref, sync, owner, retrySync } = useAccountPrefs(identity);
  const guest = !isAccountOwner(owner);
  const renderToken = currentOwnerToken();

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

  // Drop the prior owner's local answer before painting the incoming owner's section.
  // Delivery itself belongs to the existing owner-bound pump, outside this section's lifetime.
  const renderedFor = useRef(owner);
  if (renderedFor.current !== owner) {
    renderedFor.current = owner;
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

  // Accept the intent immediately into the existing serialized/coalescing pump. A section
  // switch must not cancel it; the pump retains its own account-generation boundary.
  function toggleTrade(id: string) {
    if (renderToken.owner !== owner || owner !== identityOwnerKey(identity) || !ownerTokenIsCurrent(renderToken)) return;
    const next = trades.includes(id) ? trades.filter((v) => v !== id) : [...trades, id];
    setPendingTrades(next);
    setTouched((s) => ({ ...s, trades: true }));
    if (guest) return;
    persistTradeTypes(next);
    // Keep section-to-section presentation current while the existing status note reports
    // delivery. The local profile update is not an acknowledgement from the authority.
    onPatchMeta({ trade_types: next });
  }

  const themeChoice: ThemeChoice = metaPrefs.themeAuto === "1"
    ? "auto"
    : (metaPrefs.theme === "light" ? "light" : "dark");

  function pickTheme(choice: ThemeChoice) {
    // Matches the macro semantics: `auto` records the flag and lets the dashboard
    // compute the theme from local time; an explicit pick records the theme and
    // clears the flag. The mounted 3D Research Lab consumes this preference;
    // Shared Shell also applies explicit intent when the saved choice is unchanged.
    setTouched((s) => ({ ...s, theme: true }));
    if (choice === "auto") persistMetaPrefs({ themeAuto: "1" });
    else persistMetaPrefs({ theme: choice, themeAuto: "0" });
    presentation?.applyThemeChoice(choice);
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
            desc={presentation
              ? (lang === "zh"
                ? "选择浅色或深色会立即应用于当前工作区；自动模式跟随系统配色偏好。"
                : "Choose Light or Dark for this workspace. Auto follows your system colour scheme.")
              : (lang === "zh"
                ? "应用于宏观仪表盘与 3D 研究室。终端其他视图保持深色。自动模式按本地时间在 07:00–19:00 使用浅色。"
                : "Applies to the Macro Dashboard and 3D Research Lab. Other Terminal views remain dark. Auto uses local time: light from 07:00 to 19:00.")}
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
