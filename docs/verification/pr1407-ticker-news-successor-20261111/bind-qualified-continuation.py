from pathlib import Path
import ast,collections,datetime,hashlib,json,os,subprocess,time
w=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-experience-refinement-20261109-sol-01')
p=w/'docs/verification/pr1407-ticker-news-successor-20261111';t=w/'terminal';packet=t/'docs/pr-crops/ticker-news'
node=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1275-conflict-successor/.pr1275-conflict-runtime/node-v22.23.4-darwin-arm64/bin/node')
head='5338557e44e2a8b5ca789aac7cd295037db9692d'
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def read(rel):return json.loads((p/rel).read_text())
def put(rel,x):
 f=p/rel;assert not f.exists(),str(f);f.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n');assert json.loads(f.read_text())==x
def git(*a):return subprocess.check_output(['git','-C',str(w),*a]).decode().strip()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def ns(s):return int(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1e9)
assert git('rev-parse','HEAD')==head
assert not git('diff','--cached','--name-only') and not git('diff','--name-only','--diff-filter=U')
assert set(git('diff','--name-only').splitlines())<={'terminal/docs/pr-crops/ticker-news/unavailable-desktop-en-dark.png'}
for f in ['visual-review.json','aggregate-qualification.json','manifest-binding.json','source-consumer-execution.json','README.md','inventory.json']:assert not(p/f).exists(),f
first=read('browser-current/execution.json');second=read('browser-tablet-mobile/execution.json');recon=read('initial-attempt-reconciliation.json')
assert first['state']=='CAPTURE_FAILED_NO_REPLAY' and first['exit']==1
assert {k:first['stats'][k] for k in ['expected','skipped','unexpected','flaky']}=={'expected':7,'skipped':0,'unexpected':14,'flaky':0}
assert second['state']=='QUALIFIED' and second['exit']==0
assert {k:second['stats'][k] for k in ['expected','skipped','unexpected','flaky']}=={'expected':7,'skipped':7,'unexpected':0,'flaky':0}
for x in [first,second]:
 assert x['head']==head and x['sourceTree']==git('rev-parse','HEAD^{tree}') and x['sourceEntries']==2120
 assert x['sourceStable'] and x['newerPacketsUnchanged'] and not x['reportErrors']
 assert x['compositionParents']==git('show','-s','--format=%P',head).split()
 assert x['protectedMaster']=='74c007125129090cc762f2bc4b1b152123326444'
