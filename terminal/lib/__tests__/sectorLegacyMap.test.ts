import { describe, expect, it } from "vitest";
import {
  APPENDIX_A_ANCHOR_TABLE,
  DEFAULT_LEGACY_DESTINATION,
  LEGACY_VIEWS,
  resolveLegacyDestination,
  type LegacyDestination,
  type LegacyView,
} from "@/lib/sectorLegacyMap";

describe("sectorLegacyMap — Appendix A 24-anchor table", () => {
  const tableCases: readonly {
    anchor: string;
    expected: LegacyDestination;
  }[] = [
    {
      anchor: "#actnow-section",
      expected: {
        view: "overview",
        job: "explore",
        canonicalDestination: "Explore / native calls",
        section: "actnow-section",
        anchor: "actnow-section",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#regime",
      expected: {
        view: "overview",
        job: "explore",
        canonicalDestination: "Explore / native calls / regime",
        section: "regime",
        anchor: "regime",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#grader",
      expected: {
        view: "overview",
        job: "explore",
        canonicalDestination: "Explore / outcomes",
        section: "grader",
        anchor: "grader",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#si-map",
      expected: {
        view: "map",
        job: "explore",
        canonicalDestination: "Explore / sector map",
        section: "si-map",
        anchor: "si-map",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#rotmap-section",
      expected: {
        view: "map",
        job: "explore",
        canonicalDestination: "Explore / rotation",
        section: "rotmap-section",
        anchor: "rotmap-section",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#sc-cyclemap",
      expected: {
        view: "map",
        job: "cycles",
        canonicalDestination: "Explore / Cycles",
        section: "sc-cyclemap",
        anchor: "sc-cyclemap",
        routedTo: "cycles",
      },
    },
    {
      anchor: "#board",
      expected: {
        view: "map",
        job: "explore",
        canonicalDestination: "Explore / native calls",
        section: "board",
        anchor: "board",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#si-movement",
      expected: {
        view: "moving",
        job: "explore",
        canonicalDestination: "Explore / rotation",
        section: "si-movement",
        anchor: "si-movement",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#rc-events-mount",
      expected: {
        view: "moving",
        job: "explore",
        canonicalDestination: "Explore / rotation / events",
        section: "rc-events-mount",
        anchor: "rc-events-mount",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#rotation-app",
      expected: {
        view: "moving",
        job: "explore",
        canonicalDestination: "Explore / rotation / groups",
        section: "rotation-app",
        anchor: "rotation-app",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#si-money",
      expected: {
        view: "money",
        job: "explore",
        canonicalDestination: "Explore / breadth and flows",
        section: "si-money",
        anchor: "si-money",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#internals-section",
      expected: {
        view: "money",
        job: "explore",
        canonicalDestination: "Explore / breadth",
        section: "internals-section",
        anchor: "internals-section",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#scc-leadership",
      expected: {
        view: "money",
        job: "explore",
        canonicalDestination: "Explore / leadership evidence",
        section: "scc-leadership",
        anchor: "scc-leadership",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#explore-section",
      expected: {
        view: "explore",
        job: "explore",
        canonicalDestination: "Explore / themes",
        section: "explore-section",
        anchor: "explore-section",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#table-section",
      expected: {
        view: "explore",
        job: "explore",
        canonicalDestination: "Explore / themes / table",
        section: "table-section",
        anchor: "table-section",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#chart-section",
      expected: {
        view: "explore",
        job: "explore",
        canonicalDestination: "Explore / compare",
        section: "chart-section",
        anchor: "chart-section",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#forming-narratives",
      expected: {
        view: "explore",
        job: "research",
        canonicalDestination: "Research / forming narratives",
        section: "forming-narratives",
        anchor: "forming-narratives",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#tm-mount",
      expected: {
        view: "explore",
        job: "explore",
        canonicalDestination: "Explore / historical replay",
        section: "tm-mount",
        anchor: "tm-mount",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#confluence",
      expected: {
        view: "confluence",
        job: "explore",
        canonicalDestination: "Explore / entry evidence",
        section: "si-confluence",
        anchor: "confluence",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#sc-app",
      expected: {
        view: "confluence",
        job: "explore",
        canonicalDestination: "Explore / entry evidence / table",
        section: "sc-app",
        anchor: "sc-app",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#sc-top",
      expected: {
        view: "confluence",
        job: "explore",
        canonicalDestination: "Explore / entry evidence",
        section: "sc-top",
        anchor: "sc-top",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#accumulation-section",
      expected: {
        view: "moving",
        job: "explore",
        canonicalDestination: "Explore / accumulation context",
        section: "accumulation-section",
        anchor: "accumulation-section",
        routedTo: "sector-intelligence",
        displayOnly: true,
      },
    },
    {
      anchor: "#si-heat-section",
      expected: {
        view: "explore",
        job: "explore",
        canonicalDestination: "Explore / theme heat",
        section: "theme-heat-section",
        anchor: "si-heat-section",
        routedTo: "sector-intelligence",
      },
    },
    {
      anchor: "#si-measured",
      expected: {
        view: "map",
        job: "explore",
        canonicalDestination: "Explore / measured leadership",
        section: "si-measured",
        anchor: "si-measured",
        routedTo: "sector-intelligence",
      },
    },
  ];

  it("covers all 24 rows of Appendix A", () => {
    expect(APPENDIX_A_ANCHOR_TABLE).toHaveLength(24);
    expect(tableCases).toHaveLength(24);
    expect(tableCases.map((c) => c.anchor)).toEqual(
      APPENDIX_A_ANCHOR_TABLE.map((r) => r.anchor),
    );
  });

  it.each(tableCases)(
    "resolves literal anchor $anchor to exact Appendix A destination",
    ({ anchor, expected }) => {
      expect(resolveLegacyDestination(anchor)).toEqual(expected);
      // Also works when embedded in a legacy page URL or decomposed object
      expect(resolveLegacyDestination(`sector_central.html${anchor}`)).toEqual(
        expected,
      );
      expect(resolveLegacyDestination({ hash: anchor })).toEqual(expected);
    },
  );

  it("reaches all six legacy view meanings across the 24-row table", () => {
    expect(LEGACY_VIEWS).toEqual([
      "overview",
      "map",
      "moving",
      "money",
      "explore",
      "confluence",
    ]);
    const reachedViews = new Set<LegacyView>(
      tableCases.map((c) => resolveLegacyDestination(c.anchor).view),
    );
    for (const v of LEGACY_VIEWS) {
      expect(reachedViews.has(v)).toBe(true);
    }
    expect(reachedViews.size).toBe(6);
  });

  it("prevents a blanket redirect to Brief (>= 3 anchors map outside overview/brief)", () => {
    const nonOverviewAnchors = tableCases.filter(
      (c) => resolveLegacyDestination(c.anchor).view !== "overview",
    );
    expect(nonOverviewAnchors.length).toBeGreaterThanOrEqual(3);
    expect(nonOverviewAnchors.length).toBe(21);

    // Every single one of the 24 anchors has a non-Brief canonical job (22 explore, 1 research, 1 cycles)
    const nonBriefJobs = tableCases.filter(
      (c) => resolveLegacyDestination(c.anchor).job !== "brief",
    );
    expect(nonBriefJobs).toHaveLength(24);
  });

  it("enforces Cycles precedence, dossier precedence, and display-only market context", () => {
    // 1. Cycles precedence on #sc-cyclemap
    const cycleMap = resolveLegacyDestination("#sc-cyclemap");
    expect(cycleMap.routedTo).toBe("cycles");
    expect(cycleMap.job).toBe("cycles");
    expect(cycleMap.canonicalDestination).toBe("Explore / Cycles");
    expect(cycleMap.section).toBe("sc-cyclemap");

    // 2. Dossier precedence on #dossier and sectors/<SYM>.html#cycle
    const dossier = resolveLegacyDestination("#dossier");
    expect(dossier.routedTo).toBe("cycles");
    expect(dossier.job).toBe("cycles");
    expect(dossier.section).toBe("sc-cyclemap");

    const sectorDossier = resolveLegacyDestination("sectors/XLF.html#cycle");
    expect(sectorDossier.routedTo).toBe("cycles");
    expect(sectorDossier.job).toBe("cycles");
    expect(sectorDossier.subject).toEqual({ kind: "sector", id: "xlf" });

    const dossierWithSlug = resolveLegacyDestination("#dossier/xlk");
    expect(dossierWithSlug.routedTo).toBe("cycles");
    expect(dossierWithSlug.subject).toEqual({ kind: "sector", id: "xlk" });

    // 3. Display-only accumulation context (never an actionable surface or user Watch list)
    const accum = resolveLegacyDestination("#accumulation-section");
    expect(accum.displayOnly).toBe(true);
    expect(accum.view).toBe("moving");
    expect(accum.job).toBe("explore");
    expect(accum.canonicalDestination).toBe("Explore / accumulation context");

    // 4. Renamed heat section equivalence (#theme-heat-section === #si-heat-section)
    const heatOld = resolveLegacyDestination("#theme-heat-section");
    const heatNew = resolveLegacyDestination("#si-heat-section");
    expect(heatOld).toEqual(heatNew);
    expect(heatNew.section).toBe("theme-heat-section");

    // 5. Confluence target equivalence (sector-central#si-confluence === #confluence)
    const confDirect = resolveLegacyDestination("sector-central#si-confluence");
    const confTable = resolveLegacyDestination("#confluence");
    expect(confDirect).toEqual(confTable);
    expect(confDirect.section).toBe("si-confluence");
  });
});

describe("sectorLegacyMap — runtime identity families & ?g= codec", () => {
  it("resolves valid #theme-<id> identities and rejects malformed ones to fallback", () => {
    expect(resolveLegacyDestination("#theme-semis")).toEqual({
      view: "explore",
      job: "explore",
      canonicalDestination: "Explore → theme/basket detail",
      section: "explore-section",
      subject: { kind: "theme", id: "semis" },
      routedTo: "sector-intelligence",
    });

    expect(resolveLegacyDestination("#theme-AI_Infra-2026")).toEqual({
      view: "explore",
      job: "explore",
      canonicalDestination: "Explore → theme/basket detail",
      section: "explore-section",
      subject: { kind: "theme", id: "AI_Infra-2026" },
      routedTo: "sector-intelligence",
    });

    // Empty / bad charset / overlong / injection attempts -> fallback
    expect(resolveLegacyDestination("#theme-")).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
    expect(resolveLegacyDestination("#theme-<script>alert(1)</script>")).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
    expect(resolveLegacyDestination("#theme-a b c")).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
    expect(resolveLegacyDestination(`#theme-${"a".repeat(65)}`)).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
  });

  it("resolves valid #read-<id> trace rows with waitForRow: true and rejects malformed ones", () => {
    expect(resolveLegacyDestination("#read-semi_equip")).toEqual({
      view: "overview",
      job: "explore",
      canonicalDestination: "Explore / native calls",
      section: "actnow-section",
      subject: { kind: "read", id: "semi_equip" },
      routedTo: "sector-intelligence",
      waitForRow: true,
    });

    expect(resolveLegacyDestination("#read-XLF-01")).toEqual({
      view: "overview",
      job: "explore",
      canonicalDestination: "Explore / native calls",
      section: "actnow-section",
      subject: { kind: "read", id: "XLF-01" },
      routedTo: "sector-intelligence",
      waitForRow: true,
    });

    expect(resolveLegacyDestination("#read-")).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
    expect(resolveLegacyDestination("#read-../etc/passwd")).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
    expect(resolveLegacyDestination(`#read-${"x".repeat(70)}`)).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
  });

  it("resolves valid #ne-<signature> narrative emergence identities and rejects malformed ones", () => {
    expect(resolveLegacyDestination("#ne-ABC123")).toEqual({
      view: "explore",
      job: "research",
      canonicalDestination: "Research / forming narratives",
      section: "forming-narratives",
      subject: { kind: "name", signature: "ABC123" },
      routedTo: "sector-intelligence",
    });

    expect(resolveLegacyDestination("#ne-grid_power_2026")).toEqual({
      view: "explore",
      job: "research",
      canonicalDestination: "Research / forming narratives",
      section: "forming-narratives",
      subject: { kind: "name", signature: "grid_power_2026" },
      routedTo: "sector-intelligence",
    });

    expect(resolveLegacyDestination("#ne-")).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
    expect(resolveLegacyDestination("#ne-<img src=x onerror=alert(1)>")).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
    expect(resolveLegacyDestination(`#ne-${"z".repeat(80)}`)).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
  });

  it("resolves valid ?g=<id> measured-group codec queries and rejects garbage values", () => {
    expect(resolveLegacyDestination("?g=xlf")).toEqual({
      view: "map",
      job: "explore",
      canonicalDestination: "Explore / measured leadership",
      section: "si-measured",
      anchor: "si-measured",
      subject: { kind: "sector", id: "xlf" },
      routedTo: "sector-intelligence",
    });

    expect(
      resolveLegacyDestination("sector_central.html?g=semiconductors#si-measured"),
    ).toEqual({
      view: "map",
      job: "explore",
      canonicalDestination: "Explore / measured leadership",
      section: "si-measured",
      anchor: "si-measured",
      subject: { kind: "sector", id: "semiconductors" },
      routedTo: "sector-intelligence",
    });

    expect(resolveLegacyDestination({ search: "?g=xlk", hash: "#map" })).toEqual({
      view: "map",
      job: "explore",
      canonicalDestination: "Explore / sector map",
      section: "si-measured",
      subject: { kind: "sector", id: "xlk" },
      routedTo: "sector-intelligence",
    });

    // Garbage / duplicate / empty ?g= -> fallback
    expect(resolveLegacyDestination("?g=")).toEqual(DEFAULT_LEGACY_DESTINATION);
    expect(resolveLegacyDestination("?g=xlf&g=xlk")).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
    expect(resolveLegacyDestination("?g=<script>")).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
    expect(resolveLegacyDestination(`?g=${"m".repeat(100)}`)).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
  });

  it("resolves #cycles/f=&g=&m=&w=&s= state hashes with Cycles precedence", () => {
    const res = resolveLegacyDestination("#cycles/f=us&g=all&m=price&w=5y&s=XLF");
    expect(res).toEqual({
      view: "map",
      job: "cycles",
      canonicalDestination: "Explore / Cycles",
      section: "sc-cyclemap",
      routedTo: "cycles",
      cyclesState: "f=us&g=all&m=price&w=5y&s=XLF",
      subject: { kind: "sector", id: "xlf" },
    });

    expect(resolveLegacyDestination("#cycles/")).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
    expect(resolveLegacyDestination("#cycles/s=<script>")).toEqual(
      DEFAULT_LEGACY_DESTINATION,
    );
  });
});

describe("sectorLegacyMap — malformed, adversarial, and boundary inputs never throw", () => {
  const weirdInputs: unknown[] = [
    "",
    "#",
    "??",
    "#%zz",
    "javascript:alert(1)",
    "#theme-a b c",
    `#${"a".repeat(3000)}`,
    "https://app.mastermind-x.com/sector_central.html?foo=bar#unknown-anchor",
    "/sectors",
    "?unknown=1",
    "sector_central.html?g=bad value#theme-bad value",
    "   ",
    "#overview",
    "#map",
    "#moving",
    "#money",
    "#explore",
    "#🎯-unicode-anchor-中文",
    null,
    undefined,
    42,
    true,
    [],
    {},
    { hash: null, search: 123, path: {} },
    { hash: `#${"x".repeat(5000)}` },
  ];

  it.each(weirdInputs.map((v, i) => [i, v]))(
    "never throws on input #%i",
    (_idx, raw) => {
      expect(() =>
        resolveLegacyDestination(raw as Parameters<typeof resolveLegacyDestination>[0]),
      ).not.toThrow();
      const out = resolveLegacyDestination(
        raw as Parameters<typeof resolveLegacyDestination>[0],
      );
      expect(LEGACY_VIEWS).toContain(out.view);
      expect(["sector-intelligence", "cycles"]).toContain(out.routedTo);
      if (out.subject?.id) {
        expect(out.subject.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
      }
      if (out.subject?.signature) {
        expect(out.subject.signature).toMatch(
          /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/,
        );
      }
    },
  );
});
