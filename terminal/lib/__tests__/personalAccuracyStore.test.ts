import { describe, expect, it } from "vitest";
import { parseKind, parseStatus, parseUserClaim } from "@/lib/personalAccuracyStore";
import { scorePersonalAccuracy } from "@/lib/personalAccuracy";

const ROW = {
  claim_id: "aaaaaaaaaaaaaaaa",
  user_id: "11111111-1111-4111-8111-111111111111",
  subject: { kind: "security", id: "SPX" },
  stated_at: "2026-01-01T00:00:00.000Z",
  resolves_at: "2026-02-01T00:00:00.000Z",
  claim_text: "SPX finishes at or above 6000",
  condition: { metric: "last_close", comparator: ">=", threshold: 6000, owner: "quotes.last_close" },
  stated_probability: 0.7,
  evidence: [],
  status: "open",
  resolution: null,
  supersedes: null,
};

describe("parseKind and parseStatus never coerce", () => {
  it("returns the recognised kind and null for anything else", () => {
    expect(parseKind("security")).toBe("security");
    expect(parseKind("macro_series")).toBe("macro_series");
    expect(parseKind("basket")).toBe("basket");
    expect(parseKind("widget")).toBeNull();
    expect(parseKind("")).toBeNull();
    expect(parseKind(null)).toBeNull();
  });

  it("returns the recognised status and null for anything else", () => {
    expect(parseStatus("open")).toBe("open");
    expect(parseStatus("matured")).toBe("matured");
    expect(parseStatus("resolved")).toBe("resolved");
    expect(parseStatus("void_unscorable")).toBe("void_unscorable");
    expect(parseStatus("withdrawn")).toBe("withdrawn");
    expect(parseStatus("pending")).toBeNull();
    expect(parseStatus("")).toBeNull();
  });

  it("marks an unrecognised kind unscorable with a reason", () => {
    const parsed = parseUserClaim({
      ...ROW,
      subject: { kind: "widget", id: "SPX" },
    });
    expect(parsed).toBeTruthy();
    expect(parsed!.ingestUnscorable).toBe("unrecognised_kind");
    const readout = scorePersonalAccuracy([parsed!]);
    expect(readout.unscorableCount).toBe(1);
    expect(readout.resolvedEpisodes).toBe(0);
    expect(readout.claims[0].unscorableReason).toBe("unrecognised_kind");
    expect(readout.claims[0].status).toBe("void_unscorable");
  });

  it("marks an unrecognised status unscorable with a reason", () => {
    const parsed = parseUserClaim({
      ...ROW,
      status: "pending",
    });
    expect(parsed).toBeTruthy();
    expect(parsed!.ingestUnscorable).toBe("unrecognised_status");
    const readout = scorePersonalAccuracy([parsed!]);
    expect(readout.unscorableCount).toBe(1);
    expect(readout.openEpisodes).toBe(0);
    expect(readout.claims[0].unscorableReason).toBe("unrecognised_status");
    expect(readout.claims[0].status).toBe("void_unscorable");
  });

  it("diverts a garbage resolved_at to malformed-date handling", () => {
    const parsed = parseUserClaim({
      ...ROW,
      status: "resolved",
      resolution: {
        outcome: 1,
        observed: 6100,
        resolved_at: "garbage",
        resolver: "quotes.last_close",
        note: "",
      },
    });
    expect(parsed).toBeTruthy();
    expect(parsed!.ingestUnscorable).toBe("malformed_timestamp");
    const readout = scorePersonalAccuracy([parsed!]);
    expect(readout.claims[0].unscorableReason).toBe("malformed_timestamp");
    expect(readout.claims[0].status).toBe("void_unscorable");
  });
});
