"use client";

import { useDiscoverT } from "@/lib/discoverWorkspaceLex";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DISCOVER_COLUMNS, DEFAULT_DISCOVER_COLUMNS, MAX_DISCOVER_VIEWS, moveDiscoverColumn, type DiscoverColumn, type DiscoverView } from "@/lib/discoverWorkspace";
import styles from "./DiscoverWorkspace.module.css";

export function DiscoverIcon({ name }: { name: "columns" | "views" | "filter" | "grip" | "close" | "help" | "search" | "check" }) {
  const paths = { columns: "M4 4h16v16H4zM10 4v16M15 4v16", views: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z", filter: "M4 6h16M7 12h10M10 18h4", grip: "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01", close: "m6 6 12 12M18 6 6 18", help: "M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0", search: "M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0", check: "m5 12 4 4L19 6" };
  return <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden="true"><path d={paths[name]} /></svg>;
}

/** The platform dialog supplies focus trapping/top-layer behavior; the product supplies styling. */
export function DiscoverDialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const tPlain = useDiscoverT();
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null, dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} aria-labelledby={id} className={`${styles.dialog} ${wide ? styles.dialogWide : ""}`}
    onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <header className={styles.dialogHeader}><h2 id={id}>{title}</h2><button type="button" className={styles.iconButton} aria-label={tPlain("close")} onClick={onClose}><DiscoverIcon name="close" /></button></header>
    {children}
  </dialog>;
}

export function DiscoverColumnHeader({ id, label, sorted, direction, onSort, extraClass = "", children, disabled = false }: {
  id: string; label: string; sorted: boolean; direction: 1 | -1; onSort?: () => void; extraClass?: string; children?: ReactNode; disabled?: boolean;
}) {
  const drag = useSortable({ id, disabled: id === "sym" || disabled });
  const zh = typeof document !== "undefined" && document.documentElement.dataset.lang === "zh";
  return <th ref={drag.setNodeRef} className={`${styles.columnHeader} ${extraClass} ${sorted ? "sorted" : ""}`}
    style={{ transform: CSS.Transform.toString(drag.transform), transition: drag.transition, opacity: drag.isDragging ? .35 : undefined }}
    data-column={id} data-fund-col={id.startsWith("fund:") ? id.slice(5) : undefined} data-tech-col={id === "technical" ? "" : undefined}
    data-dragging={drag.isDragging || undefined} aria-sort={onSort ? sorted ? direction === -1 ? "descending" : "ascending" : "none" : undefined}>
    <div className={styles.headerContent}>
      {id !== "sym" && !disabled && <button type="button" ref={drag.setActivatorNodeRef} {...drag.attributes} {...drag.listeners}
        className={styles.dragHandle} aria-label={zh ? `移动${label}列` : `Move ${label} column`}><DiscoverIcon name="grip" /></button>}
      {onSort ? <button type="button" className={styles.sortButton} onClick={onSort}>{label}<span aria-hidden="true">{sorted ? direction === -1 ? " ↓" : " ↑" : ""}</span></button> : <span>{label}</span>}
      {children}
    </div>
  </th>;
}

export type ColumnLabels = Record<DiscoverColumn, string>;
const groups: [string, string, readonly DiscoverColumn[]][] = [
  ["Identity & signals", "标的与信号", ["sym", "verdict", "regimeBull", "vts", "technical", "gics"]],
  ["Prices & activity", "价格与交易", ["last", "chg", "overnight", "overnightChg", "dv", "vol", "mcap"]],
  ["52-week range", "52周区间", ["hi52", "lo52", "offHi", "offLo"]],
  ["Fundamentals", "基本面", ["fund:fund.pe_ttm", "fund:fund.gross_margin_fy", "fund:fund.net_margin_fy", "fund:fund.roe_fy", "fund:fund.revenue_growth_fy"]],
  ["Historical strategy", "历史策略", ["wr", "pf", "cagr"]],
  ["Positioning", "持仓结构", ["mscRank", "mscNetGex", "mscFlip"]],
];

