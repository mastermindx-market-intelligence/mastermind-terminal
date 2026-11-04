// @vitest-environment jsdom
/* investigationIntlPolicyControls.test.tsx — iw2-intl-policy-host tests.
 * Vitest + @testing-library/react against the ACTUAL mounted source: the
 * reviewed IntlPolicyComparison panel, the accepted intlPolicyPreviewSession
 * coherence module and the supplied investigationIntlPolicy helper. All
 * fixtures are explicit synthetic envelopes around the retained actual
 * comparison payload; no test here certifies real auth, Saved records or
 * production endpoints — the parent verifies ack detail/auth/CAS itself. */
import {StrictMode} from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InvestigationIntlPolicyControls, {
  type InvestigationIntlPolicyControlsProps,
} from "@/components/research/InvestigationIntlPolicyControls";
import { INTL_POLICY_METHOD, validateIntlPolicySettings } from "@/lib/investigationIntlPolicy";
import type { PolicySettings, ReviewSnapshot } from "@/lib/intlPolicyPreviewSession";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BINDING = {
  principal_partition: "pp-1", auth_epoch: "ae-1", saved_id: "q-77", saved_revision: 3,
  source_generation: "im-workspace-generation:0b0ee1bc-c37b-4eb5-9da1-fcbbb0eec2f5",
  instrument_mapping_identity: null, qualification_identity: null,
};
const PIN = { generation: BINDING.source_generation!, fingerprint: "a".repeat(64) };
const QUESTION = "Is the euro area policy gap versus the UK widening?";
const FOCUS = "EZ";
const HORIZON = "6m";

// Retained ACTUAL comparison payload (supplied fixture), wrapped only in a
// synthetic publication envelope, binding and digest.
const ACTUAL_COMPARISON = {
  state: "qualified",
  identity: {
    economy_a: "EZ", economy_b: "GB", lens: "nominal_policy_point_gap",
    definition: "absolute_gap_change_bp", method_version: INTL_POLICY_METHOD,
    period: { mode: "fixed_dates", start: "2026-08-28", end: "2026-09-30" },
    vintage_policy: "latest_vintage",
    identity: { principal_partition: null, saved_id: null, saved_revision: null, source_generation: PIN.generation },
  },
  signed_start_bp: -150, signed_end_bp: -125, signed_change_bp: 25, absolute_change_bp: -25,
  direction: "narrowed", crosses_zero: false,
  evidence_refs: [
    { slot: "a_start", source_reference: "https://data.ecb.europa.eu/data/datasets/FM/FM.D.U2.EUR.4F.KR.DFR.LEV#artifact=b9f67f13748c1581984f9b4d7a35932f9a75c5403273313d44948342e2673cb3", qualification_ref: "intl-policy-endpoint:sha256:e28aa72758d5e20db1963f2bcf5335518e09e1dd19d4e5b5b1e47547aca4c5be", observation_at: "2026-08-28" },
    { slot: "a_end", source_reference: "https://data.ecb.europa.eu/data/datasets/FM/FM.D.U2.EUR.4F.KR.DFR.LEV#artifact=b9f67f13748c1581984f9b4d7a35932f9a75c5403273313d44948342e2673cb3", qualification_ref: "intl-policy-endpoint:sha256:f31e103c1f6f8bb76cde0897549f2b681739d8313afcb750fa5f7d8668580624", observation_at: "2026-09-30" },
    { slot: "b_start", source_reference: "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?CodeVer=new&SeriesCodes=IUDBEDR#receipt=c204b6c7cf9c55f67dda07f68e06fac014d8e2c8c5f41825fcf5a8c3a6fb08ec", qualification_ref: "intl-policy-endpoint:sha256:83beb27fc20c09030a83140d7332c5a154e1d80c4e1c34a8b322b20e518fad76", observation_at: "2026-08-28" },
    { slot: "b_end", source_reference: "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?CodeVer=new&SeriesCodes=IUDBEDR#receipt=c204b6c7cf9c55f67dda07f68e06fac014d8e2c8c5f41825fcf5a8c3a6fb08ec", qualification_ref: "intl-policy-endpoint:sha256:a13698d65784ebc85a1cf4d0814817522775590961e0732d23c9f3a2d0151d37", observation_at: "2026-09-30" },
  ],
};

