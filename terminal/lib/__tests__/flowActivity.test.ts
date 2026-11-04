import { describe, expect, it } from "vitest";
import { activityBarWidth, signedActivityLabel } from "../flowActivity";

describe("signedActivityLabel", () => {
  it("labels the reported TSLA daily prem_z -1.98 as below average, not Elevated", () => {
    expect(signedActivityLabel(-1.98, "en")).toBe("Below avg");
    expect(signedActivityLabel(-1.98, "zh")).toBe("低于均值");
  });

  it("labels every negative z below average in both languages", () => {
    for (const z of [-0.11, -0.75, -1, -2.02, -3.4, -99]) {
      expect(signedActivityLabel(z, "en")).toBe("Below avg");
      expect(signedActivityLabel(z, "zh")).toBe("低于均值");
    }
  });

  it("labels zero and -0 at average in both languages", () => {
    expect(signedActivityLabel(0, "en")).toBe("At avg");
    expect(signedActivityLabel(0, "zh")).toBe("等于均值");
    expect(signedActivityLabel(-0, "en")).toBe("At avg");
    expect(signedActivityLabel(-0, "zh")).toBe("等于均值");
  });

  it("labels every positive z above average in both languages", () => {
    for (const z of [0.11, 0.75, 1, 1.98, 2.02, 3.4, 99]) {
      expect(signedActivityLabel(z, "en")).toBe("Above avg");
      expect(signedActivityLabel(z, "zh")).toBe("高于均值");
    }
  });

  it("does not call missing or non-finite data Warming", () => {
    for (const z of [null, NaN, Infinity, -Infinity]) {
      expect(signedActivityLabel(z, "en")).toBe("Unavailable");
      expect(signedActivityLabel(z, "zh")).toBe("数据不足");
    }
  });

  it("keeps direction and language outputs distinct", () => {
    expect(signedActivityLabel(-1, "en")).not.toBe(signedActivityLabel(1, "en"));
    expect(signedActivityLabel(-1, "zh")).not.toBe(signedActivityLabel(1, "zh"));
    expect(signedActivityLabel(null, "en")).not.toBe(signedActivityLabel(0, "en"));
  });
});

describe("activityBarWidth", () => {
  it("maps z=5 to a full bar and scales linearly below it", () => {
    expect(activityBarWidth(5)).toBe(100);
    expect(activityBarWidth(2.5)).toBe(50);
    expect(activityBarWidth(1)).toBe(20);
    expect(activityBarWidth(0.03)).toBe(1);
  });

  it("gives negative, zero, missing and non-finite z no bar", () => {
    for (const z of [-1.98, -5, -0, 0, null, NaN, Infinity, -Infinity]) {
      expect(activityBarWidth(z)).toBe(0);
    }
  });

  it("stays finite within 0..100 across the whole signed range", () => {
    for (let z = -20; z <= 20; z += 0.01) {
      const w = activityBarWidth(z);
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(100);
    }
  });
});

