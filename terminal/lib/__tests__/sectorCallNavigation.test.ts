/**
 * sectorCallNavigation.test.ts — item 3 of the COO 19:15Z landing round: the
 * lane-3 consumer side of the calls board's navigation callback, written and
 * unit-tested against lane 7's final contract BEFORE the board-side emission
 * gate (#1445) lands on master.
 *
 * Contract under test (COO 19:15Z, verbatim intent):
 *   - `CallsNavigateTarget { href: string | null; kind: CallRow["kind"];
 *     id: string; ticker: string }` and `isNavigableId` from
 *     lib/sectorDepthCalls.ts (the identifier rule arrives with #1445 and is
 *     INJECTED here — this side keeps no second copy of the rule).
 *   - Route by kind+id (ticker where symbol-keyed).
 *   - Never use href as a route unless non-null string — this side is
 *     stronger: href is never read at all; the decision cannot even carry it.
 *   - Never build a route from any text other than id or ticker.
 *   - The board emits no target for a row whose id/ticker fails the
 *     identifier rule; "no route" (`none`) is a NORMAL outcome, never an
 *     error — the analogue of "no callback fired" for the pure decision.
 *
 * The eventual mount (only after #1445 is merged into this branch) is:
 *   onNavigate={target => {
 *     const d = callsNavigateDecision(target, isNavigableId);
 *     if (d.state === "select") selectSubject(d.id); // workspace change({sector: id})
 *   }}
 */
import { describe, expect, it, vi } from "vitest";
import { callsNavigateDecision } from "../sectorCallNavigation";

/** Representative identifier rule (the real one is lane 7's `isNavigableId`,
 * injected at mount): non-empty, ≤64 chars, letters/digits/_/./-/ — no
 * spaces, no slashes, no colons, no query/fragment syntax. */
const navigable = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);

const target = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  href: "/sectors/semiconductors", kind: "sector", id: "semiconductors", ticker: "SMH", ...over,
});

