"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { identityOwnerKey, isAccountOwner } from "@/lib/accountIdentity";
import { canonicalTimeZone, curatedTimeZones, timeZoneLabel } from "@/lib/plainLabels";
import { DeliveryNote, Group, IconCheck, Msg, Row, SectionHead } from "./icons";
import type { SectionProps } from "./types";

// Alert delivery — Terminal settings surface over GET/POST /api/account/alert-prefs.
// Every save goes through that BFF. This file does not import useMarketPrefs or
// accountPrefs and never calls auth.updateUser().

const KNOWN_CATS = ["holdings_material_change", "thesis_window"] as const;
type KnownCat = (typeof KNOWN_CATS)[number];
const CAT_KEY: Record<KnownCat, string> = {
  holdings_material_change: "acsAlertCatHold",
  thesis_window: "acsAlertCatThes",
};

// The four keys this section writes. A save is scoped to the keys in its own
// request: it reports on those rows and, if it fails, rolls back only those.
const FIELDS = ["alert_email_optin", "alert_categories", "tz", "quiet_hours"] as const;
type FieldKey = (typeof FIELDS)[number];

function isFieldKey(v: string): v is FieldKey {
  return (FIELDS as readonly string[]).includes(v);
}

type QuietHours = { start: string; end: string };
type AlertState = {
  alert_email_optin: boolean | null;
  alert_categories: KnownCat[];
  tz: string;
  quiet_hours: QuietHours | null;
};

const EMPTY: AlertState = {
  alert_email_optin: null,
  alert_categories: [],
  tz: "",
  quiet_hours: null,
};

type FieldErr = { field: FieldKey; en: string; zh: string };
type Phase = "idle" | "syncing" | "saved";
type Gate = "loading" | "ready" | "unavailable" | "loadFail" | "signedOut";

// Per-row save state. `show` on DeliveryNote is per-row by its own documented
// contract (icons.tsx): a control the user has not touched says nothing.
type RowState = { phase: Phase; touched: boolean; failed: boolean };
type Rows = Record<FieldKey, RowState>;
const IDLE_ROW: RowState = { phase: "idle", touched: false, failed: false };
const IDLE_ROWS: Rows = {
  alert_email_optin: IDLE_ROW,
  alert_categories: IDLE_ROW,
  tz: IDLE_ROW,
  quiet_hours: IDLE_ROW,
};

// A native <input type="time"> paints the device's own clock format: "--:-- --"
// when it is empty, and "10:00 PM" for a stored "22:00" wherever the device is
// set to a 12-hour clock — machine text in the first case, an English meridiem
// token on the Chinese surface in the second. While the half is NOT being
// edited, plain text covers the control: the stored 24-hour value when there is
// one, "Not set" / "未设置" when there is not. Focusing to type reveals the
// native control unchanged, which is the one moment the device's own format is
// the right answer (the reader is using their own keyboard and clock). These
// live here rather than in app/settings.css because that sheet is pinned by
// another packet's evidence lock (b-f12-5-account-polish).
const TIME_SLOT: CSSProperties = { position: "relative", display: "block" };
const TIME_COVER: CSSProperties = {
  position: "absolute",
  inset: 1,
  display: "flex",
  alignItems: "center",
  padding: "0 11px",
  borderRadius: 8,
  background: "var(--inset)",
  fontSize: "13.5px",
  fontFamily: "var(--font-ui)",
  pointerEvents: "none",
};
const TIME_VALUE: CSSProperties = { ...TIME_COVER, color: "var(--text)" };
const TIME_EMPTY: CSSProperties = { ...TIME_COVER, color: "var(--text-2)" };

function asKnownCats(raw: unknown): KnownCat[] {
  if (!Array.isArray(raw)) return [];
  const out: KnownCat[] = [];
  for (const v of raw) {
    if (v === "holdings_material_change" || v === "thesis_window") {
      if (!out.includes(v)) out.push(v);
    }
  }
  return out;
}

function asQuiet(raw: unknown): QuietHours | null {
  if (!raw || typeof raw !== "object") return null;
  const start = (raw as { start?: unknown }).start;
  const end = (raw as { end?: unknown }).end;
  if (typeof start !== "string" || typeof end !== "string") return null;
  return { start, end };
}

