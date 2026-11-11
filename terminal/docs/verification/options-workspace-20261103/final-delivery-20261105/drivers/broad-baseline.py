from pathlib import Path
import datetime,gzip,hashlib,json,os,re,subprocess,sys,time
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");O=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3");P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree")
mode=sys.argv[1];assert mode in ["original","preview"];root=O if mode=="original" else P;T=root/"terminal";R=W/("final-unit-typecheck-"+mode+"-r4");assert not R.exists();R.mkdir()
receipt=json.loads((W/"browser-preview-navigation-r4/browser-receipt.json").read_text());assert receipt["passed"]==39 and receipt["exit"]==0 and receipt["source_stable"] and receipt["owned_server_stopped"]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def sources():
 result={"terminal/"+str(f.relative_to(T)):sha(f) for folder in ["app","components","lib","e2e"] for f in sorted((T/folder).rglob("*")) if f.is_file()}
 for n in ["package.json","package-lock.json","tsconfig.json","next.config.ts","playwright.config.ts","next-env.d.ts","proxy.ts","vitest.config.ts","eslint.config.mjs"]:
  if (T/n).exists():result["terminal/"+n]=sha(T/n)
 return dict(sorted(result.items()))
before=sources();(R/"source-before.json").write_text(json.dumps(before,indent=2)+"\n")
generated=T/"next-env.d.ts";original_generated=generated.read_bytes();(R/"next-env-before.d.ts.gz").write_bytes(gzip.compress(original_generated,mtime=0))
env=os.environ.copy();env.pop("CI",None);env["NODE_OPTIONS"]="--no-experimental-webstorage";checks=[]
commands=[("typegen",["./node_modules/.bin/next","typegen"],180),("typecheck",["./node_modules/.bin/tsc","--noEmit","--incremental","false"],600),("unit",["./node_modules/.bin/vitest","run","--maxWorkers=4","--minWorkers=2","--reporter=default","--reporter=json","--outputFile="+str(R/"unit-report.json")],1200),("plain-language-self-check",["node","scripts/check_plain_language.mjs","--self-check"],120)]
try:
 for name,command,timeout in commands:
  log=R/(name+".log");start=time.monotonic();print("GATE_START",mode,name,flush=True)
  try:
   with log.open("x") as out:result=subprocess.run(command,cwd=T,env=env,stdout=out,stderr=subprocess.STDOUT,timeout=timeout)
   row={"check":name,"command":command,"exit":result.returncode,"seconds":round(time.monotonic()-start,3),"log_sha256":sha(log)}
  except subprocess.TimeoutExpired:
   row={"check":name,"command":command,"exit":None,"timed_out":True,"seconds":round(time.monotonic()-start,3),"log_sha256":sha(log)}
  (R/(name+".log.gz")).write_bytes(gzip.compress(log.read_bytes(),mtime=0));checks.append(row)
  if name=="typegen":
   (R/"next-env-generated.d.ts.gz").write_bytes(gzip.compress(generated.read_bytes(),mtime=0));row["generated_next_env_sha256"]=sha(generated)
  if name=="unit" and (R/"unit-report.json").exists():
   report=json.loads((R/"unit-report.json").read_text());row["summary"]={k:report.get(k) for k in ["success","numTotalTestSuites","numPassedTestSuites","numFailedTestSuites","numTotalTests","numPassedTests","numFailedTests","numPendingTests","numTodoTests"]}
  (R/"checks-in-progress.json").write_text(json.dumps(checks,indent=2)+"\n");print("GATE_RESULT",mode,json.dumps(row),flush=True)
finally:
 current=generated.read_bytes();(R/"next-env-before-restoration.d.ts.gz").write_bytes(gzip.compress(current,mtime=0));generated.write_bytes(original_generated)
after=sources();(R/"source-after.json").write_text(json.dumps(after,indent=2)+"\n")
record={"schema":"options_final_unit_typecheck.v1","profile":mode,"completed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source_stable":before==after,"source_count":len(after),"source_map_sha256":sha(R/"source-after.json"),"checks":checks,"typegen_generated_declaration_restored":True,"browser_source_profile_preserved":True,"workers":"4 maximum / 2 minimum; no concurrent owned Next server","all_checks_passed":all(c.get("exit")==0 for c in checks)}
(R/"qualification.json").write_text(json.dumps(record,indent=2)+"\n");print("FINAL_GATES",json.dumps(record),flush=True)
assert record["all_checks_passed"] and before==after,"UNIT_TYPECHECK_REQUIRES_RECONCILIATION"
