from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof;port=3906
head='c31fe105d4a101531def3518e7b9801e70cc4867';base='156c4b3ecfa27b9137c64068b3ed969e07efbe49';dependency='d03e7587711f1182531f25459fa1f60c679bac10'
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
 receipt={'schema':'terminal_pr702_browser_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency and not git('diff','--name-only','--diff-filter=U')
unit=json.loads((proof/'clock-and-marker-units-r2/execution.json').read_text());assert unit['state']=='QUALIFIED' and unit['stats']['numPassedTests']==35
assert all(sha(repo/p)==h for p,h in unit['sourceAfter'].items())
deps=json.loads((proof/'dependencies.json').read_text());assert deps['state']=='EXACT_DEPENDENCIES_READY'
assert port_closed(port) and not(t/'.next/dev/lock').exists()
run=proof/'current-browser-r3';assert not run.exists();run.mkdir()
packet=t/'docs/pr-crops/chart-clock-isolation-20260921';prior=proof/'prior-clock-packet';assert prior.is_dir()
assert json.loads((proof/'browser-preparation-failure-r1/execution.json').read_text())['state']=='LIST_PREPARATION_FAILED_NO_BROWSER_STARTED'
priorFiles={str(p.relative_to(packet)):sha(p) for p in packet.rglob('*') if p.is_file()}
assert priorFiles=={str(p.relative_to(prior)):sha(p) for p in prior.rglob('*') if p.is_file()}
put(run/'prior-clock-packet.json',priorFiles)
specs=['e2e/chart-clock-isolation.spec.ts','e2e/marker-tooltip.spec.ts']
import re
selectedTitles=["chart clock keeps ticking without interrupting navigation or an open settings menu","tapping a marker opens its tooltip, and tapping away dismisses it","a pane relayout after a tap re-anchors the tooltip instead of dismissing it","a tap keeps the marker it started on when geometry moves before pointerup","a tap still opens the tooltip when the thread stalls between down and up","a touch press that travels is a pan, not a tooltip tap"]
grep='(?:'+'|'.join(re.escape(title) for title in selectedTitles)+')$'
paths=set(json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout))
paths|={'terminal/playwright.config.ts','terminal/next.config.ts','terminal/package.json','terminal/package-lock.json',*['terminal/'+p for p in specs]}
def snapshot():return {p:sha(repo/p) for p in sorted(paths)}
before=snapshot();put(run/'source-before.json',before)
env=os.environ.copy()
for k in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_CROPS','TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_EVIDENCE_UPDATE','PLAYWRIGHT_JSON_OUTPUT_FILE']:env.pop(k,None)
env.update({'CI':'1','TERMINAL_E2E_PORT':str(port),'PLAYWRIGHT_BROWSERS_PATH':deps['browserCache'],'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0'})
def cases(data):
 values=[]
 def walk(s):
  for spec in s.get('specs',[]):
   for v in spec.get('tests',[]):values.append({'key':v['projectName']+'|'+spec['file']+'|'+spec['title'],'project':v['projectName'],'title':spec['title'],'expectedStatus':v.get('expectedStatus'),'results':[{'status':a.get('status'),'retry':a.get('retry'),'error':a.get('error')} for a in v.get('results',[])]})
  for child in s.get('suites',[]):walk(child)
 walk(data);return values
listed=subprocess.run(['node','node_modules/@playwright/test/cli.js','test',*specs,'--project=desktop','--project=tablet','--project=mobile','--grep',grep,'--list','--reporter=json'],cwd=t,env=env,capture_output=True,text=True)
assert listed.returncode==0,listed.stderr
listing=json.loads(listed.stdout);put(run/'listed-cases.json',listing);expected=sorted(c['key'] for c in cases(listing));assert len(expected)==len(set(expected))==18,expected
assert sorted({c['title'] for c in cases(listing)})==sorted(selectedTitles)
report=run/'browser-report.json';env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(report)
output=t/'test-results/pr702-current-browser-r3';assert not output.exists()
command=['node','node_modules/@playwright/test/cli.js','test',*specs,'--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--grep',grep,'--reporter=list,json','--output='+str(output)]
record={'schema':'terminal_pr702_current_clock_and_touch_browser.v1','state':'RUNNING','head':head,'protectedMaster':base,'integratedDependency':dependency,'startedAt':now(),'command':command,'port':port,'sourceEntries':len(before),'selectedCaseCount':18,'expectedPassed':13,'expectedSkipped':5}
def save():put(run/'execution.json',record)
save();print(json.dumps({'starting':'clock plus five existing touch cases','selectedCases':18,'expectedPassed':13,'expectedSkipped':5,'port':port,'sourceEntries':len(before)}),flush=True)
start=time.monotonic();startNs=time.time_ns();log=run/'browser.log'
with log.open('x') as h:r=subprocess.run(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
after=snapshot();put(run/'source-after.json',after);result=json.loads(report.read_text()) if report.exists() else {'errors':['missing report'],'stats':{}};stats=result.get('stats',{});actual=cases(result)
record.update({'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'sourceStable':before==after,'stats':stats,'cases':actual,'reportErrors':result.get('errors',[]),'logSha256':sha(log)})
if output.exists():
 shutil.copytree(output,run/'artifacts');record['artifacts']={str(p.relative_to(run/'artifacts')):sha(p) for p in (run/'artifacts').rglob('*') if p.is_file()}
fresh=run/'current-clock-images';fresh.mkdir();images={}
for project in ['desktop','tablet','mobile']:
 p=packet/(project+'.png')
 if p.exists() and p.stat().st_mtime_ns>=startNs:
  shutil.copy2(p,fresh/p.name);images[p.name]={'sha256':sha(p),'bytes':p.stat().st_size}
record['freshClockImages']=images
# Keep the original clock packet historical. Fresh output is bound to this actual execution.
for rel,h in priorFiles.items():
 p=packet/rel
 if not p.exists() or sha(p)!=h:
  p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(prior/rel,p)
assert {str(p.relative_to(packet)):sha(p) for p in packet.rglob('*') if p.is_file()}==priorFiles
record['historicalClockPacketRestoredUnchanged']=True
record['lifecycle']=reconcile_lock(port,'clock-touch-r3');record['ownedPortClosed']=port_closed(port);record['nextLockAbsent']=not(t/'.next/dev/lock').exists()
good=r.returncode==0 and before==after and not result.get('errors') and {k:stats.get(k) for k in ['expected','unexpected','skipped','flaky']}=={'expected':13,'unexpected':0,'skipped':5,'flaky':0} and sorted(c['key'] for c in actual)==expected and all(len(c['results'])==1 and c['results'][0]['retry']==0 and c['results'][0]['status'] in ['passed','skipped'] and (c['results'][0]['status']!='skipped' or c['expectedStatus']=='skipped') for c in actual) and len(images)==3 and record['ownedPortClosed'] and record['nextLockAbsent']
record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now()});save();print(json.dumps({'state':record['state'],'seconds':record['seconds'],'stats':stats,'sourceStable':before==after,'freshClockImages':len(images),'portsClosed':record['ownedPortClosed']}),flush=True)
if not good:print(log.read_text()[-16000:],flush=True)
raise SystemExit(0 if good else 1)
