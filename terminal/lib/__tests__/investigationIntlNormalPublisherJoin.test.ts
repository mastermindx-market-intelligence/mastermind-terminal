import { expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseAnalysisRoute } from "../analysisRoute";
import { intlBaselineUrl, parseIntlBaselineReply, safeIntlReturn } from "../investigationIntlEntry";
import { createIntlInvestigationHandlers } from "../investigationIntlApi";
import { decodeIntlGeneration, parseIntlPublicationPolicies } from "../investigationIntlGenerationCodec";

const directory = join(__dirname, "fixtures/intl_normal_publisher_actual_20261104");
const raw = readFileSync(join(directory, "current-native-action-handoff.json"));
const handoff = JSON.parse(raw.toString("utf8")) as {
  generation: string; fingerprint: string;
  actual_normal_page_links: Array<{ href: string; field: string; context: string; return: string }>;
  derived_current_navigation_controls: Array<{ scope: string; action: { href: string } }>;
};

it("binds the original new normal publisher handoff and keeps helper controls separate", () => {
  expect(createHash("sha256").update(raw).digest("hex")).toBe("77dea2c2ac9aedd6cc6edcaca6aa48ca139799d5a580155c6bc4549e5f670acf");
  expect(handoff.generation).toBe("im-workspace-generation:e15f54b7-2a8b-40d1-ae5b-93e2154842b5");
  expect(handoff.actual_normal_page_links).toHaveLength(50);
  expect([...new Set(handoff.actual_normal_page_links.map(row => row.field))].sort()).toEqual([
    "EZ.annual_current_account", "EZ.cpi_yoy", "EZ.gdp_yoy", "EZ.policy_rate", "GB.policy_rate",
  ]);
  expect(handoff.derived_current_navigation_controls).toHaveLength(2);
  expect(handoff.derived_current_navigation_controls.every(row => row.scope.includes("NOT_BROWSER_PAINT"))).toBe(true);
});

it("consumes all 50 actual normal-page hrefs through native strict intake and the actual immutable generation", async () => {
  const files = new Map(readdirSync(directory).filter(name => name.startsWith("intl_generation_")).map(name => [name, readFileSync(join(directory, name))]));
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.credentials).toBe("omit");
    const name = new URL(String(input)).pathname.split("/").at(-1)!;
    expect(name).not.toContain("intl_policy_points_");
    if (!files.has(name)) throw new Error("Unexpected immutable input " + name);
    return new Response(files.get(name), { headers: { "content-type": "application/json" } });
  });
  const handlers = createIntlInvestigationHandlers({ decodeIntlGeneration, parseIntlPublicationPolicies }, { base: "https://synthetic.source.test", fetcher });
  for (const row of handoff.actual_normal_page_links) {
    const route = parseAnalysisRoute(Object.fromEntries(new URL(row.href, "https://terminal.test").searchParams));
    expect(route.kind, row.href).toBe("investigations");
    if (route.kind !== "investigations" || !route.intlEntry) throw new Error("Invalid original publisher input");
    expect(route.intlEntry).toEqual({ context: row.context, generation: handoff.generation, fingerprint: handoff.fingerprint, fields: [row.field] });
    expect(route.intlReturnTo).toBe(row.return);
    const result = await handlers.baseline(new Request("https://terminal.test" + intlBaselineUrl(route.intlEntry)), "90000000-0000-4000-8000-000000000009");
    expect(result.status, row.href).toBe(200);
    const baseline = parseIntlBaselineReply(result.body, route.intlEntry);
    expect(baseline).not.toBeNull();
    expect(baseline!.subject).toEqual({ owner: "intl.workspace_context", kind: "economy", object_id: row.context });
    expect(baseline!.refs.map(ref => ref.selection?.field)).toEqual([row.field]);
    expect(safeIntlReturn(route.intlReturnTo, baseline!.context)).toBe(row.return);
  }
});

it("accepts only the canonical ytd spelling without weakening return URL or source-context fences", () => {
  const row = handoff.actual_normal_page_links.find(row => new URL(row.return).searchParams.get("horizon") === "ytd")!;
  expect(safeIntlReturn(row.return)).toBe(row.return);
  for (const spelling of ["YTD", "year_to_date", "ytd1", "0m"]) expect(safeIntlReturn(row.return.replace("horizon=ytd", "horizon=" + spelling))).toBeNull();
  expect(safeIntlReturn(row.return, { researchMarket: "GB", periodIdentity: "12m", currencyBasis: "usd_unhedged", returnBasis: "price" })).toBeNull();
  expect(safeIntlReturn(row.return + "#private")).toBeNull();
  expect(safeIntlReturn(row.return.replace("www.mastermind-x.com", "untrusted.test"))).toBeNull();
});
