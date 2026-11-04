"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LEX, useLang } from "@/lib/i18n";
import { futuresTextFor } from "@/lib/futuresUiCopy";
import { SHARED_SHELL_COPY, useSharedShellT } from "@/lib/sharedShellCopy";
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
const canReceiveFocus = (element: HTMLElement | null): element is HTMLElement => !!element
  && element !== document.body && element !== document.documentElement
  && element.isConnected && element.getClientRects().length > 0
  && !element.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]')
  && !element.matches(':disabled, [aria-disabled="true"]')
  && getComputedStyle(element).visibility !== "hidden"
  && getComputedStyle(element).visibility !== "collapse";
// These native tools already use these keys in AppShell's title owner. Keep
// directory presentation on those keys; the projection still owns admission.
const nativeTitle = (entry: Entry): { k?: string; label: string; copy?: Entry["title"] } | undefined => {
  if (entry.kind !== "native") return undefined;
  const job = SHARED_SHELL_NAV.find(job => job.href === entry.href);
  if (job) return job;
  if (entry.href === "/options/futures") return {
    label: futuresTextFor("en").navTitle,
    copy: { en: futuresTextFor("en").navTitle, zh: futuresTextFor("zh").navTitle },
  };
  const k = entry.href === "/terminal" ? "setTerminal"
    : entry.href === "/learn" ? "shellSection_learn"
    : entry.href === "/alerts" ? "alerts"
    : entry.href === "/options" ? "options"
    : entry.href === "/scripts" ? "scripts"
    : entry.href === "/dislocations" ? "pageDislocations" : undefined;
  return k ? { k, label: entry.title.en } : undefined;
};

