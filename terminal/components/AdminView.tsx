"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

type Ev = { id: number; created_at: string; symbol: string; query: string | null; source: string; user_id: string | null; anon_id: string | null; ip: string | null; ua: string | null };
type Stats = { total: number; today: number; visitors7d: number; topSymbols7d: { symbol: string; count: number }[]; perDay14d: { day: string; count: number }[]; partial?: boolean };

// visitor identity precedence mirrors the storage plane: user_id > anon_id > ip
const visitorId = (e: Ev) => e.user_id || e.anon_id || e.ip || "";

// ── The frozen state model ──────────────────────────────────────────────────────────────────────
// This console previously had ONE failure state: any non-OK response — 404, 500, a transient blip
// — set `denied`, which rendered "Admin access required." over the whole page and was never reset
// by any code path. A single 5xx bricked the console for the session, and because the denial
// replaced the entire body, the Refresh button that could have recovered it went with it.
//
// The log and the KPIs are now SEPARATE FACTS with separate states, because they are separate
// reads and either can fail alone:
//
//   authority : ok | denied | unavailable
//   events    : loading | data | empty | unavailable
//   stats     : loading | data | unavailable
//
// `denied` latches only on a 404 — a definitive answer from a reachable authority — and clears on
// the next successful response. Everything else is `unavailable`: retryable, and it never discards
// rows the user can still legitimately read.
type Feed = "loading" | "data" | "empty" | "unavailable";
type StatsState = "loading" | "data" | "unavailable";

