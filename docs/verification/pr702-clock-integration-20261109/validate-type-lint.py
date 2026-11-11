from pathlib import Path
from collections import Counter
import subprocess,json,hashlib,time,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'type-lint-r1'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,v):p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def git(*a):return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout
browser=json.loads((proof/'current-browser-r3/execution.json').read_text());assert browser['state']=='QUALIFIED' and browser['stats']['expected']==13 and browser['stats']['skipped']==5
before=json.loads((proof/'current-browser-r3/source-after.json').read_text());assert all(sha(repo/p)==h for p,h in before.items())
assert not(t/'.next/dev/lock').exists() and not out.exists();out.mkdir()
record={'schema':'terminal_pr702_current_type_and_affected_lint.v1','state':'RUNNING','startedAt':now(),'sourceEntries':len(before),'stages':{}}
def save():put(out/'execution.json',record)
save()
cmd=['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false'];start=time.monotonic();print(json.dumps({'starting':'typecheck'}),flush=True)
with (out/'typecheck.log').open('x') as h:r=subprocess.run(cmd,cwd=t,stdout=h,stderr=subprocess.STDOUT)
record['stages']['typecheck']={'command':cmd,'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(out/'typecheck.log')};save();print(json.dumps(record['stages']['typecheck']),flush=True)
if r.returncode:print((out/'typecheck.log').read_text()[-12000:],flush=True)
lints=[]
for path,base in [('components/ChartFrameBar.tsx','d03e7587711f1182531f25459fa1f60c679bac10'),('e2e/marker-tooltip.spec.ts','d03e7587711f1182531f25459fa1f60c679bac10'),('lib/__tests__/chartClockIsolation.test.tsx','c31fe105d4a101531def3518e7b9801e70cc4867')]:
 values={}
 for label,source in [('baseline',git('show',base+':terminal/'+path)),('current',(t/path).read_text())]:
  args=['node','node_modules/eslint/bin/eslint.js','--stdin','--stdin-filename',path,'--format=json']
  lint=subprocess.run(args,input=source,cwd=t,capture_output=True,text=True);assert lint.returncode in [0,1],lint.stderr
  entries=json.loads(lint.stdout);assert len(entries)==1 and entries[0].get('fatalErrorCount',0)==0
  filename=Path(path).name+'.'+label+'.json';put(out/filename,entries);lines=source.splitlines();counter=Counter()
  for m in entries[0]['messages']:
   key=json.dumps([m.get('ruleId'),m.get('severity'),m.get('message'),m.get('nodeType'),lines[m['line']-1].strip() if m.get('line') else None]);counter[key]+=1
  values[label]=counter
 novel=values['current']-values['baseline'];lints.append({'path':path,'baseline':base,'baselineCount':sum(values['baseline'].values()),'currentCount':sum(values['current'].values()),'novel':dict(novel),'state':'NO_NEW_DIAGNOSTICS' if not novel else 'NOVEL_DIAGNOSTICS'})
record['stages']['lint']=lints;stable=all(sha(repo/p)==h for p,h in before.items());good=r.returncode==0 and all(x['state']=='NO_NEW_DIAGNOSTICS' for x in lints) and stable
record.update({'state':'QUALIFIED' if good else 'FAILED','sourceStable':stable,'completedAt':now()});save();print(json.dumps(record),flush=True)
raise SystemExit(0 if good else 1)
