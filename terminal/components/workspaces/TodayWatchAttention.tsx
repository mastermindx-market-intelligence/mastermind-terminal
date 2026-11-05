"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import MonitorEventAttention from "@/components/workspaces/MonitorEventAttention";
import { readingJson } from "@/lib/shared-shell/useReadingScope";
import styles from "@/components/workspaces/ReadingWorkspace.module.css";
import today from "./TodayWorkspace.module.css";

type Selection = { listId: string; symbol: string };
type Props = { ownerKey: string; scope: { current: AbortController | null }; onUnauthenticated: () => void };
type SymbolMember = { symbol: string; section: string; position: number };
type ServerWatchlist = { id: string; name: string; position: number; symbols: SymbolMember[] };
type BriefRow = { listId: string; listName: string; symbol: string };
type Phase = "loading" | "ready" | "unavailable" | "restricted" | "ended";

/** At most three saved symbols are briefed here; everything else stays on Monitor. */
const MAX_ROWS = 3;
const WATCHLIST_URL = "/api/watchlist";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSymbolMember(
  value: unknown,
): { symbol: string; section: string; position: number } | null {
  if (!isRecord(value)) return null;
  const symbol = value.symbol;
  const section = value.section;
  const position = value.position;
  if (typeof symbol !== "string" || symbol.length === 0) return null;
  if (typeof section !== "string") return null;
  if (typeof position !== "number" || !Number.isFinite(position)) return null;
  return { symbol, section, position };
}

function parseWatchlistRow(value: unknown): ServerWatchlist | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const name = value.name;
  const position = value.position;
  const symbols = value.symbols;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof name !== "string") return null;
  if (typeof position !== "number" || !Number.isFinite(position)) return null;
  if (!Array.isArray(symbols)) return null;
  const members: { symbol: string; section: string; position: number }[] = [];
  for (const entry of symbols) {
    const member = parseSymbolMember(entry);
    if (!member) return null;
    members.push(member);
  }
  return { id, name, position, symbols: members };
}

function parseWatchlistPayload(payload: unknown): ServerWatchlist[] | null {
  if (!isRecord(payload)) return null;
  if (!Array.isArray(payload.lists)) return null;
  const lists: ServerWatchlist[] = [];
  for (const row of payload.lists) {
    const parsed = parseWatchlistRow(row);
    if (!parsed) return null;
    lists.push(parsed);
  }
  return lists;
}

const COPY = {
  en: {
    eyebrow: "Saved attention",
    title: "Needs your attention",
    hint: "Choose a saved symbol to inspect its retained event sources.",
    loading: "Reading your saved watchlists…",
    refreshing: "Refreshing saved watchlists…",
    check: "Check event evidence",
    refresh: "Refresh lists",
    all: "Open Monitor",
    more: (count: number) => `${count} more saved entr${count === 1 ? "y" : "ies"} on Monitor.`,
    emptyLists: "No saved watchlists yet.",
    emptyMembers: "Your saved watchlists have no symbols yet.",
    unavailable: "Saved watchlists could not be read. Your other Today sections remain separate.",
    retry: "Check again",
    restricted: "Current access does not permit reading these watchlists.",
  },
  zh: {
    eyebrow: "已保存关注",
    title: "关注事项",
    hint: "选择已保存代码，查看其已保留事件来源。",
    loading: "正在读取已保存关注列表…",
    refreshing: "正在刷新已保存关注列表…",
    check: "核对事件证据",
    refresh: "刷新列表",
    all: "打开监控",
    more: (count: number) => `其余 ${count} 条已保存记录见关注页。`,
    emptyLists: "还没有已保存的关注列表。",
    emptyMembers: "已保存关注列表还没有代码。",
    unavailable: "无法读取已保存关注列表；今日的其他板块仍独立显示。",
    retry: "重新检查",
    restricted: "当前权限不允许读取这些关注列表。",
  },
};

export default function TodayWatchAttention(props: Props) {
  // The ownerKey key destroys the complete inventory, selection and child read on
  // every subject departure, including A→B→A: nothing survives a lifetime.
  return <TodayWatchAttentionSession key={props.ownerKey} {...props} />;
}

