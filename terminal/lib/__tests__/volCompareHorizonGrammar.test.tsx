// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { VolComparePanel } from "@/components/vol/VolComparePanel";

// Copy grammar must follow the computed weekday horizon, without changing the
// move estimate, source clock, or approximation and missing-spot disclosures.
for (const days of [1, 2]) {
  for (const lang of ["en", "zh"] as const) {
    it(`${lang}: ${days}-day horizon retains the dated move and honest disclosures`, async () => {
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            <VolComparePanel
              term={[{ dte: 10, exp: "2026-11-02", atm_iv: 33 }]}
              smile={[]}
              asof="2026-10-23"
              selectedExp="2026-11-02"
              today={days === 1 ? "2026-10-30" : "2026-10-29"}
              lang={lang}
            />,
          );
        });
        const move = container.querySelector('[data-testid="vol-compare-move"]');
        expect(move).not.toBeNull();
        const text = move!.textContent!;
        const label = [...move!.querySelectorAll("dt")].find(
          (item) => item.textContent === (lang === "en" ? "Horizon" : "区间长度"),
        );
        expect(label).toBeDefined();
        const horizon = label!.nextElementSibling!.textContent!;
        const expected = lang === "en"
          ? `${days} trading ${days === 1 ? "day" : "days"} · ${days === 1 ? "30" : "29"} Oct → 2 Nov close weekdays, exchange holidays not subtracted`
          : `${days} 个交易日 · 10月${days === 1 ? "30" : "29"}日 → 11月2日 收盘 按工作日计算，未扣除交易所假期`;
        expect(horizon).toBe(expected);
        expect(text).toContain(days === 1 ? "±2.1 %" : "±2.9 %");
        for (const disclosure of lang === "en"
          ? ["no confidence level is attached", "declared approximation", "23 Oct nightly EOD", "no spot supplied"]
          : ["不附带任何置信水平", "已声明的近似方法", "10月23日 每晚收盘", "未提供现价"]) {
          expect(text).toContain(disclosure);
        }
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    });
  }
}
