import { describe, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
 * shared_shell_embed_headers.test.ts
 *
 * Defect A: production nests the chart widget as
 *   https://beta.mastermind-x.com  ->  www dossier page  ->  app /embed/chart
 * and the chart document's ENFORCING frame-ancestors admitted only 'self' +
 * apex + www, so the beta grandparent blocked it.
 *
 * These tests drive the ACTUAL next.config header rules - the shipped
 * `headers()` result, never a hand-copied policy string. They resolve which
 * rules match a request path, apply Next's last-matching-same-key source-header
 * behaviour, and then classify ancestors from the single enforced policy that
 * results. What is proved here:
 *   - exactly ONE enforced Content-Security-Policy reaches /embed/chart and it is
 *     the chart policy, i.e. a REPLACEMENT of the effective default;
 *   - an ADDITIVE second policy would veto beta anyway, because per MDN every
 *     enforced policy applies to a document, so the effective rule is the
 *     INTERSECTION of the policies - which is why the declaration order is
 *     asserted rather than trusted;
 *   - beta is admitted for the chart document in BOTH MMX_SHARED_SHELL modes and
 *     in production as well as non-production evaluation (this response must hold
 *     on app production even when the new shell flag is off);
 *   - the incumbent apex + www parents still pass, foreign ancestors still fail,
 *     no wildcard is introduced, X-Frame-Options stays omitted, every other
 *     directive and header of the embed subtree is retained, and no other route
 *     (native /terminal, the app default, unrelated /embed/*) gains beta, so
 *     native Terminal framing is not widened.
 *
 * Configuration behaviour under Vitest is not browser acceptance: the attended
 * parent owns the real Next/Caddy response test and the real nesting test, and
 * adoption, testing and deployment stay with the parent.
 */

const BETA = "https://beta.mastermind-x.com";
const APEX = "https://mastermind-x.com";
const WWW = "https://www.mastermind-x.com";
type Header = { key: string; value: string };
type HeaderRule = { source: string; headers: Header[] };
type NextConfigLike = { headers?: () => Promise<HeaderRule[]>; redirects?: () => Promise<unknown[]> };

/* The config computes isProd / flag-gated strings while it is evaluated, so each
 * mode gets a freshly imported module with that environment applied. */
async function loadConfig(nodeEnv: string, sharedShell: string | undefined): Promise<NextConfigLike> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("MMX_SHARED_SHELL", sharedShell);
  try {
    const mod = (await import("../../next.config")) as { default: NextConfigLike };
    return mod.default;
  } finally {
    vi.unstubAllEnvs();
  }
}

/* Next resolves source headers in declaration order and, for a header key that
 * several matching rules set, the LAST matching rule's value is what ships.
 * matchSource() is a faithful prototype for the exact rule shapes this config
 * uses - it mirrors the matching SHAPE, not any policy text:
 *   "/((?!embed).*)"  -> every path except the /embed subtree
 *   "/embed/:path*"   -> the /embed subtree, zero or more segments
 *   "/embed/chart"    -> that one document (Next matches the pathname; the
 *                        dossier's ?symbol= query is not part of matching)
 *   "/"               -> the root document
 *   "/(a|b|c)"        -> first-segment alternation group
 * The parent's real Next/Caddy response test remains authoritative. */
function matchSource(source: string, pathname: string): boolean {
  const exclusion = /^\/\(\(\?!([\w-]+)\)\.\*\)$/.exec(source);
  if (exclusion) {
    const rest = pathname.slice(1);
    // "/((?!embed).*)" is documented as every route except the /embed
    // subtree, so only a leading "embed" segment is excluded (root included).
    return !rest.startsWith(exclusion[1]);
  }
  const subtree = /^(.*?)\/:path\*$/.exec(source);
  if (subtree) {
    const prefix = subtree[1];
    return pathname === prefix || pathname.startsWith(prefix + "/");
  }
  const group = /^\/\(([\w|.,-]+)\)$/.exec(source);
  if (group) {
    const first = "/" + pathname.slice(1).split("/")[0];
    return group[1].split("|").some((alt) => first === "/" + alt);
  }
  return source === pathname;
}
function headersFor(rules: HeaderRule[], pathname: string): Header[] {
  const byKey = new Map<string, Header>();
  for (const rule of rules) {
    if (!matchSource(rule.source, pathname)) continue;
    for (const header of rule.headers) byKey.set(header.key.toLowerCase(), header);
  }
  return [...byKey.values()];
}
/* The additive view: every CSP any matching rule carries, ignoring replacement. */
function enforcedPolicies(rules: HeaderRule[], pathname: string): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    if (!matchSource(rule.source, pathname)) continue;
    for (const header of rule.headers) {
      if (header.key.toLowerCase() === "content-security-policy") out.push(header.value);
    }
  }
  return out;
}
function cspOf(rules: HeaderRule[], pathname: string): string {
  const shipped = headersFor(rules, pathname).filter((h) => h.key.toLowerCase() === "content-security-policy");
  expect(shipped, pathname + " must carry exactly one enforced CSP").toHaveLength(1);
  return shipped[0].value;
}
function ancestorsOf(policy: string): string[] {
  const directive = policy.split(";").map((part) => part.trim()).find((part) => /^frame-ancestors(\s|$)/.test(part));
  if (!directive) throw new Error("no frame-ancestors directive in: " + policy);
  return directive.split(/\s+/).slice(1);
}
function directivesOf(policy: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of policy.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const name = trimmed.split(/\s+/)[0].toLowerCase();
    out.set(name, trimmed.replace(/^\S+\s+/, ""));
  }
  return out;
}
/* A source expression admits an ancestor only when it names that exact origin
 * ('self' = the document's own origin). Only the pre-existing dev port wildcard
 * is expanded; a host wildcard is never honoured, and none is introduced. */
