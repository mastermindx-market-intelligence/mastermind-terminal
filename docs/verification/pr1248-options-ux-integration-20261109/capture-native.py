from pathlib import Path
import subprocess,json,hashlib,os,re,time,datetime,struct,shutil,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof
head='753b4a90ebd31a1da76a9595bb2fedde912da042';base='03af393ce05c12282003a3919cc473c032264922';dependency='7d0483c995df95ea76e988029d0c229d2a0e177c'
revisionName='options-ux-integration-20261109';operation='exposure-source-compatibility-20261105'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def git(*args):return subprocess.run(['git','-C',str(repo),*args],capture_output=True,text=True,check=True).stdout.strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def inspect(args):
 r=subprocess.run(args,capture_output=True,text=True);return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr,'observedAt':now()}
def port_closed(port):
 r=inspect(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']);assert r['exit'] in [0,1] and not r['stderr'].strip();return r['exit']==1
def sources():return json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout)
def packet(folder):return {str(p.relative_to(folder)):sha(p) for p in sorted(folder.rglob('*')) if p.is_file()}
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
 receipt={'schema':'terminal_pr1248_native_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency and not git('diff','--name-only','--diff-filter=U')
assert git('hash-object','.github/workflows/ci.yml')==git('rev-parse',dependency+':.github/workflows/ci.yml')
assert json.loads((proof/'reader-preflight-r1/execution.json').read_text())['state']=='QUALIFIED'
env=os.environ.copy();env['PLAYWRIGHT_BROWSERS_PATH']=str(t/'node_modules/.cache/pr1248-playwright')
for key in ['CAPTURE_ONLY','UPDATE_HEATMAP_EVIDENCE','CAPTURE_HEAD','TERMINAL_CROP_WEBPACK','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_EVIDENCE_MODE','TERMINAL_NATIVE_CAPTURE_ID']:env.pop(key,None)
assert (Path(env['PLAYWRIGHT_BROWSERS_PATH'])/'chromium_headless_shell-1228').is_dir()
js="const x=require('./terminal/e2e/tools/optionsExposureEvidence.cjs');const n=require('./terminal/e2e/tools/capture_ci_evidence.cjs');console.log(JSON.stringify({gex:x.optionsWorkspaceInputs('gex'),eod:x.optionsWorkspaceInputs('eod'),browser:x.optionsWorkspaceBrowserInputs(),specs:x.OPTIONS_WORKSPACE_BROWSER_SPECS,crops:{gex:n.nativeDefinition('gex').files,eod:n.nativeDefinition('eod').files}}));"
inputs=json.loads(subprocess.run(['node','-e',js],cwd=repo,env=env,capture_output=True,text=True,check=True).stdout)
assert {k:len(inputs[k]) for k in ['gex','eod','browser','specs']}=={'gex':37,'eod':63,'browser':229,'specs':12}
reviewed=json.loads((proof/'reviewed-input-sets.json').read_text());assert all(reviewed[k]==inputs[k] for k in ['gex','eod','browser','specs']);inputs['old']=reviewed['old'];put(proof/'reviewed-input-sets.json',inputs)
pins={'terminal/e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs':'cc69060986591ef7fdfeccc155670c7408aaa788d3259a3328fd8cd1173921de','terminal/e2e/tools/capture_gex_levels_heatmap_load_failure.cjs':'dbb92e88972bd39984427d054f431159401fcb16bd49b4479cc1c83456f7777d'}
assert all(sha(repo/p)==v for p,v in pins.items())
paths=set(git('ls-files','--cached','--others','--exclude-standard').splitlines())
sourcePaths=sorted(p for p in paths if p.startswith('terminal/') and not p.startswith(('terminal/docs/','terminal/test-results/','terminal/node_modules/','terminal/.next/')) and re.search(r'\.(?:ts|tsx|css|js|cjs|mjs|json)$',p))
assert set(inputs['browser']).issubset(sourcePaths)
def snapshot():return {p:sha(repo/p) for p in sourcePaths}
record={'schema':'terminal_pr1248_native_successor_validation.v1','head':head,'protectedBase':base,'integratedDependency':dependency,'startedAt':now(),'state':'RUNNING','stages':[]}
recordPath=proof/'native-validation-r1.json';assert not recordPath.exists()
def save():put(recordPath,record)
save()
try:
 for kind,packet,port,count,previous,previousPin in [
 ('eod','eod-heatmap-flowdesk-load-failure',3886,126,'options-integration-20261109','77b3b7f07746290cad33262a3d95c221e947a5acd5e940ae95b9d9458f510a18'),
 ('gex','gex-levels-heatmap-load-failure',3884,114,'options-integration-20261109','fd7c4364bcfb3f8b44773792c4f5d16fbc654eb47cf58a142eb169b3bac24ad7')]:
  assert not (t/'.next/dev/lock').exists() and port_closed(port)
  packetRoot=t/'docs/pr-crops'/packet;revision=packetRoot/'operations'/operation/'revisions'/revisionName;cropOut=revision/'qualified-root'
  assert not revision.exists();revision.mkdir(parents=True);shutil.copy2(packetRoot/'EVIDENCE.yml',revision/'EVIDENCE.before.yml')
  priorRoot={p.name:sha(p) for p in sorted(packetRoot.iterdir()) if p.is_file() and (p.suffix=='.png' or p.name=='EVIDENCE.yml')}
  assert len(priorRoot)==count+1
  put(proof/(kind+'-protected-root-before.json'),priorRoot)
  put(revision/'source-contract.json',{'schema':'exposure_master_capture_sources.v1','kind':kind,'currentInputs':inputs[kind],'observedInputs':sourcePaths})
  put(revision/'history.json',{'schema':'exposure_options_integration_history.v1','operation':operation,'revision':revisionName,'kind':kind,'packet':packet,'branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'predecessor':{'revision':previous,'descriptorSha256':previousPin}})
  assert sha(packetRoot/'operations'/operation/'revisions'/previous/'native-packet.json')==previousPin
  before=snapshot();put(revision/'capture-sources-before.json',before)
  captureId='terminal-pr1248-'+kind+'-options-ux-integration-20261109-r1'
  localEnv={**env,'TERMINAL_CROP_OUTPUT_DIR':str(cropOut),'TERMINAL_CROP_PORT':str(port),'TERMINAL_NATIVE_CAPTURE_ID':captureId}
  cmd=['node','e2e/tools/capture_'+('eod_heatmap_flowdesk' if kind=='eod' else 'gex_levels_heatmap')+'_load_failure.cjs']
  log=revision/'capture.log';supervision=proof/(kind+'-supervision-r1.json')
  assert not log.exists() and not supervision.exists()
  git('add','-A');tree=git('write-tree');started=now();start=time.monotonic()
  stage={'kind':kind,'state':'RUNNING','expected':count,'port':port,'startedAt':started,'captureId':captureId};record['stages'].append(stage);save()
  print(json.dumps({'starting':kind,'count':count,'sourceFiles':len(before),'port':port,'sourceTree':tree,'nativeIPC':True}),flush=True)
  command=['node',str(proof/'native-driver.cjs'),kind,str(port),str(supervision),str(log)]
  child=subprocess.run(command,env=localEnv,capture_output=True,text=True)
  supervised=json.loads(supervision.read_text());result=supervised.get('result',{})
  after=snapshot();put(revision/'capture-sources-after.json',after)
  raw=log.read_text();matches=list(re.finditer(r'capture ([a-z0-9-]+\.png) … ',raw));frames=[]
  for i,m in enumerate(matches):
   segment=raw[m.end():matches[i+1].start() if i+1<len(matches) else len(raw)];lines=[l.strip() for l in segment.splitlines()];ok=not any(l.startswith('FAIL ') for l in lines) and 'ok' in lines
   frames.append({'file':m.group(1),'status':'success' if ok else 'failure'})
  images={}
  for p in sorted(cropOut.glob('*.png')):
   b=p.read_bytes();assert b[:8]==b'\x89PNG\r\n\x1a\n';width,height=struct.unpack('>II',b[16:24]);images[p.name]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'width':width,'height':height}
  receipts=[]
  for line in raw.splitlines():
   try:
    value=json.loads(line)
    if isinstance(value,dict) and 'nativeEvidence' in value:receipts.append(value['nativeEvidence'])
   except json.JSONDecodeError:pass
  manifest=cropOut/'EVIDENCE.yml'
  execution={'schema':'exposure_master_integration_capture.v1','operation':operation,'revision':revisionName,'kind':kind,'packet':packet,'branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'indexTreeAtStart':tree,'command':cmd,'supervisionCommand':command,'supervisionExit':child.returncode,'captureId':captureId,'nativeSupervisor':result,'nativeServerEvents':supervised.get('events',[]),'nativeReceipt':receipts[0] if len(receipts)==1 else None,'port':port,'webpack':False,'startedAt':started,'completedAt':now(),'seconds':round(time.monotonic()-start,2),'exit':result.get('status'),'expected':count,'successfulFiles':sum(x['status']=='success' for x in frames),'frames':frames,'sourceStable':before==after,'portClosed':port_closed(port),'nextLockAbsent':not(t/'.next/dev/lock').exists(),'ownedServerStopped':False,'producerPins':pins,'sourceBeforeSha256':sha(revision/'capture-sources-before.json'),'sourceAfterSha256':sha(revision/'capture-sources-after.json'),'manifestSha256':sha(manifest) if manifest.exists() else None,'images':images,'logSha256':sha(log),'supervisionReceiptSha256':sha(supervision)}
  put(revision/'capture-execution.json',execution)
  assert child.returncode==0 and supervised['state']=='CLOSED' and result['closed'] and result['status']==0 and result['serverReportedStopped'] and result['serverSettled'] and not result['serverRefused'] and not result['error'],supervised
  execution['initialNextLockAbsent']=execution['nextLockAbsent'];execution['lifecycle']=reconcile_lock(port,'native-'+kind,[result['serverPid']])
  execution['portClosed']=port_closed(port);execution['nextLockAbsent']=not(t/'.next/dev/lock').exists();execution['ownedServerStopped']=True
  put(revision/'capture-execution.json',execution)
  expected=sorted(inputs['crops'][kind])
  valid=before==after and len(frames)==count and sorted(x['file'] for x in frames)==expected and all(x['status']=='success' for x in frames) and sorted(images)==expected and manifest.exists() and execution['portClosed'] and execution['nextLockAbsent']
  assert valid,{'frames':len(frames),'images':len(images),'sourceStable':before==after,'logTail':raw[-4000:]}
  assert priorRoot=={p.name:sha(p) for p in sorted(packetRoot.iterdir()) if p.is_file() and (p.suffix=='.png' or p.name=='EVIDENCE.yml')}
  assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency
  verify="const fs=require('fs');const x=require('./terminal/e2e/tools/optionsExposureEvidence.cjs');const n=require('./terminal/e2e/tools/capture_ci_evidence.cjs');x.requireIntegrationExecution(JSON.parse(fs.readFileSync(process.argv[1])),process.argv[2],n.nativeDefinition(process.argv[2]).files,'options-workspace');"
  subprocess.run(['node','-e',verify,str(revision/'capture-execution.json'),kind],cwd=repo,env=env,capture_output=True,text=True,check=True)
  files=['capture-execution.json','capture-sources-before.json','capture-sources-after.json','source-contract.json','qualified-root/EVIDENCE.yml','history.json','EVIDENCE.before.yml','capture.log']
  put(revision/'native-packet.json',{'schema':'options_exposure_master_packet.v1','kind':kind,'profile':'exposure','operation':operation,'captureRevision':revisionName,'branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'files':{p:sha(revision/p) for p in files}})
  stage.update({'state':'QUALIFIED','completedAt':now(),'descriptorSha256':sha(revision/'native-packet.json'),'successfulFiles':count,'sourceStable':True,'ownedServerStopped':True,'seconds':execution['seconds']});save();print(json.dumps(stage),flush=True)
 record.update({'state':'BOTH_NATIVE_FAMILIES_QUALIFIED','completedAt':now()});save()
except BaseException as e:
 record.update({'state':'FAILED','error':str(e),'completedAt':now()});save();raise