/** The last-known-good value of exactly the keys a save is about to write. */
function snapshotOf(s: AlertState, keys: readonly FieldKey[]): Partial<AlertState> {
  const out: Partial<AlertState> = {};
  for (const k of keys) {
    if (k === "alert_email_optin") out.alert_email_optin = s.alert_email_optin;
    else if (k === "alert_categories") out.alert_categories = s.alert_categories;
    else if (k === "tz") out.tz = s.tz;
    else out.quiet_hours = s.quiet_hours;
  }
  return out;
}

function stateFromGet(body: {
  prefs?: Record<string, unknown>;
  unset?: unknown;
}): AlertState {
  const prefs = body.prefs && typeof body.prefs === "object" ? body.prefs : {};
  const unset = new Set(Array.isArray(body.unset) ? body.unset.filter((v): v is string => typeof v === "string") : []);
  const next: AlertState = { ...EMPTY };
  if (!unset.has("alert_email_optin") && typeof prefs.alert_email_optin === "boolean") {
    next.alert_email_optin = prefs.alert_email_optin;
  }
  if (!unset.has("alert_categories")) next.alert_categories = asKnownCats(prefs.alert_categories);
  if (!unset.has("tz") && typeof prefs.tz === "string") next.tz = prefs.tz;
  if (!unset.has("quiet_hours")) next.quiet_hours = asQuiet(prefs.quiet_hours);
  return next;
}

function Chip({
  on, label, onClick, cat,
}: { on: boolean; label: string; onClick: () => void; cat: string }) {
  return (
    <button
      type="button"
      className="acs-pchip"
      aria-pressed={on}
      data-alert-cat={cat}
      onClick={onClick}
    >
      <span className="box"><IconCheck /></span>
      {label}
    </button>
  );
}

