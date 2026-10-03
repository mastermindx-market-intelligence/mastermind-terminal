// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { LangProvider } from "@/lib/i18n";
import { OptionsAlphaCandidatePanel } from "@/components/prophet/OptionsAlphaCandidatePanel";
import feedSchema from "@/contracts/options/options.alpha_candidate_feed.v2.schema.json";
import candidateFeedJson from "@/lib/__tests__/fixtures/candidate_feed.json";
import candidateReceiptJson from "@/lib/__tests__/fixtures/candidate_feed.receipt.json";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MockResponseInit {
  status?: number;
  body?: unknown;
  lastModified?: string;
}

function jsonResponse({ status = 200, body = null, lastModified }: MockResponseInit): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (lastModified) headers["last-modified"] = lastModified;
  return new Response(JSON.stringify(body), { status, headers, statusText: status < 300 ? "OK" : "ERR" });
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
      // Canonical Macro enrichment copies campaign_context for the first qualifying revision.
      // Same shape the running validator compiles from options.alpha_candidate_feed/v2.
      campaign_context: {
        schema: "options.alpha_candidate_campaign_context/v1",
        campaign_revision_id: "ocrev_0000000000000000000001",
        group: {
          session_date: "2026-08-13",
          ticker: "SPY",
          right: "C",
          expiration: "2026-08-15",
          strike: 450,
          strike_key: "450",
        },
        flow_side_counts: { "~buy": 2, "~sell": 1, mixed: 1 },
        intent: { opening_closing: "unavailable", direction_reliability: "soft", accumulation_distribution: "unavailable" },
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

function validResponse(overrides: { currentReceiptId?: string; candidates?: Record<string, { first_receipt_id: string | null; first_consumer_published_at: string | null }>; feed?: typeof baseFeed } = {}) {
  const currentId = overrides.currentReceiptId ?? "oacfr_00000000000000000000000a";
  return {
    feed: overrides.feed ?? baseFeed,
    receipt: makeReceipt(
      currentId,
      overrides.candidates ?? {
        oacnd_0000000000000000000001: { first_receipt_id: currentId, first_consumer_published_at: null },
      },
    ),
    metadata: baseMetadata,
  };
}

type JsonRecord = Record<string, unknown>;

function schemaValidSyntheticContext(revisionId: string) {
  return {
    schema: "options.alpha_candidate_campaign_context/v1",
    campaign_revision_id: revisionId,
    group: {
      session_date: "2026-08-13",
      ticker: "SPY",
      right: "C",
      expiration: "2026-08-15",
      strike: 450,
      strike_key: "450",
    },
    flow_side_counts: { "~buy": 2, "~sell": 1, mixed: 1 },
    intent: { opening_closing: "unavailable", direction_reliability: "soft", accumulation_distribution: "unavailable" },
  };
}

function schemaValidSyntheticResponse(contextRevision?: string) {
  const feed = structuredClone(candidateFeedJson) as JsonRecord;
  const formed = (feed.formed_candidates as JsonRecord[])[0];
  const firstRevision = String(formed.first_qualifying_campaign_revision_id);
  formed.campaign_context = schemaValidSyntheticContext(contextRevision ?? firstRevision);
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  expect(ajv.compile(feedSchema)(feed)).toBe(true);
  return {
    feed,
    receipt: structuredClone(candidateReceiptJson),
    metadata: {
      payload_etag: "synthetic-test-only",
      payload_last_modified: "Thu, 13 Aug 2026 14:30:02 GMT",
      receipt_etag: "synthetic-test-only",
      receipt_last_modified: "Thu, 13 Aug 2026 14:30:02 GMT",
      served_at: "2026-08-13T14:30:05Z",
    },
  };
}

function fixtureFeedWithoutContext() {
  const feed = structuredClone(candidateFeedJson) as JsonRecord;
  for (const candidate of feed.formed_candidates as JsonRecord[]) delete candidate.campaign_context;
  return {
    feed,
    receipt: structuredClone(candidateReceiptJson),
    metadata: {
      payload_etag: "synthetic-test-only",
      payload_last_modified: "Thu, 13 Aug 2026 14:30:02 GMT",
      receipt_etag: "synthetic-test-only",
      receipt_last_modified: "Thu, 13 Aug 2026 14:30:02 GMT",
      served_at: "2026-08-13T14:30:05Z",
    },
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
  return {
    unmount: () => {
      if (root) act(() => root!.unmount());
      root = null;
      host?.remove();
      host = null;
    },
  };
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

  it("renders the current-first-consumer clock with a real time element when external last-modified is present", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: validResponse() }));
    renderPanel();
    await flushMicrotasks(8);
    const clocks = Array.from(host!.querySelectorAll("time[dateTime]"));
    // At least one of the clock time elements must carry a real ISO dateTime — the
    // current receipt clock derived from last-modified. No element may carry a
    // localized "Not published" inside its dateTime attribute.
    const firstConsumerClocks = Array.from(host!.querySelectorAll('[data-testid="options-alpha-candidate-item"] time[dateTime]'));
    expect(firstConsumerClocks.length).toBeGreaterThan(0);
    for (const el of firstConsumerClocks) {
      const dt = (el as HTMLTimeElement).getAttribute("dateTime") ?? "";
      expect(dt).not.toMatch(/Not published|未发布/);
    }
  });

  it("preserves last-good rows and marks stale on 503, after the 60s cadence triggers a second fetch", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: validResponse() }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeTruthy();
    // Queue the 503 BEFORE advancing — the second poll must resolve into the panel's
    // stale state without unmounting.
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 503, body: { error: "feed unavailable" } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await flushMicrotasks(8);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="options-alpha-candidate-stale"]')).toBeTruthy();
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

  it("purges a rendered 200 after the 60s cadence next poll returns 403", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: validResponse() }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeTruthy();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 403, body: { error: "pro_required" } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await flushMicrotasks(8);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeNull();
    expect(host!.querySelector('[data-testid="options-alpha-candidate-purge"]')).toBeTruthy();
  });

  it("treats a network error on the 60s poll as stale when last-good exists", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: validResponse() }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeTruthy();
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await flushMicrotasks(8);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeTruthy();
  });

  it("never renders an unrelated payload as a healthy empty feed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: { error: "feed unavailable" } }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeNull();
    expect(host!.querySelectorAll('[data-testid="options-alpha-candidate-unavailable"]')).toHaveLength(1);
    expect(host!.textContent?.match(
      /Candidate evidence is currently unavailable\. The desk continues to show last verified rows below until the next refresh succeeds\./g,
    )).toHaveLength(1);
  });

  it("does not fetch a second time while the first fetch is still in flight", async () => {
    vi.useFakeTimers();
    let firstDeferred: ((value: Response) => void) | null = null;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      firstDeferred = resolve;
    }));
    renderPanel();
    await flushMicrotasks(2);
    // The cadence timer fires while the first request is still pending — the inflight
    // guard must prevent a second fetch. If the guard regressed, fetchMock would be
    // called again here.
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    await flushMicrotasks(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    firstDeferred!(jsonResponse({ status: 200, body: validResponse() }));
    await flushMicrotasks(8);
  });

  it("aborts in-flight request on unmount so a late response cannot repopulate state", async () => {
    let abortSignal: AbortSignal | undefined;
    let deferred: ((value: Response) => void) | null = null;
    fetchMock.mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
      abortSignal = (init ?? {}).signal as AbortSignal | undefined;
      return new Promise<Response>((resolve) => {
        deferred = resolve;
      });
    });
    const capturedHost = host;
    const { unmount } = renderPanel();
    await flushMicrotasks(4);
    unmount();
    // After unmount, resolve the deferred — React must NOT setState because the
    // component is gone (no late state warning, no rendered items reappearing).
    expect(abortSignal?.aborted).toBe(true);
    await act(async () => {
      deferred?.(jsonResponse({ status: 200, body: validResponse() }));
      await Promise.resolve();
    });
    expect(capturedHost!.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeNull();
  });
});

