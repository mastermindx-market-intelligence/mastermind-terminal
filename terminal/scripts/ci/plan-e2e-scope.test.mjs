import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectScope, focusedPath, validPR, plan } from './plan-e2e-scope.mjs';

const p=(path,status='M')=>({path,status});
const ctx={eventName:'pull_request',verified:true};
test('only preapproved modified Screener paths select focused mode',()=>{
  for(const x of ['terminal/components/ScreenerView.tsx','terminal/components/screener/SmartScreensPanel.tsx','terminal/components/screener/TechnicalScreenBar.module.css','terminal/e2e/screener-cross-market.spec.ts','terminal/e2e/smart-screens.spec.ts']) {
    assert.ok(focusedPath(x)); assert.equal(selectScope([p(x)],ctx),'screener');
  }
  assert.equal(selectScope([p('terminal/components/ScreenerView.tsx'),p('terminal/e2e/smart-screens.spec.ts')],ctx),'screener');
});
test('global, auth, docs, workflow and mixed paths fail closed',()=>{
  for(const x of ['terminal/app/globals.css','terminal/lib/i18n.tsx','.github/workflows/ci.yml','AGENTS.md','terminal/components/MobileNav.tsx','terminal/components/screener/index.css','terminal/lib/smartScreen/client.ts'])
    assert.equal(selectScope([p(x)],ctx),'full');
  assert.equal(selectScope([p('terminal/components/ScreenerView.tsx'),p('terminal/app/globals.css')],ctx),'full');
});
test('invalid diff and non-pr always full',()=>{
  assert.equal(selectScope([],ctx),'full');
  for(const status of ['A','D','R100','T'])assert.equal(selectScope([p('terminal/components/ScreenerView.tsx',status)],ctx),'full');
  assert.equal(selectScope([p('terminal/components/ScreenerView.tsx'),p('terminal/components/ScreenerView.tsx')],ctx),'full');
  assert.equal(selectScope([p('terminal/components/ScreenerView.tsx')],{eventName:'merge_group',verified:true}),'full');
  assert.equal(selectScope([p('../terminal/components/ScreenerView.tsx')],ctx),'full');
  assert.equal(plan({GITHUB_EVENT_NAME:'merge_group'}),'full');
  assert.equal(plan({GITHUB_EVENT_NAME:'pull_request'},()=>{throw Error('bad')}),'full');
});
test('exact two-parent PR merge identity',()=>{
  const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40);
  const payload={number:7,pull_request:{number:7,head:{sha:c},base:{sha:b}}};
  const good={eventName:'pull_request',ref:'refs/pull/7/merge',sha:a,payload};
  assert.equal(validPR(good,[a,b,c]),true);
  assert.equal(validPR({...good,sha:b},[a,b,c]),false);
  assert.equal(validPR(good,[a,b]),false);
});
