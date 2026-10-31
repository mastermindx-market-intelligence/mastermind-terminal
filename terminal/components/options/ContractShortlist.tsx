"use client";

/**
 * Exact-contract shortlist + side-by-side comparison (E15).
 *
 * Read-only over the Open-interest builds / Hot contracts rows the screener
 * already fetched through `/api/flow` (so entitlement is the route's, and no
 * new feed is introduced). Pinning never touches the screener's source arrays,
 * filters, sort or view; "Show in list" only moves to the originating table
 * the way its own preset chip would, and never edits a filter.
 *
 * Identity, field semantics and mismatch rules live in
 * `lib/optionsContractShortlist.ts`; this file only renders them.
 */

import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import type { OptionsPlanDraft } from "@/lib/optionsPlanDraft";
import { OptionsShortlistPlan } from "./OptionsShortlistPlan";
import {
  SHORTLIST_MAX,
  addPin,
  buildComparison,
  buildPin,
  removePin,
  type CompareCell,
  type CompareFieldId,
  type ContractIdentity,
  type FieldBasis,
  type IdentityRefusal,
  type PinLocation,
  type ShortlistFamily,
  type ShortlistPin,
  type ShortlistSource,
} from "@/lib/optionsContractShortlist";
import type { ScreenerHotView } from "@/lib/optionsScreener";
import { fillShortlistCopy, useShortlistT } from "@/lib/optionsContractShortlistLex";
import styles from "./ContractShortlist.module.css";

type ShortlistT = ReturnType<typeof useShortlistT>;

export interface ContractShortlistController {
  pins: readonly ShortlistPin[];
  flashKey: string | null;
  message: string;
  toggle: (row: unknown, source: ShortlistSource, list: readonly unknown[]) => void;
  remove: (pinKey: string) => void;
  clear: () => void;
  flash: (pinKey: string) => void;
  say: (message: string) => void;
}

const REFUSAL_KEY: Record<IdentityRefusal, string> = {
  root: "e15RefuseRoot",
  right: "e15RefuseRight",
  exp: "e15RefuseExp",
  strike: "e15RefuseStrike",
  terms: "e15RefuseTerms",
  ambiguous: "e15RefuseAmbiguous",
  session: "e15RefuseSession",
  full: "e15RefuseFull",
};

/** Exact, never-collapsing label: every supplied term is printed. */
export function contractLabel(id: ContractIdentity, t: ShortlistT): string {
  const parts = [`${id.root} ${id.exp} ${id.strike} ${t(id.right === "C" ? "e15Call" : "e15Put")}`];
  if (id.terms.multiplier !== null) parts.push(fillShortlistCopy(t("e15TermsSuffix"), { m: id.terms.multiplier }));
  if (id.terms.deliverable !== null) parts.push(id.terms.deliverable);
  if (id.terms.settlement !== null) parts.push(id.terms.settlement);
  if (id.terms.exercise_style !== null) parts.push(id.terms.exercise_style);
  return parts.join(" · ");
}

function listName(family: ShortlistFamily, hotView: ScreenerHotView | null, t: ShortlistT): string {
  if (family === "doi") return t("e15ListDoi");
  return t(hotView === "by_volume" ? "e15ListHotVol" : "e15ListHotPrem");
}

/** Declared snapshot for a screener payload. `stale` is the `/api/flow` failed-refresh flag. */
export function shortlistSource(
  family: ShortlistFamily,
  payload: { asof?: string | null; schema?: string | null } | null | undefined,
  hotView?: ScreenerHotView,
): ShortlistSource {
  const stale = (payload as { stale?: unknown } | null | undefined)?.stale === true;
  return {
    family,
    asof: payload?.asof ?? null,
    schema: payload?.schema ?? null,
    stale,
    hotView: family === "hot" ? (hotView ?? null) : null,
  };
}

const EMPTY_PINS: readonly ShortlistPin[] = [];

