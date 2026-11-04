"use client";
// InvestigationIntlPolicyControls.tsx — iw2-intl-policy-host (run
// iw2-intl-policy-host-20261104-r1). Controlled NATIVE composition host around
// the reviewed IntlPolicyComparison panel and the accepted
// intlPolicyPreviewSession coherence module. No second state machine, counter,
// cache, ID allocation, storage, auth owner or engine arithmetic lives here:
// draft/pending/preview/review coherence, settings validation and
// qualified-source identity adoption flow exclusively through the existing
// reviewed modules. The parent performs the real Workspace save (CAS, ack
// detail, auth) behind onSave; isCurrent is a synchronous before/after fence,
// never a grant. Same-component prop A-B-A rebinds are isolated by keying the
// internal Session child on the full
// binding/pin/initialSettings/focus/horizon/question identity, so a stale
// response cannot survive a rebind before any effect. Hook cleanup cancels
// only the owned fetch and this component's liveness; it never mutates an
// external worker or controller.
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import {
  beginPolicyPreview,
  createPolicyPreviewSession,
  receivePolicyPreview,
  receivePublishedPolicyPreview,
  reviewPolicyDraft,
  updatePolicyDraft,
  type PolicyPreviewSessionState,
  type PolicySettings,
  type PolicyValidation,
  type PreviewBinding,
  type PreviewTicket,
  type ReviewSnapshot,
} from "@/lib/intlPolicyPreviewSession";
import { INTL_POLICY_METHOD, validateIntlPolicySettings } from "@/lib/investigationIntlPolicy";
import {
  IntlPolicyComparison,
  type LabeledOption,
  type PolicyDraftControl,
  type ProjectedFieldError,
} from "./IntlPolicyComparison";

export type InvestigationIntlPolicyControlsProps = {
  binding: PreviewBinding;
  pin: { generation: string; fingerprint: string };
  question: string;
  focusMarket: string;
  horizon: string;
  initialSettings?: PolicySettings;
  locale: "en" | "zh";
  disabled?: boolean;
  isCurrent: () => boolean;
  onSave: (review: ReviewSnapshot) => Promise<void> | void;
  onCancel?: () => void;
  onUnauthenticated?: () => void;
};

const PREVIEW_PATH = "/api/investigations/policy-preview";

// Supported pair candidates only (INTL_POLICY_METHOD economies, focus
// excluded). These are draft choices, never qualified or admitted coverage.
const COMPARATOR_CANDIDATES: readonly { value: string; en: string; zh: string }[] = [
  { value: "EZ", en: "Euro area", zh: "欧元区" },
  { value: "GB", en: "United Kingdom", zh: "英国" },
];

// [en, zh]; CJK never receives allcaps or letter tracking.
const L = {
  saveBtn: ["Save settings", "保存设置"],
  saving: ["Saving settings…", "正在保存设置…"],
  blocked: ["The workspace owner is completing the save; editing, preview and review are paused.", "工作区所有者正在完成保存；编辑、预览与复核已暂停。"],
  saveNote: ["Saving is completed by the workspace owner after this step.", "此步骤之后由工作区所有者完成保存。"],
  sourceSummary: ["Captured source definitions", "已捕获的来源定义"],
  sourceTitle: ["Captured evidence source references", "已捕获的证据来源引用"],
  sourceEmpty: ["No source references are captured yet. Update the preview to capture them.", "尚未捕获来源引用。更新预览后才会捕获。"],
  sourceObs: ["Observed", "观测日期"],
  sourceRef: ["Source reference", "来源引用"],
  sourceQual: ["Qualification reference", "资质引用"],
  lensBefore: ["Nominal policy settings", "名义政策设定"],
} as const;

type LKey = keyof typeof L;

