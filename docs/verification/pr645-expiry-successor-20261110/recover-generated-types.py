from pathlib import Path
import subprocess,json,time,hashlib,datetime
p=Path('/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr645-expiry-integration-20261109-c4')
d=p/'docs/verification/pr645-expiry-successor-20261110'
src=p/'terminal/.next/dev/types'
dest=d/'generated-dev-types-before-recovery'
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
assert not src.is_symlink() and src.is_dir() and not dest.exists()
assert sha(src/'routes.d.ts')=='6e316f254be320ec3d87e151a293168d01cfbda792372580833325e5399d31f3'
assert sha(p/'terminal/.next/types/routes.d.ts')=='e27647133b4d1378866b9a50fb7a37189ec7fe06f56aaa8c3988d08711e4c901'
listener=subprocess.run(['lsof','-nP','-iTCP:47465','-sTCP:LISTEN'],capture_output=True,text=True)
assert listener.returncode==1 and not listener.stdout.strip(),listener.stdout
cwd=subprocess.run(['lsof','-nP','-d','cwd','-Fpn'],capture_output=True,text=True)
holders=[];pid=None
for line in cwd.stdout.splitlines():
 if line.startswith('p'):pid=line[1:]
 elif line.startswith('n') and (line[1:]==str(p) or line[1:].startswith(str(p)+'/')):holders.append({'pid':pid,'cwd':line[1:]})
assert not holders,holders
before={str(f.relative_to(src)):sha(f) for f in src.rglob('*') if f.is_file()}
assert len(before)==3 and all(not f.is_symlink() for f in src.rglob('*'))
src.rename(dest)
assert {str(f.relative_to(dest)):sha(f) for f in dest.rglob('*') if f.is_file()}==before
record={'schema':'terminal_pr645_generated_type_recovery.v1','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cause':'Corrupt generated development route declaration constrains all routes to slash while its validator covers the complete app. Fresh production typegen output is complete. Historical writer interleaving is not proven.','priorValidation':'reader-and-types.json','priorTypeScriptLog':'typescript.log','movedFrom':'terminal/.next/dev/types','preservedAt':str(dest.relative_to(p)),'files':before,'sourceChange':False,'gateChange':False,'listenerClosed':True,'workspaceCwdHolders':holders,'retainedProductionRoutesSha256':sha(p/'terminal/.next/types/routes.d.ts')}
(d/'generated-type-recovery.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
cmd=['npm','exec','--','tsc','--noEmit'];t=time.time();log=d/'typescript-r2.log'
assert not log.exists()
with log.open('w') as out:r=subprocess.run(cmd,cwd=p/'terminal',stdout=out,stderr=subprocess.STDOUT,text=True,timeout=300)
record.update({'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':cmd,'exitCode':r.returncode,'seconds':round(time.time()-t,2),'logSha256':sha(log),'state':'FULL_TYPESCRIPT_PASSED' if r.returncode==0 else 'TYPECHECK_FAILED'})
(d/'generated-type-recovery.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
print(json.dumps(record));print(log.read_text()[-5000:])
