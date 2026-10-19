"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { sharedShellCatalog, sharedShellDirectory } from "@/lib/sharedShellRoutes";
import { SHARED_SHELL_NAV } from "@/lib/sharedShellNavigation";

type Entry = { href: string; kind: string; title: { en: string; zh: string }; group: string };
const SECTIONS = ["all", "workspaces", "markets", "research", "learn", "tools", "about"] as const;
function section(entry: Entry): string {
  if (entry.kind === "native") return "workspaces";
  if (/^\/learn(?:[/.]|$)|^\/reference/.test(entry.href)) return "learn";
  if (/^\/(?:research|blog|stocks\/earnings)/.test(entry.href)) return "research";
  if (/^\/tools\//.test(entry.href) || entry.href.includes("calc")) return "tools";
  if (/^(public_nav|footer)\./.test(entry.group)) return "about";
  return "markets";
}
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase().trim();

export default function ShellDirectory({ open, onClose, onSearchCompanies }: {
  open: boolean; onClose: () => void; onSearchCompanies: () => void;
}) {
  const t = useSharedShellT();
  const { lang } = useLang();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [limit, setLimit] = useState(48);
  const lastFocus = useRef<HTMLElement | null>(null);
  const selected = useRef(false);
  const tokens = useMemo(() => normalize(query).split(/\s+/).filter(Boolean), [query]);

  const matches = useMemo(() => {
    const seen = new Set<string>();
    const result: Entry[] = [];
    const ranked = [...sharedShellDirectory].sort((a, b) => {
      const ai = SHARED_SHELL_NAV.findIndex(n => n.href === a.href);
      const bi = SHARED_SHELL_NAV.findIndex(n => n.href === b.href);
      return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi);
    });
    for (const entry of ranked) {
      if (category !== "all" && section(entry) !== category) continue;
      const haystack = normalize(entry.title.en + " " + entry.title.zh + " " + entry.href);
      if (!tokens.every(token => haystack.includes(token))) continue;
      seen.add(entry.href); result.push(entry);
    }
    // A finite path search also reaches reports, calculators and lessons within
    // canonical families. No speculative URL is synthesized from the query.
    if (tokens.length && category !== "workspaces" && category !== "about") {
      for (const href of sharedShellCatalog.legacyPaths) {
        if (seen.has(href) || !tokens.every(token => normalize(href).includes(token))) continue;
        const label = href.replace(/^\//, "").replace(/\.html$/, "").replace(/[_-]/g, " ").replace(/\//g, " / ");
        const entry = { href, kind: "legacy", title: { en: label, zh: label }, group: "none" };
        if (category !== "all" && section(entry) !== category) continue;
        result.push(entry); seen.add(href);
      }
    }
    return result;
  }, [tokens, category]);

  useEffect(() => { setLimit(48); }, [query, category]);
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    selected.current = false;
    lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    input.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (element.open) element.close();
      document.body.style.overflow = previous;
      if (!selected.current && lastFocus.current?.isConnected) lastFocus.current.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog ref={dialog} className="shared-shell-directory" aria-labelledby="shared-directory-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="shared-directory-surface">
        <header className="shared-directory-header">
          <div><span className="shared-directory-eyebrow">{t("shellWorkspace")}</span>
            <h2 id="shared-directory-title">{t("shellAllTools")}</h2>
            <p>{t("shellDirectoryIntro")}</p>
          </div>
          <button type="button" className="shared-shell-icon-button" aria-label={t("close")} onClick={onClose}>×</button>
        </header>
        <div className="shared-directory-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          <input ref={input} type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder={t("shellFindPage")} aria-label={t("shellFindPage")} autoComplete="off" />
          <kbd>esc</kbd>
        </div>
        <div className="shared-directory-filters" role="group" aria-label={t("shellCategories")}>
          {SECTIONS.map(item => <button key={item} type="button" aria-pressed={category === item}
            onClick={() => setCategory(item)}>{t("shellSection_" + item)}</button>)}
        </div>
        <div className="shared-directory-results" aria-live="polite">
          {!matches.length ? (
            <div className="shared-directory-empty">
              <h3>{t("shellNoPages")}</h3><p>{t("shellNoPagesHint")}</p>
              <button type="button" onClick={() => { selected.current = true; onClose(); requestAnimationFrame(onSearchCompanies); }}>
                {t("shellSearchCompanies")}
              </button>
            </div>
          ) : (
            <div className="shared-directory-grid">
              {matches.slice(0, limit).map(entry => (
                <Link key={entry.href} href={entry.href} prefetch={false}
                  onClick={() => { selected.current = true; onClose(); }}
                  className="shared-directory-link">
                  <span className="shared-directory-link-icon" aria-hidden="true">
                    {entry.kind === "native" ? "↗" : "◫"}
                  </span>
                  <span><strong>{entry.title[lang]}</strong><small>{t("shellSection_" + section(entry))}</small></span>
                  <span className="shared-directory-arrow" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          )}
          {limit < matches.length && <button className="shared-directory-more" type="button"
            onClick={() => setLimit(value => value + 48)}>{t("shellShowMore")}</button>}
        </div>
        <footer className="shared-directory-footer">
          <span>{t("shellPageCount").replace("{count}", String(matches.length))}</span>
          <button type="button" onClick={() => { selected.current = true; onClose(); requestAnimationFrame(onSearchCompanies); }}>
            {t("shellSearchCompanies")} <span aria-hidden="true">↗</span>
          </button>
        </footer>
      </div>
    </dialog>
  );
}
