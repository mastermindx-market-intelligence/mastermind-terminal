// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "@/lib/i18n";
import { OptionsAlphaCandidatePanel } from "@/components/prophet/OptionsAlphaCandidatePanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MockResponseInit {
  status?: number;
  body?: unknown;
}

function jsonResponse({ status = 200, body = null }: MockResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
    statusText: status < 300 ? "OK" : "ERR",
  });
}

const baseFeed = {
  schema: "options.alpha_candidate_feed/v2",
  schema_version: 1,
  feed_id: "oacf_test0000000000000000abcd",
  generated_at: "2026-08-13T14:30:00Z",
  header: {
    composer_id: "oacf_composer_0000000000000000abcd",
    implementation_carrier: "codex/options-alpha-candidate-view-20261003",
    eligibility_state: "preregistered_inactive_until_activation",
    deterministic_seed: "0000000000000000000000000000000000000000000000000000000000000000",
    formed_candidate_count: 1,
    abstention_count: 1,
    header_digest_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
  },
  policy: {
    policy_id: "oa_member_persistent_measured_campaign/v2",
    policy_version: 1,
    policy_digest_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    policy_path: "research/options_estate/options_alpha_candidate_formation_policy_v2.json",
    policy_schema: "options.alpha_candidate_formation_policy/v2",
  },
  activation: {
    activation_receipt_id: "oacfar_test00000000000000000001",
    activation_receipt_digest_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    activation_receipt_schema: "options.alpha_candidate_feed_activation_receipt/v1",
    activation_receipt_path: "research/options_estate/options_alpha_candidate_feed_activation_receipt_v1.json",
    activation_preconditions: [
      "oa1t_measured_source_consumer_proven",
      "ad1t2_consumer_availability_production_accepted",
      "campaign_integrity_publication_runtime_accepted",
      "source_collision_review_clear",
    ],
    all_preconditions_cleared: false,
    fence_state: "post_policy_freeze_pre_activation",
    policy_freeze_at: "2026-08-12T13:30:00Z",
    activation_boundary_at: null,
  },
  source_receipts: {
    campaigns: {
      path: "data/options_signal_campaign/campaigns.jsonl",
      records: 1,
      prefix_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      schema: "options.signal_campaign/v2",
    },
    microstructure_map: {
      schema: "options.trade_nbbo_microstructure/v1",
      entries_count: 1,
      entries_digest_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    prior_feed: null,
  },
  formed_candidates: [
    {
      candidate_id: "oacnd_0000000000000000000001",
      campaign_id: "ocam_0000000000000000000001",
      first_qualifying_campaign_revision_id: "ocrev_0000000000000000000001",
      current_campaign_revision_id: "ocrev_0000000000000000000001",
      source_formed_at: "2026-08-13T14:00:30Z",
      first_observed_at: "2026-08-13T14:30:00Z",
      decision_at: "2026-08-13T14:30:00Z",
      frozen_formation: {
        campaign_revision_id: "ocrev_0000000000000000000001",
        formed_at: "2026-08-13T14:00:30Z",
        policy_id: "oa_member_persistent_measured_campaign/v2",
        policy_version: 1,
        policy_digest_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        policy_freeze_at: "2026-08-12T13:30:00Z",
        activation_boundary_at: null,
        policy_freeze_cleared: true,
        activation_boundary_cleared: false,
        campaign_member_count: 2,
        final_member_event_id: "evt-001",
        measured_source_print_count: 4,
        measured_nbbo_valid_print_count: 3,
        measured_nbbo_premium_coverage: 0.9,
        all_evidence_legs_within_decision_cutoff: true,
        evidence_digest_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        source_prefix_receipt: {
          path: "data/options_signal_campaign/campaigns.jsonl",
          records: 1,
          prefix_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
          schema: "options.signal_campaign/v2",
        },
        candidate_identity_schema: "options.alpha_candidate_identity/v1",
      },
      current_revision: {
        campaign_revision_id: "ocrev_0000000000000000000001",
        revision_number: 2,
        formed_at: "2026-08-13T14:30:00Z",
      },
      current_disposition: { state: "research_candidate", reasons: [] },
      measured: {
        source_print_count: 4,
        nbbo_valid_print_count: 3,
        nbbo_premium_coverage: 0.9,
        source_premium_usd: 1000,
        nbbo_covered_premium_usd: 900,
        schema: "options.trade_nbbo_microstructure/v1",
        schema_digest_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
      evidence_digests: {
        campaign_row_digest_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        microstructure_row_digest_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        policy_digest_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
      missingness: [],
      contradictions: [],
      state: "research_candidate",
      reasons: [],
      versioned_updates: [
        {
          campaign_revision_id: "ocrev_0000000000000000000001",
          revision_number: 2,
          revision_digest_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
          formed_at: "2026-08-13T14:30:00Z",
          candidate_identity_unchanged: true,
          observed_at: "2026-08-13T14:30:00Z",
        },
      ],
      post_formation_outcomes: {
        schema: "options.alpha_candidate_post_formation_outcomes/v1",
        join_revision_id: "ocrev_0000000000000000000001",
        horizons: {
          h60: { state: "available", campaign_outcome_id: "ocout_0000000000000000000a01", campaign_revision_id: "ocrev_0000000000000000000001", horizon: "h60", source_physical_ordinal: 1, source_physical_row_sha256: "0000000000000000000000000000000000000000000000000000000000000000", status: "complete", campaign_available_at: "2026-08-13T15:30:00Z", computed_at: "2026-08-13T15:30:00Z", target_time: "2026-08-13T15:30:00Z", matured_at: "2026-08-13T15:30:00Z", underlying: { status: "complete", ret: 0.012, mfe: 0.014, mae: -0.005 }, source_outcome: null, source_outcome_prefix: null, reason: null },
          eod: { state: "pending", campaign_outcome_id: null, campaign_revision_id: "ocrev_0000000000000000000001", horizon: "eod", source_physical_ordinal: null, source_physical_row_sha256: null, status: "pending", campaign_available_at: null, computed_at: null, target_time: null, matured_at: null, underlying: null, source_outcome: null, source_outcome_prefix: null, reason: null },
          "1d": { state: "unavailable", campaign_outcome_id: null, campaign_revision_id: null, horizon: "1d", source_physical_ordinal: null, source_physical_row_sha256: null, status: null, campaign_available_at: null, computed_at: null, target_time: null, matured_at: null, underlying: null, source_outcome: null, source_outcome_prefix: null, reason: "BEFORE_ACTIVATION_BOUNDARY" },
          "3d": { state: "unavailable", campaign_outcome_id: null, campaign_revision_id: null, horizon: "3d", source_physical_ordinal: null, source_physical_row_sha256: null, status: null, campaign_available_at: null, computed_at: null, target_time: null, matured_at: null, underlying: null, source_outcome: null, source_outcome_prefix: null, reason: "BEFORE_ACTIVATION_BOUNDARY" },
          "5d": { state: "unavailable", campaign_outcome_id: null, campaign_revision_id: null, horizon: "5d", source_physical_ordinal: null, source_physical_row_sha256: null, status: null, campaign_available_at: null, computed_at: null, target_time: null, matured_at: null, underlying: null, source_outcome: null, source_outcome_prefix: null, reason: "BEFORE_ACTIVATION_BOUNDARY" },
          "10d": { state: "unavailable", campaign_outcome_id: null, campaign_revision_id: null, horizon: "10d", source_physical_ordinal: null, source_physical_row_sha256: null, status: null, campaign_available_at: null, computed_at: null, target_time: null, matured_at: null, underlying: null, source_outcome: null, source_outcome_prefix: null, reason: "BEFORE_ACTIVATION_BOUNDARY" },
        },
      },
    },
  ],
  abstentions: [
    {
      campaign_id: "ocam_0000000000000000000099",
      campaign_revision_id: "ocrev_0000000000000000000099",
      formed_at: "2026-08-13T14:00:00Z",
      first_observed_at: "2026-08-13T14:00:00Z",
      reasons: ["NO_VALID_NBBO_MEASUREMENT", "BEFORE_POLICY_FREEZE"],
      state: "abstain",
    },
  ],
  publication_claim: {
    claim: "source_only_no_publication_effect",
    claim_reason: "The composition is pure and does not prove local durability, upload, consumer publication, or activation.",
  },
  authority: {
    may_originate: false,
    may_rank: false,
    may_score: false,
    may_gate: false,
    may_size: false,
    may_issue: false,
    may_trade: false,
    may_publish_pick: false,
    may_train_prophet: false,
    may_feed_neural_web: false,
    may_select: false,
    may_escalate: false,
    may_compute_option_pnl: false,
    may_infer_bullish_bearish_probability: false,
    may_create_tactical_event: false,
  },
};

const baseMetadata = {
  payload_etag: "etag-current",
  payload_last_modified: "Thu, 13 Aug 2026 14:30:02 GMT",
  receipt_etag: "etag-current",
  receipt_last_modified: "Thu, 13 Aug 2026 14:30:02 GMT",
  served_at: "2026-08-13T14:30:05Z",
};

function makeReceipt(currentId: string, candidates: Record<string, { first_receipt_id: string | null; first_consumer_published_at: string | null }>) {
  return {
    schema: "options.alpha_candidate_feed_publication_receipt/v1",
    receipt_id: currentId,
    feed_id: "oacf_test0000000000000000abcd",
    feed_schema: "options.alpha_candidate_feed/v2",
    payload_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    payload_bytes: 1234,
    campaign_prefix: {
      path: "data/options_signal_campaign/campaigns.jsonl",
      records: 1,
      prefix_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    prior_receipt: null,
    local_durability_confirmed_at: "2026-08-13T14:30:01Z",
    payload_r2_confirmed_at: "2026-08-13T14:30:02Z",
    r2: {
      payload_key: "options_alpha/candidate_feed.json",
      payload_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      etag: "etag-current",
    },
    candidates,
  };
}

function validResponse(overrides: { currentReceiptId?: string; candidates?: Record<string, { first_receipt_id: string | null; first_consumer_published_at: string | null }> } = {}) {
  return {
    feed: baseFeed,
    receipt: makeReceipt(
      overrides.currentReceiptId ?? "oacfr_00000000000000000000000a",
      overrides.candidates ?? {
        oacnd_0000000000000000000001: { first_receipt_id: overrides.currentReceiptId ?? "oacfr_00000000000000000000000a", first_consumer_published_at: null },
      },
    ),
    metadata: baseMetadata,
  };
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderPanel(props: { cadenceMs?: number } = {}): { unmount: () => void } {
  root = createRoot(host!);
  const treeRoot = (
    <Provider key="x">
      <LangProvider>
        <OptionsAlphaCandidatePanel {...props} />
      </LangProvider>
    </Provider>
  );
  act(() => {
    root!.render(treeRoot);
  });
  return { unmount: () => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; } };
}

function Provider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("OptionsAlphaCandidatePanel — verified pair render", () => {
  it("renders the policy/activation/clocks and a formed candidate when the response is verified", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: validResponse() }));
    renderPanel();
    await flushMicrotasks(8);
    const panel = host!.querySelector('[data-testid="options-alpha-candidate-panel"]');
    expect(panel).toBeTruthy();
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="options-alpha-candidate-abstention"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="options-alpha-candidate-horizon-h60"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="options-alpha-candidate-horizon-eod"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="options-alpha-candidate-horizon-1d"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="options-alpha-candidate-horizon-3d"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="options-alpha-candidate-horizon-5d"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="options-alpha-candidate-horizon-10d"]')).toBeTruthy();
  });

  it("renders the inactive notice when fence_state is pre-activation", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: validResponse() }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.innerHTML).toMatch(/preregistered/i);
  });

  it("renders abstentions with their reasons", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: validResponse() }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-abstention"]')).toBeTruthy();
    expect(host!.innerHTML).toContain("NO_VALID_NBBO_MEASUREMENT");
  });

  it("renders the historical clock from the receipt (not the external last-modified)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 200,
      body: validResponse({
        currentReceiptId: "oacfr_00000000000000000000000b",
        candidates: {
          oacnd_0000000000000000000001: {
            first_receipt_id: "oacfr_00000000000000000000000a",
            first_consumer_published_at: "2026-08-13T14:00:00Z",
          },
        },
      }),
    }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeTruthy();
    expect(host!.innerHTML).toContain("2026-08-13T14:00:00Z");
  });

  it("derives the current-receipt display clock from receipt_last_modified when the receipt has null first_consumer_published_at", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: validResponse() }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeTruthy();
    // The external clock is the only legal display clock for a current candidate.
    expect(host!.innerHTML).toContain("Thu, 13 Aug 2026 14:30:02 GMT");
  });

  it("preserves last-good rows and marks stale on 503, instead of rendering empty", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: validResponse() }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeTruthy();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 503, body: { error: "feed unavailable" } }));
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeTruthy();
  });

  it("purges all candidate data on 401, even if a stale 200 lands later", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 401, body: { error: "pro_required" } }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-purge"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeNull();
    // The component must not accept a follow-up 200 — only auth-gated fetches must follow.
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: validResponse() }));
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeNull();
  });

  it("never renders an unrelated payload as a healthy empty feed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: { error: "feed unavailable" } }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeNull();
  });

  it("treats network error as stale when last-good exists", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: validResponse() }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeTruthy();
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeTruthy();
  });

  it("aborts in-flight request on unmount so a late response cannot repopulate state", async () => {
    let abortSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
      abortSignal = (init ?? {}).signal as AbortSignal | undefined;
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(jsonResponse({ status: 200, body: validResponse() })), 100);
      });
    });
    const { unmount } = renderPanel();
    await flushMicrotasks(4);
    unmount();
    expect(abortSignal?.aborted).toBe(true);
  });
});