from pathlib import Path
import json,subprocess,os,time,datetime,hashlib,sys
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
runtime=json.loads((p/'runtime.json').read_text());node=Path(runtime['node'])
assert json.loads((p/'green-execution.json').read_text())['state']=='AFFECTED_CONTRACTS_PASSED'
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ};env.update(PATH=str(node.parent)+':'+os.environ['PATH'],PLAYWRIGHT_BROWSERS_PATH=runtime['browserStore'],CI='1')
state={'schema':'terminal_pr726_browser_execution.v1','state':'RUNNING','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':[]}
assert not (p/'browser-execution.json').exists()
def save():(p/'browser-execution.json').write_text(json.dumps(state,indent=2,sort_keys=True)+'\n')
save()
for name,script in [('browser-build','build-browser.cjs'),('browser-proof','browser-proof.cjs')]:
 start=time.monotonic();rec={'name':name,'argv':[str(node),str(p/script)],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 with (p/(name+'.log')).open('xb') as log:
  child=subprocess.Popen(rec['argv'],cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT);rec['pid']=child.pid;state['checks'].append(rec);save();code=child.wait()
 rec.update(exitCode=code,seconds=round(time.monotonic()-start,3),logSha256=hashlib.sha256((p/(name+'.log')).read_bytes()).hexdigest());save();print(json.dumps(rec),flush=True)
 if code:
  state['state']='FAILED_'+name;save();sys.exit(code)
receipt=json.loads((p/'browser/browser-receipt.json').read_text())
assert receipt['state']=='BROWSER_MATRICES_PASSED' and receipt['sourceStable'] and receipt['browserClosed'] and receipt['serverClosed']
state.update(state='REAL_COMPONENT_BROWSER_QUALIFIED',finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),matrices=len(receipt['matrices']),states=sum(x['states'] for x in receipt['matrices']),transitions=sum(len(x['transitions']) for x in receipt['matrices']),images=len(receipt['screenshots']),receiptSha256=hashlib.sha256((p/'browser/browser-receipt.json').read_bytes()).hexdigest())
save();print(json.dumps({k:state[k] for k in ['state','matrices','states','transitions','images','receiptSha256']}),flush=True)
