from pathlib import Path
import hashlib,json,os,socket,subprocess,sys
import yaml
P=Path(__file__).resolve().parent
mode=sys.argv[1];assert mode in ("preview","original")
T=P/"tree/terminal" if mode=="preview" else P.parents[1]
R=P/("protected4df-20261104" if mode=="preview" else "original-lab-integration-20261104")
font=P/"tree/terminal/.next/test-fonts/google-responses-offline-20261104.cjs"
ports=[3657,3659] if mode=="preview" else [3671,3673]
for port in ports+([3653,3655] if mode=="preview" else [3661]):
 with socket.socket() as s:
  s.settimeout(1);assert s.connect_ex(("127.0.0.1",port))!=0,("OWNED_SERVER_ACTIVE",port)
assert hashlib.sha256((T/"components/gexdesk/GexDeskView.tsx").read_bytes()).hexdigest()=="e2b1cea4319f0860321d86d3fc8d8fc133060ce11cd7e1bdc0768207613d0a98"
results=[]
for (kind,packet,expected),port in zip([("gex","gex-levels-heatmap-load-failure",54),("eod","eod-heatmap-flowdesk-load-failure",42)],ports):
 out=R/("gate-fixed-capture-"+kind);assert not out.exists(),("EXISTING_CAPTURE_RECONCILE",out);out.mkdir()
 harness=T/"e2e/tools"/("capture_gex_levels_heatmap_load_failure.cjs" if kind=="gex" else "capture_eod_heatmap_flowdesk_load_failure.cjs")
 active=yaml.safe_load((T/"docs/pr-crops"/packet/"EVIDENCE.yml").read_text())
 paths=sorted(set(active["layoutFiles"])|{"terminal/"+str(harness.relative_to(T))}|{
 "terminal/components/researchlab/OptionsResearchLab.tsx",
 "terminal/components/options-companion/GexMarketMemory.tsx",
 "terminal/components/researchlab/ResearchReportedGammaPanel.tsx",
 "terminal/components/researchlab/researchReportedGamma.ts",
 })
 def current():return {x:hashlib.sha256((T.parent/x).read_bytes()).hexdigest() for x in paths}
 before=current();log=R/("gate-fixed-capture-"+kind+".log")
 env=os.environ.copy();env.pop("UPDATE_HEATMAP_EVIDENCE",None)
 env.update({"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(font),"NODE_OPTIONS":"--no-experimental-webstorage","CAPTURE_ONLY":"^"+kind+"-","TERMINAL_CROP_OUTPUT_DIR":str(out),"TERMINAL_CROP_PORT":str(port),"TERMINAL_CROP_WEBPACK":"1"})
 command=["node",str(harness)]
 print("SCOPED_CAPTURE_START",mode,kind,expected,port,flush=True)
 with log.open("x") as f:result=subprocess.run(command,cwd=T,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=1000)
 after=current();images=sorted(x for x in out.glob("*.png") if not x.name.startswith("FAIL-"));failed=sorted(x.name for x in out.glob("FAIL-*.png"))
 record={"operation":"lab-source-gate-fix-20261104-c3","mode":mode,"kind":kind,"packet":packet,"selector":"^"+kind+"-","expected":expected,"exit":result.returncode,"successful_files":len(images),"failed_frames":failed,"source_stable":before==after,"source_sha256":after,"command":command,"output_directory":str(out),"log_sha256":hashlib.sha256(log.read_bytes()).hexdigest(),"image_sha256":{x.name:hashlib.sha256(x.read_bytes()).hexdigest() for x in images},"manifest_written_by_harness":(out/"EVIDENCE.yml").exists()}
 (R/("gate-fixed-capture-"+kind+".json")).write_text(json.dumps(record,indent=2)+"\n")
 results.append(record);print("SCOPED_CAPTURE_RESULT",json.dumps({k:record[k] for k in ["mode","kind","exit","successful_files","failed_frames","source_stable"]}),flush=True)
 assert result.returncode==0 and len(images)==expected and not failed and before==after,"CAPTURE_REQUIRES_RECONCILIATION"
(R/"gate-fixed-capture-results.json").write_text(json.dumps(results,indent=2)+"\n")
print("ALL_SCOPED_CAPTURES_COMPLETE",mode,sum(x["successful_files"] for x in results),flush=True)
