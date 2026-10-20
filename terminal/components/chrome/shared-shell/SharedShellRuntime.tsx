"use client";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { useAccountPrefs } from "@/lib/useMarketPrefs";
import { identityOwnerKey } from "@/lib/accountIdentity";
import { useLang } from "@/lib/i18n";
import type { ShellContext, ShellLocale, ShellTheme } from "@/lib/sharedShellContracts";
import LegacyPageHost from "./LegacyPageHost";
import ShellDirectory from "./ShellDirectory";

export default function SharedShellRuntime({
  legacyOrigin, directoryOpen, onCloseDirectory, onOpenDirectory, onSearchCompanies, onTitle,
}: {
  legacyOrigin: string; directoryOpen: boolean; onCloseDirectory: () => void;
  onOpenDirectory: () => void; onSearchCompanies: () => void; onTitle: (title: string) => void;
}) {
  const identity = useShellIdentity();
  const identityKey = identityOwnerKey(identity);
  const { metaPrefs } = useAccountPrefs(identity);
  const { lang, setLang } = useLang();
  const [context, setContext] = useState<ShellContext>({ theme: "dark", locale: "en", contextRevision: 0 });
  const readPresentation = useCallback(() => {
    const root = document.documentElement;
    const theme = root.dataset.theme === "light" ? "light" : "dark";
    const locale = root.dataset.lang === "zh" ? "zh" : "en";
    root.lang = locale === "zh" ? "zh-CN" : "en";
    setContext(previous => previous.theme === theme && previous.locale === locale
      ? previous : { theme, locale, contextRevision: previous.contextRevision + 1 });
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.mmxSharedShell = "1";
    const observer = new MutationObserver(readPresentation);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-lang"] });
    readPresentation();
    return () => {
      observer.disconnect();
      delete root.dataset.mmxSharedShell;
      // The chart workspace retains its incumbent dark presentation.
      root.dataset.theme = "dark";
    };
  }, [readPresentation]);

  useEffect(() => {
    let theme: ShellTheme = "dark";
    if (metaPrefs.themeAuto === "1") {
      const hour = new Date().getHours(); theme = hour >= 7 && hour < 19 ? "light" : "dark";
    } else if (metaPrefs.theme === "light" || metaPrefs.theme === "dark") {
      theme = metaPrefs.theme;
    } else {
      try { if (localStorage.getItem("mmx.shell.theme") === "light") theme = "light"; } catch { /* blocked storage */ }
    }
    document.documentElement.dataset.theme = theme;
    readPresentation();
  }, [metaPrefs.theme, metaPrefs.themeAuto, identityKey, readPresentation]);
  useEffect(readPresentation, [lang, readPresentation]);

  const requestContext = useCallback((value: { theme?: ShellTheme; locale?: ShellLocale }) => {
    // Presentation requests never write account metadata. Explicit Settings edits
    // continue through the incumbent owner-bound preference delivery pump.
    if (value.theme) {
      document.documentElement.dataset.theme = value.theme;
      try { localStorage.setItem("mmx.shell.theme", value.theme); } catch { /* blocked storage */ }
    }
    if (value.locale) setLang(value.locale);
    readPresentation();
  }, [setLang, readPresentation]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); onOpenDirectory();
      } else if (!event.metaKey && !event.ctrlKey && event.key === "/") {
        event.preventDefault(); onSearchCompanies();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onOpenDirectory, onSearchCompanies]);

  return (
    <>
      <LegacyPageHost legacyOrigin={legacyOrigin} identityKey={identityKey} context={context}
        onContextRequest={requestContext} onTitle={onTitle} />
      <ShellDirectory open={directoryOpen} onClose={onCloseDirectory} onSearchCompanies={onSearchCompanies} />
    </>
  );
}
