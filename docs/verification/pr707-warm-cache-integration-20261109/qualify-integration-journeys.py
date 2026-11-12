"""Qualify only the changed clock, picker and marker integration journeys."""
from pathlib import Path
import datetime,hashlib,importlib.util,json,os,re,shutil,subprocess,time
ROOT=Path('/Volumes/Mastermind/agent-workspaces/terminal/review/terminal-pr707-warm-cache-integration-20261109')
TERMINAL=ROOT/'terminal'
PROOF=ROOT/'docs/verification/pr707-warm-cache-integration-20261109'
OUT=PROOF/'integration-journeys-r1'
HELPER=PROOF/'qualify-protected-browser.py'
spec=importlib.util.spec_from_file_location('pr707_existing_browser_owner',HELPER)
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
h.AUDIT=OUT
OPERATION='terminal-pr707-protected-integration-journeys-20261112'
CLOCK='chart clock keeps ticking without interrupting navigation or an open settings menu'
DESKTOP=['a cached symbol picker stays usable during refresh and receives the corrected company',
'signals and every price overlay stay scoped to a moved price pane',
'Gap Zones stays clipped to price when oscillator panes are present']
TOUCH=['tapping a marker opens its tooltip, and tapping away dismisses it',
'a pane relayout after a tap re-anchors the tooltip instead of dismissing it',
'a tap keeps the marker it started on when geometry moves before pointerup',
'a tap still opens the tooltip when the thread stalls between down and up',
'a touch press that travels is a pan, not a tooltip tap']
STAGES=[
('clock',['e2e/chart-clock-isolation.spec.ts'],['desktop','tablet','mobile'],[CLOCK]),
('desktop',['e2e/warm-symbol-picker.spec.ts','e2e/marker-tooltip.spec.ts'],['desktop'],DESKTOP),
('touch',['e2e/marker-tooltip.spec.ts'],['tablet','mobile'],TOUCH)]
PACKETS={'clock':'chart-clock-isolation-20260921','picker':'warm-symbol-picker-20260921'}
def read(path):return json.loads(path.read_text())
def write(path,value):h.write_json(path,value)
def inventory(folder):
 return {str(p.relative_to(folder)):{'sha256':h.sha(p),'bytes':p.stat().st_size} for p in sorted(folder.rglob('*')) if p.is_file()}
