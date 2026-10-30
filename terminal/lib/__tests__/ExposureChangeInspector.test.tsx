// @vitest-environment jsdom
/**
 * W1C reported-Gamma change inspector — presentational contract: populations,
 * aggregate and rows in both languages, one status note per non-data state,
 * strike selection, the appended focus row, and no banned vocabulary rendered
 * in any state, in either language.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import ExposureChangeInspector from "@/components/exposure-map/ExposureChangeInspector";
import {
  BANNED_VOCABULARY_EN,
  BANNED_VOCABULARY_ZH,
} from "@/components/exposure-map/exposureChangeInspectorStrings";
import { buildChangeInspector, type ChangeInspectorModel } from "@/lib/exposureChangeInspector";
import {
  compareReportedGamma,
  type ReportedGammaChange,
  type ReportedGammaMember,
  type ReportedGammaSnapshot,
} from "@/lib/exposureReportedChange";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = "root-01";
const SECURITY = "SEC-X";
const EXPIRY = "2026-04-17";
const ORIGIN_MS = Date.parse("2026-03-21T12:00:00Z");
const PREVIOUS_SESSION = "2026-03-19";
const CURRENT_SESSION = "2026-03-20";
const SESSIONS = { previousSession: PREVIOUS_SESSION, currentSession: CURRENT_SESSION };

let sourceKeyCounter = 0;

function snapshot(
  overrides: Partial<ReportedGammaSnapshot> & { members?: ReportedGammaMember[] },
): ReportedGammaSnapshot {
  sourceKeyCounter += 1;
  return {
    root: ROOT,
    securityId: SECURITY,
    sourceSession: "2026-03-20",
    sourceKey: `vintage:${sourceKeyCounter}`,
    definitionKey: "reported_gamma/v1",
    scopeKey: "root:SEC-X:reported",
    availableAt: "2026-03-20T21:00:00Z",
    oiReportDate: "2026-03-20",
    oiPositionSession: "2026-03-20T16:15:00-04:00",
    correctionRef: null,
    members: [],
    ...overrides,
  };
}

function member(strike: number, right: "C" | "P", valueUsd: number | null): ReportedGammaMember {
  return { expiry: EXPIRY, strike, right, valueUsd };
}

function previousOf(
  members: ReportedGammaMember[],
  overrides: Partial<ReportedGammaSnapshot> = {},
): ReportedGammaSnapshot {
  return snapshot({
    sourceSession: PREVIOUS_SESSION,
    availableAt: "2026-03-19T21:00:00Z",
    oiReportDate: PREVIOUS_SESSION,
    members,
    ...overrides,
  });
}

function currentOf(
  members: ReportedGammaMember[],
  overrides: Partial<ReportedGammaSnapshot> = {},
): ReportedGammaSnapshot {
  return snapshot({ members, ...overrides });
}

function compared(previous: ReportedGammaSnapshot, current: ReportedGammaSnapshot): ReportedGammaChange {
  return compareReportedGamma(current, previous, ORIGIN_MS);
}

type DataChange = Extract<ReportedGammaChange, { state: "data" }>;

// Matched 100/120, a qualification gain (110), previous-only 150, current-only 140.
const POPULATED_CHANGE = compared(
  previousOf([member(100, "C", 1000), member(110, "C", null), member(120, "P", 3000), member(150, "C", 5000)]),
  currentOf([member(100, "C", 2000), member(110, "C", 3000), member(120, "P", 1000), member(140, "C", 4000)]),
) as DataChange;

// Ten matched strikes so the top-K cut and the appended focus row both bite.
const PREVIOUS_TEN: ReportedGammaMember[] = [
  member(100, "C", 1000),
  member(105, "C", 5000),
  member(110, "P", 2000),
  member(115, "P", 4000),
  member(120, "P", 0),
  member(125, "C", 700),
  member(130, "C", 500),
  member(135, "C", 500),
  member(140, "P", -2000),
  member(145, "C", 300),
];
const CURRENT_TEN: ReportedGammaMember[] = [
  member(100, "C", 9000),
  member(105, "C", -4500),
  member(110, "P", 4000),
  member(115, "P", 2000),
  member(120, "P", 100),
  member(125, "C", 701),
  member(130, "C", 500.4),
  member(135, "C", 500.5),
  member(140, "P", -9000),
  member(145, "C", -100),
];
const TEN_STRIKE_CHANGE = compared(previousOf(PREVIOUS_TEN), currentOf(CURRENT_TEN)) as DataChange;

const DATA_MODEL = buildChangeInspector({ ...SESSIONS, change: POPULATED_CHANGE });
const MALFORMED_CHANGE: DataChange = {
  ...POPULATED_CHANGE,
  aggregate: { ...POPULATED_CHANGE.aggregate, contracts: Number.NaN },
};

// One model per non-data state/reason, with its status note and data-state.
function nonDataCases(): Array<[ChangeInspectorModel, string, string]> {
  return [
    [
      buildChangeInspector({ change: null, currentSession: CURRENT_SESSION, previousSession: null }),
      "Only one reported session is available; a comparison needs two.",
      "single_session",
    ],
    [
      buildChangeInspector({ change: null, currentSession: CURRENT_SESSION, previousSession: PREVIOUS_SESSION }),
      "No earlier reported session to match.",
      "unavailable",
    ],
    [
      buildChangeInspector({
        ...SESSIONS,
        change: compared(previousOf([member(100, "C", 1000)], { root: "root-02" }), currentOf([member(100, "C", 1000)])),
      }),
      "The two sessions describe different instruments.",
      "unavailable",
    ],
    [
      buildChangeInspector({
        ...SESSIONS,
        change: compared(
          previousOf([member(100, "C", 1000)], { scopeKey: "root:SEC-X:other" }),
          currentOf([member(100, "C", 1000)]),
        ),
      }),
      "The two sessions use a different scope.",
      "unavailable",
    ],
    [
      buildChangeInspector({
        ...SESSIONS,
        change: compared(
          previousOf([member(100, "C", 1000)], { definitionKey: "reported_gamma/v2" }),
          currentOf([member(100, "C", 1000)]),
        ),
      }),
      "The two sessions use a different definition.",
      "unavailable",
    ],
    [
      buildChangeInspector({
        ...SESSIONS,
        change: compared(currentOf([member(100, "C", 1000)]), currentOf([member(100, "C", 1200)])),
      }),
      "The sessions are out of order or undated.",
      "unavailable",
    ],
    [
      buildChangeInspector({
        ...SESSIONS,
        change: compared(previousOf([member(100, "C", 1000)]), currentOf([member(100, "C", Number.NaN)])),
      }),
      "The source records could not be read.",
      "unavailable",
    ],
    [
      buildChangeInspector({
        ...SESSIONS,
        change: compared(previousOf([member(200, "C", 1000)]), currentOf([member(100, "C", 1000)])),
      }),
      "No contract appears on both sessions.",
      "unavailable",
    ],
    [buildChangeInspector({ ...SESSIONS, change: MALFORMED_CHANGE }), "The comparison record could not be read.", "invalid"],
  ];
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function renderPanel(
  model: ChangeInspectorModel,
  lang: "en" | "zh" = "en",
  props: { selectedStrike?: number | null; onSelectStrike?: (strike: number) => void } = {},
): void {
  act(() => {
    root.render(<ExposureChangeInspector model={model} lang={lang} {...props} />);
  });
}

const panel = () => document.querySelector<HTMLElement>("[data-testid=exposure-change-inspector]")!;

function cellValue(label: string): string | undefined {
  const cell = Array.from(panel().querySelectorAll("div")).find((candidate) => {
    const span = Array.from(candidate.children).find(child => child.tagName === "SPAN");
    const strong = Array.from(candidate.children).find(child => child.tagName === "STRONG");
    return span?.textContent === label && strong !== undefined;
  });
  return cell?.querySelector("strong")?.textContent ?? undefined;
}

describe("ExposureChangeInspector", () => {
  it("renders the data state with populations, aggregate and rows in English and Chinese", () => {
    renderPanel(DATA_MODEL);
    expect(panel().getAttribute("data-state")).toBe("data");
    expect(panel().querySelector("h3")?.textContent).toBe("What changed in reported Gamma?");
    expect(cellValue("Matched")).toBe("2");
    expect(cellValue("Only in previous")).toBe("1");
    expect(cellValue("Only in current")).toBe("1");
    expect(cellValue("Lost qualification")).toBe("0");
    expect(cellValue("Gained qualification")).toBe("1");
    expect(cellValue("Net change")).toBe("−$1K");
    expect(cellValue("Net magnitude change")).toBe("−$1K");
    expect(cellValue("Gross change")).toBe("−$1K");
    expect(panel().textContent).toContain("2 contracts matched");
    expect(panel().textContent).toContain("Counted separately; never added into the change.");
    expect(Array.from(panel().querySelectorAll("th")).map(th => th.textContent)).toEqual([
      "Strike",
      "Net change",
      "Net magnitude change",
      "Gross change",
      "Previous net → Current net",
    ]);
    const buttons = Array.from(panel().querySelectorAll("tbody button"));
    expect(buttons.map(button => button.textContent)).toEqual(["120", "100"]);
    expect(buttons.map(button => button.getAttribute("aria-label"))).toEqual(["Select strike 120", "Select strike 100"]);

    renderPanel(DATA_MODEL, "zh");
    expect(panel().querySelector("h3")?.textContent).toBe("报告 Gamma 有何变化？");
    expect(cellValue("已匹配")).toBe("2");
    expect(cellValue("仅前一交易日")).toBe("1");
    expect(cellValue("净变化")).toBe("−$1K");
    expect(panel().textContent).toContain("匹配 2 份合约");
    expect(panel().textContent).toContain("分别计数，不计入变化量。");
    expect(Array.from(panel().querySelectorAll("tbody button")).map(button => button.getAttribute("aria-label"))).toEqual([
      "选择行权价 120",
      "选择行权价 100",
    ]);
  });

  it("renders each non-data state with its status note and the velocity note", () => {
    for (const [model, expectedNote, state] of nonDataCases()) {
      renderPanel(model);
      expect(panel().getAttribute("data-state"), expectedNote).toBe(state);
      expect(panel().querySelector("[role=status]")?.textContent, expectedNote).toBe(expectedNote);
      expect(panel().textContent).toContain("no rate, no percent, no attribution");
      expect(panel().querySelector("table")).toBeNull();
      expect(panel().querySelector("strong")).toBeNull(); // withdrawn states show no figures
    }
    renderPanel(buildChangeInspector({ change: null, currentSession: CURRENT_SESSION, previousSession: null }), "zh");
    expect(panel().querySelector("[role=status]")?.textContent).toBe("仅有一个交易日的数据，比较需要两个。");
    expect(panel().textContent).toContain("仅两个交易日：不计算速率、百分比或归因。");
  });

  it("marks the selected strike pressed and calls onSelectStrike with the strike", () => {
    const onSelectStrike = vi.fn();
    renderPanel(DATA_MODEL, "en", { selectedStrike: 100, onSelectStrike });
    const pressed = panel().querySelectorAll("button[aria-pressed=true]");
    expect(pressed).toHaveLength(1);
    expect(pressed[0].textContent).toBe("100");
    const unselected = panel().querySelectorAll<HTMLButtonElement>("button[aria-pressed=false]");
    expect(unselected).toHaveLength(1);
    act(() => unselected[0].click());
    expect(onSelectStrike).toHaveBeenCalledTimes(1);
    expect(onSelectStrike).toHaveBeenCalledWith(120);
    renderPanel(DATA_MODEL, "en", { selectedStrike: null, onSelectStrike });
    expect(panel().querySelectorAll("button[aria-pressed=true]")).toHaveLength(0);
  });

  it("flags the appended focus row and the more-strikes note", () => {
    renderPanel(buildChangeInspector({ ...SESSIONS, change: TEN_STRIKE_CHANGE, topK: 4, focusStrike: 145 }));
    const flagged = panel().querySelectorAll("tr[data-focus]");
    expect(flagged).toHaveLength(1);
    expect(flagged[0].querySelector("button")?.textContent).toBe("145");
    expect(panel().querySelectorAll("tbody tr")).toHaveLength(5); // top 4 + the appended focus row
    expect(panel().textContent).toContain("6 more strikes");
    expect(panel().textContent).toContain("Selected strike shown below the largest changes.");
  });

  it("renders no banned vocabulary in either language", () => {
    // Every state, both languages, both banned-vocabulary regexes.
    const models: ChangeInspectorModel[] = [DATA_MODEL, ...nonDataCases().map(([model]) => model)];
    for (const model of models) {
      for (const lang of ["en", "zh"] as const) {
        renderPanel(model, lang);
        expect(BANNED_VOCABULARY_EN.test(panel().textContent ?? ""), `${model.state}/${lang}`).toBe(false);
        expect(BANNED_VOCABULARY_ZH.test(panel().textContent ?? ""), `${model.state}/${lang}`).toBe(false);
      }
    }
  });
});
