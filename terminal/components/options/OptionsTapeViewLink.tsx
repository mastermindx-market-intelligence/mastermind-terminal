"use client";

import { useRef, useState } from "react";
import { useTapeViewText } from "./optionsTapeViewStrings";
import { type TapeViewState } from "@/lib/optionsTapeView";
import { encodeTapeScreen } from "@/lib/optionsTapeFilterGroups";
import s from "./OptionsTapeViewLink.module.css";

/** Shares display controls only. Entitlements and the recipient's current feed still apply. */
export function OptionsTapeViewLink({ state, groups }: { state: TapeViewState; groups?: readonly TapeViewState[] }) {
  const t = useTapeViewText();
  const [origin, setOrigin] = useState<string | null>(null);
  const [copyResult, setCopyResult] = useState<{ href: string; copied: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  let encoded: string | null = null;
  try {
    encoded = encodeTapeScreen(state, groups);
  } catch { /* unsupported input cannot become a broader view */ }
  const params = new URLSearchParams({ tab: "tape", ...(encoded ? { tapeView: encoded } : {}) });
  const href = origin && encoded ? `${origin}/options?${params}` : "";
  const close = () => { setOrigin(null); launcher.current?.focus(); };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopyResult({ href, copied: true });
    } catch {
      setCopyResult({ href, copied: false });
      input.current?.focus();
      input.current?.select();
    }
  };

  return <>
    <button ref={launcher} type="button" className={`chip ${s.launch}`} disabled={!encoded}
      data-options-tape-view="share" aria-expanded={origin !== null} aria-controls="options-tape-view-link"
      title={encoded ? t("tapeViewNote") : t("tapeViewInvalidBody")}
      onClick={() => { if (origin) close(); else {
        setOrigin(window.location.origin);
        window.requestAnimationFrame(() => input.current?.focus());
      } }}>
      {t("tapeViewShare")}
    </button>
    {origin !== null && <section id="options-tape-view-link" className={s.panel}
      aria-label={t("tapeViewTitle")} onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
      <label className={s.label} htmlFor="options-tape-view-url">{t("tapeViewTitle")}</label>
      <div className={s.controls}>
        <input id="options-tape-view-url" ref={input} readOnly value={href} className={s.input}
          onFocus={(event) => event.currentTarget.select()} data-options-tape-view="url" />
        <button type="button" className={`chip ${s.action}`} onClick={copy} disabled={!href}>
          {copyResult?.href === href && copyResult.copied ? t("tapeViewCopied") : t("tapeViewCopy")}
        </button>
        <button type="button" className={`chip ${s.action}`} onClick={close}>{t("tapeViewClose")}</button>
      </div>
      <p className={s.note}>{t("tapeViewNote")}</p>
      <span role="status" className={s.note}>
        {copyResult?.href === href ? (copyResult.copied ? t("tapeViewCopied") : t("tapeViewCopyFailed")) : ""}
      </span>
    </section>}
  </>;
}
