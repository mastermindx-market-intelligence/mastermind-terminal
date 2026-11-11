from pathlib import Path
import json,hashlib,subprocess,os,time,datetime
w=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/d06-terminal-reader-resilience-20261103-c4')
NODE_SOURCE="const fs=require(\"node:fs\"),path=require(\"node:path\"),cp=require(\"node:child_process\");\nconst repo=\"/Volumes/Mastermind/agent-workspaces/terminal/web/d06-terminal-reader-resilience-20261103-c4\";\nconst terminal=path.join(repo,\"terminal\"),diagnostics=path.join(repo,\"docs/verification/pr1270-d06-successor-20261111/options-axis\");\nconst owner=require(path.join(terminal,\"e2e/tools/capture_ci_evidence.cjs\"));\nconst evidence=require(path.join(terminal,\"e2e/tools/visualEvidence.cjs\"));\nconst {ownedServer}=require(path.join(terminal,\"e2e/tools/capture_pl6_batch1.cjs\"));\nconst ids={prefix:\"terminal-pr1270-options-axis-current-20261111\",pl6:\"axis-producer\"};\nconst git=arg=>cp.execFileSync(\"git\",[\"rev-parse\",arg],{cwd:repo,encoding:\"utf8\"}).trim();\nconst record={schema:\"terminal_pr1270_attended_axis_capture.v1\",state:\"PREPARING\",ids,operation:ids.prefix,\n ...owner.checkoutIdentity(repo,process.env),\n actualGit:{head:git(\"HEAD\"),headTree:git(\"HEAD^{tree}\"),mergeHead:git(\"MERGE_HEAD\"),indexTree:cp.execFileSync(\"git\",[\"write-tree\"],{cwd:repo,encoding:\"utf8\"}).trim()},\n publishedBasis:\"4deaa727aa862eb6d004b35dbcfba7d86ecb2a4e\",sourceIdentity:\"stable-composed-working-tree\",productionProof:false,startedAt:new Date().toISOString()};\nconst recordPath=path.join(diagnostics,\"owner-record.json\");\nfunction save(){fs.writeFileSync(recordPath,JSON.stringify(record,null,2)+\"\\n\");}\nasync function main(){\n if(record.actualCheckout.commit!==\"357c32f1a330dda9362955361ae0ab30a3e54048\"||record.actualCheckout.tree!==\"e0071b0769420d5837e6a6767b696752462c449a\"||record.actualGit.indexTree!==\"eb208c788e69f4d3c03416edf2fe96a6bf7dcddd\"||record.actualGit.mergeHead!==\"18fabe9d3c1439c4185559ba5ce491518fe999c9\")throw Error(\"CURRENT_CUSTODY_CHANGED\");\n if(Object.values(record.githubEvent).some(x=>x!==null))throw Error(\"UNEXPECTED_GITHUB_IDENTITY\");\n save();record.optionsAxis=owner.prepareOptions({repoRoot:repo,diagnostics,ids});save();\n if(!record.optionsAxis.required)throw Error(\"CAPTURE_NO_LONGER_REQUIRED_RECONCILE_OWNER\");\n let server,originalError,settlementError,archiveError;\n try{\n  server=owner.startLegacyServer(terminal,57737);\n  record.server={pid:server.pid,pgid:server.pid,port:57737,baseURL:\"http://127.0.0.1:57737\"};record.state=\"SERVER_STARTING\";save();\n  await owner.waitLegacyServer(server,\"http://127.0.0.1:57737/terminal?symbol=NVDA\",120000);\n  record.server.ready=ownedServer(server);record.state=\"CAPTURING\";save();\n  await owner.captureOptions({server,ownedServer,baseURL:\"http://127.0.0.1:57737\",terminal,env:process.env});\n  record.captureCompleted=true;save();\n }catch(error){originalError=error;record.captureError={name:error.name,message:error.message,code:error.code??null};save();}\n finally{\n  if(server){\n   try{await owner.settleLegacyServer(server);record.server.settled=true;record.server.exitCode=server.exitCode;record.server.signalCode=server.signalCode;save();}\n   catch(error){settlementError=error;record.settlementError={message:error.message,code:error.code??null};save();}\n  }\n  try{record.optionsAxis.returned=owner.archivePacket(repo,\"terminal/docs/pr-crops/options-level-axis-labels\",path.join(diagnostics,ids.prefix+\"-options.returned\"));save();}\n  catch(error){archiveError=error;record.archiveError={message:error.message,code:error.code??null};save();}\n }\n const errors=[originalError,settlementError,archiveError].filter(Boolean);\n if(errors.length){record.state=\"FAILED_RETAINED_ORIGINAL_EFFECTS\";save();throw errors.length===1?errors[0]:new AggregateError(errors,\"AXIS_CAPTURE_AND_SETTLEMENT_FAILURE\");}\n owner.finishOptions({repoRoot:repo,diagnostics,ids,record,evidence});\n record.state=record.optionsAxis.state;record.completedAt=new Date().toISOString();save();\n console.log(JSON.stringify({state:record.state,manifestSha256:record.optionsAxis.manifestSha256,images:Object.keys(record.optionsAxis.images||{}).length,actualCheckout:record.actualCheckout,server:record.server}));\n}\nmain().catch(error=>{process.stderr.write(String(error.stack||error)+\"\\n\");process.exitCode=1;});\n"
p=w/'docs/verification/pr1270-d06-successor-20261111/options-axis'
assert not p.exists()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def lifecycle():
 port=subprocess.run(['lsof','-nP','-iTCP:57737','-sTCP:LISTEN'],capture_output=True,text=True)
 lock=w/'terminal/.next/dev/lock'
 handles=subprocess.run(['lsof','-t',str(lock)],capture_output=True,text=True) if lock.exists() else None
 cwd=subprocess.run(['lsof','-d','cwd','-Fpn'],capture_output=True,text=True)
 holders=[];pid=None
 for line in cwd.stdout.splitlines():
  if line.startswith('p'):pid=line[1:]
  elif line.startswith('n') and (line[1:]==str(w) or line[1:].startswith(str(w)+'/')):holders.append({'pid':pid,'cwd':line[1:]})
 return {'port':57737,'listenerExit':port.returncode,'listeners':port.stdout,'listenerStderr':port.stderr,'lockPathExists':lock.exists(),'lockHandles':handles.stdout if handles else '', 'workspaceCwdHolders':holders}