/** Session-only shortlist state. Lives beside the screener; never persisted. */
export function useContractShortlist(scopeKey = "session"): ContractShortlistController {
  const t = useShortlistT();
  const [state, setState] = useState({ scopeKey, pins: [] as readonly ShortlistPin[], flashKey: null as string | null, message: "" });
  const pins = state.scopeKey === scopeKey ? state.pins : EMPTY_PINS;
  const flashKey = state.scopeKey === scopeKey ? state.flashKey : null;
  const message = state.scopeKey === scopeKey ? state.message : "";
  const update = useCallback((patch: Partial<Omit<typeof state, "scopeKey">>) => {
    setState(value => ({ ...(value.scopeKey === scopeKey ? value : { scopeKey, pins: EMPTY_PINS, flashKey: null, message: "" }), ...patch }));
  }, [scopeKey]);
  const setPins = useCallback((next: readonly ShortlistPin[]) => update({ pins: next }), [update]);
  const setFlashKey = useCallback((next: string | null) => update({ flashKey: next }), [update]);
  const setMessage = useCallback((next: string) => update({ message: next }), [update]);

  useEffect(() => {
    if (!flashKey) return;
    const id = window.setTimeout(() => setFlashKey(null), 1600);
    return () => window.clearTimeout(id);
  }, [flashKey, setFlashKey]);

  const toggle = useCallback(
    (row: unknown, source: ShortlistSource, list: readonly unknown[]) => {
      const built = buildPin(row, source, list);
      if (!built.ok) {
        setMessage(t(REFUSAL_KEY[built.reason]));
        return;
      }
      const label = contractLabel(built.pin.identity, t);
      if (pins.some((p) => p.pinKey === built.pin.pinKey)) {
        setPins(removePin(pins, built.pin.pinKey));
        setMessage(fillShortlistCopy(t("e15Unpinned"), { c: label }));
        return;
      }
      const next = addPin(pins, built.pin);
      setPins(next.pins);
      setMessage(next.result === "full" ? t("e15RefuseFull") : fillShortlistCopy(t("e15Pinned"), { c: label }));
    },
    [pins, t, setPins, setMessage],
  );

  const remove = useCallback(
    (pinKey: string) => {
      const gone = pins.find((p) => p.pinKey === pinKey);
      if (!gone) return;
      setPins(removePin(pins, pinKey));
      setMessage(fillShortlistCopy(t("e15Unpinned"), { c: contractLabel(gone.identity, t) }));
    },
    [pins, t, setPins, setMessage],
  );

  const clear = useCallback(() => {
    setPins([]);
    setMessage(t("e15Cleared"));
  }, [t, setPins, setMessage]);

  return { pins, flashKey, message, toggle, remove, clear, flash: setFlashKey, say: setMessage };
}

function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M9 3h6l-1 6 3 3v2h-4.2L12 21l-.8-7H7v-2l3-3-1-6Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Pin toggle rendered inside a contract row's first cell. Never triggers the row's own click. */
export function ContractPinButton({
  shortlist,
  row,
  source,
  list,
}: {
  shortlist: ContractShortlistController;
  row: unknown;
  source: ShortlistSource;
  list: readonly unknown[];
}) {
  const t = useShortlistT();
  const built = buildPin(row, source, list);
  if (!built.ok) {
    const why = t(REFUSAL_KEY[built.reason]);
    return (
      <button
        type="button"
        className={styles.pinBtn}
        aria-disabled="true"
        aria-label={why}
        title={why}
        data-contract-pin-refused={built.reason}
        onClick={(e) => {
          e.stopPropagation();
          shortlist.say(why);
        }}
      >
        <PinGlyph />
      </button>
    );
  }
  const { pin } = built;
  const label = contractLabel(pin.identity, t);
  const pinned = shortlist.pins.some((p) => p.pinKey === pin.pinKey);
  const full = !pinned && shortlist.pins.length >= SHORTLIST_MAX;
  const text = full
    ? t("e15RefuseFull")
    : fillShortlistCopy(t(pinned ? "e15UnpinAria" : "e15PinAria"), { c: label });
  return (
    <button
      type="button"
      className={`${styles.pinBtn}${shortlist.flashKey === pin.pinKey ? ` ${styles.flash}` : ""}`}
      aria-pressed={pinned}
      aria-disabled={full ? "true" : undefined}
      aria-label={text}
      title={text}
      data-contract-pin={pin.pinKey}
      onClick={(e) => {
        e.stopPropagation();
        if (full) {
          shortlist.say(t("e15RefuseFull"));
          return;
        }
        shortlist.toggle(row, source, list);
      }}
    >
      <PinGlyph />
    </button>
  );
}

function fmtMoney2(v: number): string {
  return `$${v.toFixed(2)}`;
}

function fmtCompactMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtValue(field: CompareFieldId, value: number | boolean | string, t: ShortlistT): string {
  if (typeof value === "boolean") return t(value ? "e15Yes" : "e15No");
  if (typeof value === "string") return value;
  switch (field) {
    case "mid":
    case "close":
      return fmtMoney2(value);
    case "oi_change":
      return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US")}`;
    case "traded_value":
      return fmtCompactMoney(value);
    default:
      return value.toLocaleString("en-US");
  }
}

