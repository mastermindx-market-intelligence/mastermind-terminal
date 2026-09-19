import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import {
  deploymentIdFromLinkHeader,
  embeddedDeploymentChanged,
  isAllowedMacroOrigin,
  pickAllowedMacroOrigin,
} from "../originNav";

describe("embedded Terminal security contract", () => {
  it("accepts only first-party dashboard origins", () => {
    expect(isAllowedMacroOrigin("https://mastermind-x.com")).toBe(true);
    expect(isAllowedMacroOrigin("https://www.mastermind-x.com")).toBe(true);
    expect(isAllowedMacroOrigin("https://app.mastermind-x.com")).toBe(false);
    expect(isAllowedMacroOrigin("https://mastermind-x.com.attacker.example")).toBe(false);
    expect(isAllowedMacroOrigin("javascript:alert(1)")).toBe(false);
  });

  it("keeps the browser-verified apex/www parent origin ahead of a stale return URL", () => {
    expect(
      pickAllowedMacroOrigin(
        "https://www.mastermind-x.com",
        "https://app.mastermind-x.com/analysis",
        "https://mastermind-x.com/us_stocks.html",
      ),
    ).toBe("https://www.mastermind-x.com");
    expect(
      pickAllowedMacroOrigin(
        "",
        "https://app.mastermind-x.com/analysis",
        "https://mastermind-x.com/us_stocks.html",
      ),
    ).toBe("https://mastermind-x.com");
  });

  it("detects a warm iframe whose Next deployment generation is stale", () => {
    const current = "old-generation";
    const link = '</_next/static/media/font.woff2?dpl=new-generation>; rel=preload; as="font"';
    expect(deploymentIdFromLinkHeader(link)).toBe("new-generation");
    expect(embeddedDeploymentChanged(current, link)).toBe(true);
    expect(embeddedDeploymentChanged("new-generation", link)).toBe(false);
    expect(embeddedDeploymentChanged("", link)).toBe(false);
    expect(embeddedDeploymentChanged(current, null)).toBe(false);
  });

  it("uses CSP framing rather than a conflicting legacy frame header", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const appRule = rules.find((rule) => rule.source === "/((?!embed).*)");
    expect(appRule).toBeDefined();

    const csp = appRule!.headers.find(
      (header) => header.key.toLowerCase() === "content-security-policy",
    )?.value;
    expect(csp).toContain(
      "frame-ancestors 'self' https://mastermind-x.com https://www.mastermind-x.com",
    );
    expect(
      appRule!.headers.some((header) => header.key.toLowerCase() === "x-frame-options"),
    ).toBe(false);
  });
});