const envelope = () => ({
  schema: "intl.policy_preview.v1",
  state: "qualified",
  source_generation: PIN.generation,
  artifact_sha256: PIN.fingerprint,
  mapping_identity: "synthetic:actual-response-mapping",
  qualification_identity: "synthetic:actual-response-qualification",
  result: structuredClone(ACTUAL_COMPARISON),
});

type Body = { generation: string; fingerprint: string; settings: PolicySettings };
type FetchInit = {
  method?: string; headers?: Record<string, string>; credentials?: RequestCredentials;
  cache?: RequestCache; signal?: AbortSignal; body?: string;
};
type DeferredCall = { url: string; init: FetchInit; resolve: (v: unknown) => void; reject: (e: unknown) => void };
const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});

function deferredFetch(): { mock: ReturnType<typeof vi.fn>; calls: DeferredCall[] } {
  const calls: DeferredCall[] = [];
  const mock = vi.fn((url: string, init: FetchInit) => new Promise<void>((resolve, reject) => {
    calls.push({ url, init, resolve: resolve as unknown as (v: unknown) => void, reject });
  }));
  return { mock, calls };
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};

type Mount = {
  fetchMock: ReturnType<typeof vi.fn>;
  calls: DeferredCall[];
  onSave: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
  onUnauthenticated: ReturnType<typeof vi.fn>;
  rerender: (over?: Partial<InvestigationIntlPolicyControlsProps>) => void;
  props: InvestigationIntlPolicyControlsProps;
};

function mount(over: Partial<InvestigationIntlPolicyControlsProps> = {}, onSaveImpl?: (review: ReviewSnapshot) => Promise<void> | void, strict=false): Mount {
  const { mock, calls } = deferredFetch();
  vi.stubGlobal("fetch", mock);
  const onSave = vi.fn(onSaveImpl ?? (async () => {}));
  const onCancel = vi.fn();
  const onUnauthenticated = vi.fn();
  const props: InvestigationIntlPolicyControlsProps = {
    binding: BINDING, pin: PIN, question: QUESTION, focusMarket: FOCUS, horizon: HORIZON,
    locale: "en", isCurrent: () => true, onSave, onCancel, onUnauthenticated,
    ...over,
  };
  const view=()=>strict?<StrictMode><InvestigationIntlPolicyControls {...props}/></StrictMode>:<InvestigationIntlPolicyControls {...props}/>;
  const utils = render(view());
  return {
    fetchMock: mock, calls, onSave, onCancel, onUnauthenticated, props,
    rerender: (o: Partial<InvestigationIntlPolicyControlsProps> = {}) => {
      Object.assign(props, o);
      utils.rerender(view());
    },
  };
}

const comparatorSelect = () => screen.getByLabelText("Compare with") as HTMLSelectElement;
const pickComparator = (value: string) => fireEvent.change(comparatorSelect(), { target: { value } });
const expectedSettings = (over: Partial<PolicySettings> = {}): PolicySettings => ({
  economy_a: FOCUS, economy_b: "GB", lens: "nominal_policy_point_gap",
  definition: "absolute_gap_change_bp", method_version: INTL_POLICY_METHOD,
  period: { mode: "owner_horizon", key: HORIZON },
  instrument_a_ref: null, instrument_b_ref: null, revision_policy: "latest_vintage",
  ...over,
});

// The retained ACTUAL comparison is a fixed-dates result; seed the draft with
// exactly that saved window so the reply's intent matches this host's ticket.
const FIXED_SEED: PolicySettings = expectedSettings({
  period: { mode: "fixed_dates", start: "2026-08-28", end: "2026-09-30" },
});

