#!/usr/bin/env node
/** Focused F11 selected immutable-version proof: actual served widget, native Analysis chrome/context,
 * controlled local network. No production query/account/DB effects. Run from
 * terminal/: F11_SERVED_BRAIN_JS=/absolute/retained/mm_brain-served.js node e2e/tools/capture_f11_thesis_read.cjs
 * Owns/stops its preview; no source fixture or replacement MMBrain implementation.
 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto'), { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const ROOT = path.resolve(__dirname, '../..'), REPO = path.dirname(ROOT);
const OUT = path.join(ROOT, 'docs/pr-crops/b-f11-version-grounding');
const researchDelta = process.env.F11_CAPTURE_SCOPE === 'research-delta';
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3587), ORIGIN = `http://127.0.0.1:${PORT}`;
const SCRIPT_URL = 'https://www.mastermind-x.com/mm_brain.js';
const SCRIPT_PATH = process.env.F11_SERVED_BRAIN_JS;
assert(SCRIPT_PATH && path.isAbsolute(SCRIPT_PATH), 'Provide the exact retained served public widget file');
const script = fs.readFileSync(SCRIPT_PATH), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = ['terminal/components/AppNav.tsx', 'terminal/components/MobileNav.tsx', 'terminal/components/chrome/AnalysisBrainHost.tsx', 'terminal/lib/analysisBrainEntry.ts', 'terminal/components/BrainWidget.tsx', 'terminal/lib/aiContext.ts'];
const report = { base_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), captured_at: new Date().toISOString(),
  origin: ORIGIN, bundler: 'webpack', fixtureScope: 'Default six responsive cells; F11_CAPTURE_SCOPE=research-delta narrows to one desktop Research current/history scenario and settled390English. Synthetic Pro quota, GETs, and streams; no live auth, API mutation or upstream call', setup: 'Supported Next webpack mode: Turbopack rejects the pre-existing reused node_modules symlink outside its pinned filesystem root; dependency custody unchanged', route: '/analysis?view=theses&symbol=MU&thesis=11111111-1111-4111-8111-111111111111', production: false, privateData: false,
  widget: { url: SCRIPT_URL, bytes: script.length, sha256: hash(script), implementation: 'Unmodified served first-party widget bytes; controlled local responses' },
  sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, hash(fs.readFileSync(path.join(REPO, file)))])),
  checks: [], screenshots: [], pageErrors: [], unexpectedRequests: [], localTurns: [] };
fs.mkdirSync(OUT, { recursive: true });
function check(name, passed, detail) { report.checks.push({ name, passed: !!passed, detail }); assert(passed, name); }
let server, browser;
(async () => {
  server = spawn('npm', ['run', 'dev', '--', '--webpack', '--hostname', '127.0.0.1', '--port', String(PORT)], { cwd: ROOT, detached: true, stdio: 'ignore', env: {
    ...process.env, ANALYSIS_LOCAL_PREVIEW: '1', ADMIN_DEV: '1', TERMINAL_E2E_FIXTURE: '1', TERMINAL_E2E_EMAIL: 'responsive@example.com',
    TERMINAL_E2E_ENTITLEMENT: 'unlimited', RATE_LIMIT_MAX: '100000', FLOW_FIXTURE: '1', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key',
  } });
  let ready = false;
  for (let n = 0; n < 60; n++) { try { const r = await fetch(ORIGIN + report.route); if (r.status === 200) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 500)); }
  check('own preview ready', ready);
  browser = await chromium.launch(); report.browser = browser.version();
  for (const width of (researchDelta ? [1440, 390] : [1440, 820, 390])) for (const lang of (researchDelta ? ['en'] : ['en', 'zh'])) {
    const label = `analysis-brain-${width}-${lang}`, delayScript = width === 1440 && lang === 'en';
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : width === 820 ? 1180 : 844 }, hasTouch: width === 390, reducedMotion: 'reduce' });
    await context.addInitScript(lang => { localStorage.setItem('mm.lang', lang); document.documentElement?.setAttribute('data-lang', lang); }, lang);
    const page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push({ label, message: error.message }));
    let releaseScript; const scriptReady = new Promise(resolve => { releaseScript = resolve; }); if (!delayScript) releaseScript();
    const turns = [];
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.href === SCRIPT_URL) { await scriptReady; return route.fulfill({ contentType: 'application/javascript', body: script }); }
      if (url.origin !== ORIGIN) { report.unexpectedRequests.push({ label, origin: url.origin, path: url.pathname, effect: 'blocked' }); return route.abort(); }
      if (url.pathname === '/api/brain/me') return route.fulfill({ json: { tier: researchDelta && width === 1440 ? 'pro' : 'guest', quotas: { fast: { limit: 20, remaining: 20, period: 'day' }, pro: { limit: 20, remaining: 20, period: 'month' } } } });
      if (url.pathname === '/api/brain/threads') return route.fulfill({ json: { threads: [] } });
      if (url.pathname === '/api/brain/stream') {
        const body = req.postDataJSON(); turns.push(body); report.localTurns.push({ label, context: body.context, mode: body.mode, lane: body.lane, destination: 'intercepted local fixture; no upstream execution' });
        const text = lang === 'zh' ? '本地导航验证：已保留论文工作区上下文。' : 'Local navigation check: thesis workspace context retained.';
        const frames = [{ type: 'delta', text }, { type: 'done', text }].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
      }
      if (url.pathname === '/api/theses' && req.method() === 'GET') {
        const subject = { schema:'mastermind.thesis-subject-ref/v1', kind:'issuer', owner:'data_os.security_master', key:'MU', identityState:'resolved', display:'Synthetic MU' };
        const content = { schema:'mastermind.thesis-content/v1', title:'Synthetic read-only thesis', statement:'Synthetic browser fixture, never persisted.', catalysts:[], falsifiers:['Synthetic condition'], risks:[], horizon:'unspecified', effectiveAt:null, revisionNote:null };
        const thesisId='11111111-1111-4111-8111-111111111111';
        const current={id:'33333333-3333-4333-8333-333333333333',thesisId,version:2,previousVersion:1,transition:'revise',lifecycleState:'active',subject,content,clientRequestId:'synthetic-read',systemRecordedAt:'2026-10-20T12:00:00Z',effectiveAt:null};
        const older={...current,id:'22222222-2222-4222-8222-222222222222',version:1,previousVersion:null,transition:'create'};
        const thesis={id:thesisId,currentVersion:2,lifecycleState:'active',subject,title:content.title,updatedAt:current.systemRecordedAt,createdAt:current.systemRecordedAt,current,history:[current,older],historyTruncated:false};
        return route.fulfill({json:url.searchParams.get('id') ? {thesis} : {theses:[thesis],truncated:false}});
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, json: { error: 'Explicit local proof fixture has no coverage' } });
      return route.continue();
    });
    await page.goto(ORIGIN + report.route, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.locator('[data-testid="thesis-workspace"]').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => typeof window.MM_BRAIN_CFG?.getAiContext === 'function');
    await page.waitForFunction(() => window.MM_BRAIN_CFG?.getAiContext?.()?.ambient?.thesis_read?.version_id === '33333333-3333-4333-8333-333333333333');
    const first = await page.evaluate(() => { window.__f11FrozenTurn = window.MM_BRAIN_CFG.getAiContext(); return window.__f11FrozenTurn; });
    check(label + ': current exact version', first.ambient.thesis_read.version_id === '33333333-3333-4333-8333-333333333333');
    await page.locator('button[aria-label$=" 1"]').click();
    await page.waitForFunction(() => window.MM_BRAIN_CFG.getAiContext().ambient?.thesis_read?.version_id === '22222222-2222-4222-8222-222222222222');
    check(label + ': frozen turn unaffected by historical selection', await page.evaluate(() => window.__f11FrozenTurn.ambient.thesis_read.version_id === '33333333-3333-4333-8333-333333333333'));
    const before = await page.evaluate(() => window.MM_BRAIN_CFG.getAiContext());
    check(label + ': initial typed thesis context', before.schema === 'ai_context_client.v1' && before.ambient.page === 'analysis' && before.ambient.panel === 'theses' && before.ambient.symbol === 'MU' && before.context_revision === 0, before);
    if (!delayScript) await page.waitForFunction(() => window.MMBrain?.mounted === true);
    const trigger = page.locator('button[aria-label="Mastermind AI"]:visible').first(); await trigger.waitFor();
    await trigger.click(); releaseScript();
    await page.locator('#mmb-panel.open').waitFor({ timeout: 15000 });
    check(label + ': entry remains on Analysis theses', page.url() === ORIGIN + report.route, page.url());
    check(label + ': one real widget and panel', await page.locator('#mmb-panel').count() === 1 && await page.evaluate(() => window.MMBrain?.mounted === true));
    check(label + ': native provider unchanged by entry', await page.evaluate(origin => window.MM_BRAIN_CFG.getAiContext().origin_id === origin && window.MM_BRAIN_CFG.getAiContext().context_revision === 0, before.origin_id));
    if (researchDelta && width === 1440) {
      // Native fixture principal boundary only; never a real account/token or auth proof.
      await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === '/api/brain/me'),
        page.evaluate(() => window.MMBrain.setPrincipal('synthetic-browser-fixture-only')),
      ]);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    const composer = page.locator('#mmb-ta'); await composer.waitFor({ state: 'visible', timeout: 15000 });
    if (researchDelta && width === 1440) {
      // One real-widget Research scenario: current version, then the historical version.
      await page.locator('#mmb-panel [data-act="close"]').click();
      await page.locator('button[aria-label$=" 1"]').click(); // close inspector -> current
      await page.waitForFunction(() => window.MM_BRAIN_CFG.getAiContext().ambient?.thesis_read?.version_id === '33333333-3333-4333-8333-333333333333');
      await trigger.click(); await page.locator('#mmb-panel.open').waitFor();
      await composer.fill('/');
      await page.locator('.mmb-slash-i[data-i="1"]').click();
      await composer.fill('Synthetic current-version research question; intercepted locally.');
      await page.locator('#mmb-send').click();
      await page.waitForFunction(() => document.querySelector('#mmb-scroll')?.textContent?.includes('Local navigation check'));
      await page.waitForFunction(() => !document.querySelector('#mmb-send').classList.contains('mmb-stop'));
      await composer.fill('Next synthetic question');
      check(label + ': Research current version emitted', turns.length === 1 && turns[0].mode === 'research' && turns[0].lane === 'pro' && turns[0].context?.ai_context?.ambient?.thesis_read?.version_id === '33333333-3333-4333-8333-333333333333', turns[0]);
      await page.locator('#mmb-panel [data-act="close"]').click();
      await page.locator('button[aria-label$=" 1"]').click();
      await page.waitForFunction(() => window.MM_BRAIN_CFG.getAiContext().ambient?.thesis_read?.version_id === '22222222-2222-4222-8222-222222222222');
      await trigger.click(); await page.locator('#mmb-panel.open').waitFor();
      await composer.fill('/'); await page.locator('.mmb-slash-i[data-i="1"]').click();
    }
    await composer.fill(lang === 'zh' ? '本地测试：解释当前论文工作区。' : 'Local test: explain this thesis workspace.');
    await page.locator('#mmb-send').click();
    await page.waitForFunction(() => document.querySelector('#mmb-scroll')?.textContent?.includes('Local navigation check') || document.querySelector('#mmb-scroll')?.textContent?.includes('本地导航验证'));
    check(label + ': expected intercepted local turn count', turns.length === (researchDelta && width === 1440 ? 2 : 1));
    const sent = turns[turns.length - 1].context;
    if (researchDelta && width === 1440) check(label + ': Research historical version emitted', turns[1].mode === 'research' && turns[1].lane === 'pro' && sent.ai_context?.ambient?.thesis_read?.version_id === '22222222-2222-4222-8222-222222222222', turns[1]);
    check(label + ': real widget sends selected immutable historical version', sent.ai_context?.ambient?.thesis_read?.thesis_id === '11111111-1111-4111-8111-111111111111' && sent.ai_context?.ambient?.thesis_read?.version_id === '22222222-2222-4222-8222-222222222222', sent);
    check(label + ': actual served widget serializes thesis context', sent.page === 'analysis' && sent.panel === 'theses' && sent.ai_context?.ambient?.page === 'analysis' && sent.ai_context?.ambient?.panel === 'theses' && sent.ai_context?.ambient?.symbol === 'MU' && sent.ai_context?.origin_id === before.origin_id, sent);
    const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: document.querySelector('#mmb-panel').getBoundingClientRect().width, viewport: innerWidth }));
    check(label + ': panel fits viewport', overflow.document <= 1 && overflow.panel <= overflow.viewport + 1, overflow);
    await page.waitForFunction(() => {
      const p = document.querySelector('#mmb-panel'); if (!p) return false;
      const s = getComputedStyle(p);
      return s.opacity === '1' && s.transform === 'none' && p.getAnimations().every(a => a.playState === 'finished' || a.playState === 'idle');
    });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    check(label + ': panel settled before screenshot', await page.evaluate(() => getComputedStyle(document.querySelector('#mmb-panel')).opacity === '1'));
    const file = researchDelta && width === 1440 ? 'research-1440-en.png' : label + '.png'; await page.screenshot({ path: path.join(OUT, file) }); const bytes = fs.readFileSync(path.join(OUT, file)); report.screenshots.push({ file, bytes: bytes.length, sha256: hash(bytes), width, lang });
    await page.locator('#mmb-panel [data-act="close"]').click(); await page.waitForFunction(() => !document.querySelector('#mmb-panel')?.classList.contains('open'));
    check(label + ': close keeps typed route', page.url() === ORIGIN + report.route);
    const cleared = await page.evaluate(() => { history.pushState(null, '', '/analysis?view=theses&symbol=MU'); return window.MM_BRAIN_CFG.getAiContext().ambient.thesis_read === undefined; });
    check(label + ': URL selection removal clears next turn synchronously', cleared);
    await context.close();
  }
  check('zero browser page exceptions', report.pageErrors.length === 0, report.pageErrors); report.passed = true;
})().catch(error => { report.passed = false; report.failure = error.stack; process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} } report.ownPreviewStopped = true;
  fs.writeFileSync(path.join(OUT, researchDelta ? 'research-delta-browser-report.json' : 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, screenshots: report.screenshots.length, pageErrors: report.pageErrors, failure: report.failure }));
});
