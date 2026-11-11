/**
 * Canonical Shared Shell beta catalog release, Macro #10639 -> Terminal #1244.
 *
 * This tests the REAL generated catalog and resolver. The source pins describe
 * the approved immutable inventory, not a locally edited route allowlist.
 * The original managed workspace's unpublished red-first test is untouched.
 */
import { describe, expect, it } from "vitest";
import projection from "../sharedShellRoutes.generated.json";
import { INTELLIGENCE_DESTINATIONS } from "../shared-shell/intelligenceNavigation";
import {
  isLegacyShellPath,
  resolveSharedShellLink,
  sharedShellCatalog,
  sharedShellDirectory,
  sharedShellSource,
} from "../sharedShellRoutes";

const INVENTORY = "e39ec45902c1a2bb28507beb851593be6e422167";
const REGISTRY_SHA256 = "ee0708b3be98e37268af469bb67c936a7c3135eb6775388051078d90fe2484dd";

/** The previous 17 native routes plus exactly four approved registry additions. */
const APPROVED_NATIVE = [
  "/alerts", "/analysis", "/discover", "/dislocations", "/embed/chart",
  "/intelligence", "/invite", "/learn", "/login", "/monitor", "/options",
  "/options/equity-replay", "/options/futures", "/portfolio", "/prophet",
  "/research", "/reset-password", "/scripts", "/sectors", "/terminal",
  "/today",
];

const RETAINED_LEGACY = [
  "/macro.html", "/us_stocks.html", "/sector_cycles.html",
  "/stocks/earnings/ge-2026q3-call-record.html",
  "/stocks/earnings/aal-2026q3-call-record.html",
  "/stocks/earnings/abbv-2026q3-call-record.html",
  "/stocks/earnings/page-61.html", "/stocks/HTFL.html", "/stocks/MIAX.html",
  "/stocks/PLNT.html", "/stocks/earnings/plnt-2026q2-call-record.html",
];

const WITHHELD = [
  "/expectation_surface.html", "/gmi.html", "/gmi-index.html",
  "/gmi-coverage.html", "/committee.html", "/crossasset.html",
  "/api/private", "/macro/fragments/credit.html",
  "/consumer_cyclical_plnt.html", "/stocks/earnings/not-published-call-record.html",
];

describe("immutable Macro -> Terminal beta catalog publication", () => {
  it("binds the unchanged canonical exporter schema, registry and protected inventory", () => {
    expect(projection.schema).toBe("mastermind.shared_shell_routes.v1");
    expect(sharedShellSource).toEqual({
      registrySha256: REGISTRY_SHA256,
      macro: "73852e221d9ce087abe30b4703de3627773f3351",
      terminal: "7063a8e1324c75f69361688161f1e2a90bf87951",
      mastermind: "7ab47f0b62d9a22ff16a13f6b99b96b681874a93",
      inventory: INVENTORY,
    });
    expect(projection.coverage.trackedHtml).toBeGreaterThan(projection.legacyPaths.length);
    expect(projection.coverage.legacyPaths).toBe(14_048);
    expect(sharedShellCatalog.legacyPaths).toHaveLength(14_048);
    expect(sharedShellDirectory).toHaveLength(320);
  });

  it("admits only the canonical native set, without duplicate membership or collisions", () => {
    expect(sharedShellCatalog.nativePaths).toEqual(APPROVED_NATIVE);
    const legacy = new Set(sharedShellCatalog.legacyPaths);
    const native = new Set(sharedShellCatalog.nativePaths);
    expect(legacy.size).toBe(sharedShellCatalog.legacyPaths.length);
    expect(native.size).toBe(sharedShellCatalog.nativePaths.length);
    for (const path of native) expect(legacy.has(path)).toBe(false);
    expect(new Set(sharedShellDirectory.map((row) => row.href)).size).toBe(sharedShellDirectory.length);
  });

  it.each([
    ["/intelligence", "terminal:intelligence", "public_shell_premium_payload"],
    ["/prophet", "terminal:prophet", "premium"],
    ["/sectors", "terminal:sectors", "public_shell_premium_payload"],
  ])("publishes %s as a native bilingual intelligence destination", (href, id, tier) => {
    const row = sharedShellDirectory.find((entry) => entry.href === href);
    expect(row).toMatchObject({ id, href, kind: "native", group: "app_nav.rail", payloadTier: tier });
    expect(row?.title.en.trim()).not.toBe("");
    expect(row?.title.zh.trim()).not.toBe("");
    expect(resolveSharedShellLink(href, "/macro.html")).toEqual({ kind: "native", href });
  });

  it("retains the paid Equity Replay route without treating it as a public legacy document", () => {
    expect(sharedShellDirectory.find((row) => row.href === "/options/equity-replay"))
      .toMatchObject({ id: "terminal:options_equity_replay", kind: "native", payloadTier: "premium" });
    expect(isLegacyShellPath("/options/equity-replay")).toBe(false);
  });

  it.each(RETAINED_LEGACY)("keeps protected published legacy membership for %s", (path) => {
    expect(isLegacyShellPath(path)).toBe(true);
    expect(resolveSharedShellLink(path, "/macro.html")).toEqual({ kind: "legacy", href: path });
  });

  it.each(WITHHELD)("never admits unavailable, internal or withdrawn %s", (path) => {
    expect(isLegacyShellPath(path)).toBe(false);
    expect(sharedShellCatalog.nativePaths).not.toContain(path);
    expect(resolveSharedShellLink(path, "/macro.html").kind).toBe("blocked");
  });

  it("retains all seven unregistered HTML refusals and does not silently admit them", () => {
    const unregistered = projection.coverage.excluded
      .filter((row) => row.reason === "unregistered")
      .map((row) => row.path).sort();
    expect(unregistered).toEqual([
      "/expectation_surface.html", "/gmi-coverage.html", "/gmi-index.html",
      "/gmi-issuer-mu.html", "/gmi-relationships.html", "/gmi-states.html", "/gmi.html",
    ]);
    for (const path of unregistered) expect(isLegacyShellPath(path)).toBe(false);
  });

  it("keeps the complete Macro Prophet entrance distinct from native paid model plans", () => {
    expect(INTELLIGENCE_DESTINATIONS.find((row) => row.key === "prophet")?.href)
      .toBe("/us_stocks.html");
    expect(resolveSharedShellLink("/us_stocks.html?symbol=NVDA#setup", "/macro.html"))
      .toEqual({ kind: "legacy", href: "/us_stocks.html?symbol=NVDA#setup" });
    expect(resolveSharedShellLink("/prophet?tab=plans#latest", "/macro.html"))
      .toEqual({ kind: "native", href: "/prophet?tab=plans#latest" });
  });

  it("preserves query order and fragments while removing only the bridge transport keys", () => {
    expect(resolveSharedShellLink(
      "/macro.html?symbol=GE&q=a&q=b&mmx_shell=1&mmx_generation=g1&mmx_shell_hint=keep#evidence",
      "/macro.html",
    )).toEqual({
      kind: "legacy", href: "/macro.html?symbol=GE&q=a&q=b&mmx_shell_hint=keep#evidence",
    });
    expect(resolveSharedShellLink(
      "/intelligence?source=macro&source=sectors&mmx_shell=1#reading",
      "/macro.html",
    )).toEqual({ kind: "native", href: "/intelligence?source=macro&source=sectors#reading" });
    expect(resolveSharedShellLink("/intelligence?access_token=secret", "/macro.html").kind)
      .toBe("blocked");
  });
});
