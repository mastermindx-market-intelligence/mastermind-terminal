/**
 * prophetUrlState.test.ts — contract tests for the Prophet URL codec.
 *
 * The codec owns two key families, chosen by the mount the surface rides:
 *   - canonical `/prophet` — the Lane A contract (2026-11-12), published for
 *     the Today / Sector / Company lanes building in parallel:
 *     `tab` (today|screener|plans|options|issue|sector), `sector`, `symbol`
 *     and REPEATABLE `sel` (ordered compare selection), plus the `prophet*`
 *     keys that stay the wire form for their own dimensions.
 *   - legacy `/options?tab=prophet` — the original `prophet*` family
 *     exclusively; the bare `tab` there belongs to the Options hub and is
 *     never this codec's to read or write.
 *
 * Laws pinned here:
 *   - Round-trip is exact on both mounts: write → parse restores the same
 *     state, defaults included, and defaults stay OUT of the address.
 *   - The contract keys win over their `prophet*` predecessors on canonical;
 *     old links (`prophetLane=macro`, `prophetGroup`, `prophetSymbol`) still
 *     parse on both mounts — `macro` reads as the `plans` tab.
 *   - `sel` parses in order, dedupes, drops unlawful symbols and caps at 12;
 *     the legacy mount spells the same selection REPEATABLY as `prophetSel`
 *     (and never writes the bare contract keys).
 *   - Invalid values degrade to defaults, never to an error page.
 *   - Non-prophet params survive a write; the legacy hub `tab=prophet` is
 *     preserved untouched.
 *   - The return carrier is same-origin, path-allowlisted and bounded: it can
 *     never become an open redirect, and an over-budget carrier is dropped
 *     rather than truncated.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROPHET_STATE, DEFAULT_PROPHET_STATE_LEGACY, PROPHET_SEL_MAX,
  encodeProphetFrom, parseProphetFrom, parseProphetSel, parseProphetState,
  prophetFromHrefAdmissible, prophetFromReturnHref, prophetHref,
  prophetMountForPathname, prophetQuery, toggleProphetSel, writeProphetState,
  type ProphetUrlState,
} from "@/lib/prophetUrlState";

const url = (href: string) => new URL(href, "https://terminal.test");
const roundTrip = (state: ProphetUrlState, mount: "canonical" | "legacy" = "canonical"): ProphetUrlState => {
  const base = mount === "canonical" ? url("/prophet") : url("/options?tab=prophet");
  return parseProphetState(url(writeProphetState(base, state, mount)).searchParams, mount);
};

/**
 * The intended composition: `encodeProphetFrom` returns a percent-encoded
 * carrier meant to be embedded RAW in a query string, so a URLSearchParams
 * read decodes it exactly once back to the JSON `parseProphetFrom` expects.
 */
const carrierFromEncoded = (encoded: string) => {
  const params = new URLSearchParams();
  params.set("prophetFrom", encoded);
  return parseProphetFrom(params.get("prophetFrom"));
};

const FULL_STATE: ProphetUrlState = {
  lane: "sector",
  view: "setup",
  group: "housing",
  symbol: "SBUX",
  plan: "SBUX-BULL-20260702",
  q: "bank",
  state: "open_plan",
  offset: 40,
  from: { v: 1, kind: "sector", href: "/sectors?group=housing" },
  sel: ["SBUX", "HD", "WMT"],
};
const FULL_STATE_NO_FROM: ProphetUrlState = { ...FULL_STATE, from: null };

describe("mount inference", () => {
  it("/options (and only /options) is the legacy mount", () => {
    expect(prophetMountForPathname("/prophet")).toBe("canonical");
    expect(prophetMountForPathname("/prophet/company/SBUX")).toBe("canonical");
    expect(prophetMountForPathname("/")).toBe("canonical");
    expect(prophetMountForPathname("/options")).toBe("legacy");
    expect(prophetMountForPathname("/options/SBUX")).toBe("legacy");
  });

  it("writeProphetState infers the mount from the URL's own pathname", () => {
    expect(writeProphetState(url("/prophet"), DEFAULT_PROPHET_STATE_LEGACY, )).toBe("/prophet?tab=plans");
    expect(writeProphetState(url("/options?tab=prophet"), { ...DEFAULT_PROPHET_STATE, lane: "issue" }))
      .toBe("/options?tab=prophet&prophetLane=issue");
  });
});

