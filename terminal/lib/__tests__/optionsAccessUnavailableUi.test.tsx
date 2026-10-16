import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const language = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/i18n")>();
  return {
    ...real,
    useT: () => (key: string) => real.LEX[key]?.[language.lang === "zh" ? 1 : 0] ?? key,
  };
});
vi.mock("@/components/BrandMark", () => ({ BrandMark: () => createElement("span", { "aria-hidden": true }, "M") }));
import OptionsServiceUnavailable from "@/components/OptionsServiceUnavailable";
import { LEX } from "@/lib/i18n";

describe("Options entitlement unavailable fallback", () => {
  it("defines real EN/ZH tuples in the central lexicon", () => {
    for (const key of ["optionsAccessUnavailableTitle", "optionsAccessUnavailableBody", "optionsAccessUnavailableRetry", "optionsAccessUnavailableBack"]) {
      expect(LEX[key]).toHaveLength(2);
      expect(LEX[key][0]).toBeTruthy();
      expect(LEX[key][1]).toBeTruthy();
    }
  });
  it.each([
    ["en", "Options is temporarily unavailable", "We couldn't verify Options access right now", "Try again"],
    ["zh", "期权服务暂时不可用", "暂时无法验证访问权限", "重试"],
  ] as const)("gives %s users a recoverable outage, not a subscription upsell", (lang, title, body, retry) => {
    language.lang = lang;
    const html = renderToStaticMarkup(createElement(OptionsServiceUnavailable));
    expect(html).toContain('data-options-access="temporarily-unavailable"');
    expect(html).toContain('role="status"');
    expect(html).toContain(title);
    expect(html).toContain(body.replaceAll("'", "&#x27;"));
    expect(html).toContain(retry);
    expect(html).toContain('href="/terminal"');
    expect(html).not.toMatch(/upgrade|subscribe|\$\d/i);
  });
});
