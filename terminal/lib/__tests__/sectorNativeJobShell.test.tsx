// @vitest-environment jsdom
/**
 * sectorNativeJobShell.test.tsx — lane 3 (R2/R4, COO rulings 2026-11-11): the
 * both-denied generation envelope is its own transport cause.
 *
 * Laws pinned here:
 *   - NATIVE CAUSE: `accessCause: "entitlement_required"` precedes the generic
 *     access state — the subscription denial is not a sign-in problem, and its
 *     copy is the EXACT bilingual sentence the row readers' subscription card
 *     uses (sectorDepthLex siRowsReasonEntitled), never a paraphrase.
 *   - NO SIGN-IN REMEDY: the entitlement state renders no /login link —
 *     signing in does not restore a declined entitlement. Every other access
 *     state keeps the sign-in path.
 *   - NORMALIZED, NEVER RELAYED: `sectorNativeContext` keeps the cause only
 *     when the generation is absent, the live transport is `access`, and the
 *     received cause is exactly `entitlement_required` — never inferred from a
 *     tier, a status alone, or any other source.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// ZH without mounting LangProvider (same approach as sectorNativeRowMount):
// the real lexicon keeps its real copy tables; only useLang is overridden.
const G = globalThis as unknown as { __SI_SHELL_LANG?: "en" | "zh" };
G.__SI_SHELL_LANG = "en";
vi.mock("@/lib/i18n", async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  return { ...m, useLang: () => ({ lang: G.__SI_SHELL_LANG ?? "en" }) };
});
// next/link needs an app router the jsdom mount does not have; the anchor it
// renders is exactly what the sign-in-remedy assertions need to see.
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) =>
  <a href={href}>{children}</a> }));

import { NativeUnavailable, nativeCause } from "@/components/sector-intelligence/SectorNativeJobShell";
import { sectorNativeContext, type SectorNativeContext } from "@/components/sector-intelligence/sectorNativeSlots";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import { sectorNativeGeneration } from "@/lib/sectorNativeGeneration";
import captured from "./fixtures/sector_generation.captured.preview.v1.json";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const contextOf = (transport: SectorNativeContext["transport"], accessCause?: "entitlement_required"): SectorNativeContext => ({
  generation: null, transport, qualification: null, subject: null,
  ranked63: [], lead21: null, language: G.__SI_SHELL_LANG ?? "en", theme: "dark",
  binding: { ownerRevision: "r1", generationKey: "", subjectId: null, universe: "us",
    metric: "relative_wealth_pct", windows: [], basis: "total_return" },
  accessCause,
});

const mount = async (context: SectorNativeContext): Promise<HTMLElement> => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<NativeUnavailable context={context} onRetry={() => {}} onSources={() => {}} />);
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return host;
};

afterEach(() => {
  G.__SI_SHELL_LANG = "en";
  document.body.replaceChildren();
});

describe("nativeCause — the entitlement denial is its own cause (R2)", () => {
  /** nativeCause takes the lexicon hook's t, so probe it inside a render. */
  const causeFor = async (transport: SectorNativeContext["transport"], accessCause?: "entitlement_required") => {
    let cause: { title: string; copy: string } | null = null;
    const Probe = () => { cause = nativeCause(useSectorT(), transport, accessCause); return null; };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<Probe />); });
    await act(async () => root.unmount());
    return cause!;
  };

  it("entitlement_required precedes the generic access state and names the exact card sentence", async () => {
    expect(await causeFor("access", "entitlement_required"))
      .toEqual({ title: "Leadership evidence is not in your subscription",
        copy: "Not included in your current subscription." });
  });

  it("generic access keeps its own wording when no closed cause was lineage-checked", async () => {
    const generic = await causeFor("access");
    expect(generic.title).not.toBe("Leadership evidence is not in your subscription");
    expect(generic.copy).not.toBe("Not included in your current subscription.");
  });

  it.each(["loading", "invalid", "error", "unavailable"] as const)(
    "the cause never leaks into the %s state", async transport => {
      const state = await causeFor(transport, "entitlement_required");
      expect(state.title).not.toBe("Leadership evidence is not in your subscription");
      expect(state.copy).not.toBe("Not included in your current subscription.");
    });
});

describe("NativeUnavailable — the entitlement state offers no sign-in remedy (R2/R4)", () => {
  it("renders the exact EN subscription copy with no /login link", async () => {
    const host = await mount(contextOf("access", "entitlement_required"));
    expect(host.querySelector('[data-testid="sector-native-unavailable"]')).not.toBeNull();
    expect(host.textContent).toContain("Not included in your current subscription.");
    expect(host.querySelector('a[href="/login"]')).toBeNull();
  });

  it("renders the exact ZH subscription copy with no /login link", async () => {
    G.__SI_SHELL_LANG = "zh";
    const host = await mount(contextOf("access", "entitlement_required"));
    expect(host.textContent).toContain("当前订阅不包含此读数。");
    expect(host.textContent).not.toContain("Not included in your current subscription.");
    expect(host.querySelector('a[href="/login"]')).toBeNull();
  });

  it("a generic access state keeps the sign-in path", async () => {
    const host = await mount(contextOf("access"));
    expect(host.querySelector('a[href="/login"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Not included in your current subscription.");
  });
});

describe("sectorNativeContext — the cause is normalized, never relayed blind (R4)", () => {
  const base = { subjectId: null, language: "en" as const, theme: "dark" as const, ownerRevision: "r1" };
  it("survives only in the exact state that can honestly show it", () => {
    expect(sectorNativeContext({ ...base, generation: null, transport: "access",
      accessCause: "entitlement_required" }).accessCause).toBe("entitlement_required");
    expect(sectorNativeContext({ ...base, generation: null, transport: "access" }).accessCause).toBeUndefined();
    expect(sectorNativeContext({ ...base, generation: null, transport: "error",
      accessCause: "entitlement_required" }).accessCause).toBeUndefined();
    expect(sectorNativeContext({ ...base, generation: null, transport: "loading",
      accessCause: "entitlement_required" }).accessCause).toBeUndefined();
  });

  it("never survives beside an admitted generation", () => {
    const generation = sectorNativeGeneration(captured);
    expect(generation).not.toBeNull();
    expect(sectorNativeContext({ ...base, generation, transport: "ready",
      accessCause: "entitlement_required" }).accessCause).toBeUndefined();
  });
});