function admits(policy: string, ancestor: string | null): boolean {
  const tokens = ancestorsOf(policy);
  if (ancestor === null) return tokens.includes("'self'");
  let url: URL;
  try { url = new URL(ancestor); } catch { return false; }
  if (url.pathname !== "/" || url.search || url.hash) return false;
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return tokens.some((token) => token === url.origin
    || (/\*$/.test(token) && token.replace(/\*$/, "") === url.origin.replace(/:\d+$/, "") + ":*"));
}
function intersectionAllows(policies: string[], ancestor: string | null): boolean {
  return policies.every((policy) => admits(policy, ancestor));
}

const MODES: { name: string; nodeEnv: string; shell: string | undefined }[] = [
  { name: "NODE_ENV=production, MMX_SHARED_SHELL=1", nodeEnv: "production", shell: "1" },
  { name: "NODE_ENV=production, MMX_SHARED_SHELL unset", nodeEnv: "production", shell: undefined },
  { name: "NODE_ENV=production, MMX_SHARED_SHELL=0", nodeEnv: "production", shell: "0" },
  { name: "non-production evaluation, MMX_SHARED_SHELL=1", nodeEnv: "test", shell: "1" },
];
const FOREIGN = ["https://evil.example", "https://beta.mastermind-x.com.attacker.example",
  "https://mastermind-x.com:8443", "https://www.mastermind-x.com:3100", "http://beta.mastermind-x.com",
  "https://app.mastermind-x.com", "https://mastermind-x.co", "null"];

