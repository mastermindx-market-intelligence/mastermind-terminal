// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: H.lang, setLang: () => undefined }) }));

import { PayoffLab, formatPayoffPrice } from "@/components/plan/PayoffLab";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  H.lang = "en";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { configurable: true, value: 980 });
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<PayoffLab />));
}

function field(label: string): HTMLInputElement {
  const node = [...host.querySelectorAll<HTMLInputElement>("input")].find((input) => input.getAttribute("aria-label") === label || input.id === label);
  if (!node) throw new Error(`field ${label} missing`);
  return node;
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("native input value setter unavailable");
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Payoff Lab — break-even display precision", () => {
  it.each([
    [99.999975, "$99.999975"],
    [100.000025, "$100.000025"],
    [100.00001, "$100.00001"],
    [1e-12, "$1e-12"],
    [100.0000000001, "$100.0000000001"],
    [92, "$92"],
  ])("round-trips %s without collapsing the returned Number", (value, expected) => {
    expect(formatPayoffPrice(value)).toBe(expected);
    expect(Number(expected.slice(1))).toBe(value);
  });
});

describe("Payoff Lab — manual expiration plan", () => {
  it("opens on a deterministic bull-call-spread example", async () => {
    await render();
    expect(host.textContent).toContain("Payoff Lab");
    expect(host.textContent).toContain("Expiration-only");
    expect(host.textContent).toContain("Manual premiums");
    expect(host.textContent).toContain("$260");
    expect(host.textContent).toContain("$102.6");
    expect(host.textContent).toContain("$740");
    expect(host.querySelectorAll('[data-leg]')).toHaveLength(2);
    expect(field("payoff-expiration").value).toBe("2026-10-16");
    expect(host.querySelector('svg[aria-label="Expiration payoff by underlying price"]')).not.toBeNull();
  });

  it("updates the scenario P/L without changing the structure", async () => {
    await render();
    const scenario = field("payoff-scenario-price");
    await type(scenario, "110");
    expect(host.querySelector('[data-testid="payoff-scenario-result"]')?.textContent).toContain("+$740");
    expect(host.querySelectorAll('[data-leg]')).toHaveLength(2);
  });

  it("requires one shared expiration and does not pretend to model calendars", async () => {
    await render();
    const expiry = field("payoff-expiration");
    await type(expiry, "");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Choose one valid shared expiration");
    expect(host.querySelector('svg[aria-label="Expiration payoff by underlying price"]')).toBeNull();
    expect(host.textContent).toContain("Calendar and diagonal spreads are not modeled");
  });

  it("refuses malformed manual prices rather than inventing a payoff", async () => {
    await render();
    const strike = field("Strike 1");
    await type(strike, "");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("strike must be a positive finite number");
    expect(host.querySelector('svg[aria-label="Expiration payoff by underlying price"]')).toBeNull();
  });

  it("adds and removes a leg without an external write", async () => {
    await render();
    const add = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Add leg")!;
    await act(async () => add.click());
    expect(host.querySelectorAll('[data-leg]')).toHaveLength(3);
    const remove = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label") === "Remove leg 3")!;
    await act(async () => remove.click());
    expect(host.querySelectorAll('[data-leg]')).toHaveLength(2);
  });

  it("renders the same capability with dedicated Chinese copy", async () => {
    H.lang = "zh";
    await render();
    expect(host.textContent).toContain("到期收益实验室");
    expect(host.textContent).toContain("仅到期损益");
    expect(host.textContent).toContain("手动权利金");
    expect(host.textContent).toContain("它不是预测、预期收益、概率、交易建议或可执行报价");
  });
});
