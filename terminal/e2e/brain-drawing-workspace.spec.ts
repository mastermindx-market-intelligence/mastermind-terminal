import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { SUITE_META, suiteDefaults } from "../lib/suites/meta";
import type { Ack, ChartCommandTarget, ChartCommandV2 } from "../lib/chartBus";

// Explicit model-transport and OHLC fixtures. The command callback, queue, shared
// indicator owners, state POST, native renderers and layer controls are real.
// These tests establish client behavior; they do not attest real-model analysis.
const bars: Array<[string, number, number, number, number, number]> = [];
for (let day = 0; bars.length < 420; day++) {
  const date = new Date(Date.UTC(2025, 0, day + 1));
  if ([0, 6].includes(date.getUTCDay())) continue;
  const i = bars.length, c = 100 + i * .018 + Math.sin(i / 6) * 7 + Math.sin(i / 31) * 3;
  const o = c - Math.sin(i / 3);
  bars.push([date.toISOString().slice(0, 10), o, Math.max(o, c) + 1.2, Math.min(o, c) - 1.2, c, 100000 + i * 31]);
}
const point = (i: number, p: number) => ({ t: Date.parse(bars[i][0]) / 1000, p });
const human = { id: "human_reference", source: "user", kind: "hline", color: "#94a3b8", width: 1,
  points: [{ t: bars[360][0], p: 105 }] };
const structureParams = suiteDefaults("structure");
for (const module of SUITE_META.structure.modules) structureParams[`${module.key}.on`] = false;
Object.assign(structureParams, { "sr.on": true, "sr.sensitivity": "low", "sr.minTouches": 2, "sr.bufferZone": false, "sr.labels": true });

type Step = Pick<ChartCommandV2, "op" | "args" | "id" | "caption">;
type MirroredDrawing = { id: string; command_id?: string; by: string; kind?: string; hidden?: boolean;
  args?: { kind?: string; fibonacci?: { levels: number[]; reverse: boolean; labels: "ratio" | "price" | "both" } } };
type Mirror = { origin_id: string; context_revision: number; acks?: Ack[]; session?: {
  symbol: string; tf: string; pane_id: number; drawings?: MirroredDrawing[];
  indicator_visibility?: { keys: string[]; hidden: string[]; effective_hidden: string[] };
  indicators?: Array<{ name: string; params?: Record<string, unknown> }>;
  capabilities?: { drawing_tools?: { tools: Array<{ kind: string }> } };
} };
type Host = Window & { __drawingWorkspaceReady?: boolean; MM_BRAIN_CFG?: {
  getAiContext?: () => { origin_id: string; context_revision: number } | undefined;
  onCommand?: (command: unknown) => void;
} };

type RsiWitness = { barCount: number; lastBar: { c: number } | null;
  series: Record<string, Array<{ value: number | null } | null>>;
  indRow: Record<string, number | null> | null };
const rsiWitness = (page: Page) => page.evaluate(() =>
  (window as unknown as { __mmLiveBarGeneration?: () => RsiWitness }).__mmLiveBarGeneration?.() ?? null);