describe("state round-trip", () => {
  it("retains a candidate detail and Chinese search in the existing canonical key family", () => {
    const state:ProphetUrlState={...DEFAULT_PROPHET_STATE,lane:"candidates",view:"setup",symbol:"DEMOC",q:"材料"};
    expect(roundTrip(state)).toEqual(state);
    const params=url(prophetHref(state,"canonical")).searchParams;
    expect(params.get("tab")).toBe("candidates");expect(params.get("symbol")).toBe("DEMOC");
    expect(params.get("prophetQ")).toBe("材料");expect(params.has("prophetView")).toBe(false);
    expect(params.has("prophetSymbol")).toBe(false);
  });
  it("keeps candidate-only search grammar out of every incumbent server-backed lane", () => {
    expect(prophetQuery("科技","candidates")).toBe("科技");
    for(const lane of ["today","screener","sector","plans","options","issue"] as const) expect(prophetQuery("科技",lane)).toBe("");
    expect(prophetQuery("Cedar Networks","screener")).toBe("Cedar Networks");
    expect(prophetQuery("bad\nquery","candidates")).toBe("");
    expect(prophetQuery("bad\n","candidates")).toBe("");
    expect(prophetQuery("x".repeat(65),"candidates")).toBe("");
  });
  it("DEFAULT_PROPHET_STATE survives write → parse unchanged on both mounts", () => {
    expect(roundTrip(DEFAULT_PROPHET_STATE)).toEqual(DEFAULT_PROPHET_STATE);
    expect(roundTrip(DEFAULT_PROPHET_STATE_LEGACY, "legacy")).toEqual(DEFAULT_PROPHET_STATE_LEGACY);
  });

  it("defaults stay out of the address on both mounts", () => {
    expect(writeProphetState(url("/prophet"), DEFAULT_PROPHET_STATE)).toBe("/prophet");
    expect(writeProphetState(url("/options?tab=prophet"), DEFAULT_PROPHET_STATE_LEGACY, "legacy"))
      .toBe("/options?tab=prophet");
  });

  it("every non-default field survives write → parse unchanged on the canonical mount", () => {
    expect(roundTrip(FULL_STATE)).toEqual(FULL_STATE);
  });

  it("every non-default field except the carrier survives write → parse unchanged", () => {
    expect(roundTrip(FULL_STATE_NO_FROM)).toEqual(FULL_STATE_NO_FROM);
  });

  it("the legacy mount round-trips every field, the selection as `prophetSel`", () => {
    expect(roundTrip(FULL_STATE, "legacy")).toEqual(FULL_STATE);
  });

  it("a canonical write spells the contract keys and no superseded ones", () => {
    const written = writeProphetState(url("/prophet?prophetSel=GE&foo=bar"), FULL_STATE_NO_FROM);
    const params = url(written).searchParams;
    expect(params.get("tab")).toBe("sector");
    expect(params.get("sector")).toBe("housing");
    expect(params.get("symbol")).toBe("SBUX");
    expect(params.getAll("sel")).toEqual(["SBUX", "HD", "WMT"]);
    // The setup view is implied by `symbol` — the canonical link carries ONE
    // key set (no `prophetView` alongside the contract keys).
    expect(params.has("prophetView")).toBe(false);
    expect(params.get("prophetPlan")).toBe("SBUX-BULL-20260702");
    expect(params.get("prophetQ")).toBe("bank");
    expect(params.get("prophetState")).toBe("open_plan");
    expect(params.get("prophetOffset")).toBe("40");
    expect(params.has("prophetLane")).toBe(false);
    expect(params.has("prophetGroup")).toBe(false);
    expect(params.has("prophetSymbol")).toBe(false);
    // The legacy spelling is superseded on canonical, never duplicated.
    expect(params.has("prophetSel")).toBe(false);
    expect(params.get("foo")).toBe("bar");
  });

  it("the canonical setup link is the contract keys alone — `symbol` IS setup", () => {
    // The COO's visual pass: `/prophet?tab=sector&symbol=CARR&prophetView=setup`
    // worked while `…&view=setup` did not, because canonical setup links mixed
    // the key families. The canonical link now spells ONE family: a symbol is
    // the setup, a sector is its population, and neither needs a view key.
    const setupHref = prophetHref({ ...DEFAULT_PROPHET_STATE, lane: "sector", view: "setup", symbol: "CARR" }, "canonical");
    expect(setupHref).toBe("/prophet?tab=sector&symbol=CARR");
    const parsed = parseProphetState(url(setupHref).searchParams);
    expect(parsed.view).toBe("setup");
    expect(parsed.symbol).toBe("CARR");

    const populationHref = prophetHref({ ...DEFAULT_PROPHET_STATE, lane: "sector", view: "population", group: "housing" }, "canonical");
    expect(populationHref).toBe("/prophet?tab=sector&sector=housing");
    expect(parseProphetState(url(populationHref).searchParams).view).toBe("population");

    // The picker with a group still in context is the ONE state the contract
    // keys cannot express; it keeps the pre-contract wire key (no new key).
    const pickerHref = prophetHref({ ...DEFAULT_PROPHET_STATE, lane: "sector", view: "overview", group: "housing" }, "canonical");
    expect(pickerHref).toBe("/prophet?tab=sector&sector=housing&prophetView=overview");
    expect(parseProphetState(url(pickerHref).searchParams).view).toBe("overview");
  });

  it("an explicit `prophetView` still wins over the derived view on canonical", () => {
    // Links minted before this rule (and the picker-with-context state) keep
    // their meaning: the explicit value is authoritative.
    expect(parseProphetState(new URLSearchParams("tab=sector&symbol=CARR&prophetView=population")).view).toBe("population");
    expect(parseProphetState(new URLSearchParams("tab=sector&sector=housing&prophetView=setup")).view).toBe("setup");
    // A redundant value is scrubbed by the next write, never duplicated.
    expect(prophetHref({ ...DEFAULT_PROPHET_STATE, lane: "sector", view: "setup", symbol: "CARR" }, "canonical"))
      .toBe("/prophet?tab=sector&symbol=CARR");
  });

  it("a legacy write spells only the prophet* family and never touches the hub tab", () => {
    const written = writeProphetState(url("/options?tab=prophet"), FULL_STATE_NO_FROM, "legacy");
    const params = url(written).searchParams;
    expect(params.get("tab")).toBe("prophet");
    expect(params.get("prophetLane")).toBe("sector");
    expect(params.get("prophetGroup")).toBe("housing");
    expect(params.get("prophetSymbol")).toBe("SBUX");
    expect(params.getAll("sel")).toEqual([]);
    expect(params.getAll("prophetSel")).toEqual(["SBUX", "HD", "WMT"]);
    expect(params.has("sector")).toBe(false);
    expect(params.has("symbol")).toBe(false);
    expect(params.get("prophetView")).toBe("setup");
  });
});

