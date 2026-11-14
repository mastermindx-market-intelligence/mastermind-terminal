// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RotationRead, RotationReadBlock } from "@/components/prophet/setup/RotationRead";
import { parseProphetRotationRead, ROTATION_READ_COPY, ROTATION_READ_UNAVAILABLE } from "@/lib/prophetRotationRead";
import { rotationSpecimen, ROTATION_BANNED_WORDS } from "../../e2e/prophetRotationSpecimens";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
function mount(node: React.ReactNode) {
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container); act(() => root.render(node));
}
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.unstubAllGlobals(); });
for (const symbol of ["INTC", "CRM", "DUK", "CRSP"]) {
  it(`${symbol}: served order, initial two-theme limit, plain descriptive copy`, () => {
    const data = rotationSpecimen();
    mount(<RotationReadBlock read={parseProphetRotationRead(data)} symbol={symbol} lang="en" />);
    expect(container.textContent).toContain(ROTATION_READ_COPY);
    expect(container.textContent).not.toMatch(ROTATION_BANNED_WORDS);
    const rows = [...container.querySelectorAll('[data-testid="rotation-row"]')];
    expect(rows[0].textContent).toMatch(/^SECTOR/);
    const member = data.companies[symbol];
    expect(rows).toHaveLength(1 + member.themes.length);
    const button = container.querySelector("button");
    if (member.themes.length > 2) {
      expect(button?.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector("[hidden]")).not.toBeNull();
      act(() => button!.click());
      expect(button?.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector("[hidden]")).toBeNull();
      act(() => button!.click());
      expect(button?.getAttribute("aria-expanded")).toBe("false");
    } else expect(button).toBeNull();
  });
}
it("keeps signed points, separate weekly clocks, and all unavailable measurements as dashes", () => {
  mount(<RotationReadBlock read={parseProphetRotationRead(rotationSpecimen())} symbol="CRSP" lang="en" />);
  const rows = container.querySelectorAll('[data-testid="rotation-row"]');
  expect(rows[0].textContent).toContain("+0 pts");
  expect(rows[0].textContent).toContain("−2 pts");
  expect(rows[1].textContent).toContain("Too few members to read");
  expect(rows[2].textContent).toContain("Not available");
  for (const row of [rows[1], rows[2]]) {
    expect(row.textContent?.match(/—/g)).toHaveLength(2);
    expect(row.textContent).not.toMatch(/↗|↘|→|Improving|Flat|Deteriorating/);
  }
});
it.each(["missing", "invalid", "stale", "unavailable"])("%s whole read is one quiet line without mandatory copy or controls", stage => {
  const read = stage === "missing" ? parseProphetRotationRead(rotationSpecimen())
    : parseProphetRotationRead({ ...rotationSpecimen(), schema: stage === "invalid" ? "other" : "si.rotation_read/v1", status: stage });
  mount(<RotationReadBlock read={read} symbol="UNKNOWN" lang="en" />);
  expect(container.textContent).toContain("Sector and theme rotation · Not available");
  expect(container.textContent).toContain("From Sector Intelligence");
  expect(container.textContent).not.toContain(ROTATION_READ_COPY);
  expect(container.querySelectorAll("button,a,[role=alert],[data-testid=rotation-row]")).toHaveLength(0);
  expect(container.textContent).not.toMatch(ROTATION_BANNED_WORDS);
});
it("translates presentation without translating or inferring SI group names", () => {
  mount(<RotationReadBlock read={parseProphetRotationRead(rotationSpecimen())} symbol="INTC" lang="zh" />);
  expect(container.textContent).toContain("行业与主题轮动");
  expect(container.textContent).toContain("改善");
  expect(container.textContent).toContain("Semiconductors");
  expect(container.textContent).toContain("百分点");
  expect(container.textContent).not.toMatch(/Improving|Deteriorating|Flat/);
});
it("starts unavailable, self-lights after a foreground re-read and clears on access loss", async () => {
  let published = false;
  let allowed = true;
  const fetch = vi.fn(async () => ({ ok: allowed && published, json: async () => ({ data: rotationSpecimen() }) }));
  vi.stubGlobal("fetch", fetch);
  await act(async () => mount(<RotationRead symbol="INTC" lang="en" />));
  expect(container.textContent).toContain("Not available");
  published = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).toContain("↗ Improving");
  expect(fetch).toHaveBeenLastCalledWith("/api/sector-intelligence?source=rotation_read", expect.objectContaining({ cache: "no-store" }));
  allowed = false;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).toContain("Sector and theme rotation · Not available");
  expect(container.textContent).not.toContain("Semiconductors");
});
it("unavailable initial state is renderable without a data object", () => {
  mount(<RotationReadBlock read={ROTATION_READ_UNAVAILABLE} symbol="INTC" lang="en" />);
  expect(container.querySelectorAll('[data-testid="rotation-row"]')).toHaveLength(0);
});
