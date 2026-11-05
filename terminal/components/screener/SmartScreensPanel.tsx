"use client";

/**
 * Smart screens (E04) — save the screener's current filters to the ACCOUNT as a versioned,
 * explainable screen, reopen it on any device, and see on demand which names entered or left
 * since the last reviewed snapshot.
 *
 * Everything here runs only when the user asks: there is no schedule, no alert and no ranking.
 * The panel reads the same rows the table reads (the full manifest, not the device-gated view —
 * a screen carries its own market scope) and evaluates them with the same grammar module the
 * API validated the screen with.
 *
 * E02 fundamental conditions the table holds are saved with the screen (grammar 2) and put back
 * on the table when it is opened; counts and Explain apply them through lib/fundamentalScan with
 * the table's own rule (lib/smartScreen/fundamental). E01 technical conditions are not part of a
 * saved screen.
 */

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import type { AccountIdentity } from "@/lib/accountIdentity";
import { ALL_MARKETS, MARKET_TKEY, type MarketId } from "@/lib/markets";
import { browserStorage } from "@/lib/ownerStorage";
import { useLang } from "@/lib/i18n";
import { useSmartScreenT } from "@/lib/smartScreenLex";
import { useSmartScreens } from "@/lib/smartScreen/useSmartScreens";
import type { PendingOp } from "@/lib/smartScreen/client";
import {
  compileFilters, decompileToFilters, fundOf, groupParts, isGroup,
  type LeafTrace, type ScreenDefinition, type ScreenNode, type ScreenRow, type ScreenerFilters,
} from "@/lib/smartScreen/predicate";
import {
  classifyScreenRow, countScreenMatches,
  type FundamentalContext, type FundamentalTrace, type ScreenCount, type ScreenRowStatus,
} from "@/lib/smartScreen/fundamental";
import { buildReview, diffScreen, reviewableDefinition, type ChangeGroup, type ScreenChange } from "@/lib/smartScreen/review";
import { formatFundamentalValue, type FundamentalPredicate } from "@/lib/fundamentalScan";
import { reasonText as fundReasonText, statusText as fundStatusText, useFundT } from "@/lib/fundamentalScanLex";
import { predicateLabel } from "./FundamentalScreen";
import { MAX_NAME_CHARS, MAX_SCREENS, normalizeScreenName, type ScreenRecord } from "@/lib/smartScreen/record";
import { readDevicePresets, type DevicePreset } from "@/lib/smartScreen/devicePresets";
import styles from "./SmartScreensPanel.module.css";

type Props = {
  identity: AccountIdentity;
  /** Every row of the loaded scan (not the device-gated table view). */
  rows: readonly ScreenRow[];
  /** true only when a scan is loaded and readable. */
  ready: boolean;
  /** The scan's source generation (manifest `as_of`). */
  asOf: string;
  filters: ScreenerFilters;
  /** The E02 fundamental conditions the table holds — saved with the screen. */
  fundPreds: readonly FundamentalPredicate[];
  /** The E02 fundamental scan the table reads (source null until it answers). */
  fundScan: FundamentalContext;
  /** Ask the screener to read the fundamental scan: a saved screen needs it while the panel is open. */
  onFundNeeded: (needed: boolean) => void;
  /** The device's enabled markets once known; null while they load. */
  prefsEnabled: MarketId[] | null;
  showAllMarkets: boolean;
  labelGics: (value: string) => string;
  labelAsset: (value: string) => string;
  /** Put a screen's filters and fundamental conditions on the table. `showAllMarkets` null
   *  leaves the session toggle; `fund` replaces the table's fundamental conditions ([] clears). */
  onOpen: (filters: ScreenerFilters, opts: { showAllMarkets: boolean | null; fund: FundamentalPredicate[] }) => void;
};

type Notice = { tone: "ok" | "warn"; text: string } | null;
type Explained = {
  id: string;
  sym: string;
  status: ScreenRowStatus | "absent" | "not_ready";
  trace: LeafTrace[];
  fund: FundamentalTrace[];
} | null;

const GROUPS: ChangeGroup[] = ["entered", "exited", "coverage", "unverified"];
const SHOW_PER_GROUP = 60;

const fill = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));

