import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type Response = { writeHead: (status: number, headers: Record<string, string>) => void; end: (html: string) => void };
type Handler = (request: { url: string }, response: Response) => void;

// Execute the ACTUAL checked-in fixture request handler, not a duplicated sanitizer.
// The evaluated string comes only from this fixed repository-owned script.
function renderFixtureResponse(query: Record<string, string>): string {
  const source = readFileSync(resolve(process.cwd(), "docs/pr-crops/ex25-brief/capture.cjs"), "utf8");
  const start = source.indexOf("server = http.createServer((req, res) => {");
  const end = source.indexOf("\n    });", start);
  if (start < 0 || end < 0) throw new Error("The actual capture request handler was not found");
  let handler: Handler | undefined;
  const context = {
    URL,
    styles: "/* trusted repository CSS fixture */",
    server: undefined,
    http: { createServer: (callback: Handler) => { handler = callback; return callback; } },
  };
  runInNewContext(source.slice(start, end + "\n    });".length), context);
  if (!handler) throw new Error("No actual request handler was captured");
  let html = "";
  handler({ url: `/?${new URLSearchParams(query).toString()}` }, {
    writeHead: (status) => expect(status).toBe(200),
    end: (response) => { html = response; },
  });
  return html;
}

describe("EX25 capture request HTML safety", () => {
  it.each([
    { lang: "en", theme: "dark", shell: "classic" },
    { lang: "zh", theme: "light", shell: "shared" },
  ])("preserves legitimate profile $lang/$theme/$shell", (profile) => {
    const html = renderFixtureResponse(profile);
    expect(html).toContain(`data-lang="${profile.lang}"`);
    expect(html).toContain(`data-theme="${profile.theme}"`);
    expect(html.includes('data-mmx-shared-shell="1"')).toBe(profile.shell === "shared");
    expect(html).toContain('src="/bundle.js"');
  });

  it.each(["lang", "theme", "shell"])("never reflects executable input from %s into HTML", (parameter) => {
    const payload = '\"><script data-attack="true">window.__xss=true</script><img src=x onerror="window.__xss=true">';
    const html = renderFixtureResponse({ lang: "en", theme: "dark", shell: "classic", [parameter]: payload });
    expect(html).not.toContain("data-attack");
    expect(html).not.toContain("window.__xss");
    expect(html).not.toContain("onerror=");
    expect(html).toContain('data-lang="en"');
    expect(html).toContain('data-theme="dark"');
    expect(html).not.toContain('data-mmx-shared-shell="1"');
  });

  it("uses literal safe defaults for absent or unsupported profile parameters", () => {
    const queries: Array<Record<string, string>> = [{}, { lang: "unknown", theme: "other", shell: "invalid" }];
    for (const query of queries) {
      const html = renderFixtureResponse(query);
      expect(html).toContain('data-lang="en"');
      expect(html).toContain('data-theme="dark"');
      expect(html).not.toContain('data-mmx-shared-shell="1"');
    }
  });
});