describe("callsNavigateDecision — the calls board's lane-3 navigation law (COO 19:15Z item 3)", () => {
  it("routes a lawful target by kind+id, with the ticker riding along for symbol-keyed consumers", () => {
    const sector = callsNavigateDecision(target() as unknown as Parameters<typeof callsNavigateDecision>[0], navigable);
    expect(sector).toEqual({ state: "select", kind: "sector", id: "semiconductors", ticker: "SMH" });
    const theme = callsNavigateDecision(
      target({ kind: "theme", id: "ai-infrastructure", ticker: "AI-INFRA" }) as unknown as Parameters<typeof callsNavigateDecision>[0],
      navigable);
    expect(theme).toEqual({ state: "select", kind: "theme", id: "ai-infrastructure", ticker: "AI-INFRA" });
  });

  it("the identifier rule is the single gate — a refused id or ticker produces no route, normally", () => {
    const refused = callsNavigateDecision(
      target({ id: "has space" }) as unknown as Parameters<typeof callsNavigateDecision>[0], navigable);
    expect(refused).toEqual({ state: "none" });
    const refusedTicker = callsNavigateDecision(
      target({ ticker: "javascript:alert(1)" }) as unknown as Parameters<typeof callsNavigateDecision>[0], navigable);
    expect(refusedTicker).toEqual({ state: "none" });
    // A missing or non-function rule is the mount's bug, not the reader's
    // problem: fail closed exactly like board silence.
    expect(callsNavigateDecision(target() as unknown as Parameters<typeof callsNavigateDecision>[0], undefined))
      .toEqual({ state: "none" });
    expect(callsNavigateDecision(target() as unknown as Parameters<typeof callsNavigateDecision>[0], null))
      .toEqual({ state: "none" });
  });

  it("href is never a route: hostile, absent and non-string hrefs cannot change the decision", () => {
    const baseline = callsNavigateDecision(target() as unknown as Parameters<typeof callsNavigateDecision>[0], navigable);
    const hostile: unknown[] = [
      "javascript:alert(1)", "data:text/html,<script>x</script>", "https://evil.example/sectors",
      "//evil.example", "/sectors/semis?next=javascript:alert(1)", "/sectors/semis#frag",
      "", null, undefined, 42, true, {}, ["javascript:alert(1)"], "x".repeat(10_000),
    ];
    for (const href of hostile) {
      const decision = callsNavigateDecision(
        target({ href }) as unknown as Parameters<typeof callsNavigateDecision>[0], navigable);
      expect(decision).toEqual(baseline);
    }
    // The decision cannot even carry an href — no downstream consumer can
    // route by owner text, because the field is not representable.
    expect(JSON.stringify(baseline)).not.toContain("href");
    expect(Object.hasOwn(baseline as object, "href")).toBe(false);
  });

  it("no route is ever built from any text other than id or ticker", () => {
    const decision = callsNavigateDecision(
      target({ name: "Semiconductors", label: "Own it", reco_why_en: "wide moat",
        query: "?symbol=SMH&next=/admin", "constructor": "not-a-route" }) as unknown as Parameters<typeof callsNavigateDecision>[0],
      navigable);
    expect(decision).toEqual({ state: "select", kind: "sector", id: "semiconductors", ticker: "SMH" });
    const serialized = JSON.stringify(decision);
    for (const forbidden of ["Semiconductors", "Own it", "wide moat", "next", "admin", "not-a-route"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("wrong types fail closed and never throw", () => {
    const bad: unknown[] = [null, undefined, "sector", 42, true, [], () => {}, Symbol("x")];
    for (const value of bad) {
      expect(() => callsNavigateDecision(value as unknown as Parameters<typeof callsNavigateDecision>[0], navigable))
        .not.toThrow();
      expect(callsNavigateDecision(value as unknown as Parameters<typeof callsNavigateDecision>[0], navigable))
        .toEqual({ state: "none" });
    }
    for (const kind of [42, null, undefined, {}, [], "company", "Sector", ""]) {
      expect(callsNavigateDecision(target({ kind }) as unknown as Parameters<typeof callsNavigateDecision>[0], navigable))
        .toEqual({ state: "none" });
    }
    for (const key of ["id", "ticker"] as const) {
      for (const value of [42, null, undefined, {}, [], true]) {
        expect(callsNavigateDecision(target({ [key]: value }) as unknown as Parameters<typeof callsNavigateDecision>[0], navigable))
          .toEqual({ state: "none" });
      }
    }
  });

  it("prototype-named and prototype-chain values never drive the decision", () => {
    // Extra OWN keys named like prototype members are inert text on a valid target.
    const withOwnPrototypeKeys = JSON.parse(
      JSON.stringify(target()).replace(/^\{/, '{"__proto__":"x","toString":"y","constructor":"z",')) as Record<string, unknown>;
    expect(callsNavigateDecision(withOwnPrototypeKeys as unknown as Parameters<typeof callsNavigateDecision>[0], navigable))
      .toEqual({ state: "select", kind: "sector", id: "semiconductors", ticker: "SMH" });

    // Values that live ONLY on the prototype chain are not the board's emission.
    const chained = Object.create({ kind: "sector", id: "stolen-id", ticker: "STLN" }) as Record<string, unknown>;
    chained.href = "/sectors/anything";
    expect(callsNavigateDecision(chained as unknown as Parameters<typeof callsNavigateDecision>[0], navigable))
      .toEqual({ state: "none" });

    // JSON's __proto__ is an own key, not a prototype setter: the own fields rule.
    const jsonOwn = JSON.parse('{"kind":"sector","id":"own-id","ticker":"OKT","__proto__":{"id":"chain-id"}}');
    expect(callsNavigateDecision(jsonOwn as unknown as Parameters<typeof callsNavigateDecision>[0], navigable))
      .toEqual({ state: "select", kind: "sector", id: "own-id", ticker: "OKT" });
  });

  it("the rule receives only the two validated strings — never the target, never the href", () => {
    const rule = vi.fn(() => true);
    callsNavigateDecision(target() as unknown as Parameters<typeof callsNavigateDecision>[0], rule);
    expect(rule.mock.calls).toEqual([["semiconductors"], ["SMH"]]);
  });
});