const usd = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e12) return `$${+(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${+(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${+(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

export default function SmartScreensPanel(props: Props) {
  const {
    identity, rows, ready, asOf, filters, fundPreds, fundScan, onFundNeeded,
    prefsEnabled, showAllMarkets, labelGics, labelAsset, onOpen,
  } = props;
  const t = useSmartScreenT();
  const ft = useFundT();
  const { lang } = useLang();
  const { snap, store } = useSmartScreens(identity);
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [diffId, setDiffId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rowNote, setRowNote] = useState<{ id: string; text: string } | null>(null);
  const [explainSym, setExplainSym] = useState("");
  const [explained, setExplained] = useState<Explained>(null);
  const [devicePresets, setDevicePresets] = useState<DevicePreset[]>([]);

  const ack = snap.ack;
  const screens = useMemo(() => ack?.screens ?? [], [ack]);
  const pendingIds = useMemo(() => new Set(snap.pending.map((op) => op.id)), [snap.pending]);
  const canWrite = !!ack && !snap.busy && (snap.status === "ready" || snap.status === "stale");
  // Every stored screen row counts toward the account cap — including ones this version cannot
  // read — exactly as the API counts them.
  const usedSlots = screens.length + (ack ? ack.readOnly.length + ack.invalid : 0);

  // ── labels ──────────────────────────────────────────────────────────────────────────
  const marketsText = useCallback((markets: "all" | MarketId[]) =>
    markets === "all" ? t("ssScopeAll") : markets.map((m) => t(MARKET_TKEY[m])).join(", "), [t]);

  const valueText = useCallback((f: LeafTrace["f"], value: number | string | boolean | string[]): string => {
    if (Array.isArray(value)) return value.map((v) => (f === "gics" ? labelGics(v) : v)).join(", ");
    if (typeof value === "boolean") return value ? t("ssYes") : t("ssNo");
    if (typeof value === "string") return f === "gics" ? labelGics(value) : value;
    if (f === "dv" || f === "mcap") return usd(value);
    if (f === "chg" || f === "offHi" || f === "offLo") return `${value > 0 && f === "chg" ? "+" : ""}${value.toFixed(1)}%`;
    return value.toFixed(2);
  }, [labelGics, t]);

  const conditionText = useCallback((leaf: { f: LeafTrace["f"]; op: LeafTrace["op"]; v?: LeafTrace["v"] }): string => {
    const field = t(`ssF_${leaf.f}`);
    if (leaf.op === "present") return `${field} ${t("ssOp_present")}`;
    if (leaf.op === "gte" || leaf.op === "lte") return `${field} ${leaf.op === "gte" ? "≥" : "≤"} ${valueText(leaf.f, leaf.v as number)}`;
    return `${field} ${t(`ssOp_${leaf.op}`)} ${valueText(leaf.f, leaf.v as string[] | boolean)}`;
  }, [t, valueText]);

  const nodeText = useCallback(function render(node: ScreenNode): string {
    if (!isGroup(node)) return conditionText(node);
    const [kind, items] = groupParts(node);
    const inner = items.map(render).join(kind === "all" ? " · " : " / ");
    return kind === "any" ? `${t("ssAnyOf")} (${inner})` : inner;
  }, [conditionText, t]);

  const definitionText = useCallback((def: ScreenDefinition): string => {
    const parts = [marketsText(def.scope.markets)];
    if (def.scope.asset) parts.push(labelAsset(def.scope.asset));
    if (def.scope.unpriced) parts.push(t("ssUnpriced"));
    const conditions = groupParts(def.where)[1].length ? [nodeText(def.where)] : [];
    // Fundamental conditions read exactly as the table's chips do ("Net mgn FY ≥ 15%").
    for (const p of fundOf(def)) conditions.push(predicateLabel(ft, p));
    return `${parts.join(" · ")} — ${conditions.length ? conditions.join(" · ") : t("ssNoConditions")}`;
  }, [ft, labelAsset, marketsText, nodeText, t]);

  const leafLine = (leaf: LeafTrace, key: number) => (
    <li key={key} className={styles.leaf} data-ss-leaf={leaf.result === true ? "pass" : leaf.result === false ? "fail" : "unknown"}>
      <span className={leaf.result === true ? styles.pass : leaf.result === false ? styles.fail : styles.unknown}>
        {leaf.result === true ? t("ssLeafPass") : leaf.result === false ? t("ssLeafFail") : t("ssLeafUnknown")}
      </span>
      <span>{conditionText(leaf)}</span>
      <span className={styles.now}>
        {t("ssNow")}: {leaf.value === null ? t("ssMissing") : valueText(leaf.f, leaf.value)}
      </span>
    </li>
  );

  const fundLine = (entry: FundamentalTrace, key: number) => {
    const c = entry.cell;
    const shown = c !== null && c.value !== null && (c.coverage.status === "evaluated" || c.coverage.status === "stale");
    const now = shown
      ? formatFundamentalValue(entry.predicate.field, c.value as number)
      : c ? `${fundStatusText(ft, c.coverage.status)} — ${fundReasonText(ft, c.coverage.reason)}` : t("ssMissing");
    const tone = entry.match === "pass" ? "pass" : entry.match === "fail" ? "fail" : "unknown";
    return (
      <li key={`f${key}`} className={styles.leaf} data-ss-leaf={tone} data-ss-fund-leaf={entry.predicate.field}>
        <span className={tone === "pass" ? styles.pass : tone === "fail" ? styles.fail : styles.unknown}>
          {tone === "pass" ? t("ssLeafPass") : tone === "fail" ? t("ssLeafFail") : t("ssLeafUnknown")}
        </span>
        <span>{predicateLabel(ft, entry.predicate)}</span>
        <span className={styles.now}>{t("ssNow")}: {now}</span>
      </li>
    );
  };

  const timeText = (iso: string) => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  // ── the filter bar as a screen ──────────────────────────────────────────────────────
  // The fundamental conditions are part of the definition, so the duplicate check, "on the table"
  // and Replace all compare them too.
  const current = useMemo(
    () => compileFilters(filters, { prefsEnabled, showAllMarkets }, fundPreds),
    [filters, prefsEnabled, showAllMarkets, fundPreds],
  );
  const duplicate = current.ok ? screens.find((screen) => screen.hash === current.hash) ?? null : null;

  // A saved screen with fundamental conditions needs the fundamental scan to be counted or
  // explained; ask for it only while the panel is open.
  const needsFund = open && screens.some((screen) => fundOf(screen.def).length > 0);
  useEffect(() => { onFundNeeded(needsFund); }, [needsFund, onFundNeeded]);

  // Match counts are computed only while the panel is open, over the loaded scan.
  const matchCounts = useMemo(() => {
    const counts = new Map<string, ScreenCount>();
    if (!open || !ready) return counts;
    for (const screen of screens) counts.set(screen.id, countScreenMatches(screen.def, rows, fundScan));
    return counts;
  }, [open, ready, rows, screens, fundScan]);

  const diffRecord = diffId ? screens.find((screen) => screen.id === diffId) ?? null : null;
  const diff = useMemo(
    () => (diffRecord ? diffScreen(diffRecord.def, diffRecord.hash, diffRecord.review, rows, { asOf: asOf || null, dataReady: ready }) : null),
    [diffRecord, rows, asOf, ready],
  );

  // ── actions ─────────────────────────────────────────────────────────────────────────
  const toggle = () => {
    setOpen((was) => {
      if (!was) setDevicePresets(readDevicePresets(browserStorage()));
      return !was;
    });
  };

  const reasonText = (reason: string): string => {
    if (reason === "no_baseline") return t("ssNeedBaseline");
    if (reason === "too_many_pending") return t("ssTooManyPending");
    if (reason === "invalid") return t("ssInvalidDef");
    if (reason === "busy") return t("ssBusy");
    return "";
  };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!current.ok) { setNotice({ tone: "warn", text: t("ssInvalidDef") }); return; }
    const clean = normalizeScreenName(name);
    if (!clean) { setNotice({ tone: "warn", text: t("ssNeedName") }); return; }
    if (usedSlots >= MAX_SCREENS) { setNotice({ tone: "warn", text: fill(t("ssLimit"), { n: MAX_SCREENS }) }); return; }
    const out = await store.create({ name: clean, def: current.def });
    if (out.ok) {
      setName("");
      setNotice({ tone: "ok", text: fill(t("ssSaved"), { name: clean }) });
    } else if (out.reason === "failed" || out.reason === "conflict" || out.reason === "gone") {
      // Not acknowledged: the complete draft now lives in the pending list (device-persisted),
      // where it can be retried or discarded. Clearing the input keeps a second Save from
      // minting a duplicate of the same draft.
      setName("");
      setNotice(null);
    } else {
      // Refused before sending: the draft stays in the input.
      const text = reasonText(out.reason);
      setNotice(text ? { tone: "warn", text } : null);
    }
  };

  const openDefinition = (label: string, def: ScreenDefinition) => {
    const back = decompileToFilters(def);
    if (!back) { setNotice({ tone: "warn", text: t("ssCannotOpen") }); return; }
    let widen: boolean | null = null;
    let warn: string | null = null;
    if (def.scope.markets === "all") {
      // The screen covers every market: widen the session view if this device narrows it.
      widen = prefsEnabled !== null && new Set(prefsEnabled).size < ALL_MARKETS.length;
    } else if (back.marketSubset) {
      const device = prefsEnabled ? [...new Set(prefsEnabled)].sort() : null;
      widen = false;
      if (!device || device.join(",") !== back.marketSubset.join(",")) {
        warn = fill(t("ssMarketNotice"), {
          name: label, a: marketsText(back.marketSubset), b: device ? marketsText(device) : "—",
        });
      }
    }
    onOpen(back.filters, { showAllMarkets: widen, fund: back.fund });
    setNotice(warn ? { tone: "warn", text: warn } : { tone: "ok", text: fill(t("ssOpened"), { name: label }) });
  };

  const markReviewed = async (screen: ScreenRecord) => {
    if (!ready) { setRowNote({ id: screen.id, text: t("ssRevErr_not_ready") }); return; }
    const built = buildReview(screen.def, screen.hash, rows, { asOf: asOf || null });
    if (!built.ok) {
      setRowNote({ id: screen.id, text: fill(t(`ssRevErr_${built.error}`), { n: (built.count ?? 0).toLocaleString() }) });
      return;
    }
    setRowNote(null);
    const out = await store.update(screen.id, { review: built.review });
    if (out.ok) setNotice({ tone: "ok", text: fill(t("ssReviewedOk"), { name: screen.name, d: built.review.asOf }) });
  };

  const replace = async (screen: ScreenRecord) => {
    if (!current.ok) { setNotice({ tone: "warn", text: t("ssInvalidDef") }); return; }
    const out = await store.update(screen.id, { def: current.def });
    if (out.ok) setNotice({ tone: "ok", text: fill(t("ssSaved"), { name: screen.name }) });
  };

  const remove = async (id: string, label: string) => {
    setConfirmId(null);
    const out = await store.remove(id);
    if (out.ok) {
      if (diffId === id) setDiffId(null);
      setNotice({ tone: "ok", text: fill(t("ssDeleted"), { name: label }) });
    }
  };

  const adopt = async (preset: DevicePreset) => {
    const compiled = compileFilters(preset.filters, { prefsEnabled, showAllMarkets: false });
    if (!compiled.ok) { setNotice({ tone: "warn", text: t("ssInvalidDef") }); return; }
    if (usedSlots >= MAX_SCREENS) { setNotice({ tone: "warn", text: fill(t("ssLimit"), { n: MAX_SCREENS }) }); return; }
    const out = await store.create({ name: preset.name, def: compiled.def });
    if (out.ok) setNotice({ tone: "ok", text: fill(t("ssSaved"), { name: preset.name }) });
    else { const text = reasonText(out.reason); if (text) setNotice({ tone: "warn", text }); }
  };

  const explain = (screen: ScreenRecord, event: FormEvent) => {
    event.preventDefault();
    const sym = explainSym.trim().toUpperCase();
    if (!sym) return;
    if (!ready) { setExplained({ id: screen.id, sym, status: "not_ready", trace: [], fund: [] }); return; }
    const row = rows.find((r) => r.sym.toUpperCase() === sym);
    if (!row) { setExplained({ id: screen.id, sym, status: "absent", trace: [], fund: [] }); return; }
    const verdict = classifyScreenRow(screen.def, row, fundScan);
    setExplained({ id: screen.id, sym: row.sym, status: verdict.status, trace: verdict.trace, fund: verdict.fund });
  };

  // ── sync line ───────────────────────────────────────────────────────────────────────
  let syncText = "";
  let syncWarn = false;
  if (snap.status === "guest") syncText = t("ssGuest");
  else if (snap.status === "loading") syncText = t("ssLoading");
  else if (snap.status === "ready") syncText = fill(t("ssReady"), { t: ack ? timeText(ack.readAt) : "—" });
  else if (snap.status === "stale") { syncText = fill(t("ssStale"), { t: ack ? timeText(ack.readAt) : "—" }); syncWarn = true; }
  else { syncText = snap.readFailure === "unauthenticated" ? t("ssUnauth") : t("ssUnavailable"); syncWarn = true; }
  if (snap.status === "stale" && snap.readFailure === "unauthenticated") syncText = t("ssUnauth");

  const opLabel = (op: PendingOp) => t(`ssOp_${op.action}`);

  const pendingLine = (op: PendingOp) => {
    if (op.state === "sending") return fill(t("ssSendingLine"), { op: opLabel(op), name: op.name });
    if (op.state === "failed") return fill(t("ssFailedLine"), { op: opLabel(op), name: op.name, why: t(`ssFail_${op.error ?? "unavailable"}`) });
    if (op.state === "conflict") {
      return op.current
        ? fill(t("ssConflictLine"), { name: op.name, rev: fill(t("ssRev"), { n: op.current.rev }) })
        : fill(t("ssConflictUnknown"), { name: op.name });
    }
    return fill(t("ssGoneLine"), { name: op.name });
  };

  const changeKindText = (change: ScreenChange): string => {
    if (change.kind === "coverage_lost") return t(change.now === "absent" ? "ssKind_coverage_lost_absent" : "ssKind_coverage_lost_unpriced");
    return t(`ssKind_${change.kind}`);
  };

  return (
    <section className={styles.root} data-smart-screens data-ss-status={snap.status} aria-label={t("ssTitle")}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? t("ssHide") : t("ssShow")}
          onClick={toggle}
          data-ss-toggle
        >
          <span className={styles.chev} aria-hidden="true">{open ? "▾" : "▸"}</span>
          <b>{t("ssTitle")}</b>
          {ack && <span className={styles.count}>{fill(t("ssCount"), { n: screens.length })}</span>}
          {snap.pending.length > 0 && (
            <span className={styles.badge} data-ss-pending-count={snap.pending.length}>
              {fill(t("ssPendingBadge"), { n: snap.pending.length })}
            </span>
          )}
        </button>
        <span className={syncWarn ? `${styles.sync} ${styles.warnText}` : styles.sync} data-ss-sync={snap.status}>{syncText}</span>
        {(snap.status === "stale" || snap.status === "unavailable") && (
          <button type="button" className={`chip ${styles.btn}`} onClick={() => void store.refresh()} disabled={snap.busy} data-ss-retry-read>
            {t("ssRetry")}
          </button>
        )}
      </div>

      {open && (
        <div id={bodyId} className={styles.body}>
          <p className={notice?.tone === "warn" ? `${styles.notice} ${styles.warnText}` : styles.notice} role="status" aria-live="polite" data-ss-notice>
            {notice?.text ?? ""}
          </p>

          {snap.device === "failed" && <p className={`${styles.line} ${styles.warnText}`} data-ss-device="failed">{t("ssDeviceFailed")}</p>}
          {snap.device === "blocked" && <p className={`${styles.line} ${styles.warnText}`} data-ss-device="blocked">{t("ssDeviceBlocked")}</p>}

          {snap.status !== "guest" && (
            <form className={styles.saveRow} onSubmit={save} data-ss-save>
              <input
                className={styles.input}
                value={name}
                maxLength={MAX_NAME_CHARS}
                placeholder={t("ssNamePh")}
                aria-label={t("ssNameLabel")}
                onChange={(e) => setName(e.target.value)}
                data-ss-name-input
              />
              <button type="submit" className={`chip ${styles.btn}`} disabled={!canWrite || !current.ok} data-ss-save-button>
                {t("ssSaveCurrent")}
              </button>
              {current.ok && <span className={styles.meta} data-ss-current>{definitionText(current.def)}</span>}
              {!ack && snap.status !== "loading" && <span className={styles.meta}>{t("ssNeedBaseline")}</span>}
              {duplicate && <span className={styles.meta} data-ss-duplicate={duplicate.id}>{fill(t("ssDuplicate"), { name: duplicate.name })}</span>}
            </form>
          )}

          {snap.pending.length > 0 && (
            <div className={styles.pending} data-ss-pending-list>
              <h4 className={styles.h4}>{t("ssPendingTitle")}</h4>
              <ul className={styles.list}>
                {snap.pending.map((op) => (
                  <li
                    key={op.opId}
                    className={styles.pendingItem}
                    data-ss-pending={op.state} // plain-language-ok: test/automation hook attribute, never rendered; the visible text comes from t()
                    data-ss-op={op.action}
                    data-ss-error={op.error ?? ""}
                  >
                    <span>{pendingLine(op)}</span>
                    <span className={styles.actions}>
                      {op.state === "failed" && op.error !== "newer_schema" && (
                        <button type="button" className={`chip ${styles.btn}`} disabled={snap.busy} onClick={() => void store.retry(op.opId)} data-ss-retry>
                          {t("ssRetry")}
                        </button>
                      )}
                      {op.state === "conflict" && (
                        <>
                          <button type="button" className={`chip ${styles.btn}`} disabled={snap.busy} onClick={() => store.useAccountVersion(op.opId)} data-ss-use-account>
                            {t("ssUseAccount")}
                          </button>
                          {op.current && (
                            <button type="button" className={`chip ${styles.btn}`} disabled={snap.busy} onClick={() => void store.overwrite(op.opId)} data-ss-overwrite>
                              {op.action === "delete" ? t("ssDelete") : t("ssOverwrite")}
                            </button>
                          )}
                        </>
                      )}
                      {op.state === "gone" && op.def && (
                        <button type="button" className={`chip ${styles.btn}`} disabled={snap.busy} onClick={() => void store.saveAsNew(op.opId)} data-ss-save-as-new>
                          {t("ssSaveAsNew")}
                        </button>
                      )}
                      {op.def && op.state !== "sending" && (
                        <button type="button" className={`chip ${styles.btn}`} onClick={() => openDefinition(op.name, op.def as ScreenDefinition)} data-ss-open-unsaved>
                          {t("ssUnsavedOpen")}
                        </button>
                      )}
                      {op.state !== "sending" && (
                        <button type="button" className={`chip ${styles.btn}`} disabled={snap.busy} onClick={() => store.discard(op.opId)} data-ss-discard>
                          {t("ssDiscard")}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ack && screens.length === 0 && ack.readOnly.length === 0 && <p className={styles.line} data-ss-empty>{t("ssEmpty")}</p>}

          {ack && screens.length > 0 && (
            <ul className={styles.list} data-ss-screens>
              {screens.map((screen) => {
                const onTable = current.ok && current.hash === screen.hash;
                const locked = pendingIds.has(screen.id);
                const openable = decompileToFilters(screen.def) !== null;
                const reviewable = reviewableDefinition(screen.def);
                const count = matchCounts.get(screen.id);
                const showingDiff = diffId === screen.id;
                return (
                  <li key={screen.id} className={styles.item} data-ss-screen={screen.id} data-ss-name={screen.name} data-ss-rev={screen.rev}>
                    <div className={styles.itemHead}>
                      <b className={styles.name}>{screen.name}</b>
                      {onTable && <span className={styles.tagOn} data-ss-on-table>{t("ssOnScreen")}</span>}
                      <span className={styles.meta}>{fill(t("ssRev"), { n: screen.rev })}</span>
                      {count?.kind === "count" && <span className={styles.meta} data-ss-matches={count.n}>{fill(t("ssMatchesNow"), { n: count.n.toLocaleString() })}</span>}
                      {count?.kind === "fund_pending" && <span className={styles.meta} data-ss-matches-state="fund_pending">{t("ssMatchesFundPending")}</span>}
                      {count?.kind === "fund_unavailable" && (
                        <span className={`${styles.meta} ${styles.warnText}`} data-ss-matches-state="fund_unavailable">{t("ssMatchesFundUnavailable")}</span>
                      )}
                      {reviewable && (
                        <span className={styles.meta} data-ss-reviewed={screen.review ? screen.review.asOf : ""}>
                          {screen.review
                            ? fill(t("ssReviewed"), { d: screen.review.asOf, n: (screen.review.m ? screen.review.m.split(",").length : 0).toLocaleString() })
                            : t("ssNotReviewed")}
                        </span>
                      )}
                    </div>
                    <p className={styles.def} data-ss-definition>{definitionText(screen.def)}</p>
                    <div className={styles.actions}>
                      <button type="button" className={`chip ${styles.btn}`} disabled={!openable} onClick={() => openDefinition(screen.name, screen.def)} data-ss-open>
                        {t("ssOpen")}
                      </button>
                      <button
                        type="button"
                        className={`chip ${styles.btn}${showingDiff ? " on" : ""}`}
                        aria-expanded={showingDiff}
                        onClick={() => { setDiffId(showingDiff ? null : screen.id); setExplained(null); }}
                        data-ss-changes
                      >
                        {showingDiff ? t("ssHideChanges") : t("ssChanges")}
                      </button>
                      <button type="button" className={`chip ${styles.btn}`} disabled={!canWrite || locked || !reviewable} onClick={() => void markReviewed(screen)} data-ss-review>
                        {t("ssMarkReviewed")}
                      </button>
                      <button type="button" className={`chip ${styles.btn}`} disabled={!canWrite || locked || !current.ok || onTable} onClick={() => void replace(screen)} data-ss-replace>
                        {t("ssReplace")}
                      </button>
                      {confirmId === screen.id ? (
                        <>
                          <span className={styles.meta}>{fill(t("ssConfirmDelete"), { name: screen.name })}</span>
                          <button type="button" className={`chip ${styles.btn} ${styles.danger}`} disabled={!canWrite || locked} onClick={() => void remove(screen.id, screen.name)} data-ss-confirm-delete>
                            {t("ssDelete")}
                          </button>
                          <button type="button" className={`chip ${styles.btn}`} onClick={() => setConfirmId(null)}>{t("ssCancel")}</button>
                        </>
                      ) : (
                        <button type="button" className={`chip ${styles.btn}`} disabled={!canWrite || locked} onClick={() => setConfirmId(screen.id)} data-ss-delete>
                          {t("ssDelete")}
                        </button>
                      )}
                    </div>
                    {!openable && <p className={styles.line}>{t("ssCannotOpen")}</p>}
                    {!reviewable && <p className={styles.meta} data-ss-fund-note>{t("ssFundNoReview")}</p>}
                    {rowNote?.id === screen.id && <p className={`${styles.line} ${styles.warnText}`} data-ss-row-note>{rowNote.text}</p>}

                    {showingDiff && diff && (
                      <div className={styles.diff} data-ss-diff={diff.ok ? "ok" : diff.reason}>
                        {!diff.ok ? (
                          <p className={styles.line} data-ss-nc={diff.reason}>
                            {fill(t(`ssNc_${diff.reason}`), { from: screen.review?.asOf ?? "—", to: asOf || "—" })}
                          </p>
                        ) : (
                          <>
                            <p className={styles.diffHead}>
                              {fill(t("ssDiffHead"), { from: diff.fromAsOf, to: diff.toAsOf })}
                              {/* Same data date: any change is a republication. With no change there is nothing to label. */}
                              {diff.correction && diff.changes.length > 0 && <span className={styles.tagWarn} data-ss-correction>{t("ssCorrectionTag")}</span>}
                            </p>
                            {diff.correction && diff.changes.length > 0 && <p className={`${styles.line} ${styles.warnText}`}>{t("ssCorrection")}</p>}
                            <p className={styles.line} data-ss-diff-summary>
                              {fill(t("ssDiffSummary"), {
                                e: diff.changes.filter((c) => c.group === "entered").length,
                                x: diff.changes.filter((c) => c.group === "exited").length,
                                c: diff.changes.filter((c) => c.group === "coverage").length,
                                u: diff.changes.filter((c) => c.group === "unverified").length,
                                s: diff.stayed,
                              })}
                            </p>
                            <p className={styles.meta}>{fill(t("ssPopulation"), { now: diff.populationNow.toLocaleString(), then: diff.populationThen.toLocaleString() })}</p>
                            {diff.changes.length === 0 && <p className={styles.line} data-ss-no-changes>{t("ssNoChanges")}</p>}
                            {GROUPS.map((group) => {
                              const items = diff.changes.filter((c) => c.group === group);
                              if (!items.length) return null;
                              return (
                                <div key={group} className={styles.group} data-ss-group={group}>
                                  <h4 className={styles.h4}>{t(`ssGrp_${group}`)} ({items.length})</h4>
                                  <ul className={styles.list}>
                                    {items.slice(0, SHOW_PER_GROUP).map((change) => (
                                      <li
                                        key={change.sym}
                                        className={styles.change}
                                        data-ss-change={change.kind} // plain-language-ok: test/automation hook attribute, never rendered; the visible text comes from t()
                                        data-ss-sym={change.sym}
                                      >
                                        <span className={styles.changeHead}>
                                          <b>{change.sym}</b>
                                          <span className={styles.meta}>{changeKindText(change)}</span>
                                          {change.correction && <span className={styles.tagWarn}>{t("ssCorrectionTag")}</span>}
                                        </span>
                                        {change.because.length > 0 && <ul className={styles.leaves}>{change.because.map(leafLine)}</ul>}
                                      </li>
                                    ))}
                                  </ul>
                                  {items.length > SHOW_PER_GROUP && <p className={styles.meta}>{fill(t("ssMore"), { n: items.length - SHOW_PER_GROUP })}</p>}
                                </div>
                              );
                            })}
                          </>
                        )}
                        <form className={styles.saveRow} onSubmit={(e) => explain(screen, e)} data-ss-explain>
                          <input
                            className={`${styles.input} ${styles.inputSm}`}
                            value={explainSym}
                            maxLength={32}
                            placeholder={t("ssExplainPh")}
                            aria-label={t("ssExplainLabel")}
                            onChange={(e) => setExplainSym(e.target.value)}
                            data-ss-explain-input
                          />
                          <button type="submit" className={`chip ${styles.btn}`} data-ss-explain-button>{t("ssExplain")}</button>
                        </form>
                        {explained?.id === screen.id && (
                          <div
                            className={styles.explained}
                            data-ss-explained={explained.status} // plain-language-ok: test/automation hook attribute, never rendered; the visible text comes from t()
                          >
                            <p className={styles.line}>
                              {explained.status === "not_ready" ? t("ssEx_notReady") : fill(t(`ssEx_${explained.status}`), { sym: explained.sym })}
                            </p>
                            {explained.trace.length + explained.fund.length > 0 && (
                              <ul className={styles.leaves}>
                                {explained.trace.map(leafLine)}
                                {explained.fund.map(fundLine)}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {ack && ack.readOnly.length > 0 && (
            <ul className={styles.list} data-ss-readonly-list>
              {ack.readOnly.map((screen) => (
                <li key={screen.id} className={styles.item} data-ss-readonly={screen.id}>
                  <div className={styles.itemHead}>
                    <b className={styles.name}>{screen.name ?? screen.id.slice(0, 8)}</b>
                    <span className={styles.meta}>{t("ssReadOnly")}</span>
                  </div>
                  <div className={styles.actions}>
                    <button type="button" className={`chip ${styles.btn}`} disabled={!canWrite || pendingIds.has(screen.id)} onClick={() => void remove(screen.id, screen.name ?? screen.id.slice(0, 8))} data-ss-delete-readonly>
                      {t("ssDelete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {ack && ack.invalid > 0 && <p className={styles.meta} data-ss-invalid={ack.invalid}>{fill(t("ssInvalid"), { n: ack.invalid })}</p>}

          {snap.status !== "guest" && devicePresets.length > 0 && (
            <div className={styles.presets} data-ss-device-presets>
              <h4 className={styles.h4}>{t("ssDevicePresets")}</h4>
              <ul className={styles.list}>
                {devicePresets.map((preset) => {
                  const compiled = compileFilters(preset.filters, { prefsEnabled, showAllMarkets: false });
                  const inAccount = compiled.ok && screens.some((screen) => screen.hash === compiled.hash);
                  return (
                    <li key={preset.id} className={styles.pendingItem} data-ss-device-preset={preset.name}>
                      <span><b>{preset.name}</b>{compiled.ok && <span className={styles.meta}> — {definitionText(compiled.def)}</span>}</span>
                      {inAccount ? (
                        <span className={styles.tagOn}>{t("ssInAccount")}</span>
                      ) : (
                        <button type="button" className={`chip ${styles.btn}`} disabled={!canWrite || !compiled.ok} onClick={() => void adopt(preset)} data-ss-adopt>
                          {t("ssAddToAccount")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
