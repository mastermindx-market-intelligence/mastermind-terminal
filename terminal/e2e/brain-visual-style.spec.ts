import { expect, test } from "@playwright/test";

// Exercises real response CSP in Chromium at all three shared contract viewports.
// The stylesheet is fictional presentation-only data; no account/model call occurs.
test("native Brain styles load from the exact first-party origin, not an arbitrary host", async ({ page }) => {
  await page.route("https://www.mastermind-x.com/mm_brain_visuals.css*", (route) =>
    route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: ".native-visual-policy-probe { border-top-width: 7px; border-top-style: solid; }" }));
  let untrustedRequested = false;
  await page.route("https://untrusted.invalid/**", (route) => {
    untrustedRequested = true;
    return route.fulfill({ status: 200, contentType: "text/css", body: ".native-visual-policy-probe { border-top-width: 99px; }" });
  });
  const response = await page.goto("/terminal");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).toContain("style-src 'self' 'unsafe-inline' https://www.mastermind-x.com");
  await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "native-visual-policy-probe";
    document.body.appendChild(probe);
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "https://www.mastermind-x.com/mm_brain_visuals.css?v=policy-test";
    document.head.appendChild(style);
  });
  await expect(page.locator(".native-visual-policy-probe")).toHaveCSS("border-top-width", "7px");
  const blocked = await page.evaluate(async () => {
    return new Promise<string>((resolve) => {
      const listener = (event: SecurityPolicyViolationEvent) => {
        if (!event.blockedURI.startsWith("https://untrusted.invalid")) return;
        document.removeEventListener("securitypolicyviolation", listener);
        resolve(event.effectiveDirective);
      };
      document.addEventListener("securitypolicyviolation", listener);
      const style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = "https://untrusted.invalid/presentation.css";
      document.head.appendChild(style);
    });
  });
  expect(blocked).toBe("style-src-elem");
  expect(untrustedRequested).toBe(false);
  await expect(page.locator(".native-visual-policy-probe")).toHaveCSS("border-top-width", "7px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
