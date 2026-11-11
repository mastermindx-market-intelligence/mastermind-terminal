from pathlib import Path
import subprocess,json,os,hashlib,datetime,time,sys
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
runtime=json.loads((p/'runtime.json').read_text());node=Path(runtime['node'])
head='2ca0ddc9b9f98dbeed000ef4a0802dc08aae26d7';tree='28755f8133c5208c38ca7af4645e0eaee1610187'
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ}
env.update(PATH=str(node.parent)+':'+os.environ['PATH'],CI='1',PLAYWRIGHT_BROWSERS_PATH=runtime['browserStore'])
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(b):return hashlib.sha256(b).hexdigest()
def g(*a):return subprocess.check_output(['git','-C',str(w),*a],text=True).strip()
def save(n,x):(p/n).write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
assert g('rev-parse','HEAD')==head and g('write-tree')==tree and not g('diff','--name-only')
checks=[];state={'schema':'terminal.pr1427.focused-source-checks.v1','sourceHead':head,'sourceTree':tree,'state':'STARTED','startedAt':now(),'checks':checks}
save('source-checks.json',state)
def run(name,argv):
    start=time.monotonic();rec={'name':name,'argv':argv,'startedAt':now()}
    with (p/(name+'.log')).open('xb') as log:
        child=subprocess.Popen(argv,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT)
        rec['pid']=child.pid;checks.append(rec);save('source-checks.json',state)
        code=child.wait()
    rec.update(exitCode=code,finishedAt=now(),seconds=round(time.monotonic()-start,3),logSha256=sha((p/(name+'.log')).read_bytes()))
    save('source-checks.json',state);print(json.dumps({'check':name,'exitCode':code,'seconds':rec['seconds']}),flush=True)
    return code
code=run('focused-vitest',[str(node),'node_modules/vitest/vitest.mjs','run','lib/__tests__/exposureMomentumConsumer.test.tsx','--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(p/'focused-report.json')])
if code:state['state']='FOCUSED_TESTS_FAILED';save('source-checks.json',state);sys.exit(code)
report=json.loads((p/'focused-report.json').read_text())
state['focusedCounts']={k:report[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
assert report['numFailedTests']==0 and report['numPassedTests']>0
nextenv=t/'next-env.d.ts';before=nextenv.read_bytes()
save('typegen-preimage.json',{'path':'terminal/next-env.d.ts','sha256':sha(before),'text':before.decode()})
typegen=run('typegen',[str(node),'node_modules/next/dist/bin/next','typegen'])
aftergen=nextenv.read_bytes()
tsc=run('typescript',[str(node),'node_modules/typescript/bin/tsc','--noEmit']) if typegen==0 else None
aftertsc=nextenv.read_bytes()
assert aftertsc==aftergen,'unexpected generated-type mutation during TypeScript'
nextenv.write_bytes(before);assert nextenv.read_bytes()==before
save('generated-types.json',{'beforeSha256':sha(before),'afterTypegenSha256':sha(aftergen),'afterTypeScriptSha256':sha(aftertsc),'restoredSha256':sha(nextenv.read_bytes()),'restoredExactPreimage':True})
paths=['components/exposure-map/ExposureDivergence.tsx','components/exposure-map/ExposureMap.tsx','components/exposure-map/exposureMapStrings.ts','lib/__tests__/exposureMomentumConsumer.test.tsx']
lint=run('scoped-eslint',[str(node),'node_modules/eslint/bin/eslint.js',*paths,'--format','json','--output-file',str(p/'lint-report.json')])
lr=json.loads((p/'lint-report.json').read_text())
state['lintCounts']={k:sum(x[k] for x in lr) for k in ['errorCount','warningCount']}
state.update(state='SOURCE_CHECKS_PASSED' if typegen==tsc==lint==0 else 'SOURCE_CHECK_FAILED',finishedAt=now(),sourceUnchanged=not bool(g('diff','--name-only')),indexTree=g('write-tree'))
save('source-checks.json',state)
print(json.dumps({k:state[k] for k in ['state','focusedCounts','lintCounts','sourceUnchanged','indexTree']}),flush=True)
assert state['sourceUnchanged'] and state['indexTree']==tree
assert typegen==tsc==lint==0
