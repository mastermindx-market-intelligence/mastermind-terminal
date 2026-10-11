// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useLang: () => ({ lang: "en", setLang: () => undefined }),
  useT: () => (key: string) => key,
}));

import OptionsWorkflowGuide from "@/components/options/OptionsWorkflowGuide";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

const storage = (() => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
})();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe("Options workflow Plan stage", () => {
  it("routes Plan to Payoff Lab instead of Prophet", async () => {
    const open = vi.fn();
    await act(async () => root!.render(<OptionsWorkflowGuide activeView="tape" onOpenView={open} />));
    const launcher = host!.querySelector<HTMLButtonElement>('[data-options-workflow-guide="launcher"]')!;
    await act(async () => launcher.click());
    const plan = host!.querySelector<HTMLElement>('[data-options-workflow-stage="plan"]')!;
    expect(plan.textContent).toContain("Shape the payoff");
    expect(plan.textContent).toContain("Open Payoff Lab");
    const cta = plan.querySelector<HTMLButtonElement>("button")!;
    await act(async () => cta.click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("payoff");
    expect(open).not.toHaveBeenCalledWith("prophet");
  });
});
