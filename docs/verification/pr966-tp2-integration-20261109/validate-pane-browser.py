from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof;port=3894
head='46394e371a34ef9cda9ffd09b1ba115e3729c441';base='03af393ce05c12282003a3919cc473c032264922'
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
 receipt={'schema':'terminal_pr966_browser_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and not git('diff','--name-only','--diff-filter=U')
assert port_closed(port) and not(t/'.next/dev/lock').exists()
run=proof/'pane-browser-r1';assert not run.exists();run.mkdir()
paths=set(json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout))
paths|=set(json.loads((proof/'integration-preparation.json').read_text())['acceptedTenBlobs'])
paths|={'terminal/e2e/pane-sync-time-axis.spec.ts','terminal/playwright.config.ts','terminal/package.json','terminal/package-lock.json'}
def snapshot():return {p:sha(repo/p) for p in sorted(paths)}
before=snapshot();put(run/'source-before.json',before)
output=t/'test-results/pr966-pane-r1';assert not output.exists()
env=os.environ.copy()
for k in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_CROPS','TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_EVIDENCE_UPDATE']:env.pop(k,None)
env.update({'CI':'1','TERMINAL_E2E_PORT':str(port),'PLAYWRIGHT_BROWSERS_PATH':str(t/'node_modules/.cache/pr966-playwright'),'PLAYWRIGHT_JSON_OUTPUT_FILE':str(run/'browser-report.json'),'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0'})
command=['node','node_modules/@playwright/test/cli.js','test','e2e/pane-sync-time-axis.spec.ts','--grep','removing a pane leaves no stale registration driving the grid','--project=desktop','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
record={'schema':'terminal_pr966_historical_failure_reproduction.v1','state':'RUNNING','head':head,'protectedMaster':base,'startedAt':now(),'command':command,'port':port,'sourceEntries':len(before),'historicalJob':'https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/38542185205/job/115779400848'}
put(run/'execution.json',record);print(json.dumps({'starting':'exact historical pane-removal drag case','port':port,'sourceEntries':len(before)}),flush=True)
start=time.monotonic();log=run/'browser.log'
with log.open('x') as h:r=subprocess.run(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
record.update({'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)})
after=snapshot();put(run/'source-after.json',after);record['sourceStable']=before==after
report=json.loads((run/'browser-report.json').read_text()) if (run/'browser-report.json').exists() else {'errors':['missing report'],'stats':{}}
cases=[]
def walk(s):
 for spec in s.get('specs',[]):
  for v in spec.get('tests',[]):cases.append({'file':spec['file'],'title':spec['title'],'project':v['projectName'],'status':v.get('status'),'expectedStatus':v.get('expectedStatus'),'results':[{'status':a.get('status'),'retry':a.get('retry')} for a in v.get('results',[])]})
 for v in s.get('suites',[]):walk(v)
for suite in report.get('suites',[]):walk(suite)
record['cases']=cases;record['stats']=report.get('stats',{});record['reportErrors']=report.get('errors',[])
if output.exists():
 dest=run/'artifacts';shutil.copytree(output,dest);record['artifacts']={str(p.relative_to(dest)):sha(p) for p in dest.rglob('*') if p.is_file()}
record['lifecycle']=reconcile_lock(port,'pane-browser-r1');record['ownedPortClosed']=port_closed(port);record['nextLockAbsent']=not(t/'.next/dev/lock').exists()
good=r.returncode==0 and before==after and not record['reportErrors'] and len(cases)==1 and cases[0]['status']=='expected' and cases[0]['results']==[{'status':'passed','retry':0}] and record['ownedPortClosed'] and record['nextLockAbsent']
record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now()});put(run/'execution.json',record);print(json.dumps(record),flush=True)
if not good:print(log.read_text()[-15000:],flush=True)
raise SystemExit(0 if good else 1)
