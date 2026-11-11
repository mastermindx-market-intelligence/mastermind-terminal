// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OptionsTickerSidebar } from "@/components/options/OptionsTickerSidebar";
import type { OptionsTickerChoice } from "@/lib/optionsTickerCatalog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHOICES: OptionsTickerChoice[] = [
  {
    root: "AMD", tier: "rotating", status: "quiet", lastSuccess: "2026-09-20T14:06:00Z",
    sessionDate: "2026-09-20", active: true, source: "catalog",
  },
  {
    root: "SPY", tier: "core", status: "available", lastSuccess: "2026-09-20T14:05:00Z",
    sessionDate: "2026-09-20", active: false, source: "catalog",
  },
  {
    root: "TLT", tier: "core", status: "waiting", lastSuccess: null,
    sessionDate: "2026-09-20", active: false, source: "catalog",
  },
];

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(props: Partial<React.ComponentProps<typeof OptionsTickerSidebar>> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const onSelect = vi.fn();
  const onQueryChange = vi.fn();
  act(() => {
    root!.render(
      <OptionsTickerSidebar
        lang="en"
        choices={CHOICES}
        totalCount={CHOICES.length}
        catalogAvailable
        selectedTicker={null}
        query=""
        netImpactByRoot={{ AMD: 1_250_000 }}
        onSelect={onSelect}
        onQueryChange={onQueryChange}
        {...props}
      />,
    );
  });
  return { host, onSelect, onQueryChange };
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("OptionsTickerSidebar", () => {
  it("renders active, core, and rotating coverage instead of a session-only list", () => {
    const { host: node } = mount();
    const text = node.textContent ?? "";

    expect(text).toContain("AMD");
    expect(text).toContain("SPY");
    expect(text).toContain("TLT");
    expect(text).toContain("CORE");
    expect(text).toContain("CORE · WAIT");
    expect(text).not.toContain("TLTROTATING");
    expect(text).toContain("3 covered");
  });

  it("does not put stale impact numbers on a catalog row the producer marks quiet", () => {
    const { host: node } = mount();
    const amd = node.querySelector('[role="option"]') as HTMLButtonElement;

    expect(amd.textContent).toContain("ROTATING · QUIET");
    expect(amd.textContent).not.toContain("$1.25M");
  });

  it("labels the static pre-catalog list as startup suggestions, never covered", () => {
    const fallback = CHOICES.map((choice) => ({
      ...choice,
      status: "unknown" as const,
      source: "fallback" as const,
      active: false,
    }));
    const { host: node } = mount({
      choices: fallback,
      catalogAvailable: false,
      netImpactByRoot: {},
    });

    expect(node.textContent).toContain("3 startup");
    expect(node.textContent).toContain("STARTUP");
    expect(node.textContent).not.toContain("3 covered");
  });

  it("selects an exact covered root with Enter", () => {
    const onSelect = vi.fn();
    const { host: node } = mount({ choices: [CHOICES[0]], query: " amd ", onSelect });
    const input = node.querySelector('input[aria-label="Search covered options tickers"]') as HTMLInputElement;

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith(CHOICES[0]);
  });

  it("reports search edits through the controlled query boundary", () => {
    const { host: node, onQueryChange } = mount();
    const input = node.querySelector('input[aria-label="Search covered options tickers"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;

    act(() => {
      setter.call(input, "TLT");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onQueryChange).toHaveBeenCalledWith("TLT");
  });
});
