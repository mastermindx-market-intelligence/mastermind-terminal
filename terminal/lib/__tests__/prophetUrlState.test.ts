/**
 * prophetUrlState.test.ts — contract tests for the Prophet URL codec.
 *
 * The codec owns the `prophet*` query family and the `prophetFrom` return
 * carrier. Laws pinned here:
 *   - Round-trip is exact: write → parse restores the same state, defaults
 *     included, and defaults stay OUT of the address.
 *   - Invalid values degrade to defaults, never to an error page.
 *   - Non-prophet params (the legacy `tab=prophet` mount) survive a write.
 *   - The return carrier is same-origin, path-allowlisted and bounded: it can
 *     never become an open redirect, and an over-budget carrier is dropped
 *     rather than truncated.
 *   - Both mounts (`/prophet`, `/options?tab=prophet`) parse back to the same
 *     state.
 *
 * ONE SOURCE DEFECT is pinned red here (see the final report):
 *   D3 — `writeProphetState` (lib/prophetUrlState.ts:154-157) passes an
 *        already-`encodeURIComponent`-ed carrier to `URLSearchParams.set`,
 *        which percent-encodes it a second time. `parseProphetState` then
 *        hands the single-encoded string to `parseProphetFrom`, whose
 *        `JSON.parse` fails — so any state carrying a return carrier loses it
 *        on write → parse, and `prophetHref` inherits the loss. The
 *        contract-correct expectation is the round-trip below; it is RED.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROPHET_STATE, PROPHET_FROM_MAX_ENCODED, PROPHET_FROM_MAX_HREF,
  encodeProphetFrom, parseProphetFrom, parseProphetState, prophetFromHrefAdmissible,
  prophetFromReturnHref, prophetHref, writeProphetState,
  type ProphetUrlState,
} from "@/lib/prophetUrlState";

const url = (href: string) => new URL(href, "https://terminal.test");
const roundTrip = (state: ProphetUrlState): ProphetUrlState =>
  parseProphetState(url(writeProphetState(url("/prophet"), state)).searchParams);

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
};
const FULL_STATE_NO_FROM: ProphetUrlState = { ...FULL_STATE, from: null };

describe("state round-trip", () => {
  it("DEFAULT_PROPHET_STATE survives write → parse unchanged", () => {
    expect(roundTrip(DEFAULT_PROPHET_STATE)).toEqual(DEFAULT_PROPHET_STATE);
  });

  it("defaults stay out of the address", () => {
    const written = writeProphetState(url("/prophet"), DEFAULT_PROPHET_STATE);
    expect(written).toBe("/prophet");
  });

  // D3: RED. The carrier is double-encoded on write, so parse loses it.
  it("every non-default field survives write → parse unchanged", () => {
    expect(roundTrip(FULL_STATE)).toEqual(FULL_STATE);
  });

  it("every non-default field except the carrier survives write → parse unchanged", () => {
    expect(roundTrip(FULL_STATE_NO_FROM)).toEqual(FULL_STATE_NO_FROM);
  });

  it("a written state is readable from the URL's own search params", () => {
    const written = writeProphetState(url("/prophet"), FULL_STATE_NO_FROM);
    const params = url(written).searchParams;
    expect(params.get("prophetLane")).toBe("sector");
    expect(params.get("prophetView")).toBe("setup");
    expect(params.get("prophetGroup")).toBe("housing");
    expect(params.get("prophetSymbol")).toBe("SBUX");
    expect(params.get("prophetPlan")).toBe("SBUX-BULL-20260702");
    expect(params.get("prophetQ")).toBe("bank");
    expect(params.get("prophetState")).toBe("open_plan");
    expect(params.get("prophetOffset")).toBe("40");
  });
});

describe("invalid values degrade to defaults", () => {
  it("unknown lane/view words, bad ids, over-long q, unknown state and negative offset all default", () => {
    const parsed = parseProphetState(new URLSearchParams({
      prophetLane: "bogus",
      prophetView: "bogus",
      prophetGroup: "US SECTOR!",
      prophetSymbol: "brk.b",
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
    expect(parseProphetState(new URLSearchParams("prophetGroup=Housing")).group).toBeNull();
    expect(parseProphetState(new URLSearchParams("prophetGroup=housing")).group).toBe("housing");
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
    const parsed = parseProphetState(new URLSearchParams("prophetBogus=1&prophetLane=sector"));
    expect(parsed).toEqual({ ...DEFAULT_PROPHET_STATE, lane: "sector" });
  });

  it("non-prophet params survive a write untouched", () => {
    const written = writeProphetState(url("/options?tab=prophet&foo=bar"), {
      ...DEFAULT_PROPHET_STATE, lane: "sector",
    });
    const params = url(written).searchParams;
    expect(params.get("tab")).toBe("prophet");
    expect(params.get("foo")).toBe("bar");
    expect(params.get("prophetLane")).toBe("sector");
  });

  it("writing defaults removes stale prophet* params but keeps the mount", () => {
    const written = writeProphetState(
      url("/options?tab=prophet&prophetLane=sector&prophetGroup=housing"),
      DEFAULT_PROPHET_STATE,
    );
    const params = url(written).searchParams;
    expect(params.get("tab")).toBe("prophet");
    expect(params.has("prophetLane")).toBe(false);
    expect(params.has("prophetGroup")).toBe(false);
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

  // D3: RED. writeProphetState double-encodes the carrier.
  it("the carrier survives a full state write → parse", () => {
    const encoded = encodeProphetFrom("/sectors", "?group=housing");
    const state: ProphetUrlState = { ...DEFAULT_PROPHET_STATE, from: carrierFromEncoded(encoded!) };
    expect(roundTrip(state)).toEqual(state);
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
    ["href over the 1800-char budget", "/sectors", `?q=${"a".repeat(PROPHET_FROM_MAX_HREF)}`],
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
    expect(encodeURIComponent(raw).length).toBeGreaterThan(PROPHET_FROM_MAX_ENCODED);
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
    expect(parseProphetState(url(href).searchParams)).toEqual(FULL_STATE_NO_FROM);
  });

  it("the default state yields a bare mount on both routes", () => {
    expect(prophetHref(DEFAULT_PROPHET_STATE, "canonical")).toBe("/prophet");
    expect(prophetHref(DEFAULT_PROPHET_STATE, "legacy")).toBe("/options?tab=prophet");
  });
});
