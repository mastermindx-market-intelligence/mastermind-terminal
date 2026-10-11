// @vitest-environment jsdom
/* IntlPolicyComparison.test.tsx — IM10-T3 focused controlled-panel tests,
 * repair r2. Vitest + @testing-library/react (parent repo dependency; NOT
 * installed on this build host — RETURN.md records exactly what was executed).
 * All state flows through the accepted intlPolicyPreviewSession module; the
 * only grammar is a trivial fixture-local draft->owner projection. Engine
 * semantics under test: absolute_change_bp = |signed_end| - |signed_start|,
 * displayed as a signed table delta; the hero shows |absolute_change_bp| as
 * display magnitude with direction prose (no engine math recomputed). */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginPolicyPreview, createPolicyPreviewSession, receivePolicyPreview,
  reviewPolicyDraft, updatePolicyDraft,
  type PolicyPreviewSessionState, type PolicySettings, type QualifiedPreview,
} from "@/lib/intlPolicyPreviewSession";
import { IntlPolicyComparison, type PolicyDraftControl, type IntlPolicyComparisonProps } from "@/components/research/IntlPolicyComparison";

afterEach(cleanup);

const BINDING = { principal_partition: "pp-1", auth_epoch: "ae-1", saved_id: "q-77", saved_revision: 3, source_generation: "sg-1", instrument_mapping_identity: "im-1", qualification_identity: "qf-1" };
const OPTS = [{ value: "US", label: "United States" }, { value: "EA", label: "Euro area" }];
const HZ = [{ value: "1m", label: "Rolling · 1 month" }];
const QUESTION = "Is policy divergence widening?";
const EMPTY: PolicyDraftControl = { comparator: "", mode: "fixed_dates", horizonKey: "1m", startDate: "2026-08-31", endDate: "2026-09-30" };
const FIXED: PolicyDraftControl = { ...EMPTY, comparator: "US" };
const CMP_ERR = "Select an economy to compare.";
type FE = { field: string; message: string }[];

// Fixture-only synthetic projection: raw draft -> validation + localized errors.
function project(d: PolicyDraftControl): { v: PolicyPreviewSessionState["validation"]; fe: FE } {
  if (d.comparator === "") return { v: { ok: false, errors: [{ field: "comparator", code: "comparator_required" }] }, fe: [{ field: "comparator", message: CMP_ERR }] };
  const settings: PolicySettings = { economy_a: "JP", economy_b: d.comparator, lens: "nominal_policy_point_gap", definition: "absolute_gap_change_bp", method_version: "synthetic-v1", period: { mode: "fixed_dates", start: d.startDate, end: d.endDate }, instrument_a_ref: null, instrument_b_ref: null, revision_policy: "latest_vintage" };
  return { v: { ok: true, settings }, fe: [] };
}
const fixedSettings = (): PolicySettings => { const v = project(FIXED).v; return v.ok ? v.settings : (undefined as never); };
const validState = () => updatePolicyDraft(createPolicyPreviewSession(BINDING), project(FIXED).v);
const preview = (result: Omit<QualifiedPreview, "identity"> | { state: "unavailable"; reasons: string[]; missing_refs: string[] }): PolicyPreviewSessionState => {
  const b = beginPolicyPreview(validState());
  return receivePolicyPreview(b.state, b.ticket!, { identity: { binding: BINDING, settings: fixedSettings() }, ...result } as QualifiedPreview);
};
// Canonical fixture: -300 -> -250 ⇒ signed change +50, absolute gap change
// |−250| − |−300| = −50, direction narrowed.
const qualifiedState = (over: Partial<QualifiedPreview> = {}) =>
  preview({ state: "qualified", signed_start_bp: -300, signed_end_bp: -250, signed_change_bp: 50, absolute_change_bp: -50, direction: "narrowed", crosses_zero: false, ...over });
const unavailableState = () => preview({ state: "unavailable", reasons: ["provider_internal_x"], missing_refs: ["a_start", "b_end"] } as never);

