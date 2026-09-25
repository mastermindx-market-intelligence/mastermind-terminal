import { describe, expect, it } from "vitest";
import {
  describeThesisDelta,
  diffThesisVersions,
  thesisVersionDeltaForHistory,
  type ThesisDeltaCopy,
} from "../thesisDelta";
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

  describe("lifecycle", () => {
    it("does not report ordinary revisions as lifecycle changes", () => {
      const next = makeNext(BASE);
      const result = diffThesisVersions(BASE, next);
      expect(result).not.toContainEqual(expect.objectContaining({ kind: "lifecycleChanged" }));
    });

    it("reports lifecycle change", () => {
      const next: ThesisVersion = { ...makeNext(BASE), lifecycleState: "archived" };
      const result = diffThesisVersions(BASE, next);
      expect(result).toContainEqual({ kind: "lifecycleChanged", old: "active", next: "archived" });
    });
  });

  describe("truncated previous", () => {
    it("reports when the previous version is outside the loaded history", () => {
      const next = makeNext(BASE);
      const result = thesisVersionDeltaForHistory([], next);
      expect(result).toEqual([{ kind: "truncated" }]);
    });

    it("uses the requested previous version, not the newest history entry", () => {
      const version1 = { ...BASE };
      const version6: ThesisVersion = {
        ...BASE,
        version: 6,
        previousVersion: 5,
        lifecycleState: "invalidated",
        content: { ...BASE.content, statement: "Version 6 statement." },
      };
      const version7: ThesisVersion = {
        ...version6,
        version: 7,
        previousVersion: 6,
        lifecycleState: "active",
        content: { ...version6.content, statement: "Version 7 statement." },
      };
      const result = thesisVersionDeltaForHistory([version7, version6, version1], version7);
      expect(result).toContainEqual({ kind: "stringChanged", field: "statement", old: "Version 6 statement.", next: "Version 7 statement." });
      expect(result).toContainEqual({ kind: "lifecycleChanged", old: "invalidated", next: "active" });
    });
  });
});

describe("describeThesisDelta", () => {
  it("renders list values, old and next values, and zh spacing as plain sentences", () => {
    const copy: ThesisDeltaCopy = {
      language: "zh",
      origin: "这是第一版；此前没有版本。",
      truncated: "上一版本不在已加载的历史记录中。",
      fields: {
        title: "标题",
        statement: "论点陈述",
        catalysts: "催化因素",
        falsifiers: "证伪因素",
        risks: "风险",
        horizon: "时间范围",
        effectiveAt: "生效时间",
        revisionNote: "修订说明",
        status: "状态",
      },
      changed: "已更改",
      added: "已添加",
      removed: "已删除",
      reordered: "已重排",
      none: "无",
      formatHorizon: (horizon) => `时间-${horizon}`,
      formatDate: (date) => date ?? "无",
      formatLifecycle: (lifecycle) => `状态-${lifecycle}`,
    };

    expect(describeThesisDelta({ kind: "origin" }, copy)).toBe("这是第一版；此前没有版本。");
    expect(describeThesisDelta({ kind: "truncated" }, copy)).toBe("上一版本不在已加载的历史记录中。");

    expect(describeThesisDelta({ kind: "listAdded", field: "catalysts", items: ["新催化因素", "第二项"] }, copy))
      .toBe("催化因素已添加：新催化因素；第二项。");
    expect(describeThesisDelta({ kind: "horizonChanged", old: "quarters", next: "years" }, copy))
      .toBe("时间范围已更改：时间-quarters → 时间-years。");
    expect(describeThesisDelta({ kind: "effectiveAtChanged", old: null, next: "2026-01-01T00:00:00.000Z" }, copy))
      .toBe("生效时间已更改：无 → 2026-01-01T00:00:00.000Z。");
    expect(describeThesisDelta({ kind: "lifecycleChanged", old: "active", next: "archived" }, copy))
      .toBe("状态已更改：状态-active → 状态-archived。");
  });
});
