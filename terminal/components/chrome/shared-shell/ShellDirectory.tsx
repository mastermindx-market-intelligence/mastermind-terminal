"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { inheritWorkspaceMarketHref, workspaceMarket } from "@/lib/sharedShellMarket";
import { megaMenuSections, type MegaMenuGroup, type MegaMenuItem } from "@/lib/sharedShellMegaMenu";
import { acquireScrollLock } from "@/lib/scrollLock";

const phoneQuery = "(max-width: 860px)";
const onViewportChange = (callback: () => void) => {
  const view = window.matchMedia(phoneQuery);
  view.addEventListener("change", callback);
  return () => view.removeEventListener("change", callback);
};
const isPhone = () => window.matchMedia(phoneQuery).matches;
const trigger = "[data-tool-browser-trigger]";

export default function ShellMegaMenu({ mode, onClose }: { mode: "hover" | "browse"; onClose: () => void }) {
  const { lang } = useLang();
  const t = useSharedShellT();
  const phone = useSyncExternalStore(onViewportChange, isPhone, () => false);
  const [selected, setSelected] = useState(megaMenuSections[0].id);
  const [collapsed, setCollapsed] = useState(true);
  const shell = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<HTMLElement | null>(null);
  const path = usePathname();
  const query = useSearchParams().toString();
  const initialLocation = useRef(path + "?" + query);
  const market = workspaceMarket(path, query);
  const current = megaMenuSections.find(family => family.id === selected) ?? megaMenuSections[0];
  const dismiss = useCallback(() => {
    const opener = initialFocus.current;
    onClose();
    requestAnimationFrame(() => {
      // A trigger in a dismissed drawer may have been unmounted, or hidden by resize.
      if (opener?.isConnected && opener !== document.body && opener.getClientRects().length) {
        opener.focus({ preventScroll: true });
      } else {
        document.querySelector<HTMLElement>(isPhone() ? "[data-shell-menu-opener]" : trigger)?.focus({ preventScroll: true });
      }
    });
  }, [onClose]);

  useLayoutEffect(() => {
    // Hover does not move focus. A later click takes ownership from the
    // previously focused control and must return to the rail trigger.
    const active = document.activeElement;
    if (active instanceof HTMLElement && !shell.current?.contains(active)) initialFocus.current = active;
  }, [mode]);
  useLayoutEffect(() => {
    if (!phone || !sheet.current) return;
    const dialog = sheet.current;
    const release = acquireScrollLock();
    dialog.showModal();
    return () => { dialog.close(); release(); };
  }, [phone]);
  useLayoutEffect(() => {
    if (mode === "browse" || phone) (shell.current?.querySelector<HTMLButtonElement>('[data-family][aria-pressed="true"]')
      ?? shell.current?.querySelector<HTMLButtonElement>('[data-family]'))?.focus();
  }, [mode, phone]);
  useEffect(() => {
    if (initialLocation.current !== path + "?" + query) onClose();
  }, [path, query, onClose]);
  useEffect(() => {
    const within = (node: EventTarget | null) => node instanceof Element && (shell.current?.contains(node) || node.closest(trigger));
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing && !event.repeat) {
        event.preventDefault(); dismiss();
      }
    };
    const outside = (event: Event) => {
      if (!within(event.target) && event.target !== sheet.current) onClose();
    };
    let leaveTimer: ReturnType<typeof setTimeout>;
    const onMove = (event: PointerEvent) => {
      if (mode !== "hover" || phone || event.pointerType !== "mouse") return;
      clearTimeout(leaveTimer);
      if (!within(event.target) && !within(document.activeElement)) leaveTimer = setTimeout(onClose, 260);
    };
    const leaveWindow = () => {
      if (mode === "hover" && !within(document.activeElement)) onClose();
    };
    document.addEventListener("keydown", key);
    // The phone sheet is a native modal. It owns backdrop/cancel and
    // focus containment; native close() temporarily restores focus outside
    // during dialog lifecycle cleanup. Only the desktop flyout uses light dismiss.
    if (!phone) {
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("focusin", outside);
      document.addEventListener("pointerover", onMove);
      document.documentElement.addEventListener("pointerleave", leaveWindow);
    }
    return () => {
      clearTimeout(leaveTimer);
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("pointerover", onMove);
      document.documentElement.removeEventListener("pointerleave", leaveWindow);
    };
  }, [dismiss, mode, onClose, phone]);

  function choose(id: string) {
    setSelected(id);
    setCollapsed(false);
    if (content.current) content.current.scrollTop = 0;
  }
  function controlKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End", "ArrowRight"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowRight") {
      choose(megaMenuSections[index].id);
      requestAnimationFrame(() => content.current?.querySelector<HTMLElement>("a")?.focus());
      return;
    }
    const last = megaMenuSections.length - 1;
    let next = (index + (event.key === "ArrowDown" ? 1 : -1) + last + 1) % (last + 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    shell.current?.querySelectorAll<HTMLButtonElement>("[data-family]")[next]?.focus();
    if (!phone) choose(megaMenuSections[next].id);
  }
  function tool(item: MegaMenuItem) {
    const body = <>
      <span><strong>{item.title[lang]}</strong>{item.description && <small>{item.description[lang]}</small>}</span>
      {!item.native && <span className="mega-external" aria-hidden="true">↗</span>}
    </>;
    return item.native
      ? <Link key={item.href} href={inheritWorkspaceMarketHref(item.href, market)} prefetch={false} onNavigate={onClose}>{body}</Link>
      : <a key={item.href} href={item.href}>{body}</a>;
  }
  function group(group: MegaMenuGroup) {
    return <section className="mega-group" key={group.title.en}>
      <h3>{group.title[lang]}</h3><div className="mega-links">{group.items.map(tool)}</div>
    </section>;
  }
  const catalogue = <div id="mega-family-content" className="mega-content" ref={content} key={current.id}>
    <h2>{current.title[lang]}</h2>
    {current.groups.map(group)}
    {!!current.explore?.length && <section className="mega-group"><h3>{t("shellExploreTools")}</h3>
      <div className="mega-links">{current.explore.map(tool)}</div>
    </section>}
    {!!current.moreGroups?.length && <details className="mega-more">
      <summary>{t("shellMoreFamilyTools").replace("{family}", lang === "zh" ? current.title.zh : current.title.en.toLowerCase())}</summary>
      {current.moreGroups.map(group)}
    </details>}
  </div>;
  const body = <nav id="shared-shell-tools" className="shell-mega" ref={shell} aria-label={t("shellBrowseTools")}>
    <div className="mega-families">
      <header><strong>{t("shellBrowseTools")}</strong><button type="button" onClick={dismiss} aria-label={t("shellCloseMenu")}>×</button></header>
      {megaMenuSections.map((family, index) => {
        const active = current.id === family.id;
        return <div key={family.id}>
          <button type="button" data-family="" aria-pressed={phone ? undefined : active}
            aria-expanded={phone ? active && !collapsed : undefined} aria-controls={active && (!phone || !collapsed) ? "mega-family-content" : undefined}
            onPointerEnter={event => { if (!phone && event.pointerType === "mouse" && !content.current?.contains(document.activeElement)) choose(family.id); }}
            onKeyDown={event => controlKeys(event, index)}
            onClick={() => { if (phone && active && !collapsed) setCollapsed(true); else choose(family.id); }}>
            {family.title[lang]}<span aria-hidden="true">{phone ? active && !collapsed ? "−" : "+" : "›"}</span>
          </button>
          {phone && active && !collapsed && catalogue}
        </div>;
      })}
    </div>
    {!phone && catalogue}
  </nav>;
  return phone ? <dialog className="shell-mega-sheet" ref={sheet} aria-label={t("shellBrowseTools")}
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onClick={event => { if (event.target === sheet.current) dismiss(); }}>{body}</dialog> : body;
}
