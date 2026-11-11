import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";

// Compile the actual chart plugin. Only data and the host page are synthetic;
// the renderer, raster cache, price conversion, DPR and Canvas are real.
const bundle = buildSync({
  stdin: { contents: `
    import { createChart, CandlestickSeries } from "lightweight-charts";
    import { HeatSeries } from "./lib/heatSeries";
    const chart = createChart(document.getElementById("chart"), {
      width: 800, height: 500,
      rightPriceScale: {mode: window.geometryConfig.mode, invertScale: window.geometryConfig.invert},
      layout: { background: { color: "#000000" }, textColor: "#ffffff", attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
    });
    const heat = chart.addCustomSeries(new HeatSeries(), {
      priceLineVisible: false, lastValueVisible: false,
      cellShader: (amount) => "rgba(" + Math.round(amount * 40) + ",0,0,1)",
    });
    const times = [1700000000,1700000060,1700000120];
    const cells = [
      { low: 99.5, high: 100.5, amount: 1 },
      { low: 100.5, high: 105.5, amount: 2 },
      { low: 105.5, high: 114.5, amount: 3 },
    ];
    heat.setData(times.map(time => ({time,cells})));
    const candles = chart.addSeries(CandlestickSeries, { priceLineVisible:false, lastValueVisible:false });
    candles.setData(times.map(time => ({time,open:102,high:103,low:101,close:102.5})));
    chart.timeScale().fitContent();
    const scale = chart.priceScale("right");
    window.geometry = {
      chart, heat,
      // Keep the real library's autoscaled logarithmic range; its 5.2 custom
      // range setter accepts internal transformed units. Margin scaling tests
      // a real changed price-to-pixel transform without misusing that setter.
      zoom: () => { scale.applyOptions({scaleMargins:{top:0.22,bottom:0.19}}); },
      sample: () => {
        const image = chart.takeScreenshot();
        const ratio = image.width / 800;
        const x = (chart.timeScale().timeToCoordinate(times[0]) + chart.timeScale().timeToCoordinate(times[1]))/2;
        return [100,102,110].map(price => {
          const y = heat.priceToCoordinate(price);
          return {price,x,y,rgba:Array.from(image.getContext("2d").getImageData(Math.round(x*ratio),Math.round(y*ratio),1,1).data)};
        });
      },
    };
  `, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "browser", format: "iife", write: false,
}).outputFiles[0].text;

for (const dpr of [1, 2]) {
  test.describe(`actual surface geometry at DPR ${dpr}`, () => {
    test.use({ viewport: { width: 820, height: 560 }, deviceScaleFactor: dpr });
    for (const scenario of [{name:"linear",mode:0,invert:false},{name:"inverted",mode:0,invert:true},{name:"logarithmic",mode:1,invert:false}]) {
      test(scenario.name, async ({ page }, info) => {
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.setContent('<main><h1 style="font:14px sans-serif">Synthetic price-coordinate verification</h1><div id="chart"></div></main>');
        await page.evaluate(config => { (window as any).geometryConfig = config; }, scenario);
        await page.addScriptTag({ content: bundle });
        const read = () => page.evaluate(async () => {
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          return (window as any).geometry.sample() as {price:number;rgba:number[]}[];
        });
        let result = await read();
        expect(result.map(value => value.rgba[0])).toEqual([40,80,120]);
        await page.evaluate(() => (window as any).geometry.zoom());
        result = await read();
        expect(result.map(value => value.rgba[0])).toEqual([40,80,120]);
        expect(errors).toEqual([]);
        await info.attach("actual-pixel-samples", {body: JSON.stringify({dpr,scenario,result,synthetic:true}),contentType:"application/json"});
        await page.screenshot({path:info.outputPath(`${scenario.name}-dpr${dpr}.png`)});
        await page.evaluate(() => (window as any).geometry.chart.remove());
      });
    }
  });
}