export default function SectionAlertDelivery({ t, lang, identity, onClose }: SectionProps) {
  const owner = identityOwnerKey(identity);
  const guest = !isAccountOwner(owner);
  const htmlLang = lang === "zh" ? "zh-CN" : "en";

  const [gate, setGate] = useState<Gate>(guest ? "signedOut" : "loading");
  const [state, setState] = useState<AlertState>(EMPTY);
  const [rows, setRows] = useState<Rows>(IDLE_ROWS);
  const [fieldErr, setFieldErr] = useState<FieldErr | null>(null);
  const [qhFocus, setQhFocus] = useState<"start" | "end" | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One counter per field. A save takes the counter's next number for each key
  // it writes; when its response lands, a key whose counter has since moved on
  // belongs to an overtaken request. Such a response never rolls a control back,
  // never paints a status and never leaves a note — the newer save owns the
  // field, and the account holds what that newer save stored.
  const seq = useRef<Record<FieldKey, number>>({
    alert_email_optin: 0,
    alert_categories: 0,
    tz: 0,
    quiet_hours: 0,
  });
  const qhDraft = useRef<QuietHours>({ start: "", end: "" });
  // The quiet-hours last-known-good is captured when an editing session opens,
  // not on each keystroke, so a debounced pair of edits rolls back to the value
  // that was stored before the session — never to a half-typed intermediate.
  const qhSnap = useRef<Partial<AlertState> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const renderedFor = useRef(owner);
  if (renderedFor.current !== owner) {
    renderedFor.current = owner;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    qhDraft.current = { start: "", end: "" };
    qhSnap.current = null;
    setState(EMPTY);
    setRows(IDLE_ROWS);
    setFieldErr(null);
    setGate(!isAccountOwner(owner) ? "signedOut" : "loading");
  }

  useEffect(() => {
    if (!isAccountOwner(owner)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/account/alert-prefs");
        if (cancelled || !alive.current) return;
        if (res.status === 401) { setGate("signedOut"); return; }
        // 404/503 is the spec's "not deployed yet" case: calm and terminal.
        if (res.status === 404 || res.status === 503) { setGate("unavailable"); return; }
        // Anything else that failed (502 from an auth outage, a 500) is a
        // moment, not a missing feature — say so instead.
        if (!res.ok) { setGate("loadFail"); return; }
        const body = await res.json();
        if (cancelled || !alive.current) return;
        const loaded = stateFromGet(body);
        qhDraft.current = loaded.quiet_hours ?? { start: "", end: "" };
        qhSnap.current = null;
        setState(loaded);
        setGate("ready");
      } catch {
        if (cancelled || !alive.current) return;
        setGate("loadFail");
      }
    })();
    return () => { cancelled = true; };
  }, [owner]);

  function markRows(keys: readonly FieldKey[], patch: Partial<RowState>) {
    setRows((r) => {
      const next = { ...r };
      for (const k of keys) next[k] = { ...next[k], ...patch };
      return next;
    });
  }

  /** Restore only the keys this save was writing, leaving every other field —
   *  including one another save already stored — exactly as it stands. */
  function rollback(keys: readonly FieldKey[], snap: Partial<AlertState>) {
    if (keys.includes("quiet_hours")) {
      qhDraft.current = snap.quiet_hours ?? { start: "", end: "" };
    }
    setState((s) => {
      const next = { ...s };
      for (const k of keys) {
        if (k === "alert_email_optin") next.alert_email_optin = snap.alert_email_optin ?? null;
        else if (k === "alert_categories") next.alert_categories = snap.alert_categories ?? [];
        else if (k === "tz") next.tz = snap.tz ?? "";
        else next.quiet_hours = snap.quiet_hours ?? null;
      }
      return next;
    });
  }

  async function post(patch: Partial<Record<FieldKey, unknown>>, snap: Partial<AlertState>) {
    const keys = (Object.keys(patch) as FieldKey[]).filter(isFieldKey);
    if (keys.includes("quiet_hours")) qhSnap.current = null;
    const mine: Partial<Record<FieldKey, number>> = {};
    for (const k of keys) {
      seq.current[k] += 1;
      mine[k] = seq.current[k];
    }
    /** True once a later save for any of these keys has been fired. */
    const overtaken = () => keys.some((k) => seq.current[k] !== mine[k]);
    markRows(keys, { phase: "syncing", touched: true, failed: false });
    setFieldErr(null);
    try {
      const res = await fetch("/api/account/alert-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!alive.current) return;
      if (res.status === 401) {
        qhDraft.current = { start: "", end: "" };
        qhSnap.current = null;
        setGate("signedOut");
        setState(EMPTY);
        setRows(IDLE_ROWS);
        return;
      }
      // A 401 is about the session, not about this field, so it is handled
      // above whatever else has happened since. Everything below repaints a
      // control the reader may have changed again; an overtaken save says
      // nothing at all.
      if (overtaken()) return;
      let body: { ok?: boolean; prefs?: Record<string, unknown>; detail?: unknown } | null = null;
      try { body = await res.json(); } catch { body = null; }
      if (overtaken()) return;
      if (res.status === 200 && body?.ok) {
        const prefs = body.prefs && typeof body.prefs === "object" ? body.prefs : {};
        let quiet: QuietHours | null | undefined;
        if (prefs.quiet_hours === null) quiet = null;
        else if (prefs.quiet_hours !== undefined) quiet = asQuiet(prefs.quiet_hours);
        // The draft follows the value the server actually stored, so the next
        // partial edit builds on the stored window and not on a stale draft.
        if (quiet !== undefined) qhDraft.current = quiet ?? { start: "", end: "" };
        setState((s) => {
          const next = { ...s };
          if (typeof prefs.alert_email_optin === "boolean") next.alert_email_optin = prefs.alert_email_optin;
          if (Array.isArray(prefs.alert_categories)) next.alert_categories = asKnownCats(prefs.alert_categories);
          if (typeof prefs.tz === "string") next.tz = prefs.tz;
          if (quiet !== undefined) next.quiet_hours = quiet;
          return next;
        });
        markRows(keys, { phase: "saved", failed: false });
        return;
      }
      if (res.status === 400 && body?.detail && typeof body.detail === "object") {
        const d = body.detail as { field?: unknown; en?: unknown; zh?: unknown };
        rollback(keys, snap);
        if (typeof d.field === "string" && isFieldKey(d.field) && typeof d.en === "string" && typeof d.zh === "string") {
          setFieldErr({ field: d.field, en: d.en, zh: d.zh });
          markRows(keys, { phase: "idle", failed: false });
        } else {
          // A 400 about a field this section does not render still has to say
          // something — a control that reverts in silence is not an answer.
          markRows(keys, { phase: "idle", failed: true });
        }
        return;
      }
      rollback(keys, snap);
      markRows(keys, { phase: "idle", failed: true });
    } catch {
      if (!alive.current || overtaken()) return;
      rollback(keys, snap);
      markRows(keys, { phase: "idle", failed: true });
    }
  }

  function pickOptin(on: boolean) {
    const snap = snapshotOf(state, ["alert_email_optin"]);
    setState((s) => ({ ...s, alert_email_optin: on }));
    void post({ alert_email_optin: on }, snap);
  }

  function toggleCat(id: KnownCat) {
    const snap = snapshotOf(state, ["alert_categories"]);
    const next = state.alert_categories.includes(id)
      ? state.alert_categories.filter((c) => c !== id)
      : [...state.alert_categories, id];
    setState((s) => ({ ...s, alert_categories: next }));
    void post({ alert_categories: next }, snap);
  }

  function pickTz(tz: string) {
    if (!tz) return;
    const snap = snapshotOf(state, ["tz"]);
    setState((s) => ({ ...s, tz }));
    void post({ tz }, snap);
  }

  function onQuietPart(part: "start" | "end", value: string) {
    if (!qhSnap.current) qhSnap.current = snapshotOf(state, ["quiet_hours"]);
    const snap = qhSnap.current;
    const next = { ...qhDraft.current, [part]: value };
    qhDraft.current = next;
    setState((s) => ({ ...s, quiet_hours: next }));
    if (!next.start || !next.end) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void post({ quiet_hours: next }, snap);
    }, 500);
  }

  function clearQuiet() {
    const snap = qhSnap.current ?? snapshotOf(state, ["quiet_hours"]);
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    qhDraft.current = { start: "", end: "" };
    setState((s) => ({ ...s, quiet_hours: null }));
    void post({ quiet_hours: "off" }, snap);
  }

  const rowNote = (field: FieldKey) => (
    <>
      <DeliveryNote phase={rows[field].phase} guest={false} show={rows[field].touched} t={t} onRetry={() => {}} />
      {rows[field].failed ? <Msg text={t("acsAlertSaveFail")} kind="err" /> : null}
    </>
  );
  const fieldMsg = (field: FieldKey) => {
    if (!fieldErr || fieldErr.field !== field) return null;
    return <Msg text={lang === "zh" ? fieldErr.zh : fieldErr.en} kind="err" />;
  };

  // The picker offers the curated list and nothing else, so no option can be an
  // identifier. A stored zone that is an older IANA spelling of a curated one
  // (Asia/Calcutta for Asia/Kolkata, Etc/UTC for UTC) shows as its curated twin
  // — one option per place, and the one the account holds is the one selected.
  // The stored value is left exactly as macro has it until the reader picks
  // something; nothing here rewrites the account. Only a zone that is neither
  // curated nor an alias of one gets an extra option, labelled in words, so the
  // setting is neither lost nor rendered raw.
  const tzShown = state.tz ? canonicalTimeZone(state.tz) : "";
  const tzOptions = useMemo(() => {
    const now = new Date();
    const curated = curatedTimeZones(lang);
    const shown = state.tz ? canonicalTimeZone(state.tz) : "";
    const list = shown && !curated.includes(shown) ? [shown, ...curated] : curated;
    return list.map((z) => ({ value: z, label: timeZoneLabel(z, lang, now) }));
  }, [lang, state.tz]);

  // A window with one half filled is not a window the server can hold. The row
  // says so rather than showing a value that quietly differs from the stored one.
  const qhStart = state.quiet_hours?.start ?? "";
  const qhEnd = state.quiet_hours?.end ?? "";
  const qhPartial = (qhStart === "") !== (qhEnd === "");

  return (
    <>
      <SectionHead title={t("acsAlertDelivery")} sub={t("acsAlertDeliverySub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        {gate === "signedOut" && (
          <div className="acs-sync off">
            <span className="dot" />
            <span className="acs-sync-main">
              <span className="acs-sync-s">{t("acsSignInToOn")}</span>
            </span>
          </div>
        )}
        {gate === "unavailable" && (
          <p className="acs-row-desc" data-alert-state="unavailable">{t("acsAlertUnavailable")}</p>
        )}
        {gate === "loadFail" && (
          <p className="acs-row-desc" data-alert-state="load-failed">{t("acsAlertLoadFail")}</p>
        )}
        {gate === "ready" && (
          <Group title={t("acsAlertDelivery")}>
            <Row label={t("acsAlertEmail")} desc={t("acsAlertEmailNote")}>
              <span className="acs-seg" role="group" aria-label={t("acsAlertEmail")}>
                <button
                  type="button"
                  className={`acs-seg-b${state.alert_email_optin === true ? " active" : ""}`}
                  aria-pressed={state.alert_email_optin === true}
                  data-alert-field="optin-on"
                  onClick={() => pickOptin(true)}
                >{t("acsAlertOn")}</button>
                <button
                  type="button"
                  className={`acs-seg-b${state.alert_email_optin === false ? " active" : ""}`}
                  aria-pressed={state.alert_email_optin === false}
                  data-alert-field="optin-off"
                  onClick={() => pickOptin(false)}
                >{t("acsAlertOff")}</button>
              </span>
              {fieldMsg("alert_email_optin")}
              {rowNote("alert_email_optin")}
            </Row>

            <Row label={t("acsAlertCats")}>
              <div className="acs-pchips" role="group" aria-label={t("acsAlertCats")}>
                {KNOWN_CATS.map((id) => (
                  <Chip
                    key={id}
                    cat={id}
                    on={state.alert_categories.includes(id)}
                    label={t(CAT_KEY[id])}
                    onClick={() => toggleCat(id)}
                  />
                ))}
              </div>
              {fieldMsg("alert_categories")}
              {rowNote("alert_categories")}
            </Row>

            <Row label={t("acsAlertTz")} desc={t("acsAlertTzNote")}>
              <select
                className="acs-in"
                data-alert-field="tz"
                aria-label={t("acsAlertTz")}
                value={tzShown}
                onChange={(e) => pickTz(e.target.value)}
              >
                {/* The "nothing chosen yet" line is a disclosure, not a choice:
                    once a zone is set there is no way to unset it (macro has no
                    clear path for tz), so the option goes rather than sitting
                    there refusing in silence. */}
                {state.tz ? null : <option value="">{t("acsAlertTzUnset")}</option>}
                {tzOptions.map((z) => (
                  <option key={z.value} value={z.value}>{z.label}</option>
                ))}
              </select>
              {fieldMsg("tz")}
              {rowNote("tz")}
            </Row>

            <Row label={t("acsAlertQh")} desc={t("acsAlertQhHint")}>
              <div>
                <p className="acs-row-desc" data-alert-hint="clock">{t("acsAlertQhClock")}</p>
                <label>
                  {t("acsAlertQhStart")}
                  <span style={TIME_SLOT}>
                    <input
                      type="time"
                      lang={htmlLang}
                      className="acs-in"
                      data-alert-field="qh-start"
                      value={qhStart}
                      onFocus={() => setQhFocus("start")}
                      onBlur={() => setQhFocus(null)}
                      onChange={(e) => onQuietPart("start", e.target.value)}
                      onInput={(e) => onQuietPart("start", (e.target as HTMLInputElement).value)}
                    />
                    {qhFocus === "start" ? null : (
                      <span
                        style={qhStart ? TIME_VALUE : TIME_EMPTY}
                        data-alert-time="qh-start"
                        data-alert-empty={qhStart ? undefined : "qh-start"}
                      >{qhStart || t("acsAlertQhNotSet")}</span>
                    )}
                  </span>
                </label>
                <label>
                  {t("acsAlertQhEnd")}
                  <span style={TIME_SLOT}>
                    <input
                      type="time"
                      lang={htmlLang}
                      className="acs-in"
                      data-alert-field="qh-end"
                      value={qhEnd}
                      onFocus={() => setQhFocus("end")}
                      onBlur={() => setQhFocus(null)}
                      onChange={(e) => onQuietPart("end", e.target.value)}
                      onInput={(e) => onQuietPart("end", (e.target as HTMLInputElement).value)}
                    />
                    {qhFocus === "end" ? null : (
                      <span
                        style={qhEnd ? TIME_VALUE : TIME_EMPTY}
                        data-alert-time="qh-end"
                        data-alert-empty={qhEnd ? undefined : "qh-end"}
                      >{qhEnd || t("acsAlertQhNotSet")}</span>
                    )}
                  </span>
                </label>
                <button type="button" className="acs-mini" onClick={clearQuiet}>
                  {t("acsAlertQhClear")}
                </button>
              </div>
              {qhPartial ? <Msg text={t("acsAlertQhPartial")} kind="wait" /> : null}
              {fieldMsg("quiet_hours")}
              {rowNote("quiet_hours")}
            </Row>
          </Group>
        )}
      </div>
    </>
  );
}
