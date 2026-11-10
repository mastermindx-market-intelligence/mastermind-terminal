from pathlib import Path
import subprocess,json,os,hashlib,datetime,time,sys
w=Path(__file__).resolve().parents[3]; p=Path(__file__).resolve().parent; t=w/'terminal'
runtime=json.loads((p/'runtime.json').read_text()); node=Path(runtime['node'])
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ}
env.update(PATH=str(node.parent)+':'+os.environ['PATH'],CI='1',PLAYWRIGHT_BROWSERS_PATH=runtime['browserStore'])
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(b):return hashlib.sha256(b).hexdigest()
def save(n,x):(p/n).write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def g(*a):return subprocess.check_output(['git','-C',str(w),*a],text=True).strip()
assert g('rev-parse','HEAD')=='2ca0ddc9b9f98dbeed000ef4a0802dc08aae26d7'
assert g('rev-parse','MERGE_HEAD')=='f4574a7cf6a13a58215a81e4fbbfbb2667aa3185'
assert json.loads((p/'reader-installation.json').read_text())['state']=='ADDITIVE_BROWSER_READER_APPLIED'
assert json.loads((p/'browser-validation.json').read_text())['state']=='BROWSER_PROOFS_QUALIFIED_PENDING_READER_AND_DESCRIPTOR'
owned=['terminal/e2e/tools/optionsExposureEvidence.cjs','terminal/lib/__tests__/optionsExposureEvidenceOwner.test.ts','terminal/docs/pr-crops/eod-heatmap-flowdesk-load-failure/EVIDENCE.yml','terminal/docs/pr-crops/gex-levels-heatmap-load-failure/EVIDENCE.yml']
before={f:sha((w/f).read_bytes()) for f in owned}
state={'schema':'terminal_pr1427_reader_validation.v1','state':'RUNNING','startedAt':now(),'sourceBefore':before,'checks':[]}
assert not (p/'reader-checks.json').exists()
save('reader-checks.json',state)
def run(name,argv):
    start=time.monotonic();rec={'name':name,'argv':argv,'startedAt':now()}
    with (p/(name+'.log')).open('xb') as log:
        child=subprocess.Popen(argv,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT)
        rec['pid']=child.pid;state['checks'].append(rec);save('reader-checks.json',state)
        code=child.wait()
    rec.update(exitCode=code,finishedAt=now(),seconds=round(time.monotonic()-start,3),logSha256=sha((p/(name+'.log')).read_bytes()))
    save('reader-checks.json',state);print(json.dumps({'check':name,'exitCode':code,'seconds':rec['seconds']}),flush=True)
    return code
tests=['lib/__tests__/optionsExposureEvidenceOwner.test.ts','lib/__tests__/optionsExposureEvidence.test.ts','lib/__tests__/eodHeatmapFlowdeskLoadFailureEvidence.test.ts','lib/__tests__/gexLevelsHeatmapLoadFailureEvidence.test.ts']
codes=[]
codes.append(run('reader-focused',[str(node),'node_modules/vitest/vitest.mjs','run',*tests,'--reporter=default','--reporter=json','--outputFile='+str(p/'reader-focused-report.json')]))
if (p/'reader-focused-report.json').exists():
    report=json.loads((p/'reader-focused-report.json').read_text())
    state['counts']={k:report[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
nextenv=t/'next-env.d.ts';assert not nextenv.exists()
code=run('reader-typegen',[str(node),'node_modules/next/dist/bin/next','typegen']);codes.append(code)
generated=nextenv.read_bytes() if nextenv.exists() else None
if generated is not None:(p/'reader-next-env.generated.d.ts.txt').write_bytes(generated)
if code==0:codes.append(run('reader-typescript',[str(node),'node_modules/typescript/bin/tsc','--noEmit']))
assert (nextenv.read_bytes() if nextenv.exists() else None)==generated
if generated is not None:nextenv.unlink()
state['generatedTypeRestoration']={'before':'ABSENT','after':'ABSENT','generatedSha256':sha(generated) if generated else None,'restoredExactPreimage':not nextenv.exists()}
codes.append(run('reader-eslint',[str(node),'node_modules/eslint/bin/eslint.js','lib/__tests__/optionsExposureEvidenceOwner.test.ts','--format','json','--output-file',str(p/'reader-lint-report.json')]))
lr=json.loads((p/'reader-lint-report.json').read_text())
state['lintCounts']={k:sum(x[k] for x in lr) for k in ['errorCount','warningCount']}
after={f:sha((w/f).read_bytes()) for f in owned}
state.update(state='READER_CHECKS_PASSED' if all(x==0 for x in codes) else 'READER_CHECK_FAILED',finishedAt=now(),sourceAfter=after,sourceStable=before==after)
save('reader-checks.json',state)
print(json.dumps({k:state[k] for k in ['state','counts','lintCounts','sourceStable','generatedTypeRestoration']}),flush=True)
assert before==after
sys.exit(0 if all(x==0 for x in codes) else 1)
