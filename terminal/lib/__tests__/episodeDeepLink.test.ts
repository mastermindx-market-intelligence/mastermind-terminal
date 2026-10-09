import { describe, it, expect } from "vitest";
import {
  canonicalEpisodeId,
  episodeChartHref,
  EPISODE_ID_RE,
} from "@/lib/dislocations/episodeDeepLink";
import { canonicalChartSymbol } from "@/lib/terminalBoot";

describe("canonicalEpisodeId", () => {
  it("accepts valid ids", () => {
    expect(canonicalEpisodeId("ep-nvda-candidate")).toBe("ep-nvda-candidate");
    expect(canonicalEpisodeId("le:AAPL:2026-10-05T14:35Z")).toBe(
      "le:AAPL:2026-10-05T14:35Z",
    );
    expect(canonicalEpisodeId(" ep-1234 ")).toBe("ep-1234");
  });

  it("rejects invalid ids", () => {
    expect(canonicalEpisodeId("abc")).toBeNull();
    expect(canonicalEpisodeId("a".repeat(129))).toBeNull();
    expect(canonicalEpisodeId("-leading")).toBeNull();
    expect(canonicalEpisodeId("has space")).toBeNull();
    expect(canonicalEpisodeId("<script>")).toBeNull();
    expect(canonicalEpisodeId(42)).toBeNull();
    expect(canonicalEpisodeId(null)).toBeNull();
  });

  it("EPISODE_ID_RE is exported", () => {
    expect(EPISODE_ID_RE.test("ep-1234")).toBe(true);
  });
});

describe("episodeChartHref", () => {
  it("builds href from canonical symbol and episode id", () => {
    const sym = "nvda";
    const canon = canonicalChartSymbol(sym);
    expect(canon).not.toBeNull();
    const href = episodeChartHref(sym, "ep-1234");
    expect(href).toBe(
      `/terminal?sym=${encodeURIComponent(canon!)}&episode=${encodeURIComponent("ep-1234")}`,
    );
  });

  it("null when episode id invalid", () => {
    expect(episodeChartHref("NVDA", "abc")).toBeNull();
  });

  it("null when symbol invalid", () => {
    expect(episodeChartHref("", "ep-1234")).toBeNull();
    expect(episodeChartHref("not valid symbol!!", "ep-1234")).toBeNull();
  });
});