function expectedRsi(length: number) {
  const closes = bars.map(bar => bar[4]);
  let gain = 0, loss = 0;
  for (let i = 1; i <= length; i++) {
    const change = closes[i] - closes[i - 1];
    gain += Math.max(change, 0); loss += Math.max(-change, 0);
  }
  gain /= length; loss /= length;
  for (let i = length + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gain = (gain * (length - 1) + Math.max(change, 0)) / length;
    loss = (loss * (length - 1) + Math.max(-change, 0)) / length;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}
async function expectRsi(page: Page, name: string, length: number) {
  const expected = expectedRsi(length);
  await expect.poll(async () => {
    const witness = await rsiWitness(page);
    if (witness?.barCount !== bars.length || witness.lastBar?.c !== bars.at(-1)![4]) return null;
    return witness.series[name]?.[0]?.value ?? null;
  }, { message: name + " canvas series must calculate RSI(" + length + ")", timeout: 20_000 }).toBeCloseTo(expected, 6);
  await expect.poll(async () => (await rsiWitness(page))?.indRow?.[name] ?? null,
    { message: name + " Data Window must share the calculated period" }).toBeCloseTo(expected, 6);
}
const pairTemplate = { id: "ct_aipair01", v: 2, name: "Two independent RSIs", revision: 1,
  createdAt: "2026-10-18T10:00:00.000Z", updatedAt: "2026-10-18T10:00:00.000Z",
  indicators: ["rsi", "rsi__aipair01"],
  indParams: { rsi: { length: 9 }, rsi__aipair01: { length: 7 } }, hidden: ["rsi__aipair01"] };

async function open(page: Page, lang: "en" | "zh", log = false) {
  const mirrors: Mirror[] = [];
  const saves: unknown[] = [];
  const fixtureBars = log ? bars.map(([t, o, h, l, c, v]) => [t, 2 * o - 90, 2 * h - 90, 2 * l - 90, 2 * c - 90, v]) : bars;
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("https://www.mastermind-x.com/mm_brain.js", route => route.fulfill({ contentType: "application/javascript",
    body: "window.MMBrain={mounted:true,open(){},close(){},toggle(){}};" }));
  await page.route("**/api/brain/chart/state", async route => {
    mirrors.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/drawings**", async route => {
    if (route.request().method() === "GET") await route.fulfill({ json: { drawings: [human] } });
    else { saves.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true } }); }
  });
  await page.route(/\/data\/NVDA\.json(?:\?.*)?$/, route => route.fulfill({ json: {
    t: "NVDA", o: 1, src: "cmx-synthetic-fixture", bar_quality: "real_ohlc", bars: fixtureBars,
  } }));
  await page.route(/\/data\/NVDA\.slice\.json(?:\?.*)?$/, route => route.fulfill({ json: {
    indicator: { state: { position_hint: "flat" }, signals: [], early_dots: [], warnings: [] }, backtest: { metrics: {} },
  } }));
  await page.addInitScript(({ lang, log, structureParams, pairTemplate }) => {
    localStorage.setItem("mm.chartTemplates", JSON.stringify([pairTemplate]));
    localStorage.setItem("mm.inds", JSON.stringify(["ema", "rsi", "structure"]));
    localStorage.setItem("mm.indParams", JSON.stringify({ ema: { ma1Len: 37 }, rsi: { length: 21 }, structure: structureParams }));
    localStorage.setItem("mm.chartSettings", JSON.stringify({ scaleLeft: true, mode: log ? 1 : 0 }));
    localStorage.setItem("mm.devTier", "pro");
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("mm.tf", JSON.stringify("D"));
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
    localStorage.removeItem("mm.draw");
    const host = window as Host;
    host.__drawingWorkspaceReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => { host.__drawingWorkspaceReady = true; });
  }, { lang, log, structureParams, pairTemplate });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => !!(window as Host).__drawingWorkspaceReady), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => typeof (window as Host).MM_BRAIN_CFG?.onCommand), { timeout: 15_000 }).toBe("function");
  await expect(page.locator('.pane.on .drawing-layer [data-id="human_reference"]')).toHaveCount(1);
  return { mirrors, saves };
}