export default function ShellDirectory({ open, onClose, onSearchCompanies }: {
  open: boolean; onClose: () => void; onSearchCompanies: () => void;
}) {
  const t = useSharedShellT();
  const { lang } = useLang();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const allCategory = useRef<HTMLButtonElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [limit, setLimit] = useState(48);
  const lastFocus = useRef<HTMLElement | null>(null);
  const selected = useRef(false);
  const focusOwned = useRef(false);
  const composing = useRef(false);
  const escapeRequest = useRef<{ event: KeyboardEvent; protected: boolean; expiry: number } | null>(null);
  const revealFocus = useRef<{ button: HTMLButtonElement; index: number } | null>(null);
  const tokens = useMemo(() => normalize(query).split(/\s+/).filter(Boolean), [query]);
  const entryTitle = (entry: Entry) => {
    const job = nativeTitle(entry);
    if (!job) return entry.title[lang];
    return job.copy ? job.copy[lang] : job.k ? t(job.k, job.label) : job.label;
  };

  const { matches, allCount } = useMemo(() => {
    // Keep category-specific fallback semantics. Filtering an already-deduped
    // All list would silently change some incumbent public-nav/path results.
    const collect = (selectedCategory: string) => {
      const seen = new Set<string>();
      const result: Entry[] = [];
      const ranked = [...sharedShellDirectory].sort((a, b) => {
        const ai = SHARED_SHELL_NAV.findIndex(n => n.href === a.href);
        const bi = SHARED_SHELL_NAV.findIndex(n => n.href === b.href);
        return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi);
      });
      for (const entry of ranked) {
        if (seen.has(entry.href) || (selectedCategory !== "all" && section(entry) !== selectedCategory)) continue;
        const job = nativeTitle(entry);
        const aliases = job ? [job.label, job.copy?.en, job.copy?.zh,
          ...(job.k ? [SHARED_SHELL_COPY[job.k]?.("en"), SHARED_SHELL_COPY[job.k]?.("zh"),
            ...(LEX[job.k] ?? [])] : [])] : [];
        const haystack = normalize([entry.title.en, entry.title.zh, entry.href, ...aliases].join(" "));
        if (!tokens.every(token => haystack.includes(token))) continue;
        seen.add(entry.href); result.push(entry);
      }
      // A finite path search also reaches reports, calculators and lessons within
      // canonical families. No speculative URL is synthesized from the query.
      if (tokens.length && selectedCategory !== "workspaces" && selectedCategory !== "about") {
        for (const href of sharedShellCatalog.legacyPaths) {
          if (seen.has(href) || !tokens.every(token => normalize(href).includes(token))) continue;
          const label = href.replace(/^\//, "").replace(/\.html$/, "").replace(/[_-]/g, " ").replace(/\//g, " / ");
          const entry = { href, kind: "legacy", title: { en: label, zh: label }, group: "none" };
          if (selectedCategory !== "all" && section(entry) !== selectedCategory) continue;
          result.push(entry); seen.add(href);
        }
      }
      return result;
    };
    const matches = collect(category);
    return { matches, allCount: category === "all" ? matches.length : collect("all").length };
  }, [tokens, category]);

  useLayoutEffect(() => {
    const pending = revealFocus.current;
    revealFocus.current = null;
    if (!pending) return;
    // Only repair focus lost when the activated final-batch button disappears.
    // A later user focus movement belongs to that user, not this render.
    if (document.activeElement !== pending.button
      && !(document.activeElement === document.body && !pending.button.isConnected)) return;
    results.current?.querySelectorAll<HTMLAnchorElement>(".shared-directory-link")[pending.index]?.focus({ preventScroll: true });
  }, [limit]);
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    selected.current = false;
    focusOwned.current = false;
    composing.current = false;
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lastFocus.current = canReceiveFocus(invoker) ? invoker : null;
    const shell = element.closest(".shared-shell") ?? document;
    if (!element.open) element.showModal();
    input.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (escapeRequest.current) window.clearTimeout(escapeRequest.current.expiry);
      escapeRequest.current = null;
      const active = document.activeElement;
      // Removing a focused DOM subtree can leave BODY without firing blur.
      // Real focus movement outside the dialog clears focusOwned below.
      const owned = element.contains(active) || (focusOwned.current && active === document.body);
      const outside = !owned && active instanceof HTMLElement ? active : null;
      if (element.open) element.close();
      document.body.style.overflow = previous;
      if (!selected.current && owned) {
        const invokers = [lastFocus.current,
          ...shell.querySelectorAll<HTMLElement>('.shared-shell-directory-trigger, .mobilebar button[aria-haspopup="dialog"][aria-controls]'),
        ];
        const restore = (target: HTMLElement | null, contentFallback = false) => {
          if (!canReceiveFocus(target)) return false;
          // Only named content fallbacks may acquire a programmatic tab stop.
          // A saved control that lost focusability must yield to the next target.
          if (contentFallback && !target.hasAttribute("tabindex")) target.tabIndex = -1;
          target.focus({ preventScroll: true });
          return document.activeElement === target;
        };
        if (!invokers.some(target => restore(target))) {
          const content = [...shell.querySelectorAll<HTMLElement>('main h1, [role="main"] h1, .main2 h1'),
            ...shell.querySelectorAll<HTMLElement>('main, [role="main"], .main2')];
          content.some(target => restore(target, true));
        }
      } else if (canReceiveFocus(outside) && document.activeElement !== outside) {
        // A native dialog close must not undo a deliberate newer focus owner.
        outside.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (!open) return null;
  const formatCount = (value: number) => new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US").format(value);
  const filtered = category !== "all";
  const countKey = tokens.length
    ? (filtered ? "shellCategoryMatchCount" : matches.length === 1 ? "shellOneMatch" : "shellMatchCount")
    : (filtered ? (matches.length === 1 ? "shellCategoryOneDestination" : "shellCategoryDestinationCount")
      : matches.length === 1 ? "shellOneDestination" : "shellPageCount");
  const showAll = filtered && allCount > matches.length;
  const openCompanies = () => {
    selected.current = true;
    // AppShell already replaces directory with company search in one update.
    // A second requestAnimationFrame opener could outlive the current intent.
    onSearchCompanies();
  };
  return (
    <dialog ref={dialog} className="shared-shell-directory" aria-labelledby="shared-directory-title"
      onFocusCapture={() => { focusOwned.current = true; }}
      onBlurCapture={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) focusOwned.current = false; }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDownCapture={event => {
        if (event.key !== "Escape") return;
        if (escapeRequest.current) window.clearTimeout(escapeRequest.current.expiry);
        // Observe, but do not preempt, the child/IME. The HTML close-request
        // algorithm checks this keydown before issuing its native cancel.
        const request = { event: event.nativeEvent, protected: composing.current
          || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat, expiry: 0 };
        escapeRequest.current = request;
        // End this association after the current close-request task, even if
        // focus loss means keyup never arrives. This is not a delayed close.
        request.expiry = window.setTimeout(() => {
          if (escapeRequest.current === request) escapeRequest.current = null;
        }, 0);
      }}
      onKeyDown={event => {
        if (event.key !== "Escape" || event.defaultPrevented || composing.current
          || escapeRequest.current?.protected) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onKeyUp={event => {
        if (event.key !== "Escape") return;
        if (escapeRequest.current) window.clearTimeout(escapeRequest.current.expiry);
        escapeRequest.current = null;
      }}
      onCancel={event => {
        event.preventDefault();
        const request = escapeRequest.current;
        if (request) window.clearTimeout(request.expiry);
        escapeRequest.current = null;
        if (!composing.current && !request?.protected
          && !request?.event.defaultPrevented) onClose();
      }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="shared-directory-surface">
        <header className="shared-directory-header">
          <div><span className="shared-directory-eyebrow">{t("shellWorkspace")}</span>
            <h2 id="shared-directory-title">{t("shellAllTools")}</h2>
            <p>{t("shellDirectoryIntro")}</p>
          </div>
          <button type="button" className="shared-shell-icon-button" aria-label={t("shellCloseDirectory")} onClick={onClose}>×</button>
        </header>
        <div className="shared-directory-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          <input ref={input} type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(48); }}
            placeholder={t("shellFindPage")} aria-label={t("shellFindPage")} aria-describedby="shared-directory-status" autoComplete="off" />
          {query && <button type="button" className="shared-directory-query-clear" aria-label={t("shellClearDirectoryQuery")}
            onClick={() => { setQuery(""); setLimit(48); input.current?.focus({ preventScroll: true }); }}>
            <span aria-hidden="true">×</span>
          </button>}
          <kbd>esc</kbd>
        </div>
        <div className="shared-directory-filters" role="group" aria-label={t("shellCategories")}>
          {SECTIONS.map(item => <button key={item} ref={item === "all" ? allCategory : undefined} type="button" aria-pressed={category === item}
            onClick={() => { setCategory(item); setLimit(48); }}>{t("shellSection_" + item)}</button>)}
        </div>
        <div ref={results} className="shared-directory-results">
          {showAll && <div className="shared-directory-recovery">
            <button type="button" onClick={event => {
            if (document.activeElement === event.currentTarget) {
              const target = allCategory.current;
              target?.focus({ preventScroll: true });
              // All is first in both LTR locales. Reveal it within this strip
              // without scrolling the document or a containing task surface.
              const strip = target?.closest<HTMLElement>(".shared-directory-filters");
              if (strip) strip.scrollLeft = 0;
            }
              setCategory("all"); setLimit(48);
            }}>{t(tokens.length ? (allCount === 1 ? "shellShowOneMatch" : "shellShowAllMatches")
              : allCount === 1 ? "shellShowOneDestination" : "shellShowAllDestinations").replace("{count}", formatCount(allCount))}</button>
          </div>}
          {!matches.length ? (
            <div className="shared-directory-empty">
              <h3>{t(showAll ? "shellNoPagesInCategory" : "shellNoPages")}</h3>
              <p>{t(showAll ? "shellNoPagesInCategoryHint" : "shellNoPagesHint")}</p>
              <button type="button" onClick={openCompanies}>
                {t("shellSearchCompanies")}
              </button>
            </div>
          ) : (
            <div className="shared-directory-grid">
              {matches.slice(0, limit).map(entry => (
                <Link key={entry.href} href={entry.href} prefetch={false}
                  onNavigate={() => { selected.current = true; onClose(); }}
                  className="shared-directory-link">
                  <span className="shared-directory-link-icon" aria-hidden="true">
                    {entry.kind === "native" ? "↗" : "◫"}
                  </span>
                  <span><strong>{entryTitle(entry)}</strong><small>{t("shellSection_" + section(entry))}</small></span>
                  <span className="shared-directory-arrow" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          )}
          {limit < matches.length && <button className="shared-directory-more" type="button"
            onClick={event => {
              if (limit + 48 >= matches.length && document.activeElement === event.currentTarget) {
                revealFocus.current = { button: event.currentTarget, index: limit };
              }
              setLimit(value => value + 48);
            }}>{t("shellShowMore")}</button>}
        </div>
        <footer className="shared-directory-footer">
          <span id="shared-directory-status" role="status" aria-live="polite" aria-atomic="true">
            {t(countKey).replace("{count}", formatCount(matches.length))}
            {limit < matches.length && <span className="shared-directory-progress">{t("shellResultsShown").replace("{shown}", formatCount(limit)).replace("{count}", formatCount(matches.length))}</span>}
          </span>
          <button type="button" onClick={openCompanies}>
            {t("shellSearchCompanies")} <span aria-hidden="true">↗</span>
          </button>
        </footer>
      </div>
    </dialog>
  );
}