for (const mode of MODES) {
  describe(`embed/chart framing - ${mode.name}`, () => {
    let rules: HeaderRule[] = [];
    beforeEach(async () => {
      rules = await (await loadConfig(mode.nodeEnv, mode.shell)).headers!();
    });

    it("resolves exactly one enforced CSP for the chart document, by replacement", () => {
      const value = cspOf(rules, "/embed/chart");
      const subtree = rules.findIndex((rule) => rule.source === "/embed/:path*");
      const chart = rules.findIndex((rule) => rule.source === "/embed/chart");
      expect(subtree).toBeGreaterThanOrEqual(0);
      expect(chart).toBeGreaterThan(subtree);
      expect(value).toBe(enforcedPolicies(rules, "/embed/chart").at(-1));
      // the dossier embeds ?symbol=..., which Next matches on the pathname only
      expect(cspOf(rules, "/embed/chart")).toBe(value);
    });

    it("that single enforced chart policy admits the beta grandparent", () => {
      const value = cspOf(rules, "/embed/chart");
      expect(ancestorsOf(value)).toContain(BETA);
      expect(admits(value, BETA)).toBe(true);
    });

    it("replacement, never accumulation: an additive second policy would re-block beta", () => {
      const additive = enforcedPolicies(rules, "/embed/chart");
      expect(additive.length).toBeGreaterThan(1); // the default is still declared above
      // Exactly one policy may enforce, because the effective rule is the
      // intersection of every enforced policy (MDN).
      expect(intersectionAllows(additive, BETA)).toBe(false);
      expect(intersectionAllows([cspOf(rules, "/embed/chart")], BETA)).toBe(true);
    });

    it("the unrepaired default denies beta, so the chart-only rule is load-bearing", () => {
      expect(admits(cspOf(rules, "/embed/flow"), BETA)).toBe(false);
      expect(admits(cspOf(rules, "/terminal"), BETA)).toBe(false);
      expect(admits(cspOf(rules, "/"), BETA)).toBe(false);
    });

    it("keeps the incumbent apex + www parents and 'self' framing the chart", () => {
      const value = cspOf(rules, "/embed/chart");
      for (const ancestor of [APEX, WWW]) expect(admits(value, ancestor), ancestor).toBe(true);
      expect(admits(value, null)).toBe(true);
    });

    it("still excludes foreign ancestors and introduces no wildcard", () => {
      const value = cspOf(rules, "/embed/chart");
      for (const foreign of FOREIGN) expect(admits(value, foreign), foreign).toBe(false);
      const wildcards = ancestorsOf(value).filter((token) => token.includes("*"));
      expect(wildcards).toEqual(mode.nodeEnv === "production"
        ? [] : ["http://localhost:*", "http://127.0.0.1:*"]);
      // the only wildcards allowed are the pre-existing dev port wildcards asserted
      // above: no host wildcard, no mastermind wildcard, no bare-star ancestor.
      expect(ancestorsOf(value)).not.toContain("*");
      expect(value).not.toContain(BETA + "*");
      expect(value).not.toContain(BETA + ".");
      expect(ancestorsOf(value).filter((t) => t === BETA)).toHaveLength(1);
    });

    it("changes only frame-ancestors: every other directive and header is retained", () => {
      const chartHeaders = headersFor(rules, "/embed/chart");
      const subtreeHeaders = headersFor(rules, "/embed/other-widget");
      const chart = directivesOf(cspOf(rules, "/embed/chart"));
      const subtree = directivesOf(cspOf(rules, "/embed/other-widget"));
      expect([...chart.keys()].sort()).toEqual([...subtree.keys()].sort());
      for (const [name, value] of subtree) {
        if (name === "frame-ancestors") expect(chart.get(name)).toBe(value + " " + BETA);
        else expect(chart.get(name), name).toBe(value);
      }
      const keys = chartHeaders.map((header) => header.key.toLowerCase()).sort();
      expect(keys).toEqual(subtreeHeaders.map((header) => header.key.toLowerCase()).sort());
      for (const required of ["x-content-type-options", "referrer-policy", "permissions-policy",
        "cross-origin-opener-policy", "strict-transport-security", "x-robots-tag", "cache-control"]) {
        expect(keys, required).toContain(required);
      }
      expect(chartHeaders.find((h) => h.key.toLowerCase() === "cache-control")?.value)
        .toBe("public, s-maxage=300, stale-while-revalidate=600");
      expect(chartHeaders.find((h) => h.key.toLowerCase() === "x-robots-tag")?.value).toBe("noindex");
    });

    it("adds no X-Frame-Options anywhere (the legacy header would veto the exact allowlist)", () => {
      for (const pathname of ["/embed/chart", "/embed/other-widget", "/terminal", "/", "/data/board.json"]) {
        const keys = headersFor(rules, pathname).map((header) => header.key.toLowerCase());
        expect(keys, pathname).not.toContain("x-frame-options");
      }
    });

    it("scopes the repair to /embed/chart: no other route gains beta", () => {
      for (const pathname of ["/terminal", "/", "/macro.html", "/embed/other-widget", "/embed",
        "/discover", "/login", "/data/board.json"]) {
        for (const header of headersFor(rules, pathname)) {
          if (header.key.toLowerCase() !== "content-security-policy") continue;
          expect(admits(header.value, BETA), pathname).toBe(false);
          expect(header.value, pathname).not.toContain(BETA);
        }
      }
      expect(ancestorsOf(cspOf(rules, "/terminal"))).toEqual(["'self'", APEX, WWW,
        ...(mode.nodeEnv === "production" ? [] : ["http://localhost:*", "http://127.0.0.1:*"])]);
    });

    it("frame-src stays flag-gated and the rest of the policy is byte-stable", () => {
      const chart = cspOf(rules, "/embed/chart");
      const frameSrc = directivesOf(chart).get("frame-src")!;
      if (mode.shell === "1") expect(frameSrc).toContain(WWW);
      else expect(frameSrc).toBe("'self'");
      expect(directivesOf(chart).get("default-src")).toBe("'self'");
      expect(directivesOf(chart).get("object-src")).toBe("'none'");
      expect(directivesOf(chart).get("base-uri")).toBe("'self'");
      expect(directivesOf(chart).get("form-action")).toBe("'self'");
      if (mode.nodeEnv === "production") {
        expect(chart).toContain("upgrade-insecure-requests");
        expect(chart).not.toContain("'unsafe-eval'");
      } else expect(chart).toContain("'unsafe-eval'");
    });

    it("the embed subtree rule and the redirect contract are untouched", async () => {
      const config = await loadConfig(mode.nodeEnv, mode.shell);
      const nextRules = await config.headers!();
      const subtree = nextRules.find((rule) => rule.source === "/embed/:path*")!;
      expect(subtree.headers.map((header) => header.key)).toContain("Content-Security-Policy");
      expect(admits(cspOf(nextRules, "/embed/flow"), WWW)).toBe(true);
      const redirects = await config.redirects!();
      expect(redirects.map((entry) => (entry as { source: string }).source)).toContain("/heatmap");
    });
  });
}

