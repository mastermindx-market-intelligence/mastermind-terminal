"use client";
/** Board 05 Discover — the scan table. Scans presets through the existing node
 * reducer + oracle scanner (`scanPreset`), freezes the FIRST completed scan as
 * the immutable ORIGINAL and appends versioned refreshes; the Refresh button
 * can never rewrite it. The current ExposureScanner is untouched: this is the
 * board-05 replacement the parent mounts beside or instead of it. */
import { useEffect, useMemo, useState } from "react";
import { flowGetResult, type FlowOutcome } from "@/lib/flowClientCache";
import { qualifiedExposureProjection, type ExposureLens, type QualifiedProjection } from "@/lib/exposureMapProjection";
import { reduceExposureNodes } from "@/lib/exposureNodeReducer";
import { buildScanRecord, refreshScan, scanPreset, SCAN_ROLLOUT,
  type ScanRefresh, type ScanRow } from "@/lib/exposureScan";
import { exposureScanT, scanReason } from "./exposureScanStrings";
import styles from "./ExposureScanTable.module.css";

type BookStatus = "data" | "loading" | "absent" | "unavailable" | "not_loaded";
interface MoveRead { points: number; pct: number; horizonDays: number; sourceRef: string }
type BookPair = { gex: FlowOutcome; moves: FlowOutcome };
type Books = Record<string, BookPair>;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;
const isRollout = (root: string) => (SCAN_ROLLOUT as readonly string[]).includes(root);
/** U+2212 for a real minus, per the board's numeral rules. */
const signed = (v: number | null, digits = 2): string => v == null || !Number.isFinite(v) ? "—"
  : v.toLocaleString("en-US", { maximumFractionDigits: digits }).replace(/-/g, "−");
const num = (v: number | null, digits = 2): string => v == null || !Number.isFinite(v) ? "—"
  : v.toLocaleString("en-US", { maximumFractionDigits: digits });
const etTime = (ms: number): string => new Date(ms).toLocaleTimeString("en-CA",
  { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const fill = (template: string, params: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""));

/** The session derivation of lib/exposureMap.ts: the source `asof` civil date
 * is the session, and the additive projection receipt must re-validate against
 * it before any scan may read it. */
const readBook = (raw: unknown, root: string, now: number):
  { projection: QualifiedProjection | null; session: string | null; spot: number | null } => {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return { projection: null, session: null, spot: null };
  const p = raw as Record<string, unknown>;
  if (p.root !== root) return { projection: null, session: null, spot: null };
  const session = typeof p.asof === "string" && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(p.asof) ? p.asof.slice(0, 10) : null;
  const spot = positive(p.spot_ref) ? p.spot_ref : null;
  const projection = p.exposure_projection != null && session
    ? qualifiedExposureProjection(p.exposure_projection, root, session, now) : null;
  return { projection, session, spot };
};

/** Validate `options_hub.moves/v1` exactly like `exposureMoveDistance` does,
 * minus the target: EM points = expected_move.pct × spot, horizon in days,
 * sourceRef = the moves asof. A refused move stays null — never a zero EM. */
const readMoves = (raw: unknown, root: string, session: string | null, spot: number | null, now: number): MoveRead | null => {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw) || session == null || !positive(spot)) return null;
  const p = raw as Record<string, unknown>;
  const em = p.expected_move != null && typeof p.expected_move === "object" && !Array.isArray(p.expected_move)
    ? p.expected_move as Record<string, unknown> : null;
  if (p.schema !== "options_hub.moves/v1" || p.root !== root || typeof p.asof !== "string"
    || p.asof.slice(0, 10) !== session || !Number.isFinite(Date.parse(p.asof)) || Date.parse(p.asof) > now
    || (p.asof.length > 10 && !/(Z|[+-]\d{2}:\d{2})$/.test(p.asof))
    || !positive(p.spot_ref) || Math.abs(p.spot_ref - spot) > Math.max(1, spot) * 1e-8
    || !em || !positive(em.horizon_days) || !positive(em.pct) || !positive(em.band_mult)) return null;
  return { points: (em.pct / 100) * spot, pct: em.pct, horizonDays: em.horizon_days, sourceRef: p.asof };
};

