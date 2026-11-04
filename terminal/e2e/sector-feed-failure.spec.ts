import { expect, test, type Page } from "@playwright/test";
import { sectorFixture } from "./fixtures/sector-company-v3";

// Failure presentation for the two owner-feed classes this PR names, on the
// Company Heatmap a customer actually reaches.
//
// The envelopes below are the canonical ones the route itself emits for a 502:
// `error` is a transport class — the owner origin answered 502 and the body
// never became an owner payload — while `invalid` is a payload verdict: a body
// arrived and the owner-envelope check rejected it. The heatmap must not read
// a transport failure as a population defect, and it must not read a rejected
// payload as an unreachable feed.
//
// This is FIXTURE presentation only. It proves which localized message each
// class renders, in each language and appearance, at the three contract
// viewports. It is not the authenticated 79-name tile acceptance, not deployed
// route behaviour and not evidence of any live incident recovery.
type FailureCase = {
  id: string;
  receiptStatus: "error" | "invalid";
  failure: "upstream_bad_gateway" | "payload_invalid";
  expected: { en: string; zh: string };
  absent: { en: string; zh: string };
};

const CASES: FailureCase[] = [
  {
    id: "upstream-bad-gateway",
    receiptStatus: "error",
    failure: "upstream_bad_gateway",
    expected: { en: "The company heatmap feed could not be reached.", zh: "无法连接公司热图数据源。" },
    absent: { en: "The exact heatmap population could not be read safely.", zh: "无法安全读取精确热图样本。" },
  },
  {
    id: "payload-invalid",
    receiptStatus: "invalid",
    failure: "payload_invalid",
    expected: { en: "The exact heatmap population could not be read safely.", zh: "无法安全读取精确热图样本。" },
    absent: { en: "The company heatmap feed could not be reached.", zh: "无法连接公司热图数据源。" },
  },
];

const LANGUAGES = ["en", "zh"] as const;
const THEMES = ["light", "dark"] as const;

test.setTimeout(90000);

async function noOverflow(page: Page) {
  const root = page.getByTestId("sector-intelligence");
  expect(await root.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

for (const failureCase of CASES) {
  for (const language of LANGUAGES) {
    for (const theme of THEMES) {
      test(`company heatmap presents the ${failureCase.id} failure in ${language} and ${theme}`, async ({ page }, info) => {
        await page.addInitScript(lang => {
          localStorage.setItem("mm.lang", lang);
          document.documentElement?.setAttribute("data-lang", lang);
        }, language);
        // Only the heatmap feed is overridden, with the canonical 502 envelope
        // for this class. Every other feed keeps the existing synthetic
        // fixture, so the rest of the page is unchanged.
        await page.route("**/api/sector-intelligence?**", route => {
          const source = new URL(route.request().url()).searchParams.get("source");
          if (source !== "heatmap") return sectorFixture(route);
          return route.fulfill({ status: 502, json: {
            data: null,
            receipt: { source: "heatmap", path: "/marketdata/sp500_heatmap.json", status: failureCase.receiptStatus,
              failure: failureCase.failure, asOf: null, observedAt: null, stale: false, contentHash: null },
          } });
        });
        await page.goto(`/discover?tab=sectors&sectorWorkspace=discover&sectorDiscoveryMode=summary&sector=xlk&sectorTheme=${theme}`);
        // Reach the heatmap through the existing Discover representation control.
        // The dev server compiles /discover on its first use in a cold tree, so
        // the first paint can precede hydration and swallow that click; the
        // control is idempotent, so the switch is retried until it takes.
        const representation = page.getByRole("group", { name: language === "en" ? "Discover representation" : "发现视图", exact: true });
        const heatmap = page.getByTestId("sector-company-heatmap");
        await expect(async () => {
          await representation.getByRole("button", { name: language === "en" ? "Heatmap" : "热图", exact: true }).click();
          await expect(heatmap).toBeVisible({ timeout: 2000 });
        }).toPass({ timeout: 30000 });
        await expect(page.getByTestId("sector-intelligence")).toHaveAttribute("data-sector-theme", theme);
        // The class renders its own message, and only its own message.
        await expect(heatmap.getByRole("status")).toContainText(failureCase.expected[language]);
        expect(await page.getByText(failureCase.absent[language]).count()).toBe(0);
        await noOverflow(page);
        const crop = info.outputPath(`sector-feed-failure-${failureCase.id}-${language}-${theme}-${info.project.name}.png`);
        await heatmap.screenshot({ path: crop });
        await info.attach(`sector-feed-failure-${failureCase.id}-${language}-${theme}`, { path: crop, contentType: "image/png" });
      });
    }
  }
}
