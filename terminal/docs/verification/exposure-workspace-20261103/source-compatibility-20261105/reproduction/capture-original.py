from pathlib import Path
import hashlib,json,os,socket,subprocess
import yaml
ROOT=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3")
T=ROOT/"terminal"
R=T/".next/options-source-reconcile-20261105"
FONT=T/".next/options-completion-preview-0vgroh6i/tree/terminal/.next/test-fonts/google-responses-offline-20261104.cjs"
assert FONT.exists()
assert hashlib.sha256((T/"components/gexdesk/GexDeskView.tsx").read_bytes()).hexdigest()=="770ddedbe67516359a1f8d29f1ce28a7cc89b63e16dba87071b84609fc04b544"
records=[]
for kind,packet,expected,port in [("gex","gex-levels-heatmap-load-failure",114,3671),("eod","eod-heatmap-flowdesk-load-failure",126,3673)]:
    for n in (port,3661):
        with socket.socket() as sock:
            sock.settimeout(1)
            assert sock.connect_ex(("127.0.0.1",n))!=0,("OWNED_PORT_ACTIVE",n)
    out=R/("native-"+kind)
    log=R/("native-"+kind+".log")
    assert not out.exists() and not log.exists(), "RECONCILE_EXISTING_CAPTURE"
    out.mkdir()
    harness=T/"e2e/tools"/("capture_gex_levels_heatmap_load_failure.cjs" if kind=="gex" else "capture_eod_heatmap_flowdesk_load_failure.cjs")
    prior=yaml.safe_load((T/"docs/pr-crops"/packet/"EVIDENCE.yml").read_text())
    paths=sorted(set(prior["layoutFiles"])|{"terminal/"+str(harness.relative_to(T)),"terminal/lib/idbJsonStore.ts","terminal/components/researchlab/OptionsResearchLab.tsx","terminal/components/options-companion/GexMarketMemory.tsx","terminal/components/researchlab/ResearchReportedGammaPanel.tsx","terminal/components/researchlab/researchReportedGamma.ts"})
    def current(): return {rel:hashlib.sha256((ROOT/rel).read_bytes()).hexdigest() for rel in paths}
    before=current()
    env=os.environ.copy()
    for key in ("CAPTURE_ONLY","UPDATE_HEATMAP_EVIDENCE"): env.pop(key,None)
    env.update({"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(FONT),"NODE_OPTIONS":"--no-experimental-webstorage","TERMINAL_CROP_OUTPUT_DIR":str(out),"TERMINAL_CROP_PORT":str(port),"TERMINAL_CROP_WEBPACK":"1"})
    command=["node",str(harness)]
    print("FULL_CAPTURE_START",kind,expected,port,flush=True)
    with log.open("x") as output: result=subprocess.run(command,cwd=T,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=1200)
    after=current()
    images=sorted(x for x in out.glob("*.png") if not x.name.startswith("FAIL-"))
    failed=sorted(x.name for x in out.glob("FAIL-*.png"))
    record={"operation":"exposure-source-compatibility-20261105","protectedBase":"11531481b0a540ee96bcd86df418fd1e42715363","kind":kind,"packet":packet,"expected":expected,"exit":result.returncode,"successful_files":len(images),"failed_frames":failed,"source_stable":before==after,"source_sha256":after,"command":command,"output_directory":str(out),"log_sha256":hashlib.sha256(log.read_bytes()).hexdigest(),"image_sha256":{x.name:hashlib.sha256(x.read_bytes()).hexdigest() for x in images},"native_manifest_sha256":hashlib.sha256((out/"EVIDENCE.yml").read_bytes()).hexdigest() if (out/"EVIDENCE.yml").exists() else None}
    (R/("native-"+kind+".json")).write_text(json.dumps(record,indent=2)+"\n")
    records.append(record)
    print("FULL_CAPTURE_RESULT",json.dumps({k:record[k] for k in ("kind","exit","successful_files","failed_frames","source_stable")}),flush=True)
    assert result.returncode==0 and len(images)==expected and not failed and before==after and record["native_manifest_sha256"], "CAPTURE_REQUIRES_RECONCILIATION"
(R/"native-capture-results.json").write_text(json.dumps(records,indent=2)+"\n")
print("FULL_CAPTURES_COMPLETE",sum(x["successful_files"] for x in records),flush=True)
