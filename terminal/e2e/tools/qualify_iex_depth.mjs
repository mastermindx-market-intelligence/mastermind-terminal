/** Real retained archive bytes over an ISOLATED TEST transport, never a paid/live canary. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium, expect } from '@playwright/test';
const [base, inputDir, outputDir] = process.argv.slice(2);
if (!base || new URL(base).hostname !== '127.0.0.1' || !inputDir || !outputDir)
  throw Error('Use: qualify_iex_depth.mjs http://127.0.0.1:PORT PRIVATE_INPUT_DIR NEW_OUTPUT_DIR');
if (fs.existsSync(outputDir)) throw Error('output directory already exists; reconcile it instead of overwriting');
fs.mkdirSync(outputDir);
const records = Object.fromEntries(['NVDA','SPY','QQQ'].map(symbol => {
  const raw = fs.readFileSync(path.join(inputDir,symbol+'.json'));
  if (raw.length > 8*1024*1024) throw Error('oversize source');
  return [symbol,{ envelope:JSON.parse(raw), sha256:crypto.createHash('sha256').update(raw).digest('hex') }];
}));
(async()=>{
  const browser = await chromium.launch({headless:true});
  const results=[];
  try {
    for (const [name,viewport] of [['desktop',{width:1440,height:900}],['tablet',{width:820,height:1180}],['mobile',{width:390,height:844}]]) {
      const context=await browser.newContext({viewport});
      try {
        await context.addCookies([{name:'mm_e2e_rs30',value:'1',url:base}]);
        const page=await context.newPage(), errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.route('**/api/large-trades?*',async route=>{
          const symbol=new URL(route.request().url()).searchParams.get('sym');
          const source=records[symbol];
          if(!source)return route.fulfill({json:{state:'unavailable',reason:'unknown_symbol'}});
          await route.fulfill({json:{state:'ready',envelope:source.envelope,artifactSha256:source.sha256,servedAtNs:source.envelope.provenance.generatedAtNs}});
        });
        await page.goto(base+'/options/equity-replay?symbol=NVDA',{waitUntil:'domcontentloaded'});
        for(const symbol of ['NVDA','SPY','QQQ']) {
          if(symbol!=='NVDA')await page.getByLabel('Symbol',{exact:true}).selectOption(symbol);
          const source=records[symbol], points=source.envelope.depthReplay.samples,last=points.at(-1);
          const through=source.envelope.prints.filter(p=>p.session===last.session&&BigInt(p.sourceSequence)<=BigInt(last.sourceSequence)&&BigInt(p.eventNs)<=BigInt(last.marketNs));
          if(through.some(p=>p.kind==='cancel'))throw Error('this simple independent real-data oracle requires no observed B');
          const volume=through.reduce((n,p)=>n+p.quantity,0);
          await expect(page.getByTestId('iex-executed-total')).toHaveText(volume.toLocaleString('en-US'));
          await expect(page.getByTestId('iex-bid-total')).toHaveText(last.bidTotal.toLocaleString('en-US'));
          await expect(page.getByTestId('iex-depth-source')).toContainText(symbol);
          await page.getByRole('tab',{name:'Depth snapshots',exact:true}).click();
          await page.getByLabel('Price window',{exact:true}).selectOption('all');
          const expectedRects=points.slice(-60).reduce((n,p)=>n+p.bids.length+p.asks.length,0);
          await expect(page.getByTestId('iex-depth-level')).toHaveCount(expectedRects);
          await page.getByLabel('Price window',{exact:true}).selectOption('near');
          await page.getByRole('tab',{name:'Executed volume',exact:true}).click();
          await expect(page.getByTestId('iex-footprint-row').first()).toBeVisible();
          const geometry=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
          if(geometry.scroll>geometry.width+1)throw Error('horizontal overflow '+name);
          results.push({viewport:name,symbol,artifactSha256:source.sha256,volume,bookLevels:expectedRects,sourceSequence:last.sourceSequence});
        }
        await page.evaluate(()=>{
          const label=document.createElement('p');label.textContent='REAL IEX HISTORICAL DATA / ISOLATED TEST TRANSPORT / NOT A LIVE ACCOUNT';
          label.style.cssText='padding:10px;background:#3c2f10;color:#ffdc82;font-size:12px';
          document.querySelector('[data-testid="iex-depth-replay"]').prepend(label);
        });
        await page.screenshot({path:path.join(outputDir,name+'-executions.png'),fullPage:true});
        await page.getByRole('tab',{name:'Depth snapshots',exact:true}).click();
        await page.screenshot({path:path.join(outputDir,name+'-depth.png'),fullPage:true});
        if(errors.length)throw Error('page errors: '+errors.join('; '));
      } finally {await context.close();}
    }
    const report={status:'REAL_ARCHIVE_BROWSER_TEST_PASS',transport:'isolated test interception; not production authentication',results};
    fs.writeFileSync(path.join(outputDir,'browser-verification.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
