// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { MemberCompare } from "@/components/prophet/sector/MemberCompare";
import { makeProphetSectorT } from "@/components/prophet/sector/prophetSectorStrings";
import { decodeProphetSectorMembers, type SectorMembersPayload } from "@/lib/prophetSectorMembers";

const language = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => language }));

type SymbolPayload = Extract<SectorMembersPayload, { mode: "symbol" }>;

function card(symbol: "ADP" | "CARR", sectorSession: string | null = "2026-11-10",
  prophetAsof: string | null = sectorSession,
  status: SymbolPayload["compatibility"]["status"] = "compatible"): SymbolPayload {
  const decoded = decodeProphetSectorMembers(JSON.parse(readFileSync(
    `public/data/prophet_sector_members_fixture/symbol_${symbol}.json`, "utf8")));
  if (decoded?.mode !== "symbol") throw new Error("Expected decoded symbol fixture");
  // Exercise the consumer's decoded clocks directly, independently of wire admission.
  return { ...decoded, compatibility: { ...decoded.compatibility, status, sectorSession, prophetAsof } };
}

function assertBanner(cards: (SymbolPayload | null)[], mixed: boolean) {
  const symbols = cards.map((payload, index) => payload?.symbol ?? `WAIT${index}`);
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<MemberCompare symbols={symbols}
    payloadOf={symbol => cards[symbols.indexOf(symbol)]}
    stateBlock={index => <p data-testid={`loading-${index}`}>Loading</p>}
    onBack={() => {}} onOpenMember={() => {}} />);
  const t = makeProphetSectorT(language.lang);
  expect(host.querySelector('[data-testid="prophet-sector-compare-banner"]')?.textContent)
    .toBe(t(mixed ? "compareMixedClocks" : "compareNoScore"));
  expect(host.querySelectorAll('[data-testid^="prophet-sector-compare-card-"]')).toHaveLength(cards.filter(Boolean).length);
  for (const payload of cards) {
    if (payload === null) continue;
    const clocks = host.querySelector(`[data-testid="prophet-sector-compare-clocks-${payload.symbol}"]`)?.textContent;
    expect(clocks).toContain(payload.compatibility.sectorSession ?? t("contextUnknown"));
    expect(clocks).toContain(payload.compatibility.prophetAsof ?? t("contextUnknown"));
  }
}

describe.each(["en", "zh"] as const)("C2 compare clock disclosure (%s)", lang => {
  it("uses the ordinary banner for compatible cards on the same session", () => {
    language.lang = lang;
    assertBanner([card("ADP"), card("CARR")], false);
  });

  it("warns for compatible cards on different sessions", () => {
    language.lang = lang;
    assertBanner([card("ADP"), card("CARR", "2026-11-12")], true);
  });

  it("warns when only sectorSession differs", () => {
    language.lang = lang;
    assertBanner([card("ADP"), card("CARR", "2026-11-12", "2026-11-10")], true);
  });

  it("warns when only prophetAsof differs", () => {
    language.lang = lang;
    assertBanner([card("ADP"), card("CARR", "2026-11-10", "2026-11-12")], true);
  });

  it("compares the two ready cards when a third card is not ready", () => {
    language.lang = lang;
    assertBanner([card("ADP"), null, card("CARR", "2026-11-12")], true);
  });

  it("does not infer a difference from unknown clocks alongside known clocks", () => {
    language.lang = lang;
    assertBanner([card("ADP", null, null, "sector_unavailable"), card("CARR")], false);
  });

  it.each(["stale_sector", "stale_prophet", "mixed_basis"] as const)("keeps the existing %s warning", status => {
    language.lang = lang;
    assertBanner([card("ADP", "2026-11-10", "2026-11-10", status), card("CARR")], true);
  });
});
