from pathlib import Path
import hashlib,json,os,signal,socket,subprocess,sys,time,urllib.request
ROOT=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3")
P=ROOT/"terminal/.next/options-completion-preview-0vgroh6i"
WORK=ROOT/"terminal/.next/options-source-reconcile-20261105"
mode=sys.argv[1];assert mode in ("original","preview")
T=ROOT/"terminal" if mode=="original" else P/"tree/terminal"
R=WORK if mode=="original" else WORK/"preview"
port=3661 if mode=="original" else 3663
with socket.socket() as sock:
    sock.settimeout(1);assert sock.connect_ex(("127.0.0.1",port))!=0,"OWNED_PORT_ACTIVE"
def sources():return {"terminal/"+str(f.relative_to(T)):hashlib.sha256(f.read_bytes()).hexdigest() for folder in ("app","components","lib","e2e") for f in sorted((T/folder).rglob("*")) if f.is_file()}
before=sources();(R/"browser-source-before.json").write_text(json.dumps(before,indent=2)+"\n")
env=os.environ.copy()
env.update({"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(P/"tree/terminal/.next/test-fonts/google-responses-offline-20261104.cjs"),"NODE_OPTIONS":"--no-experimental-webstorage","ANALYSIS_LOCAL_PREVIEW":"1","ADMIN_DEV":"1","TERMINAL_E2E_FIXTURE":"1","TERMINAL_E2E_EMAIL":"responsive@example.com","TERMINAL_E2E_ENTITLEMENT":"unlimited","RATE_LIMIT_MAX":"100000","HUB_REALTIME_QUOTES":"1","TICKER_NEWS_RAIL":"1","FLOW_FIXTURE":"1","INVESTIGATION_API_ADMISSION":"open","NEXT_PUBLIC_SUPABASE_URL":"http://127.0.0.1:54321","NEXT_PUBLIC_SUPABASE_ANON_KEY":"fixture-anon-key","TERMINAL_E2E_PORT":str(port),"OPTIONS_COMBINED_EXPOSURE_PREWARM":"0","OPTIONS_COMBINED_VISUAL_PREWARM":"0"})
serverlog=R/"browser-server.log";log=R/"browser.log"
assert not serverlog.exists() and not log.exists(),"RECONCILE_EXISTING_BROWSER"
proc=None
with serverlog.open("x") as output:
    try:
        proc=subprocess.Popen(["./node_modules/.bin/next","dev","--webpack","--hostname","127.0.0.1","--port",str(port)],cwd=T,env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
        print("BROWSER_SERVER",mode,proc.pid,port,flush=True)
        deadline=time.monotonic()+180
        while time.monotonic()<deadline:
            assert proc.poll() is None,"NEXT_EXIT_EARLY"
            try:
                with urllib.request.urlopen("http://127.0.0.1:"+str(port)+"/options",timeout=5) as response:
                    if response.status==200:break
            except Exception:pass
            time.sleep(2)
        else:raise RuntimeError("NEXT_NOT_READY")
        command=["./node_modules/.bin/playwright","test","e2e/options-lab-source-state.spec.ts"]
        if mode=="preview":
            command+=["e2e/exposure-workspace.spec.ts","e2e/sector-exposure-depth-return.spec.ts","--grep","Research Lab|Exposure opens on usable strikes|stepping and Back preserve"]
        command+=["--project=desktop","--project=tablet","--project=mobile","--workers=1","--retries=0","--trace=on","--output=.next/source-availability-"+mode+"-20261105"]
        print("BROWSER_START",mode,json.dumps(command),flush=True)
        with log.open("x") as out:result=subprocess.run(command,cwd=T,env=env,stdout=out,stderr=subprocess.STDOUT,timeout=1500)
        after=sources();(R/"browser-source-after.json").write_text(json.dumps(after,indent=2)+"\n")
        record={"mode":mode,"protectedBase":"11531481b0a540ee96bcd86df418fd1e42715363","exit":result.returncode,"command":command,"source_stable":before==after,"source_count":len(after),"source_map_sha256":hashlib.sha256((R/"browser-source-after.json").read_bytes()).hexdigest(),"log_sha256":hashlib.sha256(log.read_bytes()).hexdigest(),"retries":0}
        (R/"browser-receipt.json").write_text(json.dumps(record,indent=2)+"\n")
        print("BROWSER_RESULT",json.dumps(record),flush=True);print("\n".join(log.read_text(errors="replace").splitlines()[-24:])[-5000:],flush=True)
        assert result.returncode==0 and before==after,"BROWSER_REQUIRES_RECONCILIATION"
    finally:
        if proc and proc.poll() is None:
            os.killpg(proc.pid,signal.SIGTERM)
            try:proc.wait(timeout=12)
            except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
        print("OWNED_BROWSER_SERVER_STOPPED",mode,proc.pid if proc else None,flush=True)
