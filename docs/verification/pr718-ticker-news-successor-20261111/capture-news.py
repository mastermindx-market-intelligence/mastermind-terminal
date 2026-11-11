from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,stat,struct,socket
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof;port=61886;prior=repo/'docs/verification/pr910-ticker-news-integration-20261109'
node=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1275-conflict-successor/.pr1275-conflict-runtime/node-v22.23.4-darwin-arm64/bin/node');os.environ['PATH']=str(node.parent)+':'+os.environ['PATH']
head='01550eaca9e1e1f8d816e6fef785b38998710b43';base='18fabe9d3c1439c4185559ba5ce491518fe999c9';compositionParents=['26862a671763d6eea4a1ea3b93f3bfc79114b6e1', '18fabe9d3c1439c4185559ba5ce491518fe999c9', '59f101192d6b48d72b850f98c2428f27a04652bf'];sourceTree='e2cf25126668a68cdf585be25092e52a589eb849'
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
 if not lock.exists():
  assert extraPids,'Actual completed producer PID is required'
  checks={}
  for name,args in [('listener',['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']),('producerProcesses',['ps','-p',','.join(str(x) for x in extraPids),'-o','pid=,ppid=,comm='])]:
   r=inspect(args);checks[name]=r;assert r['exit']==1 and not r['stdout'].strip() and not r['stderr'].strip(),checks
  r=inspect(['lsof','-a','-u',str(os.getuid()),'-d','cwd','-F','pcn']);cur=[];records=[]
  for line in r['stdout'].splitlines():
   if line.startswith('p'):
    if any(x.startswith('n'+str(repo)) for x in cur):records.append(cur)
    cur=[line]
   else:cur.append(line)
  if any(x.startswith('n'+str(repo)) for x in cur):records.append(cur)
  assert r['exit']==0 and not r['stderr'].strip() and not records
  checks['ownedWorkspaceCwds']={k:v for k,v in r.items() if k!='stdout'};checks['ownedWorkspaceCwds']['records']=records
  receipt={'schema':'terminal_pr718_news_browser_lifecycle_reconciliation.v1','label':label,'state':'PRODUCER_EXITED_PORT_CLOSED_WORKSPACE_HOLDERS_ABSENT','initialLockPresent':False,'serverPid':'NOT_OBSERVED_NO_LOCK','checks':checks,'completedAt':now()}
  file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
  return {'initialLockPresent':False,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'observedAt':receipt['completedAt'],'state':receipt['state']}

 def identity():
  st=lock.lstat();assert stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and st.st_nlink==1
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
  r=inspect(['lsof','-a','-u',str(os.getuid()),'-d','cwd','-F','pcn']);cur=[];records=[]
  for line in r['stdout'].splitlines():
   if line.startswith('p'):
    if any(x.startswith('n'+str(repo)) for x in cur):records.append(cur)
    cur=[line]
   else:cur.append(line)
  if any(x.startswith('n'+str(repo)) for x in cur):records.append(cur)
  checks['ownedWorkspaceCwds']={k:v for k,v in r.items() if k!='stdout'};checks['ownedWorkspaceCwds']['records']=records
  assert r['exit']==0 and not r['stderr'].strip() and not records
  return checks
 receipt={'schema':'terminal_pr718_news_browser_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and git('rev-parse','HEAD^{tree}')==sourceTree and git('show','-s','--format=%P',head).split()==compositionParents and not git('diff','--name-only') and not git('diff','--name-only','--diff-filter=U')
assert json.loads((proof/'dependencies.json').read_text())['state']=='MATCHING_DEPENDENCIES_AND_EXISTING_BROWSER_CACHE_READY'
assert git('hash-object','terminal/e2e/ticker-news.spec.ts')==git('rev-parse',head+':terminal/e2e/ticker-news.spec.ts')
assert port_closed(port) and not(t/'.next/dev/lock').exists()
with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as reserved:reserved.bind(('127.0.0.1',port))
run=proof/'browser-current';assert not run.exists();run.mkdir()
packet=t/'docs/pr-crops/ticker-news';modern=json.loads((proof/'newer-packets-before.json').read_text())
families=['ticker-news-editorial-views','ticker-news-recovery','ticker-news-cn-hk']
def modern_now():return {str(p.relative_to(repo)):sha(p) for name in families for p in (t/'docs/pr-crops'/name).rglob('*') if p.is_file()}
assert modern_now()=={p:v['sha256'] for p,v in modern.items()} and len(modern)==103
expected=sorted([size+'-'+lang+'-dark.png' for size in ['desktop','tablet','mobile'] for lang in ['en','zh']]+['unavailable-'+size+'-'+lang+'-dark.png' for size in ['desktop','mobile'] for lang in ['en','zh']])
assert sorted(p.name for p in packet.glob('*.png'))==expected and len(expected)==10
priorPacket={p.name:sha(p) for p in packet.iterdir() if p.is_file()};assert len(priorPacket)==11
extraPaths={'terminal/e2e/ticker-news.spec.ts','terminal/e2e/watchlistStore.ts','terminal/e2e/presentationControls.ts','terminal/playwright.config.ts','terminal/next.config.ts','terminal/package.json','terminal/package-lock.json','terminal/lib/__tests__/tickerNewsEvidence.test.ts','terminal/lib/__tests__/fixtures/newsEditorial.ts','terminal/docs/specimens/news-flow.light.css','terminal/components/news/TickerNewsPanel.tsx','terminal/components/news/TickerNewsPanel.module.css','terminal/components/TerminalShell.tsx','terminal/e2e/globalSetup.ts','terminal/e2e/tools/visualEvidence.cjs','terminal/tsconfig.json'}
def snapshot():
 # Re-discover membership on every read: both newly added paths and changed bytes matter.
 discovered=json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout)
 paths=set(discovered)|extraPaths
 assert all((repo/p).is_file() for p in paths)
 return {p:sha(repo/p) for p in sorted(paths)}
