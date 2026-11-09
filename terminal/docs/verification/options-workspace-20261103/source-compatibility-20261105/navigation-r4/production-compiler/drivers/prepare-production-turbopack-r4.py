from pathlib import Path
import json,hashlib,subprocess,datetime
P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree");W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");R=W/"production-turbopack-navigation-r4";C=R/"tree"
assert not R.exists();R.mkdir();C.mkdir()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
T=P/"terminal"
def inputs(root):
 t=root/"terminal";d={"terminal/"+str(p.relative_to(t)):sha(p) for n in ["app","components","lib","e2e"] for p in sorted((t/n).rglob("*")) if p.is_file()}
 for n in ["package.json","package-lock.json","tsconfig.json","next.config.ts","playwright.config.ts","next-env.d.ts","proxy.ts"]:
  if (t/n).exists():d["terminal/"+n]=sha(t/n)
 return dict(sorted(d.items()))
before=inputs(P);(R/"source-inputs.json").write_text(json.dumps(before,indent=2)+"\n")
command=["/usr/bin/rsync","-a","--exclude=.git","--exclude=.next","--exclude=node_modules","--exclude=.env*","--exclude=test-results","--exclude=playwright-report","--exclude=*.tsbuildinfo",str(P)+"/",str(C)+"/"]
with (R/"source-copy.log").open("x") as f:subprocess.run(command,stdout=f,stderr=subprocess.STDOUT,check=True,timeout=240)
assert before==inputs(C)==inputs(P),"ISOLATED_SOURCE_COPY_MISMATCH"
assert not (C/"terminal/node_modules").exists()
with (R/"dependency-copy.log").open("x") as f:
 result=subprocess.run(["/bin/cp","-cR",str(T/"node_modules"),str(C/"terminal/node_modules")],stdout=f,stderr=subprocess.STDOUT,timeout=240)
assert result.returncode==0,"DEPENDENCY_COPY_REQUIRES_RECONCILIATION"
for rel in ["next/package.json","react/package.json","react-dom/package.json","@playwright/test/package.json"]:
 assert sha(T/"node_modules"/rel)==sha(C/"terminal/node_modules"/rel)
r={"schema":"options_isolated_build_copy.v1","source_root":str(P),"copied_root":str(C),"source_count":len(before),"source_sha256":sha(R/"source-inputs.json"),"source_copy_exact":True,"source_profile":"combined115-based preview with r4Options repair","git_worktree":False,"publisher_target":False,"copy_command":command,"dependencies_within_turbopack_root":True,"created_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
(R/"copy-receipt.json").write_text(json.dumps(r,indent=2)+"\n")
print(json.dumps(r,indent=2))
