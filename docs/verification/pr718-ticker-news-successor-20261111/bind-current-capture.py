from pathlib import Path
import ast,collections,datetime,hashlib,json,os,subprocess,time
w=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-718-compare-successor')
p=w/'docs/verification/pr718-ticker-news-successor-20261111';t=w/'terminal';packet=t/'docs/pr-crops/ticker-news'
node=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1275-conflict-successor/.pr1275-conflict-runtime/node-v22.23.4-darwin-arm64/bin/node')
head='01550eaca9e1e1f8d816e6fef785b38998710b43'
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def read(rel):return json.loads((p/rel).read_text())
def put(rel,x):
 f=p/rel;assert not f.exists(),str(f)
 f.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n');assert json.loads(f.read_text())==x
def git(*a):return subprocess.check_output(['git','-C',str(w),*a]).decode().strip()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def ns(s):return int(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1e9)
assert git('rev-parse','HEAD')==head
assert not git('diff','--cached','--name-only') and not git('diff','--name-only','--diff-filter=U')
assert set(git('diff','--name-only').splitlines())<={'terminal/docs/pr-crops/ticker-news/unavailable-desktop-en-dark.png'}
for name in ['visual-review.json','qualification.json','manifest-binding.json','source-consumer-execution.json','README.md','inventory.json']:assert not(p/name).exists(),name
run=read('browser-current/execution.json')
assert run['state']=='QUALIFIED' and run['exit']==0
assert {k:run['stats'][k] for k in ['expected','skipped','unexpected','flaky']}=={'expected':14,'skipped':7,'unexpected':0,'flaky':0}
assert run['head']==head and run['sourceTree']==git('rev-parse','HEAD^{tree}')=='e2cf25126668a68cdf585be25092e52a589eb849'
assert run['sourceEntries']==2121 and run['sourceStable'] and run['newerPacketsUnchanged'] and not run['reportErrors']
assert run['compositionParents']==git('show','-s','--format=%P',head).split()==['26862a671763d6eea4a1ea3b93f3bfc79114b6e1','18fabe9d3c1439c4185559ba5ce491518fe999c9','59f101192d6b48d72b850f98c2428f27a04652bf']
assert run['protectedMaster']=='18fabe9d3c1439c4185559ba5ce491518fe999c9'
assert sha(p/'capture-news.py')==run['wrapperSha256']=='2b2fb07824c574abd0177b6a11e05cc27f963ad65504fff27be1cc074f12aad3'
source=read('browser-current/source-before.json')
assert source==read('browser-current/source-after.json') and len(source)==2121
tree=ast.parse((p/'capture-news.py').read_text())
extra=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(a,ast.Name) and a.id=='extraPaths' for a in n.targets))
def snapshot():
 d=json.loads(subprocess.check_output([str(node),'-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=w).decode())
 return {rel:sha(w/rel) for rel in sorted(set(d)|set(extra))}
assert snapshot()==source
assert sha(node)=='2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0'
cases=run['cases'];assert len(cases)==21 and len({(c['file'],c['project'],c['title']) for c in cases})==21
assert all(len(c['results'])==1 and c['results'][0]['retry']==0 and c['results'][0]['status'] in ['passed','skipped'] for c in cases)
counts=dict(collections.Counter(c['results'][0]['status'] for c in cases));assert counts=={'passed':14,'skipped':7}
assert all(run[k] for k in ['ownedPortClosed','nextLockAbsent','manifestUnchangedUntilBinding'])
life=read('ticker-news-browser-current-lifecycle.json')
assert life['state']=='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED'
assert sha(p/'ticker-news-browser-current-lifecycle.json')==run['lifecycle']['sha256']
assert not(t/'.next/dev/lock').exists()
probe=subprocess.run(['lsof','-nP','-iTCP:61886','-sTCP:LISTEN'],capture_output=True,text=True)
assert probe.returncode==1 and not probe.stdout.strip() and not probe.stderr.strip()
modern=read('newer-packets-before.json');families=['ticker-news-editorial-views','ticker-news-recovery','ticker-news-cn-hk']
def modern_now():return {str(f.relative_to(w)):sha(f) for name in families for f in (t/'docs/pr-crops'/name).rglob('*') if f.is_file()}
assert len(modern)==103 and modern_now()=={k:v['sha256'] for k,v in modern.items()}
prior=read('prior-packet-preservation.json')
assert len(prior['files'])==11 and all(sha(p/'prior-packet'/n)==v['sha256'] for n,v in prior['files'].items())
accepted=read('accepted-proof-preservation.json')
assert git('rev-parse',head+':'+accepted['acceptedComparePacket'])==accepted['acceptedCompareTree']=='0b8c80a43db890f67878af75e179d8dbb38e437c'
assert not git('diff',head,'--',accepted['acceptedComparePacket'],accepted['historicalNewsArchive'])
assert git('rev-parse',head+':'+accepted['historicalNewsArchive'])==accepted['protectedArchiveTree']=='b5d4e3f1f9d80ca7962f2345c47dfcb21cf5d804'
assert all(sha(w/accepted['historicalNewsArchive']/n)==v for n,v in accepted['files'].items())
manifest=packet/'EVIDENCE.yml';old=manifest.read_bytes()
assert sha(manifest)==run['priorManifestSha256']==prior['files']['EVIDENCE.yml']['sha256']=='5e85344159652ac23cfc17e3542e0d02225cc97965f9505df9ef085df85374db'
names=sorted(run['images']);assert len(names)==10 and sorted(f.name for f in packet.glob('*.png'))==names
images={}
for name in names:
 f=packet/name;v=run['images'][name]
 assert sha(f)==v['sha256'] and f.stat().st_size==v['bytes'] and v['modifiedDuringCapture']
 assert ns(run['startedAt'])<=f.stat().st_mtime_ns<=ns(run['completedAt'])
 images[name]={**v,'producingRun':'browser-current/execution.json','observedMtimeNs':f.stat().st_mtime_ns}
for rel,v in read('generated-preimages.json').items():
 assert(w/rel).exists()==v['present']
 if v['present']:assert sha(w/rel)==v['sha256']==sha(p/v['backup'])
assert git('rev-parse',head+':terminal/lib/__tests__/tickerNewsEvidence.test.ts')=='26447f52751c5c66b0de909208ad8da002166b75'
visual={'schema':'terminal.pr718.news-visual-review.v1','state':'REVIEWED','sourceHead':head,'reviewer':'assigned ChatGPT principal; source contributor; self-check only','reviewedAt':now(),'method':'Viewed all ten actual PNGs through original C3 read_file image output; exact bytes matched to the qualified current capture.','findings':'EN/ZH labels, headline wrapping, source badges and actions remain readable at desktop, tablet and mobile viewports. Unavailable copy and Retry are visible without overlap or clipping. Viewport labels refer to browser viewports, not panel crop dimensions. Existing fixture headlines retain their authored language.','images':[{'file':name,'sha256':images[name]['sha256'],'verdict':'PASS'} for name in names]}
put('visual-review.json',visual)
qualification={'schema':'terminal.pr718.news-source-qualification.v1','state':'QUALIFIED_CURRENT_CAPTURE','qualifiedAt':now(),'head':head,'sourceTree':run['sourceTree'],'compositionParents':run['compositionParents'],'protectedAncestor':run['protectedMaster'],'sourceEntries':2121,'sourceSnapshotsIdentical':True,'sourceSnapshotSha256':sha(p/'browser-current/source-before.json'),'qualifiedUniqueCases':cases,'qualifiedCounts':counts,'executionSha256':sha(p/'browser-current/execution.json'),'browserReportSha256':sha(p/'browser-current/browser-report.json'),'singleCaptureInvocation':True,'retries':0,'images':images,'visualReviewSha256':sha(p/'visual-review.json'),'priorManifestSha256':sha(manifest),'preservedNeighborFiles':103,'priorPacketFiles':11,'acceptedCompareProofPreserved':accepted['acceptedCompareTree'],'ownedLifecycleSettled':True,'preparationReconciliationSha256':sha(p/'preparation-reconciliation.json'),'scope':'Real local fixture-backed UI and unchanged producer contracts; no authenticated provider, installed-generation, or production-news acceptance.'}
put('qualification.json',qualification)
layouts=['terminal/components/news/TickerNewsPanel.tsx','terminal/components/news/TickerNewsPanel.module.css','terminal/components/TerminalShell.tsx']
assert source[layouts[2]]=='bc6a6138369de95c86aaefec90f63e6a1a6fde835f9e285fbebf9604410d9075'
lines=['# Current source qualification: 14 passing cases and 7 authored project skips across 21 unique cases.','# One complete desktop/tablet/mobile invocation, zero unexpected results, flakes or retries.','# All ten panel crops were freshly captured within that invocation.','# Source tree: '+run['sourceTree'],'# Protected ancestor: '+run['protectedMaster'],'# Proof: docs/verification/pr718-ticker-news-successor-20261111/qualification.json','# Source snapshot SHA256: '+sha(p/'browser-current/source-before.json'),'# Panel crops: viewport labels describe browser viewports, not PNG dimensions.','capturedAtHead: '+head,'layoutFiles:']
for rel in layouts:lines+=['  - path: '+rel,'    sha256: '+source[rel]]
lines+=['crops:'];viewports={'desktop':'1440x900','tablet':'820x1180','mobile':'390x844'}
for name in names:
 parts=name.removesuffix('.png').split('-');unavailable=parts[0]=='unavailable';size,lang=parts[1:3] if unavailable else parts[:2]
 lines+=['  - file: '+name,'    viewport: '+viewports[size],'    lang: '+lang,'    state: '+('unavailable' if unavailable else 'live-feed'),'    sha256: '+images[name]['sha256']]
manifest.write_text('\n'.join(lines)+'\n')
binding={'schema':'terminal.pr718.news-manifest-binding.v1','state':'CURRENT_CAPTURE_BOUND','boundAt':now(),'captureHead':head,'sourceTree':run['sourceTree'],'sourceEntries':2121,'qualificationSha256':sha(p/'qualification.json'),'priorManifestSha256':hashlib.sha256(old).hexdigest(),'currentManifestSha256':sha(manifest),'layouts':{rel:source[rel] for rel in layouts},'images':{name:images[name]['sha256'] for name in names},'scope':qualification['scope']}
put('manifest-binding.json',binding)
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP','PATH'] if k in os.environ};env['PATH']=str(node.parent)+':'+os.environ['PATH']
command=[str(node),'node_modules/vitest/vitest.mjs','run','lib/__tests__/tickerNewsEvidence.test.ts','--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(p/'source-consumer-report.json')]
started=now();clock=time.monotonic()
with(p/'source-consumer.log').open('x') as out:r=subprocess.run(command,cwd=t,env=env,stdout=out,stderr=subprocess.STDOUT)
report=read('source-consumer-report.json') if(p/'source-consumer-report.json').exists() else {}
after=snapshot();ok=r.returncode==0 and report.get('numPassedTests')==4 and report.get('numFailedTests')==0 and report.get('success') is True and after==source
receipt={'schema':'terminal.pr718.news-source-consumer.v1','state':'PASS' if ok else 'FAILED','head':head,'command':command,'startedAt':started,'completedAt':now(),'seconds':round(time.monotonic()-clock,2),'exit':r.returncode,'passed':report.get('numPassedTests'),'failed':report.get('numFailedTests'),'reportSha256':sha(p/'source-consumer-report.json') if report else None,'logSha256':sha(p/'source-consumer.log'),'sourceStillIdentical':after==source,'manifestSha256':sha(manifest)}
put('source-consumer-execution.json',receipt)
print(json.dumps({'binding':binding['state'],'qualification':qualification['state'],'qualifiedCounts':counts,'images':10,'sourceEntries':2121,'neighborsPreserved':103,'guard':receipt}),flush=True)
assert ok,'FOCUSED_GUARD_FAILED_NO_BLIND_REPLAY'
readme="""# PR 718 ticker-news source qualification

The immutable capture source is 01550eaca9e1e1f8d816e6fef785b38998710b43, tree e2cf25126668a68cdf585be25092e52a589eb849, with ordered parents 26862a671763d6eea4a1ea3b93f3bfc79114b6e1, 18fabe9d3c1439c4185559ba5ce491518fe999c9 and 59f101192d6b48d72b850f98c2428f27a04652bf. It composes the original Compare work with the actual protected baseline and #1407's qualified source/evidence. The only novel application blob is TerminalShell's combination of the existing Compare overflow action with the protected and workspace changes. Source object publication receipts are retained; the original PR ref remained at 26862a6 during capture.

## Actual execution and review

One complete existing ticker-news spec invocation passed fourteen cases with seven authored project skips, zero unexpected results, flakes or retries. All ten original panel PNGs were freshly produced within that invocation. The principal visually reviewed all ten actual files, including EN/ZH desktop, tablet, mobile and unavailable states. Nine PNGs are byte-identical to the inherited packet; timestamps and producer receipts establish actual recapture. One unavailable-desktop crop changed bytes.

Before/after and fresh membership-discovering snapshots agree across 2,121 source inputs. The prior eleven-file active packet, older protected eleven-file archive, all 103 neighboring editorial/recovery/CN-HK files and accepted Compare packet are preserved. The accepted 64 tests and twelve Chromium/WebKit Compare journeys were not rerun or restamped.

The initial preparation assumed a missing private Playwright module path and stopped before capture mutation. Official CLI dry-run discovery established the already-installed matching browser location. A second preparation stopped on a preexisting Next lock. Exact stale ownership and server absence were proved before cleanup; cleanup succeeded, but its return formatting failed afterward. Original receipt and independent readback establish the applied cleanup; it was never replayed. The actual browser capture started once, after preparation qualified. Its own server/lock lifecycle is settled and generated preimages match.

## Binding and validation

qualification.json binds actual cases, fresh images, source closure and lifecycle. visual-review.json records the ten exact image hashes. EVIDENCE.yml and manifest-binding.json name the real capture commit, three exact layout hashes and ten image hashes. No future publication commit is presented as the capture head. The unchanged tickerNewsEvidence.test.ts consumer passed all four tests with source inputs still identical. inventory.json records exact packet membership.

The current source composition preserves inherited workspace, editorial and other separately qualified packets. Full natural head CI owns any required VI/PL6 composition recapture; inherited history and this focused news guard do not substitute for that stage.

## Acceptance and publication boundary

This is fixture-backed local browser proof, not authenticated provider, installed production or live-news acceptance. Principal visual/diff review is a self-check, not formal independent GitHub approval. Draft/hold and current release dependencies remain until explicitly reconciled by their owners. The evidence publication is a child of the real capture source, through the original native GitHub-object publisher and original PR branch; local managed-branch continuity is not a second publisher.
"""
(p/'README.md').write_text(readme)
files={str(f.relative_to(p)):{'bytes':f.stat().st_size,'sha256':sha(f)} for f in sorted(p.rglob('*')) if f.is_file() and f.name!='inventory.json'}
put('inventory.json',{'schema':'terminal.pr718.news-packet-inventory.v1','files':files,'count':len(files),'bytes':sum(v['bytes'] for v in files.values())})
assert snapshot()==source and modern_now()=={k:v['sha256'] for k,v in modern.items()}
assert not(t/'.next/dev/lock').exists()
print(json.dumps({'state':'BOUND_GUARD_PASSED_PACKET_READY','manifestSha256':sha(manifest),'inventoryFiles':len(files),'inventoryBytes':sum(v['bytes'] for v in files.values()),'trackedDiff':git('diff','--name-only')}),flush=True)
