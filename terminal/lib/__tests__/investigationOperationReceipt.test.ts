import { describe, expect, it } from "vitest";

import { classifyInvestigationOperationReceipt } from "../investigationOperationReceipt";

const OPERATION_ID = "9f1c2b34-5a67-4c89-9d01-2e3f4a5b6c7d";
const INVESTIGATION_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const PRINCIPAL = "0aa2b3c4-d5e6-4f70-8a91-b2c3d4e5f607";
const OTHER_UUID = "5e5f4a3b-2c1d-4e6f-8a9b-0c1d2e3f4a5b";
const PARENT_ID = "7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f";
const REVISION_ID_ONE = "aa11bb22-cc33-4d44-8e55-ff6677889900";
const REVISION_ID_TWO = "bb22cc33-dd44-4e55-8f66-0a1122334455";
const DIGEST = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const TIMESTAMP = "2026-11-05T12:30:00.000Z";

type Receipt = Record<string, unknown>;

function fence(overrides: Receipt = {}): Receipt {
  return { status: "not_applied", id: INVESTIGATION_ID, operation_id: OPERATION_ID, ...overrides };
}

function commit(): Receipt {
  return {
    status: "committed",
    id: INVESTIGATION_ID,
    investigation_id: INVESTIGATION_ID,
    operation_id: OPERATION_ID,
    author_ref: PRINCIPAL,
    revision: 1,
    sequence: 1,
    revision_id: REVISION_ID_ONE,
    parent_revision_id: null,
    manifest_digest: DIGEST,
    committed_at: TIMESTAMP,
    recorded_at: TIMESTAMP,
    lifecycle: "active",
    manifest: { entries: [] },
  };
}

function without(receipt: Receipt, key: string): Receipt {
  const copy: Receipt = { ...receipt };
  delete copy[key];
  return copy;
}

function merged(receipt: Receipt, overrides: Receipt): Receipt {
  return { ...receipt, ...overrides };
}

function laterCommit(revision: number, parent: unknown): Receipt {
  return merged(commit(), {
    revision,
    sequence: revision,
    revision_id: REVISION_ID_TWO,
    parent_revision_id: parent,
  });
}

function classify(raw: unknown, operationId = OPERATION_ID, principal = PRINCIPAL) {
  return classifyInvestigationOperationReceipt(raw, operationId, principal);
}

describe("valid native receipts", () => {
  it("classifies the native not_applied fence", () => {
    expect(classify(fence())).toBe("not_applied");
  });

  it("classifies a first commit with explicit null parent_revision_id", () => {
    expect(classify(commit())).toBe("committed");
  });

  it("classifies a later commit with a UUID parent_revision_id", () => {
    expect(classify(laterCommit(7, PARENT_ID))).toBe("committed");
  });

  it("accepts the removed lifecycle", () => {
    expect(classify(merged(commit(), { lifecycle: "removed" }))).toBe("committed");
  });

  it("accepts an offset-form timezoned timestamp", () => {
    const stamp = "2026-11-05T18:00:00+05:30";
    expect(classify(merged(commit(), { committed_at: stamp, recorded_at: stamp }))).toBe("committed");
  });
});

describe("identity and authority", () => {
  it("rejects a receipt bound to a different operation key", () => {
    expect(classify(merged(commit(), { operation_id: OTHER_UUID }))).toBeNull();
  });

  it("rejects a non lower-case UUID operationId parameter", () => {
    expect(classify(commit(), OPERATION_ID.toUpperCase())).toBeNull();
  });

  it("rejects a malformed operationId parameter", () => {
    expect(classify(commit(), "not-a-uuid")).toBeNull();
  });

  it("rejects a malformed principal parameter", () => {
    expect(classify(commit(), OPERATION_ID, "")).toBeNull();
  });

  it("rejects a receipt whose author_ref is not the incumbent principal", () => {
    expect(classify(merged(commit(), { author_ref: OTHER_UUID }))).toBeNull();
  });

  it("rejects a non UUID investigation id", () => {
    expect(classify(merged(commit(), { id: "row-1" }))).toBeNull();
  });
  it("requires the native investigation_id to match its original target", () => {
    expect(classify(without(commit(), "investigation_id"))).toBeNull();
    expect(classify(merged(commit(), { investigation_id: OTHER_UUID }))).toBeNull();
  });
  it("rejects calendar-normalized timestamps without rejecting actual offset clocks", () => {
    const impossible = "2026-02-30T12:30:00Z";
    expect(classify(merged(commit(), { committed_at: impossible, recorded_at: impossible }))).toBeNull();
    const actual = "2024-02-29T12:30:00.123456+08:00";
    expect(classify(merged(commit(), { committed_at: actual, recorded_at: actual }))).toBe("committed");
  });
});

