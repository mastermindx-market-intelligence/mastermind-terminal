import { describe, expect, it } from "vitest";
import { diffThesisVersions } from "../thesisDelta";
import type { ThesisVersion } from "../theses";

const BASE: ThesisVersion = {
  id: "00000000-0000-0000-0000-000000000001",
  thesisId: "00000000-0000-0000-0000-000000000000",
  version: 1,
  previousVersion: null,
  transition: "create",
  lifecycleState: "active",
  subject: {
    schema: "mastermind.thesis-subject-ref/v1",
    kind: "issuer",
    owner: "terminal.analysis_symbol",
    key: "NVDA",
    identityState: "listing_scoped",
    listing: { symbol: "NVDA", mic: null, securityId: null },
    companyId: null,
    display: "NVDA · listing scoped",
  },
  clientRequestId: "00000000-0000-0000-0000-000000000001",
  systemRecordedAt: "2026-01-01T00:00:00.000Z",
  effectiveAt: null,
  content: {
    schema: "mastermind.thesis-content/v1",
    title: "Original Title",
    statement: "Original statement.",
    catalysts: ["Cat A", "Cat B"],
    falsifiers: ["Fal A"],
    risks: ["Risk A"],
    horizon: "quarters",
    effectiveAt: null,
    revisionNote: null,
  },
};

function makeNext(base: ThesisVersion, overrides: Partial<ThesisVersion["content"]> & Partial<ThesisVersion> = {}): ThesisVersion {
  return {
    ...base,
    version: base.version + 1,
    previousVersion: base.version,
    transition: "revise",
    systemRecordedAt: "2026-01-02T00:00:00.000Z",
    content: { ...base.content, ...overrides },
  } as ThesisVersion;
}

describe("diffThesisVersions", () => {
  describe("origin (null previous)", () => {
    it("returns origin kind when previous is null", () => {
      const result = diffThesisVersions(null, BASE);
      expect(result).toEqual([{ kind: "origin" }]);
    });
  });

  describe("fully unchanged", () => {
    it("returns empty array when nothing changed", () => {
      // Two separate version objects with identical content and same transition
      const v2: ThesisVersion = { ...BASE, version: 2, previousVersion: 1, transition: "revise" };
      const v3: ThesisVersion = { ...BASE, version: 3, previousVersion: 2, transition: "revise" };
      const result = diffThesisVersions(v2, v3);
      expect(result).toEqual([]);
    });
  });

  describe("string fields", () => {
    it("reports title change", () => {
      const next = makeNext(BASE, { title: "New Title" });
      const result = diffThesisVersions(BASE, next);
      expect(result).toContainEqual({ kind: "stringChanged", field: "title", old: "Original Title", next: "New Title" });
    });

    it("reports statement change", () => {
      const next = makeNext(BASE, { statement: "New statement." });
      const result = diffThesisVersions(BASE, next);
      expect(result).toContainEqual({ kind: "stringChanged", field: "statement", old: "Original statement.", next: "New statement." });
    });
  });

  describe("list fields", () => {
    it("reports added items", () => {
      const next = makeNext(BASE, { catalysts: ["Cat A", "Cat B", "Cat C"] });
      const result = diffThesisVersions(BASE, next);
      expect(result).toContainEqual({ kind: "listAdded", field: "catalysts", items: ["Cat C"] });
    });

    it("reports removed items", () => {
      const next = makeNext(BASE, { catalysts: ["Cat A"] });
      const result = diffThesisVersions(BASE, next);
      expect(result).toContainEqual({ kind: "listRemoved", field: "catalysts", items: ["Cat B"] });
    });

    it("reports reordered items (same items, different order)", () => {
      const next = makeNext(BASE, { catalysts: ["Cat B", "Cat A"] });
      const result = diffThesisVersions(BASE, next);
      expect(result).toContainEqual({ kind: "listReordered", field: "catalysts" });
    });

    it("reports falsifiers added/removed", () => {
      const next = makeNext(BASE, { falsifiers: ["Fal A", "Fal B"] });
      const result = diffThesisVersions(BASE, next);
      expect(result).toContainEqual({ kind: "listAdded", field: "falsifiers", items: ["Fal B"] });
    });

    it("reports risks added/removed", () => {
      const next = makeNext(BASE, { risks: [] });
      const result = diffThesisVersions(BASE, next);
      expect(result).toContainEqual({ kind: "listRemoved", field: "risks", items: ["Risk A"] });
    });
  });

  describe("horizon", () => {
    it("reports horizon change", () => {
      const next = makeNext(BASE, { horizon: "years" });
      const result = diffThesisVersions(BASE, next);
      expect(result).toContainEqual({ kind: "horizonChanged", old: "quarters", next: "years" });
    });
  });

  describe("effectiveAt", () => {
    it("reports null to value", () => {
      const next = makeNext(BASE, { effectiveAt: "2026-06-01T00:00:00.000Z" });
      const result = diffThesisVersions(BASE, next);
      expect(result).toContainEqual({ kind: "effectiveAtChanged", old: null, next: "2026-06-01T00:00:00.000Z" });
    });

    it("reports value to null", () => {
      const withEffective = makeNext(BASE, { effectiveAt: "2026-06-01T00:00:00.000Z" });
      const next = makeNext(withEffective, { effectiveAt: null });
      const result = diffThesisVersions(withEffective, next);
      expect(result).toContainEqual({ kind: "effectiveAtChanged", old: "2026-06-01T00:00:00.000Z", next: null });
    });

    it("reports value to value", () => {
      const v2 = makeNext(BASE, { effectiveAt: "2026-06-01T00:00:00.000Z" });
      const v3 = makeNext(v2, { effectiveAt: "2026-09-01T00:00:00.000Z" });
      const result = diffThesisVersions(v2, v3);
      expect(result).toContainEqual({ kind: "effectiveAtChanged", old: "2026-06-01T00:00:00.000Z", next: "2026-09-01T00:00:00.000Z" });
    });
  });

  describe("revisionNote", () => {
    it("reports revisionNote present when previously absent", () => {
      const next = makeNext(BASE, { revisionNote: "Initial revision." });
      const result = diffThesisVersions(BASE, next);
      expect(result).toContainEqual({ kind: "revisionNoteChanged", old: null, next: "Initial revision." });
    });

    it("reports revisionNote absent when previously present", () => {
      const withNote = makeNext(BASE, { revisionNote: "Initial revision." });
      const next = makeNext(withNote, { revisionNote: null });
      const result = diffThesisVersions(withNote, next);
      expect(result).toContainEqual({ kind: "revisionNoteChanged", old: "Initial revision.", next: null });
    });
  });

  describe("transition", () => {
    it("reports transition change", () => {
      const next = makeNext(BASE);
      const result = diffThesisVersions(BASE, next);
      expect(result).toContainEqual({ kind: "transitionChanged", old: "create", next: "revise" });
    });
  });

  describe("truncated previous", () => {
    it("returns origin kind when caller passes null (caller handles truncation signal)", () => {
      // The truncation signal (previousVersion not in loaded history) is handled
      // by the caller before calling diffThesisVersions. The UI layer shows the
      // "outside loaded history" sentence based on the historyTruncated flag.
      const result = diffThesisVersions(null, { ...BASE, version: 999, previousVersion: 998 } as ThesisVersion);
      expect(result).toEqual([{ kind: "origin" }]);
    });
  });
});