export function DiscoverColumns({ columns, labels, onChange, onClose, zh }: { columns: DiscoverColumn[]; labels: ColumnLabels; onChange: (value: DiscoverColumn[]) => void; onClose: () => void; zh: boolean }) {
  const tPlain = useDiscoverT();
  const [query, setQuery] = useState("");
  return <DiscoverDialog title={tPlain("customize_columns")} onClose={onClose} wide>
    <div className={styles.columnsBody}>
      <section><h3>{tPlain("your_column_order")}</h3><p className={styles.hint}>{tPlain("drag_a_table_header_or_use_these")}</p>
        <ol className={styles.orderedColumns}>{columns.map((id, i) => <li key={id}>
          <span className={styles.orderNumber}>{i + 1}</span><span>{labels[id]}</span>
          {id === "sym" ? <small>{tPlain("pinned")}</small> : <div className={styles.moveActions}>
            <button type="button" disabled={i === 1} aria-label={zh ? `${labels[id]}左移` : `Move ${labels[id]} left`} onClick={() => onChange(moveDiscoverColumn(columns, id, columns[i - 1]))}>←</button>
            <button type="button" disabled={i === columns.length - 1} aria-label={zh ? `${labels[id]}右移` : `Move ${labels[id]} right`} onClick={() => onChange(moveDiscoverColumn(columns, id, columns[i + 1]))}>→</button>
            <button type="button" aria-label={zh ? `隐藏${labels[id]}` : `Hide ${labels[id]}`} onClick={() => onChange(columns.filter(c => c !== id))}>×</button>
          </div>}
        </li>)}</ol>
      </section>
      <section><h3>{tPlain("add_or_hide_columns")}</h3><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={tPlain("find_a_column")} aria-label={tPlain("find_a_column_2")} className={styles.menuSearch} />
        {groups.map(([en, cn, ids]) => {
          const matching = ids.filter(id => labels[id].toLocaleLowerCase().includes(query.toLocaleLowerCase()));
          return matching.length ? <fieldset key={en} className={styles.columnGroup}><legend>{zh ? cn : en}</legend>
            {matching.map(id => <label key={id} className={styles.columnChoice}><input type="checkbox" data-discover-column={id} checked={columns.includes(id)} disabled={id === "sym"}
              onChange={() => onChange(columns.includes(id) ? columns.filter(c => c !== id) : [...columns, id])} /><span>{labels[id]}</span></label>)}
          </fieldset> : null;
        })}
        {!DISCOVER_COLUMNS.some(id => labels[id].toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p className={styles.hint}>{tPlain("no_matching_columns")}</p>}
      </section>
    </div>
    <footer className={styles.dialogFooter}><button type="button" className={styles.textButton} onClick={() => onChange([...DEFAULT_DISCOVER_COLUMNS])}>{tPlain("reset_column_layout")}</button><button type="button" className={styles.primaryButton} onClick={onClose}>{tPlain("done")}</button></footer>
  </DiscoverDialog>;
}

export function DiscoverViews({ views, activeId, onSelect, onSave, onDelete, onTemplate, onClose, zh, canSave }: {
  views: DiscoverView[]; activeId: string; onSelect: (view: DiscoverView) => boolean; onSave: (name: string, id?: string) => boolean;
  onDelete: (id: string) => void; onTemplate: (type: "market" | "aligned" | "research" | "overnight") => boolean; onClose: () => void; zh: boolean; canSave: boolean;
}) {
  const tPlain = useDiscoverT();
  const [name, setName] = useState(""), [rename, setRename] = useState<string | null>(null), [remove, setRemove] = useState<string | null>(null), [error, setError] = useState(false);
  const [selectionError, setSelectionError] = useState(false), nameRef = useRef<HTMLInputElement>(null), errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (rename) nameRef.current?.focus(); }, [rename]);
  useEffect(() => { if (selectionError) errorRef.current?.focus(); }, [selectionError]);
  const templates = [["market", "Market overview", "市场概览", "Price, activity and signals", "价格、交易与信号"], ["aligned", "Buy signals + uptrend", "买入信号与上升趋势", "Recorded signals aligned with the trend reading", "已记录信号与趋势一致"], ["overnight", "Overnight watch", "夜盘观察", "Regular session alongside qualified overnight trades", "常规时段与合格夜盘成交"], ["research", "Historical performance", "历史表现", "Strategy results and their limitations", "策略历史结果及其局限"]] as const;
  return <DiscoverDialog title={tPlain("your_views")} onClose={onClose}>
    <div className={styles.viewsBody}>
      {selectionError && <p ref={errorRef} tabIndex={-1} role="alert" className={styles.hint}>{tPlain("could_not_open_this_view_resolve_the")}</p>}
      <h3>{tPlain("start_with_a_view")}</h3>
      {templates.map(([key, en, cn, detail, detailZh]) => <button type="button" key={key} className={styles.viewOption} onClick={() => { if (onTemplate(key)) onClose(); else setSelectionError(true); }}><span><strong>{zh ? cn : en}</strong><small>{zh ? detailZh : detail}</small></span><span aria-hidden="true">↗</span></button>)}
      <h3>{tPlain("saved_views")} <span className={styles.hint}>{views.length}/{MAX_DISCOVER_VIEWS}</span></h3>
      {!views.length && <p className={styles.hint}>{tPlain("save_your_filters_and_layout_as_your")}</p>}
      {views.map(v => <div key={v.id} className={styles.savedView}>
        <button type="button" className={styles.savedViewName} aria-current={v.id === activeId ? "true" : undefined} onClick={() => { if (onSelect(v)) onClose(); else setSelectionError(true); }}><span>{v.name}</span>{v.id === activeId && <DiscoverIcon name="check" />}</button>
        <button type="button" className={styles.textButton} disabled={!canSave} onClick={() => { setRename(v.id); setName(v.name); setError(false); nameRef.current?.focus(); }}>{tPlain("rename")}</button>
        <button type="button" className={styles.iconButton} disabled={!canSave} aria-label={zh ? `删除${v.name}` : `Delete ${v.name}`} onClick={() => setRemove(v.id)}>×</button>
        {remove === v.id && <div className={styles.deleteConfirm}><span>{tPlain("delete_this_view")}</span><button type="button" onClick={() => { onDelete(v.id); setRemove(null); }}>{tPlain("delete")}</button><button type="button" onClick={() => setRemove(null)}>{tPlain("cancel")}</button></div>}
      </div>)}
      <form className={styles.saveViewForm} onSubmit={e => { e.preventDefault(); const ok = onSave(name, rename ?? undefined); setError(!ok); if (ok) { setName(""); setRename(null); } }}>
        <label htmlFor="discover-view-name">{rename ? tPlain("rename_view") : tPlain("save_current_as_a_view")}</label>
        <div><input ref={nameRef} id="discover-view-name" value={name} maxLength={40} onChange={e => { setName(e.target.value); setError(false); }} placeholder={tPlain("e_g_technology_watch")} className={styles.menuSearch} />
          <button type="submit" className={styles.primaryButton} disabled={!canSave || !name.trim() || !rename && views.length >= MAX_DISCOVER_VIEWS}>{tPlain("save_view")}</button></div>
        {rename && <button type="button" className={styles.textButton} onClick={() => { setRename(null); setName(""); }}>{tPlain("cancel_rename")}</button>}
        {error && <p role="alert" className={styles.hint}>{tPlain("view_not_saved_check_its_name_and")}</p>}
      </form>
    </div>
  </DiscoverDialog>;
}
