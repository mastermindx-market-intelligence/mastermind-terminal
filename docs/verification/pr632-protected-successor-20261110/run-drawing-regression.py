from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof;port=47632
head='06eb7e854942bb9703fcc1c35a5b3486e9f5238f';base='04989d7a9b4e235b9a4c056c9f2f60c5d5008d39';dependency='f6ff4bb4bbde8a162557cd4e15115cb085e7f77d'
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

assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and not git('ls-files','-u')
assert json.loads((proof/'focused-validation.json').read_text())['state']=='QUALIFIED'
guardReceipt=json.loads((proof/'drawing-guard-current/execution.json').read_text());assert guardReceipt['state']=='QUALIFIED'
assert port_closed(port) and not (t/'.next/dev/lock').exists()
run=proof/'drawing-regression-current';assert not run.exists();run.mkdir()
specs=['e2e/drawing-system.spec.ts','e2e/drawing-professional-editing.spec.ts','e2e/chart-view-reset.spec.ts','e2e/crosshair-price-label.spec.ts']
paths=set(json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,text=True)))
paths|={'terminal/playwright.config.ts','terminal/next.config.ts','terminal/package.json','terminal/package-lock.json',*['terminal/'+s for s in specs]}
def snapshot():return {s:sha(repo/s) for s in sorted(paths)}
before=snapshot();put(run/'source-before.json',before)
guardSource=json.loads((proof/'drawing-guard-current/source-after.json').read_text())
assert all(before[s]==h for s,h in guardSource.items())
env=os.environ.copy()
for k in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_CROPS','TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_EVIDENCE_UPDATE','PLAYWRIGHT_JSON_OUTPUT_FILE']:env.pop(k,None)
env.update({'CI':'1','TERMINAL_E2E_PORT':str(port),'PLAYWRIGHT_BROWSERS_PATH':'/Users/chriswong/Library/Caches/ms-playwright','MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0'})
record={'schema':'terminal_pr632_current_drawing_regression.v1','state':'RUNNING','head':head,'protectedMaster':base,'integratedDependency':dependency,'startedAt':now(),'port':port,'sourceEntries':len(before),'focusedValidationSha256':sha(proof/'focused-validation.json'),'currentPhysicalGuardSha256':sha(proof/'drawing-guard-current/execution.json'),'historicalProofPolicy':'Prior accepted RED, lint and browser records retain their identities; this is a fresh composed-source browser run.'}
def save():put(run/'execution.json',record)
save()
def cases(data):
 values=[]
 def walk(s):
  for spec in s.get('specs',[]):
   for v in spec.get('tests',[]):values.append({'key':v['projectName']+'|'+spec['file']+'|'+spec['title'],'status':v.get('status'),'expectedStatus':v.get('expectedStatus'),'results':[{'status':a.get('status'),'retry':a.get('retry'),'error':a.get('error')} for a in v.get('results',[])]})
  for child in s.get('suites',[]):walk(child)
 for suite in data.get('suites',[]):walk(suite)
 return values
try:
 listCmd=['node','node_modules/@playwright/test/cli.js','test',*specs,'--project=desktop','--project=tablet','--project=mobile','--list','--reporter=json']
 listing=subprocess.run(listCmd,cwd=t,env=env,capture_output=True,text=True);assert listing.returncode==0,listing.stderr
 listed=json.loads(listing.stdout);put(run/'listed-cases.json',listed)
 expected=sorted(c['key'] for c in cases(listed));assert len(expected)==len(set(expected))==183
 record.update({'listCommand':listCmd,'listedCasesSha256':sha(run/'listed-cases.json'),'selectedCaseCount':len(expected)});save()
 report=run/'browser-report.json';env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(report)
 output=t/'test-results/pr632-protected-drawing-regression-current';assert not output.exists()
 command=['node','node_modules/@playwright/test/cli.js','test',*specs,'--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
 log=run/'browser.log';start=time.monotonic();print(json.dumps({'starting':'Existing complete affected drawing selection','selectedCases':len(expected),'specs':specs,'port':port}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
 result=json.loads(report.read_text()) if report.exists() else {'errors':['missing report'],'stats':{}}
 actual=cases(result);stats=result.get('stats',{});after=snapshot();put(run/'source-after.json',after)
 record['browser']={'command':command,'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log),'stats':stats,'cases':actual,'reportErrors':result.get('errors',[]),'sourceStable':before==after}
 if output.exists():
  shutil.copytree(output,run/'artifacts');record['browser']['artifacts']={str(q.relative_to(run/'artifacts')):sha(q) for q in (run/'artifacts').rglob('*') if q.is_file()}
 record['lifecycle']=reconcile_lock(port,'drawing-regression-current');record['ownedPortClosed']=port_closed(port);record['nextLockAbsent']=not (t/'.next/dev/lock').exists()
 good=r.returncode==0 and before==after and not result.get('errors') and {k:stats.get(k) for k in ['expected','unexpected','skipped','flaky']}=={'expected':89,'unexpected':0,'skipped':94,'flaky':0} and len(actual)==len(expected) and sorted(c['key'] for c in actual)==expected and all(len(c['results'])==1 and c['results'][0]['retry']==0 and c['results'][0]['status'] in ['passed','skipped'] and (c['results'][0]['status']!='skipped' or c['expectedStatus']=='skipped') for c in actual) and record['ownedPortClosed'] and record['nextLockAbsent']
 record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now()});save()
 print(json.dumps({'state':record['state'],'browserStats':stats,'seconds':record['browser']['seconds'],'sourceStable':before==after,'ownedPortClosed':record['ownedPortClosed'],'nextLockAbsent':record['nextLockAbsent']}),flush=True)
 if not good:print(log.read_text()[-16000:],flush=True)
 raise SystemExit(0 if good else 1)
except Exception as e:
 record.update({'state':'FAILED','error':str(e),'completedAt':now()});save();raise
