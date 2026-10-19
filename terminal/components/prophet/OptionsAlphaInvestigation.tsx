"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import type { OptionsAlphaMeasuredEvent, OptionsAlphaMeasuredFeed } from "./optionsAlphaMeasuredEvidence";
import styles from "./OptionsAlphaInvestigation.module.css";

type OwnedList = { id: string; name: string; symbols: string[] };
type Snapshot = { event: OptionsAlphaMeasuredEvent; sourceAt: string | null; stale: boolean };
const PAGE_SIZE = 6;

function copy(lang: Lang) {
  return lang === "zh" ? {
    filter: "筛选实测活动", placeholder: "股票、合约或事件编号", inspect: "查看", event: "事件",
    empty: "没有匹配的实测事件。", noEvents: "当前载入的来源快照没有可显示的实测事件。", showing: "已载入的事件", more: "显示更多事件", detail: "事件调查",
    chart: "打开标的图表", chartNote: "图表展示标的市场价格，不是期权成交或建议入场价。",
    close: "关闭调查", summary: "观察到了什么", coverage: "报价覆盖", prints: "有效报价成交",
    premium: "覆盖权利金 / 来源权利金", ask: "成交于卖价", bid: "成交于买价", spread: "价差中位数",
    observed: "来源观察时间", decision: "来源决策时间", available: "来源可用时间", snapshot: "来源快照时间",
    identity: "来源事件编号", boundary: "并非交易建议", boundaryBody: "成交位置不代表买方身份、开平仓或组合意图。这是调查证据，不是候选信号、入场价或期权收益。",
    frozen: "打开时保留的来源快照；后续刷新不会改写此观察。", stale: "来源已陈旧或刷新不可用；请勿将此快照视为当前报价。",
    saveTo: "将标的保存至", add: "加入标的自选股", already: "已在此自选股列表", saving: "保存中…",
    saved: "已保存至", uncertain: "保存未获确认。请核对自选股；不会自动重复提交。", check: "核对自选股",
    login: "登录后保存", listsLoading: "正在读取自选股…", listsFailed: "暂时无法读取自选股。", retry: "重试读取",
    noLists: "尚无可写入的自选股列表。", manage: "打开自选股", watchNote: "仅保存标的股票；不会创建信号、交易、提醒或组合持仓。",
    quoteSummary: "笔成交拥有有效报价。覆盖率与样本量同时展示；成交于卖价不等于看涨。", missing: "未提供",
  } : {
    filter: "Filter measured activity", placeholder: "Ticker, contract or event ID", inspect: "Inspect", event: "event",
    empty: "No measured events match.", noEvents: "No displayable measured events in the loaded source snapshot.", showing: "loaded source events", more: "Show more events", detail: "Event investigation",
    chart: "Open underlying chart", chartNote: "The chart shows underlying market prices, not an option fill or a recommended entry.",
    close: "Close investigation", summary: "What was observed", coverage: "Quote coverage", prints: "Quote-valid prints",
    premium: "Covered / source premium", ask: "At ask", bid: "At bid", spread: "Median spread",
    observed: "Source observed", decision: "Source decision", available: "Source available", snapshot: "Source snapshot",
    identity: "Source event ID", boundary: "Not a trade recommendation", boundaryBody: "Execution location is not buyer identity, opening/closing activity or package intent. This is evidence to investigate, not a candidate signal, entry price or option return.",
    frozen: "Source snapshot retained when opened; subsequent refreshes do not rewrite this observation.", stale: "Source is stale or refresh is unavailable; this snapshot is not a current quote.",
    saveTo: "Save underlying to", add: "Add underlying to watchlist", already: "Already on this watchlist", saving: "Saving…",
    saved: "Saved to", uncertain: "Save not confirmed. Check the watchlist; this request will not be repeated automatically.", check: "Check watchlist",
    login: "Sign in to save", listsLoading: "Loading your watchlists…", listsFailed: "Watchlists are unavailable.", retry: "Retry read",
    noLists: "No writable watchlist exists yet.", manage: "Open watchlists", watchNote: "Saves the underlying only. No signal, trade, alert or portfolio position is created.",
    quoteSummary: "prints had a valid quote. Coverage and sample size stay visible; execution at the ask does not establish a bullish trade.", missing: "Not supplied",
  };
}

