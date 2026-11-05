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

  it.each(["", "0", "-1", "1.5", "100001", "10000000000000000"])("highlights invalid quantity %s and removes the calculated payoff", async (value) => {
    await render();
    const quantity = field("Qty 1");
    await type(quantity, value);
    expect(quantity.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("quantity must be a positive safe integer");
    expect(host.querySelector('svg[aria-label="Expiration payoff by underlying price"]')).toBeNull();
  });

  it("accepts the maximum supported quantity and clears its invalid state after correction", async () => {
    await render();
    const quantity = field("Qty 1");
    await type(quantity, "100001");
    await type(quantity, "100000");
    expect(quantity.max).toBe("100000");
    expect(quantity.getAttribute("aria-invalid")).toBe("false");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('svg[aria-label="Expiration payoff by underlying price"]')).not.toBeNull();
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

// Adopted acceptance fixtures from original comment 6159214546 and the complete
// alternative in 6370519551. These exercise the actual component and math with
// the language/ResizeObserver harness above. This is jsdom, not a browser.
function kpi(label: string): string | null {
  const node = [...host.querySelectorAll('span')].find(n => n.textContent === label);
  return node?.parentElement?.querySelectorAll('span')[1]?.textContent ?? null;
}
async function clickReset() {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(n => n.textContent === 'Reset example')!;
  await act(async () => button.click());
}
describe('C2 original cents/reset acceptance residue', () => {
  it('preserves cents in max-loss KPI for the original two-long-call example', async () => {
    await render();
    await type(field('Premium 1'), '4.00004');
    await type(field('Premium 2'), '4.00004');
    const side = host.querySelector<HTMLSelectElement>('select[aria-label="Side 2"]')!;
    await act(async () => { side.value = 'long'; side.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(field('Premium 1').value).toBe('4.00004');
    expect(field('Premium 2').value).toBe('4.00004');
    expect(side.value).toBe('long');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('svg')).not.toBeNull();
    expect(kpi('Max loss')).toBe('$800.01');
  });
  it('Reset example restores a valid calculation after clearing shared expiration', async () => {
    await render();
    await type(field('payoff-expiration'), '');
    expect(field('payoff-expiration').getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('svg')).toBeNull();
    await clickReset();
    expect(field('payoff-expiration').value).toBe('2026-10-16');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('svg')).not.toBeNull();
    expect(kpi('Max loss')).toBe('$260');
  });
  it('control: resetting legs and scenario works while shared expiration remains valid', async () => {
    await render();
    await type(field('Premium 1'), '');
    await type(field('payoff-scenario-price'), '110');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await clickReset();
    expect(field('Premium 1').value).toBe('4.2');
    expect(field('payoff-scenario-price').value).toBe('105');
    expect(field('payoff-expiration').value).toBe('2026-10-16');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(kpi('Max loss')).toBe('$260');
  });
  it('control: directly restoring a cleared expiration recovers calculation', async () => {
    await render();
    await type(field('payoff-expiration'), '');
    expect(field('payoff-expiration').value).toBe('');
    expect(field('payoff-expiration').getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(kpi('Max loss')).toBe('—');
    await type(field('payoff-expiration'), '2026-10-16');
    expect(field('payoff-expiration').getAttribute('aria-invalid')).toBe('false');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('svg')).not.toBeNull();
    expect(kpi('Max loss')).toBe('$260');
  });
});

describe('C2 candidate formatting and reset policy controls', () => {
  it.each([
    ['0', '$0.00'],
    ['0.5', '$50.00'],
    ['0.9999', '$99.99'],
    ['1', '$100'],
    ['1.0001', '$100.01'],
    ['10', '$1,000'],
    ['10.0001', '$1,000.01'],
  ])('formats max loss from premium %s as %s', async (premium, expected) => {
    await render();
    await type(field('Premium 1'), premium);
    await type(field('Premium 2'), '0');
    await type(field('payoff-scenario-price'), '0');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(kpi('Max loss')).toBe(expected);
    const prefix = premium === '0' ? '' : '−';
    expect(host.querySelector('[data-testid="payoff-scenario-result"]')?.textContent).toContain(`${prefix}${expected}`);
  });
  it('preserves a valid user-selected date when resetting the example', async () => {
    await render();
    await type(field('payoff-expiration'), '2028-02-29');
    await type(field('Premium 1'), '');
    await clickReset();
    expect(field('payoff-expiration').value).toBe('2028-02-29');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(kpi('Max loss')).toBe('$260');
  });
  it('does not silently repair a cleared date until Reset example is requested', async () => {
    await render();
    await type(field('payoff-expiration'), '');
    await type(field('Premium 1'), '4.3');
    expect(field('payoff-expiration').value).toBe('');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('svg')).toBeNull();
    await clickReset();
    expect(field('payoff-expiration').value).toBe('2026-10-16');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("Payoff Lab — chart display boundary", () => {
  it.each(["en", "zh"] as const)("keeps valid analysis available when %s chart projection overflows, then recovers", async (lang) => {
    H.lang = lang;
    await render();
    const measured = host.querySelector('[data-testid="payoff-chart-measure"]');
    const remove = host.querySelector<HTMLButtonElement>(`button[aria-label="${lang === "zh" ? "移除该腿" : "Remove leg"} 2"]`)!;
    await act(async () => remove.click());
    await type(field(`${lang === "zh" ? "行权价" : "Strike"} 1`), "1e305");
    await type(field(`${lang === "zh" ? "权利金" : "Premium"} 1`), "1e306");

    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('svg')).toBeNull();
    const message = host.querySelector('[data-testid="payoff-chart-unavailable"]');
    expect(message?.getAttribute("role")).toBe("status");
    expect(message?.textContent).toBe(lang === "zh"
      ? "这些收益数值超出图表的显示范围。摘要和情景损益仍可查看。"
      : "These payoff values exceed the chart’s display range. The summary and scenario remain available.");
    expect(kpi(lang === "zh" ? "最大亏损" : "Max loss")).not.toBe("—");
    expect(kpi(lang === "zh" ? "最大亏损" : "Max loss")).not.toBeNull();
    expect(host.querySelector('[data-testid="payoff-scenario-result"]')?.textContent).toMatch(/−\$/);
    expect(host.querySelector('[data-testid="payoff-chart-measure"]')).toBe(measured);

    await type(field(`${lang === "zh" ? "行权价" : "Strike"} 1`), "100");
    await type(field(`${lang === "zh" ? "权利金" : "Premium"} 1`), "4.2");
    expect(host.querySelector('[data-testid="payoff-chart-unavailable"]')).toBeNull();
    expect(host.querySelector('svg')).not.toBeNull();
    expect(host.querySelector('[data-testid="payoff-chart-measure"]')).toBe(measured);
  });

  it("uses the measured unpadded width and retains its observer target through invalid input", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(280);
    try {
      await render();
      const measured = host.querySelector('[data-testid="payoff-chart-measure"]');
      expect(host.querySelector('svg')?.getAttribute("viewBox")).toBe("0 0 280 310");
      await type(field("payoff-expiration"), "");
      expect(host.querySelector('svg')).toBeNull();
      expect(host.querySelector('[data-testid="payoff-chart-measure"]')).toBe(measured);
      await clickReset();
      expect(host.querySelector('svg')?.getAttribute("viewBox")).toBe("0 0 280 310");
      expect(host.querySelector('[data-testid="payoff-chart-measure"]')).toBe(measured);
    } finally {
      width.mockRestore();
    }
  });
});
