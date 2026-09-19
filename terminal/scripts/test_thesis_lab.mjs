import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {handleThesisLab, LAB_SCHEMA} from '../lib/thesisLabTransport.mjs';
import {ThesisLabClient, contentFromForm, subjectFromSymbol, planPrompts} from '../public/trading-lab/client.mjs';
const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID='cccccccc-cccc-4ccc-8ccc-cccccccccccc', REQ='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const URL='https://app.mastermind-x.com/api/theses/lab', ORIGIN='https://bot.mastermind-x.com';
const CONTENT=contentFromForm({title:'An independent case',statement:'Demand may recover. Enter only after confirmation.',horizon:'weeks',falsifiers:'Orders fall',risks:'Pricing fails',catalysts:'Earnings',revisionNote:''});
const SUBJECT=subjectFromSymbol('ABC');
const BODY={action:'create',id:null,expectedVersion:0,clientRequestId:REQ,subject:SUBJECT,content:CONTENT};
function req(method='GET',query='',body=undefined,headers={}) {
  return new Request(URL+query,{method,headers:{Origin:ORIGIN,'X-Mastermind-User':USER,...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
function session(overrides={}) {return {userId:USER,list:async()=>({ok:true,theses:[],truncated:false}),read:async()=>({ok:false,status:'not_found'}),receipt:async()=>({ok:true,receipt:null}),apply:async()=>({ok:true,status:'created',thesisId:ID,version:1,lifecycleState:'active',replayed:false}),...overrides};}
async function run(r,s=session()){const response=await handleThesisLab(r,async()=>s);return {response,body:response.status===204?null:await response.json()};}
function storage(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),map:m};}
function memoryOwner(){
  const versions=new Map(),receipts=new Map();let applies=0;
  const s=session({
    list:async()=>({ok:true,theses:[...versions.values()].map(t=>({id:t.id,currentVersion:t.currentVersion,subject:t.subject,title:t.current.content.title,lifecycleState:'active',updatedAt:t.current.systemRecordedAt})),truncated:false}),
    read:async id=>versions.has(id)?{ok:true,thesis:structuredClone(versions.get(id))}:{ok:false,status:'not_found'},
    receipt:async id=>({ok:true,receipt:receipts.has(id)?{thesisId:ID,version:receipts.get(id).result.version,clientRequestId:id}:null}),
    apply:async b=>{
      applies++;const existing=receipts.get(b.clientRequestId);
      if(existing)return JSON.stringify(existing.body)===JSON.stringify(b)?{...existing.result,status:'replayed',replayed:true}:{ok:false,status:'idempotency_conflict'};
      const old=versions.get(ID);if(b.action==='revise'&&old?.currentVersion!==b.expectedVersion)return {ok:false,status:'version_conflict',currentVersion:old?.currentVersion||0};
      const version={version:b.expectedVersion+1,clientRequestId:b.clientRequestId,subject:b.subject,content:b.content,systemRecordedAt:'2026-09-12T12:00:00.000Z',transition:b.action};
      versions.set(ID,{id:ID,currentVersion:version.version,lifecycleState:'active',subject:b.subject,current:version,history:[version,...(old?.history||[])],historyTruncated:false});
      const result={ok:true,status:b.action==='create'?'created':'advanced',thesisId:ID,version:version.version,lifecycleState:'active',replayed:false};receipts.set(b.clientRequestId,{body:structuredClone(b),result});return result;
    },
  });
  return {session:s,versions,receipts,get applies(){return applies;}};
}
function bridge(s){return async (url,opt={})=>handleThesisLab(new Request(url,{...opt,headers:{Origin:ORIGIN,...opt.headers}}),async()=>s);}
function clientFor(owner, extras={}){return new ThesisLabClient({fetchImpl:bridge(owner.session),storage:storage(),uuid:()=>REQ,...extras});}

describe('first-party transport',()=>{
  test('preflight is authenticated-cookie compatible but invokes no identity or database',async()=>{let calls=0;const r=await handleThesisLab(req('OPTIONS','',undefined,{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-mastermind-user'}),async()=>{calls++;throw Error();});assert.equal(r.status,204);assert.equal(calls,0);assert.equal(r.headers.get('Access-Control-Allow-Origin'),ORIGIN);assert.equal(r.headers.get('Access-Control-Allow-Credentials'),'true');});
  for(const origin of ['null','https://bot.mastermind-x.com.evil.test','http://bot.mastermind-x.com','https://other.mastermind-x.com','https://evil.test'])
    test('rejects origin '+origin,async()=>{const {response}=await run(req('POST','',BODY,{Origin:origin}));assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);});
  test('rejects unknown preflight header',async()=>assert.equal((await run(req('OPTIONS','',undefined,{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'X-Admin'}))).response.status,403));
  test('rejects preflight PUT',async()=>assert.equal((await run(req('OPTIONS','',undefined,{'Access-Control-Request-Method':'PUT'}))).response.status,403));
  test('rejects no-Origin POST',async()=>assert.equal((await run(new Request(URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(BODY)}))).response.status,403));
  test('rejects form/text POST before session',async()=>{let called=false;const r=await handleThesisLab(req('POST','',BODY,{'Content-Type':'text/plain'}),async()=>{called=true;return session();});assert.equal(r.status,415);assert.equal(called,false);});
  test('private no-store also on authentication failures',async()=>{const {response,body}=await run(req(),null);assert.equal(response.status,401);assert.match(response.headers.get('Cache-Control'),/private, no-store/);assert.equal(response.headers.get('Vary'),'Origin, Cookie');assert.equal(body.effectUnknown,false);});
  test('session lookup distinguishes unavailable from signed out',async()=>{const r=await handleThesisLab(req('GET','?view=session'),async()=>{throw Error('private');});assert.equal(r.status,503);assert.equal((await r.json()).error,'identity_unavailable');});
  test('returns principal only for session lookup',async()=>{const {body}=await run(req('GET','?view=session'));assert.deepEqual(body,{schema:LAB_SCHEMA,userId:USER});});
  test('requires principal binding on list',async()=>{const r=new Request(URL,{headers:{Origin:ORIGIN}});assert.equal((await run(r)).response.status,400);});
  test('account switch refuses before owner effect',async()=>{let n=0;const {response}=await run(req('POST','',BODY,{'X-Mastermind-User':OTHER}),session({apply:async()=>{n++;}}));assert.equal(response.status,409);assert.equal(n,0);});
  for(const query of ['?id='+ID+'&id='+ID,'?view=session&requestId='+REQ,'?role=admin','?view=all'])
    test('refuses ambiguous/unknown query '+query,async()=>assert.equal((await run(req('GET',query))).response.status,400));
  test('lookup null is not an unavailable store',async()=>{const {body}=await run(req('GET','?requestId='+REQ));assert.equal(body.receipt,null);});
  test('receipt read validates returned identity',async()=>assert.equal((await run(req('GET','?requestId='+REQ),session({receipt:async()=>({ok:true,receipt:{thesisId:ID,version:1,clientRequestId:OTHER}})}))).response.status,503));
  test('unavailable list never becomes empty',async()=>{const {response,body}=await run(req(),session({list:async()=>({ok:false})}));assert.equal(response.status,503);assert.equal(body.theses,undefined);});
  for(const patch of [{expectedVersion:true},{expectedVersion:1},{action:'archive'},{id:ID},{clientRequestId:'bad'},{userId:OTHER},{action:'revise',id:ID,expectedVersion:0}])
    test('invalid mutation envelope '+JSON.stringify(patch),async()=>{let n=0;const r=await run(req('POST','',{...BODY,...patch}),session({apply:async()=>{n++;}}));assert.equal(r.response.status,400);assert.equal(n,0);});
  test('streams a body bound before mutation',async()=>{let n=0,cancelled=false;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(70000));},cancel(){cancelled=true;}});const r=new Request(URL,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','X-Mastermind-User':USER},body:stream,duplex:'half'});const out=await handleThesisLab(r,async()=>session({apply:async()=>{n++;}}));assert.equal(out.status,413);assert.equal(n,0);assert.equal(cancelled,true);});
  test('invalid JSON is a known no-effect refusal',async()=>{const r=new Request(URL,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','X-Mastermind-User':USER},body:'{'});const {response,body}=await run(r);assert.equal(response.status,400);assert.equal(body.effectUnknown,false);});
  test('unknown mutation failure is explicitly effect-unknown',async()=>{const {response,body}=await run(req('POST','',BODY),session({apply:async()=>{throw Error('private');}}));assert.equal(response.status,503);assert.equal(body.effectUnknown,true);assert.ok(!JSON.stringify(body).includes('private'));});
  test('canonical version conflict is a no-effect refusal',async()=>{const {response,body}=await run(req('POST','',BODY),session({apply:async()=>({ok:false,status:'version_conflict',currentVersion:4})}));assert.equal(response.status,409);assert.equal(body.currentVersion,4);assert.equal(body.effectUnknown,false);});
  test('malformed success receipt cannot report success',async()=>assert.equal((await run(req('POST','',BODY),session({apply:async()=>({ok:true,status:'created',thesisId:ID,version:90,replayed:false})}))).response.status,503));
  test('successful save explicitly excludes trading authority',async()=>{const {response,body}=await run(req('POST','',BODY));assert.equal(response.status,201);assert.equal(body.executionAuthority,false);assert.equal(body.orderSubmitted,false);});
});
describe('client recovery and decision integrity',()=>{
  test('refuses a write before verified sign-in',async()=>{let calls=0;const c=new ThesisLabClient({fetchImpl:async()=>{calls++;}});await assert.rejects(c.save({subject:SUBJECT,content:CONTENT}),{code:'unauthenticated'});assert.equal(calls,0);});
  test('save/read/revise runs through the transport',async()=>{const o=memoryOwner(),c=clientFor(o);await c.connect();const r=await c.save({subject:SUBJECT,content:CONTENT});assert.equal(r.version,1);const t=await c.read(ID);c.uuid=()=>OTHER;const r2=await c.save({subject:t.subject,content:{...CONTENT,statement:'New evidence, not a new story after a loss.'},thesis:t});assert.equal(r2.version,2);assert.equal((await c.read(ID)).history[1].content.statement,CONTENT.statement);});
  test('storage failure occurs before an owner mutation',async()=>{const o=memoryOwner(),c=clientFor(o,{storage:{getItem:()=>null,setItem:()=>{throw Error();}}});await c.connect();await assert.rejects(c.save({subject:SUBJECT,content:CONTENT}),{code:'recovery_storage_required'});assert.equal(o.applies,0);});
  test('lost committed response reconciles without a second write after reload',async()=>{const o=memoryOwner(),st=storage();const normal=bridge(o.session);const c=clientFor(o,{storage:st,fetchImpl:async(u,opt)=>{const r=await normal(u,opt);if(opt.method==='POST')throw Error('response lost');return r;}});await c.connect();await assert.rejects(c.save({subject:SUBJECT,content:CONTENT}));assert.equal(c.state,'outcome_unknown');assert.equal(o.applies,1);const next=clientFor(o,{storage:st});await next.connect();const proof=await next.reconcile();assert.equal(proof.recorded,true);assert.equal(o.applies,1);assert.equal(next.pending,null);});
  test('unrecorded timeout requires explicit exact-identity retry',async()=>{const o=memoryOwner(),normal=bridge(o.session);let drop=true;const c=clientFor(o,{fetchImpl:async(u,opt)=>{if(opt.method==='POST'&&drop)throw Error();return normal(u,opt);}});await c.connect();await assert.rejects(c.save({subject:SUBJECT,content:CONTENT}));await assert.rejects(c.retryUnrecorded(),{code:'reconcile_first'});assert.equal((await c.reconcile()).recorded,false);assert.equal(o.applies,0);drop=false;await c.retryUnrecorded();assert.ok(o.receipts.has(REQ));assert.equal(o.applies,1);});
  test('an unresolved save cannot become a second create',async()=>{const o=memoryOwner(),normal=bridge(o.session);const c=clientFor(o,{fetchImpl:async(u,opt)=>opt.method==='POST'?Promise.reject(Error()):normal(u,opt)});await c.connect();await assert.rejects(c.save({subject:SUBJECT,content:CONTENT}));await assert.rejects(c.save({subject:SUBJECT,content:CONTENT}),{code:'unresolved_save'});});
  test('concurrent click is rejected',async()=>{const o=memoryOwner(),normal=bridge(o.session);let release;const c=clientFor(o,{fetchImpl:async(u,opt)=>{if(opt.method==='POST')await new Promise(r=>release=r);return normal(u,opt);}});await c.connect();const first=c.save({subject:SUBJECT,content:CONTENT});await assert.rejects(c.save({subject:SUBJECT,content:CONTENT}),{code:'request_in_progress'});release();await first;assert.equal(o.applies,1);});
  test('stale version stays a conflict without an automatic retry',async()=>{const o=memoryOwner(),c=clientFor(o);await c.connect();await c.save({subject:SUBJECT,content:CONTENT});const t=await c.read(ID);o.versions.get(ID).currentVersion=2;c.uuid=()=>OTHER;await assert.rejects(c.save({subject:SUBJECT,content:CONTENT,thesis:t}),{code:'version_conflict'});assert.equal(c.state,'conflict');assert.equal(c.pending,null);assert.equal(o.applies,2);});
  test('receipt content mismatch remains unresolved',async()=>{const o=memoryOwner(),normal=bridge(o.session),c=clientFor(o,{fetchImpl:async(u,opt)=>{const r=await normal(u,opt);if(opt.method==='POST')throw Error();return r;}});await c.connect();await assert.rejects(c.save({subject:SUBJECT,content:CONTENT}));o.versions.get(ID).history[0].content={...CONTENT,title:'Different'};await assert.rejects(c.reconcile(),{code:'receipt_content_unverified'});assert.equal(c.state,'outcome_unknown');assert.ok(c.pending);});
  test('account mismatch clears in-memory private state and performs no write',async()=>{const o=memoryOwner(),c=clientFor(o);await c.connect();o.session.userId=OTHER;await assert.rejects(c.save({subject:SUBJECT,content:CONTENT}),{code:'account_changed'});assert.equal(c.userId,null);assert.equal(c.pending,null);assert.equal(o.applies,0);});
  test('completion checklist does not emit approval or probability',()=>{const p=planPrompts(CONTENT);assert.ok(p.every(x=>x.done));assert.ok(!/probability|approved|confidence|score/i.test(JSON.stringify(p)));});
  test('new symbol notes never pretend to resolve the issuer',()=>{const s=subjectFromSymbol('brk.b');assert.equal(s.key,'BRK.B');assert.equal(s.identityState,'listing_scoped');assert.equal(s.companyId,null);});
  for(const x of ['../AAPL','AAPL?user=other','<script>','A'.repeat(25)])test('invalid subject '+x,()=>assert.throws(()=>subjectFromSymbol(x),{code:'invalid_symbol'}));
  test('existing effective date is preserved; a browser edit does not backdate the original',()=>assert.equal(contentFromForm({...CONTENT,catalysts:'',risks:'',falsifiers:'',effectiveAt:'2000-01-01'}, {effectiveAt:'2026-09-01T00:00:00.000Z'}).effectiveAt,'2026-09-01T00:00:00.000Z'));
});

// Additional response ordering and storage-availability discriminators.
test('late decoded response from an older account epoch is discarded',async()=>{
  const o=memoryOwner(),c=clientFor(o);await c.connect();let release;
  c.fetchImpl=async()=>({ok:true,json:()=>new Promise(r=>{release=r;})});
  const read=c.list();await new Promise(r=>setImmediate(r));c.epoch++;
  release({schema:LAB_SCHEMA,userId:USER,theses:[],truncated:false});
  await assert.rejects(read,{code:'superseded_response'});
});
test('unavailable tab storage permits reads but never dispatches a save',async()=>{
  const o=memoryOwner(),c=clientFor(o,{storage:null});await c.connect();
  assert.deepEqual((await c.list()).theses,[]);
  await assert.rejects(c.save({subject:SUBJECT,content:CONTENT}),{code:'recovery_storage_required'});assert.equal(o.applies,0);
});
test('a substituted version in a successful reply remains unresolved',async()=>{
  const o=memoryOwner(),normal=bridge(o.session),c=clientFor(o,{fetchImpl:async(u,opt)=>{
    const r=await normal(u,opt);if(opt.method!=='POST')return r;const b=await r.json();return new Response(JSON.stringify({...b,version:99}),{status:r.status});
  }});await c.connect();await assert.rejects(c.save({subject:SUBJECT,content:CONTENT}),{code:'invalid_response'});
  assert.equal(c.state,'outcome_unknown');assert.ok(c.pending);assert.equal(o.applies,1);
});