initial=lifecycle();assert initial['listenerExit']==1 and not initial['listeners'] and not initial['listenerStderr'] and not initial['lockPathExists'] and not initial['workspaceCwdHolders'],initial
assert sha(w/'terminal/e2e/tools/capture_ci_evidence.cjs')=='856da74c32caa80a6bb0d18a243e90db1c3a1c65690c44e5703887a855d834e4'
assert sha(w/'terminal/e2e/tools/capture_pl6_batch1.cjs')=='44d775e7cbeb8c5b0efabf6f6465ec5af6f45816049000d6450baa46aa48f931'
assert sha(w/'terminal/docs/pr-crops/options-level-axis-labels/capture.mjs')=='677c532c8f5a3dcba299131d2a9201e805a22d1cf5eebd14077b67640b391122'
base=json.loads((w/'docs/verification/pr1270-d06-successor-20261111/browser-qualification/source-baseline.json').read_text())
outputs={'terminal/docs/pr-crops/options-level-axis-labels/'+name for name in ['manifest.json','desktop.png','tablet.png','mobile.png','desktop-left-percentage.png','desktop-compact.png']}
sources=sorted(set(base)-outputs);before={s:sha(w/s) for s in sources}
p.mkdir()
def write(path,obj):path.write_text(json.dumps(obj,indent=2,sort_keys=True)+'\n')
write(p/'source-before.json',before)
(p/'attended-axis.cjs').write_text(NODE_SOURCE)
env=os.environ.copy()
for key in ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA','GITHUB_REF','GITHUB_EVENT_PATH','GITHUB_EVENT_NAME','GITHUB_ENV','GITHUB_TOKEN','GH_TOKEN']:env.pop(key,None)
assert not env.get('CI_OPTIONS_REQUIRES_FULL_PL6')
env.update({'TICKER_NEWS_RAIL':'1','INVESTIGATION_API_ADMISSION':'open','TERMINAL_CI_OPTIONS_CAPTURE_ID':'terminal-pr1270-options-axis-current-20261111-options','TERMINAL_LEGACY_CAPTURE_ID':'terminal-pr1270-options-axis-current-20261111','BASE_URL':'http://127.0.0.1:57737'})
record={'state':'RUNNING','operation':'terminal-pr1270-options-axis-current-20261111','sourceFiles':len(sources),'excludedGeneratedInputs':sorted(set(base)&outputs),'initial':initial,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'driverSha256':sha(p/'attended-axis.cjs'),'productionProof':False}
write(p/'execution.json',record);print(json.dumps({'state':'STARTED','sourceFiles':len(sources),'port':57737}),flush=True)
started=time.monotonic()
with (p/'axis-producer.stdout.log').open('w') as out,(p/'axis-producer.stderr.log').open('w') as err:r=subprocess.run(['node',str(p/'attended-axis.cjs')],cwd=w/'terminal',env=env,stdout=out,stderr=err,text=True)
record['exit']=r.returncode;record['seconds']=round(time.monotonic()-started,3)
after={s:sha(w/s) for s in sources};write(p/'source-after.json',after)
record['sourceStable']=before==after;record['lifecycle']=lifecycle();record['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
record['state']='CAPTURE_RETURNED_PENDING_UNIT_VALIDATION' if r.returncode==0 else 'CAPTURE_FAILED'
write(p/'execution.json',record);print(json.dumps(record),flush=True)
assert record['sourceStable'], 'SOURCE_DRIFT'
assert record['lifecycle']['listenerExit']==1 and not record['lifecycle']['listeners'] and not record['lifecycle']['lockHandles'] and not record['lifecycle']['workspaceCwdHolders'],'LIFECYCLE_UNSETTLED'
if r.returncode:
 print((p/'axis-producer.stderr.log').read_text()[-7000:],flush=True);raise SystemExit(r.returncode)
print((p/'axis-producer.stdout.log').read_text()[-5000:],flush=True)
