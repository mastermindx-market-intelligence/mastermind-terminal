"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { identityOwnerKey, type AccountIdentity } from "@/lib/accountIdentity";
import { useLang } from "@/lib/i18n";
import { useAccountPrefs } from "@/lib/useMarketPrefs";
import type { ShellContext, ShellLocale, ShellTheme } from "@/lib/sharedShellContracts";

type PresentationRequest = { theme?: ShellTheme; locale?: ShellLocale };
type ThemeChoice = ShellTheme | "auto";
type PresentationApi = {
  context: ShellContext;
  requestContext: (value: PresentationRequest) => void;
  applyThemeChoice: (choice: ThemeChoice) => void;
};
const PresentationContext = createContext<PresentationApi | null>(null);

/** The existing Runtime presentation owner, shared by its host and public controls. */
function PresentationOwner({ identity, children }: { identity: AccountIdentity; children: ReactNode }) {
  const identityKey = identityOwnerKey(identity);
  const { metaPrefs } = useAccountPrefs(identity);
  const { lang, setLang } = useLang();
  const themeChoice = useRef<ThemeChoice>("dark");
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the external document presentation before paint.
    readPresentation();
    return () => {
      observer.disconnect();
      delete root.dataset.mmxSharedShell;
      // The chart workspace retains its incumbent dark presentation.
      root.dataset.theme = "dark";
    };
  }, [readPresentation]);

  // Account loads and explicit Settings choices share this applier. A repeated
  // choice is still an intent; applying it does not overwrite the guest cache.
  const applyThemeChoice = useCallback((choice: ThemeChoice) => {
    themeChoice.current = choice;
    const theme: ShellTheme = choice === "auto"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : choice;
    document.documentElement.dataset.theme = theme;
    readPresentation();
  }, [readPresentation]);

  useEffect(() => {
    let choice: ThemeChoice = "dark";
    if (metaPrefs.themeAuto === "1") {
      choice = "auto";
    } else if (metaPrefs.theme === "light" || metaPrefs.theme === "dark") {
      choice = metaPrefs.theme;
    } else {
      try { if (localStorage.getItem("mmx.shell.theme") === "light") choice = "light"; } catch { /* blocked storage */ }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external account metadata is the presentation owner input.
    applyThemeChoice(choice);
  }, [metaPrefs.theme, metaPrefs.themeAuto, identityKey, applyThemeChoice]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- incumbent locale owner updates the document outside this provider.
  useEffect(readPresentation, [lang, readPresentation]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      if (themeChoice.current !== "auto") return;
      document.documentElement.dataset.theme = media.matches ? "dark" : "light";
      readPresentation();
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [readPresentation]);

  const requestContext = useCallback((value: PresentationRequest) => {
    // Presentation requests never write account metadata. Explicit Settings edits
    // continue through the incumbent owner-bound preference delivery pump.
    if (value.theme) {
      themeChoice.current = value.theme;
      document.documentElement.dataset.theme = value.theme;
      try { localStorage.setItem("mmx.shell.theme", value.theme); } catch { /* blocked storage */ }
    }
    if (value.locale) setLang(value.locale);
    readPresentation();
  }, [setLang, readPresentation]);

  const api = useMemo(() => ({ context, requestContext, applyThemeChoice }), [context, requestContext, applyThemeChoice]);
  return <PresentationContext.Provider value={api}>{children}</PresentationContext.Provider>;
}

/** The ordinary shell mounts no presentation owner and receives no new effects. */
export function SharedShellPresentation({ enabled, identity, children }: {
  enabled: boolean; identity: AccountIdentity; children: ReactNode;
}) {
  return enabled ? <PresentationOwner identity={identity}>{children}</PresentationOwner> : children;
}

/** Settings is also mounted by ordinary shells, where no presentation owner exists. */
export function useOptionalSharedShellPresentation(): PresentationApi | null {
  return useContext(PresentationContext);
}

export function useSharedShellPresentation(): PresentationApi {
  const value = useOptionalSharedShellPresentation();
  if (!value) throw new Error("Shared Shell presentation requires its AppShell owner");
  return value;
}
