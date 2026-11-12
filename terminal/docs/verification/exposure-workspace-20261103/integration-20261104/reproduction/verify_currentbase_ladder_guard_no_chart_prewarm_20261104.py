from pathlib import Path
import hashlib, json, os, signal, socket, subprocess, sys, time, urllib.request

root=Path(__file__).resolve().parent
tree=root/"tree"/"terminal"
records=root/"paper6d6-currentbase-20261104"
old_snapshot=json.loads((records/"source-before-browser.json").read_text())
changes={
 "terminal/e2e/exposure-partial-totals.spec.ts":"15be383d94284d83c7b893dc9c1a83c3d023528b97b2527891c7801c0f1f9c16",
 "terminal/e2e/responsive.spec.ts":"b45e77c6295aacd937dba1d20433339687a4c88b40f33fc2cc060719ac670b1e",
}
log=records/"ladder-guard-no-chart-prewarm-20261104.log"
server_log=records/"ladder-guard-no-chart-prewarm-server-20261104.log"
font=tree/".next"/"test-fonts"/"google-responses-offline-20261104.cjs"
assert len(old_snapshot)==2963 and all(k in old_snapshot for k in changes)
assert not log.exists() and not server_log.exists() and font.is_file()
for relative, expected in old_snapshot.items():
    file=root/"tree"/relative
    assert file.is_file() and not file.is_symlink(), f"MISSING {relative}"
    actual=hashlib.sha256(file.read_bytes()).hexdigest()
    assert actual==changes.get(relative,expected), f"CHANGED_WITHOUT_AUTHORITY {relative}"
print("SOURCE_FENCE_PASS",len(old_snapshot),"two exact test-only deltas",flush=True)
for packet in ("qualification-gex-20261104","qualification-eod-20261104"):
    assert (records/packet/"EVIDENCE.yml").is_file(),f"MISSING_CAPTURE_PROOF {packet}"
port=3646
with socket.socket() as check:
    check.settimeout(.7)
    assert check.connect_ex(("127.0.0.1",port))!=0,"PORT_BUSY"
env=os.environ.copy()
env.update({
 "NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(font),
 "NODE_OPTIONS":"--no-experimental-webstorage",
 "ANALYSIS_LOCAL_PREVIEW":"1",
 "ADMIN_DEV":"1",
 "TERMINAL_E2E_FIXTURE":"1",
 "TERMINAL_E2E_EMAIL":"responsive@example.com",
 "TERMINAL_E2E_ENTITLEMENT":"unlimited",
 "RATE_LIMIT_MAX":"100000",
 "HUB_REALTIME_QUOTES":"1",
 "TICKER_NEWS_RAIL":"1",
 "FLOW_FIXTURE":"1",
 "INVESTIGATION_API_ADMISSION":"open",
 "NEXT_PUBLIC_SUPABASE_URL":"http://127.0.0.1:54321",
 "NEXT_PUBLIC_SUPABASE_ANON_KEY":"fixture-anon-key",
 "TERMINAL_E2E_PORT":str(port),
 "OPTIONS_COMBINED_EXPOSURE_PREWARM":"0",
})
proc=None
with server_log.open("x") as server:
    try:
        proc=subprocess.Popen(["./node_modules/.bin/next","dev","--webpack","--hostname","127.0.0.1","--port",str(port)],cwd=tree,env=env,stdout=server,stderr=subprocess.STDOUT,start_new_session=True)
        print("OWNED_NEXT_PID",proc.pid,flush=True)
        deadline=time.monotonic()+170
        while time.monotonic()<deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"NEXT_EXIT_EARLY {proc.returncode}")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/options?tab=gex",timeout=8) as reply:
                    if reply.status==200:break
            except Exception:pass
            time.sleep(2)
        else:raise RuntimeError("NEXT_NOT_READY")
        args=["./node_modules/.bin/playwright","test","e2e/responsive.spec.ts",
          "--grep","Exposure desk replays an archived session",
          "--project=desktop","--project=tablet","--project=mobile",
          "--workers=1","--retries=0","--trace=on",
          "--output=.next/paper6d6-ladder-guard-no-chart-prewarm-20261104"]
        print("TEST_STARTED",args[2:],flush=True)
        with log.open("x") as output:
            try:
                status=subprocess.run(args,cwd=tree,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=720).returncode
            except subprocess.TimeoutExpired:status=124
        print("PLAYWRIGHT_EXIT",status,flush=True)
        print("\n".join(log.read_text(errors="replace").splitlines()[-23:]),flush=True)
        sys.exit(status)
    finally:
        if proc and proc.poll() is None:
            try:os.killpg(proc.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:proc.wait(timeout=12)
            except subprocess.TimeoutExpired:
                try:os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                proc.wait(timeout=5)
        print("OWNED_NEXT_STOPPED",proc.pid if proc else "none",flush=True)
