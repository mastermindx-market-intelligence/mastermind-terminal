// @vitest-environment jsdom
//
// Lane C company-case unit coverage: the setup lexicon's invariants (every
// key a full EN/ZH pair), the pure helpers (fill, signed-percent formatting),
// and the stateful pieces — the one unavailable card + study list (T2-C5), the
// closed model-plan row (P0-1: no trade ticket), and the Save/Follow states
// (T2-20, including the P2-1/P2-6 interaction fixes).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/lib/useProphetObservation", () => ({ useProphetObservation: vi.fn() }));
vi.mock("@/components/chrome/AppShell", () => ({
  useShellIdentity: () => ({ kind: "account", userId: "u1", email: "unit@example.com" }),
}));
import { CaseUnavailable, StudyLinks } from "@/components/prophet/setup/CaseUnavailable";
import { ModelPlanRail } from "@/components/prophet/setup/ModelPlanRail";
import { SaveFollow } from "@/components/prophet/setup/SaveFollow";
import { handleCaseBackClick } from "@/components/prophet/setup/CaseHeader";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  SETUP_LEX, fmtSignedPct, makeSetupT, setupFill,
} from "@/components/prophet/setup/setupStrings";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}
function text(): string {
  return container?.innerText ?? container?.textContent ?? "";
}
async function click(selector: string) {
  const button = container!.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => { button!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null; root = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("case return link gestures", () => {
  it("intercepts only an unmodified primary click that is not already prevented", () => {
    for (const override of [{}, { button: 1 }, { metaKey: true }, { ctrlKey: true },
      { shiftKey: true }, { altKey: true }, { defaultPrevented: true }]) {
      const onBack = vi.fn();
      const preventDefault = vi.fn();
      const event = { button: 0, defaultPrevented: false, metaKey: false,
        ctrlKey: false, shiftKey: false, altKey: false, preventDefault, ...override };
      handleCaseBackClick(event as unknown as ReactMouseEvent<HTMLAnchorElement>, onBack);
      const intercepted = Object.keys(override).length === 0;
      expect(preventDefault).toHaveBeenCalledTimes(intercepted ? 1 : 0);
      expect(onBack).toHaveBeenCalledTimes(intercepted ? 1 : 0);
    }
  });
});

describe("setup lexicon invariants", () => {
  it("every key is a complete EN/ZH pair with non-empty strings", () => {
    for (const [key, entry] of Object.entries(SETUP_LEX)) {
      expect(Array.isArray(entry), key).toBe(true);
      expect(entry, key).toHaveLength(2);
      expect((entry as readonly string[])[0].length, `${key} EN`).toBeGreaterThan(0);
      expect((entry as readonly string[])[1].length, `${key} ZH`).toBeGreaterThan(0);
    }
  });

  it("makeSetupT selects by language and setupFill substitutes placeholders", () => {
    expect(makeSetupT("en")("tabEvidence")).toBe("Evidence");
    expect(makeSetupT("zh")("tabEvidence")).toBe("证据");
    expect(setupFill(makeSetupT("en")("studyIntro"), { group: "Industrials", n: 20 }))
      .toContain("Industrials");
    expect(setupFill(makeSetupT("en")("studyIntro"), { group: "Industrials", n: 20 }))
      .toContain("20");
    expect(setupFill("{missing} stays", {})).toBe(" stays");
  });

  it("keeps the reader vocabulary contract (P1-5): no internal words in EN copy", () => {
    const banned = /not served|in this read|board read|\bPIT\b|\(s\)|group\(s\)/i;
    for (const [key, entry] of Object.entries(SETUP_LEX)) {
      expect((entry as readonly string[])[0], key).not.toMatch(banned);
    }
  });

  it("never labels a plan or observation date as an assessment (P1-4)", () => {
    for (const key of ["planRowOpened", "cardObserved"] as const) {
      expect(makeSetupT("en")(key)).not.toMatch(/assessment/i);
    }
  });
});

describe("fmtSignedPct", () => {
  it("carries sign and one decimal, or the honest dash", () => {
    expect(fmtSignedPct(6.6931)).toBe("+6.7%");
    expect(fmtSignedPct(-5.5589)).toBe("-5.6%");
    expect(fmtSignedPct(0)).toBe("0.0%");
    expect(fmtSignedPct(null)).toBe("—");
    expect(fmtSignedPct(Number.NaN)).toBe("—");
  });
});

describe("CaseUnavailable (T2-C5)", () => {
  it("says what is missing once, with the one real date labeled by its source", () => {
    mount(<CaseUnavailable symbol="CARR" observedAsof={null} lang="en" />);
    const body = text();
    expect(body).toContain("Research case unavailable");
    expect(body).toContain("has not published a case for CARR");
    for (const row of ["Verdict headline", "Research family", "Supports and challenges", "Next check", "Entry assessment"]) {
      expect(body, row).toContain(row);
    }
    expect(body).toContain("Not available");
    expect(body).toContain("Unavailable");     // the entry row, in warn ink
    expect(body).not.toMatch(/assessment 2026|in this read|not served/i);
    expect(container!.querySelector('[data-testid="case-unavailable-dates"]')).toBeNull();
  });

  it("states the observation date under an explicit label, never as an assessment", () => {
    mount(<CaseUnavailable symbol="ADP" observedAsof="2026-11-06" lang="en" />);
    const dates = container!.querySelector('[data-testid="case-unavailable-dates"]')!;
    expect(dates.textContent).toBe("Latest observation 2026-11-06");
  });

  it("offers the three served destinations from the study list", async () => {
    const onTab = vi.fn();
    const onOpenSources = vi.fn();
    mount(
      <StudyLinks
        symbol="CARR"
        chartHref="/company/CARR"
        onTab={onTab}
        onOpenSources={onOpenSources}
        lang="en"
      />,
    );
    expect(text()).toContain("You can still study");
    expect(text()).toContain("Company evidence");
    expect(text()).toContain("Context and peers");
    expect(text()).toContain("Sources & method");
    await click('[data-testid="study-link-evidence"]');
    expect(onTab).toHaveBeenCalledWith("evidence");
    await click('[data-testid="study-link-context"]');
    expect(onTab).toHaveBeenCalledWith("context");
    await click('[data-testid="study-link-sources"]');
    expect(onOpenSources).toHaveBeenCalledTimes(1);
    expect(container!.querySelector('[data-testid="prophet-sector-chart-link"]')?.getAttribute("href"))
      .toBe("/company/CARR");
  });
});

describe("ModelPlanRail (P0-1: no trade ticket)", () => {
  it("renders one closed row that names the plan and links to Plans", () => {
    mount(
      <ModelPlanRail
        symbol="CARR"
        tab="setup"
        planId="CARR-BULL-20261016"
        planOpenedOn="2026-10-20"
        plansHref="/options?tab=prophet&prophetPlan=CARR-BULL-20261016"
        boardPhase="ready"
        onRetryBoard={() => {}}
        lang="en"
      />,
    );
    const body = text();
    expect(body).toContain("Original model plan · CARR-BULL-20261016");
    expect(body).toContain("Opened 2026-10-20.");
    expect(body).toContain("not permission to trade");
    const link = container!.querySelector('[data-testid="prophet-sector-plan-link"]')!;
    expect(link.getAttribute("href")).toBe("/options?tab=prophet&prophetPlan=CARR-BULL-20261016");
    // The trade ticket is gone: no prices, no R multiples, no conviction, no
    // sizing copy, and no expanded plan detail on this surface.
    expect(body).not.toContain("52.26");
    expect(body).not.toContain("62.78");
    expect(body).not.toMatch(/conviction/i);
    expect(body).not.toMatch(/size down/i);
    expect(body).not.toMatch(/\d\.\d+R\b/);
    expect(container!.querySelector("details")).toBeNull();
    expect(container!.querySelector('[data-testid="prophet-sector-plan-unavailable"]')).toBeNull();
  });

  it("offers Browse model plans when no plan is open", () => {
    mount(
      <ModelPlanRail
        symbol="ADP"
        tab="setup"
        planId={null}
        planOpenedOn={null}
        plansHref="/options?tab=prophet"
        boardPhase="idle"
        onRetryBoard={() => {}}
        lang="en"
      />,
    );
    expect(text()).toContain("No model plan is open for this name.");
    expect(container!.querySelector('[data-testid="prophet-sector-plan-link"]')?.textContent)
      .toContain("Browse model plans");
  });

  it("keeps a failed read honest: plan terms unavailable, status unknown, retry", async () => {
    const onRetry = vi.fn();
    mount(
      <ModelPlanRail
        symbol="CARR"
        tab="setup"
        planId="CARR-BULL-20261016"
        planOpenedOn="2026-10-20"
        plansHref="/options?tab=prophet"
        boardPhase="unavailable"
        onRetryBoard={onRetry}
        lang="en"
      />,
    );
    const body = text();
    expect(body).toContain("Plan terms unavailable");
    expect(body).toContain("Status unknown");
    expect(body).toContain("loading failure, not a missing plan");
    expect(body).not.toContain("CARR-BULL-20261016");
    expect(body).not.toMatch(/board read/i);
    await click('[data-testid="prophet-sector-plan-retry"]');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders no rail on Evidence or Context", () => {
    mount(
      <ModelPlanRail
        symbol="CARR"
        tab="context"
        planId="CARR-BULL-20261016"
        planOpenedOn="2026-10-20"
        plansHref="/options?tab=prophet"
        boardPhase="ready"
        onRetryBoard={() => {}}
        lang="en"
      />,
    );
    expect(container!.innerHTML).toBe("");
  });
});

describe("SaveFollow states (T2-20, P2-1 / P2-6)", () => {
  it("rides the existing watchlist endpoint and confirms with the no-alerts footnote", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("{\"ok\":true}", { status: 200, headers: { "content-type": "application/json" } }));
    mount(<SaveFollow symbol="CARR" />);
    await click('[data-testid="save-security"]');
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("/api/watchlist");
    expect(JSON.parse(String(init?.body))).toEqual({ action: "add", symbol: "CARR", section: "prophet" });
    const body = text();
    expect(body).toContain("Saved to your list");
    expect(body).toContain("does not save a dated thesis or start alerts");
    expect(body).toContain("View saved list");
    // P2-1: one "Done" on the page — the panel's — and the top button reads
    // "Saved ✓" instead of a second Done.
    expect(body.match(/Done/g)).toHaveLength(1);
    expect(container!.querySelector('[data-testid="save-security"]')?.textContent).toBe("Saved ✓");
    await click('[data-testid="save-done"]');
    expect(container!.querySelector('[data-testid="save-result"]')).toBeNull();
    expect(text()).not.toContain("Done");
  });

  it("shows the not-saved state with a primary retry and another-list exit", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 502 }));
    mount(<SaveFollow symbol="CARR" />);
    await click('[data-testid="save-security"]');
    expect(text()).toContain("Couldn't save to this list");
    expect(text()).toContain("Your list is unchanged");
    expect(text()).toContain("Choose another list"); // T2-20 exit (item 11)
    // P2-6: the top button is not a second save action while Retry is shown.
    expect(container!.querySelector<HTMLButtonElement>('[data-testid="save-security"]')?.disabled).toBe(true);
    await click('[data-testid="save-result"] button'); // Retry save is the panel's primary button
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
  });

  it("states the missing account instead of saving anonymously", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 401 }));
    mount(<SaveFollow symbol="CARR" />);
    await click('[data-testid="save-security"]');
    expect(text()).toContain("Sign in to save this security");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("follow opens the no-change-feed state and returns", async () => {
    mount(<SaveFollow symbol="CARR" />);
    await click('[data-testid="follow-changes"]');
    const body = text();
    expect(body).toContain("Alerts aren't available here");
    expect(body).toContain("does not yet provide a supported change feed");
    const buttons = container!.querySelectorAll('[data-testid="follow-panel"] button');
    await act(async () => {
      buttons[buttons.length - 1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container!.querySelector('[data-testid="follow-panel"]')).toBeNull();
  });
});
