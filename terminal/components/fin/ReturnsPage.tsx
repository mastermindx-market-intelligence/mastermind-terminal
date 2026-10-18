"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { getJSONResult, invalidate } from "@/lib/dataCache";
import { groupRows, members as sourceMembers } from "@/lib/sectorIntelligence";
import { completedReturnSession, dailyMoves, decodeReturnSeries, finite, isoDay, record, returnPath, returnSessions, trajectory, validSymbol, RETURNS_HORIZONS,
  type BasketResult, type ReturnSeries, type ReturnsHorizon } from "@/lib/returnsIntelligence";
import ReturnPathChart, { type ReturnChartView } from "./returns/ReturnPathChart";
import SessionCalendar from "./returns/SessionCalendar";
import ReturnsEvidencePanel from "./returns/ReturnsEvidencePanel";
import { dateLabel, pct, returnsT, tone, type ReturnsKey } from "./returns/returnsCopy";
import styles from "./returns/ReturnsWorkspace.module.css";

type PriceRead = { key: string; status: "loading" | "ready" | "absent" | "unavailable" | "invalid" | "unsupported"; series: ReturnSeries | null; benchmark: ReturnSeries | null; benchmarkFailed: boolean };
type Group = { key: string; name: string; symbols: string[]; asOf: string };
type BasketRequest = { symbols: string[]; name: string; asOf: string };
const RANGES = [21, 63, 126, 252] as const;

function basketWire(input: unknown, request: BasketRequest): BasketResult | null {
  const o = record(input), s = record(o.series), composite = record(s.composite);
  if (o.status === "incomplete" && typeof o.reason === "string" && Array.isArray(o.missing) && o.missing.every(v => typeof v === "string")) return o as unknown as BasketResult;
  if (o.status !== "ready" || s.symbol !== "BASKET" || !Array.isArray(s.bars) || s.bars.length < 2 || s.bars.length > 253
    || !["qualified", "unverified"].includes(String(s.quality)) || !["adjusted_view", "reported_price"].includes(String(s.basis))
    || !s.bars.every(b => isoDay(record(b).date) && finite(record(b).close) && Number(record(b).close) > 0)
    || !Array.isArray(s.issues) || !s.issues.every(v => typeof v === "string") || !Array.isArray(s.breaks) || s.breaks.length !== 0
    || !isoDay(s.asOf) || !isoDay(o.commonStart) || !isoDay(o.commonEnd) || s.asOf !== o.commonEnd
    || composite.history !== "current_members_reconstructed" || composite.weighting !== "daily_rebalanced_equal_weight" || composite.membershipAsOf !== request.asOf
    || !Array.isArray(composite.members) || JSON.stringify(composite.members) !== JSON.stringify(request.symbols)
    || !finite(o.upShare) || o.upShare < 0 || o.upShare > 1 || !finite(o.medianReturnPct)
    || !Array.isArray(o.members) || o.members.length !== request.symbols.length || !o.members.every((m, i) => record(m).symbol === request.symbols[i] && finite(record(m).returnPct) && finite(record(m).relativePp))) return null;
  const days = s.bars.map(b => String(record(b).date));
  if (days.some((d, i) => i > 0 && d <= days[i - 1]) || days[0] !== o.commonStart || days.at(-1) !== o.commonEnd) return null;
  return input as BasketResult;
}

