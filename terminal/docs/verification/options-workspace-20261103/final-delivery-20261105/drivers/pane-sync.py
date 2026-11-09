from pathlib import Path
import datetime,hashlib,json,os,re,signal,socket,subprocess,time,urllib.request
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree");T=P/"terminal";R=W/"pane-sync-integrated-a162-r4";assert not R.exists();R.mkdir();port=3695
prior=json.loads((W/"browser-preview-navigation-r4/browser-receipt.json").read_text());assert prior["passed"]==39 and prior["source_stable"] and prior["owned_server_stopped"]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();FONT=T/".next/test-fonts/google-responses-offline-20261104.cjs";assert sha(FONT)=="0863e9151dab6e278d9eacf5d1560163b6fbe3bf2cac59e369199d7e4ba962fd"
def sources():
 result={"terminal/"+str(f.relative_to(T)):sha(f) for folder in ["app","components","lib","e2e"] for f in sorted((T/folder).rglob("*")) if f.is_file()}
 for n in ["package.json","package-lock.json","tsconfig.json","next.config.ts","playwright.config.ts","next-env.d.ts","proxy.ts"]:
  if (T/n).exists():result["terminal/"+n]=sha(T/n)
 return dict(sorted(result.items()))
before=sources();(R/"source-before.json").write_text(json.dumps(before,indent=2)+"\n");assert before["terminal/lib/timeWindow.ts"]=="98b2e448401db693334fc594443e18ec236c9e6cbca4116764334aef66f706c2"
env=os.environ.copy()
for k in ["CI","TERMINAL_VISUAL_EVIDENCE_OPERATION","TERMINAL_EVIDENCE_COMPOSITION","TERMINAL_EVIDENCE_MODE"]:env.pop(k,None)
env.update({"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(FONT),"NODE_OPTIONS":"--no-experimental-webstorage","ANALYSIS_LOCAL_PREVIEW":"1","ADMIN_DEV":"1","TERMINAL_E2E_FIXTURE":"1","TERMINAL_E2E_EMAIL":"responsive@example.com","TERMINAL_E2E_ENTITLEMENT":"unlimited","RATE_LIMIT_MAX":"100000","HUB_REALTIME_QUOTES":"1","TICKER_NEWS_RAIL":"1","FLOW_FIXTURE":"1","INVESTIGATION_API_ADMISSION":"open","NEXT_PUBLIC_SUPABASE_URL":"http://127.0.0.1:54321","NEXT_PUBLIC_SUPABASE_ANON_KEY":"fixture-anon-key","TERMINAL_E2E_PORT":str(port),"OPTIONS_COMBINED_EXPOSURE_PREWARM":"0","OPTIONS_COMBINED_VISUAL_PREWARM":"0","PLAYWRIGHT_JSON_OUTPUT_NAME":str(R/"browser-report.json")})
selection=["./node_modules/.bin/playwright","test","e2e/pane-sync-time-axis.spec.ts","--grep","wheel zoom and a programmatic view reset both travel by calendar$","--project=desktop","--workers=1","--retries=0"]
with (R/"selection.log").open("x") as out:listed=subprocess.run(selection+["--list","--reporter=list"],cwd=T,env=env,stdout=out,stderr=subprocess.STDOUT)
assert listed.returncode==0 and re.search(r"Total: 1 test in 1 file",(R/"selection.log").read_text()),"SELECTION_REQUIRES_RECONCILIATION"
with socket.socket() as sock:sock.settimeout(1);assert sock.connect_ex(("127.0.0.1",port))!=0,"OWNED_PORT_ACTIVE"
proc=None;result=None;outputRel=".next/options-pane-sync-integrated-a162-r4";command=selection+["--trace=on","--output="+outputRel,"--reporter=list,json"]
with (R/"server.log").open("x") as out:
 try:
  proc=subprocess.Popen(["./node_modules/.bin/next","dev","--webpack","--hostname","127.0.0.1","--port",str(port)],cwd=T,env=env,stdout=out,stderr=subprocess.STDOUT,start_new_session=True);print("PANE_SERVER",proc.pid,port,flush=True);deadline=time.monotonic()+180
  while time.monotonic()<deadline:
   assert proc.poll() is None,"NEXT_EXIT_EARLY"
   try:
    with urllib.request.urlopen("http://127.0.0.1:"+str(port)+"/terminal?symbol=NVDA",timeout=5) as res:
     if res.status==200:break
   except Exception:pass
   time.sleep(2)
  else:raise RuntimeError("NEXT_NOT_READY")
  with (R/"browser.log").open("x") as log:result=subprocess.run(command,cwd=T,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
 finally:
  if proc and proc.poll() is None:
   os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(timeout=12)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
  print("PANE_SERVER_STOPPED",proc.pid if proc else None,flush=True)
assert result is not None
after=sources();(R/"source-after.json").write_text(json.dumps(after,indent=2)+"\n");report=json.loads((R/"browser-report.json").read_text());stats=report["stats"];output=T/outputRel
artifacts={str(f.relative_to(output)):sha(f) for f in sorted(output.rglob("*")) if f.is_file()};(R/"artifacts-sha256.json").write_text(json.dumps(artifacts,indent=2)+"\n")
record={"schema":"options_chart_compatibility_browser.v1","completed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"tree":"a162a7809ffe6eb75c461c551a5146e61d2e7b03","protected_base":"5d7b76376a8b3f5a8001f02d7f0ded29f5743798","runtime_change":"upstream pane-sync bracket-hint optimization","command":command,"exit":result.returncode,"passed":stats["expected"],"failed":stats["unexpected"],"skipped":stats["skipped"],"flaky":stats["flaky"],"retries":0,"source_stable":before==after,"source_count":len(after),"source_map_sha256":sha(R/"source-after.json"),"browser_report_sha256":sha(R/"browser-report.json"),"artifact_index_sha256":sha(R/"artifacts-sha256.json"),"playwright_output":str(output),"owned_server_stopped":proc is not None and proc.poll() is not None}
(R/"browser-receipt.json").write_text(json.dumps(record,indent=2)+"\n");print("PANE_SYNC_RESULT",json.dumps(record),flush=True)
assert result.returncode==0 and before==after and stats["expected"]==1 and not(stats["unexpected"] or stats["skipped"] or stats["flaky"]) and not report.get("errors"),"PANE_SYNC_REQUIRES_RECONCILIATION"