/** One scan pass over the whole preset list. Presets outside SCAN_ROLLOUT never
 * fetch: they are `not_loaded` books, so their rows stay identity-unadmitted. */
const buildRows = (presets: readonly string[], books: Books, lens: ExposureLens, now: number):
  { rows: ScanRow[]; moves: Record<string, MoveRead | null> } => {
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const moves: Record<string, MoveRead | null> = {};
  const rows = presets.map((preset) => {
    if (!isRollout(preset)) {
      return scanPreset({ preset, projection: null, spot: null, expectedMove: null, emPct: null, fresh: false, bookStatus: "not_loaded" }, { lens, now });
    }
    const book = books[preset];
    const gex = book?.gex;
    if (!gex) return scanPreset({ preset, projection: null, spot: null, expectedMove: null, emPct: null, fresh: false, bookStatus: "loading" }, { lens, now });
    const read = gex.status === "data" ? readBook(gex.data, preset, now) : null;
    const move = read ? readMoves(book.moves.status === "data" ? book.moves.data : null, preset, read.session, read.spot, now) : null;
    moves[preset] = move;
    return scanPreset({ preset, projection: read?.projection ?? null, spot: read?.spot ?? null,
      expectedMove: move ? { points: move.points, horizon: `${move.horizonDays}d`, sourceRef: move.sourceRef } : null,
      emPct: move?.pct ?? null, fresh: read?.session === today,
      bookStatus: (gex.status === "data" ? "data" : gex.status === "absent" ? "absent" : "unavailable") as BookStatus },
      { lens, now });
  });
  return { rows, moves };
};

const fetchBooks = async (roots: readonly string[], refresh: boolean): Promise<Books> => {
  const entries = await Promise.all(roots.map(async (root) => {
    const [gex, moves] = await Promise.all([
      flowGetResult(`gex:${root}`, refresh ? { refresh: true } : {}),
      flowGetResult(`moves:${root}`, refresh ? { refresh: true } : {}),
    ]);
    return [root, { gex, moves }] as const;
  }));
  return Object.fromEntries(entries);
};

