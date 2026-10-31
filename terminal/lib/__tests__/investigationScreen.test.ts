/**
 * The Investigation ⇄ saved-screen boundary (`investigationScreen`).
 *
 * Each case pins one thing the transaction is allowed to conclude: a capture names a screen
 * and nothing else; a reference is pinned-screen-shaped or it is not evidence; and a found
 * lookup becomes a retained record ONLY when the tuple, the revision, the owner parse and
 * the reviewless shape all agree. Every refusal here is a shape the transaction must never
 * show, store or evaluate — in particular nothing may downgrade a newer grammar, and no
 * review body may travel inside retained evidence.
 */
import { describe, expect, it } from "vitest";
import {
  SCREEN_EVIDENCE_OWNER, SCREEN_EVIDENCE_TYPE, isScreenEvidenceReference,
  parseRetainedInvestigationScreen, parseScreenCapture,
} from "@/lib/investigationScreen";
import type { InvestigationEvidenceRef } from "@/lib/investigationContracts";
import { normalizeDefinition } from "@/lib/smartScreen/predicate";
import pgRecord from "./fixtures/investigation_screen_record.json";
import { parseScreenRecord } from "@/lib/smartScreen/record";

it("shares a genuinely native record with the disposable PostgreSQL proof", () => {
  expect(parseScreenRecord(pgRecord, pgRecord.id)).toEqual({ kind: "ok", record: pgRecord });
  const reference = { owner: SCREEN_EVIDENCE_OWNER, object_type: SCREEN_EVIDENCE_TYPE,
    object_id: pgRecord.id, mode: "pinned" as const, version_ref: "3f7d9a58-2c1e-4b6a-9f30-8d51e2a7c4b9", fingerprint: "a".repeat(64) };
  expect(parseRetainedInvestigationScreen({ ...reference, found: true, source_revision: pgRecord.rev, record: pgRecord }, reference)).toEqual(pgRecord);
});

// ── fixtures ─────────────────────────────────────────────────────────────────────────────

const SCREEN_ID = "a1f143cdb27c4a3f8e0d21b6c9d75e04";
const OTHER_SCREEN_ID = "b1f143cdb27c4a3f8e0d21b6c9d75e04";
const UUID = "3f7d9a58-2c1e-4b6a-9f30-8d51e2a7c4b9";
const OTHER_UUID = "4f7d9a58-2c1e-4b6a-9f30-8d51e2a7c4b9";
const FINGERPRINT = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const OTHER_FINGERPRINT = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";

/** A supported definition that is genuinely nested: an OR inside an AND, plus two leaves.
 *  Canonicalization sorts the operands, so the stored order below is the canonical one. */
const normalized = normalizeDefinition({
  grammar: 1,
  scope: { markets: "all", asset: null, unpriced: false },
  where: {
    all: [
      { any: [{ f: "chg", op: "gte", v: 5 }, { f: "chg", op: "lte", v: -5 }] },
      { f: "mcap", op: "gte", v: 2e9 },
      { f: "verdict", op: "in", v: ["BUY", "REBUY"] },
    ],
  },
});
if (!normalized.ok) throw new Error(`fixture definition rejected: ${normalized.error} at ${normalized.path}`);
const STORED_DEF = normalized.def;
const STORED_HASH = normalized.hash;

/** A VALID review (the owner parser accepts it) — the only way to reach the boundary's own
 *  review check instead of being refused by the parse. */
const REVIEW = {
  v: 1,
  hash: STORED_HASH,
  u: "terminal.manifest",
  asOf: "2026-10-01",
  at: "2026-10-05T12:00:00.000Z",
  pop: 2,
  m: "AAA,BBB",
  d: "a".repeat(128 * 8),
};

const record = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 1,
  id: SCREEN_ID,
  rev: 7,
  name: "Big money, big moves",
  def: STORED_DEF,
  hash: STORED_HASH,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-02T09:00:00.000Z",
  review: null,
  ...patch,
});

