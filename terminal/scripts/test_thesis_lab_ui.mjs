import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInContext} from 'node:vm';
import {buildSync} from 'esbuild';
import {JSDOM} from 'jsdom';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SCHEMA='mastermind.thesis-lab/v1';
const html=readFileSync(new URL('../public/trading-lab/index.html',import.meta.url),'utf8');
const bundle=buildSync({
  entryPoints:[fileURLToPath(new URL('../public/trading-lab/ui.mjs',import.meta.url))],
  bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',logLevel:'silent',
}).outputFiles[0].text;

function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function response(body,status=200) {
  return {ok:status>=200&&status<300,status,json:async()=>({schema:SCHEMA,userId:USER,...body})};
}
function createUI(t) {
  // No resources are loaded and every client request ends in this fixture.
  const dom=new JSDOM(html,{url:'https://bot.mastermind-x.com/trading-lab/',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const {window}=dom;
  const reads=[async()=>{throw new Error('initial detail read unavailable');}];
  const requests=[];
  let saved;
  window.confirm=()=>true;
  Object.defineProperty(window.crypto,'randomUUID',{value:()=>REQUEST});
  window.fetch=async(url,options={})=>{
    assert.equal(new URL(url).origin,'https://app.mastermind-x.com');
    assert.equal(new URL(url).pathname,'/api/theses/lab');
    requests.push({url,options});
    const query=new URL(url).searchParams;
    if(query.get('view')==='session')return response({});
    assert.equal(options.headers['X-Mastermind-User'],USER);
    if(options.method==='POST') {
      const body=JSON.parse(options.body);
      const version={version:1,transition:'create',content:body.content,subject:body.subject,
        clientRequestId:body.clientRequestId,systemRecordedAt:'2026-09-12T22:18:05Z'};
      saved={id:ID,subject:body.subject,currentVersion:1,lifecycleState:'active',
        current:version,history:[version],historyTruncated:false};
      return response({thesisId:ID,version:1,replayed:false,clientRequestId:body.clientRequestId,
        executionAuthority:false,orderSubmitted:false},201);
    }
    assert.equal(query.get('id'),ID);
    const read=reads.shift();
    assert.ok(read,'unexpected detail request');
    return read();
  };
  runInContext(bundle,dom.getInternalVMContext());
  const el=id=>window.document.getElementById(id);
  const press=id=>{
    assert.equal(el(id).disabled,false,`${id} should be enabled`);
    return el(id).onclick(new window.MouseEvent('click'));
  };
  const input=(id,value)=>{
    assert.equal(el(id).disabled,false,`${id} should be editable`);
    el(id).value=value;
    el(id).dispatchEvent(new window.Event('input',{bubbles:true}));
  };
  return {window,el,press,input,reads,requests,get saved(){return saved;}};
}
async function savedButUnread(t) {
  const ui=createUI(t);
  await ui.press('connect');
  ui.input('symbol','AAPL');ui.input('title','Original saved plan');
  ui.input('statement','Independent original reasoning.');ui.input('horizon','weeks');
  await ui.el('plan-form').onsubmit(new ui.window.Event('submit',{cancelable:true}));
  assert.equal(ui.el('reload-saved').hidden,false);
  assert.equal(ui.el('save').disabled,true);
  assert.match(ui.el('notice').textContent,/Version 1 was saved, but/);
  assert.equal(ui.requests.filter(r=>r.options.method==='POST').length,1);
  return ui;
}
function startReload(ui) {
  const pending=deferred();
  ui.reads.push(()=>pending.promise);
  return {...pending,done:ui.press('reload-saved')};
}
function newDraft(ui) {
  ui.press('new');ui.input('symbol','MSFT');ui.input('title','New unsaved plan');
  ui.input('statement','Keep this new independent reasoning.');
}
function assertNewDraft(ui) {
  assert.equal(ui.el('symbol').value,'MSFT');
  assert.equal(ui.el('title').value,'New unsaved plan');
  assert.equal(ui.el('statement').value,'Keep this new independent reasoning.');
  assert.equal(ui.el('plan-kicker').textContent,'New plan');
  assert.equal(ui.el('history-card').hidden,true);
  assert.equal(ui.el('history').children.length,0);
  assert.equal(ui.el('revision-field').hidden,true);
  assert.equal(ui.el('save-state').textContent,'Unsaved changes');
  assert.equal(ui.el('save').disabled,false);
  assert.equal(ui.el('reload-saved').hidden,true);
  assert.notEqual(ui.el('notice').textContent,'Saved plan reloaded. You may revise it now.');
  assert.equal(ui.window.dispatchEvent(new ui.window.Event('beforeunload',{cancelable:true})),false);
  assert.equal(ui.requests.filter(r=>r.options.method==='POST').length,1);
}

test('current saved-plan reload renders the saved version and clears unread state',async t=>{
  const ui=await savedButUnread(t),reload=startReload(ui);
  reload.resolve(response({thesis:ui.saved}));await reload.done;
  assert.equal(ui.el('title').value,'Original saved plan');
  assert.equal(ui.el('save-state').textContent,'Showing version 1');
  assert.equal(ui.el('history-card').hidden,false);
  assert.equal(ui.el('history').children.length,1);
  assert.equal(ui.el('reload-saved').hidden,true);
  assert.equal(ui.el('notice').textContent,'Saved plan reloaded. You may revise it now.');
  assert.equal(ui.requests.filter(r=>r.options.method==='POST').length,1);
});

test('late reload success cannot replace a new unsaved plan',async t=>{
  const ui=await savedButUnread(t),reload=startReload(ui);
  newDraft(ui);reload.resolve(response({thesis:ui.saved}));await reload.done;
  assertNewDraft(ui);
});

test('editing during reload preserves the edited draft and dirty state',async t=>{
  const ui=await savedButUnread(t),reload=startReload(ui);
  ui.input('title','Edited while loading');ui.input('statement','Keep this revision draft.');
  reload.resolve(response({thesis:ui.saved}));await reload.done;
  assert.equal(ui.el('title').value,'Edited while loading');
  assert.equal(ui.el('statement').value,'Keep this revision draft.');
  assert.equal(ui.el('save-state').textContent,'Unsaved changes');
  assert.equal(ui.el('history-card').hidden,true);
  assert.equal(ui.el('reload-saved').hidden,false);
});

test('an older reload cannot replace a newer completed reload',async t=>{
  const ui=await savedButUnread(t),older=startReload(ui),newer=startReload(ui);
  const latest=structuredClone(ui.saved);
  latest.currentVersion=2;latest.current.version=2;latest.current.content.title='Latest saved revision';
  newer.resolve(response({thesis:latest}));await newer.done;
  older.resolve(response({thesis:ui.saved}));await older.done;
  assert.equal(ui.el('title').value,'Latest saved revision');
  assert.equal(ui.el('save-state').textContent,'Showing version 2');
});

test('a late transport failure retains the new draft and existing error presentation',async t=>{
  const ui=await savedButUnread(t),reload=startReload(ui);
  newDraft(ui);reload.reject(new Error('read connection lost'));await reload.done;
  assertNewDraft(ui);
  assert.match(ui.el('notice').textContent,/connection did not return a trustworthy result/);
});

for(const [error,status] of [['account_changed',409],['unauthenticated',401]]) {
  test(`current ${error} still clears private UI after a draft-generation change`,async t=>{
    const ui=await savedButUnread(t),reload=startReload(ui);
    newDraft(ui);reload.resolve(response({error},status));await reload.done;
    assert.equal(ui.el('connection').textContent,'Not connected');
    assert.equal(ui.el('title').value,'');assert.equal(ui.el('statement').value,'');
    assert.equal(ui.el('history-card').hidden,true);
    assert.equal(ui.el('history').children.length,0);
    assert.equal(ui.el('save').disabled,true);
    assert.equal(ui.el('signin').hidden,false);
    assert.match(ui.el('notice').textContent,error==='account_changed'?/account changed/:/Sign in to Mastermind/);
    assert.equal(ui.requests.filter(r=>r.options.method==='POST').length,1);
  });
}