async function send(page: Page, mirrors: Mirror[], batch: string, steps: Step[]) {
  const identity = await page.evaluate(() => {
    const value = (window as Host).MM_BRAIN_CFG?.getAiContext?.();
    if (!value) throw new Error("Real chart context is absent");
    return { origin_id: value.origin_id, context_revision: value.context_revision };
  });
  await expect.poll(() => mirrors.at(-1), { timeout: 10_000 }).toMatchObject(identity);
  const session = mirrors.at(-1)!.session!;
  const target: ChartCommandTarget = { schema: "chart.command_target.v1", ...identity,
    pane_id: session.pane_id, symbol: session.symbol, tf: session.tf };
  await page.evaluate(({ batch, steps, target }) => {
    const callback = (window as Host).MM_BRAIN_CFG?.onCommand;
    if (!callback) throw new Error("Real chart command receiver is absent");
    steps.forEach((step, seq) => callback({ on: true, v: 2, batch_id: batch, seq, target, ...step }));
  }, { batch, steps, target });
  return target;
}
function receipts(mirrors: Mirror[], batch: string) {
  return [...new Map(mirrors.flatMap(m => m.acks ?? []).filter(ack => ack.batch_id === batch).map(ack => [ack.seq, ack])).values()];
}
async function accepted(mirrors: Mirror[], batch: string, count: number, timeout = 20_000) {
  await expect.poll(() => receipts(mirrors, batch), { timeout }).toHaveLength(count);
  expect(receipts(mirrors, batch).filter(ack => !ack.ok)).toEqual([]);
}
function composition(lang: "en" | "zh"): Step[] {
  const native = (id: string, kind: string, points: ReturnType<typeof point>[], caption: string, extra = {}): Step =>
    ({ op: "draw.tool", id, caption, args: { kind, points, ...extra } });
  return [
    native("ai_channel", "channel", [point(300, 100), point(380, 112), point(325, 109)], lang === "en" ? "Trend context" : "趋势环境"),
    native("ai_extension", "fibtrend", [point(310, 100), point(350, 108), point(375, 104)], lang === "en" ? "Three-pivot extension" : "三点斐波那契扩展",
      { fibonacci: { levels: [0, 1, 1.618], reverse: false, labels: "both" }, style: { color: "#38bdf8", width: 2 } }),
    native("ai_wave", "elliottimpulse", [point(310, 100), point(328, 109), point(345, 103), point(367, 115), point(383, 108), point(402, 117)], lang === "en" ? "Interpretive wave count" : "波浪计数假设"),
    native("ai_zone", "rect", [point(355, 98), point(405, 102)], lang === "en" ? "Reaction area" : "价格反应区", { style: { fill_color: "#22c55e", fill_opacity: .12 } }),
    native("ai_measure", "pricerange", [point(345, 102), point(375, 111)], lang === "en" ? "Measured price swing" : "价格波段测量"),
    native("ai_note", "callout", [point(399, 111), point(407, 106)], lang === "en" ? "Confirmation condition" : "确认条件",
      { text: lang === "en" ? "Confirm at the marked boundary" : "在标记边界确认" }),
    { op: "draw.channel", id: "ai_compound", caption: lang === "en" ? "Broader channel" : "大级别通道", args: {
      u1: point(290, 112), u2: point(380, 117), l1: point(290, 105), l2: point(380, 110) } },
  ];
}

