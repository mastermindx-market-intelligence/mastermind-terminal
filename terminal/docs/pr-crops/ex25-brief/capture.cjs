#!/usr/bin/env node
'use strict';
// Run from terminal/: node docs/pr-crops/ex25-brief/capture.cjs <dependency-terminal> <before|after>
// Actual component/CSS, synthetic data, isolated browser. Not a full-shell or live-data claim.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const project = process.cwd();
const dependencyProject = path.resolve(process.argv[2] || project);
const phase = process.argv[3];
if (!['before', 'after'].includes(phase)) throw new Error('Expected before or after phase.');
const requireDeps = createRequire(path.join(dependencyProject, 'package.json'));
const esbuild = requireDeps('esbuild');
const { chromium, expect } = requireDeps('@playwright/test');
for (const name of ['package.json', 'package-lock.json']) {
  if (!fs.readFileSync(path.join(project, name)).equals(fs.readFileSync(path.join(dependencyProject, name)))) throw new Error('Dependency manifest mismatch: ' + name);
}
const out = path.join(__dirname, phase);
fs.mkdirSync(out, { recursive: true });
const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'ex25-component-bundle-'));
const sourceFiles = ['components/fin/CompanyIntelligenceBriefLayout.tsx', 'components/fin/CompanyIntelligenceBriefLayout.module.css', 'app/globals.css', 'app/fin.css', 'app/company-intelligence.css', 'components/chrome/shared-shell/shared-shell.css'];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceHashes = Object.fromEntries(sourceFiles.map(f => [f, sha256(fs.readFileSync(path.join(project, f)))]));
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import Brief from ${JSON.stringify(path.join(project, 'components/fin/CompanyIntelligenceBriefLayout.tsx'))};
const q=new URLSearchParams(location.search),zh=q.get('lang')==='zh',state=q.get('state');
const fact={id:'revenue',label:zh?'营收':'Revenue',value:'$109.4B',detail:zh?'合成测试数据，不是实时报告':'Synthetic fixture, not a live report'};
const item={id:'watch',label:zh?'关注事项':'Watchpoint',value:zh?'需要在下一份报告核对的测试事项':'A fixture watchpoint to check in the next report'};
const change={id:'change',label:zh?'变化':'Change',value:zh?'测试中的同比变化':'Illustrative year-over-year change'};
const implication={id:'implication',label:zh?'背景':'Context',value:zh?'仅用于组件测试的业务背景':'Business context for component testing only'};
if(state==='long'){item.value=(zh?'长文本证据说明，需完整换行并保留原始含义。':'Long evidence wording must wrap without hiding its meaning. ').repeat(6);}
const full=state==='populated'||state==='long',empty=state==='empty';
window.__selections=[];
createRoot(document.getElementById('root')).render(<div className="ci-page"><Brief zh={zh} ticker="AAPL" periodLabel="Q3 FY2026" eventDate="2026-07-30" headline={zh?'公司简报组件测试':'Company Brief component fixture'} summary={zh?'仅供本地视觉和交互验证。':'Local visual and interaction validation only.'} metrics={empty?[]:[fact]} takeaways={[]} changes={full?[change]:[]} implications={full?[implication]:[]} risks={empty?[]:[item]} watch={full?[item]:[]} selectedId="revenue" onSelect={item=>window.__selections.push(item.id)} footer={<p data-fixture-source-footer>{zh?'来源和研究边界仍然可见':'Sources and research boundaries remain available'}</p>}/></div>);
`;
(async () => {
  let browser, server;
  const records = [];
  try {
    await esbuild.build({ stdin: { contents: entry, resolveDir: project, loader: 'tsx' }, outfile: path.join(bundle, 'bundle.js'), bundle: true, format: 'iife', jsx: 'automatic', nodePaths: [path.join(dependencyProject, 'node_modules')], define: { 'process.env.NODE_ENV': '"development"' } });
    const cssFiles = sourceFiles.filter(f => f.endsWith('.css') && !f.endsWith('.module.css'));
    const styles = cssFiles.map(f => fs.readFileSync(path.join(project, f), 'utf8').replace(/^@import.*$/mg, '').replace(/^@source.*$/mg, '')).join('\n');
    server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://local');
      if (u.pathname === '/bundle.js' || u.pathname === '/bundle.css') {
        res.writeHead(200, { 'Content-Type': u.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' });
        res.end(fs.readFileSync(path.join(bundle, u.pathname.slice(1)))); return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><html data-lang="${u.searchParams.get('lang')}" data-theme="${u.searchParams.get('theme')}" ${u.searchParams.get('shell') === 'shared' ? 'data-mmx-shared-shell="1"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}\nbody{margin:0;background:var(--bg);color:var(--text);height:auto;overflow:auto}#root{max-width:1216px;margin:auto;padding:16px}.ci-page{height:auto;overflow:visible}#fixture-label{font:12px sans-serif;padding:8px}</style><link rel="stylesheet" href="/bundle.css"></head><body><div id="fixture-label">LOCAL EX-25 COMPONENT FIXTURE · SYNTHETIC DATA · NO AUTH / LIVE-DATA / FULL-SHELL CLAIM</div><div id="root"></div><script src="/bundle.js"></script></body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    browser = await chromium.launch({ headless: true });
    const profiles = [{ name: 'classic-dark', shell: 'classic', theme: 'dark' }, { name: 'shared-light', shell: 'shared', theme: 'light' }, { name: 'shared-dark', shell: 'shared', theme: 'dark' }];
    for (const profile of profiles) for (const width of [1440, 820, 390]) for (const lang of ['en', 'zh']) for (const state of ['mixed', 'populated', 'empty', 'long']) {
      const height = width === 1440 ? 900 : width === 820 ? 1180 : 844;
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      const row = { profile: profile.name, width, height, lang, state, errors };
      records.push(row);
      try {
        await page.goto(`http://127.0.0.1:${port}/?shell=${profile.shell}&theme=${profile.theme}&lang=${lang}&state=${state}`);
        await expect(page.locator('[data-ci-paper-brief]')).toBeVisible();
        row.layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, panels: [...document.querySelectorAll('.ci-paper-insight,.ci-paper-watch')].map(e => ({ title: e.querySelector('h4')?.textContent, empty: !!e.querySelector('.ci-paper-brief-empty'), flag: e.getAttribute('data-empty'), height: e.getBoundingClientRect().height, minHeight: getComputedStyle(e).minHeight, text: e.textContent })), footer: !!document.querySelector('[data-fixture-source-footer]') }));
        expect(row.layout.overflow).toBe(false); expect(row.layout.footer).toBe(true); expect(errors).toEqual([]);
        if (phase === 'after') for (const panel of row.layout.panels) expect(panel.flag).toBe(String(panel.empty));
        if (state !== 'empty') {
          await page.locator('.ci-paper-metrics button').first().click();
          expect(await page.evaluate(() => window.__selections)).toEqual(['revenue']);
        } else expect(await page.locator('.ci-paper-metrics button,.ci-paper-brief-list button,.ci-paper-watch-list button').count()).toBe(0);
        if (state === 'mixed') await page.screenshot({ path: path.join(out, `${profile.name}-${width}-${lang}.png`), animations: 'disabled' });
        row.result = 'PASS';
      } catch (e) { row.result = 'FAIL'; row.failure = e.message; await page.screenshot({ path: path.join(out, `FAIL-${profile.name}-${width}-${lang}-${state}.png`) }); }
      finally { await page.close(); }
    }
    const receipt = { phase, recordedAt: new Date().toISOString(), sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim(), sourceHashes, fontQualification: 'Repository CSS with local system fallback; not production font proof', scope: 'Isolated actual Brief component and CSS with synthetic props; not full-shell/live-data/auth evidence', records };
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ phase, cases: records.length, passed: records.filter(x => x.result === 'PASS').length, failed: records.filter(x => x.result !== 'PASS').map(x => ({ profile: x.profile, width: x.width, lang: x.lang, state: x.state, failure: x.failure })) }, null, 2));
    if (records.some(x => x.result !== 'PASS')) process.exitCode = 1;
  } finally { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); fs.rmSync(bundle, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