// Exact owner-localized messages for the validation codes this host can
// produce; unknown codes keep an honest generic message (no code grammar).
const ERROR_MESSAGES: Record<string, readonly [string, string]> = {
  invalid_shape: ["The saved comparison settings could not be read. Adjust the draft.", "无法读取已保存的对比设置。请调整草稿。"],
  invalid_focus: ["The focus economy is not a valid comparison focus.", "焦点经济体不是有效的对比焦点。"],
  missing_comparator: ["Select an economy to compare.", "请选择用于对比的经济体。"],
  same_economy: ["The comparison economy must differ from the focus economy.", "对比经济体必须不同于焦点经济体。"],
  unsupported_method: ["Only the nominal policy point gap lens is supported.", "仅支持名义政策点差距视角。"],
  unsupported_revision_policy: ["The revision policy is not supported.", "该版本策略不受支持。"],
  invalid_instrument_reference: ["The retained instrument reference is not usable and was dropped from the draft.", "保留的工具引用不可用，已从草稿中清除。"],
  invalid_horizon: ["Select a horizon.", "请选择期限。"],
  invalid_date: ["Enter a date as YYYY-MM-DD.", "日期需为 YYYY-MM-DD 格式。"],
  date_order: ["The end date must be after the start date.", "结束日期必须晚于开始日期。"],
  invalid_period: ["Choose a rolling horizon or fixed dates.", "请选择滚动窗口或固定日期。"],
  malformed_owner_validation: ["This draft is not usable yet.", "此草稿暂不可用。"],
};

const FALLBACK_MESSAGE: readonly [string, string] = ["This setting is not usable yet.", "该设置暂不可用。"];

// Panel-known fields get inline association; unknown fields stay in the
// panel's summary list only.
const FIELD_MAP: Record<string, string> = {
  economy_b: "comparator",
  period_mode: "period_mode",
  period_key: "period_key",
  period_start: "period_start",
  period_end: "period_end",
  economy_a: "economy_a",
  lens: "lens",
  revision_policy: "revision_policy",
  instrument_a_ref: "instrument_a_ref",
  instrument_b_ref: "instrument_b_ref",
  settings: "settings",
  validation: "validation",
};

const SLOT_LABELS: Record<string, readonly [string, string]> = {
  a_start: ["Focus economy · start", "焦点经济体 · 开始"],
  a_end: ["Focus economy · end", "焦点经济体 · 结束"],
  b_start: ["Comparator · start", "对比经济体 · 开始"],
  b_end: ["Comparator · end", "对比经济体 · 结束"],
};

// Read-only source evidence captured from an exact qualified reply.
type SourceEvidenceRef = {
  slot: string;
  source_reference: string;
  qualification_ref: string;
  observation_at: string;
};

const EMPTY_DRAFT = (horizon: string): PolicyDraftControl => ({
  comparator: "",
  mode: "owner_horizon",
  horizonKey: horizon,
  startDate: "",
  endDate: "",
});

// Deterministic JSON so the Session key is stable across renders.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sessionIdentityKey(props: InvestigationIntlPolicyControlsProps): string {
  return stableJson([
    props.binding,
    props.pin,
    props.initialSettings ?? null,
    props.focusMarket,
    props.horizon,
    props.question,
  ]);
}

type HostModel = { draft: PolicyDraftControl; session: PolicyPreviewSessionState; saved: PolicySettings | null };

// Rebuilds the exact PolicySettings from the raw draft. Retained saved
// instrument references / revision policy survive ONLY while the saved pair is
// unchanged; a changed comparator drops the comparator instrument reference
// and never invents a receipt.
function buildSettings(draft: PolicyDraftControl, focusMarket: string, saved: PolicySettings | null): PolicySettings {
  return {
    economy_a: focusMarket,
    economy_b: draft.comparator,
    lens: "nominal_policy_point_gap",
    definition: "absolute_gap_change_bp",
    method_version: INTL_POLICY_METHOD,
    period: draft.mode === "owner_horizon"
      ? { mode: "owner_horizon", key: draft.horizonKey }
      : { mode: "fixed_dates", start: draft.startDate, end: draft.endDate },
    instrument_a_ref: saved ? saved.instrument_a_ref : null,
    instrument_b_ref: saved && saved.economy_b === draft.comparator ? saved.instrument_b_ref : null,
    revision_policy: saved ? saved.revision_policy : "latest_vintage",
  };
}

