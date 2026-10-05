import { describe, expect, it } from "vitest";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import feedSchema from "@/contracts/options/options.alpha_candidate_feed.v2.schema.json";
import candidateFeedFixture from "@/lib/__tests__/fixtures/candidate_feed.json";
import candidateReceiptFixture from "@/lib/__tests__/fixtures/candidate_feed.receipt.json";
import { normalizeCandidateFeed } from "@/components/prophet/optionsAlphaCandidateFeed";

type JsonRecord = Record<string, unknown>;

const feedTemplate = candidateFeedFixture as JsonRecord;
const receiptTemplate = candidateReceiptFixture as JsonRecord;
const formedTemplate = (feedTemplate.formed_candidates as JsonRecord[])[0];
const FIRST_QUALIFYING = String(formedTemplate.first_qualifying_campaign_revision_id);

const VALID_CONTEXT = {
  schema: "options.alpha_candidate_campaign_context/v1" as const,
  campaign_revision_id: FIRST_QUALIFYING,
  group: {
    session_date: "2026-08-13",
    ticker: "SPY",
    right: "C" as const,
    expiration: "2026-08-15",
    strike: 450,
    strike_key: "450",
  },
  flow_side_counts: { "~buy": 2, "~sell": 1, mixed: 1 },
  intent: {
    opening_closing: "unavailable" as const,
    direction_reliability: "soft" as const,
    accumulation_distribution: "unavailable" as const,
  },
};

function envelopeWithContext(context: unknown | undefined): unknown {
  const feed = structuredClone(feedTemplate) as JsonRecord;
  const formed = (feed.formed_candidates as JsonRecord[])[0];
  if (context === undefined) delete formed.campaign_context;
  else formed.campaign_context = context as JsonRecord;
  return {
    feed,
    receipt: structuredClone(receiptTemplate),
    metadata: {
      payload_etag: "synthetic-test-only",
      payload_last_modified: "Thu, 13 Aug 2026 14:30:02 GMT",
      receipt_etag: "synthetic-test-only",
      receipt_last_modified: "Thu, 13 Aug 2026 14:30:02 GMT",
      served_at: "2026-08-13T14:30:05Z",
    },
  };
}

function normalizedContext(context: unknown | undefined) {
  return normalizeCandidateFeed(envelopeWithContext(context))?.feed.formed_candidates[0]?.campaign_context ?? null;
}

describe("Options Alpha campaign_context display binding", () => {
  it("accepts a schema-valid synthetic context bound to the fixture first qualifying revision", () => {
    const feed = structuredClone(feedTemplate) as JsonRecord;
    (feed.formed_candidates as JsonRecord[])[0].campaign_context = structuredClone(VALID_CONTEXT);
    const ajv = new Ajv({ allErrors: true, strict: true });
    addFormats(ajv);
    const validFeed = ajv.compile(feedSchema);
    expect(validFeed(feed)).toBe(true);
    const ctx = normalizedContext(VALID_CONTEXT);
    expect(ctx).not.toBeNull();
    expect(ctx?.campaign_revision_id).toBe(FIRST_QUALIFYING);
    expect(ctx?.group.ticker).toBe("SPY");
    expect(ctx?.flow_side_counts["~buy"]).toBe(2);
  });

  it("returns null when campaign_revision_id does not equal first_qualifying_campaign_revision_id", () => {
    const mismatched = structuredClone(VALID_CONTEXT);
    mismatched.campaign_revision_id = "ocrev_aaaaaaaaaaaaaaaaaaaaaaaa";
    const feed = structuredClone(feedTemplate) as JsonRecord;
    (feed.formed_candidates as JsonRecord[])[0].campaign_context = mismatched;
    const ajv = new Ajv({ allErrors: true, strict: true });
    addFormats(ajv);
    expect(ajv.compile(feedSchema)(feed)).toBe(true);
    expect(normalizedContext(mismatched)).toBeNull();
  });

  it("returns null when a flow-side count is missing instead of inventing 0", () => {
    const missingBuy = structuredClone(VALID_CONTEXT);
    delete (missingBuy.flow_side_counts as { "~buy"?: number })["~buy"];
    const ctx = normalizedContext(missingBuy);
    expect(ctx).toBeNull();
  });

  it("returns null when a flow-side count is negative", () => {
    const negative = structuredClone(VALID_CONTEXT);
    negative.flow_side_counts["~sell"] = -1;
    expect(normalizedContext(negative)).toBeNull();
  });

  it("returns null when a flow-side count is a non-integer", () => {
    const fractional = structuredClone(VALID_CONTEXT);
    fractional.flow_side_counts.mixed = 1.5;
    expect(normalizedContext(fractional)).toBeNull();
  });

  it("returns null when campaign_context is absent", () => {
    expect(normalizedContext(undefined)).toBeNull();
  });
});
