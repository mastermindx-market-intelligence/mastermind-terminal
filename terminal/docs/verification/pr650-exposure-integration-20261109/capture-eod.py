from pathlib import Path
import subprocess,json,hashlib,os,re,time,datetime,struct,shutil
repo=Path('/Volumes/Mastermind 2/agent-workspaces/terminal/review/terminal-pr650-exposure-integration-20261109');root=repo/'terminal';runtime=root/'test-results/pr650-exposure-integration-20261109'
head='282ea2c40d839fecbe5ae5dc53de9c29a02850f6';base='b387616013f38cce9e467cc7da7b87fd2672718c';dependency='663983edd16fc64e86003b420e97d557982b1bf2'
kind='eod';packet='eod-heatmap-flowdesk-load-failure';port=3801;count=126;revisionName='ui-copy-integration-20261109'
def git(*args):return subprocess.run(['git','-C',str(repo),*args],capture_output=True,text=True,check=True).stdout.strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency and not git('diff','--name-only','--diff-filter=U')
assert not (root/'.next/dev/lock').exists() and subprocess.run(['lsof','-t','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True).returncode==1
inputs=json.loads((runtime/'reviewed-input-sets.json').read_text());assert {k:len(v) for k,v in inputs.items()}=={'gex':27,'eod':30,'browser':68,'specs':5}
producerPins={'terminal/e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs':'8c8cd2448ce05a336f40fd020f9d172534c72df834f2b3a6ff2d33d82b6bfc5e','terminal/e2e/tools/capture_gex_levels_heatmap_load_failure.cjs':'d1a4781a4a8147ccaef7360126dfedb038e8bc14e565853363e562074677888e'}
assert all(sha(repo/p)==v for p,v in producerPins.items())
gex=root/'docs/pr-crops/gex-levels-heatmap-load-failure/operations/exposure-source-compatibility-20261105/revisions/indicator-guard-20261109'
assert sha(gex/'native-packet.json')=='c0d9dc8fff216b73afc8dbc3490ca9bd84fbeecde6fe14eeac1452af5e0c0f1b'
gexBefore=json.loads((gex/'capture-sources-before.json').read_text())
assert all(sha(repo/p)==gexBefore[p] for p in inputs['gex'])
gexDescriptor=json.loads((gex/'native-packet.json').read_text());assert all(sha(gex/p)==v for p,v in gexDescriptor['files'].items())
gexExecution=json.loads((gex/'capture-execution.json').read_text());assert gexExecution['successfulFiles']==114 and gexExecution['exit']==0 and gexExecution['sourceStable'] and all(sha(gex/'qualified-root'/p)==v['sha256'] for p,v in gexExecution['images'].items())
put(runtime/'retained-gex-verification.json',{'descriptorSha256':sha(gex/'native-packet.json'),'branchHead':gexExecution['branchHead'],'currentInputs':{p:gexBefore[p] for p in inputs['gex']},'producerPins':producerPins,'physicalImages':len(gexExecution['images']),'recaptured':False})
paths=set(git('ls-files','--cached','--others','--exclude-standard').splitlines())
sourcePaths=sorted(p for p in paths if p.startswith('terminal/') and not p.startswith(('terminal/docs/','terminal/test-results/','terminal/node_modules/','terminal/.next/')) and re.search(r'\.(?:ts|tsx|css|js|cjs|mjs|json)$',p))
assert all(p in sourcePaths for p in inputs['browser'])
def snapshot():return {p:sha(repo/p) for p in sourcePaths}
packetRoot=root/'docs/pr-crops'/packet;revision=packetRoot/'operations/exposure-source-compatibility-20261105/revisions'/revisionName;out=revision/'qualified-root'
assert not revision.exists();revision.mkdir(parents=True);shutil.copy2(packetRoot/'EVIDENCE.yml',revision/'EVIDENCE.before.yml')
put(revision/'source-contract.json',{'schema':'exposure_master_capture_sources.v1','kind':kind,'currentInputs':inputs[kind],'observedInputs':sourcePaths})
put(revision/'history.json',{'schema':'exposure_ui_copy_history.v1','branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'packet':packet,'predecessor':{'revision':'indicator-guard-20261109','descriptorSha256':'eb5a4aac927a5bf8f308f1b6536e7992306df2a78e110cc8012099a4dc185ba9'},'published650Archive':{'inventory':'terminal/docs/verification/pr650-exposure-integration-20261109/prior-published650-eod-sha256.json','sha256':'16c19dfdbdf40c78660be968782fd85919550185a5c0490a273458cde2300404'}})
test=(root/'lib/__tests__/eodHeatmapFlowdeskLoadFailureEvidence.test.ts').read_text();states=re.findall(r'"([a-z0-9-]+)"',re.search(r'const STATES = \[(.*?)\];',test,re.S).group(1));expected=sorted(f'{s}-{w}{suffix}.png' for s in states for w in [1440,820,390] for suffix in ['', '-zh']);assert len(expected)==count
before=snapshot();put(revision/'capture-sources-before.json',before)
env=os.environ.copy()
env["PLAYWRIGHT_BROWSERS_PATH"]=str(root/"test-results/pr650-exposure-integration-20261109/playwright-browsers")
for key in ['CAPTURE_ONLY','UPDATE_HEATMAP_EVIDENCE','CAPTURE_HEAD','TERMINAL_CROP_WEBPACK']:env.pop(key,None)
env.update({'TERMINAL_CROP_OUTPUT_DIR':str(out),'TERMINAL_CROP_PORT':str(port)})
cmd=['node','e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs'];log=revision/'capture.log';assert not log.exists();started=datetime.datetime.now(datetime.timezone.utc).isoformat();start=time.monotonic();git('add','-A');tree=git('write-tree')
print(json.dumps({'starting':kind,'count':count,'port':port,'sourceFiles':len(before),'sourceTree':tree,'retainedGexImages':114}),flush=True)
with log.open('w') as h:r=subprocess.run(cmd,cwd=root,env=env,stdout=h,stderr=subprocess.STDOUT)
after=snapshot();put(revision/'capture-sources-after.json',after)
raw=log.read_text();matches=list(re.finditer(r'capture ([a-z0-9-]+\.png) … ',raw));frames=[]
for i,m in enumerate(matches):
 segment=raw[m.end():matches[i+1].start() if i+1<len(matches) else len(raw)];lines=[l.strip() for l in segment.splitlines()];fail=any(l.startswith('FAIL ') for l in lines);ok=not fail and 'ok' in lines;frames.append({'file':m.group(1),'status':'success' if ok else 'failure'})
pngs=sorted(p.name for p in out.glob('*.png'));images={}
for name in pngs:
 b=(out/name).read_bytes();assert b[:8]==b'\x89PNG\r\n\x1a\n';width,height=struct.unpack('>II',b[16:24]);images[name]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'width':width,'height':height}
portClosed=subprocess.run(['lsof','-t','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True).returncode==1;lockAbsent=not (root/'.next/dev/lock').exists();manifest=out/'EVIDENCE.yml'
result={'schema':'exposure_master_integration_capture.v1','operation':'exposure-source-compatibility-20261105','revision':revisionName,'kind':kind,'packet':packet,'branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'indexTreeAtStart':tree,'command':cmd,'port':port,'webpack':False,'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'seconds':round(time.monotonic()-start,2),'exit':r.returncode,'expected':count,'successfulFiles':sum(x['status']=='success' for x in frames),'frames':frames,'sourceStable':before==after,'portClosed':portClosed,'nextLockAbsent':lockAbsent,'producerPins':producerPins,'sourceBeforeSha256':sha(revision/'capture-sources-before.json'),'sourceAfterSha256':sha(revision/'capture-sources-after.json'),'manifestSha256':sha(manifest) if manifest.exists() else None,'images':images,'logSha256':sha(log),'node':subprocess.run(['node','--version'],capture_output=True,text=True,check=True).stdout.strip()}
put(revision/'capture-execution.json',result)
valid=r.returncode==0 and before==after and len(frames)==count and sorted(x['file'] for x in frames)==expected and all(x['status']=='success' for x in frames) and pngs==expected and manifest.exists() and portClosed and lockAbsent
print(json.dumps({'finished':kind,'accepted':valid,'exit':r.returncode,'frames':len(frames),'successful':result['successfulFiles'],'images':len(images),'sourceStable':before==after,'portClosed':portClosed,'nextLockAbsent':lockAbsent,'seconds':result['seconds']}),flush=True)
if not valid:print(raw[-10000:],flush=True);raise SystemExit(1)
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency
files=['capture-execution.json','capture-sources-before.json','capture-sources-after.json','source-contract.json','qualified-root/EVIDENCE.yml','history.json','EVIDENCE.before.yml','capture.log']
put(revision/'native-packet.json',{'schema':'options_exposure_master_packet.v1','kind':kind,'profile':'exposure','operation':'exposure-source-compatibility-20261105','captureRevision':revisionName,'branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'files':{p:sha(revision/p) for p in files}})
print(json.dumps({'nativeDescriptorSha256':sha(revision/'native-packet.json'),'currentInputs':30}),flush=True)
