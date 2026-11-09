const { chromium } = require('../../../terminal/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  const results = [];
  for (const route of ['/sector_central.html#overview','/macro.html','/news.html','/stock.html#AAPL','/about.html']) {
    const page=await context.newPage(); const errors=[];
    page.on('pageerror',e=>errors.push(e.message.slice(0,220)));
    const result={route,errors};
    try {
      result.status=(await page.goto('https://beta.mastermind-x.com'+route,{waitUntil:'domcontentloaded',timeout:35000}))?.status();
      const host=page.locator('[data-shared-shell-phase]');
      await host.waitFor({timeout:15000});
      await page.waitForFunction(()=>['ready','restricted'].includes(document.querySelector('[data-shared-shell-phase]')?.getAttribute('data-shared-shell-phase'))||document.querySelector('[data-shared-shell-failure]')?.getAttribute('data-shared-shell-failure')!=='none',{},{timeout:20000}).catch(()=>{});
      result.phase=await host.getAttribute('data-shared-shell-phase');
      result.failure=await host.getAttribute('data-shared-shell-failure');
      result.overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      const child=page.frames().find(f=>f.url().startsWith('https://www.mastermind-x.com/'));
      result.childPath=child?new URL(child.url()).pathname:null;
      if(child) {
        result.buttons=await child.locator('button').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>({text:(n.textContent||'').trim().slice(0,85),id:n.id,disabled:n.disabled,expanded:n.getAttribute('aria-expanded')})).slice(0,40));
        const more=child.getByRole('button',{name:/show more|show less|load more/i});
        result.expand=[];
        const count=Math.min(await more.count(),3);
        for(let i=0;i<count;i++) {
          const button=more.nth(i); if(!await button.isVisible())continue;
          const before=await button.evaluate(n=>({text:n.textContent,expanded:n.getAttribute('aria-expanded'),nearby:n.parentElement?.textContent?.length}));
          await button.click({timeout:5000});
          const after=await button.evaluate(n=>({text:n.textContent,expanded:n.getAttribute('aria-expanded'),nearby:n.parentElement?.textContent?.length})).catch(()=>({removed:true}));
          result.expand.push({before,after});
        }
      }
      if(result.failure!=='none') {
        const out=path.join(__dirname,route.split(/[?#]/)[0].replace(/\W/g,'_')+'-failure.png');
        await page.screenshot({path:out});result.screenshot=path.basename(out);
      }
    }catch(error){result.error=String(error.message).slice(0,220);}
    results.push(result);console.log(JSON.stringify(result));await page.close();
  }
  await browser.close();fs.writeFileSync(path.join(__dirname,'public-route-probe.json'),JSON.stringify({at:new Date().toISOString(),authentication:'fresh guest context',results},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