describe("contract keys win; old links still parse", () => {
  it("`tab` wins over a stale `prophetLane` on canonical", () => {
    const parsed = parseProphetState(new URLSearchParams("tab=screener&prophetLane=sector"));
    expect(parsed.lane).toBe("screener");
  });

  it("a canonical URL without `tab` still honors `prophetLane`", () => {
    expect(parseProphetState(new URLSearchParams("prophetLane=sector")).lane).toBe("sector");
    expect(parseProphetState(new URLSearchParams("prophetLane=issue")).lane).toBe("issue");
  });

  it("the retired `macro` lane value reads as `plans` on both mounts and both keys", () => {
    expect(parseProphetState(new URLSearchParams("tab=macro")).lane).toBe("plans");
    expect(parseProphetState(new URLSearchParams("prophetLane=macro")).lane).toBe("plans");
    expect(parseProphetState(new URLSearchParams("prophetLane=macro"), "legacy").lane).toBe("plans");
  });

  it("an unlawful `tab` degrades to `prophetLane`, then to the mount's default", () => {
    expect(parseProphetState(new URLSearchParams("tab=bogus&prophetLane=issue")).lane).toBe("issue");
    expect(parseProphetState(new URLSearchParams("tab=bogus")).lane).toBe("today");
    expect(parseProphetState(new URLSearchParams("tab=bogus"), "legacy").lane).toBe("plans");
  });

  it("the legacy mount never reads the hub's bare `tab` as a Prophet lane", () => {
    expect(parseProphetState(new URLSearchParams("tab=prophet"), "legacy").lane).toBe("plans");
    expect(parseProphetState(new URLSearchParams("tab=today"), "legacy").lane).toBe("plans");
  });

  it("`sector`/`symbol` win over `prophetGroup`/`prophetSymbol` on canonical", () => {
    const parsed = parseProphetState(new URLSearchParams(
      "sector=housing&prophetGroup=memory_storage&symbol=SBUX&prophetSymbol=LOW",
    ));
    expect(parsed.group).toBe("housing");
    expect(parsed.symbol).toBe("SBUX");
  });

  it("a canonical URL without contract keys still honors prophetGroup/prophetSymbol", () => {
    const parsed = parseProphetState(new URLSearchParams("prophetGroup=memory_storage&prophetSymbol=LOW"));
    expect(parsed.group).toBe("memory_storage");
    expect(parsed.symbol).toBe("LOW");
  });

  it("the legacy mount ignores bare `sector`/`symbol` — they are not its family", () => {
    const parsed = parseProphetState(new URLSearchParams("sector=housing&symbol=SBUX&prophetGroup=memory_storage"), "legacy");
    expect(parsed.group).toBe("memory_storage");
    expect(parsed.symbol).toBeNull();
  });

  it("a canonical write scrubs superseded prophet* lane keys from an old link's URL", () => {
    const written = writeProphetState(
      url("/prophet?prophetLane=sector&prophetGroup=housing&prophetSymbol=SBUX&foo=bar"),
      DEFAULT_PROPHET_STATE,
      "canonical",
    );
    const params = url(written).searchParams;
    expect(params.has("prophetLane")).toBe(false);
    expect(params.has("prophetGroup")).toBe(false);
    expect(params.has("prophetSymbol")).toBe(false);
    expect(params.get("foo")).toBe("bar");
  });
});