export default function AdminView({ email, authorityUnavailable = false }: { email: string; authorityUnavailable?: boolean }) {
  const t = useT();
  const [events, setEvents] = useState<Ev[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [feed, setFeed] = useState<Feed>("loading");
  const [statsState, setStatsState] = useState<StatsState>("loading");
  const [denied, setDenied] = useState(false);
  // Rows are on screen but the most recent refresh did not land. They are still TRUE — they were
  // read successfully under this exact filter — so they stay, labelled.
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [symInput, setSymInput] = useState("");
  const [symbol, setSymbol] = useState(""); // committed (uppercased) symbol filter
  const [source, setSource] = useState("");
  const [visitor, setVisitor] = useState("");
  const [tick, setTick] = useState(0); // manual Refresh / Retry

  // Which filter the rows currently on screen were read under. Retaining last-good rows is only
  // honest while the filter is unchanged: rows fetched under "AAPL" must never sit beneath a
  // "NVDA" header just because the NVDA request failed.
  const filterKey = `${symbol}\u0000${source}\u0000${visitor}`;
  const rowsKeyRef = useRef<string | null>(null);
  const eventsRef = useRef<Ev[]>([]);
  eventsRef.current = events;

  const query = useCallback((before?: number | null) => {
    const p = new URLSearchParams({ limit: "100" });
    if (before != null) p.set("before", String(before));
    else p.set("stats", "1"); // stats only on first page — cursor pages skip the aggregate
    if (symbol) p.set("symbol", symbol);
    if (source) p.set("source", source);
    if (visitor) p.set("visitor", visitor);
    return fetch("/api/admin/searches?" + p.toString(), { cache: "no-store" });
  }, [symbol, source, visitor]);

  // commit symbol filter 400ms after typing stops (Enter commits immediately)
  useEffect(() => {
    const id = setTimeout(() => setSymbol(symInput.trim().toUpperCase()), 400);
    return () => clearTimeout(id);
  }, [symInput]);

  useEffect(() => {
    let alive = true;
    const key = filterKey;
    const sameFilter = rowsKeyRef.current === key;

    // A NEW filter clears immediately: the old filter's rows are not an answer to the new
    // question, so they must not survive even if the new request fails.
    if (!sameFilter) {
      setEvents([]);
      setNextBefore(null);
      setStale(false);
    }
    setFeed("loading");

    const fail = () => {
      if (!alive) return;
      // Same filter with rows already read: keep them and say the refresh failed. Anything else
      // has nothing truthful to show.
      if (sameFilter && eventsRef.current.length > 0) {
        setStale(true);
        setFeed("data");
      } else {
        setEvents([]);
        setNextBefore(null);
        setFeed("unavailable");
      }
      // Stats survive a feed failure when we already have them — they are global, not per-filter.
      setStatsState((s) => (s === "data" ? "data" : "unavailable"));
    };

    query().then(async (r) => {
      if (!alive) return;
      // 404 is the ONLY denial: a reachable authority checked and said no.
      if (r.status === 404) { setDenied(true); return; }
      // 503 (authority_unavailable / events_unavailable) and every other non-OK is an outage.
      if (!r.ok) { fail(); return; }
      const d = await r.json().catch(() => null);
      if (!alive) return;
      if (!d) { fail(); return; }

      // A successful authority result clears an earlier denial — an admin flag can be granted
      // mid-session, and a stale `denied` must not outlive it.
      setDenied(false);
      const rows: Ev[] = d.events || [];
      setEvents(rows);
      setNextBefore(d.nextBefore ?? null);
      setUserMap((m) => ({ ...m, ...(d.userMap || {}) }));
      rowsKeyRef.current = key;
      setStale(false);
      setFeed(rows.length ? "data" : "empty");

      if (d.stats) { setStats(d.stats); setStatsState("data"); }
      else if (d.statsUnavailable) setStatsState("unavailable");
    }).catch(() => { if (alive) fail(); });

    return () => { alive = false; };
  }, [query, tick, filterKey]);

  async function loadMore() {
    if (nextBefore == null || busy || feed === "loading") return;
    setBusy(true);
    try {
      const r = await query(nextBefore);
      if (r.status === 404) { setDenied(true); return; }
      // A failed page 2 must not destroy page 1. Keep the cursor so it can simply be retried.
      if (!r.ok) { setStale(true); return; }
      const d = await r.json();
      setEvents((ev) => [...ev, ...(d.events || [])]);
      setNextBefore(d.nextBefore ?? null);
      setUserMap((m) => ({ ...m, ...(d.userMap || {}) }));
      setStale(false);
    } catch {
      setStale(true);
    } finally {
      setBusy(false);
    }
  }

  const retry = () => setTick((x) => x + 1);

  const sources = useMemo(() => {
    const s = new Set(events.map((e) => e.source));
    if (source) s.add(source); // keep the active filter selectable when its page is empty
    return Array.from(s).sort();
  }, [events, source]);

  const top = (statsState === "data" && stats ? stats.topSymbols7d : []).slice(0, 10);
  const topMax = Math.max(1, ...top.map((x) => x.count));
  const vLabel = visitor ? userMap[visitor] ?? (visitor.length > 14 ? visitor.slice(0, 12) + "…" : visitor) : "";

  // A number only when the aggregate actually landed: "—" while loading, an explicit unavailable
  // marker otherwise. Never a confident `0` over an unread table.
  const kpi = (read: (s: Stats) => string | number) => {
    if (statsState === "data" && stats) return read(stats);
    if (statsState === "unavailable") {
      return (
        <span
          title={t("admStatsUnavailableHint", "The aggregate could not be read. The log below is unaffected.")}
          style={{ color: "var(--muted)" }}
        >{t("admUnavailableShort", "n/a")}</span>
      );
    }
    return "—";
  };

  const noticeStyle = { padding: "10px 15px", fontSize: 12.5, display: "flex", alignItems: "center", gap: 10, color: "var(--warn)" } as const;

  return (
    <main className="main2">
        {denied ? (
          <div className="pg">
            <div className="panel">
              <div style={{ padding: "26px 15px", color: "var(--muted)", fontSize: 13, display: "flex", alignItems: "center", gap: 12 }}>
                <span>{t("admDenied", "Admin access required.")}</span>
                {/* Without this the denial is unreachable-terminal: the old view replaced the whole
                    body including Refresh, so `denied` could be cleared by a later successful
                    authority result in code but never in practice — an admin flag granted
                    mid-session needed a manual reload to take effect. Re-checking is safe: the
                    server re-runs the gate and answers 404 again if nothing changed. */}
                <button className="btn btn-ghost" style={{ height: 28 }} onClick={retry}>{t("admCheckAgain", "Check again")}</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="adm-body">
            <div className="adm-side">
              <div className="grp">{t("admAnalytics", "Analytics")}</div>
              <button className="adm-tab on">{t("admSearchLog", "Search Log")}</button>
            </div>
            <div className="pg">
              <div className="pg-head"><h2>{t("admSearchLog", "Search Log")}</h2><span className="sub">{t("admSearchLogSub", "every committed ticker search, by visitor")}</span></div>

              {authorityUnavailable && (
                <div className="panel" style={{ marginBottom: 12 }}>
                  <div style={noticeStyle}>{t("admAuthorityUnavailable", "Couldn't verify admin access — this is an outage, not a denial.")}</div>
                </div>
              )}

              {statsState === "data" && stats?.partial && (
                <div className="panel" style={{ marginBottom: 12 }}>
                  {/* The aggregate fell back to the capped in-process path AND the window actually
                      hit the cap, so the oldest days are understated. Saying so is the whole point:
                      the truncated chart is otherwise indistinguishable from a real decline. */}
                  <div style={noticeStyle}>{t("admStatsPartial", "Approximate — more history than this view can count. Oldest days are understated.")}</div>
                </div>
              )}

              <div className="kpis">
                <div className="kpi"><small>{t("admTotalSearches", "Total searches")}</small><b>{kpi((s) => s.total)}</b></div>
                <div className="kpi"><small>{t("admToday", "Today")}</small><b style={{ color: "var(--brand-2)" }}>{kpi((s) => s.today)}</b></div>
                <div className="kpi"><small>{t("admVisitors7d", "Visitors · 7d")}</small><b>{kpi((s) => s.visitors7d)}</b></div>
                <div className="kpi"><small>{t("admTopSymbol7d", "Top symbol · 7d")}</small><b style={{ color: "var(--signal)" }}>{kpi((s) => s.topSymbols7d?.[0]?.symbol ?? "—")}</b></div>
              </div>

              <div className="panel">
                <div className="ph">{t("admTopSymbols", "Top symbols — 7d")}</div>
                {statsState === "loading" && <div style={{ padding: "22px 15px", color: "var(--muted)", fontSize: 13 }}>{t("admLoading", "Loading…")}</div>}
                {statsState === "unavailable" && (
                  <div style={{ padding: "22px 15px", fontSize: 13, display: "flex", alignItems: "center", gap: 10, color: "var(--muted)" }}>
                    <span>{t("admStatsUnavailable", "Aggregates unavailable — the log below is unaffected.")}</span>
                    <button className="btn btn-ghost" style={{ height: 28 }} onClick={retry}>{t("admRetry", "Retry")}</button>
                  </div>
                )}
                {statsState === "data" && top.length === 0 && <div style={{ padding: "22px 15px", color: "var(--muted)", fontSize: 13 }}>{t("admNoData", "No data yet.")}</div>}
                {top.map((x, i) => (
                  <div key={x.symbol} className="adm-top-row">
                    <span style={{ color: "var(--muted)" }}>{i + 1}</span>
                    <span style={{ fontWeight: 600 }}>{x.symbol}</span>
                    <span className="num" style={{ color: "var(--text-2)" }}>{x.count}</span>
                    <span className="bar"><i style={{ width: `${(x.count / topMax) * 100}%` }} /></span>
                  </div>
                ))}
              </div>

              <div className="panel">
                <div className="ph">{t("admLog", "Log")}<span className="sub">{events.length} {t("admLoaded", "loaded")} · {statsState === "data" && stats ? stats.total : "?"} {t("admTotal", "total")}</span></div>

                {stale && (
                  <div style={noticeStyle}>
                    <span>{t("admStale", "Refresh failed — showing the last rows that loaded successfully.")}</span>
                    <button className="btn btn-ghost" style={{ height: 28, marginLeft: "auto" }} onClick={retry}>{t("admRetry", "Retry")}</button>
                  </div>
                )}

                <div className="scr-filters adm-filters">
                  <input
                    aria-label={t("admSymbol", "Symbol")}
                    placeholder={t("admFilterSymbol", "Symbol…")}
                    value={symInput}
                    onChange={(e) => setSymInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") setSymbol(symInput.trim().toUpperCase()); }}
                    style={{ width: 120 }}
                  />
                  <select aria-label={t("admSource", "Source")} value={source} onChange={(e) => setSource(e.target.value)}>
                    <option value="">{t("admAllSources", "all sources")}</option>
                    {sources.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {visitor && (
                    <button className="chip on" title={visitor} onClick={() => setVisitor("")}>
                      {t("admVisitor", "visitor")} <span className="v">{vLabel}</span> ✕
                    </button>
                  )}
                  <button className="btn btn-ghost" style={{ height: 34, marginLeft: "auto" }} onClick={retry}>{t("admRefresh", "Refresh")}</button>
                </div>
                {/* The explicit roles are load-bearing, not decoration: below 1120px the stylesheet
                    re-lays these rows out as records (`display:block/flex`), and a browser derives
                    a table's a11y semantics from its `display`. Without them the log would read to
                    a screen reader as an undifferentiated stack of text on exactly the viewports
                    where the columns are gone. `data-col` gives those rules a name to key on. */}
                <table className="ptable adm-log" role="table">
                  <colgroup>
                    <col className="c-time" /><col className="c-sym" /><col /><col className="c-src" /><col className="c-vis" /><col className="c-ip" />
                  </colgroup>
                  <thead role="rowgroup"><tr role="row">
                    <th role="columnheader">{t("admColTime", "Time")}</th><th role="columnheader">{t("admColSymbol", "Symbol")}</th><th role="columnheader">{t("admColQuery", "Query")}</th>
                    <th role="columnheader">{t("admColSource", "Source")}</th><th role="columnheader">{t("admColVisitor", "Visitor")}</th><th role="columnheader">{t("admColIp", "IP")}</th>
                  </tr></thead>
                  <tbody role="rowgroup">
                    {feed === "loading" && events.length === 0 && (
                      <tr className="empty-row" role="row"><td role="cell" colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: "44px 16px", fontSize: 13 }}>{t("admLoading", "Loading…")}</td></tr>
                    )}
                    {feed === "empty" && (
                      <tr className="empty-row" role="row"><td role="cell" colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: "44px 16px", fontSize: 13 }}>{t("admNoSearches", "No searches logged yet.")}</td></tr>
                    )}
                    {feed === "unavailable" && (
                      <tr className="empty-row" role="row"><td role="cell" colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: "44px 16px", fontSize: 13 }}>
                        <div style={{ marginBottom: 10 }}>{t("admEventsUnavailable", "The search log could not be read. This is an outage, not an empty log.")}</div>
                        <button className="btn btn-ghost" style={{ height: 30 }} onClick={retry}>{t("admRetry", "Retry")}</button>
                      </td></tr>
                    )}
                    {events.map((e) => {
                      const vid = visitorId(e);
                      const label = e.user_id ? userMap[e.user_id] ?? "user:" + e.user_id.slice(0, 8) : e.anon_id ? "anon:" + e.anon_id.slice(0, 8) : e.ip ?? "—";
                      return (
                        <tr key={e.id} role="row">
                          <td role="cell" data-col="time"><span className="num" style={{ fontFamily: "var(--font-num)", fontSize: 12, color: "var(--text-2)" }}>{new Date(e.created_at).toLocaleString()}</span></td>
                          <td role="cell" data-col="sym" style={{ fontWeight: 600 }}>{e.symbol}</td>
                          {/* Query is the only column that ellipsises on the desktop table (it takes
                              whatever the sized columns leave), so the full text stays reachable. */}
                          <td role="cell" data-col="query" title={e.query ?? undefined} style={{ color: "var(--text-2)", fontStyle: "italic" }}>{e.query ?? "—"}</td>
                          <td role="cell" data-col="src"><span className="pill" style={{ color: "var(--text-2)", background: "var(--panel-2)" }}>{e.source}</span></td>
                          <td role="cell" data-col="vis">
                            {vid
                              ? <span title={vid} style={{ color: "var(--brand-2)", cursor: "pointer" }} onClick={() => setVisitor(vid)}>{label}</span>
                              : <span style={{ color: "var(--muted)" }}>—</span>}
                          </td>
                          <td role="cell" data-col="ip"><span className="num" style={{ fontFamily: "var(--font-num)", fontSize: 12, color: "var(--muted)" }}>{e.ip ?? "—"}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {nextBefore != null && (
                  <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
                    <button className="btn btn-ghost" style={{ height: 34 }} onClick={loadMore} disabled={busy}>{busy ? t("admLoading", "Loading…") : t("admLoadMore", "Load more")}</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
  );
}
