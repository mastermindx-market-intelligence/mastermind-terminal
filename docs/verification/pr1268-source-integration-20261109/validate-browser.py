from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';run=Path(__file__).resolve().parent;out=run
head='f7276cf077b877a54509cba28ab247b5524d8530';base='03af393ce05c12282003a3919cc473c032264922';port=3892
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
 receipt={'schema':'terminal_pr1268_browser_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and not git('diff','--name-only','--diff-filter=U')
assert port_closed(port) and not (t/'.next/dev/lock').exists()
proof=run/'browser-r1';assert not proof.exists();proof.mkdir()
packet=t/'docs/pr-crops/tiingo-24h-status-20261103';prior=run/'prior-tiingo-status';assert not prior.exists();shutil.copytree(packet,prior)
images=sorted(p.name for p in prior.glob('*.png'));assert len(images)==12
priorImages={name:sha(prior/name) for name in images};put(run/'prior-tiingo-status.json',priorImages)
specs=['e2e/overnight-status.spec.ts','e2e/overnight-chart.spec.ts','e2e/overnight-history.spec.ts','e2e/overnight-refresh.spec.ts','e2e/boats-display.spec.ts','e2e/mobile-session-settings.spec.ts']
runtime=json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout)
extra=['terminal/components/ChartBoatsStatus.tsx','terminal/components/ChartOvernight.module.css','terminal/lib/extQuoteCopy.ts','terminal/components/ChartFrameBar.tsx','terminal/components/ChartPane.tsx','terminal/components/ChartPanel.tsx','terminal/playwright.config.ts','terminal/next.config.ts','terminal/package.json','terminal/package-lock.json']+['terminal/'+s for s in specs]
paths=sorted(set(runtime)|set(extra))
def snapshot():return {p:sha(repo/p) for p in paths}
before=snapshot();put(proof/'source-before.json',before)
output=t/'test-results/pr1268-browser-r1';assert not output.exists()
env=os.environ.copy()
for key in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_CROPS','TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_EVIDENCE_UPDATE']:env.pop(key,None)
env.update({'CI':'1','TERMINAL_E2E_PORT':str(port),'PLAYWRIGHT_BROWSERS_PATH':str(t/'node_modules/.cache/pr1268-playwright'),'PLAYWRIGHT_JSON_OUTPUT_FILE':str(proof/'browser-report.json'),'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0'})
command=['node','node_modules/@playwright/test/cli.js','test',*specs,'--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
log=proof/'browser.log';start=time.monotonic();startNs=time.time_ns()
record={'schema':'terminal_pr1268_affected_browser_validation.v1','head':head,'protectedMaster':base,'command':command,'port':port,'sourceEntries':len(before),'startedAt':now(),'state':'RUNNING','expectedActiveCases':88,'expectedNonMobileSkips':8,'preservedPriorImages':priorImages}
def save():put(proof/'execution.json',record)
save();print(json.dumps({'starting':'BOATS integrated browser contracts','activeCasesExpected':88,'nonMobileSkipsExpected':8,'sources':len(before),'port':port}),flush=True)
with log.open('x') as h:r=subprocess.run(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
after=snapshot();put(proof/'source-after.json',after)
report=json.loads((proof/'browser-report.json').read_text()) if (proof/'browser-report.json').exists() else {'errors':['Missing report'],'stats':{}}
cases=[]
def walk(s):
 for spec in s.get('specs',[]):
  for test in spec.get('tests',[]):cases.append({'file':spec['file'],'key':test['projectName']+'|'+spec['file']+'|'+spec['title'],'project':test['projectName'],'expectedStatus':test.get('expectedStatus'),'attempts':[{'status':v.get('status'),'retry':v.get('retry')} for v in test.get('results',[])]})
 for child in s.get('suites',[]):walk(child)
walk(report)
artifacts={}
if output.exists():
 for src in sorted(output.rglob('*')):
  if src.is_file():
   relative=src.relative_to(output);dest=proof/'browser-artifacts'/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest);artifacts[str(relative)]=sha(dest)
stats=report.get('stats',{})
record.update({'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'sourceStable':before==after,'passed':stats.get('expected',0),'failed':stats.get('unexpected',0),'skipped':stats.get('skipped',0),'flaky':stats.get('flaky',0),'cases':cases,'artifacts':artifacts,'logSha256':sha(log),'state':'RETURNED_PENDING_LIFECYCLE'});save()
record['lifecycle']=reconcile_lock(port,'boats-browser-r1')
record['ownedPortClosed']=port_closed(port);record['nextLockAbsent']=not(t/'.next/dev/lock').exists();save()
skipped=[c for c in cases if c['attempts']==[{'status':'skipped','retry':0}]]
valid=r.returncode==0 and not report.get('errors') and before==after and record['passed']==88 and record['failed']==record['flaky']==0 and record['skipped']==8 and len(cases)==96 and len({c['key'] for c in cases})==96 and len(skipped)==8 and all(c['file'].endswith('mobile-session-settings.spec.ts') and c['project'] in ['desktop','tablet'] for c in skipped) and all(c in skipped or c['attempts']==[{'status':'passed','retry':0}] for c in cases) and record['ownedPortClosed'] and record['nextLockAbsent']
record['currentImages']={}
for name in images:
 file=packet/name
 if file.exists() and file.stat().st_mtime_ns>=startNs:record['currentImages'][name]={'sha256':sha(file),'bytes':file.stat().st_size}
valid=valid and len(record['currentImages'])==12
record.update({'state':'QUALIFIED' if valid else 'FAILED','completedAt':now()});save()
print(json.dumps({k:record[k] for k in ['state','passed','failed','skipped','flaky','sourceStable','ownedPortClosed','nextLockAbsent','seconds']}),flush=True)
if not valid:print(log.read_text()[-18000:],flush=True);raise SystemExit(1)
