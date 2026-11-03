// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Real composition under test: ShellSearch -> (lazy) SymbolPicker -> SearchModal. SymbolPicker
// and SearchModal are the production modules, imported directly; the only stand-in is
// next/dynamic's load wrapper, which resolves to that SAME real SearchModal module.
import ShellSearch from "@/components/chrome/shared-shell/ShellSearch";
import SymbolPicker from "@/components/SymbolPicker";
import SearchModal from "@/components/SearchModal";
import { LangProvider } from "@/lib/i18n";

const state = vi.hoisted(() => ({
  push: vi.fn(),
  writeActiveSymbol: vi.fn(),
  trackSearch: vi.fn(),
  getJSONResult: vi.fn(),
  manifest: {
    AAPL: { name: "Apple", col: "#333333", verdict: null, mkt: "US", sec: "Equities" },
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  const modal = await import("@/components/SearchModal");
  return {
    default: () => (props: Parameters<typeof modal.default>[0]) => React.createElement(modal.default, props),
  };
});
vi.mock("@/lib/activeSymbol", () => ({
  useActiveSymbol: () => "NVDA",
  writeActiveSymbol: state.writeActiveSymbol,
}));
vi.mock("@/lib/dataCache", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getJSONResult: state.getJSONResult };
});
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => null }));
vi.mock("@/lib/useMarketPrefs", () => ({
  useMarketPrefs: () => ({
    prefs: { home: "US", enabled: ["US"], followed: [], autoNarrowed: false },
    ready: false,
    enableAll: () => {},
  }),
}));
vi.mock("@/components/onboarding/OnboardingProvider", () => ({
  useOnboarding: () => ({ open: () => {} }),
}));
vi.mock("@/lib/useMediaQuery", () => ({ useIsPhone: () => false, useIsMobile: () => false }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: state.trackSearch }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let root: Root;
let host: HTMLDivElement;
const onOpenChange = vi.fn<(open: boolean) => void>();

async function renderShell(open: boolean) {
  await act(async () => {
    root.render(
      <LangProvider>
        <ShellSearch open={open} onOpenChange={onOpenChange} />
      </LangProvider>,
    );
  });
}

async function flushWork() {
  await act(async () => {
    await Promise.resolve();
    await sleep(0);
    await Promise.resolve();
  });
}

async function typeQuery(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flushWork();
}

beforeEach(() => {
  // Deterministic idle path: force SymbolPicker's requestIdleCallback fallback to setTimeout.
  delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
  state.push.mockReset();
  state.writeActiveSymbol.mockReset();
  state.trackSearch.mockReset();
  state.getJSONResult.mockReset();
  state.getJSONResult.mockResolvedValue({
    status: "data",
    data: { as_of: null, symbols: state.manifest },
  });
  onOpenChange.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
});

const trigger = () => host.querySelector<HTMLElement>(".sym-pick.shared-shell-company-search");
const dialog = () => document.querySelector<HTMLElement>("[role='dialog']");
const aaplRow = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".sres .r")).find(
    (row) => row.querySelector(".tk")?.textContent === "AAPL",
  );

describe("Shared Shell lazy company search portal", () => {
  it("keeps a closed shell silent: no manifest read and no dialog", async () => {
    await renderShell(false);
    // Past SymbolPicker's idle prefetch deadline: nothing may have mounted to start it.
    // Fails if ShellSearch's activation guard is removed.
    await act(async () => {
      await sleep(450);
    });
    expect(state.getJSONResult).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    const button = trigger();
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button!.getAttribute("aria-expanded")).toBe("false");
    expect(button!.getAttribute("aria-label")).toBe("Search companies");
  });

  it("click intent mounts the real picker and portals the real company dialog to document.body", async () => {
    expect(typeof SymbolPicker).toBe("function");
    expect(typeof SearchModal).toBe("function");
    await renderShell(false);
    await act(async () => {
      trigger()!.click();
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
    await renderShell(true); // the shell host honours the reported intent
    expect(trigger()).not.toBeNull();
    expect(trigger()!.getAttribute("aria-expanded")).toBe("true");
    // The freshly mounted real picker starts exactly one idle manifest read.
    await act(async () => {
      await sleep(450);
    });
    expect(state.getJSONResult).toHaveBeenCalledTimes(1);
    const panel = dialog();
    expect(panel).not.toBeNull();
    // Portal composition: the dialog lives under document.body, outside the shell host.
    // Fails if the ShellSearch -> SymbolPicker portalDialog hand-off is removed.
    expect(panel!.parentElement).toBe(document.body);
    expect(host.contains(panel!)).toBe(false);
    expect(document.getElementById(panel!.getAttribute("aria-labelledby")!)?.textContent).toBe(
      "Search companies",
    );
    const input = panel!.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();

    await typeQuery(input!, "AAPL");
    expect(aaplRow()).not.toBeUndefined();
    await act(async () => {
      aaplRow()!.click();
    });
    expect(state.writeActiveSymbol).toHaveBeenCalledWith("AAPL");
    expect(state.push).toHaveBeenCalledTimes(1);
    expect(state.push).toHaveBeenCalledWith("/analysis?symbol=AAPL");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await renderShell(false); // the controlled host also honours the reported close
    // Picked: the dialog is gone, but the activated picker stays mounted.
    expect(dialog()).toBeNull();
    expect(trigger()).not.toBeNull();
    expect(state.getJSONResult).toHaveBeenCalledTimes(1);
  });

  it("reopens the retained picker with no duplicate eager manifest reads", async () => {
    await renderShell(false);
    await act(async () => {
      trigger()!.click();
    });
    await renderShell(true);
    await act(async () => {
      await sleep(450);
    });
    expect(state.getJSONResult).toHaveBeenCalledTimes(1);
    await renderShell(false);
    expect(dialog()).toBeNull();
    expect(trigger()).not.toBeNull();
    await renderShell(true);
    const panel = dialog();
    expect(panel).not.toBeNull();
    expect(panel!.parentElement).toBe(document.body);
    expect(state.getJSONResult).toHaveBeenCalledTimes(1);
    await typeQuery(panel!.querySelector<HTMLInputElement>("input")!, "AAPL");
    // The universe survived the close on the retained mount: rows resolve with no reload,
    // no universe-loading placeholder and no second read.
    expect(aaplRow()).not.toBeUndefined();
    expect(document.querySelector(".s-type-hint")).toBeNull();
    expect(state.getJSONResult).toHaveBeenCalledTimes(1);
  });
});
