from pathlib import Path
import subprocess,json,time,hashlib,datetime
p=Path('/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr645-expiry-integration-20261109-c4')
proof=p/'docs/verification/pr645-expiry-successor-20261110'
checks=[('reader-node',['node','--test','e2e/tools/optionsExposureEvidence.cases.cjs']),('typegen',['npm','exec','--','next','typegen']),('typescript',['npm','exec','--','tsc','--noEmit'])]
results=[]
for name,cmd in checks:
 log=proof/(name+'.log')
 assert not log.exists(),name
 t=time.time()
 with log.open('w') as out:r=subprocess.run(cmd,cwd=p/'terminal',stdout=out,stderr=subprocess.STDOUT,text=True,timeout=300)
 row={'name':name,'command':cmd,'exitCode':r.returncode,'seconds':round(time.time()-t,2),'logSha256':hashlib.sha256(log.read_bytes()).hexdigest()}
 results.append(row);print(json.dumps(row),flush=True)
 if r.returncode:print(log.read_text()[-5000:],flush=True);break
receipt={'schema':'terminal_pr645_reader_and_type_validation.v1','completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':results}
(proof/'reader-and-types.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt),flush=True)