describe("compare selection (`sel`)", () => {
  it("parses in order, drops unlawful symbols and dedupes", () => {
    expect(parseProphetSel(["SBUX", "brk.b", "HD", "SBUX", "WMT"])).toEqual(["SBUX", "HD", "WMT"]);
    expect(parseProphetSel([])).toEqual([]);
  });

  it("caps at the ceiling and never mints an unbounded array", () => {
    const many = Array.from({ length: PROPHET_SEL_MAX + 5 }, (_, i) => `S${String(i).padStart(2, "0")}`);
    expect(parseProphetSel(many)).toHaveLength(PROPHET_SEL_MAX);
  });

  it("toggle appends at the end, removes in place, and never crosses the cap", () => {
    expect(toggleProphetSel(["SBUX", "HD"], "WMT")).toEqual(["SBUX", "HD", "WMT"]);
    expect(toggleProphetSel(["SBUX", "HD", "WMT"], "HD")).toEqual(["SBUX", "WMT"]);
    expect(toggleProphetSel(["SBUX"], "brk.b")).toEqual(["SBUX"]);
    const full = Array.from({ length: PROPHET_SEL_MAX }, (_, i) => `S${String(i).padStart(2, "0")}`);
    expect(toggleProphetSel(full, "ZZZ")).toEqual(full);
  });

  it("a canonical URL carries `sel` repeatably into the state", () => {
    const parsed = parseProphetState(new URLSearchParams("tab=today&sel=SBUX&sel=HD&sel=brk.b&sel=SBUX"));
    expect(parsed.sel).toEqual(["SBUX", "HD"]);
  });

  it("the legacy mount reads its own repeatable `prophetSel` spelling", () => {
    const parsed = parseProphetState(new URLSearchParams("tab=prophet&prophetSel=SBUX&prophetSel=HD&prophetSel=SBUX"), "legacy");
    expect(parsed.sel).toEqual(["SBUX", "HD"]);
    // The bare contract key is not the legacy family.
    expect(parseProphetState(new URLSearchParams("sel=SBUX"), "legacy").sel).toEqual([]);
  });

  it("a canonical URL naming only the legacy spelling still reads it; `sel` wins when both appear", () => {
    expect(parseProphetState(new URLSearchParams("prophetSel=SBUX&prophetSel=HD")).sel).toEqual(["SBUX", "HD"]);
    expect(parseProphetState(new URLSearchParams("sel=SBUX&prophetSel=HD")).sel).toEqual(["SBUX"]);
  });
});

