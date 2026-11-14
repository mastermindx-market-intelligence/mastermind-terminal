import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";

// The actual React workspace, CSS modules, shared chart and modal owners run in
// an isolated synthetic document. Identity/network are fixture boundaries only;
// production admission and served-data proof remain separate release gates.
const root = process.cwd(), mock = path.join(root, "e2e/fixtures/nativeMacroMocks.tsx");
const built = buildSync({
 entryPoints: [path.join(root, "e2e/fixtures/nativeMacro.tsx")], bundle: true,
 outdir: "/tmp/native-macro-component", write: false, jsx: "automatic", format: "iife",
 alias: { "next/link": mock, "next/navigation": mock, "@/lib/i18n": mock, "@/lib/supabase/client": mock, "@": root },
 define: { "process.env.NODE_ENV": '"development"' },
});
const js = built.outputFiles.find(file => file.path.endsWith(".js"))!.text;
const css = ["app/globals.css", "components/chrome/shared-shell/shared-shell.css"].map(file => readFileSync(path.join(root, file), "utf8")).join("\n")
 .replace('@import "tailwindcss";', "").replace('@source not "../public/data";', "") + built.outputFiles.find(file => file.path.endsWith(".css"))!.text;

for (const lang of ["en", "zh"] as const) for (const theme of ["dark", "light"] as const) {
 test(`native Macro specimen · ${lang} · ${theme}`, async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/native-macro-component**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic native Macro component verification</title></head><body><div id="root"></div></body></html>' }));
  await page.goto(`/native-macro-component?lang=${lang}&theme=${theme}`);
  await page.addStyleTag({ content: css + "\nhtml,body,#root{height:100%;margin:0}#root>main{height:100%;overflow:auto}" });
  await page.addScriptTag({ content: js });
  const touchTarget = async (target: import("@playwright/test").Locator) => {
   if ((page.viewportSize()?.width ?? 0) > 900) return;
   const box = await target.boundingBox();
   expect(box).not.toBeNull();
   expect(box!.width).toBeGreaterThanOrEqual(44);
   expect(box!.height).toBeGreaterThanOrEqual(44);
  };
  const workspace = page.locator("[data-native-macro]");
  await expect(workspace).toHaveAttribute("data-read-state", "ready");
  await expect(page.getByRole("heading", { name: lang === "zh" ? "宏观仪表盘" : "Macro Dashboard", exact: true })).toBeVisible();
  await expect(workspace.getByText(lang === "zh" ? "当前评估不可用" : "Current assessment unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: lang === "zh" ? "环境分化" : "Mixed conditions", exact: true })).toBeVisible();
  expect(await workspace.locator("iframe").count()).toBe(0);
  const geometry = await workspace.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth, document: document.documentElement.scrollWidth, viewport: innerWidth, background: getComputedStyle(el).backgroundColor }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.background).toBe(theme === "light" ? "rgb(247, 248, 250)" : "rgb(15, 17, 21)");
  await page.screenshot({ path: info.outputPath(`overview-${lang}-${theme}.png`) });
  const opener = page.getByRole("button", { name: lang === "zh" ? "查看全部因子" : "Inspect all factors", exact: true }).first();
  await touchTarget(opener);
  await opener.click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(dialog.getByText(lang === "zh" ? "已发布输入" : "Published input", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("42", { exact: true }).first()).toBeVisible();
  await touchTarget(page.getByRole("button", { name: lang === "zh" ? "关闭详情" : "Close detail" }));
  await page.screenshot({ path: info.outputPath(`factors-${lang}-${theme}.png`) });
  await page.getByRole("button", { name: lang === "zh" ? "关闭详情" : "Close detail" }).press("Escape");
  await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await page.getByRole("button", { name: lang === "zh" ? "查看数据" : "Table view", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("table").getByText("—", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: lang === "zh" ? "探索风险全貌" : "Explore the risk picture", exact: true }).click();
  await expect(dialog).toBeVisible();
  await touchTarget(page.getByRole("button", { name: lang === "zh" ? "5日" : "5d", exact: true }));
  await page.getByRole("button", { name: lang === "zh" ? "5日" : "5d", exact: true }).click();
  await expect(page.getByRole("button", { name: lang === "zh" ? "5日" : "5d", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath(`risk-${lang}-${theme}.png`) });
  await page.getByRole("button", { name: lang === "zh" ? "关闭详情" : "Close detail" }).press("Escape");
  const prophet = page.getByRole("link", { name: lang === "zh" ? "探索 Prophet" : "Explore Prophet", exact: true });
  await prophet.scrollIntoViewIfNeeded();
  await expect(prophet).toHaveAttribute("href", "/us_stocks.html");
  await page.screenshot({ path: info.outputPath(`research-${lang}-${theme}.png`) });
  await page.getByRole("button", { name: lang === "zh" ? "来源与数据健康" : "Sources & health", exact: true }).click();
  await page.getByRole("searchbox").fill("Federal Reserve");
  await expect(dialog.getByText("Federal Reserve 1", { exact: true })).toBeVisible();
  await expect(dialog.getByText(lang === "zh" ? "较早的数据" : "Older input", { exact: true }).first()).toBeVisible();
  await page.getByRole("searchbox").fill("no matching synthetic source");
  await expect(dialog.getByText(lang === "zh" ? "没有符合搜索条件的来源。" : "No sources match your search.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: lang === "zh" ? "关闭详情" : "Close detail" }).press("Escape");
  const releaseOpener = page.getByRole("button", { name: lang === "zh" ? "打开发布工作台: 零售销售" : "Open release workspace: Retail sales", exact: true });
  await touchTarget(releaseOpener);
  await releaseOpener.click();
  await expect(dialog.getByText(lang === "zh" ? "模型与基准混合值" : "Model + benchmark blend", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("tablist")).toBeVisible();
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  if ((page.viewportSize()?.width ?? 0) >= 1200) {
   await expect(dialog.getByRole("tabpanel").getByRole("figure").first()).toBeInViewport({ ratio: 1 });
  }
  await page.screenshot({ path: info.outputPath(`release-${lang}-${theme}.png`) });
  await dialog.getByRole("tab", { name: lang === "zh" ? "模型" : "Models", exact: true }).click();
  await expect(dialog.getByText(lang === "zh" ? "来源评估后已撤回该主张，预测数值不予展示。" : "Claim withdrawn after source evaluation. Its forecast numbers are withheld.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("777", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "2026-11-19", exact: true }).click();
  await expect(dialog.getByText(lang === "zh" ? "仅展示基准 · 无模型预测" : "Benchmarks only · no house forecast", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "2026-11-16", exact: true }).click();
  const coreTarget = dialog.getByRole("button", { name: lang === "zh" ? /^核心消费者价格/ : /^Core CPI/ });
  await coreTarget.click();
  const modelsTab = dialog.getByRole("tab", { name: lang === "zh" ? "模型" : "Models", exact: true });
  await modelsTab.click();
  await expect(modelsTab).toHaveAttribute("aria-selected", "true");
  const investigationUrl = page.url();
  const ratesAction = dialog.getByRole("button", { name: lang === "zh" ? "查看利率背景" : "Inspect rates context", exact: true });
  await touchTarget(ratesAction);
  await ratesAction.click();
  await expect(page).toHaveURL(/#rates$/);
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole("heading", { name: lang === "zh" ? "利率与政策路径" : "Rates & policy path", exact: true })).toBeVisible();
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(investigationUrl);
  await expect(dialog).toHaveCount(1);
  await expect(coreTarget).toHaveAttribute("aria-pressed", "true");
  await expect(modelsTab).toHaveAttribute("aria-selected", "true");
  await expect(ratesAction).toBeFocused();
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`release-return-${lang}-${theme}.png`) });
  await ratesAction.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(releaseOpener).toBeFocused();
  await info.attach("synthetic-component-geometry", { body: JSON.stringify({ synthetic: true, lang, theme, geometry, errors }), contentType: "application/json" });
  expect(errors).toEqual([]);
 });
}
