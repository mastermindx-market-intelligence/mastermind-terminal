from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof;port=3902
head='9aa40ffb0b640afeac794d6fa2ca0aaf61d4d3e4';base='156c4b3ecfa27b9137c64068b3ed969e07efbe49';dependency='d03e7587711f1182531f25459fa1f60c679bac10'
def git(*a):return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout.strip()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def inspect(args):
 r=subprocess.run(args,capture_output=True,text=True);return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr,'observedAt':now()}
def port_closed(port):
 r=inspect(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']);assert r['exit'] in [0,1] and not r['stderr'].strip();return r['exit']==1
def reconcile_lock(port,label,extraPids=[]):
 lock=t/'.next/dev/lock'
 for _ in range(40):
  if port_closed(port):break
  time.sleep(.25)
 assert port_closed(port),'Owned listener remains live'
 if not lock.exists():return {'initialLockPresent':False,'serverAbsenceVerifiedAt':now()}
 def identity():
  st=lock.lstat();assert stat.S_ISREG(st.st_mode) and st.st_uid==501
  return {'dev':st.st_dev,'ino':st.st_ino,'size':st.st_size,'mtimeNs':st.st_mtime_ns,'sha256':sha(lock),'content':json.loads(lock.read_text())}
 initial=identity();assert initial['content']['port']==port
 pids=[initial['content']['pid'],*extraPids]
 def observations(withFd):
  checks={}
  for name,args in [('listener',['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']),('recordedProcesses',['ps','-p',','.join(str(x) for x in pids),'-o','pid=,ppid=,comm='])]:
   r=inspect(args);checks[name]=r;assert r['exit']==1 and not r['stdout'].strip() and not r['stderr'].strip(),checks
  if withFd:
   r=inspect(['lsof',str(lock)]);checks['lockDescriptors']=r;assert r['exit']==1 and not r['stdout'].strip() and not r['stderr'].strip()
  else:assert not lock.exists();checks['lockDescriptors']={'state':'fileAbsent','observedAt':now()}
  r=inspect(['lsof','-a','-u','chriswong','-d','cwd','-F','pcn']);cur=[];records=[]
  for line in r['stdout'].splitlines():
   if line.startswith('p'):
    if any(x.startswith('n'+str(repo)) for x in cur):records.append(cur)
    cur=[line]
   else:cur.append(line)
  if any(x.startswith('n'+str(repo)) for x in cur):records.append(cur)
  checks['ownedWorkspaceCwds']={k:v for k,v in r.items() if k!='stdout'};checks['ownedWorkspaceCwds']['records']=records
  assert r['exit']==0 and not r['stderr'].strip() and not records
  return checks
 receipt={'schema':'terminal_pr632_drawing_browser_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency and not git('diff','--name-only','--diff-filter=U')
deps=json.loads((proof/'dependencies.json').read_text());assert deps['state']=='EXACT_DEPENDENCIES_READY'
assert port_closed(port) and not(t/'.next/dev/lock').exists()
prior=proof/'drawing-regression-r1';old=json.loads((prior/'execution.json').read_text());assert old['state']=='FAILED' and old['error']=='drawing-spec-lint'
assert old['stages'][0]['exit']==0 and old['stages'][1]['exit']==0 and old['chartPanelLint']['state']=='NO_NEW_DIAGNOSTICS'
run=proof/'drawing-regression-r1-continuation';assert not run.exists();run.mkdir()
specs=['e2e/drawing-system.spec.ts','e2e/drawing-professional-editing.spec.ts','e2e/chart-view-reset.spec.ts','e2e/crosshair-price-label.spec.ts']
before=json.loads((prior/'source-before.json').read_text())
def snapshot():return {p:sha(repo/p) for p in sorted(before)}
assert snapshot()==before
put(run/'source-before.json',before)
env=os.environ.copy()
for k in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_CROPS','TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_EVIDENCE_UPDATE','PLAYWRIGHT_JSON_OUTPUT_FILE']:env.pop(k,None)
env.update({'CI':'1','TERMINAL_E2E_PORT':str(port),'PLAYWRIGHT_BROWSERS_PATH':deps['browserCache'],'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0'})
record={'schema':'terminal_pr632_existing_drawing_regression_continuation.v1','state':'RUNNING','head':head,'protectedMaster':base,'integratedDependency':dependency,'startedAt':now(),'port':port,'sourceEntries':len(before),'priorExecution':{'path':str((prior/'execution.json').relative_to(repo)),'sha256':sha(prior/'execution.json')},'retainedStages':old['stages'][:2],'unitTestsPassed':old['unitTestsPassed'],'chartPanelLint':old['chartPanelLint'],'stages':[]}
def save():put(run/'execution.json',record)
save()
try:
 from collections import Counter
 path='e2e/drawing-system.spec.ts';current=(t/path).read_text();baseline=git('show',dependency+':terminal/'+path);diagnostics={}
 for name,source in [('accepted-dependency',baseline),('current',current)]:
  args=['node','node_modules/eslint/bin/eslint.js','--stdin','--stdin-filename',path,'--format=json']
  r=subprocess.run(args,input=source,cwd=t,env=env,capture_output=True,text=True);assert r.returncode in [0,1],r.stderr
  entries=json.loads(r.stdout);assert len(entries)==1 and entries[0].get('fatalErrorCount',0)==0
  put(run/('drawing-lint-'+name+'.json'),entries);lines=source.splitlines();counter=Counter()
  for m in entries[0]['messages']:
   key=json.dumps([m.get('ruleId'),m.get('severity'),m.get('message'),m.get('nodeType'),lines[m['line']-1].strip() if m.get('line') else None]);counter[key]+=1
  diagnostics[name]=counter
 novel=diagnostics['current']-diagnostics['accepted-dependency']
 record['drawingSpecLint']={'state':'NO_NEW_DIAGNOSTICS' if not novel else 'NOVEL_DIAGNOSTICS','acceptedDependency':dependency,'baselineCount':sum(diagnostics['accepted-dependency'].values()),'currentCount':sum(diagnostics['current'].values()),'novel':dict(novel)};save();print(json.dumps(record['drawingSpecLint']),flush=True);assert not novel
 listCmd=['node','node_modules/@playwright/test/cli.js','test',*specs,'--project=desktop','--project=tablet','--project=mobile','--list','--reporter=json']
 listing=subprocess.run(listCmd,cwd=t,env=env,capture_output=True,text=True);assert listing.returncode==0,listing.stderr
 listed=json.loads(listing.stdout);put(run/'listed-cases.json',listed)
 def cases(data):
  values=[]
  def walk(s):
   for spec in s.get('specs',[]):
    for v in spec.get('tests',[]):values.append({'key':v['projectName']+'|'+spec['file']+'|'+spec['title'],'status':v.get('status'),'expectedStatus':v.get('expectedStatus'),'results':[{'status':a.get('status'),'retry':a.get('retry'),'error':a.get('error')} for a in v.get('results',[])]})
   for child in s.get('suites',[]):walk(child)
  walk(data);return values
 expected=sorted(c['key'] for c in cases(listed));assert expected and len(expected)==len(set(expected))
 record['selectedCaseCount']=len(expected);save()
 report=run/'browser-report.json';env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(report)
 output=t/'test-results/pr632-drawing-regression-continuation-r1';assert not output.exists()
 command=['node','node_modules/@playwright/test/cli.js','test',*specs,'--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
 # Preserve full outcome before deciding qualification, including failures and project skips.
 log=run/'browser.log';start=time.monotonic();print(json.dumps({'starting':'browser','selectedCases':len(expected),'specs':specs,'port':port}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
 result=json.loads(report.read_text()) if report.exists() else {'errors':['missing report'],'stats':{}}
 actual=cases(result);stats=result.get('stats',{});after=snapshot();put(run/'source-after.json',after)
 record['browser']={'command':command,'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log),'stats':stats,'cases':actual,'reportErrors':result.get('errors',[]),'sourceStable':before==after}
 if output.exists():
  shutil.copytree(output,run/'artifacts');record['browser']['artifacts']={str(p.relative_to(run/'artifacts')):sha(p) for p in (run/'artifacts').rglob('*') if p.is_file()}
 record['lifecycle']=reconcile_lock(port,'drawing-regression-continuation-r1');record['ownedPortClosed']=port_closed(port);record['nextLockAbsent']=not(t/'.next/dev/lock').exists()
 good=r.returncode==0 and before==after and not result.get('errors') and stats.get('unexpected')==stats.get('flaky')==0 and stats.get('expected',0)>0 and len(actual)==len(expected) and sorted(c['key'] for c in actual)==expected and all(len(c['results'])==1 and c['results'][0]['retry']==0 and c['results'][0]['status'] in ['passed','skipped'] and (c['results'][0]['status']!='skipped' or c['expectedStatus']=='skipped') for c in actual) and record['ownedPortClosed'] and record['nextLockAbsent']
 record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now()});save();print(json.dumps({'state':record['state'],'unitTestsPassed':record['unitTestsPassed'],'browserStats':stats,'seconds':record['browser']['seconds'],'sourceStable':before==after,'portsClosed':record['ownedPortClosed'],'chartPanelLint':record['chartPanelLint']}),flush=True)
 if not good:print(log.read_text()[-16000:],flush=True)
 raise SystemExit(0 if good else 1)
except Exception as e:
 record.update({'state':'FAILED','error':str(e),'completedAt':now()});save();raise