describe("invalid values degrade to defaults", () => {
  it("unknown lane/view words, bad ids, over-long q, unknown state and negative offset all default", () => {
    const parsed = parseProphetState(new URLSearchParams({
      tab: "bogus",
      prophetView: "bogus",
      sector: "US SECTOR!",
      symbol: "brk.b",
      prophetPlan: "bad plan!",
      prophetQ: "x".repeat(300),
      prophetState: "watching",
      prophetOffset: "-5",
    }));
    expect(parsed).toEqual(DEFAULT_PROPHET_STATE);
  });

  it("an offset above the ceiling defaults; a lawful offset carries", () => {
    expect(parseProphetState(new URLSearchParams("prophetOffset=1000001")).offset).toBe(0);
    expect(parseProphetState(new URLSearchParams("prophetOffset=1000000")).offset).toBe(1_000_000);
    expect(parseProphetState(new URLSearchParams("prophetOffset=40")).offset).toBe(40);
  });

  it("a non-hex / uppercase group id is not a group id", () => {
    expect(parseProphetState(new URLSearchParams("sector=Housing")).group).toBeNull();
    expect(parseProphetState(new URLSearchParams("sector=housing")).group).toBe("housing");
  });

  it("a duplicate prophetFrom is ambiguous and reads null", () => {
    const params = new URLSearchParams();
    const raw = JSON.stringify({ v: 1, kind: "sector", href: "/sectors" });
    params.append("prophetFrom", raw);
    params.append("prophetFrom", raw);
    expect(parseProphetState(params).from).toBeNull();
  });
});

describe("foreign params", () => {
  it("unknown prophet* keys are ignored by the parser", () => {
    const parsed = parseProphetState(new URLSearchParams("prophetBogus=1&tab=sector"));
    expect(parsed).toEqual({ ...DEFAULT_PROPHET_STATE, lane: "sector" });
  });

  it("non-prophet params survive a write untouched on both mounts", () => {
    const canonical = writeProphetState(url("/prophet?foo=bar"), { ...DEFAULT_PROPHET_STATE, lane: "sector" });
    const canonicalParams = url(canonical).searchParams;
    expect(canonicalParams.get("tab")).toBe("sector");
    expect(canonicalParams.get("foo")).toBe("bar");

    const legacy = writeProphetState(url("/options?tab=prophet&foo=bar"), { ...DEFAULT_PROPHET_STATE_LEGACY, lane: "sector" }, "legacy");
    const legacyParams = url(legacy).searchParams;
    expect(legacyParams.get("tab")).toBe("prophet");
    expect(legacyParams.get("foo")).toBe("bar");
    expect(legacyParams.get("prophetLane")).toBe("sector");
  });

  it("writing defaults removes stale params but keeps the mount on both routes", () => {
    const canonical = writeProphetState(
      url("/prophet?tab=sector&sector=housing&sel=SBUX&prophetView=population"),
      DEFAULT_PROPHET_STATE,
    );
    expect(canonical).toBe("/prophet");

    const legacy = writeProphetState(
      url("/options?tab=prophet&prophetLane=sector&prophetGroup=housing&prophetSel=SBUX"),
      DEFAULT_PROPHET_STATE_LEGACY,
      "legacy",
    );
    expect(legacy).toBe("/options?tab=prophet");
  });
});

describe("return carrier — admissible origins round-trip exactly", () => {
  it.each([
    ["/sectors", "", "/sectors"],
    ["/sectors", "?group=housing&view=population", "/sectors?group=housing&view=population"],
    ["/sectors", "group=housing", "/sectors?group=housing"],
    ["/discover", "?tab=sectors", "/discover?tab=sectors"],
    ["/discover", "?tab=sectors&group=housing", "/discover?tab=sectors&group=housing"],
  ])("encodeProphetFrom(%s, %s) round-trips to %s", (pathname, search, href) => {
    const encoded = encodeProphetFrom(pathname, search);
    expect(encoded).not.toBeNull();
    const carrier = carrierFromEncoded(encoded!);
    expect(carrier).toEqual({ v: 1, kind: "sector", href });
    expect(prophetFromReturnHref(carrier!)).toBe(href);
  });

  it("the carrier survives a full state write → parse", () => {
    const encoded = encodeProphetFrom("/sectors", "?group=housing");
    const state: ProphetUrlState = { ...DEFAULT_PROPHET_STATE, from: carrierFromEncoded(encoded!) };
    expect(roundTrip(state)).toEqual(state);
  });

  it("the carrier survives a legacy state write → parse", () => {
    const encoded = encodeProphetFrom("/sectors", "?group=housing");
    const state: ProphetUrlState = { ...DEFAULT_PROPHET_STATE_LEGACY, from: carrierFromEncoded(encoded!) };
    expect(roundTrip(state, "legacy")).toEqual(state);
  });
});

