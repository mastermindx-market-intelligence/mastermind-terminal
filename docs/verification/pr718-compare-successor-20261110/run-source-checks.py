from pathlib import Path
import os,subprocess,json,hashlib,datetime,time,sys
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
runtime=json.loads((p/'runtime.json').read_text());node=Path(runtime['node'])
assert json.loads((p/'green-execution.json').read_text())['state']=='AFFECTED_CONTRACTS_PASSED'
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ};env.update(PATH=str(node.parent)+':'+os.environ['PATH'],CI='1')
assert not (p/'source-checks.json').exists()
files=list(json.loads((p/'source-after-green.json').read_text()))+['terminal/e2e/compare-settings-ux.spec.ts','docs/verification/pr718-compare-successor-20261110/playwright-successor.config.cjs']
def snapshot():return {f:hashlib.sha256((w/f).read_bytes()).hexdigest() for f in files}
def save(n,v):(p/n).write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
before=snapshot();state={'state':'RUNNING','sourceBefore':before,'checks':[]};save('source-checks.json',state)
def run(name,argv):
 start=time.monotonic();rec={'name':name,'argv':argv,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 with (p/(name+'.log')).open('xb') as log:
  child=subprocess.Popen(argv,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT);rec['pid']=child.pid;state['checks'].append(rec);save('source-checks.json',state);code=child.wait()
 rec.update(exitCode=code,seconds=round(time.monotonic()-start,3),logSha256=hashlib.sha256((p/(name+'.log')).read_bytes()).hexdigest());save('source-checks.json',state)
 print(json.dumps({'check':name,'exit':code,'seconds':rec['seconds']}),flush=True);return code
nextenv=t/'next-env.d.ts';preimage=nextenv.read_bytes() if nextenv.exists() else None
if preimage is not None:(p/'next-env.preimage.d.ts.txt').write_bytes(preimage)
codes=[];code=run('typegen',[str(node),'node_modules/next/dist/bin/next','typegen']);codes.append(code)
generated=nextenv.read_bytes() if nextenv.exists() else None
if generated is not None:(p/'next-env.generated.d.ts.txt').write_bytes(generated)
if code==0:codes.append(run('typescript',[str(node),'node_modules/typescript/bin/tsc','--noEmit']))
assert (nextenv.read_bytes() if nextenv.exists() else None)==generated
if preimage is None:
 if nextenv.exists():nextenv.unlink()
else:nextenv.write_bytes(preimage)
state['generatedTypesRestored']=(nextenv.read_bytes() if nextenv.exists() else None)==preimage
paths=['components/CompareSettings.tsx','lib/__tests__/compareSettingsUx.test.tsx','e2e/compare-settings-ux.spec.ts']
codes.append(run('affected-eslint',[str(node),'node_modules/eslint/bin/eslint.js',*paths,'--format','json','--output-file',str(p/'lint-report.json')]))
report=json.loads((p/'lint-report.json').read_text());state['lintCounts']={k:sum(x[k] for x in report) for k in ['errorCount','warningCount']}
after=snapshot();assert before==after and state['generatedTypesRestored']
state.update(state='SOURCE_CHECKS_PASSED' if all(c==0 for c in codes) else 'SOURCE_CHECK_FAILED',sourceAfter=after,sourceStable=True);save('source-checks.json',state)
print(json.dumps({k:state[k] for k in ['state','sourceStable','generatedTypesRestored','lintCounts']}),flush=True)
sys.exit(0 if all(c==0 for c in codes) else 1)