def main():
 assert not OUT.exists()
 earlier=read(PROOF/'browser-qualification-r1/execution.json')
 assert earlier['state']=='BOTH_WARM_BROWSER_STAGES_QUALIFIED_PENDING_READER_PINS'
 assert read(PROOF/'browser-reader-adoption/receipt.json')['state']=='ACTUAL_BROWSER_PROOF_ADOPTED_PENDING_CONSUMER_CHECKS'
 assert h.checkout()=={'checkoutCommit':h.HEAD,'checkoutTree':h.HEAD_TREE,'mergeHead':h.MERGE_HEAD,'indexTree':h.INDEX_TREE}
 OUT.mkdir();paths,_=h.source_paths();before=h.snapshot(paths);write(OUT/'source-before.json',before)
 owner=h.node_json('const p=require("node:path"),o=require("./e2e/tools/capture_ci_evidence.cjs"),r=p.resolve(process.cwd(),"..");console.log(JSON.stringify({eod:o.eodPacket(r).plan,gex:o.gexPacket(r).plan}));')
 assert all(x=={'required':False,'changed':[]} for x in owner.values()),owner
 write(OUT/'owner-preflight.json',owner)
 original={}
 for name,packet in PACKETS.items():
  path=TERMINAL/'docs/pr-crops'/packet
  original[name]=inventory(path)
  target=OUT/('prior-'+name+'-packet');shutil.copytree(path,target)
  assert inventory(target)==original[name] and inventory(path)==original[name]
 write(OUT/'prior-packets.json',original)
 env=os.environ.copy()
 for key in h.FORBIDDEN+['CAPTURE_HEAD','CAPTURE_ONLY','GITHUB_ACTIONS','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA','GITHUB_HEAD_REF']:
  assert not env.get(key),key
 env.update({'CI':'1','HUB_REALTIME_QUOTES':'1','MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','TERMINAL_E2E_PORT':str(h.PORT),
 'TERMINAL_VISUAL_EVIDENCE_OPERATION':OPERATION,'PLAYWRIGHT_BROWSERS_PATH':'/Users/chriswong/Library/Caches/ms-playwright'})
 record={'schema':'terminal_pr707_protected_integration_journeys.v1','state':'RUNNING','operation':OPERATION,
 'startedAt':h.now(),'captureContext':earlier['context'],'sourceFiles':len(before),'sourceBeforeSha256':h.sha(OUT/'source-before.json'),
 'helper':str(HELPER.relative_to(ROOT)),'helperSha256':h.sha(HELPER),'results':{}}
 write(OUT/'execution.json',record);print(json.dumps({'state':'STARTED','operation':OPERATION,'expectedPassed':16}),flush=True)
 for name,specs,projects,titles in STAGES:
  stage=OUT/name;stage.mkdir()
  h.require_free();h.prior_direct(name)
  expected=sorted(project+'|'+title for project in projects for title in titles)
  command=['./node_modules/.bin/playwright','test',*specs,*['--project='+x for x in projects],
  '--workers=1','--retries=0','--trace=on','--output='+str(stage/'browser-artifacts/playwright')]
  if name!='clock':command+=['--grep','(?:'+'|'.join(re.escape(x) for x in titles)+')$']
  env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(stage/'browser-report.json')
  with (stage/'selection.log').open('w') as log:selection=subprocess.run(command+['--list','--reporter=list'],cwd=TERMINAL,env=env,stdout=log,stderr=subprocess.STDOUT)
  assert selection.returncode==0 and re.search(r'Total:\s*'+str(len(expected))+r' tests in ',(stage/'selection.log').read_text())
  started=h.now();clock=time.monotonic();actual=command+['--reporter=list,json'];owned=None
  write(stage/'command.json',{'command':actual,'expectedPassed':expected,'startedAt':started})
  with (stage/'browser.log').open('w') as log:
   process=subprocess.Popen(actual,cwd=TERMINAL,env=env,stdout=log,stderr=subprocess.STDOUT)
   write(stage/'process.json',{'pid':process.pid,'command':actual})
   while process.poll() is None:
    if owned is None:
     owned=h.observe_owned_server(process.pid)
     if owned:write(stage/'owned-server.json',owned)
    time.sleep(0.25)
   process.wait()
  lifecycle=h.settle(stage,owned)
  elapsed=round(time.monotonic()-clock,3)
  direct=stage/'browser-artifacts/direct';direct.mkdir(parents=True)
  for path in sorted((TERMINAL/'test-results').iterdir()):
   if path.is_file() and path.suffix in ['.png','.json']:shutil.copy2(path,direct/path.name)
  if name=='clock':
   dest=stage/'browser-artifacts/clock';dest.mkdir()
   for file in ['desktop.png','tablet.png','mobile.png']:shutil.copy2(TERMINAL/'docs/pr-crops'/PACKETS['clock']/file,dest/file)
  if name=='desktop':
   dest=stage/'browser-artifacts/picker';dest.mkdir()
   for file in ['cached-while-refreshing.png','corrected-after-refresh.png']:shutil.copy2(TERMINAL/'docs/pr-crops'/PACKETS['picker']/file,dest/file)
  artifacts={str(path.relative_to(stage)):h.sha(path) for path in sorted((stage/'browser-artifacts').rglob('*')) if path.is_file()}
  report=read(stage/'browser-report.json');passed,skipped=h.report_cases(report)
  assert process.returncode==0 and sorted(passed)==expected and len(set(passed))==len(expected) and not skipped
  assert not report.get('errors') and report['stats']['expected']==len(expected) and all(report['stats'][k]==0 for k in ['unexpected','skipped','flaky'])
  assert report['config']['workers']==report['config']['metadata']['actualWorkers']==1
  assert h.snapshot(paths)==before and h.sha(HELPER)==record['helperSha256']
  assert h.checkout()=={'checkoutCommit':h.HEAD,'checkoutTree':h.HEAD_TREE,'mergeHead':h.MERGE_HEAD,'indexTree':h.INDEX_TREE}
  result={'passed':len(passed),'failed':0,'skipped':0,'flaky':0,'retries':0,'exit':process.returncode,'seconds':elapsed,
  'playwrightPid':process.pid,'port':h.PORT,'sourceStable':True,'ownedServerStopped':True,'expectedPassed':expected,
  'artifacts':artifacts,'reportSha256':h.sha(stage/'browser-report.json'),'lifecycleSha256':h.sha(stage/'lifecycle.json'),
  'command':actual,'startedAt':started,'completedAt':h.now()}
  write(stage/'execution.json',result);record['results'][name]=result;write(OUT/'execution.json',record)
  print(json.dumps({'stage':name,'passed':len(passed),'seconds':elapsed,'lifecycleSha256':result['lifecycleSha256']}),flush=True)
 after=h.snapshot(paths);write(OUT/'source-after.json',after);assert after==before
 assert sum(x['passed'] for x in record['results'].values())==16
 for name,packet in PACKETS.items():
  archive=OUT/('prior-'+name+'-packet');assert inventory(archive)==original[name]
  directory=TERMINAL/'docs/pr-crops'/packet
  images={x.name:h.sha(x) for x in sorted(directory.glob('*.png'))}
  assert set(images)==({'desktop.png','tablet.png','mobile.png'} if name=='clock' else {'cached-while-refreshing.png','corrected-after-refresh.png'})
  stage='clock' if name=='clock' else 'desktop'
  manifest={'schema':'terminal_pr707_current_journey_evidence.v1','operation':OPERATION,'packet':packet,'fixture':True,'productionProof':False,
  'sourceIdentity':'stable-composed-working-tree','actualGit':earlier['context']['actualGit'],'capturedAt':record['results'][stage]['completedAt'],
  'sourceSnapshot':{'path':str((OUT/'source-before.json').relative_to(ROOT)),'sha256':h.sha(OUT/'source-before.json'),'files':len(before)},
  'priorPacket':{'path':str(archive.relative_to(ROOT)),'files':original[name]},
  'browserProof':{'path':str((OUT/stage/'execution.json').relative_to(ROOT)),'sha256':h.sha(OUT/stage/'execution.json')},
  'cropSha256':images,'results':{'scope':stage,'stagePassed':record['results'][stage]['passed'],'allAffectedJourneysPassed':16,'failed':0,'skipped':0,'flaky':0,'retries':0}}
  write(directory/'EVIDENCE.json',manifest)
 record['state']='ALL_16_CHANGED_INTEGRATION_JOURNEYS_PASSED';record['completedAt']=h.now()
 record['sourceAfterSha256']=h.sha(OUT/'source-after.json');record['sourceStable']=True
 record['currentPackets']={name:inventory(TERMINAL/'docs/pr-crops'/packet) for name,packet in PACKETS.items()}
 write(OUT/'execution.json',record);print(json.dumps({'state':record['state'],'passed':16,'executionSha256':h.sha(OUT/'execution.json')}),flush=True)
if __name__=='__main__':
 try:main()
 except Exception as error:
  if OUT.exists():write(OUT/'failure.json',{'state':'FAILED','at':h.now(),'type':type(error).__name__,'message':str(error)[:6000]})
  raise