// Initial model: the saved settings seed the draft only when they validate,
// carry this focus and (for a rolling window) use exactly the supplied
// horizon; otherwise the comparator stays empty — no pair default is ever
// applied. No preview, fetch or save runs at mount.
function initialModel(props: InvestigationIntlPolicyControlsProps): HostModel {
  const base = createPolicyPreviewSession(props.binding);
  const empty: HostModel = { draft: EMPTY_DRAFT(props.horizon), session: base, saved: null };
  const raw = props.initialSettings;
  if (!raw) return empty;
  const checked = validateIntlPolicySettings(raw);
  if (!checked.ok || checked.settings.economy_a !== props.focusMarket) return empty;
  const saved = checked.settings;
  if (saved.period.mode === "owner_horizon" && saved.period.key !== props.horizon) return empty;
  const draft: PolicyDraftControl = saved.period.mode === "fixed_dates"
    ? { comparator: saved.economy_b, mode: "fixed_dates", horizonKey: props.horizon, startDate: saved.period.start, endDate: saved.period.end }
    : { comparator: saved.economy_b, mode: "owner_horizon", horizonKey: saved.period.key, startDate: "", endDate: "" };
  const rebuilt = validateIntlPolicySettings(buildSettings(draft, props.focusMarket, saved));
  return {
    draft,
    session: rebuilt.ok ? updatePolicyDraft(base, rebuilt) : base,
    saved,
  };
}

// Plain-JSON view of the reply's evidence_refs, captured only when the exact
// reply really installed qualified state. Values stay verbatim strings.
function extractEvidence(raw: unknown): SourceEvidenceRef[] {
  if (raw === null || typeof raw !== "object") return [];
  const result = (raw as Record<string, unknown>).result;
  if (result === null || typeof result !== "object") return [];
  const refs = (result as Record<string, unknown>).evidence_refs;
  if (!Array.isArray(refs)) return [];
  const out: SourceEvidenceRef[] = [];
  for (const ref of refs) {
    if (ref === null || typeof ref !== "object") return [];
    const r = ref as Record<string, unknown>;
    if (typeof r.slot !== "string" || typeof r.source_reference !== "string" ||
      typeof r.qualification_ref !== "string" || typeof r.observation_at !== "string") return [];
    out.push({
      slot: r.slot,
      source_reference: r.source_reference,
      qualification_ref: r.qualification_ref,
      observation_at: r.observation_at,
    });
  }
  return out;
}

export function InvestigationIntlPolicyControls(props: InvestigationIntlPolicyControlsProps) {
  // Rebind isolation: any change to the binding, pin, saved seed, focus,
  // horizon or question remounts the Session child, discarding every internal
  // state and in-flight response atomically before any effect can run.
  return <Session key={sessionIdentityKey(props)} {...props} />;
}