describe("OptionsAlphaCandidatePanel — campaign context rendering", () => {
  it("renders a schema-valid synthetic fixture bound to the checked-in feed first revision", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: schemaValidSyntheticResponse() }));
    renderPanel();
    await flushMicrotasks(8);
    const ctx = host!.querySelector('[data-testid="options-alpha-candidate-context"]');
    expect(ctx).toBeTruthy();
    const heading = host!.querySelector('[data-testid="options-alpha-candidate-heading"]')?.textContent ?? "";
    expect(heading).toMatch(/SPY/);
    expect(heading).not.toMatch(/oacnd_/);
    expect(host!.querySelector("h3")?.textContent).toBe("Candidate history");
    const prereqs = host!.querySelectorAll('[data-testid="options-alpha-candidate-prereqs"]');
    expect(prereqs).toHaveLength(1);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-item"] [data-testid="options-alpha-candidate-prereqs"]')).toBeNull();
    expect(prereqs[0].textContent).toMatch(/Measured-source consumer proven/);
    expect(prereqs[0].textContent).toMatch(/Consumer availability production-accepted/);
    expect(prereqs[0].textContent).toMatch(/Campaign integrity publication runtime accepted/);
    expect(prereqs[0].textContent).toMatch(/Source collision review clear/);
    expect(prereqs[0].textContent).not.toMatch(/oa1t_measured_source_consumer_proven/);
    expect(prereqs[0].textContent).toMatch(/Cleared|Pending/);
    expect(ctx!.textContent).toMatch(/~Buy/);
    expect(ctx!.textContent).toMatch(/~Sell/);
    expect(ctx!.textContent).toMatch(/Mixed/);
    expect(ctx!.textContent).toMatch(/Direction withheld/);
    expect(ctx!.textContent).toMatch(/Not published/);
    expect(host!.innerHTML).toMatch(/Measured NBBO valid/);
    expect(host!.innerHTML).not.toMatch(/OI confirmation/);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-feed-details"]')).toBeTruthy();
    const revisionNote = host!.querySelector('[data-testid="options-alpha-candidate-revision-note"]')?.textContent ?? "";
    expect(revisionNote).toMatch(/Frozen first qualification/);
    expect(revisionNote).not.toMatch(/ocrev_/);
  });

  it("renders Contract details unavailable when campaign context is absent", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: fixtureFeedWithoutContext() }));
    renderPanel();
    await flushMicrotasks(8);
    const absent = host!.querySelector('[data-testid="options-alpha-candidate-context-absent"]');
    expect(absent).toBeTruthy();
    expect(absent!.textContent).toMatch(/Contract details unavailable/);
    const heading = host!.querySelector('[data-testid="options-alpha-candidate-heading"]')?.textContent ?? "";
    expect(heading).toBe("Contract details unavailable");
    expect(heading).not.toMatch(/oacnd_/);
    expect(heading).not.toMatch(/SPY/);
  });

  it("renders unavailable when a schema-valid context revision does not match first qualification", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 200,
      body: schemaValidSyntheticResponse("ocrev_aaaaaaaaaaaaaaaaaaaaaaaa"),
    }));
    renderPanel();
    await flushMicrotasks(8);
    const heading = host!.querySelector('[data-testid="options-alpha-candidate-heading"]')?.textContent ?? "";
    expect(heading).toBe("Contract details unavailable");
    expect(host!.querySelector('[data-testid="options-alpha-candidate-context-absent"]')).toBeTruthy();
    expect(heading).not.toMatch(/SPY/);
  });

  it("renders the inactive notice when only the candidate panel is mounted", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: validResponse() }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-panel"]')).toBeTruthy();
    expect(host!.innerHTML).toMatch(/preregistered/i);
  });

  it("shows an emdash for the candidate count when the feed is unavailable", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: { error: "feed unavailable" } }));
    renderPanel();
    await flushMicrotasks(8);
    expect(host!.querySelector('[data-testid="options-alpha-candidate-count"]')?.textContent).toBe("—");
  });
});