describe("native stored fence shape", () => {
  it("rejects a not_applied fence with extra metadata", () => {
    expect(classify(fence({ reason: "noop" }))).toBeNull();
  });

  it("rejects a not_applied fence carrying an author field", () => {
    expect(classify(fence({ author_ref: PRINCIPAL }))).toBeNull();
  });

  it("rejects a not_applied fence missing its operation_id", () => {
    expect(classify(without(fence(), "operation_id"))).toBeNull();
  });

  it("rejects bare non-native status labels", () => {
    const statuses = ["limit_reached", "capacity", "miss", "pending", "unknown", ""];
    for (const status of statuses) {
      expect(classify(fence({ status }))).toBeNull();
    }
  });
});

describe("commit completeness", () => {
  it("rejects a commit receipt with any missing field", () => {
    const required = [
      "author_ref",
      "revision",
      "sequence",
      "revision_id",
      "parent_revision_id",
      "manifest_digest",
      "committed_at",
      "recorded_at",
      "lifecycle",
      "manifest",
    ];
    for (const key of required) {
      expect(classify(without(commit(), key))).toBeNull();
    }
  });

  it("rejects a commit receipt with extra metadata", () => {
    expect(classify(merged(commit(), { attempt: 2 }))).toBeNull();
  });
});

describe("revision lineage", () => {
  it("rejects revision 1 with a non-null parent_revision_id", () => {
    expect(classify(merged(commit(), { parent_revision_id: PARENT_ID }))).toBeNull();
  });

  it("rejects revision 2 with an explicit null parent_revision_id", () => {
    expect(classify(laterCommit(2, null))).toBeNull();
  });

  it("rejects revision 2 with a non UUID parent_revision_id", () => {
    expect(classify(laterCommit(2, "genesis"))).toBeNull();
  });
});

describe("scalar, clock and digest contracts", () => {
  it("rejects booleans standing in for integers", () => {
    expect(classify(merged(commit(), { revision: true }))).toBeNull();
    expect(classify(merged(commit(), { sequence: false }))).toBeNull();
  });

  it("rejects non positive or out of range integers", () => {
    expect(classify(merged(commit(), { revision: 0 }))).toBeNull();
    expect(classify(merged(commit(), { revision: -3 }))).toBeNull();
    expect(classify(merged(commit(), { revision: 2147483648 }))).toBeNull();
    expect(classify(merged(commit(), { revision: 1.5 }))).toBeNull();
    expect(classify(merged(commit(), { revision: "1" }))).toBeNull();
  });

  it("rejects revision and sequence that disagree", () => {
    expect(classify(merged(commit(), { revision: 2, sequence: 1 }))).toBeNull();
  });

  it("rejects invalid manifest digests", () => {
    expect(classify(merged(commit(), { manifest_digest: DIGEST.toUpperCase() }))).toBeNull();
    expect(classify(merged(commit(), { manifest_digest: DIGEST.slice(1) }))).toBeNull();
    expect(classify(merged(commit(), { manifest_digest: "g" + DIGEST.slice(1) }))).toBeNull();
  });

  it("rejects timestamps without a timezone designator", () => {
    const naive = "2026-11-05T12:30:00";
    expect(classify(merged(commit(), { committed_at: naive, recorded_at: naive }))).toBeNull();
  });

  it("rejects recorded_at that is not exactly committed_at", () => {
    expect(classify(merged(commit(), { recorded_at: "2026-11-05T12:30:00.001Z" }))).toBeNull();
  });

  it("rejects calendar-invalid clock values", () => {
    const bad = "2026-13-05T12:30:00Z";
    expect(classify(merged(commit(), { committed_at: bad, recorded_at: bad }))).toBeNull();
  });

  it("rejects non string clocks", () => {
    expect(classify(merged(commit(), { committed_at: 1730800200000 }))).toBeNull();
  });

  it("rejects an unknown lifecycle", () => {
    expect(classify(merged(commit(), { lifecycle: "archived" }))).toBeNull();
  });

  it("rejects non plain-object manifests", () => {
    expect(classify(merged(commit(), { manifest: [] }))).toBeNull();
    expect(classify(merged(commit(), { manifest: null }))).toBeNull();
    expect(classify(merged(commit(), { manifest: "entries" }))).toBeNull();
  });
});

describe("raw input typing", () => {
  it("rejects non plain-object raw receipts", () => {
    expect(classify(null)).toBeNull();
    expect(classify(undefined)).toBeNull();
    expect(classify("committed")).toBeNull();
    expect(classify(42)).toBeNull();
    expect(classify([commit()])).toBeNull();
    expect(classify(new Date(TIMESTAMP))).toBeNull();
  });
});
