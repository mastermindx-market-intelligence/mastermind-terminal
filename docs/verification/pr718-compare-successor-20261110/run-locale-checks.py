from pathlib import Path
import subprocess,os,json,hashlib,datetime,time
p=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-718-compare-successor/docs/verification/pr718-compare-successor-20261110");w=p.parents[2];t=w/'terminal';node=Path(json.loads((p/'runtime.json').read_text())['node'])
original=json.loads((p/'source-checks.json').read_text());before={f:hashlib.sha256((w/f).read_bytes()).hexdigest() for f in original['sourceAfter']}
changed=[f for f in before if before[f]!=original['sourceAfter'][f]];assert changed==['terminal/e2e/compare-settings-ux.spec.ts']
name='source-checks-locale-owner.json';assert not (p/name).exists()
state={'state':'RUNNING','reason':'Correct the inherited locale helper init-script null-document access by preserving the original storage-only locale setup; zero-page-error assertion retained.','previousSourceChecks':'source-checks.json','changedSincePreviousChecks':changed,'sourceBefore':before,'checks':[]}
def save():(p/name).write_text(json.dumps(state,indent=2,sort_keys=True)+'\n')
save();env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ};env.update(PATH=str(node.parent)+':'+os.environ['PATH'],CI='1')
nextenv=t/'next-env.d.ts';preimage=nextenv.read_bytes() if nextenv.exists() else None
codes=[]
for label,args in [('locale-typegen',['node_modules/next/dist/bin/next','typegen']),('locale-typescript',['node_modules/typescript/bin/tsc','--noEmit']),('locale-eslint',['node_modules/eslint/bin/eslint.js','e2e/compare-settings-ux.spec.ts','--format','json','--output-file',str(p/'locale-lint-report.json')])]:
 start=time.monotonic();rec={'name':label,'argv':[str(node),*args],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};state['checks'].append(rec)
 with (p/(label+'.log')).open('x') as log:
  child=subprocess.Popen(rec['argv'],cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT);rec['pid']=child.pid;save();rc=child.wait()
 rec.update(exitCode=rc,seconds=round(time.monotonic()-start,3));codes.append(rc);save();print(json.dumps(rec),flush=True)
 if rc:break
if preimage is None:
 if nextenv.exists():nextenv.unlink()
else:nextenv.write_bytes(preimage)
state['generatedTypesRestored']=(nextenv.read_bytes() if nextenv.exists() else None)==preimage
after={f:hashlib.sha256((w/f).read_bytes()).hexdigest() for f in before};assert before==after
state.update(sourceAfter=after,sourceStable=True,state='SOURCE_CHECKS_PASSED' if len(codes)==3 and all(c==0 for c in codes) and state['generatedTypesRestored'] else 'SOURCE_CHECK_FAILED');save();print(json.dumps({'state':state['state'],'sourceStable':True,'generatedTypesRestored':state['generatedTypesRestored']}),flush=True)
raise SystemExit(0 if state['state']=='SOURCE_CHECKS_PASSED' else 1)
