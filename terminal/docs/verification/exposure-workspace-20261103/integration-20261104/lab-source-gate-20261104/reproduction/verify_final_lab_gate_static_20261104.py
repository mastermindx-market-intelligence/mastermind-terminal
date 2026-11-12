from pathlib import Path
import hashlib,json,os,subprocess
import yaml
P=Path(__file__).resolve().parent
env=os.environ.copy();env["NODE_OPTIONS"]="--no-experimental-webstorage"
for mode in ["original","preview"]:
 T=P.parents[1] if mode=="original" else P/"tree/terminal"
 R=P/("original-lab-integration-20261104" if mode=="original" else "protected4df-20261104")
 assert not (R/"final-static-results.json").exists()
 checks=["lib/__tests__/gexLevelsHeatmapLoadFailureEvidence.test.ts","lib/__tests__/eodHeatmapFlowdeskLoadFailureEvidence.test.ts"]
 if mode=="preview":checks+=["lib/__tests__/visualIntelligenceEvidence.test.ts","lib/__tests__/b_pl_6Batch1Evidence.test.ts"]
 config=R/"source-tsconfig.json"
 assert config.exists()
 jobs=[("evidence",["./node_modules/.bin/vitest","run",*checks]),("typescript",["./node_modules/.bin/tsc","--noEmit","-p",str(config)]),("lint",["./node_modules/.bin/eslint","e2e/options-lab-source-state.spec.ts","lib/__tests__/gexLevelsHeatmapLoadFailureEvidence.test.ts","lib/__tests__/eodHeatmapFlowdeskLoadFailureEvidence.test.ts"])]
 rows=[]
 for label,cmd in jobs:
  log=R/("final-"+label+".log");assert not log.exists()
  print("FINAL_STATIC_START",mode,label,flush=True)
  with log.open("x") as out:r=subprocess.run(cmd,cwd=T,env=env,stdout=out,stderr=subprocess.STDOUT,timeout=600)
  row={"mode":mode,"check":label,"exit":r.returncode,"command":cmd,"logSha256":hashlib.sha256(log.read_bytes()).hexdigest()}
  rows.append(row);print("FINAL_STATIC_RESULT",json.dumps(row),flush=True)
  print("\n".join(log.read_text(errors="replace").splitlines()[-22:])[-6000:],flush=True)
 (R/"final-static-results.json").write_text(json.dumps(rows,indent=2)+"\n")
 if mode=="preview":
  reused=[]
  for packet in ["terminal-visual-intelligence","b-pl-6-batch-1"]:
   f=T/"docs/pr-crops"/packet/"EVIDENCE.yml";d=yaml.safe_load(f.read_text())
   files=d["layoutFiles"];bad=[k for k,v in files.items() if hashlib.sha256((T.parent/k).read_bytes()).hexdigest()!=v]
   reused.append({"packet":packet,"manifestSha256":hashlib.sha256(f.read_bytes()).hexdigest(),"declaredDependencies":len(files),"mismatches":bad,"qualification":"Historical native proof reused only within its unchanged declared dependency set; no new run claimed."})
  (R/"unchanged-evidence-dependencies.json").write_text(json.dumps(reused,indent=2)+"\n")
  assert all(not x["mismatches"] for x in reused)
  print("UNCHANGED_DEPENDENCIES",json.dumps(reused),flush=True)
print("FINAL_STATIC_RUNS_COMPLETE",flush=True)