function TodayWatchAttentionSession({ ownerKey, scope, onUnauthenticated }: Props) {
  const { lang } = useLang();
  const c = COPY[lang];
  const [lists, setLists] = useState<ServerWatchlist[] | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const onUnauthenticatedRef = useRef(onUnauthenticated);
  useEffect(() => { onUnauthenticatedRef.current = onUnauthenticated; });

  useEffect(() => {
    const controller = scope.current;
    if (!controller || controller.signal.aborted) return;
    const read = ++generation.current;
    let alive = true;
    // Every read starts without an event target: the child only ever reads on an
    // explicit click against freshly read membership, never a remembered one.
    const hide = () => {
      if (!alive) return;
      setPhase("ended"); setLists(null); setSelection(null);
    };
    controller.signal.addEventListener("abort", hide, { once: true });
    queueMicrotask(() => {
      if (!alive || controller.signal.aborted || scope.current !== controller) return;
      setSelection(null);
      void (async () => {
      try {
        const { response, value } = await readingJson(scope, WATCHLIST_URL);
        if (!alive || read !== generation.current || scope.current !== controller || controller.signal.aborted) return;
        if (response.status === 401) { setPhase("ended"); onUnauthenticatedRef.current(); return; }
        if (response.status === 403) { setPhase("restricted"); return; }
        const parsed = response.ok ? parseWatchlistPayload(value) : null;
        if (!parsed) { setPhase("unavailable"); return; }
        setLists(parsed);
        setPhase("ready");
      } catch {
        if (!alive || read !== generation.current || scope.current !== controller || controller.signal.aborted) return;
        setPhase("unavailable");
      } finally {
        if (alive && read === generation.current) setRefreshing(false);
      }
      })();
    });
    return () => { alive = false; controller.signal.removeEventListener("abort", hide); };
  }, [attempt, scope]);

  const refresh = () => { setRefreshing(true); setSelection(null); setAttempt(value => value + 1); };
  const retry = () => { setPhase("loading"); setSelection(null); setAttempt(value => value + 1); };

  if (phase === "ended") return null;

  const members: BriefRow[] = [];
  if (lists) for (const list of [...lists].sort((a, b) => a.position - b.position)) {
    for (const member of [...list.symbols].sort((a, b) => a.position - b.position)) {
      members.push({ listId: list.id, listName: list.name, symbol: member.symbol });
    }
  }
  const rows = members.slice(0, MAX_ROWS);
  const pending = phase === "loading" || refreshing;

  return <section data-today-attention-state={pending ? "loading" : phase} aria-label={c.title}>
    <div className={today.jobHeader}>
      <h2>{c.title}</h2>
      <Link href="/monitor">{c.all}<span aria-hidden="true">→</span></Link>
    </div>
    {pending && <p className={styles.notice} role="status">{refreshing ? c.refreshing : c.loading}</p>}
    {phase === "unavailable" && <div>
      <p className={styles.notice} role="status">{c.unavailable}</p>
      <div className={styles.actions}>
        <button type="button" onClick={retry}>{c.retry}</button>
      </div>
    </div>}
    {phase === "restricted" && <p className={styles.notice}>{c.restricted}</p>}
    {phase === "ready" && !refreshing && <>
      {rows.length === 0 ? <p className={styles.notice}>{lists !== null && lists.length === 0 ? c.emptyLists : c.emptyMembers}</p> : <>
        <ul className={today.watchList}>
          {rows.map(row => <li key={`${row.listId}|${row.symbol}`} className={today.watchRow}>
            <div className={today.watchIdentity}><strong>{row.symbol}</strong><p>{row.listName}</p></div>
            <button className={today.quietAction} type="button" onClick={() => setSelection({ listId: row.listId, symbol: row.symbol })}>{c.check}<span aria-hidden="true">→</span></button>
          </li>)}
        </ul>
        {members.length > rows.length && <p className={styles.coverage}>{c.more(members.length - rows.length)}</p>}
      </>}
      <div className={today.watchFooter}>
        <button className={today.quietAction} type="button" onClick={refresh}>{c.refresh}</button>
        {rows.length > 0 && !selection && <p>{c.hint}</p>}
      </div>
      {rows.length > 0 && selection && <MonitorEventAttention
        subjectId={ownerKey}
        selection={selection}
        lang={lang}
        onUnauthenticated={onUnauthenticated}
      />}
    </>}
  </section>;
}