const percent = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const money = (value: number | null) => value == null ? "—" : `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

async function readOwnedLists(): Promise<{ kind: "ready"; lists: OwnedList[] } | { kind: "signed-out" }> {
  const response = await fetch("/api/watchlist", { cache: "no-store", credentials: "same-origin" });
  if (response.status === 401) return { kind: "signed-out" };
  if (!response.ok) throw new Error("watchlist read unavailable");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !Array.isArray((body as { lists?: unknown }).lists)) {
    throw new Error("invalid watchlist inventory");
  }
  const raw = (body as { lists: unknown[] }).lists;
  const lists: OwnedList[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (!value || typeof value !== "object") throw new Error("invalid owned list");
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || typeof row.name !== "string" || !row.name || !Array.isArray(row.symbols) || seen.has(row.id)) {
      throw new Error("invalid owned list");
    }
    const symbols = row.symbols.map(item => {
      if (!item || typeof item !== "object" || typeof (item as { symbol?: unknown }).symbol !== "string") {
        throw new Error("invalid watchlist symbol");
      }
      return (item as { symbol: string }).symbol.toUpperCase();
    });
    lists.push({ id: row.id, name: row.name, symbols });
    seen.add(row.id);
  }
  // sharedWithMe is intentionally excluded: the server's lists field alone owns writes.
  return { kind: "ready", lists };
}

function SaveUnderlying({ symbol, lang }: { symbol: string; lang: Lang }) {
  const c = copy(lang);
  const [lists, setLists] = useState<OwnedList[]>([]);
  const [listId, setListId] = useState("");
  const [inventory, setInventory] = useState<"loading" | "ready" | "signed-out" | "unavailable">("loading");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "uncertain">("idle");
  const mounted = useRef(false);
  const busy = useRef(false);
  // Reject stale inventory responses after a newer read, selection, or verified write.
  const readVersion = useRef(0);
  const selected = lists.find(list => list.id === listId);
  const present = selected?.symbols.includes(symbol) ?? false;

  const load = useCallback(async () => {
    const version = ++readVersion.current;
    try {
      const result = await readOwnedLists();
      if (!mounted.current || version !== readVersion.current) return;
      setInventory(result.kind);
      if (result.kind === "ready") {
        setLists(result.lists);
        setListId(previous => result.lists.some(list => list.id === previous) ? previous : result.lists[0]?.id ?? "");
      }
    } catch {
      if (mounted.current && version === readVersion.current) setInventory("unavailable");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Initialize the external watchlist inventory; state updates follow its async response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => { mounted.current = false; readVersion.current += 1; };
  }, [load]);

  const reconcile = async (targetId: string) => {
    const version = ++readVersion.current;
    try {
      const result = await readOwnedLists();
      if (!mounted.current || version !== readVersion.current) return;
      setInventory(result.kind);
      if (result.kind === "ready") {
        setLists(result.lists);
        const exists = result.lists.find(list => list.id === targetId)?.symbols.includes(symbol);
        setSave(exists ? "saved" : "uncertain");
      } else setSave("uncertain");
    } catch {
      if (mounted.current && version === readVersion.current) setSave("uncertain");
    }
  };

  const add = async () => {
    if (busy.current || !selected || present || save === "uncertain") return;
    const targetId = selected.id;
    busy.current = true;
    setSave("saving");
    try {
      // A user click is the write. Never perform this POST from an effect or retry loop.
      await fetch("/api/watchlist", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", symbol, listId: targetId, section: "" }),
      });
    } catch {
      // A lost response may still have committed. Read the same owner; never repeat the write.
    }
    await reconcile(targetId);
    busy.current = false;
  };

  return (
    <section className={styles.saveArea}>
      <h3>{c.saveTo}</h3>
      {inventory === "loading" && <p>{c.listsLoading}</p>}
      {inventory === "signed-out" && <a className={styles.primary} href="/login">{c.login}</a>}
      {inventory === "unavailable" && <p>{c.listsFailed} <button className={styles.action} onClick={() => void load()}>{c.retry}</button></p>}
      {inventory === "ready" && lists.length === 0 && <p>{c.noLists} <a href="/terminal">{c.manage}</a></p>}
      {inventory === "ready" && lists.length > 0 && (
        <div className={styles.saveControls}>
          <select aria-label={c.saveTo} value={listId} disabled={save === "saving"} onChange={e => { readVersion.current += 1; setListId(e.target.value); setSave("idle"); }}>
            {lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
          {save === "uncertain"
            ? <button className={styles.action} onClick={() => void reconcile(listId)}>{c.check}</button>
            : <button className={styles.primary} disabled={!selected || present || save === "saving"} onClick={() => void add()}>
                {save === "saving" ? c.saving : present ? c.already : c.add}
              </button>}
        </div>
      )}
      <p role="status" aria-live="polite" className={styles.saveStatus}>
        {save === "saved" && selected ? `${c.saved} ${selected.name}` : save === "uncertain" ? c.uncertain : ""}
      </p>
      <p className={styles.caption}>{c.watchNote}</p>
    </section>
  );
}

function EventDetail({ snapshot, sourceUnavailable, lang, onClose }: {
  snapshot: Snapshot; sourceUnavailable: boolean; lang: Lang; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const c = copy(lang);
  const { event } = snapshot;
  const m = event.microstructure;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const clocks = [[c.observed, event.observed_at], [c.decision, event.decision_at], [c.available, event.available_at], [c.snapshot, snapshot.sourceAt]];
  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-label={`${event.root} · ${c.detail}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.dialogBody}>
        <header className={styles.detailHeader}>
          <div><span className={styles.eyebrow}>{c.detail}</span><h2>{event.root} <small>{event.right} {event.strike} · {event.expiration}</small></h2></div>
          <button className={styles.close} aria-label={c.close} onClick={onClose}>×</button>
        </header>
        <p className={styles.caption}>{c.frozen}</p>
        {(snapshot.stale || sourceUnavailable) && <p className={styles.notice}>{c.stale}</p>}
        <section className={styles.observation}>
          <h3>{c.summary}</h3>
          <p><strong>{m.nbbo_valid_print_count}/{m.source_print_count}</strong> {c.quoteSummary}</p>
          <dl className={styles.metrics}>
            <div><dt>{c.coverage}</dt><dd>{percent(m.nbbo_premium_coverage)}</dd></div>
            <div><dt>{c.premium}</dt><dd>{money(m.nbbo_covered_premium_usd)} / {money(m.source_premium_usd)}</dd></div>
            <div><dt>{c.ask}</dt><dd>{percent(m.at_ask_share)}</dd></div>
            <div><dt>{c.bid}</dt><dd>{percent(m.at_bid_share)}</dd></div>
            <div><dt>{c.spread}</dt><dd>{money(m.spread_median_usd)}</dd></div>
          </dl>
        </section>
        <div className={styles.chartAction}>
          <a className={styles.primary} href={`/terminal?symbol=${encodeURIComponent(event.root)}`} target="_blank" rel="noopener noreferrer">{c.chart} ↗</a>
          <p className={styles.caption}>{c.chartNote}</p>
        </div>
        <SaveUnderlying symbol={event.root} lang={lang} />
        <details className={styles.sourceDetail}>
          <summary>{c.identity} · {event.id}</summary>
          <dl>{clocks.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ? <time dateTime={value}>{value}</time> : c.missing}</dd></div>)}</dl>
        </details>
        <footer className={styles.boundary}><b>{c.boundary}</b><p>{c.boundaryBody}</p></footer>
      </div>
    </dialog>
  );
}