const ref = (patch: Record<string, unknown> = {}): InvestigationEvidenceRef => ({
  owner: SCREEN_EVIDENCE_OWNER,
  object_type: SCREEN_EVIDENCE_TYPE,
  object_id: SCREEN_ID,
  mode: "pinned",
  version_ref: UUID,
  fingerprint: FINGERPRINT,
  ...patch,
});

const lookup = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  found: true,
  owner: SCREEN_EVIDENCE_OWNER,
  object_type: SCREEN_EVIDENCE_TYPE,
  object_id: SCREEN_ID,
  mode: "pinned",
  version_ref: UUID,
  fingerprint: FINGERPRINT,
  source_revision: 7,
  record: record(),
  ...patch,
});

const retained = (patch: Record<string, unknown> = {}, refPatch: Record<string, unknown> = {}) =>
  parseRetainedInvestigationScreen(lookup(patch), ref(refPatch));

// ── parseScreenCapture: a capture names a screen and nothing else ────────────────────────

describe("parseScreenCapture", () => {
  it("accepts exactly a screen id and the revision the caller last saw, at both bounds", () => {
    expect(parseScreenCapture({ screen_id: SCREEN_ID, expected_revision: 7 }))
      .toEqual({ screen_id: SCREEN_ID, expected_revision: 7 });
    expect(parseScreenCapture({ screen_id: SCREEN_ID, expected_revision: 1 }))
      .toEqual({ screen_id: SCREEN_ID, expected_revision: 1 });
    expect(parseScreenCapture({ screen_id: SCREEN_ID, expected_revision: 1_000_000_000 }))
      .toEqual({ screen_id: SCREEN_ID, expected_revision: 1_000_000_000 });
  });

  it("returns a detached object — mutating it never writes through to the caller's value", () => {
    const input = { screen_id: SCREEN_ID, expected_revision: 7 };
    const parsed = parseScreenCapture(input);
    expect(parsed).not.toBe(input);
    expect(parsed && Object.keys(parsed)).toEqual(["screen_id", "expected_revision"]);
    if (parsed) parsed.screen_id = OTHER_SCREEN_ID;
    expect(input).toEqual({ screen_id: SCREEN_ID, expected_revision: 7 });
  });

  const bad: [string, unknown][] = [
    ["a bare string", `scr_screen.${SCREEN_ID}`],
    ["an array", [SCREEN_ID, 7]],
    ["null", null],
    ["a missing revision", { screen_id: SCREEN_ID }],
    ["a missing id", { expected_revision: 7 }],
    ["an extra field", { screen_id: SCREEN_ID, expected_revision: 7, name: "Mega caps" }],
    ["an upper-case id", { screen_id: SCREEN_ID.toUpperCase(), expected_revision: 7 }],
    ["a short id", { screen_id: SCREEN_ID.slice(1), expected_revision: 7 }],
    ["a non-hex id", { screen_id: `g${SCREEN_ID.slice(1)}`, expected_revision: 7 }],
    ["a non-string id", { screen_id: 42, expected_revision: 7 }],
    ["a zero revision", { screen_id: SCREEN_ID, expected_revision: 0 }],
    ["a negative revision", { screen_id: SCREEN_ID, expected_revision: -7 }],
    ["a fractional revision", { screen_id: SCREEN_ID, expected_revision: 1.5 }],
    ["a revision past the bound", { screen_id: SCREEN_ID, expected_revision: 1_000_000_001 }],
    ["a string revision", { screen_id: SCREEN_ID, expected_revision: "7" }],
    ["a NaN revision", { screen_id: SCREEN_ID, expected_revision: Number.NaN }],
    ["an infinite revision", { screen_id: SCREEN_ID, expected_revision: Number.POSITIVE_INFINITY }],
  ];
  for (const [label, value] of bad) {
    it(`refuses ${label}`, () => {
      expect(parseScreenCapture(value)).toBeNull();
    });
  }
});