function renderAt(state: PolicyPreviewSessionState, extra: Partial<IntlPolicyComparisonProps> = {}) {
  return render(<IntlPolicyComparison state={state} step="setup" locale="en" question={QUESTION}
    focusEconomyLabel="Japan" draft={FIXED} comparatorOptions={OPTS} horizonOptions={HZ} fieldErrors={[]}
    onDraftChange={vi.fn()} onPreview={vi.fn()} onReview={vi.fn()} onBack={vi.fn()} onInspectSource={vi.fn()} {...extra} />);
}

/** Interactive host: edits flow back through updatePolicyDraft synchronously. */
function mountHost() {
  let draft = EMPTY;
  let state = updatePolicyDraft(createPolicyPreviewSession(BINDING), project(draft).v);
  const onDraftChange = vi.fn((patch: Partial<PolicyDraftControl>) => {
    draft = { ...draft, ...patch };
    const p = project(draft);
    state = updatePolicyDraft(state, p.v); // synchronous host invalidation
    utils.rerender(<IntlPolicyComparison {...props(p.fe)} />);
  });
  const onPreview = vi.fn(), onReview = vi.fn(), onBack = vi.fn(), onInspectSource = vi.fn();
  const props = (fe: FE): IntlPolicyComparisonProps => ({ state, step: "setup", locale: "en", question: QUESTION, focusEconomyLabel: "Japan", draft, comparatorOptions: OPTS, horizonOptions: HZ, fieldErrors: fe, onDraftChange, onPreview, onReview, onBack, onInspectSource });
  const utils = render(<IntlPolicyComparison {...props(project(draft).fe)} />);
  return { ...utils, onDraftChange, onPreview, onReview, onBack, onInspectSource, getState: () => state };
}