export default function ReturnsPage({ sym, zh }: { sym: string; zh: boolean }) {
  const t = returnsT(zh), identity = useShellIdentity();
  // Server-rendered controls stay disabled until their client handlers are attached.
  const [interactive, setInteractive] = useState(false);
  const [scope, setScope] = useState<"stock" | "basket">("stock"), [horizon, setHorizon] = useState<ReturnsHorizon>(21), [range, setRange] = useState<number>(126);
  const [benchmark, setBenchmark] = useState("SPY"), [view, setView] = useState<ReturnChartView>("performance"), [revision, setRevision] = useState(0);
  const [pinned, setPinned] = useState<string | null>(null), [chosenMonth, setChosenMonth] = useState<string | null>(null);
  const key = `${sym}|${benchmark}|${revision}`;
  const [received, setReceived] = useState<PriceRead>({ key: "", status: "loading", series: null, benchmark: null, benchmarkFailed: false });
  const priceRead: PriceRead = received.key === key ? received : { key, status: "loading", series: null, benchmark: null, benchmarkFailed: false };
  const [groupRead, setGroupRead] = useState<{ identity: typeof identity; status: "ready" | "unavailable"; groups: Group[] } | null>(null);
  const [groupChoice, setGroupChoice] = useState("custom"), [custom, setCustom] = useState(""), [basketInputError, setBasketInputError] = useState(false);
  const [basketRequest, setBasketRequest] = useState<BasketRequest | null>(null);
  const [basketRead, setBasketRead] = useState<{ identity: typeof identity; request: BasketRequest; horizon: ReturnsHorizon; result: BasketResult | null; state: "ready" | "error" | "access" } | null>(null);
  const groups = groupRead?.identity === identity ? groupRead.groups : [];
  const result = basketRead?.identity === identity && basketRead.request === basketRequest && basketRead.horizon === horizon ? basketRead : null;
  const basket = result?.result?.status === "ready" ? result.result : null;
  const series = scope === "stock" ? priceRead.series : basket?.series ?? null;

  useEffect(() => {
    setInteractive(true);
    const params = new URLSearchParams(window.location.search), h = Number(params.get("returnsHorizon")), r = Number(params.get("returnsRange")), b = params.get("returnsBenchmark");
    if (RETURNS_HORIZONS.includes(h as ReturnsHorizon)) setHorizon(h as ReturnsHorizon);
    if (RANGES.includes(r as typeof RANGES[number])) setRange(r);
    if (b === "SPY" || b === "QQQ" || b === "none") setBenchmark(b === "none" ? "" : b);
  }, []);
  const persist = (name: string, value: string) => { const url = new URL(window.location.href); url.searchParams.set(name, value); window.history.replaceState(window.history.state, "", url.toString()); };
  useEffect(() => {
    let alive = true;
    const blank = { key, series: null, benchmark: null, benchmarkFailed: false };
    if (!validSymbol(sym)) { setReceived({ ...blank, status: "unsupported" }); return; }
    const through = completedReturnSession();
    if (!through) { setReceived({ ...blank, status: "unavailable" }); return; }
    void Promise.all([getJSONResult(`/data/${encodeURIComponent(sym)}.json`, { swr: false }), benchmark ? getJSONResult(`/data/${benchmark}.json`, { swr: false }) : Promise.resolve(null)]).then(([a, b]) => {
      if (!alive) return;
      if (a.status !== "data") { setReceived({ ...blank, status: a.status === "absent" ? "absent" : "unavailable" }); return; }
      const parsed = decodeReturnSeries(sym, a.data, through), compare = b?.status === "data" ? decodeReturnSeries(benchmark, b.data, through) : null;
      setReceived({ key, status: parsed.bars.length ? "ready" : "invalid", series: parsed, benchmark: compare, benchmarkFailed: !!benchmark && (!compare?.bars.length || compare.quality === "refused") });
    }).catch(() => { if (alive) setReceived({ ...blank, status: "unavailable" }); });
    return () => { alive = false; };
  }, [sym, benchmark, key]);
  useEffect(() => {
    if (scope !== "basket") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/sector-intelligence?source=confluence", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const body = record(await res.json()), receipt = record(body.receipt), asOf = typeof receipt.asOf === "string" ? isoDay(receipt.asOf.slice(0, 10)) : null;
        if (!res.ok || receipt.source !== "confluence" || receipt.status !== "ready" || receipt.stale === true || !asOf) throw new Error("SOURCE_UNQUALIFIED");
        const rows = groupRows(body.data), parsed: Group[] = [];
        for (const row of rows) {
          const members = sourceMembers(row);
          if (typeof row.key !== "string" || typeof row.label !== "string" || !Array.isArray(row.members) || row.members.length !== members.length || members.length < 2 || members.length > 256 || !members.every(m => validSymbol(m.ticker))) continue;
          parsed.push({ key: row.key, name: row.label, symbols: members.map(m => m.ticker), asOf });
        }
        if (!controller.signal.aborted) setGroupRead({ identity, status: "ready", groups: parsed });
      } catch { if (!controller.signal.aborted) setGroupRead({ identity, status: "unavailable", groups: [] }); }
    })();
    return () => controller.abort();
  }, [scope, identity, revision]);
  useEffect(() => {
    if (!basketRequest || scope !== "basket") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/returns/basket", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: basketRequest.symbols, horizon, membershipAsOf: basketRequest.asOf }) });
        const body = await res.json(), parsed = res.ok ? basketWire(body, basketRequest) : null;
        if (!controller.signal.aborted) setBasketRead({ identity, request: basketRequest, horizon, result: parsed, state: res.status === 401 || res.status === 403 ? "access" : parsed ? "ready" : "error" });
      } catch { if (!controller.signal.aborted) setBasketRead({ identity, request: basketRequest, horizon, result: null, state: "error" }); }
    })();
    return () => controller.abort();
  }, [scope, basketRequest, horizon, identity, revision]);

  const readings = useMemo(() => series ? RETURNS_HORIZONS.map(h => trajectory(series, h)) : [], [series]);
  const reading = readings.find(r => r.horizon === horizon);
  const path = useMemo(() => series ? returnPath(series, priceRead.benchmark, range) : [], [series, priceRead.benchmark, range]);
  const moves = useMemo(() => series ? dailyMoves(series) : [], [series]);
  const selected = pinned && moves.some(m => m.date === pinned) ? pinned : series?.asOf ?? null;
  const month = chosenMonth && moves.some(m => m.date.startsWith(chosenMonth)) ? chosenMonth : selected?.slice(0, 7) ?? "2026-01";
  const selectDay = useCallback((day: string) => {
    if (series?.asOf && !path.some(point => point.date === day)) {
      const needed = (returnSessions(day, series.asOf)?.length ?? 1) - 1;
      if (needed > range) setRange(RANGES.find(value => value >= needed) ?? needed);
    }
    setPinned(day); setChosenMonth(day.slice(0, 7));
  }, [series, path, range]);
  const subject = scope === "stock" ? sym : basketRequest?.name ?? t("basket");
  const stale = series?.asOf !== completedReturnSession();
  const chooseGroup = (value: string) => { setGroupChoice(value); setBasketInputError(false); const group = groups.find(g => g.key === value); if (group) { setBasketRequest({ symbols: group.symbols, name: group.name, asOf: group.asOf }); setPinned(null); setChosenMonth(null); } else setBasketRequest(null); };
  const analyzeCustom = () => { const symbols = custom.toUpperCase().split(/[\s,;]+/).filter(Boolean); if (symbols.length < 2 || symbols.length > 256 || !symbols.every(validSymbol) || new Set(symbols).size !== symbols.length) { setBasketInputError(true); return; } setBasketInputError(false); setBasketRequest({ symbols, name: t("customBasket"), asOf: new Date().toISOString().slice(0, 10) }); setPinned(null); setChosenMonth(null); };
  const retry = () => { invalidate(`/data/${encodeURIComponent(sym)}.json`); if (benchmark) invalidate(`/data/${benchmark}.json`); setRevision(r => r + 1); };
  const statusKey: ReturnsKey = priceRead.status === "loading" ? "loading" : priceRead.status === "absent" ? "noHistory" : priceRead.status === "invalid" ? "invalidHistory" : priceRead.status === "unsupported" ? "unsupported" : "loadError";

  return <div className={styles.workspace} data-testid="returns-workspace">
    <header className={styles.workspaceHead}><div><h2>{t("title")}</h2><p>{t("subtitle")}</p></div><button className={styles.refresh} type="button" onClick={retry} aria-label={t("retry")} title={t("retry")}>↻</button></header>
    <div className={styles.toolbar}><div className={styles.segmented} aria-label={t("title")}>{(["stock", "basket"] as const).map(s => <button type="button" key={s} disabled={!interactive} aria-pressed={scope === s} onClick={() => { setScope(s); setPinned(null); setChosenMonth(null); }}>{t(s)}</button>)}</div><label className={styles.benchmark}>{t("benchmark")}<select aria-label={t("benchmark")} value={benchmark} onChange={e => { setBenchmark(e.target.value); persist("returnsBenchmark", e.target.value || "none"); }}><option value="SPY">SPY</option><option value="QQQ">QQQ</option><option value="">{t("none")}</option></select></label></div>
    {scope === "basket" && <section className={styles.basketBuilder}><div className={styles.basketControls}><label>{t("sourceGroup")}<select aria-label={t("sourceGroup")} value={groupChoice} onChange={e => chooseGroup(e.target.value)}><option value="custom">{t("customBasket")}</option><optgroup label={t("chooseGroup")}>{groups.map(g => <option key={g.key} value={g.key}>{g.name} · {g.symbols.length}</option>)}</optgroup></select></label>{groupChoice === "custom" && <form onSubmit={e => { e.preventDefault(); analyzeCustom(); }}><label className={styles.srOnly} htmlFor="returns-basket-symbols">{t("symbols")}</label><input id="returns-basket-symbols" value={custom} onChange={e => setCustom(e.target.value)} placeholder="NVDA, AMD, AVGO…" autoComplete="off" spellCheck={false} /><button type="submit" className={styles.primaryButton}>{t("analyzeBasket")}</button></form>}</div>{basketInputError && <p role="alert">{t("basketInvalid")}</p>}{groupRead?.identity === identity && groupRead.status === "unavailable" && <p>{t("groupUnavailable")}</p>}<div className={styles.basketDisclosure}><span>{t("currentMembers")}</span><span>{t("equalWeight")}</span></div></section>}
    {!series || !reading ? <div className={styles.empty} role="status"><span className={styles.emptyGlyph}>↗</span><h3>{scope === "stock" ? t(statusKey) : !basketRequest ? t("basketPrompt") : !result ? t("basketLoading") : result.state === "access" ? t("basketAccess") : t("basketIncomplete")}</h3>{result?.result?.status === "incomplete" && <p>{result.result.missing.join(", ") || result.result.reason.replaceAll("_", " ").toLowerCase()}</p>}{scope === "stock" && priceRead.status !== "loading" && <button type="button" onClick={retry}>{t("retry")}</button>}</div> : <>
      <div className={styles.sourceLine}><strong>{subject}</strong>{series.source === "fixture" && <span className={styles.qualityBadge}>{t("fixture")}</span>}<span>{series.basis === "adjusted_view" ? t("adjusted") : t("reported")}</span>{series.quality !== "qualified" && <span className={styles.qualityBadge}>{t(series.quality === "refused" ? "refused" : "unverified")}</span>}<time>{t("asOf")} {series.asOf}</time>{stale && <span className={styles.qualityBadge}>{t("historical")}</span>}</div>
      <div className={styles.horizons}>{readings.map(r => <button type="button" className={styles.horizon} data-active={r.horizon === horizon || undefined} key={r.horizon} aria-pressed={r.horizon === horizon} onClick={() => { setHorizon(r.horizon); persist("returnsHorizon", String(r.horizon)); }}><span>{r.horizon} {t("sessions")}</span><strong data-tone={tone(r.returnPct)}>{pct(r.returnPct)}</strong><span className={styles.horizonState}><i data-tone={r.direction === "rising" ? "up" : r.direction === "falling" ? "down" : "neutral"} />{t(r.direction)}</span></button>)}</div>
      <div className={styles.heroGrid}><section className={styles.chartPanel}><div className={styles.panelHead}><div><h3>{t("path")}</h3><div className={styles.legend}><span><i />{subject}</span>{benchmark && <span><i className={styles.benchmarkDot} />{benchmark}{priceRead.benchmarkFailed ? " · —" : ""}</span>}</div></div><div className={styles.rangeControls}>{!RANGES.includes(range as typeof RANGES[number]) && <span>{t("extendedRange")}</span>}{RANGES.map((r, i) => <button type="button" key={r} aria-pressed={range === r} onClick={() => { setRange(r); persist("returnsRange", String(r)); }}>{zh ? ["1月", "3月", "6月", "1年"][i] : ["1M", "3M", "6M", "1Y"][i]}</button>)}</div></div><div className={styles.chartTabs}>{(["performance", "relative", "drawdown"] as const).map(v => <button type="button" key={v} aria-pressed={view === v} onClick={() => setView(v)}>{t(v)}</button>)}</div>{path.length > 1 ? <ReturnPathChart points={path} symbol={subject} benchmark={benchmark} selected={selected} onSelect={selectDay} view={view} horizon={horizon} zh={zh} /> : <div className={styles.chartEmpty}>{t(series.quality === "refused" ? "refused" : "incomplete")}</div>}</section>
        <aside className={styles.readingPanel}><span className={styles.eyebrow}>{horizon} {t("sessions")} · {t("reading")}</span><h3 data-tone={reading.direction === "rising" ? "up" : reading.direction === "falling" ? "down" : "neutral"}>{t(reading.direction)}</h3><p className={styles.paceHeadline}>{t(reading.paceChange === "mixed" ? "mixed" : reading.paceChange)}</p><div className={styles.pathCharacter}><span>{reading.efficiency === null ? t(reading.complete && reading.volatilityPct === 0 ? "flat" : "characterUnavailable") : Math.abs(reading.efficiency) >= 0.5 ? t("smooth") : Math.abs(reading.efficiency) >= 0.2 ? t("choppy") : t("offsetting")}</span>{reading.concentration !== null && reading.concentration >= 0.5 && <span>{t("oneSession")}</span>}</div><div className={styles.readingMetrics}><div><span>{t("pace")}</span><strong>{pct(reading.pacePct, true, 3)}</strong><small>{t("perSession")}</small></div><div><span>{t("paceDelta")}</span><strong data-tone={tone(reading.paceDeltaPp)}>{reading.paceDeltaPp === null ? "—" : `${reading.paceDeltaPp > 0 ? "+" : ""}${reading.paceDeltaPp.toFixed(3)} ${t("pp")}`}</strong><small>{t("previous")}: {pct(reading.priorPacePct, true, 3)}</small></div></div><p className={styles.readingNote}>{!reading.complete ? t("incomplete") : reading.direction === "unqualified" ? t("basisNeeded") : t("descriptive")}</p></aside>
      </div>
      <div className={styles.riskMetrics}>{([["volatility", reading.volatilityPct, "annualized"], ["maxDrawdown", reading.drawdownPct, "peakToTrough"], ["efficiency", reading.efficiency === null ? null : reading.efficiency * 100, "efficiencyDetail"], ["concentration", reading.concentration === null ? null : reading.concentration * 100, "concentrationDetail"]] as const).map(([label, value, foot]) => <div key={label}><span>{t(label)}</span><strong>{pct(value, label === "maxDrawdown", 1)}</strong><small>{t(foot)}</small></div>)}</div>
      {basket && <section className={styles.membersPanel}><div className={styles.panelHead}><div><h3>{t("members")} · {basket.members.length}</h3><span>{t("membershipDate")}: {basketRequest!.asOf}</span></div><div className={styles.breadthMetrics}><div><span>{t("breadth")}</span><strong>{pct(basket.upShare * 100, false, 0)}</strong></div><div><span>{t("medianMember")}</span><strong data-tone={tone(basket.medianReturnPct)}>{pct(basket.medianReturnPct)}</strong></div></div></div><div className={styles.breadthBar}><span style={{ width: `${basket.upShare * 100}%` }} /></div><div className={styles.memberTable}><table><thead><tr><th>{t("stock")}</th><th>{horizon} {t("sessions")}</th><th>{t("vsBasket")} · {t("pp")}</th></tr></thead><tbody>{[...basket.members].sort((a, b) => b.returnPct - a.returnPct).map(m => <tr key={m.symbol}><th scope="row"><Link href={`/analysis?symbol=${encodeURIComponent(m.symbol)}&page=returns&returnsHorizon=${horizon}`}>{m.symbol} ↗</Link></th><td data-tone={tone(m.returnPct)}>{pct(m.returnPct)}</td><td>{m.relativePp > 0 ? "+" : ""}{m.relativePp.toFixed(2)}</td></tr>)}</tbody></table></div><div className={styles.calendarMeta}>{t("commonHistory")}: {basket.commonStart} → {basket.commonEnd}</div></section>}
      <SessionCalendar moves={moves} selected={selected} onSelect={selectDay} month={month} onMonth={setChosenMonth} zh={zh} composite={scope === "basket"} />
      <ReturnsEvidencePanel symbol={sym} session={selected!} series={series} horizon={horizon} zh={zh} composite={scope === "basket"} />
      <details className={styles.methodology}><summary>{t("methodology")} <span>{series.source ?? "—"} · {series.asOf}</span></summary><p>{t("methodText")}</p><dl><div><dt>{t("stateThreshold")}</dt><dd>{pct(reading.thresholdPct, false)}</dd></div><div><dt>{t("commonHistory")}</dt><dd>{reading.start && dateLabel(reading.start, zh)} → {reading.end && dateLabel(reading.end, zh)}</dd></div></dl>{series.issues.length > 0 && <p>{series.issues.join(" · ")}</p>}</details>
    </>}
  </div>;
}
