import { expect, test, type Page } from "@playwright/test";

const T = Date.parse("2026-10-21T14:30:00Z"); // 10:30 EDT
const D = Date.UTC(2026,9,21,10,30)/1000;
const generation = "d4606eb2-61c0-43a9-b89e-ff8da926ebf4";
const read = (page:Page) => page.evaluate(() => (window as any).__mmLiveBarGeneration?.());

test("a retained batch repairs the closing candle and grows the next candle in one generation",async({page},testInfo)=>{
  test.slow();
  await page.clock.setFixedTime(new Date(T+63000));
  let phase=0, history=false;
  const historyBars=Array.from({length:61},(_,i)=>[D-(60-i)*60,100,101,99,100,100]);
  await page.addInitScript(()=>{
    localStorage.setItem("mm.startTf",JSON.stringify("1m"));
    localStorage.setItem("mm.inds",JSON.stringify(["ema","rsi","vol"]));
    localStorage.setItem("mm.mastermindCandles.v1","1");
    localStorage.removeItem("mm.ws");
  });
  await page.route("**/api/intraday?**",async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get("sym")!=="NVDA"||url.searchParams.get("tf")!=="1m")return route.continue();
    await route.fulfill({json:{t:"NVDA",tf:"1m",source:"forming-candle-e2e",session_date:"2026-10-21",bars:historyBars}});
    history=true;
  });
  await page.route("**/api/quote?**",async route=>{
    const url=new URL(route.request().url()),fast=url.searchParams.get("cadence")==="chart";
    const active=fast?phase:0;
    const first={time:D,o:100,h:active===1?110:105,l:active===1?95:96,c:101,v:active===1?150:147,complete:true};
    const second={time:D+60,o:101,h:103,l:100,c:102,v:30,complete:true};
    const asOfMs=active===1?T+59999:active===2?T+62999:T;
    const last=active===2?102:active===1?101:100;
    const formingCandles={version:1,source:"polygon-live-second",generation,generationStartedMs:T-1000,
      revision:active,asOfMs,timeframes:"1m",series:{"regular:1m":active===1?[first]:[first,second]}};
    const q={sym:"NVDA",source:"polygon-live-second",basis:"REALTIME",market:"us",marketSession:"rth",
      regularSession:"rth",regularSessionDate:"2026-10-21",last,open:100,high:110,low:95,vol:100000,
      prevClose:99,chg:last-99,regularPrice:last,regularChg:last-99,asOfMs,ts:Math.floor(asOfMs/1000),
      ...(active?{formingCandles}:{})};
    const syms=(url.searchParams.get("syms")||"NVDA").split(",");
    await route.fulfill({json:{quotes:Object.fromEntries(syms.map(sym=>[sym,sym==="NVDA"?q:null]))}});
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect.poll(()=>history,{timeout:45000}).toBe(true);
  await expect.poll(async()=>(await read(page))?.barCount,{timeout:45000}).toBe(61);
  phase=1;
  await expect.poll(async()=>(await read(page))?.lastBar?.v,{timeout:45000}).toBe(150);
  const first=await read(page);
  expect(first.lastBar).toMatchObject({h:110,l:95,c:101,v:150});
  phase=2;
  await expect.poll(async()=>(await read(page))?.barCount,{timeout:45000}).toBe(62);
  const next=await read(page);
  expect(next.generation).toBe(first.generation+1);
  expect(next.recentBars.slice(-2)).toMatchObject([{time:D,h:105,l:96,c:101,v:147},{time:D+60,c:102,v:30}]);
  expect(next.priceRecent.slice(-2)).toMatchObject([{time:D,high:105,low:96,close:101},{time:D+60,close:102}]);
  expect(next.priceTail.value).toBe(102);
  expect(next.syncValueAt).toBe(102);
  expect(next.indRow.ema).toBeCloseTo(next.series.ema[0].value,6);
  const chart=page.locator(".chart-wrap").first();
  await expect(chart).toHaveAttribute("data-live-coverage","complete");
  await expect(chart).toHaveAttribute("data-live-close","102");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:testInfo.outputPath(testInfo.project.name+"-forming-candle.png"),fullPage:false});
});