preimages=json.loads((proof/'generated-preimages.json').read_text())
for rel,v in preimages.items():
 p=repo/rel
 assert p.exists()==v['present']
 if p.exists():assert sha(p)==v['sha256']
wrapperSha256=sha(Path(__file__))
before=snapshot();put(run/'source-before.json',before)
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP','PATH'] if k in os.environ}
for k in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_CROPS','TERMINAL_TICKER_NEWS_CAPTURE_PACKET','TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_EVIDENCE_UPDATE','PLAYWRIGHT_JSON_OUTPUT_FILE']:env.pop(k,None)
env.update({'CI':'1','TERMINAL_E2E_PORT':str(port),'PLAYWRIGHT_BROWSERS_PATH':'/Users/chriswong/Library/Caches/ms-playwright','MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0'})
negative=json.loads((prior/'browser-r1/invalid-selector.json').read_text())
assert negative['state']=='REFUSED_BEFORE_OUTPUT_MUTATION'
assert json.loads((prior/'readiness-repair.json').read_text())['selectorBlockUnchanged']
output=t/'test-results/pr718-ticker-news-successor';assert not output.exists()
env.update({'TERMINAL_CROPS':'1','TERMINAL_TICKER_NEWS_CAPTURE_PACKET':'ticker-news','PLAYWRIGHT_JSON_OUTPUT_FILE':str(run/'browser-report.json')})
command=['node','node_modules/@playwright/test/cli.js','test','e2e/ticker-news.spec.ts','--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
record={'schema':'terminal_pr718_news_full_current_news_capture.v1','state':'RUNNING','head':head,'sourceTree':sourceTree,'compositionParents':compositionParents,'protectedMaster':base,'startedAt':now(),'command':command,'port':port,'sourceEntries':len(before),'expectedPassed':14,'expectedExistingSkips':7,'expectedImages':expected,'priorManifestSha256':priorPacket['EVIDENCE.yml'],'wrapperSha256':wrapperSha256,'generatedPreimages':preimages,'newerPacketFiles':103,'invalidSelectorProofSha256':sha(prior/'browser-r1/invalid-selector.json')}
put(run/'execution.json',record);print(json.dumps({'starting':'complete current ticker-news spec and original packet capture','sourceEntries':len(before),'port':port,'expectedPassed':14,'existingSkips':7,'invalidSelector':'REUSED_UNCHANGED_SELECTION_GUARD_PROOF'}),flush=True)
start=time.monotonic();startNs=time.time_ns();log=run/'browser.log'
with log.open('x') as h:
 r=subprocess.Popen(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
 record['producerPid']=r.pid;record['observerPid']=os.getpid();put(run/'execution.json',record)
 r.wait()
after=snapshot();put(run/'source-after.json',after);record.update({'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log),'sourceStable':before==after})
report=json.loads((run/'browser-report.json').read_text()) if (run/'browser-report.json').exists() else {'errors':['missing report'],'stats':{}}
cases=[]
def walk(s):
 for spec in s.get('specs',[]):
  for v in spec.get('tests',[]):cases.append({'file':spec['file'],'title':spec['title'],'project':v['projectName'],'status':v.get('status'),'expectedStatus':v.get('expectedStatus'),'results':[{'status':a.get('status'),'retry':a.get('retry')} for a in v.get('results',[])]})
 for child in s.get('suites',[]):walk(child)
for suite in report.get('suites',[]):walk(suite)
stats=report.get('stats',{});record.update({'cases':cases,'stats':stats,'reportErrors':report.get('errors',[]),'newerPacketsUnchanged':modern_now()=={p:v['sha256'] for p,v in modern.items()}})
if output.exists():
 dest=run/'artifacts';shutil.copytree(output,dest);record['artifacts']={str(p.relative_to(dest)):sha(p) for p in dest.rglob('*') if p.is_file()}
if r.returncode!=0:
 record.update({'state':'CAPTURE_FAILED_NO_REPLAY','completedAt':now(),'runtimePostProbes':'NOT_RUN: classify actual caller/log before further runtime observation'})
 put(run/'execution.json',record)
 print(json.dumps({'state':record['state'],'exit':r.returncode,'stats':stats,'sourceStable':record['sourceStable'],'runtimePostProbes':record['runtimePostProbes']}),flush=True)
 print(log.read_text()[-18000:],flush=True)
 raise SystemExit(r.returncode or 1)
images={}
for name in expected:
 f=packet/name;data=f.read_bytes();assert data[:8]==b'\x89PNG\r\n\x1a\n'
 width,height=struct.unpack('>II',data[16:24]);images[name]={'sha256':sha(f),'bytes':len(data),'pngWidth':width,'pngHeight':height,'modifiedDuringCapture':f.stat().st_mtime_ns>=startNs}
record['generatedFiles']={str(p.relative_to(repo)):{'sha256':sha(p),'bytes':p.stat().st_size,'tracked':bool(git('ls-files','--',str(p.relative_to(repo))))} for p in [t/'next-env.d.ts',t/'tsconfig.json'] if p.exists()}
record['images']=images;record['manifestUnchangedUntilBinding']=sha(packet/'EVIDENCE.yml')==priorPacket['EVIDENCE.yml']
record['lifecycle']=reconcile_lock(port,'ticker-news-browser-current',[r.pid]);record['ownedPortClosed']=port_closed(port);record['nextLockAbsent']=not(t/'.next/dev/lock').exists()
good=r.returncode==0 and before==after and sha(Path(__file__))==wrapperSha256 and not record['reportErrors'] and len(cases)==21 and {k:stats.get(k) for k in ['expected','skipped','unexpected','flaky']}=={'expected':14,'skipped':7,'unexpected':0,'flaky':0}
good=good and all(all(v['retry']==0 for v in c['results']) for c in cases) and record['newerPacketsUnchanged'] and record['manifestUnchangedUntilBinding'] and all(v['modifiedDuringCapture'] and v['bytes']>0 for v in images.values()) and sorted(p.name for p in packet.glob('*.png'))==expected and record['ownedPortClosed'] and record['nextLockAbsent']
record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now()});put(run/'execution.json',record);print(json.dumps({'state':record['state'],'exit':r.returncode,'seconds':record['seconds'],'stats':stats,'images':len(images),'allImagesFresh':all(v['modifiedDuringCapture'] for v in images.values()),'newerPacketFilesUnchanged':103 if record['newerPacketsUnchanged'] else False,'sourceStable':before==after,'ownedPortClosed':record['ownedPortClosed'],'nextLockAbsent':record['nextLockAbsent']}),flush=True)
if not good:print(log.read_text()[-18000:],flush=True)
raise SystemExit(0 if good else 1)