export function OptionsAlphaInvestigation({ feed, failed, lang, renderEvent }: {
  feed: OptionsAlphaMeasuredFeed; failed: boolean; lang: Lang;
  renderEvent: (event: OptionsAlphaMeasuredEvent) => ReactNode;
}) {
  const c = copy(lang);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Snapshot | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleUpperCase();
    return feed.events.filter(event => `${event.root} ${event.right} ${event.strike} ${event.expiration} ${event.id}`.toLocaleUpperCase().includes(needle));
  }, [feed.events, query]);
  const visible = filtered.slice(0, limit);
  return (
    <div className={styles.workspace} data-testid="options-alpha-investigation">
      <div className={styles.toolbar}>
        <input type="search" aria-label={c.filter} placeholder={c.placeholder} value={query} onChange={e => { setQuery(e.target.value); setLimit(PAGE_SIZE); }} />
        <span>{visible.length} / {filtered.length} · {c.showing}</span>
      </div>
      <div className={styles.activityGrid}>
        {visible.map(event => (
          <div key={event.id} className={styles.activityRow} data-testid="options-alpha-activity-row">
            {renderEvent(event)}
            <button className={styles.inspect} aria-label={`${c.inspect} ${event.root} ${c.event}`} onClick={() => setSelected({ event, sourceAt: feed.source_asof, stale: feed.stale })}>
              {c.inspect} {event.root} <span aria-hidden="true">↗</span>
            </button>
          </div>
        ))}
      </div>
      {!filtered.length && <p className={styles.empty}>{query.trim() ? c.empty : c.noEvents}</p>}
      {visible.length < filtered.length && <button className={styles.action} onClick={() => setLimit(value => value + PAGE_SIZE)}>{c.more}</button>}
      {selected && <EventDetail key={selected.event.id} snapshot={selected} sourceUnavailable={failed || feed.stale} lang={lang} onClose={() => setSelected(null)} />}
    </div>
  );
}
