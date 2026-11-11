#!/usr/bin/env python3
"""Refresh the existing preview's affected native capture packets, one server at a time."""
from pathlib import Path
import hashlib,json,os,socket,subprocess,sys,time
import yaml
P=Path(__file__).resolve().parent
R=P/"protected4df-20261104"
T=P/"tree/terminal"
F=T/".next/test-fonts/google-responses-offline-20261104.cjs"
assert F.is_file()
for port in [3641,3642,3643,3644,3645,3651,3653,3655]:
    with socket.socket() as s:
        s.settimeout(1)
        assert s.connect_ex(("127.0.0.1",port))!=0,("OWNED_SERVER_STILL_RUNNING",port)
results=[]
for kind,packet,expected,port in [
 ("gex","gex-levels-heatmap-load-failure",114,3653),
 ("eod","eod-heatmap-flowdesk-load-failure",126,3655),
]:
    out=R/("capture-"+kind)
    assert not out.exists(),("DO_NOT_REPEAT_EXISTING_CAPTURE",out)
    out.mkdir()
    harness=T/"e2e/tools"/("capture_gex_levels_heatmap_load_failure.cjs" if kind=="gex" else "capture_eod_heatmap_flowdesk_load_failure.cjs")
    active=yaml.safe_load((T/"docs/pr-crops"/packet/"EVIDENCE.yml").read_text())
    dependencies=sorted(set(active["layoutFiles"])|{str(harness.relative_to(P/"tree"))})
    def current():
        return {x:hashlib.sha256((P/"tree"/x).read_bytes()).hexdigest() for x in dependencies}
    before=current()
    log=R/("capture-"+kind+".log")
    env=os.environ.copy()
    for key in ["CAPTURE_ONLY","UPDATE_HEATMAP_EVIDENCE"]:env.pop(key,None)
    env.update({"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(F),"NODE_OPTIONS":"--no-experimental-webstorage",
                "TERMINAL_CROP_OUTPUT_DIR":str(out),"TERMINAL_CROP_PORT":str(port),"TERMINAL_CROP_WEBPACK":"1"})
    command=["node",str(harness)]
    print("NATIVE_CAPTURE_START",kind,"expected",expected,"port",port,flush=True)
    with log.open("w") as f:
        proc=subprocess.run(command,cwd=T,env=env,stdout=f,stderr=subprocess.STDOUT)
    after=current()
    passed=sorted(x for x in out.glob("*.png") if not x.name.startswith("FAIL-"))
    failures=sorted(x.name for x in out.glob("FAIL-*.png"))
    receipt={"kind":kind,"packet":packet,"expected":expected,"exit":proc.returncode,
             "successful_files":len(passed),"failed_frames":failures,"source_stable":before==after,
             "source_sha256":after,"command":command,"output_directory":str(out),
             "log_sha256":hashlib.sha256(log.read_bytes()).hexdigest(),
             "image_sha256":{x.name:hashlib.sha256(x.read_bytes()).hexdigest() for x in passed}}
    (R/("capture-"+kind+".json")).write_text(json.dumps(receipt,indent=2)+"\n")
    print("NATIVE_CAPTURE_RESULT",json.dumps({k:receipt[k] for k in ["kind","exit","successful_files","failed_frames","source_stable"]}),flush=True)
    results.append(receipt)
(R/"capture-results.json").write_text(json.dumps(results,indent=2)+"\n")
assert all(x["exit"]==0 and x["successful_files"]==x["expected"] and not x["failed_frames"] and x["source_stable"] for x in results),"CAPTURES_REQUIRE_RECONCILIATION"
print("ALL_NATIVE_CAPTURE_PACKETS_COMPLETE",sum(x["successful_files"] for x in results),flush=True)
