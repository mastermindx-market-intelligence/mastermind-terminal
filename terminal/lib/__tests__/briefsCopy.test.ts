import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRIEFS_COPY,
  BRIEFS_ROUTE_MESSAGES,
  briefCopy,
  degradedLine,
} from "@/lib/briefs";

describe("briefs copy is a plain sentence in EN and ZH", () => {
  it("carries the R4 email-null sentence verbatim", () => {
    expect(briefCopy("emailNull", "en")).toBe(
      "Briefs appear here in the Terminal. Email delivery isn't available yet.",
    );
    expect(briefCopy("emailNull", "zh")).toBe("简报会出现在终端里。邮件送达尚未开通。");
  });

  it("carries the R6 degraded line for the nightly and weekly cadence", () => {
    expect(degradedLine("daily_after_us_close", "en")).toBe(
      "Tonight's brief didn't run — the market read it uses wasn't rebuilt. Nothing has been recalculated.",
    );
    expect(degradedLine("daily_after_us_close", "zh")).toBe(
      "今晚的简报没有生成——它所依据的市场解读没有重建。没有任何内容被重新计算。",
    );
    expect(degradedLine("weekly_saturday", "en")).toBe(
      "This week's brief didn't run — the market read it uses wasn't rebuilt. Nothing has been recalculated.",
    );
    expect(degradedLine("weekly_saturday", "zh")).toBe(
      "本周的简报没有生成——它所依据的市场解读没有重建。没有任何内容被重新计算。",
    );
  });

  it("carries the empty-state sentence", () => {
    expect(briefCopy("empty", "en")).toBe(
      "No briefs yet — subscribe a thesis or watchlist to get one after the next close.",
    );
    expect(briefCopy("empty", "zh")).toBe("还没有简报。订阅一份论点或观察列表，下次收盘后就会收到。");
  });

  it("never leaks a cadence or state slug", () => {
    const values = [
      ...Object.values(BRIEFS_COPY).flat(),
      ...Object.values(BRIEFS_ROUTE_MESSAGES).flat(),
    ];
    for (const text of values) {
      expect(text).not.toMatch(/daily_after_us_close|weekly_saturday|in_product_inbox/);
      expect(text).not.toMatch(/\bready\b|\bdegraded\b/);
    }
  });

  it("uses 你, never 您", () => {
    const src = readFileSync(join(__dirname, "../briefs.ts"), "utf8");
    expect(src).not.toContain("您");
  });

  it("409 duplicate copy is a plain sentence, not 对象 or 节奏", () => {
    expect(BRIEFS_ROUTE_MESSAGES.duplicate[0]).toBe(
      "You already have a brief on this schedule for this thesis or watchlist.",
    );
    expect(BRIEFS_ROUTE_MESSAGES.duplicate[1]).toBe(
      "你已经为这份论点或观察列表订阅了同一安排的简报。",
    );
    expect(BRIEFS_ROUTE_MESSAGES.duplicate[1]).not.toMatch(/对象|节奏/);
    expect(BRIEFS_ROUTE_MESSAGES.duplicate.join("\n")).not.toMatch(/\bcadence\b|target_kind|target_id/);
  });
});
