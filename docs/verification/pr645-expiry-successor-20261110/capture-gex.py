from pathlib import Path
import subprocess,json,hashlib,os,re,time,datetime,struct,shutil,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent
head='a985bf7f37b9a5a9fc490f8b3eb72be04869bfe4';base='dad33e10089c9d51d931a1fe72e7fa1acb37abe1';dependency='9ef372c8086ceaac8bcb153bd2d2d71b5b63d62c'
revisionName='expiry-greeks-integration-20261110';operation='exposure-source-compatibility-20261105';port=47465;kind='gex';packet='gex-levels-heatmap-load-failure';count=114
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,v):p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
def inspect(args):
 r=subprocess.run(args,capture_output=True,text=True);return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr,'at':now()}
def port_closed():
 r=inspect(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']);assert r['exit'] in (0,1) and not r['stderr'].strip();return r['exit']==1
def reconcile_lock(result):
 assert port_closed()
 lock=t/'.next/dev/lock';receipt={'schema':'terminal_pr645_native_lifecycle.v1','at':now(),'portClosed':True,'lockPresent':lock.exists()}
 checks={}
 for pid in set([result['serverPid'],*([json.loads(lock.read_text())['pid']] if lock.exists() else [])]):
  checks[str(pid)]=inspect(['ps','-p',str(pid),'-o','pid=,ppid=,comm=']);assert checks[str(pid)]['exit']==1 and not checks[str(pid)]['stdout'].strip() and not checks[str(pid)]['stderr'].strip()
 receipt['processChecks']=checks
 if lock.exists():
  raw=lock.read_bytes();st=lock.lstat();data=json.loads(raw);assert data['port']==port and stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid()
  fd=inspect(['lsof',str(lock)]);assert fd['exit']==1 and not fd['stdout'].strip() and not fd['stderr'].strip()
  cwd=inspect(['lsof','-a','-u',str(os.getuid()),'-d','cwd','-F','pcn'])
  assert cwd['exit']==0 and not cwd['stderr'].strip() and not any(s.startswith('n'+str(repo)) for s in cwd['stdout'].splitlines())
  receipt.update({'lock':data,'lockSha256':hashlib.sha256(raw).hexdigest(),'lockInode':st.st_ino,'fd':fd,'workspaceCwdHolders':[]})
  put(proof/'native-gex-lifecycle.json',receipt);assert lock.read_bytes()==raw and lock.lstat().st_ino==st.st_ino and port_closed();lock.unlink()
 receipt['state']='OWNED_SERVER_STOPPED';receipt['completedAt']=now();put(proof/'native-gex-lifecycle.json',receipt);return receipt
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency and not git('diff','--name-only','--diff-filter=U')
assert json.loads((proof/'protected-overlay.json').read_text())['state']=='APPLIED'
assert git('hash-object','.github/workflows/ci.yml')=='62bef869030aa49ccfe6ee8bef3861585c426ad3'
assert not (t/'.next/dev/lock').exists() and port_closed()
env=os.environ.copy();env.update({'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','PLAYWRIGHT_BROWSERS_PATH':'/Users/chriswong/Library/Caches/ms-playwright'})
for key in ['CAPTURE_ONLY','UPDATE_HEATMAP_EVIDENCE','CAPTURE_HEAD','TERMINAL_CROP_WEBPACK','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_EVIDENCE_MODE','TERMINAL_NATIVE_CAPTURE_ID','EXPOSURE_P09_CURRENT_WITNESS','EXPOSURE_P09_PREVIOUS_WITNESS','EXPOSURE_NATIVE_WITNESS','TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE','TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE','TERMINAL_EXPOSURE_PAINT_PROBE']:env.pop(key,None)
assert (Path(env['PLAYWRIGHT_BROWSERS_PATH'])/'chromium_headless_shell-1228').is_dir()
js="const x=require('./terminal/e2e/tools/optionsExposureEvidence.cjs');const n=require('./terminal/e2e/tools/capture_ci_evidence.cjs');console.log(JSON.stringify({gex:x.optionsIntegrationInputs('gex'),eod:x.optionsIntegrationInputs('eod'),browser:x.optionsIntegrationBrowserInputs(),expiry:x.expiryGreeksJourneyInputs(),specs:x.OPTIONS_INTEGRATION_BROWSER_SPECS,crops:{gex:n.nativeDefinition('gex').files,eod:n.nativeDefinition('eod').files}}));"
inputs=json.loads(subprocess.check_output(['node','-e',js],cwd=repo,env=env,text=True))
assert {k:len(inputs[k]) for k in ['gex','eod','browser','expiry','specs']}=={'gex':29,'eod':32,'browser':71,'expiry':76,'specs':6}
put(proof/'reviewed-input-sets.json',inputs)
pins={'terminal/e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs':'671062f250f16c812ffdebfb1714d5c62a8c54be0f439fa34dc1e70452c086e9','terminal/e2e/tools/capture_gex_levels_heatmap_load_failure.cjs':'dbb92e88972bd39984427d054f431159401fcb16bd49b4479cc1c83456f7777d'}
assert all(sha(repo/p)==v for p,v in pins.items())
eodRoot=t/'docs/pr-crops/eod-heatmap-flowdesk-load-failure';eodPrior=eodRoot/'operations'/operation/'revisions/options-integration-20261109'
eodSources=json.loads((eodPrior/'capture-sources-before.json').read_text())
assert all(sha(repo/p)==eodSources[p] for p in inputs['eod'])
assert sha(eodPrior/'native-packet.json')=='77b3b7f07746290cad33262a3d95c221e947a5acd5e940ae95b9d9458f510a18'
put(proof/'retained-eod-applicability.json',{'schema':'terminal_pr645_retained_eod_applicability.v1','state':'CURRENT','capturedAtHead':'90f275f15b4d174f003fb5b1087823dce6ec865a','revision':'options-integration-20261109','descriptorSha256':sha(eodPrior/'native-packet.json'),'currentSources':{p:sha(repo/p) for p in inputs['eod']},'producerPins':pins,'at':now()})
(proof/'retained-eod-root-before.yml').write_bytes((eodRoot/'EVIDENCE.yml').read_bytes())
packetRoot=t/'docs/pr-crops'/packet;revision=packetRoot/'operations'/operation/'revisions'/revisionName;cropOut=revision/'qualified-root'
assert not revision.exists();revision.mkdir(parents=True);shutil.copy2(packetRoot/'EVIDENCE.yml',revision/'EVIDENCE.before.yml')
def history_snapshot():
 return {str(p.relative_to(repo)):sha(p) for root in [packetRoot,eodRoot] for p in sorted(root.rglob('*')) if p.is_file() and not p.is_relative_to(revision)}
historyBefore=history_snapshot();put(proof/'native-history-before.json',historyBefore)
paths=set(git('ls-files','--cached','--others','--exclude-standard').splitlines())
sourcePaths=sorted(p for p in paths if p.startswith('terminal/') and not p.startswith(('terminal/docs/','terminal/test-results/','terminal/node_modules/','terminal/.next/')) and re.search(r'\.(?:ts|tsx|css|js|cjs|mjs|json)$',p))
assert set(inputs['expiry']).issubset(sourcePaths)
def snapshot():return {p:sha(repo/p) for p in sourcePaths}
put(revision/'source-contract.json',{'schema':'exposure_master_capture_sources.v1','kind':kind,'currentInputs':inputs[kind],'observedInputs':sourcePaths})
before=snapshot();put(revision/'capture-sources-before.json',before)
captureId='terminal-pr645-gex-expiry-greeks-integration-20261110-r1';localEnv={**env,'TERMINAL_CROP_OUTPUT_DIR':str(cropOut),'TERMINAL_CROP_PORT':str(port),'TERMINAL_NATIVE_CAPTURE_ID':captureId}
log=revision/'capture.log';supervision=proof/'gex-supervision-r1.json';assert not log.exists() and not supervision.exists()
git('add','--','terminal/e2e/tools/optionsExposureEvidence.cjs','terminal/e2e/tools/optionsExposureEvidence.d.cts','terminal/lib/__tests__/helpers/optionsExposureEvidence.ts')
tree=git('write-tree');started=now();start=time.monotonic();command=['node',str(proof/'native-driver.cjs'),kind,str(port),str(supervision),str(log)]
record={'schema':'terminal_pr645_native_successor_validation.v1','state':'RUNNING','head':head,'protectedBase':base,'integratedDependency':dependency,'captureId':captureId,'startedAt':started,'sourceFiles':len(before),'sourceTree':tree,'port':port,'command':command,'expected':count}
recordPath=proof/'native-validation-r1.json';assert not recordPath.exists();put(recordPath,record)
print(json.dumps(record),flush=True)
try:
 child=subprocess.run(command,env=localEnv,capture_output=True,text=True)
 supervised=json.loads(supervision.read_text());result=supervised.get('result',{});after=snapshot();put(revision/'capture-sources-after.json',after)
 raw=log.read_text();matches=list(re.finditer(r'capture ([a-z0-9-]+\.png) … ',raw));frames=[]
 for i,m in enumerate(matches):
  segment=raw[m.end():matches[i+1].start() if i+1<len(matches) else len(raw)];lines=[x.strip() for x in segment.splitlines()]
  frames.append({'file':m.group(1),'status':'success' if not any(x.startswith('FAIL ') for x in lines) and 'ok' in lines else 'failure'})
 images={}
 for p in sorted(cropOut.glob('*.png')):
  b=p.read_bytes();assert b[:8]==b'\x89PNG\r\n\x1a\n';w,h=struct.unpack('>II',b[16:24]);images[p.name]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'width':w,'height':h}
 receipts=[]
 for line in raw.splitlines():
  try:
   v=json.loads(line)
   if isinstance(v,dict) and 'nativeEvidence' in v:receipts.append(v['nativeEvidence'])
  except json.JSONDecodeError:pass
 manifest=cropOut/'EVIDENCE.yml'
 execution={'schema':'exposure_master_integration_capture.v1','operation':operation,'revision':revisionName,'kind':kind,'packet':packet,'branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'indexTreeAtStart':tree,'command':['node','e2e/tools/capture_gex_levels_heatmap_load_failure.cjs'],'supervisionCommand':command,'supervisionExit':child.returncode,'captureId':captureId,'nativeSupervisor':result,'nativeServerEvents':supervised.get('events',[]),'nativeReceipt':receipts[0] if len(receipts)==1 else None,'port':port,'webpack':False,'startedAt':started,'completedAt':now(),'seconds':round(time.monotonic()-start,2),'exit':result.get('status'),'expected':count,'successfulFiles':sum(x['status']=='success' for x in frames),'frames':frames,'sourceStable':before==after,'portClosed':port_closed(),'nextLockAbsent':not(t/'.next/dev/lock').exists(),'ownedServerStopped':False,'producerPins':pins,'sourceBeforeSha256':sha(revision/'capture-sources-before.json'),'sourceAfterSha256':sha(revision/'capture-sources-after.json'),'manifestSha256':sha(manifest) if manifest.exists() else None,'images':images,'logSha256':sha(log),'supervisionReceiptSha256':sha(supervision)}
 put(revision/'capture-execution.json',execution)
 assert child.returncode==0 and supervised['state']=='CLOSED' and result['closed'] and result['status']==0 and result['serverReportedStopped'] and result['serverSettled'] and not result['serverRefused'] and not result['error'],supervised
 execution['initialNextLockAbsent']=execution['nextLockAbsent'];execution['lifecycle']=reconcile_lock(result);execution['portClosed']=port_closed();execution['nextLockAbsent']=not(t/'.next/dev/lock').exists();execution['ownedServerStopped']=True;put(revision/'capture-execution.json',execution)
 expected=sorted(inputs['crops'][kind])
 assert before==after and len(frames)==count and sorted(x['file'] for x in frames)==expected and all(x['status']=='success' for x in frames) and sorted(images)==expected and manifest.exists(),{'frames':len(frames),'images':len(images),'sourceStable':before==after,'logTail':raw[-4000:]}
 assert historyBefore==history_snapshot()
 assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency
 verify="const fs=require('fs');const x=require('./terminal/e2e/tools/optionsExposureEvidence.cjs');const n=require('./terminal/e2e/tools/capture_ci_evidence.cjs');x.requireIntegrationExecution(JSON.parse(fs.readFileSync(process.argv[1])),'gex',n.nativeDefinition('gex').files,'expiry-greeks-integration');"
 subprocess.run(['node','-e',verify,str(revision/'capture-execution.json')],cwd=repo,env=env,capture_output=True,text=True,check=True)
 record.update({'state':'NATIVE_CAPTURE_QUALIFIED_PENDING_BROWSER_AND_DESCRIPTOR','completedAt':now(),'successfulFiles':114,'sourceStable':True,'ownedServerStopped':True,'seconds':execution['seconds'],'executionSha256':sha(revision/'capture-execution.json'),'manifestSha256':sha(manifest),'historicalPacketFilesUnchanged':len(historyBefore)})
 put(recordPath,record);print(json.dumps(record),flush=True)
except BaseException as error:
 record.update({'state':'FAILED','error':str(error),'completedAt':now()});put(recordPath,record);print(json.dumps(record),flush=True);raise
