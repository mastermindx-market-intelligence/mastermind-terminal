// @vitest-environment jsdom
// The fixtures below are outputs of the complete pinned Python producer, not hand-entered UI values.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { byExpiryToTermStructure, expiryObservationFor, type ExpiryRow } from "@/lib/expiryTermStructure";
import { ExpiryBars } from "@/components/gexdesk/ExpiryBars";
import { ExposureExpiryDrawer } from "@/components/gexdesk/ExposureExpiryDrawer";
import { makeGexT } from "@/components/gexdesk/gexStrings";
vi.mock("@/components/surface/EodReplayTag", () => ({ EodReplayTag: () => null }));
const payloads = JSON.parse(readFileSync(resolve(process.cwd(), "lib/__tests__/fixtures/expiry-support-produced.json"), "utf8")) as Record<string, { asof: string; by_expiry: ExpiryRow[] }>;
const legacy = JSON.parse(readFileSync(resolve(process.cwd(), "lib/__tests__/fixtures/expiry-support-legacy-produced.json"), "utf8")) as typeof payloads;
let element: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };

describe("actual source outputs become truthful expiry analysis", () => {
  it.each(["vanna", "charm"] as const)("preserves missing, zero, signed complete values and cancellation for %s", lens => {
    const missing = byExpiryToTermStructure(payloads.all_missing.by_expiry, lens, payloads.all_missing.asof);
    expect(missing.nodes).toEqual([]); expect(missing.sourceCount).toBe(1); expect(missing.missingCount).toBe(1);
    const zero = byExpiryToTermStructure(payloads.true_zero.by_expiry, lens, payloads.true_zero.asof);
    expect(zero.nodes[0]).toMatchObject({ net: 0, sign: 0, partial: false, knownContracts: 1, admittedContracts: 1 });
    const cancellation = byExpiryToTermStructure(payloads.cancellation.by_expiry, lens, payloads.cancellation.asof);
    expect(cancellation.nodes[0]).toMatchObject({ net: 0, sign: 0, knownContracts: 2 });
    const full = byExpiryToTermStructure(payloads.complete.by_expiry, lens, payloads.complete.asof);
    expect(full.nodes.map(n => n.net)).toEqual(lens === "vanna" ? [.1, .4] : [-.05, .1]);
    expect(full.nodes.map(n => n.dte)).toEqual([7, 28]); expect(full.splitAvailable).toBe(false);
  });
  it("known partial is retained without being labeled complete exposure", () => {
    const v = byExpiryToTermStructure(payloads.partial_vanna.by_expiry, "vanna", payloads.partial_vanna.asof);
    expect(v.nodes[0]).toMatchObject({ net: .1, partial: true, knownContracts: 1, admittedContracts: 2 });
    expect(v.partialCount).toBe(1);
    const c = byExpiryToTermStructure(payloads.partial_vanna.by_expiry, "charm", payloads.partial_vanna.asof);
    expect(c.nodes[0]).toMatchObject({ net: -.1, partial: false, knownContracts: 2, admittedContracts: 2 });
  });
  it("unknown neighboring expiry is counted, not fabricated as a zero node", () => {
    const ts = byExpiryToTermStructure(payloads.two_expiries.by_expiry, "vanna", payloads.two_expiries.asof);
    expect(ts.nodes).toHaveLength(1); expect(ts.sourceCount).toBe(2); expect(ts.missingCount).toBe(1);
  });
  it("legacy finite reports remain visible with unknown support", () => {
    const ts = byExpiryToTermStructure(legacy.complete.by_expiry, "vanna", legacy.complete.asof);
    expect(ts.nodes.map(n => n.net)).toEqual([.1, .4]); expect(ts.nodes[0].knownContracts).toBeNull(); expect(ts.nodes[0].admittedContracts).toBeNull();
  });
  it.each(["en", "zh"] as const)("bar and bubble views disclose partial data in %s", async lang => {
    const p = payloads.partial_vanna; const t = makeGexT(lang);
    await render(<ExpiryBars byExpiry={p.by_expiry} greek="vanna" asOf={p.asof} lang={lang} />);
    expect(element.querySelector('[data-partial="true"]')?.textContent).toContain(t("expiryKnownSubtotal"));
    expect(element.querySelector('[data-partial="true"]')?.textContent).toContain("100");
    expect(element.querySelector('[data-testid="expiry-support"]')?.textContent).toContain("1/1");
    expect(element.querySelector('[data-testid="expiry-source-basis"]')?.textContent).toBe(t("expirySourceBasis"));
    expect(element.querySelector('[data-testid="expiry-unit"]')?.textContent).toBe(t("expiryUnitVanna"));
    await render(<ExposureExpiryDrawer byExpiry={p.by_expiry} greek="vanna" asOf={p.asof} lang={lang} />);
    await act(async () => (element.querySelector('button[aria-expanded]') as HTMLButtonElement).click());
    expect(element.querySelector('svg [data-partial="true"] title')?.textContent).toContain(t("expiryKnownSubtotal"));
    expect(element.querySelector('svg [data-partial="true"] circle')?.getAttribute("stroke-dasharray")).toBe("3 2");
    expect(element.querySelector('svg')?.getAttribute("aria-label")).toBe(t("exposureByExpiry"));
  });
  it.each(["vanna", "charm"] as const)("empty drawer is no-data rather than unsupported for %s", async lens => {
    const t=makeGexT("en"); await render(<ExposureExpiryDrawer byExpiry={[]} greek={lens} asOf="2026-09-25" lang="en" />);
    await act(async () => (element.querySelector('button[aria-expanded]') as HTMLButtonElement).click());
    expect(element.querySelector('.obs-xdrawer-empty')?.textContent).toBe(t("xdrawerEmpty"));
  });
  it.each(["en", "zh"] as const)("zero remains neutral and partial count stays visible in %s", async lang => {
    await render(<ExpiryBars byExpiry={payloads.true_zero.by_expiry} greek="vanna" asOf="2026-09-25" lang={lang} />);
    expect(element.querySelector('.num')?.textContent).toBe("0"); expect((element.querySelector('.num') as HTMLElement).style.color).toBe("var(--muted)");
    await render(<ExpiryBars byExpiry={payloads.two_expiries.by_expiry} greek="vanna" asOf="2026-09-25" lang={lang} />);
    expect(element.querySelector('[data-testid="expiry-support"]')?.textContent).toContain("1/2");
    expect(element.querySelectorAll('[data-expiry]')).toHaveLength(1);
  });
});

