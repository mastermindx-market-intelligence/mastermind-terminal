import { chromium } from '../../../terminal/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url)), output=path.join(here,'browser-evidence');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage(), errors=[], requests=[], matrix=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
const checks=[];
function check(name,value){assert.ok(value,name);checks.push(name);}
try {
  await page.goto(pathToFileURL(path.join(here,'dist/index.html')).href);
  await page.getByTestId('debit').waitFor();
  check('midpoint debit',await page.getByTestId('debit').innerText()==='$200.00');
  await page.getByTestId('basis-natural').click();
  check('natural debit',await page.getByTestId('debit').innerText()==='$210.00');
  check('natural break-even',await page.getByTestId('break-even').innerText()==='$187.10');
  await page.getByTestId('basis-custom').click();
  await page.getByLabel('Debit per share',{exact:true}).fill('2.0001');
  check('custom cent retained',await page.getByTestId('max-loss').innerText()==='$200.01');
  check('custom break-even retains precision',await page.getByTestId('break-even').innerText()==='$187.0001');
  await page.getByLabel('Debit per share',{exact:true}).fill('5');
  check('invalid debit shows error',await page.getByRole('alert').isVisible());
  check('invalid debit suppresses derived values',await page.getByTestId('debit').count()===0);
  await page.getByTestId('basis-midpoint').click();
  await page.getByLabel('Spread quantity',{exact:true}).fill('3');
  check('quantity scales debit',await page.getByTestId('debit').innerText()==='$600.00');
  await page.getByLabel('Spread quantity',{exact:true}).fill('1');
  await page.getByTestId('nav-scenario').click();
  check('heading focus after navigation',await page.locator('h1').evaluate(el=>el===document.activeElement));
  check('exact shocked price',await page.getByTestId('spot').innerText()==='$186.048');
  check('expiry loss at selected price',(await page.getByTestId('scenario-pnl').innerText()).includes('-$95.20'));
  check('IV uses additive points',(await page.getByTestId('shifted-iv').innerText()).includes('40.8 / 39.8%'));
  await page.getByRole('group',{name:'Elapsed sessions',exact:true}).getByRole('button',{name:'+5',exact:true}).click();
  await page.getByRole('group',{name:'IV shift',exact:true}).getByRole('button',{name:'-5',exact:true}).click();
  check('time and IV do not alter expiry payoff',(await page.getByTestId('scenario-pnl').innerText()).includes('-$95.20'));
  const open=page.getByRole('button',{name:'View model requirements',exact:true});await open.click();
  check('requirements dialog opens',await page.getByRole('dialog').isVisible());
  await page.keyboard.press('Escape');
  check('Escape dismisses dialog',!await page.getByRole('dialog').isVisible());
  check('dialog focus restored',await open.evaluate(el=>el===document.activeElement));
  await page.getByRole('button',{name:'Reset to base',exact:true}).click();
  check('reset price',await page.getByTestId('spot').innerText()==='$182.400');
  check('reset IV',(await page.getByTestId('shifted-iv').innerText()).includes('35.8 / 34.8%'));
  await page.getByTestId('nav-watch').click();
  check('save cannot claim success',await page.getByRole('button',{name:'Save research & watch draft',exact:true}).isDisabled());
  check('activation unavailable',await page.getByRole('button',{name:'Activate alert',exact:true}).isDisabled());
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download synthetic example',exact:true}).click();
  const download=await downloadPromise, downloaded=JSON.parse(await readFile(await download.path(),'utf8'));
  check('export explicitly unsaved',downloaded.savedResearch===false && downloaded.synthetic===true);
  check('export has no valuation or activation',downloaded.scenario.preExpiryValue===null && downloaded.watch.armed===false);
  await page.getByTestId('nav-review').click();
  const review=await page.locator('main').innerText();
  check('retained evaluation clock',review.includes('09:55:02'));
  check('review prices remain distinct',review.includes('+$15')&&review.includes('−$5'));
  check('source correction is not selling',review.includes('not new selling'));
  await page.reload();
  check('fresh page has no saved account state',await page.getByTestId('debit').innerText()==='$200.00');

  for(const width of [1440,820,768,390])for(const theme of ['dark','light'])for(const lang of ['en','zh']){
    await page.setViewportSize({width,height:1000});
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('.tools button').nth(0).click();
    if(await page.locator('html').getAttribute('lang')!==(lang==='en'?'en':'zh-Hans'))await page.locator('.tools button').nth(1).click();
    for(const view of ['plan','scenario','watch','review']){
      await page.getByTestId(`nav-${view}`).click();
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
        targets:[...document.querySelectorAll('button,input')].filter(e=>e.getBoundingClientRect().width>0&& !e.closest('dialog:not([open])')).map(e=>({text:e.textContent,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))}));
      check(`${width}/${theme}/${lang}/${view} no document overflow`,geometry.scroll<=width);
      check(`${width}/${theme}/${lang}/${view} 44px targets`,geometry.targets.every(t=>t.w>=44&&t.h>=44));
      const shot=`${view}-${width}-${theme}-${lang}.png`;
      await page.screenshot({path:path.join(output,shot),fullPage:true});
      matrix.push({width,theme,lang,view,screenshot:shot});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>document.documentElement.style.zoom='2');
  for(const view of ['plan','scenario','watch','review']){
    await page.getByTestId(`nav-${view}`).click();
    check(`200 percent zoom ${view} no overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  check('no uncaught browser errors',errors.length===0);
  check('no external network requests',requests.length===0);
  await writeFile(path.join(output,'verification.json'),JSON.stringify({status:'PASS',scope:'Local synthetic interaction prototype only',checks,matrix,errors,requests,productionAcceptance:false},null,2));
  console.log(JSON.stringify({status:'PASS',checks:checks.length,screenshots:matrix.length,productionAcceptance:false}));
} finally {await browser.close();}
