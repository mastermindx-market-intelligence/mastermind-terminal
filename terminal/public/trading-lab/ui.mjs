import {ThesisLabClient, contentFromForm, subjectFromSymbol, planPrompts, LabError} from './client.mjs';
const client = new ThesisLabClient();
const $ = id => document.getElementById(id);
let current = null, latestConflict = null, dirty = false, readGeneration = 0, savedUnread = null;
const fields = ['symbol','title','statement','horizon','falsifiers','risks','catalysts','revisionNote'];
const errors = {
  unauthenticated:'Sign in to Mastermind, then select Connect notebook.',
  identity_unavailable:'The sign-in service could not verify your account. Nothing was submitted. Try Connect again.',
  account_changed:'The signed-in account changed. This view was cleared. Reconnect before continuing.',
  connection_uncertain:'The connection did not return a trustworthy result. Your draft is still here.',
  invalid_response:'The service returned an unexpected response. Do not submit another save until the original is checked.',
  version_conflict:'Someone saved a newer version of this plan. Compare it with your draft before revising.',
  unresolved_save:'Check the unresolved save before starting another mutation.',
  recovery_storage_required:'This browser cannot retain a recovery record. Export your draft; enable session storage before saving.',
  recovery_unavailable:'The recovery record cannot be read safely. Do not create a duplicate. Keep this tab and inspect the existing notebook in Terminal.',
  receipt_content_unverified:'A saved request was found, but its exact content could not be verified in the returned history. Do not retry. Keep the request ID for investigation.',
  thesis_store_unavailable:'The private notebook is unavailable. Your draft is retained; no success is being assumed.',
  title_required:'Add a single-line title of up to 160 characters.',
  statement_required:'Write your reasoning, using up to 12,000 characters.',
  invalid_symbol:'Use a valid symbol, such as AAPL, BRK.B or ^NDX.',
  list_too_long:'Use at most 20 lines per evidence field, each up to 500 characters.',
  revision_note_too_long:'Keep the revision note within 1,000 characters.',
  invalid_transition:'This plan is archived or invalidated. Reopen it in Terminal before revising.',
};
function notice(text) { $('notice').textContent=text; $('notice').hidden=!text; }
function form() { return Object.fromEntries(fields.map(k=>[k,$(k).value])); }
function show(view) {
  for(const v of ['today','plan','library','learn']) $('view-'+v).hidden = v!==view;
  for(const b of document.querySelectorAll('[data-view]')) { if(b.dataset.view===view)b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); }
  if(view==='library'&&client.userId) loadList();
}
function editable() { return Boolean(client.userId)&&!client.busy&&!client.pending&&!['recovery_unavailable','conflict'].includes(client.state)&&!savedUnread; }
function renderStatus() {
  $('connection').textContent = client.userId ? 'Private notebook connected' : 'Not connected';
  $('save').disabled = !editable() || (current&&current.lifecycleState!=='active');
  $('new').disabled = Boolean(client.pending)||client.busy;
  for(const k of fields) $(k).disabled = Boolean(client.pending)||client.busy||(k==='symbol'&&Boolean(current));
  $('connect').hidden = Boolean(client.userId);
  $('start-plan').hidden = !client.userId;
  $('signin').hidden = !['unauthenticated','account_changed'].includes(client.state);
  $('recovery').hidden = !client.pending;
  $('reconcile').disabled=client.busy; $('retry').hidden=client.state!=='not_recorded';
  $('recovery-id').textContent=client.pending?`Request ${client.pending.body.clientRequestId}`:'';
  if(client.userId) { $('next-title').textContent=client.pending?'Resolve your last save.':'Record your independent view.'; $('next-text').textContent=client.pending?'The original request is retained. Check it before sending anything else.':'Start with a testable idea. You can return to every saved version later.'; }
  $('save-state').textContent = client.busy?'Saving...':client.pending?'Save not yet reconciled':client.state==='conflict'?'Newer version needs review':dirty?'Unsaved changes':current?`Showing version ${current.currentVersion}`:client.userId?'Ready for your draft':'Connect to save.';
  $('save').textContent = current?'Save new version':'Save my plan'; $('reload-saved').hidden=!savedUnread;
}
function prompts() {
  const f=form(); const content={statement:f.statement,horizon:f.horizon,falsifiers:f.falsifiers.trim()?[f.falsifiers]:[],risks:f.risks.trim()?[f.risks]:[]};
  $('prompt-list').replaceChildren(...planPrompts(content).map(p=>{const d=document.createElement('div');d.className='prompt'+(p.done?' done':''); const s=document.createElement('span');s.className='tick';s.textContent=p.done?'Recorded':'Open';const t=document.createElement('span');t.textContent=p.label;d.append(s,t);return d;}));
}
function clearView() {
  current=null; latestConflict=null; savedUnread=null; dirty=false; readGeneration++;
  $('plan-form').reset();$('library').replaceChildren();$('history').replaceChildren();$('history-card').hidden=true;$('conflict').hidden=true;
  $('library-state').hidden=false;$('library-state').textContent='Reconnect to load your plans.';
  for(const id of ['local-conflict','remote-conflict','version-title','version-time','version-body'])$(id).textContent='';
  if($('version-dialog').open)$('version-dialog').close();
  $('identity-hint').textContent='A symbol-scoped note, not a verified issuer identity.';
  $('library-limit').textContent='';$('plan-kicker').textContent='New plan';$('revision-field').hidden=true;
  prompts();renderStatus();
}
function formatContent(c) { return [c.title,'Horizon: '+c.horizon,c.statement,'FALSIFIERS',...c.falsifiers,'COUNTER-CASE',...c.risks,'CATALYSTS',...c.catalysts,'REVISION NOTE',c.revisionNote||'None'].join('\n\n'); }
function handleError(e) {
  if(e.code==='superseded_response')return;
  if(!client.userId&&['account_changed','unauthenticated'].includes(client.state))clearView();
  notice(errors[e.code]||'The request could not complete. Keep your draft and try a read-only refresh.');renderStatus();
  if(client.pending)show('plan');
}
function fill(thesis) {
  current=thesis;savedUnread=null;dirty=false;latestConflict=null;$('conflict').hidden=true;
  const c=thesis.current.content;
  $('symbol').value=thesis.subject.listing?.symbol||thesis.subject.key;
  for(const k of ['title','statement','horizon'])$(k).value=c[k];
  for(const k of ['falsifiers','risks','catalysts'])$(k).value=c[k].join('\n');
  $('revisionNote').value='';$('revision-field').hidden=false;
  $('plan-kicker').textContent=`${thesis.subject.display} / version ${thesis.currentVersion} / ${thesis.lifecycleState}`;
  $('identity-hint').textContent=thesis.subject.identityState==='resolved'?'Uses the existing resolved subject identity.':'Symbol-scoped note; no resolved issuer identity is claimed.';
  $('history-card').hidden=false;
  $('history').replaceChildren(...[...thesis.history].sort((a,b)=>b.version-a.version).slice(0,12).map(v=>{const b=document.createElement('button');b.type='button';b.className='history-entry';b.textContent=`Version ${v.version} / ${v.transition}`;const s=document.createElement('small');s.textContent=new Date(v.systemRecordedAt).toLocaleString();b.append(s);b.onclick=()=>{
    $('version-title').textContent=`Version ${v.version}: ${v.content.title}`;$('version-time').textContent=`Recorded ${new Date(v.systemRecordedAt).toLocaleString()}`;
    $('version-body').textContent=[v.content.statement, '\nFALSIFIERS\n'+v.content.falsifiers.join('\n'), '\nCOUNTER-CASE\n'+v.content.risks.join('\n'), '\nCATALYSTS\n'+v.content.catalysts.join('\n'), '\nREVISION NOTE\n'+(v.content.revisionNote||'None recorded')].join('\n');$('version-dialog').showModal();
  };return b;}));
  $('history-limit').textContent=thesis.historyTruncated?'History is truncated by the owner. This is not the complete history.':thesis.history.length>12?`Showing the latest 12 of ${thesis.history.length} versions returned. Full history remains in Terminal.`:'Original versions are preserved; changes append a new version.';
  prompts();renderStatus();show('plan');
}
async function openPlan(id) {
  if(client.pending||client.busy)return notice('Resolve the pending save before opening another plan.');
  if(dirty&&!confirm('Discard this unsaved draft and open the saved plan?'))return;
  const g=++readGeneration;
  try {const t=await client.read(id);if(g===readGeneration) {fill(t);notice('');}}catch(e){handleError(e);}
}
async function loadList() {
  const g=++readGeneration;$('library-state').hidden=false;$('library-state').textContent='Loading your private plans...';
  try {
    const b=await client.list(); if(g!==readGeneration)return;
    $('library-state').textContent=b.theses.length?'':'No saved plans yet. Start with one idea, in your own words.';$('library-state').hidden=Boolean(b.theses.length);
    $('library-limit').textContent=b.truncated?'Showing the latest 200 plans. This is not your complete notebook.':'';
    $('library').replaceChildren(...b.theses.map(t=>{const a=document.createElement('article');a.className='card plan-card';const label=document.createElement('span');label.className='chip';label.textContent=`${t.subject.display} / ${t.lifecycleState}`;const title=document.createElement('h2');title.className='title';title.textContent=t.title;const p=document.createElement('p');p.textContent=`Version ${t.currentVersion} / updated ${new Date(t.updatedAt).toLocaleDateString()}`;const b=document.createElement('button');b.className='quiet';b.textContent='Open plan';b.onclick=()=>openPlan(t.id);a.append(label,title,p,b);return a;}));
  } catch(e) {if(g!==readGeneration)return;$('library').replaceChildren();$('library-state').textContent='Your plans could not be loaded. This does not mean the notebook is empty.';handleError(e);}
}
$('connect').onclick=async()=>{try{await client.connect();notice(client.pending?'A previous save needs checking before any new write.':'Connected. Your saved notebook stays private to your account.');renderStatus();if(client.pending){const p=client.pending.body;const c=p.content;$('symbol').value=p.subject.listing?.symbol||p.subject.key;for(const k of ['title','statement','horizon'])$(k).value=c[k];for(const k of ['falsifiers','risks','catalysts'])$(k).value=c[k].join('\n');$('revisionNote').value=c.revisionNote||'';prompts();show('plan');}}catch(e){handleError(e);}};
$('start-plan').onclick=()=>{show('plan');$(client.pending?'reconcile':'symbol').focus();};
$('new').onclick=()=>{if(dirty&&!confirm('Discard the unsaved changes and start a new plan?'))return;clearView();if(client.userId&&!client.pending)client.state='ready';renderStatus();show('plan');$('symbol').focus();};
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>show(b.dataset.view);
for(const b of document.querySelectorAll('[data-go]'))b.onclick=()=>show(b.dataset.go);
$('plan-form').addEventListener('input',()=>{dirty=true;readGeneration++;prompts();renderStatus();});
$('plan-form').onsubmit=async event=>{
  event.preventDefault();if(!editable())return;
  try{
    const c=contentFromForm(form(),current?.current.content); const s=current?current.subject:subjectFromSymbol($('symbol').value);
    const promise=client.save({subject:s,content:c,thesis:current});renderStatus(); const r=await promise;
    dirty=false;notice(`Saved version ${r.version}. No AI approval or order was created.`);
    // Failure of the follow-up read does not erase the committed-save receipt.
    try{fill(await client.read(r.thesisId));}catch(e){if(!client.userId){handleError(e);}else{notice(`Version ${r.version} was saved, but the refreshed notebook could not be loaded. Refresh before revising again.`);savedUnread=r.thesisId;}}
  }catch(e){handleError(e);if(e.code==='version_conflict'){$('conflict').hidden=false;$('local-conflict').textContent=formatContent(contentFromForm(form(),current?.current.content));$('remote-conflict').textContent='Load the latest version to compare.';}}finally{renderStatus();}
};
$('reconcile').onclick=async()=>{try{const r=await client.reconcile();if(r.recorded){fill(r.thesis);notice(`Original save confirmed: version ${r.version}. No second write was sent.`);}else{notice('No receipt is currently recorded. You may explicitly retry the same request; its identity and content will not change.');}renderStatus();}catch(e){handleError(e);}};
$('retry').onclick=async()=>{try{const p=client.retryUnrecorded();renderStatus();const r=await p;savedUnread=r.thesisId;fill(await client.read(r.thesisId));notice(`Saved version ${r.version} using the original request identity.`);}catch(e){handleError(e);}finally{renderStatus();}};
$('compare').onclick=async()=>{if(!current)return;try{latestConflict=await client.read(current.id);$('remote-conflict').textContent=formatContent(latestConflict.current.content);$('adopt').hidden=JSON.stringify(current.subject)!==JSON.stringify(latestConflict.subject);if($('adopt').hidden)notice('The plan subject changed. Export your draft and open the latest plan; it will not be silently reassigned.');}catch(e){handleError(e);}};
$('adopt').onclick=()=>{if(!latestConflict)return;current=latestConflict;latestConflict=null;$('conflict').hidden=true;$('adopt').hidden=true;client.state='ready';dirty=true;notice(`Your draft is unchanged. Its next revision will explicitly target version ${current.currentVersion}. Review every field before saving.`);renderStatus();};
$('reload-saved').onclick=async()=>{try{fill(await client.read(savedUnread));notice('Saved plan reloaded. You may revise it now.');}catch(e){handleError(e);}};
$('refresh').onclick=()=>{if(client.userId)loadList();else show('today');};
$('export').onclick=()=>{const text=JSON.stringify({notice:'Unsaved draft, not a saved thesis or order.',...form()},null,2);const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='mastermind-plan-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('theme').onclick=()=>{const light=document.documentElement.dataset.theme!=='light';document.documentElement.dataset.theme=light?'light':'dark';$('theme').textContent=light?'Dark mode':'Light mode';};
$('close-dialog').onclick=()=>$('version-dialog').close();
window.addEventListener('beforeunload',e=>{if(dirty||client.pending||client.busy){e.preventDefault();e.returnValue='';}});
window.addEventListener('pageshow',e=>{if(e.persisted){clearView();client.userId=null;client.state='disconnected';notice('Reconnect after returning to this tab before reading or saving private plans.');renderStatus();}});
prompts();renderStatus();