function Session(props: InvestigationIntlPolicyControlsProps) {
  const { binding, pin, question, focusMarket, horizon, locale, disabled, isCurrent, onSave, onCancel, onUnauthenticated } = props;
  const zh = locale === "zh";
  const t = (k: LKey): string => L[k][zh ? 1 : 0];

  const [model] = useState<HostModel>(()=>initialModel(props));
  const [draft, setDraft] = useState<PolicyDraftControl>(model.draft);
  const [state, setState] = useState<PolicyPreviewSessionState>(model.session);
  const saved = model.saved;
  const [step, setStep] = useState<"setup" | "review">("setup");
  const [saving, setSaving] = useState(false);
  const [evidence, setEvidence] = useState<SourceEvidenceRef[]>([]);
  // Uncontrolled native disclosure: the browser owns the open state; React
  // only opens it imperatively and reacts to real close events.
  const sourceRef = useRef<HTMLDetailsElement | null>(null);

  // Synchronous mirrors so event handlers invalidate before React rerenders.
  const stateRef = useRef(state);
  const draftRef = useRef(draft);
  const aliveRef = useRef(true);
  const savingRef = useRef(false);
  const flightRef = useRef<{ ticket: PreviewTicket; controller: AbortController } | null>(null);

  // Owned cleanup: cancel the owned fetch and invalidate this component only.
  useEffect(() => {
    aliveRef.current=true;
    return () => {
      aliveRef.current = false;
      flightRef.current?.controller.abort();
      flightRef.current = null;
    };
  }, []);

  const commit = (next: PolicyPreviewSessionState) => {
    stateRef.current = next;
    setState(next);
  };

  const cancelFlight = () => {
    const flight = flightRef.current;
    flightRef.current = null;
    flight?.controller.abort(); // owned controller only
  };

  const applyDraft = (patch: Partial<PolicyDraftControl>) => {
    if (disabled || savingRef.current || !isCurrent()) return;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    cancelFlight();
    setDraft(next);
    commit(updatePolicyDraft(stateRef.current, validateIntlPolicySettings(buildSettings(next, focusMarket, saved))));
    setEvidence([]); // edit clears captured source evidence
  };

  const runPreview = () => {
    if (disabled || savingRef.current || stateRef.current.pending!==null || !aliveRef.current || !isCurrent()) return;
    const begun = beginPolicyPreview(stateRef.current);
    if (begun.ticket === null) return;
    const controller = new AbortController();
    const flight = { ticket: begun.ticket, controller };
    flightRef.current = flight;
    commit(begun.state);
    void (async () => {
      const ticket = flight.ticket;
      if (!isCurrent() || !aliveRef.current) return; // fence before fetch
      try {
        const response = await fetch(PREVIEW_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            generation: pin.generation,
            fingerprint: pin.fingerprint,
            settings: ticket.settings,
          }),
        });
        if (controller.signal.aborted || !aliveRef.current) return;
        if (response.status === 401) {
          // Only the current live session may notify; the parent ends the
          // native private view (never an SDK signout from here).
          if (flightRef.current === flight) flightRef.current = null;
          if (aliveRef.current && isCurrent()) onUnauthenticated?.();
          return;
        }
        if (!isCurrent() || !aliveRef.current) return; // fence after await
        if(response.status!==200){
          if(flightRef.current===flight)flightRef.current=null;
          settle(ticket,null);
          return;
        }
        let raw: unknown = null;
        try {
          raw = await response.json();
        } catch {
          raw = null; // unusable body settles below
        }
        if (!aliveRef.current) return;
        if (flightRef.current === flight) flightRef.current = null;
        settle(ticket, raw);
      } catch {
        // Owned cancellation: nothing to settle; the session already moved on.
        if (controller.signal.aborted || !aliveRef.current) return;
        if (flightRef.current === flight) flightRef.current = null;
        settle(ticket, null); // transport error -> fixed reason, captured identity
      }
    })();
  };

  // Settles only the still-pending original ticket; the reviewed helpers
  // enforce every identity/sequence guard before anything is adopted.
  const settle = (ticket: PreviewTicket, raw: unknown) => {
    if (!aliveRef.current || !isCurrent()) return;
    const current = stateRef.current;
    if (current.pending === null || current.pending.session_sequence !== ticket.session_sequence) return;
    const next = raw === null
      ? receivePolicyPreview(current, ticket, {
        state: "unavailable",
        identity: { binding: ticket.binding, settings: ticket.settings },
        reasons: ["invalid_preview_response"],
        missing_refs: [],
      })
      : receivePublishedPolicyPreview(current, ticket, pin, raw);
    if (next === current) return;
    commit(next);
    if (next.preview?.state === "qualified") setEvidence(extractEvidence(raw));
  };

  const runReview = () => {
    if (disabled || savingRef.current || !isCurrent()) return;
    const next = reviewPolicyDraft(stateRef.current);
    if (next.review !== null) {
      commit(next);
      setStep("review");
    }
  };

  const backToSetup = () => {
    if (disabled || savingRef.current || !isCurrent()) return;
    setStep("setup"); // keeps the draft and preview; review snapshot retained
  };

  // Back/Cancel discards only local draft/preview state; no save, revert or
  // restore effect ever runs here.
  const cancelHost = () => {
    if (disabled || savingRef.current || !isCurrent()) return;
    cancelFlight();
    draftRef.current = EMPTY_DRAFT(horizon);
    setEvidence([]);
    if (sourceRef.current) sourceRef.current.open = false;
    setStep("setup");
    commit(createPolicyPreviewSession(binding));
    setDraft(draftRef.current);
    onCancel?.();
  };

  // Explicit native-host Save: review snapshot only, once per settlement.
  // No POST, RPC, ID allocation or persistence happens in this component and
  // no commit is claimed from callback completion.
  const runSave = () => {
    if (savingRef.current || disabled || !aliveRef.current || !isCurrent()) return;
    const review = stateRef.current.review;
    if (review === null) return;
    cancelFlight();
    savingRef.current = true;
    setSaving(true);
    try {
      const outcome = onSave(review);
      if (outcome && typeof (outcome as Promise<void>).then === "function") {
        void (outcome as Promise<void>).then(
          () => {
            if (!aliveRef.current) return;
            savingRef.current = false;
            setSaving(false);
          },
          () => {
            // Unknown outcome: the parent owns recovery; only the click
            // guard is released, no state is closed or committed.
            if (!aliveRef.current) return;
            savingRef.current = false;
            setSaving(false);
          },
        );
      } else {
        savingRef.current = false;
        setSaving(false);
      }
    } catch {
      savingRef.current = false;
      if (aliveRef.current) setSaving(false);
    }
  };

  // Only a real close clears the captured evidence; opening keeps it.
  const handleSourceToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) setEvidence([]);
  };

  const openSource = () => {
    const details = sourceRef.current;
    if (details && !details.open) details.open = true;
  };

  const economyLabel = (code: string): string => {
    const found = COMPARATOR_CANDIDATES.find((c) => c.value === code);
    return found ? (zh ? found.zh : found.en) : code;
  };

  const comparatorOptions: readonly LabeledOption[] = useMemo(
    () => COMPARATOR_CANDIDATES.filter((c) => c.value !== focusMarket)
      .map((c) => ({ value: c.value, label: zh ? c.zh : c.en })),
    [focusMarket, zh],
  );
  const horizonOptions: readonly LabeledOption[] = useMemo(
    () => [{ value: horizon, label: zh ? `滚动 · ${horizon}` : `Rolling · ${horizon}` }],
    [horizon, zh],
  );

  const fieldErrors: readonly ProjectedFieldError[] = useMemo(() => {
    const validation: PolicyValidation = state.validation;
    if (validation.ok) return [];
    return validation.errors.map((e) => ({
      field: Object.hasOwn(FIELD_MAP, e.field) ? FIELD_MAP[e.field] : e.field,
      message: (Object.hasOwn(ERROR_MESSAGES, e.code) ? ERROR_MESSAGES[e.code] : FALLBACK_MESSAGE)[zh ? 1 : 0],
    }));
  }, [state.validation, zh]);

  const comparisonBefore = useMemo(() => {
    if (!saved) return undefined;
    return {
      comparator: economyLabel(saved.economy_b),
      period: saved.period.mode === "fixed_dates"
        ? `${saved.period.start} – ${saved.period.end}`
        : saved.period.key,
      lens: t("lensBefore"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, zh]);

  if (saving) {
    // A parent save is in flight: block preview/edit/review/save access
    // honestly and let the parent's own recovery path decide what is next.
    return (
      <section>
        <div role="status">
          <p>{t("saving")}</p>
          <p>{t("blocked")}</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <fieldset disabled={disabled} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <IntlPolicyComparison
        state={state}
        step={step}
        locale={locale}
        question={question}
        focusEconomyLabel={economyLabel(focusMarket)}
        draft={draft}
        comparatorOptions={comparatorOptions}
        horizonOptions={horizonOptions}
        fieldErrors={fieldErrors}
        comparisonBefore={comparisonBefore}
        dataTheme="dark"
        onDraftChange={applyDraft}
        onPreview={runPreview}
        onReview={runReview}
        onBack={step === "review" ? backToSetup : cancelHost}
        onInspectSource={openSource}
      />
      {step === "review" && state.review !== null ? (
        <div>
          <button type="button" onClick={runSave} disabled={disabled}>
            {t("saveBtn")}
          </button>
          <p>{t("saveNote")}</p>
        </div>
      ) : null}
      </fieldset>
      <details ref={sourceRef} onToggle={handleSourceToggle}>
        <summary>{t("sourceSummary")}</summary>
        {evidence.length === 0 ? (
          <p>{t("sourceEmpty")}</p>
        ) : (
          <div>
            <p>{t("sourceTitle")}</p>
            {evidence.map((ref, index) => (
              <p key={`${ref.slot}:${index}`}>
                {(Object.hasOwn(SLOT_LABELS, ref.slot) ? SLOT_LABELS[ref.slot][zh ? 1 : 0] : ref.slot)} · {t("sourceObs")} {ref.observation_at}
                <br />
                {t("sourceRef")} {ref.source_reference}
                <br />
                {t("sourceQual")} {ref.qualification_ref}
              </p>
            ))}
          </div>
        )}
      </details>
    </section>
  );
}

export default InvestigationIntlPolicyControls;
