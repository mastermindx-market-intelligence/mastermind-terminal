// @vitest-environment jsdom
//
// Lane C company-case unit coverage: the setup lexicon's invariants (every
// key a full EN/ZH pair), the pure helpers (stance mapping, signed-percent
// formatting, fill), and the two stateful pieces — the developing-observation
// card (T2-22) and the Save/Follow states (T2-20) — mounted through
// react-dom/client with the observation hook and shell identity mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/lib/useProphetObservation", () => ({ useProphetObservation: vi.fn() }));
vi.mock("@/components/chrome/AppShell", () => ({
  useShellIdentity: () => ({ kind: "account", userId: "u1", email: "unit@example.com" }),
}));
import { useProphetObservation } from "@/lib/useProphetObservation";
import { ObservationCard } from "@/components/prophet/setup/ObservationCard";
import { SaveFollow } from "@/components/prophet/setup/SaveFollow";
import {
  SETUP_LEX, fmtSignedPct, makeSetupT, setupFill, stanceKey,
} from "@/components/prophet/setup/setupStrings";
import type { ProphetObservationRead } from "@/lib/prophetObservations";

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
});

describe("stanceKey maps served states to reported sublines", () => {
  it("maps every sector-contract state and falls back honestly", () => {
    expect(stanceKey("open_plan")).toBe("stanceOpenPlan");
    expect(stanceKey("resolved_plan")).toBe("stanceResolvedPlan");
    expect(stanceKey("early_observation")).toBe("stanceEarly");
    expect(stanceKey("none")).toBe("stanceNone");
    expect(stanceKey("unavailable")).toBe("stanceUnavailable");
    expect(stanceKey("never-heard-of")).toBe("stanceUnavailable");
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

function readWithRows(): ProphetObservationRead {
  return {
    symbol: "ADP", account: "u1", status: "ready",
    data: {
      rows: [{
        source_event_id: "evt-1",
        triggers_fired: ["dot_1d", "basket_turn"],
        source_session: "2026-11-06",
        source_timing: null,
        source_evidence: { triggers: {}, counterevidence: [] },
        episode_relation: { state: "STANDALONE", reason: "" },
      } as never],
    } as never,
  };
}

describe("ObservationCard (T2-22)", () => {
  it("lists known triggers from a ready read and keeps missing/next honest", () => {
    vi.mocked(useProphetObservation).mockReturnValue(readWithRows());
    mount(<ObservationCard symbol="ADP" observationAsof="2026-11-06" />);
    const body = text();
    expect(body).toContain("Early observation · 2026-11-06");
    expect(body).toContain("Observation only");
    expect(body).toContain("Daily turn");       // TRIGGER_NAMES en for dot_1d
    expect(body).toContain("Group turn");       // TRIGGER_NAMES en for basket_turn
    expect(body).toContain("2026-11-06");       // the row's own session
    expect(body).toContain("No entry assessment is attached");
    expect(body).toContain("does not schedule a next check");
  });

  it("says the source is unreadable when the read is not ready", () => {
    for (const status of ["loading", "unavailable", "forbidden", "unauthenticated"] as const) {
      vi.mocked(useProphetObservation).mockReturnValue(
        { symbol: "ADP", account: "u1", status, data: null });
      mount(<ObservationCard symbol="ADP" observationAsof={null} />);
      expect(text()).not.toContain("Daily turn");
      act(() => root!.unmount()); container!.remove();
    }
    vi.mocked(useProphetObservation).mockReturnValue(
      { symbol: "ADP", account: "u1", status: "unavailable", data: null });
    mount(<ObservationCard symbol="ADP" observationAsof="2026-11-06" />);
    expect(text()).toContain("not readable right now");
  });
});

describe("SaveFollow states (T2-20)", () => {
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
    // T2-20 exits (fix order item 11): the saved panel offers the list and a
    // Done that dismisses it while the save button stays satisfied.
    expect(body).toContain("View saved list");
    await click('[data-testid="save-done"]');
    expect(container!.querySelector('[data-testid="save-result"]')).toBeNull();
    expect(text()).toContain("Done");
  });

  it("shows the not-saved state with a primary retry and another-list exit", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 502 }));
    mount(<SaveFollow symbol="CARR" />);
    await click('[data-testid="save-security"]');
    expect(text()).toContain("Couldn't save to this list");
    expect(text()).toContain("Your list is unchanged");
    expect(text()).toContain("Choose another list"); // T2-20 exit (item 11)
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
