"use client";
import { useEffect, useId, useState } from "react";
import OptionsPaywall from "@/components/OptionsPaywall";
import { useLang } from "@/lib/i18n";
import { optionsRoot, type OptionsPerspective } from "@/lib/optionsCompanion";
import { MatrixCompanion, type MatrixPreferences, type PinProps } from "./MatrixCompanion";
import { VannaCompanion } from "./VannaCompanion";
import { FlowCompanion } from "./FlowCompanion";
import { optionsT } from "./optionsStrings";
import styles from "./OptionsCompanion.module.css";

const PERSPECTIVES: OptionsPerspective[] = ["gamma", "vanna", "oi", "flow"];
const PREF_KEY = "mm.optionsCompanion.v1";
interface Preferences { perspective: OptionsPerspective; matrix: MatrixPreferences; oi: "oi" | "doi"; flow: "tape" | "volume" }
const DEFAULTS: Preferences = { perspective: "gamma", matrix: { expiries: "3", window: 6, norm: "global" }, oi: "oi", flow: "tape" };
function loadPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREF_KEY) ?? "null");
    if (!value || typeof value !== "object") return DEFAULTS;
    return {
      perspective: PERSPECTIVES.includes(value.perspective) ? value.perspective : "gamma",
      matrix: {
        expiries: ["3", "6", "12", "0dte"].includes(value.matrix?.expiries) ? value.matrix.expiries : "3",
        window: [3, 6, 12, 25].includes(value.matrix?.window) ? value.matrix.window : 6,
        norm: value.matrix?.norm === "column" ? "column" : "global",
      },
      oi: value.oi === "doi" ? "doi" : "oi", flow: value.flow === "volume" ? "volume" : "tape",
    };
  } catch { return DEFAULTS; }
}

export default function OptionsCompanion({ symbol, onClose, access, ...pin }: PinProps & {
  symbol: string; onClose: () => void; access: "loading" | "allowed" | "locked";
}) {
  const { lang } = useLang();
  const t = optionsT(lang);
  const root = optionsRoot(symbol);
  const id = useId();
  // This leaf is dynamic({ssr:false}); localStorage is not a server-rendered authority.
  const [prefs, setPrefs] = useState(loadPreferences);
  useEffect(() => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* storage is optional */ } }, [prefs]);
  const { onPin } = pin;
  useEffect(() => { onPin(null); return () => onPin(null); }, [symbol, access, onPin]);
  function perspective(next: OptionsPerspective) { setPrefs((p) => ({ ...p, perspective: next })); onPin(null); }
  return <section className={styles.root} data-options-companion data-options-root={root ?? "unsupported"} aria-label={`${t("options")} ${symbol}`}>
    <header className={styles.header}><h2>{t("options")}</h2><span className={styles.rootSymbol}>↔ {symbol}</span>
      <button type="button" onClick={onClose} className={styles.close} aria-label={t("close")}>×</button></header>
    <div className={styles.tabs} role="tablist" aria-label={t("perspectives")}>
      {PERSPECTIVES.map((key, index) => <button type="button" key={key} role="tab" id={`${id}-${key}`} aria-controls={`${id}-view`} aria-selected={prefs.perspective === key}
        tabIndex={prefs.perspective === key ? 0 : -1} onClick={() => perspective(key)} onKeyDown={(event) => {
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % PERSPECTIVES.length;
          else if (event.key === "ArrowLeft") next = (index + PERSPECTIVES.length - 1) % PERSPECTIVES.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = PERSPECTIVES.length - 1;
          else return;
          event.preventDefault(); event.stopPropagation(); perspective(PERSPECTIVES[next]);
          document.getElementById(`${id}-${PERSPECTIVES[next]}`)?.focus();
        }}>{t(key)}</button>)}
    </div>
    <div className={styles.view} role="tabpanel" id={`${id}-view`} aria-labelledby={`${id}-${prefs.perspective}`}>
      {pin.replayActive && <p className={styles.warning}>{t("replay")}</p>}
      {access === "loading" ? <p className={styles.empty} role="status">{t("loading")}</p> : access === "locked" ? <OptionsPaywall /> : !root ? <p className={styles.empty}>{t("unsupported")}</p> : <>
        {prefs.perspective === "oi" && <div className={styles.lens} role="group" aria-label={t("oi")}>
          {(["oi", "doi"] as const).map((value) => <button type="button" key={value} aria-pressed={prefs.oi === value} onClick={() => { setPrefs((p) => ({ ...p, oi: value })); onPin(null); }}>{value === "oi" ? t("oi") : "ΔOI"}</button>)}
        </div>}
        {prefs.perspective === "flow" && <div className={styles.lens} role="group" aria-label={t("flow")}>
          {(["tape", "volume"] as const).map((value) => <button type="button" key={value} aria-pressed={prefs.flow === value} onClick={() => { setPrefs((p) => ({ ...p, flow: value })); onPin(null); }}>{t(value)}</button>)}
        </div>}
        {(prefs.perspective === "gamma" || prefs.perspective === "oi" || (prefs.perspective === "flow" && prefs.flow === "volume")) &&
          <MatrixCompanion key={root} {...pin} root={root} t={t} prefs={prefs.matrix} onPrefs={(matrix) => setPrefs((p) => ({ ...p, matrix }))}
            metric={prefs.perspective === "gamma" ? "gex" : prefs.perspective === "oi" ? prefs.oi : "vol"} />}
        {prefs.perspective === "vanna" && <VannaCompanion key={root} {...pin} root={root} t={t} windowPct={prefs.matrix.window} />}
        {prefs.perspective === "flow" && prefs.flow === "tape" && <FlowCompanion key={root} root={root} t={t} lang={lang === "zh" ? "zh" : "en"} />}
      </>}
    </div>
  </section>;
}