// ── isScreenEvidenceReference: pinned screen dialect only, no selection, no follow_head ──

describe("isScreenEvidenceReference", () => {
  it("accepts the pinned screen-capture reference", () => {
    expect(isScreenEvidenceReference(ref())).toBe(true);
  });

  const bad: [string, unknown][] = [
    ["a different owner", ref({ owner: "terminal.other" })],
    ["a different object_type", ref({ object_type: "screen_snapshot" })],
    ["a non-hex object_id", ref({ object_id: SCREEN_ID.slice(1) })],
    ["an upper-case object_id", ref({ object_id: SCREEN_ID.toUpperCase() })],
    ["a follow_head mode", ref({ mode: "follow_head" })],
    ["a selection mode", ref({ mode: "selection" })],
    ["a non-uuid version_ref", ref({ version_ref: "7" })],
    ["an upper-case version_ref", ref({ version_ref: UUID.toUpperCase() })],
    ["a short fingerprint", ref({ fingerprint: "abc" })],
    ["an upper-case fingerprint", ref({ fingerprint: FINGERPRINT.toUpperCase() })],
    ["a missing version_ref", {
      owner: SCREEN_EVIDENCE_OWNER, object_type: SCREEN_EVIDENCE_TYPE,
      object_id: SCREEN_ID, mode: "pinned", fingerprint: FINGERPRINT,
    }],
    ["a missing fingerprint", {
      owner: SCREEN_EVIDENCE_OWNER, object_type: SCREEN_EVIDENCE_TYPE,
      object_id: SCREEN_ID, mode: "pinned", version_ref: UUID,
    }],
    ["an attached selection", { ...ref(), selection: { field: "verdict" } }],
    ["an extra field", { ...ref(), note: "x" }],
    ["a bare string", "pinned"],
    ["an array", [ref()]],
  ];
  for (const [label, value] of bad) {
    it(`refuses ${label}`, () => {
      expect(isScreenEvidenceReference(value)).toBe(false);
    });
  }
});

// ── parseRetainedInvestigationScreen: the one record the reference names, or null ────────

describe("parseRetainedInvestigationScreen — the retained definition survives", () => {
  it("returns the referenced record with the nested definition intact and review null", () => {
    const parsed = retained();
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.id).toBe(SCREEN_ID);
    expect(parsed.rev).toBe(7);
    expect(parsed.name).toBe("Big money, big moves");
    expect(parsed.review).toBeNull();
    // Re-normalizing the returned definition reproduces the same canonical shape AND hash:
    // nothing was flattened, dropped or reinterpreted on the way through the boundary.
    const again = normalizeDefinition(parsed.def);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.hash).toBe(STORED_HASH);
      expect(again.def).toEqual(STORED_DEF);
    }
    // The OR-inside-AND the account actually saved is still there, as a group.
    const where = parsed.def.where as { all: Record<string, unknown>[] };
    expect(where.all).toHaveLength(3);
    expect(where.all.find((node) => "any" in node))
      .toEqual({ any: [{ f: "chg", op: "gte", v: 5 }, { f: "chg", op: "lte", v: -5 }] });
  });

  it("accepts a body with no review key at all and still returns review null", () => {
    const body = record();
    delete body.review;
    const parsed = parseRetainedInvestigationScreen(lookup({ record: body }), ref());
    expect(parsed).not.toBeNull();
    expect(parsed === null || parsed.review).toBeNull();
  });
});

