from pathlib import Path
import hashlib,json,os,re,shutil,signal,socket,subprocess,time,urllib.request
B=Path("/Volumes/Mastermind/agent-workspaces/terminal/web")
O=B/"options-workspace-surface-flow-ux-20261103-c3";P=B/"exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree"
T=P/"terminal";W=O/"terminal/.next/options-source-reconcile-20261105"
FONT=T/".next/test-fonts/google-responses-offline-20261104.cjs"
sets=json.loads((W/"visual-source-equality-navigation-r4.json").read_text())
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def sources(kind,root):return {rel:sha(root/rel) for rel in sets[kind]["paths"]}
def free(port):
    with socket.socket() as s:s.settimeout(1);assert s.connect_ex(("127.0.0.1",port))!=0,("OWNED_PORT_ACTIVE",port)
env=os.environ.copy()
for key in ["CAPTURE_ONLY","TERMINAL_PL6_EVIDENCE_OPERATION_ID","TERMINAL_EVIDENCE_COMPOSITION","TERMINAL_EVIDENCE_MODE"]:env.pop(key,None)
env.update({"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(FONT),"NODE_OPTIONS":"--no-experimental-webstorage","ANALYSIS_LOCAL_PREVIEW":"1","ADMIN_DEV":"1","TERMINAL_E2E_FIXTURE":"1","TERMINAL_E2E_EMAIL":"responsive@example.com","TERMINAL_E2E_ENTITLEMENT":"unlimited","RATE_LIMIT_MAX":"100000","HUB_REALTIME_QUOTES":"1","TICKER_NEWS_RAIL":"1","FLOW_FIXTURE":"1","INVESTIGATION_API_ADMISSION":"open","NEXT_PUBLIC_SUPABASE_URL":"http://127.0.0.1:54321","NEXT_PUBLIC_SUPABASE_ANON_KEY":"fixture-anon-key","OPTIONS_COMBINED_EXPOSURE_PREWARM":"0","OPTIONS_COMBINED_VISUAL_PREWARM":"0"})
for kind in ["vi","pl6"]:
    port=3685 if kind=="vi" else 3687;free(port)
    out=W/("visual-navigation-r4-warm-"+kind);assert not out.exists();out.mkdir()
    before=sources(kind,P);original=sources(kind,O);assert before==original
    (out/"source-before.json").write_text(json.dumps(before,indent=2)+"\n")
    log=out/"capture.log";proc=None
    if kind=="vi":
        native=T/"docs/pr-crops/terminal-visual-intelligence"
        prior=out/"prior-preview-root";prior.mkdir()
        for name in ["desktop-context.png","desktop-context-zh.png","tablet-context.png","tablet-context-zh.png","mobile-context.png","mobile-context-zh.png","browser-report.json"]:
            if (native/name).exists():shutil.copyfile(native/name,prior/name)
        local=env.copy();local["TERMINAL_E2E_PORT"]=str(port)
        with (out/"server.log").open("x") as serverlog:
            try:
                proc=subprocess.Popen(["./node_modules/.bin/next","dev","--webpack","--hostname","127.0.0.1","--port",str(port)],cwd=T,env=local,stdout=serverlog,stderr=subprocess.STDOUT,start_new_session=True)
                print("VISUAL_SERVER",kind,proc.pid,port,flush=True)
                deadline=time.monotonic()+180
                while time.monotonic()<deadline:
                    assert proc.poll() is None,"VISUAL_SERVER_EXIT"
                    try:
                        with urllib.request.urlopen("http://127.0.0.1:"+str(port)+"/terminal?symbol=NVDA",timeout=5) as response:
                            if response.status==200:break
                    except Exception:pass
                    time.sleep(2)
                else:raise RuntimeError("VISUAL_SERVER_NOT_READY")
                command=["./node_modules/.bin/playwright","test","e2e/visual-intelligence.spec.ts","--project=desktop","--project=tablet","--project=mobile","--workers=1","--retries=0","--reporter=json","--trace=on","--output=.next/options-visual-vi-navigation-r4-warm-20261105"]
                print("VISUAL_START",kind,json.dumps(command),flush=True)
                with log.open("x") as output:result=subprocess.run(command,cwd=T,env=local,stdout=output,stderr=subprocess.STDOUT,timeout=1500)
            finally:
                if proc and proc.poll() is None:
                    os.killpg(proc.pid,signal.SIGTERM)
                    try:proc.wait(timeout=12)
                    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
                print("VISUAL_SERVER_STOPPED",kind,flush=True)
        raw=log.read_text();reports=[]
        for match in re.finditer(r"(?m)^\{",raw):
            try:
                report,end=json.JSONDecoder().raw_decode(raw[match.start():])
                if isinstance(report,dict) and "stats" in report and "suites" in report and "config" in report:reports.append((report,raw[match.start():match.start()+end]))
            except json.JSONDecodeError:pass
        assert len(reports)==1,"NATIVE_JSON_REPORT_BINDING"
        report,report_text=reports[0];(out/"browser-report.json").write_text(report_text+"\n")
        passed=report["stats"]["expected"];failed=report["stats"]["unexpected"]+report["stats"]["flaky"];skipped=report["stats"]["skipped"]
        crops=["desktop-context.png","desktop-context-zh.png","tablet-context.png","tablet-context-zh.png","mobile-context.png","mobile-context-zh.png"]
        for name in crops:
            if (native/name).exists():shutil.copyfile(native/name,out/name)
    else:
        local=env.copy();local.update({"TERMINAL_CROP_OUTPUT_DIR":str(out),"TERMINAL_CROP_PORT":str(port),"TERMINAL_CROP_WEBPACK":"1"})
        command=["node","e2e/tools/capture_pl6_batch1.cjs"];print("VISUAL_START",kind,json.dumps(command),flush=True)
        with log.open("x") as output:result=subprocess.run(command,cwd=T,env=local,stdout=output,stderr=subprocess.STDOUT,timeout=1500)
        crops=sorted(f.name for f in out.glob("*.png") if not f.name.startswith("FAIL-"));failed=len(list(out.glob("FAIL-*.png")));passed=len(crops);skipped=0
    after=sources(kind,P);other_after=sources(kind,O);(out/"source-after.json").write_text(json.dumps(after,indent=2)+"\n")
    record={"schema":"options_visual_native.v1","capture_revision":"options-navigation-r4","driver_sha256":sha(Path(__file__)),"packet":kind,"operation":"options-source-compatibility-20261105","captured_tree":"combined disposable preview","protectedBase":"11531481b0a540ee96bcd86df418fd1e42715363","source_contract_sha256":sha(W/"visual-source-contract-navigation-r4.json"),"source_stable":before==after,"source_equal_options":before==original and after==other_after,"source_sha256":after,"source_count":len(after),"exit":result.returncode,"passed":passed,"failed":failed,"skipped":skipped,"retries":0,"command":command,"profile":{"theme":"dark","fixture":"terminal-e2e.v1","compiler":"webpack"},"log_sha256":sha(log),"images":{name:sha(out/name) for name in crops if (out/name).exists()},"browser_report_sha256":sha(out/"browser-report.json") if kind=="vi" else None,"native_manifest_sha256":sha(out/"EVIDENCE.yml") if kind=="pl6" and (out/"EVIDENCE.yml").exists() else None}
    (out/"capture-receipt.json").write_text(json.dumps(record,indent=2)+"\n")
    print("VISUAL_RESULT",json.dumps({k:record[k] for k in ["packet","exit","passed","failed","skipped","source_stable","source_equal_options","source_count"]}),flush=True)
    assert result.returncode==0 and passed==(30 if kind=="vi" else 24) and failed==0 and skipped==0 and before==after==other_after,"VISUAL_REQUIRES_RECONCILIATION"
print("VISUAL_PROFILES_QUALIFIED",json.dumps({"vi_browser_cases":30,"bpl6_native_captures":24,"bpl6_canonical_crops":20}),flush=True)
