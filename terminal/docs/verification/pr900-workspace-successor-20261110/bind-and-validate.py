from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
repo=Path(__file__).resolve().parents[4];t=repo/'terminal';proof=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
capture=json.loads((proof/'workspace-current/execution.json').read_text())
assert capture['state']=='QUALIFIED' and capture['sourceTree']=='04d0d4ebb0c2b8ca0b0d4dd421ea92f23977f96c'
packet=t/'docs/pr-crops/b-f12-b5-2-team-workspaces';manifest=packet/'EVIDENCE.yml';history=packet/'CAPTURE_HISTORY.md'
assert sha(manifest)==capture['manifestSha256']
originalManifest=manifest.read_text()
binding=('# sourceCompositionTree: '+capture['sourceTree']+'\n# protectedBase: '+capture['protectedBase']+'\n# execution: terminal/docs/verification/pr900-workspace-successor-20261110/workspace-current/execution.json\n')
manifest.write_text(binding+originalManifest)
historyBefore=sha(history)
history.write_text(history.read_text().rstrip()+'\n\n## 2026-11-10 — protected Layout menu and owned lifecycle qualification\n\nActual capture checkout: '+capture['head']+'; composed source tree '+capture['sourceTree']+'; protected parent '+capture['protectedBase']+'.\n\nThe existing twelve-state EN/ZH desktop/phone workspace producer ran on this composition, with unchanged rendering and measurement behavior. All twelve images were freshly produced and all 2,049 observed inputs remained stable. The corrected producer rejects invalid group identity and premature owned-server closure, preserves every shutdown refusal, and observes actual child close before writing the manifest. Existing grants and rollup packets remain unchanged.\n\nBoth parent packets and the completed first run before the final lifecycle guards are retained under terminal/docs/verification/pr900-workspace-successor-20261110. The current execution, twenty OS-free lifecycle cases, source readers and static results are recorded there. This entry records actual fixture-backed capture, not production or review approval.\n')
put(proof/'manifest-binding.json',{'schema':'terminal.pr900.current-workspace-manifest-binding.v1','at':now(),'captureHead':capture['head'],'sourceCompositionTree':capture['sourceTree'],'protectedBase':capture['protectedBase'],'generatedManifestSha256':capture['manifestSha256'],'boundManifestSha256':sha(manifest),'historyBeforeSha256':historyBefore,'historyAfterSha256':sha(history),'captureExecutionSha256':sha(proof/'workspace-current/execution.json'),'images':capture['images'],'scope':'Informational composition/provenance comments added after actual producer generation; no future commit used as capture head.'})
run=proof/'source-consumers-current';assert not run.exists();run.mkdir()
paths=set(json.loads((proof/'workspace-current/source-after.json').read_text()))
for family in ['b-f12-b5-1-grants','b-f12-b5-2-team-workspaces','w9t_f13_9-team-rollup-no-rank']:
 paths.update(str(f.relative_to(repo)) for f in (t/'docs/pr-crops'/family).rglob('*') if f.is_file())
def snapshot():return {path:sha(repo/path) for path in sorted(paths)}
before=snapshot();put(run/'source-before.json',before)
runtime=json.loads((proof/'dependencies.json').read_text());env=os.environ.copy();env['PATH']=str(Path(runtime['node']).parent)+':'+env['PATH']
guardFiles=['lib/__tests__/b_f12_b5_1GrantsEvidence.test.ts','lib/__tests__/b_f12_b5_2TeamWorkspacesEvidence.test.ts','lib/__tests__/w9t_f13_9TeamRollupEvidence.test.ts']
commands=[
 ('guards',[runtime['node'],'node_modules/vitest/vitest.mjs','run',*guardFiles,'--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(run/'guards.json')]),
 ('typecheck',[runtime['node'],'node_modules/typescript/bin/tsc','--noEmit','--incremental','false']),
 ('lint',[runtime['node'],'node_modules/eslint/bin/eslint.js',*guardFiles,'--max-warnings=0'])
]
record={'schema':'terminal.pr900.current-source-consumers.v1','state':'RUNNING','startedAt':now(),'sourceAndPacketEntries':len(before),'results':{}}
put(run/'execution.json',record)
for name,command in commands:
 print(json.dumps({'starting':name}),flush=True);start=time.monotonic();log=run/(name+'.log')
 with log.open('x') as h:r=subprocess.run(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
 result={'command':command,'exit':r.returncode,'seconds':round(time.monotonic()-start,3),'logSha256':sha(log)}
 if name=='guards':
  report=json.loads((run/'guards.json').read_text()) if (run/'guards.json').exists() else {}
  result['report']={k:report.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 record['results'][name]=result;record['sourceStable']=snapshot()==before;put(run/'execution.json',record)
 print(json.dumps({name:result,'sourceStable':record['sourceStable']}),flush=True)
 if r.returncode!=0 or not record['sourceStable']:
  record.update(state='FAILED',completedAt=now());put(run/'execution.json',record);print(log.read_text()[-9000:],flush=True);raise SystemExit(1)
after=snapshot();put(run/'source-after.json',after)
assert record['results']['guards']['report']['numPassedTests']==12 and record['results']['guards']['report']['numFailedTests']==0
record.update(state='QUALIFIED',completedAt=now(),sourceStable=before==after);put(run/'execution.json',record)
