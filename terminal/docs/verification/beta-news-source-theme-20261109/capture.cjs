const { chromium } = require("playwright");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const phase = process.argv[2] || "before";
const base = "http://127.0.0.1:3312";
const view = {schema:"ticker_news.editorial_view.v1",rules:"ticker_news.editorial_rules.v1",mode:"news",revision:"a".repeat(64),name_coverage:"names_and_symbols"};
const row = (sequence, source, id, title) => ({
  sequence, source, source_item_id:String(sequence), story_id:"ev2_"+id, source_count:1, item_count:1,
  title,url:source==="reuters"?"https://www.reuters.com/technology/nvda-outlook":"https://www.benzinga.com/news/"+sequence,
  teaser:"",published_at:"2026-10-05T18:20:01+00:00",updated_at:"2026-10-05T18:20:01+00:00",
  received_at:"2026-10-05T18:20:01+00:00",universe_revision:"sp500-r1",editorial_view:view,
});
const rows=[
  row(11,"benzinga","theme_launch","Nvidia introduces a new accelerator platform"),
  row(10,"benzinga","theme_supply","Nvidia supplier adds packaging capacity"),
  row(9,"reuters","theme_outlook","Nvidia reaffirms its data-center outlook"),
];
const feed={schema:"ticker_news.snapshot.v1",editorial_policy:"ticker_news.curated.v1",editorial_view:view,ticker:"NVDA",security_id:"SEC:US-XNAS-NVDA",state:"live",rows,next_cursor:9,has_more:false,source_health:{state:"live",last_successful_catchup:rows[0].received_at}};
(async()=>{
  const out="test-results/news-theme/"+phase;
  await fs.mkdir(out,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const results=[];
  try {
    const cases=phase==="before"?[{name:"desktop",width:1440,height:900,theme:"light",lang:"en"}]:[
      {name:"desktop",width:1440,height:900,theme:"light",lang:"en"},
      {name:"desktop",width:1440,height:900,theme:"dark",lang:"en"},
      {name:"phone",width:320,height:568,theme:"light",lang:"zh"},
      {name:"phone",width:320,height:568,theme:"dark",lang:"zh"}
    ];
    for(const sample of cases){
      const context=await browser.newContext({viewport:{width:sample.width,height:sample.height}});
      await context.addCookies([{name:"mm_e2e_wl",value:"news-theme-"+randomUUID(),url:base}]);
      await context.addInitScript(({theme,lang})=>{
        localStorage.setItem("mm.lang",lang);localStorage.setItem("mmx.shell.theme",theme);
        const Native=window.EventSource;
        class Quiet {
          static CONNECTING=0;static OPEN=1;static CLOSED=2;
          readyState=1;onopen=null;onmessage=null;onerror=null;withCredentials=false;
          constructor(url,options){if(!String(url).includes("/api/news/stream"))return new Native(url,options);this.url=String(url);}
          addEventListener(){} removeEventListener(){} close(){this.readyState=2;}
        }
        window.EventSource=Quiet;
      },sample);
      const page=await context.newPage();page.setDefaultNavigationTimeout(90000);
      await page.route(/\/api\/news\/NVDA(?:\?.*)?$/,r=>r.fulfill({json:feed}));
      await page.goto(base+"/terminal?symbol=NVDA");
      await page.locator(".mm-ptag").waitFor({state:"visible",timeout:60000});
      const tab=page.locator("#rail-tab-news");
      await tab.scrollIntoViewIfNeeded();await tab.click();
      const panel=page.getByTestId("ticker-news-panel");
      await panel.waitFor({state:"visible"});
      await page.waitForFunction(()=>document.querySelector('[data-testid="ticker-news-panel"]')?.getAttribute("data-news-state")==="live");
      const select=panel.locator("[data-news-source-filter]");
      await select.waitFor({state:"visible"});await select.scrollIntoViewIfNeeded();await select.focus();
      const observation=await select.evaluate(el=>({rootTheme:document.documentElement.dataset.theme,rootLang:document.documentElement.dataset.lang,rootScheme:getComputedStyle(document.documentElement).colorScheme,sourceScheme:getComputedStyle(el).colorScheme,sourceBackground:getComputedStyle(el).backgroundColor,outline:getComputedStyle(el).outlineStyle}));
      if(phase!=="before" && observation.sourceScheme!==sample.theme) throw new Error("Native source theme mismatch: "+JSON.stringify(observation));
      await page.screenshot({path:out+"/"+sample.name+"-"+sample.theme+".png"});
      await select.selectOption("reuters");
      await page.waitForFunction(()=>document.querySelectorAll('[data-testid="ticker-news-panel"] article[data-story-id]').length===1);
      observation.filteredIds=await panel.locator("article[data-story-id]").evaluateAll(els=>els.map(el=>el.dataset.storyId));
      await select.selectOption("");
      await page.waitForFunction(()=>document.querySelectorAll('[data-testid="ticker-news-panel"] article[data-story-id]').length===3);
      observation.restoredCount=await panel.locator("article[data-story-id]").count();
      results.push({sample,...observation});
      await context.close();
    }
    await fs.writeFile(out+"/result.json",JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
  } finally {await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