describe("the delivered next.config.ts text carries the repair", () => {
  const source = readFileSync(fileURLToPath(new URL("../../next.config.ts", import.meta.url)), "utf8");

  it("builds the chart ancestors from the actual embed policy, appending only the exact beta origin", () => {
    expect(source).toContain('const embedChartAncestors = [...frameAncestorsOf(embedCSP), "https://beta.mastermind-x.com"];');
    expect(source).toMatch(/embedCSP\.replace\(\s*\/frame-ancestors\[\^;\]\*\/,\s*`frame-ancestors \$\{embedChartAncestors\.join\(" "\)\}`,/);
    expect(source).toContain('const embedChartHeaders = embedHeaders.map((header) =>');
  });
  it("keeps the native /terminal ancestors exactly as they were: no beta in the default policy", () => {
    const block = /const dashboardFrameAncestors =[\s\S]*?;/m.exec(source)?.[0] ?? "";
    expect(block).toContain(APEX);
    expect(block).toContain(WWW);
    expect(block).not.toContain("beta.");
    expect(source).toContain('{ key: "Content-Security-Policy", value: embedCSP },');
  });
  it("orders the chart rule after the subtree rule so it replaces the effective CSP", () => {
    expect(source).toMatch(/source: "\/embed\/:path\*"[\s\S]*?source: "\/embed\/chart"/);
    expect(source).toContain("headers: embedChartHeaders,");
  });
  it("fails loudly at config evaluation instead of shipping an unframable chart document", () => {
    expect(source).toMatch(/if \(embedChartCSP === embedCSP[\s\S]*?throw new Error\(/);
  });
  it("invents no X-Frame-Options, no wildcard beta form and no second CSP array", () => {
    expect(source).not.toMatch(/key: "X-Frame-Options"/);
    expect(source).not.toContain('"https://*.mastermind-x.com"');
    expect(source).not.toContain("beta.mastermind-x.com*");
    // exactly two literal CSP header entries remain (app default + embed subtree);
    // the chart rule DERIVES its list, so no second policy array is invented.
    expect((source.match(/key: "Content-Security-Policy"/g) ?? []).length).toBe(2);
    expect(source).toContain('header.key === "Content-Security-Policy" ? { key: header.key, value: embedChartCSP }');
  });
});
