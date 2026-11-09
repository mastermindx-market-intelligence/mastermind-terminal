from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof;port=3897
head='753b4a90ebd31a1da76a9595bb2fedde912da042';base='7d0483c995df95ea76e988029d0c229d2a0e177c'
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
 receipt={'schema':'terminal_pr1248_browser_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and not git('diff','--name-only','--diff-filter=U')
assert json.loads((proof/'dependencies.json').read_text())['state']=='EXACT_DEPENDENCIES_AND_OWNED_BROWSER_CACHE_READY'
assert port_closed(port) and not(t/'.next/dev/lock').exists()
run=proof/'prophet-mobile-r1';assert not run.exists();run.mkdir()
paths=set(json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout))
paths|={'terminal/playwright.config.ts','terminal/next.config.ts','terminal/package.json','terminal/package-lock.json','terminal/e2e/prophet-origination.spec.ts'}
def snapshot():return {p:sha(repo/p) for p in sorted(paths)}
before=snapshot();put(run/'source-before.json',before)
env=os.environ.copy()
for k in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_CROPS','TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_EVIDENCE_UPDATE','PLAYWRIGHT_JSON_OUTPUT_FILE']:env.pop(k,None)
env.update({'CI':'1','TERMINAL_E2E_PORT':str(port),'PLAYWRIGHT_BROWSERS_PATH':str(t/'node_modules/.cache/pr1248-playwright'),'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','PLAYWRIGHT_JSON_OUTPUT_FILE':str(run/'browser-report.json')})
output=t/'test-results/pr1248-prophet-mobile-r1';assert not output.exists()
titles=["Prophet's detail panel discloses the reconstruction in zh, above the geometry","the panel's disclosure shows the clause alone when the row has no receipt"]
command=['node','node_modules/@playwright/test/cli.js','test','e2e/prophet-origination.spec.ts','--project=mobile','--workers=1','--retries=0','--grep','|'.join(titles),'--reporter=list,json','--output='+str(output)]
record={'schema':'terminal_pr1248_current_prophet_mobile_reproduction.v1','state':'RUNNING','head':head,'dependency':base,'startedAt':now(),'command':command,'port':port,'sourceEntries':len(before),'expectedCases':titles}
put(run/'execution.json',record);print(json.dumps({'starting':'two current Prophet mobile failure paths','sourceEntries':len(before),'port':port}),flush=True)
start=time.monotonic();log=run/'browser.log'
with log.open('x') as h:r=subprocess.run(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
after=snapshot();put(run/'source-after.json',after);record.update({'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log),'sourceStable':before==after})
report=json.loads((run/'browser-report.json').read_text()) if (run/'browser-report.json').exists() else {'errors':['missing report'],'stats':{}}
cases=[]
def walk(s):
 for spec in s.get('specs',[]):
  for v in spec.get('tests',[]):cases.append({'file':spec['file'],'title':spec['title'],'project':v['projectName'],'status':v.get('status'),'expectedStatus':v.get('expectedStatus'),'results':[{'status':a.get('status'),'retry':a.get('retry'),'error':a.get('error')} for a in v.get('results',[])]})
 for child in s.get('suites',[]):walk(child)
for suite in report.get('suites',[]):walk(suite)
stats=report.get('stats',{});record.update({'cases':cases,'stats':stats,'reportErrors':report.get('errors',[])})
if output.exists():
 dest=run/'artifacts';shutil.copytree(output,dest);record['artifacts']={str(p.relative_to(dest)):sha(p) for p in dest.rglob('*') if p.is_file()}
record['lifecycle']=reconcile_lock(port,'prophet-mobile-r1');record['ownedPortClosed']=port_closed(port);record['nextLockAbsent']=not(t/'.next/dev/lock').exists()
good=r.returncode==0 and before==after and not record['reportErrors'] and len(cases)==2 and sorted(c['title'] for c in cases)==sorted(titles) and {k:stats.get(k) for k in ['expected','skipped','unexpected','flaky']}=={'expected':2,'skipped':0,'unexpected':0,'flaky':0}
good=good and all(all(v['retry']==0 for v in c['results']) for c in cases) and record['ownedPortClosed'] and record['nextLockAbsent']
record.update({'state':'QUALIFIED' if good else 'FAILED_REPRODUCTION_RETAINED','completedAt':now()});put(run/'execution.json',record);print(json.dumps({'state':record['state'],'exit':r.returncode,'seconds':record['seconds'],'stats':stats,'sourceStable':before==after,'ownedPortClosed':record['ownedPortClosed'],'nextLockAbsent':record['nextLockAbsent']}),flush=True)
if not good:print(log.read_text()[-16000:],flush=True)
raise SystemExit(0 if good else 1)