describe("return carrier — everything outside the envelope is refused", () => {
  const cases: [string, string, string][] = [
    ["javascript: scheme", "javascript:alert(1)", ""],
    ["absolute https origin", "https://evil.test/x", ""],
    ["protocol-relative origin", "//evil.test", ""],
    ["backslash path", "/\\evil", ""],
    ["hash fragment", "/sectors#x", ""],
    ["outside the allowlist (/options)", "/options", ""],
    ["the root path", "/", ""],
    ["control character in the query", "/sectors", "?q=a\u0001b"],
    ["space in the query", "/sectors", "?q=a b"],
    ["href over the 1800-char budget", "/sectors", `?q=${"a".repeat(1800)}`],
    ["legacy mount without the sectors tab", "/discover", "?tab=options"],
    ["legacy mount with a repeated tab", "/discover", "?tab=sectors&tab=sectors"],
  ];
  it.each(cases)("encodeProphetFrom refuses %s", (_name, pathname, search) => {
    expect(encodeProphetFrom(pathname, search)).toBeNull();
  });

  it("an admissible href whose encoded carrier exceeds 2048 chars is dropped, not truncated", () => {
    // 1710-char href (inside the 1800 budget) whose JSON encoding triples the
    // percent signs — the carrier budget is the binding one.
    const encoded = encodeProphetFrom("/sectors", `?q=${"%".repeat(1700)}`);
    expect(encoded).toBeNull();
  });

  it("parseProphetFrom refuses an over-budget raw value before parsing it", () => {
    const raw = JSON.stringify({ v: 1, kind: "sector", href: "/sectors", pad: "%".repeat(700) });
    expect(encodeURIComponent(raw).length).toBeGreaterThan(2048);
    expect(parseProphetFrom(raw)).toBeNull();
  });

  it("parseProphetFrom refuses malformed, wrong-version and wrong-kind carriers", () => {
    expect(parseProphetFrom(null)).toBeNull();
    expect(parseProphetFrom(undefined)).toBeNull();
    expect(parseProphetFrom("not json")).toBeNull();
    expect(parseProphetFrom("[]")).toBeNull();
    expect(parseProphetFrom("null")).toBeNull();
    expect(parseProphetFrom(JSON.stringify({ v: 2, kind: "sector", href: "/sectors" }))).toBeNull();
    expect(parseProphetFrom(JSON.stringify({ v: 1, kind: "options", href: "/sectors" }))).toBeNull();
    expect(parseProphetFrom(JSON.stringify({ v: 1, kind: "sector", href: "/options" }))).toBeNull();
    expect(parseProphetFrom(JSON.stringify({ v: 1, kind: "sector" }))).toBeNull();
  });

  it("prophetFromHrefAdmissible is the single gate both directions share", () => {
    expect(prophetFromHrefAdmissible("/sectors")).toBe(true);
    expect(prophetFromHrefAdmissible("/discover?tab=sectors")).toBe(true);
    expect(prophetFromHrefAdmissible("/discover")).toBe(false);
    expect(prophetFromHrefAdmissible("https://evil.test/sectors")).toBe(false);
    expect(prophetFromHrefAdmissible("")).toBe(false);
  });
});

describe("prophetHref — both mounts parse back to the same state", () => {
  it("canonical mount yields /prophet?... and parses to the state", () => {
    const href = prophetHref(FULL_STATE_NO_FROM, "canonical");
    expect(href.startsWith("/prophet?")).toBe(true);
    expect(parseProphetState(url(href).searchParams)).toEqual(FULL_STATE_NO_FROM);
  });

  it("legacy mount yields /options?tab=prophet&... and parses to the same state", () => {
    const href = prophetHref(FULL_STATE_NO_FROM, "legacy");
    expect(href.startsWith("/options?tab=prophet&")).toBe(true);
    expect(href).toContain("prophetSel=SBUX");
    expect(parseProphetState(url(href).searchParams, "legacy")).toEqual(FULL_STATE_NO_FROM);
  });

  it("the default state yields a bare mount on both routes", () => {
    expect(prophetHref(DEFAULT_PROPHET_STATE, "canonical")).toBe("/prophet");
    expect(prophetHref(DEFAULT_PROPHET_STATE_LEGACY, "legacy")).toBe("/options?tab=prophet");
  });

  it("a canonical href spells the contract keys a lane can deep-link to", () => {
    const href = prophetHref({ ...DEFAULT_PROPHET_STATE, lane: "screener", group: "housing", sel: ["SBUX"] }, "canonical");
    const params = url(href).searchParams;
    expect(params.get("tab")).toBe("screener");
    expect(params.get("sector")).toBe("housing");
    expect(params.getAll("sel")).toEqual(["SBUX"]);
  });
});
