const {chromium}=require('../../../terminal/node_modules/playwright');
const {expect}=require('../../../terminal/node_modules/@playwright/test');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const results=[];
 for(const [name,width,height] of [['desktop',1440,900],['tablet',820,1180],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<900});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message.slice(0,180)));
  const result={name,width,height,errors};
  try{
   const status=await (await page.request.get('https://beta.mastermind-x.com/api/shared-shell/status')).json();result.build=status.buildId;
   expect(result.build).toBe('f2aa1e0cb27d459149f59d3b24d98cd6e2e8389f');
   await page.goto('https://beta.mastermind-x.com/about.html',{waitUntil:'domcontentloaded',timeout:35000});
   await expect(page.locator('[data-shared-shell-phase="ready"]')).toBeVisible({timeout:25000});
   const original=await page.evaluate(()=>({body:document.body.style.overflow,root:document.documentElement.style.overflow}));
   for(let cycle=0;cycle<2;cycle++){
    if(width<=860){await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.locator('.m-drawer.open').getByRole('button',{name:'All tools',exact:true}).click();}
    else await page.locator('.topbar .shared-shell-directory-trigger').click();
    const directory=page.locator('.shared-shell-directory[open]');await expect(directory).toBeVisible();
    await expect(directory.getByRole('searchbox')).toBeFocused();
    await expect.poll(()=>page.evaluate(()=>({body:document.body.style.overflow,root:document.documentElement.style.overflow}))).toEqual({body:'hidden',root:'hidden'});
    if(cycle===0)await page.screenshot({path:path.join(__dirname,'live-tools-'+name+'.png'),animations:'disabled'});
    await page.keyboard.press('Escape');await expect(directory).toHaveCount(0);
    await expect.poll(()=>page.evaluate(()=>({body:document.body.style.overflow,root:document.documentElement.style.overflow}))).toEqual(original);
   }
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await page.screenshot({path:path.join(__dirname,'live-restored-'+name+'.png'),animations:'disabled'});
   expect(errors).toEqual([]);result.outcome='pass';result.cycles=2;
  }catch(error){result.outcome='fail';result.error=error.message.slice(0,650);}
  results.push(result);console.log(JSON.stringify(result));await context.close();
 }
 await browser.close();fs.writeFileSync(path.join(__dirname,'live-overlay-proof.json'),JSON.stringify({at:new Date().toISOString(),origin:'https://beta.mastermind-x.com',authentication:'fresh signed-out browser; no auth/data overrides',results},null,2));
 if(results.some(x=>x.outcome!=='pass'))process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