describe("parseRetainedInvestigationScreen — the reference tuple must match exactly", () => {
  it("refuses a found lookup whose tuple field disagrees with the reference", () => {
    const mismatches = [
      ["owner", "terminal.other"],
      ["object_type", "screen_snapshot"],
      ["object_id", OTHER_SCREEN_ID],
      ["mode", "follow_head"],
      ["mode", "selection"],
      ["version_ref", OTHER_UUID],
      ["fingerprint", OTHER_FINGERPRINT],
    ] as const;
    for (const [field, value] of mismatches) {
      expect(parseRetainedInvestigationScreen(lookup({ [field]: value }), ref())).toBeNull();
    }
  });

  it("refuses when the requested reference is the one that moved", () => {
    expect(parseRetainedInvestigationScreen(lookup(), ref({ version_ref: OTHER_UUID }))).toBeNull();
    expect(parseRetainedInvestigationScreen(lookup(), ref({ fingerprint: OTHER_FINGERPRINT }))).toBeNull();
    expect(parseRetainedInvestigationScreen(lookup(), ref({ object_id: OTHER_SCREEN_ID }))).toBeNull();
  });

  it("refuses an expected reference that is not a screen-capture reference at all", () => {
    expect(parseRetainedInvestigationScreen(lookup(), ref({ mode: "follow_head" }))).toBeNull();
    expect(parseRetainedInvestigationScreen(lookup(), ref({ mode: "selection" }))).toBeNull();
  });
});

describe("parseRetainedInvestigationScreen — the body must be the referenced, current record", () => {
  it("refuses a body whose id is not the referenced screen", () => {
    expect(retained({ record: record({ id: OTHER_SCREEN_ID }) })).toBeNull();
  });

  it("refuses a body whose revision disagrees with the lookup's source_revision", () => {
    expect(retained({ source_revision: 8 })).toBeNull();
    expect(retained({ record: record({ rev: 6 }) })).toBeNull();
    expect(retained({ source_revision: "7" })).toBeNull();
  });

  it("refuses a newer record schema instead of downgrading it", () => {
    expect(retained({ record: record({ schema: 2 }) })).toBeNull();
  });

  it("refuses a newer grammar instead of downgrading it", () => {
    const newer = { ...STORED_DEF, grammar: 2 };
    expect(retained({ record: record({ def: newer }) })).toBeNull();
  });

  it("refuses a corrupt body rather than guessing a weaker definition", () => {
    expect(retained({ record: record({ hash: "0".repeat(14) }) })).toBeNull();
    expect(retained({ record: record({ def: { ...STORED_DEF, scope: { ...STORED_DEF.scope, asset: "Stocks" } } }) })).toBeNull();
    expect(retained({ record: { schema: 1, id: SCREEN_ID } })).toBeNull();
  });
});

describe("parseRetainedInvestigationScreen — no review travels with a retained definition", () => {
  it("refuses a body that still carries a valid review", () => {
    expect(retained({ record: record({ review: REVIEW }) })).toBeNull();
  });

  it("refuses a body whose review is invalid, same as any corrupt body", () => {
    expect(retained({ record: record({ review: { v: 1, hash: STORED_HASH } }) })).toBeNull();
  });
});

describe("parseRetainedInvestigationScreen — only a found, exact-shaped lookup", () => {
  it("refuses a not-found answer", () => {
    expect(parseRetainedInvestigationScreen({ ...lookup(), found: false }, ref())).toBeNull();
    expect(parseRetainedInvestigationScreen({ ...lookup(), found: "true" }, ref())).toBeNull();
  });

  it("refuses an envelope with a missing or extra field", () => {
    const envelope = lookup();
    delete envelope.fingerprint;
    expect(parseRetainedInvestigationScreen(envelope, ref())).toBeNull();
    expect(parseRetainedInvestigationScreen({ ...lookup(), captured_at: "2026-10-15T00:00:00.000Z" }, ref())).toBeNull();
  });

  it("refuses a non-object lookup", () => {
    expect(parseRetainedInvestigationScreen(null, ref())).toBeNull();
    expect(parseRetainedInvestigationScreen([lookup()], ref())).toBeNull();
    expect(parseRetainedInvestigationScreen("found", ref())).toBeNull();
  });
});