assert sha(p/'capture-news.py')==first['wrapperSha256'] and sha(p/'capture-news-tablet-mobile.py')==second['wrapperSha256']
snapshots=[read(r+'/source-'+s+'.json') for r in ['browser-current','browser-tablet-mobile'] for s in ['before','after']]
source=snapshots[0];assert all(x==source for x in snapshots) and len(source)==2120
tree=ast.parse((p/'capture-news.py').read_text())
extra=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(a,ast.Name) and a.id=='extraPaths' for a in n.targets))
def snapshot():
 d=json.loads(subprocess.check_output([str(node),'-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=w).decode())
 return {rel:sha(w/rel) for rel in sorted(set(d)|set(extra))}
assert snapshot()==source
assert sha(node)=='2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0'
desktop=[dict(c,qualifiedFrom='browser-current/execution.json') for c in first['cases'] if c['project']=='desktop']
assert len(desktop)==7 and all(c['status']=='expected' and c['results']==[{'retry':0,'status':'passed'}] for c in desktop)
cases=desktop+[dict(c,qualifiedFrom='browser-tablet-mobile/execution.json') for c in second['cases']]
assert len(cases)==21 and len({(c['file'],c['project'],c['title']) for c in cases})==21
assert all(len(c['results'])==1 and c['results'][0]['retry']==0 and c['results'][0]['status'] in ['passed','skipped'] for c in cases)
counts=dict(collections.Counter(c['results'][0]['status'] for c in cases));assert counts=={'passed':14,'skipped':7}
failed=[]
def walk(s):
 for spec in s.get('specs',[]):
  for test in spec.get('tests',[]):
   for r in test.get('results',[]):
    if r.get('status')=='failed':
     e=json.dumps([r.get('error'),r.get('errors')])
     assert test['projectName'] in ['tablet','mobile'] and "Executable doesn't exist" in e and 'chromium_headless_shell-1228' in e
     failed.append((test['projectName'],spec['title']))
 for child in s.get('suites',[]):walk(child)
for suite in read('browser-current/browser-report.json')['suites']:walk(suite)
assert len(failed)==14
assert all(second[k] for k in ['ownedPortClosed','nextLockAbsent','retainedImagesUnchanged','manifestUnchangedUntilBinding'])
for rel in ['initial-failed-capture-lifecycle.json','ticker-news-browser-tablet-mobile-lifecycle.json']:assert read(rel)['state']=='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED'
assert sha(p/'ticker-news-browser-tablet-mobile-lifecycle.json')==second['lifecycle']['sha256']
assert not(t/'.next/dev/lock').exists()
for port in [61981,50761]:
 r=subprocess.run(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True,text=True)
 assert r.returncode==1 and not r.stdout.strip() and not r.stderr.strip()
modern=read('newer-packets-before.json');families=['ticker-news-editorial-views','ticker-news-recovery','ticker-news-cn-hk']
def modern_now():return {str(f.relative_to(w)):sha(f) for name in families for f in (t/'docs/pr-crops'/name).rglob('*') if f.is_file()}
assert len(modern)==103 and modern_now()=={k:v['sha256'] for k,v in modern.items()}
prior=read('prior-packet-preservation.json')
assert len(prior['files'])==11 and all(sha(p/'prior-packet'/n)==v['sha256'] for n,v in prior['files'].items())
assert all(sha(p/'failed-first-packet'/n)==v['sha256'] for n,v in recon['files'].items())
manifest=packet/'EVIDENCE.yml';old=manifest.read_bytes()
assert sha(manifest)==first['priorManifestSha256']==second['priorManifestSha256']==prior['files']['EVIDENCE.yml']['sha256']
names=sorted(second['images']);assert len(names)==10 and sorted(f.name for f in packet.glob('*.png'))==names
images={}
for n in names:
 f=packet/n;v=second['images'][n];assert sha(f)==v['sha256'] and f.stat().st_size==v['bytes']
 if n in recon['acceptedFreshImages']:
  oldImage=recon['files'][n]
  assert oldImage['mtimeAtOrAfterAttemptStart'] and sha(f)==oldImage['sha256']==second['retainedImages'][n]
  assert ns(first['startedAt'])<=oldImage['mtimeNs']<=ns(first['completedAt']) and f.stat().st_mtime_ns==oldImage['mtimeNs']
  producer='browser-current/execution.json';freshAt=oldImage['mtimeNs']
 else:
  assert n in second['expectedFreshImages'] and v['modifiedDuringCapture']
  assert ns(second['startedAt'])<=f.stat().st_mtime_ns<=ns(second['completedAt'])
  producer='browser-tablet-mobile/execution.json';freshAt=f.stat().st_mtime_ns
 images[n]={**v,'producingRun':producer,'modifiedDuringProducingRun':True,'observedMtimeNs':freshAt}
for label in ['generated-preimages.json','generated-preimages-continuation.json']:
 for rel,v in read(label).items():
  assert(w/rel).exists()==v['present']
  if v['present']:assert sha(w/rel)==v['sha256']==sha(p/v['backup'])
visual={'schema':'terminal.pr1407.news-visual-review.v1','state':'REVIEWED','sourceHead':head,'reviewer':'assigned ChatGPT principal; source contributor; self-check only','reviewedAt':now(),'method':'Viewed all ten actual PNGs through original C3 read_file image output; exact bytes matched to qualified capture receipts.','findings':'EN/ZH labels, headline wrapping, source badges and action controls remain readable. Unavailable copy and Retry remain visible without overlap or clipping. Viewport labels describe browser viewports, not panel PNG dimensions. Existing fixture headlines remain in their authored language.','images':[{'file':n,'sha256':images[n]['sha256'],'verdict':'PASS'} for n in names]}
put('visual-review.json',visual)
aggregate={'schema':'terminal.pr1407.news-same-source-aggregate.v1','state':'QUALIFIED_SAME_SOURCE_CONTINUATION','qualifiedAt':now(),'head':head,'sourceTree':first['sourceTree'],'compositionParents':first['compositionParents'],'protectedAncestor':first['protectedMaster'],'latestProtectedObserved':'18fabe9d3c1439c4185559ba5ce491518fe999c9','sourceEntries':2120,'sourceSnapshotsIdentical':True,'sourceSnapshotSha256':sha(p/'browser-current/source-before.json'),'qualifiedUniqueCases':cases,'qualifiedCounts':counts,'historicalFirstAttempt':{'state':first['state'],'exit':1,'passedDesktopCases':7,'tabletMobileLaunchFailures':14,'executionSha256':sha(p/'browser-current/execution.json')},'targetedContinuation':{'state':second['state'],'exit':0,'passed':7,'authoredSkips':7,'executionSha256':sha(p/'browser-tablet-mobile/execution.json')},'singleAllGreenRun':False,'images':images,'visualReviewSha256':sha(p/'visual-review.json'),'priorManifestSha256':sha(manifest),'preservedNeighborFiles':103,'priorPacketFiles':11,'ownedLifecyclesSettled':True,'scope':'Real local fixture-backed UI and unchanged producer contracts; no authenticated provider, installed-generation or production-news acceptance.'}
put('aggregate-qualification.json',aggregate)
layouts=['terminal/components/news/TickerNewsPanel.tsx','terminal/components/news/TickerNewsPanel.module.css','terminal/components/TerminalShell.tsx']
lines=['# Same-source qualification: 14 passing cases and 7 authored project skips across 21 unique cases.','# Historical first attempt: 7 desktop passes and 14 missing-browser launch failures; retained unchanged.','# Targeted continuation after dependency repair: 7 passes and 7 authored skips; no qualified retries.','# Eight first-attempt images and two continuation images are fresh within their respective producing intervals.','# Source tree: '+first['sourceTree'],'# Protected ancestor: '+first['protectedMaster'],'# Proof: docs/verification/pr1407-ticker-news-successor-20261111/aggregate-qualification.json','# Source snapshot SHA256: '+sha(p/'browser-current/source-before.json'),'# Panel crops: viewport labels describe browser viewports, not PNG dimensions.','capturedAtHead: '+head,'layoutFiles:']
for rel in layouts:lines+=['  - path: '+rel,'    sha256: '+source[rel]]
lines+=['crops:'];viewports={'desktop':'1440x900','tablet':'820x1180','mobile':'390x844'}
for n in names:
 parts=n.removesuffix('.png').split('-');unavailable=parts[0]=='unavailable';size,lang=parts[1:3] if unavailable else parts[:2]
 lines+=['  - file: '+n,'    viewport: '+viewports[size],'    lang: '+lang,'    state: '+('unavailable' if unavailable else 'live-feed'),'    sha256: '+images[n]['sha256']]
manifest.write_text('\n'.join(lines)+'\n')
binding={'schema':'terminal.pr1407.news-manifest-binding.v1','state':'CURRENT_CAPTURE_BOUND','boundAt':now(),'captureHead':head,'sourceTree':first['sourceTree'],'sourceEntries':2120,'aggregateQualificationSha256':sha(p/'aggregate-qualification.json'),'priorManifestSha256':hashlib.sha256(old).hexdigest(),'currentManifestSha256':sha(manifest),'layouts':{rel:source[rel] for rel in layouts},'images':{n:images[n]['sha256'] for n in names},'scope':aggregate['scope']}
put('manifest-binding.json',binding)
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP','PATH'] if k in os.environ};env['PATH']=str(node.parent)+':'+os.environ['PATH']
command=[str(node),'node_modules/vitest/vitest.mjs','run','lib/__tests__/tickerNewsEvidence.test.ts','--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(p/'source-consumer-report.json')]
started=now();clock=time.monotonic()
with(p/'source-consumer.log').open('x') as out:r=subprocess.run(command,cwd=t,env=env,stdout=out,stderr=subprocess.STDOUT)
report=read('source-consumer-report.json') if(p/'source-consumer-report.json').exists() else {}
after=snapshot();ok=r.returncode==0 and report.get('numPassedTests')==4 and report.get('numFailedTests')==0 and report.get('success') is True and after==source
receipt={'schema':'terminal.pr1407.news-source-consumer.v1','state':'PASS' if ok else 'FAILED','head':head,'command':command,'startedAt':started,'completedAt':now(),'seconds':round(time.monotonic()-clock,2),'exit':r.returncode,'passed':report.get('numPassedTests'),'failed':report.get('numFailedTests'),'reportSha256':sha(p/'source-consumer-report.json') if report else None,'logSha256':sha(p/'source-consumer.log'),'sourceStillIdentical':after==source,'manifestSha256':sha(manifest)}
put('source-consumer-execution.json',receipt)
print(json.dumps({'binding':binding['state'],'aggregate':aggregate['state'],'qualifiedCounts':counts,'historicalLaunchFailures':14,'images':10,'sourceEntries':2120,'neighborsPreserved':103,'guard':receipt}),flush=True)
assert ok,'FOCUSED_GUARD_FAILED_NO_BLIND_REPLAY'
readme="""# PR 1407 ticker-news source-lock renewal

This packet renews the news manifest against captured source 5338557e44e2a8b5ca789aac7cd295037db9692d after the already-published workspace evidence repair. It changes no application code, producer, selector, guard, or neighboring evidence. Source tree: df6f2dfeb5587acd42d83847ea8582a9e1da0a39. Protected ancestor: 74c007125129090cc762f2bc4b1b152123326444. The later protected 18fabe9d3c1439c4185559ba5ce491518fe999c9 changes the separately owned Screener tap-floor source/test.

## Actual executions

The full desktop/tablet/mobile attempt exited 1: seven desktop cases passed, and fourteen tablet/mobile cases failed at launch because the exact Playwright headless-shell executable was absent. Raw reports, logs, traces, partial packet and diagnosis remain intact. This was not a successful full run. The seven completed desktop cases generated six responsive live-feed crops and two unavailable-desktop crops.

After exact original lifecycle reconciliation, the official matching Playwright CLI installed only Chromium headless shell with browser garbage collection disabled. One targeted tablet/mobile continuation on identical source passed seven cases with seven authored project skips, zero unexpected results, flakes or retries. It refreshed two unavailable-mobile crops and preserved eight accepted crops. Accepted desktop cases were not rerun. The aggregate is fourteen passing cases plus seven authored skips across twenty-one unique project/title identities; it is not one all-green invocation.

All four before/after snapshots and a fresh membership-discovering snapshot match across 2,120 inputs. The principal visually inspected all ten PNGs. Freshness is checked against each image's producing interval. Nine images are byte-identical to the prior packet; timestamp/producer receipts establish actual recapture. One unavailable-desktop image changed bytes. Prior eleven-file packet, failed-attempt eleven-file packet and all 103 neighboring editorial/recovery/CN-HK evidence files are preserved.

## Binding and validation

aggregate-qualification.json identifies each qualified case and image producer. visual-review.json records review and exact hashes. manifest-binding.json binds three unchanged layout sources and ten PNGs to the actual captured head, not a future commit. The unchanged tickerNewsEvidence.test.ts guard passed all four tests, with source inputs still identical. Both browser lifecycles are settled, listeners closed and Next lock absent. Generated preimages still match; no restoration was needed.

Failed execution, dependency installation and targeted continuation retain distinct outcomes. Accepted workspace proof from the previous commit is not rerun or restamped. inventory.json lists exact packet membership.

## Acceptance boundary

Real local browser UI uses existing fixtures. This does not establish authenticated provider behavior, installed production news, or unrelated product acceptance. Review is a principal self-check; no formal independent GitHub approval is asserted. Required natural CI and repository release controls govern merge eligibility.
"""
(p/'README.md').write_text(readme)
files={str(f.relative_to(p)):{'bytes':f.stat().st_size,'sha256':sha(f)} for f in sorted(p.rglob('*')) if f.is_file() and f.name!='inventory.json'}
put('inventory.json',{'schema':'terminal.pr1407.news-packet-inventory.v1','files':files,'count':len(files),'bytes':sum(v['bytes'] for v in files.values())})
assert snapshot()==source and modern_now()=={k:v['sha256'] for k,v in modern.items()}
print(json.dumps({'state':'BOUND_GUARD_PASSED_PACKET_READY','manifestSha256':sha(manifest),'inventoryFiles':len(files),'inventoryBytes':sum(v['bytes'] for v in files.values()),'trackedDiff':git('diff','--name-only')}),flush=True)
