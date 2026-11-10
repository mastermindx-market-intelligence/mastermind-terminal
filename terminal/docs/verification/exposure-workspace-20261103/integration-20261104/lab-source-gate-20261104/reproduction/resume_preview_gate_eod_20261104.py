from pathlib import Path
import hashlib,json,os,socket,subprocess
P=Path(__file__).resolve().parent;T=P/"tree/terminal";R=P/"protected4df-20261104"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
old=R/"gate-fixed-capture-eod.json";failed=json.loads(old.read_text())
assert failed["exit"]==-15 and failed["successful_files"]==0 and failed["source_stable"]
assert not list((R/"gate-fixed-capture-eod").iterdir())
assert 'Bad port: "3659" is reserved' in (R/"gate-fixed-capture-eod.log").read_text()
for port in [3659,3655,3657,3663]:
 with socket.socket() as s:s.settimeout(1);assert s.connect_ex(("127.0.0.1",port))!=0,("SERVER_ACTIVE",port)
ps=subprocess.run(["ps","-axo","command="],capture_output=True,text=True).stdout.splitlines()
assert not any(line.endswith("capture_lab_source_gate_20261104.py preview") for line in ps)
assert failed["source_sha256"]=={k:sha(T.parent/k) for k in failed["source_sha256"]}
gex=json.loads((R/"gate-fixed-capture-gex.json").read_text())
assert gex["exit"]==0 and gex["successful_files"]==54 and gex["source_stable"]
assert gex["source_sha256"]=={k:sha(T.parent/k) for k in gex["source_sha256"]}
for extension in ["",".json",".log"]:
 src=R/("gate-fixed-capture-eod"+extension);dest=R/("gate-fixed-capture-eod-setup-failed-port3659"+extension)
 assert not dest.exists();src.rename(dest)
out=R/"gate-fixed-capture-eod";out.mkdir();log=R/"gate-fixed-capture-eod.log"
paths=failed["source_sha256"];before={k:sha(T.parent/k) for k in paths}
env=os.environ.copy();env.pop("UPDATE_HEATMAP_EVIDENCE",None)
env.update({"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(T/".next/test-fonts/google-responses-offline-20261104.cjs"),"NODE_OPTIONS":"--no-experimental-webstorage","CAPTURE_ONLY":"^eod-","TERMINAL_CROP_OUTPUT_DIR":str(out),"TERMINAL_CROP_PORT":"3655","TERMINAL_CROP_WEBPACK":"1"})
command=["node",str(T/"e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs")]
print("RECONCILED_PREVIEW_EOD_START",3655,flush=True)
with log.open("x") as f:proc=subprocess.run(command,cwd=T,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=1000)
after={k:sha(T.parent/k) for k in paths};images=sorted(x for x in out.glob("*.png") if not x.name.startswith("FAIL-"));failures=sorted(x.name for x in out.glob("FAIL-*.png"))
record={"operation":"lab-source-gate-fix-20261104-c3","mode":"preview","kind":"eod","packet":"eod-heatmap-flowdesk-load-failure","selector":"^eod-","expected":42,"exit":proc.returncode,"successful_files":len(images),"failed_frames":failures,"source_stable":before==after,"source_sha256":after,"command":command,"output_directory":str(out),"log_sha256":sha(log),"image_sha256":{x.name:sha(x) for x in images},"manifest_written_by_harness":(out/"EVIDENCE.yml").exists(),"resolvedSetupFailure":{"reason":"Next reserved port3659 before any capture","receipt":"gate-fixed-capture-eod-setup-failed-port3659.json","receiptSha256":sha(R/"gate-fixed-capture-eod-setup-failed-port3659.json"),"changedPort":3655}}
(R/"gate-fixed-capture-eod.json").write_text(json.dumps(record,indent=2)+"\n")
print("RECONCILED_PREVIEW_EOD_RESULT",json.dumps({k:record[k] for k in ["exit","successful_files","failed_frames","source_stable"]}),flush=True)
assert proc.returncode==0 and len(images)==42 and not failures and before==after,"CAPTURE_REQUIRES_RECONCILIATION"
(R/"gate-fixed-capture-results.json").write_text(json.dumps([gex,record],indent=2)+"\n")
print("ALL_SCOPED_CAPTURES_COMPLETE preview 96",flush=True)