function CompareCellView({
  cell,
  field,
  basis,
  t,
}: {
  cell: CompareCell;
  field: CompareFieldId;
  basis: FieldBasis;
  t: ShortlistT;
}) {
  if (cell.state === "value" || cell.state === "missing") {
    const obs = fillShortlistCopy(t(`e15O_${cell.observation}`), { d: cell.session });
    return (
      <td data-cell-state={cell.state} data-observation={cell.observation} data-session={cell.session}>
        {cell.state === "value" ? (
          <span className={styles.val}>{fmtValue(field, cell.value, t)}</span>
        ) : (
          <span className={styles.none}>{t("e15C_missing")}</span>
        )}
        <span className={styles.obs}>{obs}</span>
      </td>
    );
  }
  const none =
    cell.state === "not_in_list"
      ? t("e15C_not_in_list")
      : basis === "contract_term"
        ? t("e15C_no_term")
        : t("e15C_no_quote");
  return (
    <td data-cell-state={cell.state}>
      <span className={styles.none}>{none}</span>
    </td>
  );
}

function ComparePanel({ pins, t }: { pins: readonly ShortlistPin[]; t: ShortlistT }) {
  const cmp = buildComparison(pins);
  const n = cmp.notes;
  const warnings: string[] = [];
  if (n.sessionMismatch) warnings.push(fillShortlistCopy(t("e15NoteSession"), { ds: n.sessions.join(", ") }));
  if (n.listMix) warnings.push(t("e15NoteListMix"));
  if (n.stale) warnings.push(t("e15NoteStale"));
  const info: string[] = [];
  if (n.sameContractTwice.length > 0) info.push(t("e15NoteSameTwice"));
  if (n.termsUnknown) info.push(t("e15NoteTerms"));
  if (n.adjustedRoot) info.push(t("e15NoteAdjusted"));
  return (
    <section className={styles.cmp} aria-label={t("e15CmpTitle")} data-like-for-like={n.likeForLike ? "yes" : "no"}>
      <div className={styles.cmpHd}>
        <span className={styles.cmpTitle}>{t("e15CmpTitle")}</span>
        <span className={styles.cmpNoExec}>{t("e15CmpNoExec")}</span>
      </div>
      {warnings.length > 0 ? (
        <ul className={styles.warn} role="note" data-compare-warnings="">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.ok} role="note">
          {fillShortlistCopy(t("e15NoteLike"), { d: n.sessions[0] ?? "" })}
        </p>
      )}
      {info.length > 0 && (
        <ul className={styles.info} role="note">
          {info.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className={styles.cmpScroll}>
        <table className={styles.cmpTable}>
          <thead>
            <tr>
              <th scope="col">{t("e15Field")}</th>
              {pins.map((p) => (
                <th scope="col" key={p.pinKey} data-pin-col={p.pinKey}>
                  <span className={styles.colLabel}>{contractLabel(p.identity, t)}</span>
                  <span className={styles.colMeta}>{listName(p.family, p.hotView, t)}</span>
                  <span className={styles.colMeta}>{fillShortlistCopy(t("e15Session"), { d: p.session })}</span>
                  {p.sourceStale && (
                    <span className={styles.staleTag} title={t("e15StaleTip")}>
                      {t("e15Stale")}
                    </span>
                  )}
                  {p.identity.adjustedRootHint && <span className={styles.adjTag}>{t("e15AdjustedHint")}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cmp.rows.map((r) => (
              <tr key={r.field} data-field={r.field} data-basis={r.basis}>
                <th scope="row">
                  <span className={styles.fieldName}>{t(`e15F_${r.field}`)}</span>
                  <span className={styles.basis}>{t(`e15B_${r.basis}`)}</span>
                </th>
                {r.cells.map((c, i) => (
                  <CompareCellView key={pins[i].pinKey} cell={c} field={r.field} basis={r.basis} t={t} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Tray above the screener tables. `active` = an exact-contract list is on
 * screen; with no pins and no such list the tray renders nothing, so the
 * other screener views are byte-for-byte unaffected.
 */
export function ContractShortlistTray({
  shortlist,
  active,
  onShowInList,
  scopeKey = "session",
  scopeOwnerKey = "",
  isScopeCurrent,
  onPlanDraftChange,
  onPlanDraftInputChange,
}: {
  shortlist: ContractShortlistController;
  active: boolean;
  onShowInList: (pin: ShortlistPin) => PinLocation;
  scopeKey?: string;
  scopeOwnerKey?: string;
  isScopeCurrent?: () => boolean;
  onPlanDraftChange?: (draft: OptionsPlanDraft) => void;
  onPlanDraftInputChange?: (draft: OptionsPlanDraft | null) => void;
}) {
  const { lang } = useLang();
  const t = useShortlistT();
  const [open, setOpen] = useState(false);
  const [seek, setSeek] = useState<string | null>(null);
  const { pins, flash, say } = shortlist;

  // After "Show in list" moved to the originating table, wait for its row to
  // mount, then bring the pin into view and focus it. Bounded: ~20 frames.
  useEffect(() => {
    if (!seek) return;
    let frame = 0;
    let tries = 0;
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-contract-pin="${CSS.escape(seek)}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", inline: "nearest" });
        el.focus({ preventScroll: true });
        flash(seek);
        setSeek(null);
        return;
      }
      tries += 1;
      if (tries < 20) frame = window.requestAnimationFrame(find);
      else setSeek(null);
    };
    frame = window.requestAnimationFrame(find);
    return () => window.cancelAnimationFrame(frame);
  }, [seek, flash]);

  if (!active && pins.length === 0) return null;

  const showInList = (pin: ShortlistPin) => {
    const where = onShowInList(pin);
    const label = contractLabel(pin.identity, t);
    if (where === "present") {
      say("");
      setSeek(pin.pinKey);
    } else {
      say(fillShortlistCopy(t(where === "hidden_by_filter" ? "e15HiddenByFilter" : "e15NotInList"), { c: label }));
    }
  };

  const canCompare = pins.length >= 2;
  return (
    <div className={styles.tray} data-contract-shortlist="">
      <div className={styles.trayHd}>
        <span className={styles.trayTitle}>{t("e15Title")}</span>
        <span className={styles.trayCount}>
          {fillShortlistCopy(t("e15Count"), { n: pins.length, max: SHORTLIST_MAX })}
        </span>
        <span className={styles.trayActions}>
          <button
            type="button"
            className={`chip${open && canCompare ? " on" : ""} ${styles.trayBtn}`}
            aria-expanded={open && canCompare}
            disabled={!canCompare}
            onClick={() => setOpen((v) => !v)}
          >
            {t(open && canCompare ? "e15HideCompare" : "e15Compare")}
          </button>
          {pins.length > 0 && (
            <button
              type="button"
              className={`chip ${styles.trayBtn}`}
              onClick={() => {
                shortlist.clear();
                setOpen(false);
              }}
            >
              {t("e15Clear")}
            </button>
          )}
        </span>
      </div>
      {pins.length === 0 && <p className={styles.hint}>{t("e15HintEmpty")}</p>}
      {pins.length === 1 && <p className={styles.hint}>{t("e15HintOne")}</p>}
      {pins.length > 0 && (
        <ul className={styles.pins}>
          {pins.map((p) => {
            const label = contractLabel(p.identity, t);
            return (
              <li key={p.pinKey} className={styles.pin} data-pin-key={p.pinKey}>
                <span className={styles.pinText}>
                  <span className={styles.pinLabel}>{label}</span>
                  <span className={styles.pinMeta}>
                    {listName(p.family, p.hotView, t)} · {fillShortlistCopy(t("e15Session"), { d: p.session })}
                    {p.sourceStale ? ` · ${t("e15Stale")}` : ""}
                  </span>
                </span>
                <button type="button" className={`chip ${styles.trayBtn}`} onClick={() => showInList(p)}>
                  {t("e15ShowInList")}
                </button>
                <button
                  type="button"
                  className={`chip ${styles.trayBtn} ${styles.removeBtn}`}
                  aria-label={fillShortlistCopy(t("e15RemoveAria"), { c: label })}
                  title={fillShortlistCopy(t("e15RemoveAria"), { c: label })}
                  onClick={() => shortlist.remove(p.pinKey)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.status} role="status" aria-live="polite">
        {shortlist.message}
      </p>
      <OptionsShortlistPlan pins={pins} scopeKey={scopeKey} scopeOwnerKey={scopeOwnerKey} isScopeCurrent={isScopeCurrent} lang={lang} onDraftChange={onPlanDraftChange} onDraftInputChange={onPlanDraftInputChange} />
      {open && canCompare && <ComparePanel pins={pins} t={t} />}
    </div>
  );
}
