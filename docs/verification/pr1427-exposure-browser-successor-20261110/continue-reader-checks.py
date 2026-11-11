from pathlib import Path
import subprocess,json,os,hashlib,datetime,time,sys
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
runtime=json.loads((p/'runtime.json').read_text());node=Path(runtime['node'])
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ}
env.update(PATH=str(node.parent)+':'+os.environ['PATH'],CI='1',PLAYWRIGHT_BROWSERS_PATH=runtime['browserStore'])
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(b):return hashlib.sha256(b).hexdigest()
def save(n,x):(p/n).write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
state=json.loads((p/'reader-checks.json').read_text())
assert len(state['checks'])==1 and state['checks'][0]['name']=='reader-focused' and state['checks'][0]['exitCode']==0
report=json.loads((p/'reader-focused-report.json').read_text())
assert report['numFailedTests']==report['numPendingTests']==0 and report['numPassedTests']==report['numTotalTests']
assert not (p/'reader-checks-before-continuation.json').exists()
(p/'reader-checks-before-continuation.json').write_bytes((p/'reader-checks.json').read_bytes())
before={f:sha((w/f).read_bytes()) for f in state['sourceBefore']};assert before==state['sourceBefore']
nextenv=t/'next-env.d.ts';assert nextenv.exists()
preimage=nextenv.read_bytes();(p/'reader-next-env.preimage.d.ts.txt').write_bytes(preimage)
save('reader-wrapper-boundary.json',{'wrapperPid':11999,'outerExitObserved':1,'boundary':'Incorrect initial absence assertion after the completed browser stages generated next-env.d.ts','focusedExitCode':0,'focusedPassed':report['numPassedTests'],'focusedReplayed':False,'typegenStarted':False,'typescriptStarted':False,'eslintStarted':False,'preimageSha256':sha(preimage),'continuation':'Only unexecuted checks; preserve and restore actual present generated-file preimage'})
state.update(state='CONTINUING_UNEXECUTED_CHECKS',continuationStartedAt=now(),counts={k:report[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']})
def run(name,argv):
 start=time.monotonic();rec={'name':name,'argv':argv,'startedAt':now()}
 with (p/(name+'.log')).open('xb') as log:
  child=subprocess.Popen(argv,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT)
  rec['pid']=child.pid;state['checks'].append(rec);save('reader-checks.json',state);code=child.wait()
 rec.update(exitCode=code,finishedAt=now(),seconds=round(time.monotonic()-start,3),logSha256=sha((p/(name+'.log')).read_bytes()))
 save('reader-checks.json',state);print(json.dumps({'check':name,'exitCode':code,'seconds':rec['seconds']}),flush=True);return code
codes=[];code=run('reader-typegen',[str(node),'node_modules/next/dist/bin/next','typegen']);codes.append(code)
generated=nextenv.read_bytes();(p/'reader-next-env.generated.d.ts.txt').write_bytes(generated)
if code==0:codes.append(run('reader-typescript',[str(node),'node_modules/typescript/bin/tsc','--noEmit']))
assert nextenv.read_bytes()==generated
nextenv.write_bytes(preimage);assert nextenv.read_bytes()==preimage
state['generatedTypeRestoration']={'before':'PRESENT','after':'PRESENT','preimageSha256':sha(preimage),'generatedSha256':sha(generated),'restoredExactPreimage':True}
codes.append(run('reader-eslint',[str(node),'node_modules/eslint/bin/eslint.js','lib/__tests__/optionsExposureEvidenceOwner.test.ts','--format','json','--output-file',str(p/'reader-lint-report.json')]))
lr=json.loads((p/'reader-lint-report.json').read_text());state['lintCounts']={k:sum(x[k] for x in lr) for k in ['errorCount','warningCount']}
after={f:sha((w/f).read_bytes()) for f in before}
state.update(state='READER_CHECKS_PASSED' if all(x==0 for x in codes) else 'READER_CHECK_FAILED',finishedAt=now(),sourceAfter=after,sourceStable=before==after)
save('reader-checks.json',state)
print(json.dumps({k:state[k] for k in ['state','counts','lintCounts','sourceStable','generatedTypeRestoration']}),flush=True)
assert before==after
sys.exit(0 if all(x==0 for x in codes) else 1)