describe("IntlPolicyComparison (controlled)", () => {
  it("keeps an empty comparator empty; mode-scoped controls", () => {
    mountHost();
    const sel = screen.getByLabelText("Compare with") as HTMLSelectElement;
    expect(sel.value).toBe("");
    expect((screen.getByRole("option", { name: "Select an economy" }) as HTMLOptionElement).selected).toBe(true);
    expect(screen.getByLabelText("Start")).toBeTruthy();   // fixed mode shows dates
    expect(screen.queryByLabelText("Horizon")).toBeNull(); // rolling-only select absent
  });

  it("emits raw intent only — no validation or save side effect", () => {
    const h = mountHost();
    fireEvent.change(screen.getByLabelText("Compare with"), { target: { value: "US" } });
    expect(h.onDraftChange).toHaveBeenCalledTimes(1);
    const arg = h.onDraftChange.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toEqual({ comparator: "US" });
    expect("ok" in arg).toBe(false); // never manufactures ok:true
    expect(h.onPreview).not.toHaveBeenCalled();
    expect(h.onReview).not.toHaveBeenCalled();
  });

  it("associates inline errors, blocks advance, focuses the first invalid input", () => {
    const h = mountHost();
    const sel = screen.getByLabelText("Compare with") as HTMLSelectElement;
    expect(sel.getAttribute("aria-invalid")).toBe("true");
    const errId = sel.getAttribute("aria-describedby");
    expect(document.getElementById(errId!)!.textContent).toBe(CMP_ERR);
    expect(screen.getByRole("alert").textContent).toContain(CMP_ERR);
    expect((screen.getByText("Review changes") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Update preview"));
    expect(h.onPreview).not.toHaveBeenCalled(); // invalid settings cannot advance
    expect(document.activeElement).toBe(sel);   // explicit focus, no native alert
  });

  it("distinguishes a qualified zero from unavailable; no raw provider text", () => {
    renderAt(qualifiedState({ signed_start_bp: 0, signed_end_bp: 0, signed_change_bp: 0, absolute_change_bp: 0, direction: "unchanged_at_endpoints" }));
    expect(screen.getAllByText("0 bp").length).toBeGreaterThan(0); // zero retained
    expect(screen.getByText("unchanged at endpoints")).toBeTruthy();
    expect(screen.queryByText("Preview unavailable")).toBeNull();
    cleanup();
    renderAt(unavailableState());
    expect(screen.getByText("Preview unavailable")).toBeTruthy();
    expect(screen.queryByText("0 bp")).toBeNull();                // unavailable is not zero
    expect(screen.queryByText("provider_internal_x")).toBeNull(); // never raw provider text
    expect(screen.getByText("Additional reason unavailable.")).toBeTruthy();
    const a = screen.getByText("Japan · start"), b = screen.getByText("United States · end");
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // A/B order kept
  });

  it("renders only the current state after a draft edit invalidates the session", () => {
    const h = mountHost();
    fireEvent.change(screen.getByLabelText("Compare with"), { target: { value: "US" } });
    const b = beginPolicyPreview(h.getState());
    h.rerender(<IntlPolicyComparison state={receivePolicyPreview(b.state, b.ticket!, {
      state: "qualified", identity: { binding: BINDING, settings: fixedSettings() },
      signed_start_bp: -300, signed_end_bp: -250, signed_change_bp: 50, absolute_change_bp: -50,
      direction: "narrowed", crosses_zero: false })} step="setup" locale="en" question={QUESTION}
      focusEconomyLabel="Japan" draft={FIXED} comparatorOptions={OPTS} horizonOptions={HZ}
      fieldErrors={[]} onDraftChange={h.onDraftChange} onPreview={h.onPreview}
      onReview={h.onReview} onBack={h.onBack} onInspectSource={h.onInspectSource} />);
    expect(screen.getByText("The nominal policy gap narrowed.")).toBeTruthy();
    expect(screen.getByText("50 bp")).toBeTruthy(); // hero magnitude alone; rows are "+50 bp"/"-50 bp"
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-07-31" } }); // draft stays editable
    expect(screen.queryByText("The nominal policy gap narrowed.")).toBeNull(); // stale preview gone
    expect(screen.queryByText("50 bp")).toBeNull();
    expect(screen.queryByText("Reading eligible observations…")).toBeNull();   // idle, not loading
  });

  it("valid-unavailable review enabled with settings-only callback; absent callbacks disabled", () => {
    const onReview = vi.fn();
    renderAt(unavailableState(), { onReview });
    const btn = screen.getByText("Review changes") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onReview.mock.calls[0].length).toBe(0); // no preview values in payload
    cleanup();
    renderAt(qualifiedState(), { onPreview: undefined, onReview: undefined, onBack: undefined, onInspectSource: undefined });
    for (const n of ["Update preview", "Review changes", "Back to saved research", "Inspect series, dates & source definitions"]) {
      expect((screen.getByText(n) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("renders complete EN and ZH labels; inspect does not mutate supplied state", () => {
    const { unmount } = renderAt(qualifiedState());
    expect(screen.getByText("Set the comparison")).toBeTruthy();
    expect(screen.getByText("The nominal policy gap narrowed.")).toBeTruthy();
    unmount();
    const s = qualifiedState();
    const onInspectSource = vi.fn();
    renderAt(s, { locale: "zh", onInspectSource });
    expect(screen.getByText("设定对比")).toBeTruthy();
    expect(screen.getByText("名义政策差距收窄。")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /绝对差距的变化/ })).getByText("-50 bp")).toBeTruthy(); // ZH keeps the signed engine delta
    expect(screen.queryByText("Set the comparison")).toBeNull();
    fireEvent.click(screen.getByText("检查序列、日期与来源定义"));
    expect(onInspectSource).toHaveBeenCalledTimes(1);
    expect(s.preview?.state).toBe("qualified"); // same frozen reference survives
    expect(Object.isFrozen(s)).toBe(true);
  });

  it("review step shows the exact snapshot, before/after prefixes, and no save control", () => {
    const onBack = vi.fn();
    renderAt(reviewPolicyDraft(qualifiedState()), { step: "review", onBack,
      comparisonBefore: { comparator: "Not selected", period: "Rolling · 1 month", lens: "Not specified" } });
    expect(screen.getByText("Review what will change.")).toBeTruthy();
    expect(screen.getByText(QUESTION)).toBeTruthy();
    expect(screen.getByText("SAVED: Not selected")).toBeTruthy();        // before prefix
    expect(screen.getByText("SAVED: Rolling · 1 month")).toBeTruthy();   // supplied before-label
    expect(screen.getByText("YOUR CHANGE: United States")).toBeTruthy(); // after prefix
    expect(screen.getByText("YOUR CHANGE: 2026-08-31 – 2026-09-30")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull(); // no write control
    expect(screen.queryByText(/bp/)).toBeNull();                        // no finance result in review
    fireEvent.click(screen.getByText("Back to preview · Keep draft"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("hero shows engine magnitude; the absolute-gap row keeps the signed engine delta", () => {
    // widened, no crossing: +100 -> +250 ⇒ signed +150, absolute +150.
    renderAt(qualifiedState({ signed_start_bp: 100, signed_end_bp: 250, signed_change_bp: 150,
      absolute_change_bp: 150, direction: "widened", crosses_zero: false }));
    expect(screen.getByText("The nominal policy gap widened.")).toBeTruthy();
    expect(screen.getByText("150 bp")).toBeTruthy(); // hero display magnitude only
    expect(within(screen.getByRole("row", { name: /Change in absolute gap/ })).getByText("+150 bp")).toBeTruthy();
    cleanup();
    // crossing zero: -10 -> +15 ⇒ signed +25, absolute |15| − |−10| = +5.
    renderAt(qualifiedState({ signed_start_bp: -10, signed_end_bp: 15, signed_change_bp: 25,
      absolute_change_bp: 5, direction: "widened", crosses_zero: true }));
    expect(screen.getByText("5 bp")).toBeTruthy();
    expect(screen.getByText("The signed gap crossed zero between the dates; the sign alone does not describe the move.")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /Change in absolute gap/ })).getByText("+5 bp")).toBeTruthy();
  });

  it("projects owner reason/baseline/currency text; explicit defaults only when absent", () => {
    renderAt(unavailableState(), {
      reasonLabels: { provider_internal_x: "Upstream data is delayed." },
      baselineComparison: { status: "available", statusLabel: "Compared with your saved context",
        description: "The saved comparison remains inspectable." },
      currencyPreference: "EUR" });
    expect(screen.getByText("Upstream data is delayed.")).toBeTruthy();
    expect(screen.queryByText("provider_internal_x")).toBeNull();              // raw code never rendered
    expect(screen.queryByText("Additional reason unavailable.")).toBeNull();   // code was covered by owner label
    expect(screen.getByText("Compared with your saved context")).toBeTruthy();
    expect(screen.getByText("The saved comparison remains inspectable.")).toBeTruthy();
    expect(screen.queryByText("UNAVAILABLE FOR THIS SETUP")).toBeNull();       // no fabricated absence
    expect(screen.getByText("EUR preference unchanged; policy rates stay percentages, not currency-converted.")).toBeTruthy();
    cleanup();
    renderAt(unavailableState()); // nothing supplied -> explicit defaults retained
    expect(screen.getByText("Additional reason unavailable.")).toBeTruthy();
    expect(screen.getByText("UNAVAILABLE FOR THIS SETUP")).toBeTruthy();
    expect(screen.queryByText(/USD preference/)).toBeNull(); // no USD assertion by default
  });

  it("keeps an escape on an empty review snapshot; supplied baseline reaches review", () => {
    renderAt(validState(), { step: "review" }); // review === null: empty/invalidated
    expect(screen.getByText("No review snapshot is available yet.")).toBeTruthy();
    const back = screen.getByRole("button", { name: "Back to preview · Keep draft" }) as HTMLButtonElement;
    expect(back.disabled).toBe(false); // retained action
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    cleanup();
    renderAt(validState(), { step: "review", onBack: undefined });
    expect((screen.getByRole("button", { name: "Back to preview · Keep draft" }) as HTMLButtonElement).disabled).toBe(true); // disabled when callback absent
    cleanup();
    renderAt(reviewPolicyDraft(qualifiedState()), { step: "review",
      baselineComparison: { status: "available", statusLabel: "Compared with your saved context",
        description: "The saved comparison remains inspectable." } });
    expect(screen.getByText("The saved comparison remains inspectable.")).toBeTruthy();
    expect(screen.queryByText("No matching saved baseline — unavailable, not zero changes.")).toBeNull();
  });
});