async function capture(page: Page, testInfo: TestInfo, name: string, mirrors: Mirror[]) {
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${name}.png`) });
  await testInfo.attach(name, { body: JSON.stringify(mirrors), contentType: "application/json" });
}

for (const lang of ["en", "zh"] as const) {
  test(`AI drawing workspace composes, reveals indicators and manages individual elements — ${lang}`, async ({ page }, testInfo) => {
    test.setTimeout(100_000);
    const { mirrors, saves } = await open(page, lang);
    const srRow = page.locator(".lg-row").filter({ hasText: /Smart S\/R|智能支撑/ }).first();
    // Touch views intentionally start with the indicator legend collapsed. The
    // AI inventory remains reachable there; open the existing legend to use its eye.
    await expect(page.locator('[data-ai-layer="true"]')).toBeVisible();
    if (testInfo.project.name !== "desktop") await page.locator(".lg-collapse").first().click();
    await expect(srRow).toBeVisible({ timeout: 15_000 });
    const levels = page.locator('svg g[clip-path^="url(#ic-price-clip-"] > line');
    await expect.poll(() => levels.count(), { timeout: 15_000 }).toBeGreaterThan(0);
    if (testInfo.project.name === "desktop") await srRow.hover();
    else await srRow.locator(".lg-name").click();
    await srRow.locator("button.eye").click();
    await expect(srRow).toHaveClass(/is-hidden/);
    await expect(levels).toHaveCount(0);
    await expect.poll(() => mirrors.at(-1)?.session?.indicator_visibility?.hidden).toContain("suite:structure/sr");
    await expectRsi(page, "rsi", 21);
    await send(page, mirrors, "unrelated-rsi", [{ op: "chart.set_indicators", args: {
      mode: "patch", indicators: [{ name: "rsi", params: { length: 34 } }], show: ["rsi"] } }]);
    await accepted(mirrors, "unrelated-rsi", 1);
    await expectRsi(page, "rsi", 34);
    await expect(srRow).toHaveClass(/is-hidden/);
    await send(page, mirrors, "reveal-native", [{ op: "chart.set_indicators", args: {
      mode: "patch", indicators: [], show: ["suite:structure/sr"] } }]);
    await accepted(mirrors, "reveal-native", 1);
    await expect(srRow).not.toHaveClass(/is-hidden/);
    expect(mirrors.at(-1)?.session?.indicator_visibility?.effective_hidden).not.toContain("suite:structure/sr");
    const settings = await page.evaluate(() => JSON.parse(localStorage.getItem("mm.indParams") || "{}"));
    expect(settings.ema.ma1Len).toBe(37);
    expect(settings.rsi.length).toBe(34);
    expect(settings.structure).toMatchObject(structureParams);
    await expect.poll(() => levels.count(), { timeout: 15_000 }).toBeGreaterThan(0);

    await send(page, mirrors, "composition", composition(lang));
    await accepted(mirrors, "composition", 7);
    const svg = page.locator(".pane.on .drawing-layer");
    for (const id of ["ai_channel", "ai_extension", "ai_wave", "ai_zone", "ai_measure", "ai_note"]) {
      const shape = svg.locator(`[data-id="${id}"]`);
      await expect(shape).toHaveCount(1);
      await expect(shape).not.toHaveAttribute("data-renderer-state", "unprojected");
      await expect(shape).not.toHaveAttribute("data-renderer-fallback", "true");
      expect(await shape.locator("line,path,polyline,polygon,rect,text").count()).toBeGreaterThan(0);
    }
    for (const [ratio, price] of [[0, 104], [1, 112], [1.618, 116.944]]) {
      await expect(svg.locator(`[data-id="ai_extension"] [data-fibonacci-ratio="${ratio}"]`).first()).toHaveAttribute("data-fibonacci-price", String(price));
    }
    const extension = mirrors.at(-1)?.session?.drawings?.find(d => d.id === "ai_extension");
    expect(extension?.args).toMatchObject({ kind: "fibtrend", fibonacci: { levels: [0, 1, 1.618], reverse: false, labels: "both" } });
    expect(mirrors.at(-1)?.session?.capabilities?.drawing_tools?.tools.length).toBe(48);
    const layer = page.locator('[data-ai-layer="true"]');
    const trigger = layer.locator("button[aria-controls]").first();
    const lastLegendRow = layer.locator("xpath=..").locator(".lg-row:visible").last();
    const layerBox = await trigger.boundingBox(), legendBox = await lastLegendRow.boundingBox();
    expect(layerBox!.y).toBeGreaterThanOrEqual(legendBox!.y + legendBox!.height);
    await trigger.click();
    await expect(layer.locator("[data-ai-drawing-id]")).toHaveCount(7);
    await capture(page, testInfo, `${lang}-composition`, mirrors);
    const compound = layer.locator('[data-ai-drawing-id="ai_compound"]');
    await compound.locator("button[aria-controls]").click();
    const elements = compound.locator("[data-ai-element-id]");
    await expect(elements).toHaveCount(2);
    const firstId = await elements.first().getAttribute("data-ai-element-id");
    const secondId = await elements.last().getAttribute("data-ai-element-id");
    await elements.first().locator("button").last().click();
    await expect(svg.locator(`[data-id="${firstId}"]`)).toHaveCount(0);
    await expect(svg.locator(`[data-id="${secondId}"]`)).toHaveCount(1);
    await expect(svg.locator('[data-id="human_reference"]')).toHaveCount(1);
    const zone = layer.locator('[data-ai-drawing-id="ai_zone"]');
    await zone.locator("button").first().click();
    await expect(svg.locator('[data-id="ai_zone"]')).toHaveCount(0);
    await layer.getByRole("button", { name: lang === "en" ? "Hide AI drawings" : "隐藏 AI 图形", exact: true }).click();
    await expect(svg.locator('[data-id^="ai_"]')).toHaveCount(0);
    await layer.getByRole("button", { name: lang === "en" ? "Show AI drawings" : "显示 AI 图形", exact: true }).click();
    await expect(svg.locator('[data-id="ai_zone"]')).toHaveCount(0);
    await expect(svg.locator('[data-id="ai_extension"]')).toHaveCount(1);

    // The panel overlaps the left axis in this fixture. Its scrolling and Shift
    // gestures must stay in the panel, not zoom prices or start a measurement.
    const referenceLine = svg.locator('[data-id="human_reference"] line').first();
    const before = await referenceLine.getAttribute("y1");
    const list = layer.locator("section > ul");
    const listBox = (await list.boundingBox())!;
    await page.mouse.move(listBox.x + 8, listBox.y + Math.min(40, listBox.height / 2));
    await page.mouse.wheel(0, 180);
    await list.dispatchEvent("pointerdown", { pointerId: 7, button: 0, shiftKey: true, clientX: listBox.x + 8, clientY: listBox.y + 12 });
    await list.dispatchEvent("pointerup", { pointerId: 7, button: 0, shiftKey: true, clientX: listBox.x + 8, clientY: listBox.y + 12 });
    await expect(referenceLine).toHaveAttribute("y1", before!);
    await expect(svg.locator('[data-id="_measure"]')).toHaveCount(0);
    expect(await layer.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const panelBox = (await layer.locator("section").boundingBox())!;
    const chartBox = (await layer.locator("xpath=ancestor::*[contains(@class,'chart-wrap')][1]").boundingBox())!;
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(chartBox.y + chartBox.height + 1);
    if (testInfo.project.name !== "desktop") {
      const undersized = await layer.locator("button").evaluateAll(nodes => nodes
        .filter(el => el.getClientRects().length).map(el => ({
          label: el.getAttribute("aria-label") || el.textContent,
          width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
        })).filter(size => size.width < 43 || size.height < 43));
      expect(undersized, "Every visible AI-layer action must retain its touch target").toEqual([]);
    }
    await capture(page, testInfo, `${lang}-individual-controls`, mirrors);
    await layer.locator('[data-ai-drawing-id="ai_wave"] button').last().click();
    await expect(svg.locator('[data-id="ai_wave"]')).toHaveCount(0);
    await layer.getByRole("button", { name: lang === "en" ? "Clear all" : "全部清除", exact: true }).click();
    await expect(layer.locator("[data-ai-drawing-id]")).toHaveCount(0);
    await expect(svg.locator('[data-id="human_reference"]')).toHaveCount(1);
    expect(JSON.stringify(saves)).not.toContain("ai_extension");
    await trigger.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
}

test("normal-motion queue completes 24 drawings and cancellation preserves the applied prefix", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Queue pacing is viewport-independent; the controls run in all three responsive projects above.");
  test.setTimeout(90_000);
  const { mirrors } = await open(page, "en");
  const commands: Step[] = Array.from({ length: 24 }, (_, i) => ({ op: "draw.tool", id: `ai_paced_${i}`,
    args: { kind: "hline", points: [point(400, 100 + i)] }, caption: `Paced boundary ${i + 1}` }));
  const started = Date.now();
  await send(page, mirrors, "paced-full", commands);
  await accepted(mirrors, "paced-full", 24, 20_000);
  expect(Date.now() - started).toBeGreaterThan(10_000);
  await expect(page.locator('.pane.on .drawing-layer [data-id^="ai_paced_"]')).toHaveCount(24);
  const next = commands.map((command, i) => ({ ...command, id: `ai_cancel_${i}` }));
  await send(page, mirrors, "paced-cancel", next);
  await expect.poll(() => receipts(mirrors, "paced-cancel").some(ack => ack.ok)).toBe(true);
  await page.getByRole("button", { name: "Cancel queued chart actions", exact: true }).click();
  await expect.poll(() => receipts(mirrors, "paced-cancel"), { timeout: 10_000 }).toHaveLength(24);
  const outcomes = receipts(mirrors, "paced-cancel");
  expect(outcomes.some(ack => ack.error === "command_cancelled_by_user")).toBe(true);
  await expect(page.locator('.pane.on .drawing-layer [data-id^="ai_cancel_"]')).toHaveCount(outcomes.filter(ack => ack.ok).length);
  await expect(page.locator('.pane.on .drawing-layer [data-id^="ai_paced_"]')).toHaveCount(24);
  await capture(page, testInfo, "normal-pace-cancellation", mirrors);
});

test("Fibonacci extension retains raw-price arithmetic on a logarithmic display", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The same arithmetic is already asserted on each responsive linear display.");
  test.setTimeout(60_000);
  const { mirrors } = await open(page, "en", true);
  const command = composition("en")[1];
  command.args = { ...command.args, points: [point(310, 100), point(350, 120), point(375, 110)] };
  await send(page, mirrors, "log-fib", [command]);
  await accepted(mirrors, "log-fib", 1);
  for (const [ratio, price] of [[0, 110], [1, 130], [1.618, 142.36]]) {
    await expect(page.locator(`[data-id="ai_extension"] [data-fibonacci-ratio="${ratio}"]`).first()).toHaveAttribute("data-fibonacci-price", String(price));
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mm.chartSettings") || "{}").mode)).toBe(1);
  await capture(page, testInfo, "log-fibonacci", mirrors);
});

test("template studies survive an unrelated AI edit and an exact second-RSI edit changes its calculation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Study ownership and queue revisions are viewport-independent; touch controls are covered above.");
  test.setTimeout(90_000);
  const { mirrors } = await open(page, "en");
  const pending: Step[] = Array.from({ length: 6 }, (_, i) => ({ op: "draw.tool", id: `ai_old_template_${i}`,
    args: { kind: "hline", points: [point(400, 102 + i)] } }));
  await send(page, mirrors, "before-template", pending);
  await expect.poll(() => receipts(mirrors, "before-template").some(ack => ack.ok)).toBe(true);
  // Invoke the incumbent template host's explicit automation entry. Its real planner
  // owns this user-side context change; it is never an AI continuation receipt.
  await page.evaluate(id => window.dispatchEvent(new CustomEvent("mm:apply-template",
    { detail: { id, mode: "replace" } })), pairTemplate.id);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.inds") || "[]"))).toEqual(pairTemplate.indicators);
  await expect.poll(() => receipts(mirrors, "before-template"), { timeout: 10_000 }).toHaveLength(pending.length);
  expect(receipts(mirrors, "before-template").some(ack => ack.error === "command_target_revision_mismatch")).toBe(true);
  await expectRsi(page, "rsi", 9);

  const predecessor = await send(page, mirrors, "unrelated-bands", [{ op: "chart.set_indicators",
    args: { mode: "patch", indicators: [{ name: "bb", params: { length: 25, mult: 2.5 } }], show: ["bb"] } }]);
  await accepted(mirrors, "unrelated-bands", 1);
  const state = mirrors.at(-1)!;
  expect(state.session?.indicators).toEqual(expect.arrayContaining([
    { name: "rsi", params: expect.objectContaining({ length: 9 }) },
    { name: "rsi__aipair01", params: expect.objectContaining({ length: 7 }) },
    { name: "bb", params: expect.objectContaining({ length: 25, mult: 2.5 }) },
  ]));
  expect(state.session?.indicator_visibility?.hidden).toContain("rsi__aipair01");
  expect(receipts(mirrors, "unrelated-bands")[0].application).toMatchObject({
    predecessor, successor: { origin_id: state.origin_id, context_revision: state.context_revision },
  });
  await expectRsi(page, "rsi", 9);
  const savedBeforeTypo = await page.evaluate(() => localStorage.getItem("mm.indParams"));
  await send(page, mirrors, "invalid-period-alias", [{ op: "chart.set_indicators",
    args: { mode: "patch", indicators: [{ name: "rsi", params: { len: 21 } }] } }]);
  await expect.poll(() => receipts(mirrors, "invalid-period-alias")).toHaveLength(1);
  expect(receipts(mirrors, "invalid-period-alias")[0]).toMatchObject({ ok: false, error: "unknown_indicator_setting" });
  expect(await page.evaluate(() => localStorage.getItem("mm.indParams"))).toBe(savedBeforeTypo);
  await expectRsi(page, "rsi", 9);

  await send(page, mirrors, "second-rsi", [{ op: "chart.set_indicators", args: {
    mode: "patch", indicators: [{ name: "rsi__aipair01", params: { length: 21 } }], show: ["rsi__aipair01"],
  } }]);
  await accepted(mirrors, "second-rsi", 1);
  await expectRsi(page, "rsi", 9);
  await expectRsi(page, "rsi__aipair01", 21);
  expect(mirrors.at(-1)?.session?.indicator_visibility?.effective_hidden).not.toContain("rsi__aipair01");
  await capture(page, testInfo, "template-and-independent-rsi", mirrors);
});