describe("support metadata is not permission to invent exposure", () => {
  const source=payloads.partial_vanna.by_expiry[0];
  it.each([
    { known_contracts: 3, admitted_contracts: 2, known_net: .1 },
    { known_contracts: -1, admitted_contracts: 2, known_net: .1 },
    { known_contracts: 1.5, admitted_contracts: 2, known_net: .1 },
    { known_contracts: 0, admitted_contracts: 2, known_net: .1 },
    { known_contracts: 1, admitted_contracts: 2, known_net: null },
    { known_contracts: 2, admitted_contracts: 2, known_net: .2 },
  ])("withholds invalid/conflicting support %j", value => {
    const row={ ...source, exposure_support: {basis:"admitted_input_contracts",vanna:value} };
    expect(expiryObservationFor(row,"vanna").net).toBeNull();
  });
  it("does not accept a full-net claim accompanied by partial counts", () => {
    expect(expiryObservationFor({...source,vanna_net:.1},"vanna").net).toBeNull();
  });
  it("keeps Gamma/Delta values unchanged by additive new-lens support", () => {
    for(const name of Object.keys(payloads)) for(const lens of ["gamma","delta"] as const){
      const before=byExpiryToTermStructure(legacy[name].by_expiry,lens,legacy[name].asof);
      const after=byExpiryToTermStructure(payloads[name].by_expiry,lens,payloads[name].asof);
      expect(after.nodes.map(n=>n.net)).toEqual(before.nodes.map(n=>n.net));
    }
  });
});