describe("InvestigationIntlPolicyControls (native host)", () => {
  it("starts with an empty comparator, no default pair, no auto fetch, no save control", () => {
    const m = mount();
    expect(comparatorSelect().value).toBe("");
    expect((screen.getByLabelText("Horizon") as HTMLSelectElement).value).toBe(HORIZON);
    // Focus EZ is excluded; the only pair candidate offered is GB.
    expect((screen.getByRole("option", { name: "United Kingdom" }) as HTMLOptionElement).selected).toBe(false);
    expect(screen.queryByRole("option", { name: "Euro area" })).toBeNull();
    expect(m.fetchMock).not.toHaveBeenCalled();
    expect(m.onSave).not.toHaveBeenCalled();
    expect(screen.queryByText("Save settings")).toBeNull(); // explicit review step only
    expect(validateIntlPolicySettings(expectedSettings()).ok).toBe(true); // helper sanity only
  });

  it("projects localized draft feedback and blocks preview; a focus-mismatched seed stays empty", () => {
    const m = mount();
    fireEvent.click(screen.getByText("Fixed dates")); // reachable invalid draft: empty comparator
    expect(screen.getAllByText("Select an economy to compare.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Update preview"));
    expect(m.fetchMock).not.toHaveBeenCalled(); // invalid settings cannot advance
    cleanup();
    // Date feedback projects inline from the mapped validation fields.
    const m2 = mount({ initialSettings: FIXED_SEED });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-13-40" } });
    expect(screen.getAllByText("Enter a date as YYYY-MM-DD.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Update preview"));
    expect(m2.fetchMock).not.toHaveBeenCalled();
    cleanup();
    const seed = { ...expectedSettings(), economy_a: "US" } as PolicySettings; // wrong focus
    mount({ initialSettings: seed });
    expect(comparatorSelect().value).toBe(""); // no pair default from a foreign seed
  });

  it("reviews without a preview and passes the exact settings snapshot to onSave once", () => {
    const m = mount();
    pickComparator("GB");
    fireEvent.click(screen.getByText("Review changes"));
    const save = screen.getByText("Save settings") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(m.onSave).toHaveBeenCalledTimes(1);
    const review = m.onSave.mock.calls[0][0] as ReviewSnapshot;
    expect(review).toEqual({
      binding: { principal_partition: BINDING.principal_partition, auth_epoch: BINDING.auth_epoch, saved_id: BINDING.saved_id, saved_revision: BINDING.saved_revision },
      settings: expectedSettings(),
    });
    expect(m.fetchMock).not.toHaveBeenCalled(); // save is a callback, not a request
  });

  it("previews only explicitly with the exact body and no saved context or Authorization", () => {
    const m = mount();
    pickComparator("GB");
    fireEvent.click(screen.getByText("Update preview"));
    expect(m.calls).toHaveLength(1);
    const { url, init } = m.calls[0];
    expect(url).toBe("/api/investigations/policy-preview");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    const body = JSON.parse(init.body!) as Body;
    expect(Object.keys(body).sort()).toEqual(["fingerprint", "generation", "settings"]);
    expect(body.generation).toBe(PIN.generation);
    expect(body.fingerprint).toBe(PIN.fingerprint);
    expect(body.settings).toEqual(expectedSettings());
    expect(JSON.stringify(body)).not.toContain("saved_id");
    expect(JSON.stringify(body)).not.toContain("principal_partition");
    expect(JSON.stringify(body)).not.toContain("auth_epoch");
    expect(screen.getByText("Reading eligible observations…")).toBeTruthy();
  });

  it("refuses a late response after a raw edit, through A-B-A, and never resurrects it", async () => {
    const m = mount();
    pickComparator("GB");
    fireEvent.click(screen.getByText("Update preview"));
    pickComparator(""); // raw edit invalidates the pending ticket synchronously
    await m.calls[0].resolve(jsonResponse(envelope()));
    await flush();
    expect(screen.queryByText("The nominal policy gap narrowed.")).toBeNull();
    expect(screen.getByText("Set the comparison, then update the preview to read eligible observations.")).toBeTruthy();
    // A-B-A: identical visible settings restored, still no pending ticket, no revival.
    pickComparator("GB");
    await m.calls[0].resolve(jsonResponse(envelope()));
    await flush();
    expect(screen.queryByText("The nominal policy gap narrowed.")).toBeNull();
    expect(m.fetchMock).toHaveBeenCalledTimes(1); // no retry, no second request
  });

  it("adopts the actual returned source identities only onto the current ticket and captures evidence", async () => {
    const m = mount({ initialSettings: FIXED_SEED });
    fireEvent.click(screen.getByText("Update preview"));
    await m.calls[0].resolve(jsonResponse(envelope()));
    await waitFor(() => expect(screen.getByText("The nominal policy gap narrowed.")).toBeTruthy());
    expect(screen.getByText("25 bp")).toBeTruthy(); // engine magnitude, no recomputation
    fireEvent.click(screen.getByText("Inspect series, dates & source definitions"));
    expect(screen.getByText("Captured evidence source references")).toBeTruthy();
    const details = screen.getByText("Captured evidence source references").closest("details");
    const text = details?.textContent ?? "";
    expect(text).toContain("Focus economy · start · Observed 2026-08-28");
    expect(text).toContain("Comparator · end · Observed 2026-09-30");
    expect((text.match(/data\.ecb\.europa\.eu/g) ?? []).length).toBe(2);
    expect((text.match(/bankofengland\.co\.uk/g) ?? []).length).toBe(2);
    expect(text).toContain("intl-policy-endpoint:sha256:e28aa72758d5e20db1963f2bcf5335518e09e1dd19d4e5b5b1e47547aca4c5be");
    expect(text).toContain("intl-policy-endpoint:sha256:a13698d65784ebc85a1cf4d0814817522775590961e0732d23c9f3a2d0151d37");
  });

  it("notifies onUnauthenticated only for the current live session", async () => {
    const m = mount();
    pickComparator("GB");
    fireEvent.click(screen.getByText("Update preview"));
    await m.calls[0].resolve(jsonResponse({}, 401));
    await waitFor(() => expect(m.onUnauthenticated).toHaveBeenCalledTimes(1));
    cleanup();
    // After unmount a late 401 must not reach a dead callback.
    const m2 = mount();
    pickComparator("GB");
    fireEvent.click(screen.getByText("Update preview"));
    const pending = m2.calls[0];
    cleanup();
    await pending.resolve(jsonResponse({}, 401));
    await flush();
    expect(m2.onUnauthenticated).not.toHaveBeenCalled();
    // After a rebind the old session is gone: the same flight cannot notify.
    const m3 = mount();
    pickComparator("GB");
    fireEvent.click(screen.getByText("Update preview"));
    const old = m3.calls[0];
    m3.rerender({ binding: { ...BINDING, auth_epoch: "ae-2" } });
    await old.resolve(jsonResponse({}, 401));
    await flush();
    expect(m3.onUnauthenticated).not.toHaveBeenCalled();
  });

  it("cancel discards only local state and has zero external effects", async () => {
    const m = mount();
    pickComparator("GB");
    fireEvent.click(screen.getByText("Update preview"));
    fireEvent.click(screen.getByText("Back to saved research"));
    expect(m.onCancel).toHaveBeenCalledTimes(1);
    expect(m.onSave).not.toHaveBeenCalled();
    expect(m.onUnauthenticated).not.toHaveBeenCalled();
    expect(m.calls[0].init.signal?.aborted).toBe(true); // owned fetch cancelled
    expect(comparatorSelect().value).toBe(""); // local draft discarded
    await m.calls[0].resolve(jsonResponse(envelope()));
    await flush();
    expect(screen.queryByText("The nominal policy gap narrowed.")).toBeNull();
    expect(m.onSave).not.toHaveBeenCalled();
  });

  it("renders ZH host controls and source disclosure", () => {
    mount({ locale: "zh" });
    fireEvent.change(screen.getByLabelText("对比对象"), { target: { value: "GB" } });
    expect(screen.getByRole("option", { name: "英国" })).toBeTruthy(); // setup step option
    fireEvent.click(screen.getByText("复核更改"));
    expect(screen.getByText("保存设置")).toBeTruthy();
    expect(screen.getByText("此步骤之后由工作区所有者完成保存。")).toBeTruthy();
    expect(screen.getByText("已捕获的来源定义")).toBeTruthy();
    expect(screen.getByText("尚未捕获来源引用。更新预览后才会捕获。")).toBeTruthy();
  });

  it("disabled blocks save; an in-flight save blocks duplicates and all UI access honestly", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const m = mount({ disabled: true });
    pickComparator("GB");
    fireEvent.click(screen.getByText("Review changes"));
    expect(screen.queryByText("Save settings")).toBeNull();
    expect(comparatorSelect().matches(":disabled")).toBe(true);
    expect(m.onSave).not.toHaveBeenCalled();
    expect(m.fetchMock).not.toHaveBeenCalled();
    cleanup();

    const m2 = mount({}, () => gate);
    pickComparator("GB");
    fireEvent.click(screen.getByText("Review changes"));
    const save2 = screen.getByText("Save settings") as HTMLButtonElement;
    fireEvent.click(save2);
    fireEvent.click(save2); // duplicate click before re-render
    expect(m2.onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saving settings…")).toBeTruthy();
    expect(screen.queryByLabelText("Compare with")).toBeNull(); // editing blocked honestly
    expect(screen.queryByText("Save settings")).toBeNull();
    release!();
    await waitFor(() => expect(screen.getByText("Save settings")).toBeTruthy());
    expect(m2.onSave).toHaveBeenCalledTimes(1); // no fake commit while pending
    expect(screen.getByText("Back to preview · Keep draft")).toBeTruthy(); // review step retained
  });

  it("clears captured source evidence on close and on edit", async () => {
    const m = mount({ initialSettings: FIXED_SEED });
    fireEvent.click(screen.getByText("Update preview"));
    await m.calls[0].resolve(jsonResponse(envelope()));
    await waitFor(() => expect(screen.getByText("The nominal policy gap narrowed.")).toBeTruthy());
    fireEvent.click(screen.getByText("Inspect series, dates & source definitions"));
    const detailsEl = document.querySelector("details") as HTMLDetailsElement;
    expect(detailsEl.open).toBe(true); // host opened the disclosure imperatively
    const textOf = () => screen.queryByText("Captured evidence source references")?.closest("details")?.textContent ?? "";
    expect(textOf()).toContain("data.ecb.europa.eu");
    // jsdom dispatches `toggle` asynchronously after an open-state change,
    // exactly like a browser close; flush lets the handler clear the capture.
    detailsEl.open = false;
    await waitFor(()=>expect(screen.getByText("No source references are captured yet. Update the preview to capture them.")).toBeTruthy());
    expect(textOf()).not.toContain("data.ecb.europa.eu");
    // Re-capture on a fresh ticket (distinct engine magnitude proves the
    // second adoption), then edit: evidence clears with the invalidated preview.
    fireEvent.click(screen.getByText("Update preview"));
    const second = envelope() as { result: { absolute_change_bp: number } };
    second.result.absolute_change_bp = 35;
    await m.calls[1].resolve(jsonResponse(second));
    await flush();
    expect(screen.getByText("35 bp")).toBeTruthy(); // second ticket adopted
    expect(textOf()).toContain("data.ecb.europa.eu");
    pickComparator(""); // raw edit
    expect(textOf()).not.toContain("data.ecb.europa.eu");
    expect(screen.queryByText("35 bp")).toBeNull();
  });

  it("shows initial saved settings without preview, save or reopen commands", () => {
    const seed = expectedSettings({
      period: { mode: "fixed_dates", start: "2026-08-28", end: "2026-09-30" },
      instrument_a_ref: "im-a", instrument_b_ref: "im-b", revision_policy: "original_known",
    });
    const m = mount({ initialSettings: seed });
    expect(comparatorSelect().value).toBe("GB");
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("2026-08-28");
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("2026-09-30");
    expect((screen.getByLabelText("Observation window").querySelector('button[aria-pressed="true"]') as HTMLButtonElement).textContent).toBe("Fixed dates");
    expect(m.fetchMock).not.toHaveBeenCalled();
    expect(m.onSave).not.toHaveBeenCalled();
    expect(screen.queryByText("Save settings")).toBeNull();
    // A saved rolling key that differs from the supplied horizon is not seeded.
    cleanup();
    mount({ initialSettings: expectedSettings({ period: { mode: "owner_horizon", key: "3m" } }) });
    expect(comparatorSelect().value).toBe("");
  });

  it("retains saved instrument refs for an unchanged pair and drops the comparator ref on change", () => {
    const seed = expectedSettings({ instrument_a_ref: "im-a", instrument_b_ref: "im-b", revision_policy: "original_known" });
    const m = mount({ initialSettings: seed }, undefined);
    fireEvent.click(screen.getByText("Review changes"));
    fireEvent.click(screen.getByText("Save settings"));
    expect((m.onSave.mock.calls[0][0] as ReviewSnapshot).settings.instrument_a_ref).toBe("im-a");
    expect((m.onSave.mock.calls[0][0] as ReviewSnapshot).settings.instrument_b_ref).toBe("im-b");
    expect((m.onSave.mock.calls[0][0] as ReviewSnapshot).settings.revision_policy).toBe("original_known");
    cleanup();
    // Changed comparator (focus US => both candidates offered): comparator
    // instrument ref dropped, never invented; focus ref and policy retained.
    const seedUS = { ...seed, economy_a: "US" } as PolicySettings;
    const m2 = mount({ focusMarket: "US", initialSettings: seedUS });
    fireEvent.change(comparatorSelect(), { target: { value: "EZ" } });
    fireEvent.click(screen.getByText("Review changes"));
    fireEvent.click(screen.getByText("Save settings"));
    const changed = (m2.onSave.mock.calls[0][0] as ReviewSnapshot).settings;
    expect(changed.economy_b).toBe("EZ");
    expect(changed.instrument_a_ref).toBe("im-a");
    expect(changed.instrument_b_ref).toBeNull();
    expect(changed.revision_policy).toBe("original_known");
  });

  it("honors the isCurrent fence for preview, review and save", () => {
    const m = mount({ isCurrent: () => false });
    pickComparator("GB");
    fireEvent.click(screen.getByText("Update preview"));
    expect(m.fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Review changes"));
    expect(screen.queryByText("Save settings")).toBeNull(); // review never advanced
    expect(m.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Back to saved research"));
    expect(m.onCancel).not.toHaveBeenCalled();
  });

  it("settles a transport failure on the still-pending ticket with the fixed reason", async () => {
    const m = mount();
    pickComparator("GB");
    fireEvent.click(screen.getByText("Update preview"));
    await m.calls[0].resolve(jsonResponse("not-json", 200)); // unusable body
    await waitFor(() => expect(screen.getByText("Preview unavailable")).toBeTruthy());
    expect(screen.getByText("The preview response was not usable.")).toBeTruthy();
    expect(screen.queryByText(/not-json/)).toBeNull();
  });
});

// Parent controls cover actual production-mode lifecycle and HTTP semantics.
it("parent: survives the StrictMode setup-cleanup-setup cycle",async()=>{
 const m=mount({initialSettings:FIXED_SEED},undefined,true);fireEvent.click(screen.getByText("Update preview"));expect(m.calls).toHaveLength(1);await m.calls[0].resolve(jsonResponse(envelope()));await waitFor(()=>expect(screen.getByText("The nominal policy gap narrowed.")).toBeTruthy());
});
it("parent: a non-200 qualified-looking body cannot become evidence",async()=>{
 const m=mount({initialSettings:FIXED_SEED});fireEvent.click(screen.getByText("Update preview"));await m.calls[0].resolve(jsonResponse(envelope(),503));await flush();expect(screen.queryByText("The nominal policy gap narrowed.")).toBeNull();expect(screen.getByText("Preview unavailable")).toBeTruthy();
});
it("parent: disabled existing revision cannot edit, preview, review or cancel",()=>{
 const m=mount({initialSettings:FIXED_SEED,disabled:true});fireEvent.click(screen.getByText("Update preview"));expect(m.calls).toHaveLength(0);fireEvent.click(screen.getByText("Review changes"));expect(screen.queryByText("Save settings")).toBeNull();fireEvent.click(screen.getByText("Back to saved research"));expect(m.onCancel).not.toHaveBeenCalled();
});

it("parent: competing preview clicks retain one original pending ticket",()=>{
 const m=mount({initialSettings:FIXED_SEED});const button=screen.getByText("Update preview");act(()=>{button.click();button.click();});expect(m.calls).toHaveLength(1);
});