const nyDate = (now: number): string => new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export default function ExposureScanTable(p: {
  presets: readonly string[]; lang: "en" | "zh"; lens?: ExposureLens; now?: number;
  onOpenRoot?: (root: string) => void; onWatch?: (root: string) => void;
}) {
  const t = useMemo(() => exposureScanT(p.lang), [p.lang]);
  const rc = useMemo(() => scanReason(p.lang), [p.lang]);
  const lens = useMemo<ExposureLens>(() => p.lens ?? { kind: "all" }, [p.lens]);
  const presetsKey = p.presets.join("|");
  const [request, setRequest] = useState(0);
  const [passNow, setPassNow] = useState<number | null>(p.now ?? null);
  const [scan, setScan] = useState<ScanRefresh | null>(null);
  const [books, setBooks] = useState<Books>({});
  const [moves, setMoves] = useState<Record<string, MoveRead | null>>({});
  const [admittedOnly, setAdmittedOnly] = useState(false);
  const [sort, setSort] = useState("score");
  const [selected, setSelected] = useState<string | null>(null);

  const applyBooks = (next: Books, at: number) => {
    const built = buildRows(p.presets, next, lens, at);
    setMoves(built.moves);
    // The FIRST completed scan freezes as the ORIGINAL; every later pass —
    // Refresh or a per-book Retry — appends a revision and rewrites nothing.
    setScan((prev) => {
      if (prev) return refreshScan(prev, built.rows, at);
      const record = buildScanRecord(built.rows, at);
      return { original: record, latest: record, history: [record], deltas: [] };
    });
  };

  useEffect(() => {
    let active = true;
    const at = p.now ?? Date.now();
    void fetchBooks(presetsKey.split("|").filter(isRollout), request > 0).then((next) => {
      if (!active) return;
      setPassNow(at);
      setBooks(next);
      applyBooks(next, at);
    });
    return () => { active = false; };
    // One generation-guarded pass per request/preset-list change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, presetsKey]);

  const retry = (root: string) => {
    if (passNow == null) return;
    const at = p.now ?? passNow;
    void fetchBooks([root], true).then((next) => {
      setBooks((prev) => ({ ...prev, ...next }));
      applyBooks({ ...books, ...next }, at);
    });
  };

  const latest = scan?.latest ?? null;
  const ordered = useMemo(() => {
    const list = [...(latest?.rows ?? [])];
    if (sort === "preset") return list.sort((a, b) => a.preset.localeCompare(b.preset));
    const value = (r: ScanRow) => sort === "score" ? r.score : sort === "share" ? r.sharePct : r.distanceEm;
    return list.sort((a, b) => {
      const av = value(a), bv = value(b);
      if (av == null || bv == null) return av == null && bv == null ? a.preset.localeCompare(b.preset) : av == null ? 1 : -1;
      return (sort === "distance" ? av - bv : bv - av) || a.preset.localeCompare(b.preset);
    });
  }, [latest, sort]);
  const visible = useMemo(() => admittedOnly ? ordered.filter((r) => r.identity != null) : ordered, [ordered, admittedOnly]);
  const selectedPreset = selected != null && (latest?.rows ?? []).some((r) => r.preset === selected)
    ? selected : ordered.find((r) => r.score != null)?.preset ?? ordered[0]?.preset ?? null;
  const selectedRow = visible.find((r) => r.preset === selectedPreset) ?? null;

  const inspection = useMemo(() => {
    if (passNow == null) return null;
    const book = selectedPreset != null ? books[selectedPreset] : undefined;
    if (selectedPreset == null || !book || book.gex.status !== "data") return null;
    const read = readBook(book.gex.data, selectedPreset, passNow);
    if (!read.projection) return null;
    const move = moves[selectedPreset] ?? null;
    const reduction = reduceExposureNodes(read.projection, { metric: "gamma", lens, spot: read.spot,
      expectedMove: move ? { points: move.points, horizon: `${move.horizonDays}d`, sourceRef: move.sourceRef } : null,
      fresh: read.session === nyDate(passNow), now: passNow });
    return { read, move, reduction };
  }, [books, moves, selectedPreset, lens, passNow]);

  const statusCopy = (row: ScanRow): string => {
    switch (row.status) {
      case "candidate": return t("statusCandidate");
      case "contested": return t("statusContested");
      case "unscored": return t("statusUnscored");
      case "metric_not_scanned": return t("statusMetricNotScanned");
      case "book_unavailable": return t("statusBookUnavailable");
      case "identity_unadmitted": return isRollout(row.preset) ? t("statusUnadmittedNext") : t("statusUnadmitted");
      case "partial": return fill(t("statusPartial"),
        { reason: row.reasons.length ? rc(row.reasons[0]) : rc("other"), pct: row.coveragePct != null ? num(row.coveragePct, 0) : "—" });
    }
  };

  const scopeCopy = (row: ScanRow): string =>
    fill(t("scopeAll"), { n: Number(row.scopeLabel.split(" ")[1] ?? 0) || 0 });

  const deltaCopy = (row: ScanRow): string => {
    if (!scan || scan.history.length < 2) return "";
    const d = scan.deltas.find((x) => x.preset === row.preset);
    if (!d) return "";
    const parts: string[] = [];
    if (d.nodeMoved) parts.push(fill(t("nodeMoved"), { a: d.previousStrike ?? "—", b: d.currentStrike ?? "—" }));
    if (d.contestedChanged) parts.push(row.contested ? t("contestedUp") : t("contestedDown"));
    if (d.scoreDelta != null) parts.push(fill(t("scoreDelta"), { v: signed(d.scoreDelta, 1) }));
    return parts.join(" · ");
  };

  const scoredRank = useMemo(() => latest
    ? [...latest.rows].filter((r) => r.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    : [], [latest]);
  const k = selectedRow && selectedRow.score != null
    ? scoredRank.findIndex((r) => r.preset === selectedRow.preset) + 1 : 0;

  return (
    <section className={styles.root} data-scan-status={p.presets.length === 0 ? "empty" : latest ? "ready" : "loading"}
      data-scan-revision={latest?.revision ?? 0}>
      <div className={styles.board}>
        <div className={styles.toolbar}>
          <button type="button" className={styles.chip} data-static="true">{t("gamma")}</button>
          <button type="button" className={styles.chip} data-static="true">{t("allExpiries")}</button>
          <button type="button" className={styles.chip} data-on={admittedOnly} aria-pressed={admittedOnly}
            onClick={() => setAdmittedOnly((v) => !v)}>{t("admittedOnly")}</button>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("sortScore")}>
            <option value="score">{t("sortScore")}</option>
            <option value="distance">{t("sortDistance")}</option>
            <option value="share">{t("sortShare")}</option>
            <option value="preset">{t("sortPreset")}</option>
          </select>
          <button type="button" className={styles.ghost} disabled={latest == null}
            onClick={() => setRequest((n) => n + 1)}>{t("refresh")}</button>
          <div className={styles.toolbarMeta}>
            <span className={styles.counts}>{latest ? fill(t("counts"), { presets: latest.presets,
              scored: latest.scored, unscored: latest.unscored + latest.unadmitted }) : "…"}</span>
            <span className={styles.tag}>{latest ? fill(t("scannerTag"), { rev: latest.revision }) : ""}</span>
            {scan != null && latest != null && scan.history.length > 1 &&
              <span className={styles.originalLine}>{fill(t("originalLine"), { t: etTime(scan.original.scannedAt),
                rev: latest.revision, t2: etTime(latest.scannedAt) })}</span>}
          </div>
        </div>
        {p.presets.length === 0 ? <div className={styles.empty} role="status">{t("noPresets")}</div> : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead><tr>{[t("preset"), t("metricScope"), t("dominant"), t("share"), t("contested"),
                t("distanceEm"), t("score"), t("status"), t("flags")].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {latest == null
                  ? p.presets.filter(isRollout).map((root) => (
                    <tr key={root}><td colSpan={9} style={{ padding: 0 }}><div className={styles.skeleton} /></td></tr>))
                  : visible.map((row) => {
                    const move = moves[row.preset];
                    return (
                      <tr key={row.preset} data-selected={row.preset === selectedPreset}>
                        <td><button type="button" className={styles.rowBtn} onClick={() => setSelected(row.preset)}>
                          <span className={styles.presetRoot}>{row.preset}</span>
                          <span className={styles.identity}>{row.identity
                            ? `${row.identity.securityId} · ${row.identity.version}` : t("identityPending")}</span>
                        </button></td>
                        <td className={styles.muted}>{scopeCopy(row)}</td>
                        <td className={styles.num}>{row.dominantStrike ?? "—"}
                          {row.dominantNetMn != null &&
                            <span data-sign={row.dominantNetMn < 0 ? "negative" : "positive"}> {signed(row.dominantNetMn, 0)}</span>}</td>
                        <td className={styles.num}>{row.sharePct != null ? `${num(row.sharePct, 1)}%` : "—"}</td>
                        <td className={styles.num}>{row.contestedRatio != null ? `${num(row.contestedRatio, 2)}×` : "—"}
                          {row.contested === true && <> <span className={styles.pill}>{t("contestedPill")}</span></>}</td>
                        <td className={styles.num}>{row.distancePct != null ? `${num(row.distancePct, 2)}%` : "—"}
                          {row.distanceFit != null && <span className={styles.muted}> · {move ? `${num(move.pct, 2)}%` : "—"}
                            · {fill(t("fit"), { v: num(row.distanceFit, 2) })}</span>}</td>
                        <td className={styles.num}>{row.score != null
                          ? <span className={row.status === "candidate" || row.status === "contested" ? styles.goldText : undefined}>{num(row.score, 1)}</span>
                          : <span className={styles.muted}>null</span>}</td>
                        <td>{row.status === "book_unavailable"
                          ? <>{t("statusBookUnavailable")}<button type="button" className={styles.retry}
                            onClick={() => retry(row.preset)}>{t("retry")}</button></>
                          : statusCopy(row)}</td>
                        <td className={styles.delta}>{deltaCopy(row)}</td>
                      </tr>);
                  })}
              </tbody>
            </table>
          </div>
        )}
        <div className={styles.footer}><span>{t("footerNull")}</span>
          <span className={styles.rollout}>{t("rollout")}{latest != null && latest.unadmitted > 0
            ? ` · ${latest.unadmitted} ${t("statusUnadmitted")}` : ""}</span></div>
      </div>
      <aside className={styles.inspector}>
        {selectedRow == null ? <p className={styles.sub} role="status">{t("noPresets")}</p> : <>
          <span className={styles.eyebrow}>{selectedRow.score != null
            ? fill(t("candidateK"), { k, n: latest?.scored ?? 0 }) : t("row")}</span>
          <h3>{selectedRow.preset}</h3>
          <span className={styles.sub}>{scopeCopy(selectedRow)}</span>
          <div>
            <div className={styles.bigNumber} data-candidate={selectedRow.status === "candidate" || selectedRow.status === "contested"}>
              {selectedRow.score != null ? num(selectedRow.score, 1) : "null"}</div>
            <span className={styles.scoreNote}>{selectedRow.score != null
              ? (selectedRow.candidateScore != null ? t("scoreEligible") : t("scoreOutside"))
              : fill(t("nullReason"), { reason: selectedRow.reasons.length
                ? [...selectedRow.reasons].map(rc).join(", ") : rc("other") })}</span>
          </div>
          <dl className={styles.dl}>
            <dt>{t("dominance")}</dt><dd>{inspection?.reduction.scanner.status === "ok" ? num(inspection.reduction.scanner.dominance, 4) : "—"}</dd>
            <dt>{t("concentration")}</dt><dd>{inspection?.reduction.scanner.status === "ok"
              ? `${num(inspection.reduction.scanner.cappedConcentration, 4)}${inspection.reduction.scanner.cappedConcentration >= 1 ? ` · ${t("capped")}` : ""}` : "—"}</dd>
            <dt>{t("strength")}</dt><dd>{inspection?.reduction.scanner.status === "ok" ? num(inspection.reduction.scanner.strength, 2) : "—"}</dd>
            <dt>{t("distanceFit")}</dt><dd>{inspection?.reduction.scanner.status === "ok"
              ? fill(t("emLine"), { fit: num(inspection.reduction.scanner.distanceFit, 2),
                em: inspection.move ? num(inspection.move.points, 2) : "—",
                pct: inspection.move ? num(inspection.move.pct, 2) : "—" }) : "—"}</dd>
            <dt>{t("regime")}</dt><dd>{inspection?.reduction.scanner.status === "ok"
              ? fill(t("regimeLine"), { m: inspection.reduction.scanner.regimeMultiplier }) : "—"}</dd>
          </dl>
          <div className={styles.block}>
            <span className={styles.eyebrow}>{t("scanner")}</span>
            <span className={styles.sub}>{t("scannerVersion")} · {t("scannerBasis")}</span>
          </div>
          {scan != null && scan.history.length > 1 &&
            <div className={styles.block}>
              <span className={styles.eyebrow}>{t("revisions")}</span>
              <div className={styles.revList}>{scan.history.map((rec) => {
                const r = rec.rows.find((x) => x.preset === selectedRow.preset);
                const copy = rec.origin === "original" ? fill(t("revOriginal"), { t: etTime(rec.scannedAt) })
                  : fill(t("revN"), { n: rec.revision, t: etTime(rec.scannedAt) });
                return <span key={rec.revision}>{copy} · {r?.dominantStrike ?? "—"} · {r?.score != null ? num(r.score, 1) : "—"}</span>;
              })}</div>
            </div>}
          <p className={styles.caveat}>{t("caveat")}</p>
          <div className={styles.actions}>
            {p.onOpenRoot && selectedPreset != null &&
              <button type="button" onClick={() => p.onOpenRoot?.(selectedPreset)}>{fill(t("openInExposure"), { root: selectedPreset })}</button>}
            {p.onWatch && selectedPreset != null &&
              <button type="button" onClick={() => p.onWatch?.(selectedPreset)}>{fill(t("watch"), { root: selectedPreset })}</button>}
          </div>
        </>}
      </aside>
    </section>
  );
}


