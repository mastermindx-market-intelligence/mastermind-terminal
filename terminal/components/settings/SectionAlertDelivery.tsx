"use client";
import { useEffect, useRef, useState } from "react";
import { identityOwnerKey, isAccountOwner } from "@/lib/accountIdentity";
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

type FieldErr = { field: string; en: string; zh: string };
type Phase = "idle" | "syncing" | "saved";
type Gate = "loading" | "ready" | "unavailable" | "signedOut";

function ianaZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const list = typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : [];
  const set = new Set(list);
  set.add("UTC");
  set.add("Asia/Shanghai");
  return Array.from(set).sort();
}

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

  const [gate, setGate] = useState<Gate>(guest ? "signedOut" : "loading");
  const [state, setState] = useState<AlertState>(EMPTY);
  const [phase, setPhase] = useState<Phase>("idle");
  const [touched, setTouched] = useState(false);
  const [fieldErr, setFieldErr] = useState<FieldErr | null>(null);
  const [saveFail, setSaveFail] = useState(false);
  const [zones] = useState<string[]>(() => ianaZones());

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qhDraft = useRef<QuietHours>({ start: "", end: "" });
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
    setState(EMPTY);
    setPhase("idle");
    setTouched(false);
    setFieldErr(null);
    setSaveFail(false);
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
        if (res.status === 404 || res.status === 503) { setGate("unavailable"); return; }
        if (!res.ok) { setGate("unavailable"); return; }
        const body = await res.json();
        if (cancelled || !alive.current) return;
        const loaded = stateFromGet(body);
        qhDraft.current = loaded.quiet_hours ?? { start: "", end: "" };
        setState(loaded);
        setGate("ready");
      } catch {
        if (cancelled || !alive.current) return;
        setGate("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [owner]);

  async function post(patch: Record<string, unknown>, snapshot: AlertState) {
    setPhase("syncing");
    setTouched(true);
    setFieldErr(null);
    setSaveFail(false);
    try {
      const res = await fetch("/api/account/alert-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!alive.current) return;
      if (res.status === 401) {
        setGate("signedOut");
        setState(EMPTY);
        return;
      }
      let body: { ok?: boolean; prefs?: Record<string, unknown>; detail?: unknown } | null = null;
      try { body = await res.json(); } catch { body = null; }
      if (res.status === 200 && body?.ok) {
        const prefs = body.prefs && typeof body.prefs === "object" ? body.prefs : {};
        setState((s) => {
          const next = { ...s };
          if (typeof prefs.alert_email_optin === "boolean") next.alert_email_optin = prefs.alert_email_optin;
          if (Array.isArray(prefs.alert_categories)) next.alert_categories = asKnownCats(prefs.alert_categories);
          if (typeof prefs.tz === "string") next.tz = prefs.tz;
          if (prefs.quiet_hours === null) next.quiet_hours = null;
          else if (prefs.quiet_hours !== undefined) next.quiet_hours = asQuiet(prefs.quiet_hours);
          return next;
        });
        setPhase("saved");
        return;
      }
      if (res.status === 400 && body?.detail && typeof body.detail === "object") {
        const d = body.detail as { field?: unknown; en?: unknown; zh?: unknown };
        setState(snapshot);
        if (typeof d.field === "string" && typeof d.en === "string" && typeof d.zh === "string") {
          setFieldErr({ field: d.field, en: d.en, zh: d.zh });
        } else {
          setSaveFail(true);
        }
        setPhase("idle");
        return;
      }
      setState(snapshot);
      setSaveFail(true);
      setPhase("idle");
    } catch {
      if (!alive.current) return;
      setState(snapshot);
      setSaveFail(true);
      setPhase("idle");
    }
  }

  function pickOptin(on: boolean) {
    const snapshot = state;
    setState((s) => ({ ...s, alert_email_optin: on }));
    void post({ alert_email_optin: on }, snapshot);
  }

  function toggleCat(id: KnownCat) {
    const snapshot = state;
    const next = state.alert_categories.includes(id)
      ? state.alert_categories.filter((c) => c !== id)
      : [...state.alert_categories, id];
    setState((s) => ({ ...s, alert_categories: next }));
    void post({ alert_categories: next }, snapshot);
  }

  function pickTz(tz: string) {
    if (!tz) return;
    const snapshot = state;
    setState((s) => ({ ...s, tz }));
    void post({ tz }, snapshot);
  }

  function scheduleQuiet(next: QuietHours | null, patch: Record<string, unknown>, snapshot: AlertState) {
    setState((s) => ({ ...s, quiet_hours: next }));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void post(patch, snapshot);
    }, 500);
  }

  function onQuietPart(part: "start" | "end", value: string) {
    const snapshot = state;
    const next = { ...qhDraft.current, [part]: value };
    qhDraft.current = next;
    setState((s) => ({ ...s, quiet_hours: next }));
    if (!next.start || !next.end) return;
    scheduleQuiet(next, { quiet_hours: next }, snapshot);
  }

  function clearQuiet() {
    const snapshot = state;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    qhDraft.current = { start: "", end: "" };
    setState((s) => ({ ...s, quiet_hours: null }));
    void post({ quiet_hours: "off" }, snapshot);
  }

  const note = (show: boolean) => (
    <DeliveryNote phase={phase === "syncing" ? "syncing" : phase === "saved" ? "saved" : "idle"} guest={false} show={show} t={t} onRetry={() => {}} />
  );
  const fieldMsg = (field: string) => {
    if (!fieldErr || fieldErr.field !== field) return null;
    return <Msg text={lang === "zh" ? fieldErr.zh : fieldErr.en} kind="err" />;
  };
  const failMsg = saveFail ? <Msg text={t("acsAlertSaveFail")} kind="err" /> : null;

  const tzOptions = state.tz && !zones.includes(state.tz) ? [state.tz, ...zones] : zones;

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
            </Row>

            <Row label={t("acsAlertTz")} desc={t("acsAlertTzNote")}>
              <select
                className="acs-in"
                data-alert-field="tz"
                aria-label={t("acsAlertTz")}
                value={state.tz}
                onChange={(e) => pickTz(e.target.value)}
              >
                <option value="">{t("acsAlertTzUnset")}</option>
                {tzOptions.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
              {fieldMsg("tz")}
            </Row>

            <Row label={t("acsAlertQh")} desc={t("acsAlertQhHint")}>
              <div>
                <label>
                  {t("acsAlertQhStart")}
                  <input
                    type="time"
                    className="acs-in"
                    data-alert-field="qh-start"
                    value={state.quiet_hours?.start ?? ""}
                    onChange={(e) => onQuietPart("start", e.target.value)}
                    onInput={(e) => onQuietPart("start", (e.target as HTMLInputElement).value)}
                  />
                </label>
                <label>
                  {t("acsAlertQhEnd")}
                  <input
                    type="time"
                    className="acs-in"
                    data-alert-field="qh-end"
                    value={state.quiet_hours?.end ?? ""}
                    onChange={(e) => onQuietPart("end", e.target.value)}
                    onInput={(e) => onQuietPart("end", (e.target as HTMLInputElement).value)}
                  />
                </label>
                <button type="button" className="acs-mini" onClick={clearQuiet}>
                  {t("acsAlertQhClear")}
                </button>
              </div>
              {fieldMsg("quiet_hours")}
            </Row>
            {note(touched)}
            {failMsg}
          </Group>
        )}
      </div>
    </>
  );
}
