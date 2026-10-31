"use client";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { useSharedShellPresentation } from "./SharedShellPresentation";

/** Public local choices; the avatar remains the account/settings entry point. */
export default function SharedShellPresentationControls() {
  const t = useSharedShellT();
  const { context, requestContext } = useSharedShellPresentation();
  const light = context.theme === "light";
  const chinese = context.locale === "zh";
  const theme = t(light ? "shellThemeLight" : "shellThemeDark");
  return <div className="shared-shell-presentation" role="group" aria-label={t("shellPresentation")}>
    <button type="button" className="shared-shell-presentation-toggle" aria-label={t("shellLightTheme")}
      aria-pressed={light} title={`${t("shellTheme")}: ${theme}`}
      onClick={() => requestContext({ theme: light ? "dark" : "light" })}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {light ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>
          : <path d="M20.5 14.5A8.7 8.7 0 0 1 9.5 3.5a8.7 8.7 0 1 0 11 11Z" />}
      </svg>
      <span className="shared-shell-theme-label" aria-hidden="true">{theme}</span>
    </button>
    <button type="button" className="shared-shell-presentation-toggle" aria-label={t("shellChineseLanguage")}
      aria-pressed={chinese} title={`${t("shellLanguage")}: ${t(chinese ? "shellLanguageChinese" : "shellLanguageEnglish")}`}
      onClick={() => requestContext({ locale: chinese ? "en" : "zh" })}>
      <span aria-hidden="true">{t("shellLanguageCode")}</span>
    </button>
  </div>;
}
