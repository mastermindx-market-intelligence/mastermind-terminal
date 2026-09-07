import { describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  ROLE_LABELS,
  notPresentLabel,
  roleLabel,
  stackLabel,
} from "@/components/levels/levelsLabels";

describe("roleLabel exhaustiveness", () => {
  it("covers every Role with a non-empty EN and ZH label", () => {
    expect(ALL_ROLES.length).toBeGreaterThan(0);
    for (const role of ALL_ROLES) {
      const pair = ROLE_LABELS[role];
      expect(pair.en.trim().length, `${role} EN`).toBeGreaterThan(0);
      expect(pair.zh.trim().length, `${role} ZH`).toBeGreaterThan(0);
      expect(roleLabel(role, "en"), `${role} EN via roleLabel`).toBe(pair.en);
      expect(roleLabel(role, "zh"), `${role} ZH via roleLabel`).toBe(pair.zh);
    }
  });

  it("never returns the raw role key", () => {
    for (const role of ALL_ROLES) {
      expect(roleLabel(role, "en")).not.toBe(role);
      expect(roleLabel(role, "zh")).not.toBe(role);
    }
    expect(roleLabel("call_wall", "en")).not.toBe("call_wall");
    expect(roleLabel("launchpad", "zh")).not.toBe("launchpad");
  });

  it("falls back to Not classified / 未分类 for an unknown role", () => {
    expect(roleLabel("not_a_role", "en")).toBe("Not classified");
    expect(roleLabel("not_a_role", "zh")).toBe("未分类");
    expect(roleLabel("", "en")).toBe("Not classified");
    expect(roleLabel("", "zh")).toBe("未分类");
  });
});

describe("stackLabel", () => {
  it("has non-empty EN and ZH and never returns a raw key", () => {
    expect(stackLabel("en").trim().length).toBeGreaterThan(0);
    expect(stackLabel("zh").trim().length).toBeGreaterThan(0);
    expect(stackLabel("en")).not.toBe("stack");
    expect(stackLabel("zh")).not.toBe("stack");
  });
});

describe("ZH register", () => {
  it("uses direction-neutral Backstop and Stack zone wording", () => {
    expect(ROLE_LABELS.counter.zh).toBe("后备位");
    expect(roleLabel("counter", "zh")).toBe("后备位");
    expect(stackLabel("zh")).toBe("堆叠区");
  });
});

describe("notPresentLabel", () => {
  it("is bilingual and never a raw key", () => {
    expect(notPresentLabel("en")).toBe("not present");
    expect(notPresentLabel("zh")).toBe("未出现");
  });
});
