// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmergenceMark } from "../../components/sector-intelligence/depth/EmergenceMark";
import { SECTOR_DEPTH_LEX } from "../sectorDepthLex";
import {
  boardTotals,
  columnPreview,
  foldSixToFive,
  type ActionBoardData,
  type BoardLaneKey,
  type CallRow,
} from "../sectorDepthCalls";
import callsContractFixture from "./fixtures/sectorDepthCallsContract.v1.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HREF = "company/SYN_EVIDENCE.html";

let host: HTMLDivElement;
let root: Root;

const render = async (props: React.ComponentProps<typeof EmergenceMark>) =>
  act(async () => root.render(<EmergenceMark {...props} />));

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  root = null as unknown as Root;
  vi.restoreAllMocks();
});

describe("EmergenceMark — owner-carried gating law (R6-09)", () => {
  it.each([
    ["absent", undefined],
    ["null", null],
    ["false", false],
  ])("renders nothing when the flag is %s (block and chip)", async (_name, flag) => {
    await render({ emerging: flag, href: HREF, variant: "block" });
    expect(host.querySelector("[data-emergence]")).toBeNull();
    expect(host.textContent).toBe("");
    await render({ emerging: flag, href: HREF, variant: "chip" });
    expect(host.querySelector("[data-emergence]")).toBeNull();
  });

  it("renders the R6-09 anatomy only for an explicit owner true", async () => {
    await render({ emerging: true, href: HREF });
    const block = host.querySelector('[data-emergence="block"]');
    expect(block).not.toBeNull();
    expect(host.textContent).toContain("Independent emergence");
    expect(host.textContent).toContain("Company strength is early");
    expect(host.textContent).toContain(
      "Sector support is weak; original company evidence remains available. Entry qualification is separate.",
    );
  });

  it("carries no number in any rendered locale-agnostic copy (the flag is boolean-only)", async () => {
    await render({ emerging: true, href: HREF });
    expect(host.textContent).toMatch(/→$/); // evidence action present
    expect(host.textContent!.replace("→", "")).not.toMatch(/\d/);
  });
});

describe("EmergenceMark — evidence destination routing", () => {
  it("routes the carried href verbatim through onNavigate when present", async () => {
    const onNavigate = vi.fn();
    await render({ emerging: true, href: HREF, onNavigate });
    const btn = host.querySelector<HTMLButtonElement>('[data-emergence-link]');
    expect(btn?.tagName).toBe("BUTTON");
    await act(async () => btn!.click());
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(HREF);
  });

  it("falls back to an exact-anchor link with the carried href", async () => {
    await render({ emerging: true, href: HREF });
    const anchor = host.querySelector<HTMLAnchorElement>('[data-emergence-link]');
    expect(anchor?.tagName).toBe("A");
    expect(anchor?.getAttribute("href")).toBe(HREF);
  });

  it("renders copy but NO link when the owner carries no destination — never an invented href", async () => {
    await render({ emerging: true });
    expect(host.querySelector('[data-emergence="block"]')).not.toBeNull();
    expect(host.textContent).toContain("Company strength is early");
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("[data-emergence-link]")).toBeNull();
  });

  it("rejects an empty-string href exactly like an absent one", async () => {
    await render({ emerging: true, href: "" });
    expect(host.querySelector("[data-emergence-link]")).toBeNull();
  });
});

describe("EmergenceMark — chip variant (dense member lines)", () => {
  it("is a tag with the headline tooltip and no link when no destination is carried", async () => {
    await render({ emerging: true, variant: "chip" });
    const chip = host.querySelector<HTMLElement>('[data-emergence="chip"]');
    expect(chip?.tagName).toBe("SPAN");
    expect(chip?.getAttribute("title")).toBe("Company strength is early");
    expect(chip?.textContent).toBe("Independent emergence");
    expect(host.querySelector("[data-emergence-link]")).toBeNull();
  });

  it("becomes the evidence link itself when a destination is carried", async () => {
    const onNavigate = vi.fn();
    await render({ emerging: true, href: HREF, variant: "chip", onNavigate });
    const chip = host.querySelector<HTMLButtonElement>('[data-emergence="chip"]');
    expect(chip?.tagName).toBe("BUTTON");
    expect(chip?.getAttribute("data-emergence-link")).toBe(HREF);
    await act(async () => chip!.click());
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(HREF);
  });
});

describe("siEmerg* lex law — EN/ZH authored together, number-free", () => {
  const KEYS = ["siEmergKicker", "siEmergHeadline", "siEmergBody", "siEmergEvidence"] as const;

  it.each(KEYS)("%s exists with non-empty EN and ZH", (key) => {
    const pair = SECTOR_DEPTH_LEX[key];
    expect(pair).toBeDefined();
    expect(pair[0].trim().length).toBeGreaterThan(0);
    expect(pair[1].trim().length).toBeGreaterThan(0);
  });

  it.each(KEYS)("%s carries no digit and no placeholder in either locale", (key) => {
    const [en, zh] = SECTOR_DEPTH_LEX[key];
    for (const s of [en, zh]) {
      expect(s).not.toMatch(/\d/);
      expect(s).not.toContain("{");
    }
  });
});

describe("qualification invariance — the flag never moves a row or changes a count", () => {
  const base = callsContractFixture as unknown as { action_board: ActionBoardData };
  const flagged = (): ActionBoardData => {
    const clone = structuredClone(base.action_board) as ActionBoardData;
    for (const lane of Object.values(clone.lanes)) {
      lane.rows = lane.rows.map((row: CallRow) => ({
        ...row,
        emerging: true,
        emergence_href: HREF,
      }));
    }
    return clone;
  };
  const LANES: BoardLaneKey[] = [
    "buy_now",
    "buy_soon",
    "on_the_run",
    "take_profits",
    "stand_aside",
  ];

  it("board totals, folding and preview slices are identical with every row flagged", () => {
    expect(JSON.stringify(boardTotals(flagged()))).toBe(JSON.stringify(boardTotals(base.action_board)));
    const foldedA = foldSixToFive(base.action_board.lanes);
    const foldedB = foldSixToFive(flagged().lanes);
    for (const key of LANES) {
      // The flag must not move a row: same placement, same order, same
      // qualified/locked counts, identical qualification-relevant fields.
      expect(foldedB[key].total).toBe(foldedA[key].total);
      expect(foldedB[key].locked).toBe(foldedA[key].locked);
      expect(foldedB[key].rows.length).toBe(foldedA[key].rows.length);
      expect(foldedB[key].rows.map((r) => r.ticker)).toEqual(foldedA[key].rows.map((r) => r.ticker));
      expect(foldedB[key].rows.map((r) => r.reco)).toEqual(foldedA[key].rows.map((r) => r.reco));
      expect(foldedB[key].rows.map((r) => r.kind)).toEqual(foldedA[key].rows.map((r) => r.kind));
      expect(foldedB[key].rows.map((r) => r.eligible)).toEqual(
        foldedA[key].rows.map((r) => r.eligible),
      );
      const a = columnPreview(key, foldedA[key].rows, false);
      const b = columnPreview(key, foldedB[key].rows, false);
      expect(b.hidden).toBe(a.hidden);
      expect(b.shown.map((r) => r.ticker)).toEqual(a.shown.map((r) => r.ticker));
      expect(b.shown.map((r) => r.reco)).toEqual(a.shown.map((r) => r.reco));
    }
  });
});
