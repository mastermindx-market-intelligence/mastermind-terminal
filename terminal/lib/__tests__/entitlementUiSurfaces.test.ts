import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const component = (name: string) =>
  readFileSync(path.resolve(__dirname, "..", "..", "components", name), "utf8");

describe("premium UI does not sell upgrades while entitlement is unresolved", () => {
  it("forwards actual verification state from the one client entitlement reader", () => {
    const shell = component("TerminalShell.tsx");
    expect(shell).toContain("const accessState = entitlementVisualState(ent)");
    expect(shell).toContain("userTier={userTier} accessState={accessState}");
    // Avoid adding independent /api/me readers or session-based grants in these surfaces.
    for (const name of ["IndicatorsModal.tsx", "GuidePanel.tsx", "IndicatorSettings.tsx", "AlertsView.tsx"]) {
      expect(component(name)).not.toContain('fetch("/api/me"');
    }
  });

  it("keeps the upgrade link strictly behind a verified entitlement result", () => {
    const modal = component("IndicatorsModal.tsx");
    expect(modal).toContain('locked && accessState !== "verified"');
    expect(modal).toContain('accessState === "checking"');
    const guide = component("GuidePanel.tsx");
    expect(guide).toContain('locked && accessState === "verified"');
    expect(guide).toContain('locked && accessState !== "verified"');
    expect(guide).toContain('href={ACS_UPGRADE_URL}');
  });

  it("preserves disabled features while resolving instead of claiming a paid grant", () => {
    const settings = component("IndicatorSettings.tsx");
    expect(settings).toContain('accessState !== "verified"');
    expect(settings).toContain('const isLocked = (m: SuiteModuleMeta)');
    expect(settings).toContain('ModuleSection key={m.key} m={m} values={SV} locked={locked} accessState={accessState}');
    const alerts = component("AlertsView.tsx");
    expect(alerts).toContain('const accessState = entitlementVisualState(ent)');
    expect(alerts).toContain('accessState === "verified" && (');
    expect(alerts).toContain('locked={suiteMode === "seq" ? seqLocked : curLocked}');
  });

  it("does not convert an unverified server auth answer into a verified Free upsell", () => {
    const options = readFileSync(path.resolve(__dirname, "..", "..", "app", "(shell)", "options", "page.tsx"), "utf8");
    expect(options).toContain('verifySession={access.reason === "authentication_denied"}');
    expect(options).toContain('if (access.access === "unavailable")');
    const paywall = component("OptionsPaywall.tsx");
    expect(paywall).toContain('recoverMemberSession({');
    expect(paywall).toContain('verifySession && recovery !== "guest"');
  });
});
