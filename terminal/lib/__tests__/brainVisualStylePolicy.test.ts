import { afterEach, describe, expect, it, vi } from "vitest";

async function policies(mode: "production" | "development") {
  vi.stubEnv("NODE_ENV", mode);
  vi.resetModules();
  const { default: config } = await import("../../next.config");
  const routes = await config.headers!();
  return routes.filter((route) => ["/((?!embed).*)", "/embed/:path*"].includes(route.source));
}

function directives(value: string): Record<string, string[]> {
  return Object.fromEntries(value.split(";").map((part) => {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name, sources];
  }));
}

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("Mastermind AI native styles stay inside the existing first-party policy", () => {
  it.each(["production", "development"] as const)("admits only the widget's existing origin in %s", async (mode) => {
    const routes = await policies(mode);
    expect(routes).toHaveLength(2);
    for (const route of routes) {
      const header = route.headers.find((item) => item.key === "Content-Security-Policy");
      expect(header).toBeDefined();
      const csp = directives(header!.value);
      expect(csp["style-src"]).toEqual(["'self'", "'unsafe-inline'", "https://www.mastermind-x.com"]);
      expect(csp["script-src"]).toContain("https://www.mastermind-x.com");
      expect(csp["object-src"]).toEqual(["'none'"]);
      expect(csp["base-uri"]).toEqual(["'self'"]);
      expect(csp["form-action"]).toEqual(["'self'"]);
      expect(csp["connect-src"]).not.toContain("https://www.mastermind-x.com");
      expect(csp["style-src"]).not.toContain("*");
      expect(csp["style-src"]).not.toContain("https:");
      if (mode === "production") expect(csp["script-src"]).not.toContain("'unsafe-eval'");
    }
  });
});
