from pathlib import Path
import hashlib,json,os,re,shutil,signal,socket,subprocess,sys,time,urllib.request
B=Path("/Volumes/Mastermind/agent-workspaces/terminal/web");O=B/"options-workspace-surface-flow-ux-20261103-c3";P=B/"exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree";W=O/"terminal/.next/options-source-reconcile-20261105"
mode=sys.argv[1];assert mode in ["original","preview"];ROOT=O if mode=="original" else P;T=ROOT/"terminal";port=3691 if mode=="original" else 3693
R=W/("browser-"+mode+"-navigation-r4");assert not R.exists();R.mkdir()
FONT=P/"terminal/.next/test-fonts/google-responses-offline-20261104.cjs";sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();assert sha(FONT)=="0863e9151dab6e278d9eacf5d1560163b6fbe3bf2cac59e369199d7e4ba962fd"
specs=["e2e/options-lab-source-state.spec.ts","e2e/options-research-lab.spec.ts","e2e/options-exposure-workspace.spec.ts","e2e/options-deeplink.spec.ts","e2e/options-contract-shortlist.spec.ts","e2e/options-workspace-usability.spec.ts"]
pattern="Research Lab (withdraws a retained|admits a valid current read|preserves the selected archive)|3D research lab exact selection and responsive fallback|Connected exposure workspace .*: chart, comparison scopes, scanner and return|Options follows query navigation and Back/Forward|Options can leave (Exposure|Research Lab) while new scripts|real entitled screener rows compare without any new data request|Surface can select, drag and step to an actual observation"
selection=["./node_modules/.bin/playwright","test",*specs,"--grep",pattern,"--project=desktop","--project=tablet","--project=mobile","--workers=1","--retries=0"]
env=os.environ.copy()
for key in ["CI","TERMINAL_VISUAL_EVIDENCE_OPERATION","TERMINAL_EVIDENCE_COMPOSITION","TERMINAL_EVIDENCE_MODE"]:env.pop(key,None)
env.update({"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(FONT),"NODE_OPTIONS":"--no-experimental-webstorage","ANALYSIS_LOCAL_PREVIEW":"1","ADMIN_DEV":"1","TERMINAL_E2E_FIXTURE":"1","TERMINAL_E2E_EMAIL":"responsive@example.com","TERMINAL_E2E_ENTITLEMENT":"unlimited","RATE_LIMIT_MAX":"100000","HUB_REALTIME_QUOTES":"1","TICKER_NEWS_RAIL":"1","FLOW_FIXTURE":"1","INVESTIGATION_API_ADMISSION":"open","NEXT_PUBLIC_SUPABASE_URL":"http://127.0.0.1:54321","NEXT_PUBLIC_SUPABASE_ANON_KEY":"fixture-anon-key","TERMINAL_E2E_PORT":str(port),"OPTIONS_COMBINED_EXPOSURE_PREWARM":"0","OPTIONS_COMBINED_VISUAL_PREWARM":"0","PLAYWRIGHT_JSON_OUTPUT_NAME":str(R/"browser-report.json")})
with (R/"selection.log").open("x") as log:listed=subprocess.run(selection+["--list","--reporter=list"],cwd=T,env=env,stdout=log,stderr=subprocess.STDOUT)
assert listed.returncode==0 and re.search(r"Total: 39 tests in 6 files",(R/"selection.log").read_text()),"CASE_SELECTION_REQUIRES_RECONCILIATION"
with socket.socket() as sock:sock.settimeout(1);assert sock.connect_ex(("127.0.0.1",port))!=0,"OWNED_PORT_ACTIVE"
def sources():
 result={"terminal/"+str(f.relative_to(T)):sha(f) for folder in ["app","components","lib","e2e"] for f in sorted((T/folder).rglob("*")) if f.is_file()}
 for name in ["package.json","package-lock.json","tsconfig.json","next.config.ts","playwright.config.ts","next-env.d.ts","proxy.ts"]:
  if (T/name).exists():result["terminal/"+name]=sha(T/name)
 return dict(sorted(result.items()))
before=sources();(R/"source-before.json").write_text(json.dumps(before,indent=2)+"\n")
prior=R/"prior-flat-test-results";prior.mkdir();old={}
for f in (T/"test-results").glob("*.png"):
 old[f.name]={"sha256":sha(f),"mtime_ns":f.stat().st_mtime_ns};shutil.copyfile(f,prior/f.name)
(R/"prior-flat-test-results.json").write_text(json.dumps(old,indent=2)+"\n")
serverlog=R/"server.log";log=R/"browser.log";proc=None;result=None;outputRel=".next/options-final-journeys-"+mode+"-navigation-r4-20261105"
command=selection+["--trace=on","--output="+outputRel,"--reporter=list,json"]
with serverlog.open("x") as serverOutput:
 try:
  proc=subprocess.Popen(["./node_modules/.bin/next","dev","--webpack","--hostname","127.0.0.1","--port",str(port)],cwd=T,env=env,stdout=serverOutput,stderr=subprocess.STDOUT,start_new_session=True)
  print("JOURNEY_SERVER",mode,proc.pid,port,flush=True);deadline=time.monotonic()+180
  while time.monotonic()<deadline:
   assert proc.poll() is None,"NEXT_EXIT_EARLY"
   try:
    with urllib.request.urlopen("http://127.0.0.1:"+str(port)+"/options",timeout=5) as response:
     if response.status==200:break
   except Exception:pass
   time.sleep(2)
  else:raise RuntimeError("NEXT_NOT_READY")
  manifest=T/".next/dev/react-loadable-manifest.json";emitted=json.loads(manifest.read_text())
  edges=json.loads((W/"lazy-style-completion/owned-lazy-edges.json").read_text());assert all(k in emitted for k in edges)
  entries={k:emitted[k] for k in edges}
  (R/"lazy-manifest-qualification.json").write_text(json.dumps({"manifest_sha256":sha(manifest),"hub_sha256":sha(T/"components/OptionsHubView.tsx"),"entry_count":len(edges),"entries":entries},indent=2)+"\n")
  assert len(entries)==15 and all(any(f.endswith(".js") for f in row["files"]) and not any(f.endswith(".css") for f in row["files"]) for row in entries.values()),"OWNED_ASYNC_CSS_REMAINS"
  print("ALL15_OWNED_EDGES_JS_ONLY",flush=True)
  print("JOURNEYS_START",mode,39,flush=True)
  with log.open("x") as out:result=subprocess.run(command,cwd=T,env=env,stdout=out,stderr=subprocess.STDOUT,timeout=2100)
 finally:
  if proc and proc.poll() is None:
   os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(timeout=12)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
  print("OWNED_JOURNEY_SERVER_STOPPED",mode,proc.pid if proc else None,flush=True)
assert result is not None
after=sources();(R/"source-after.json").write_text(json.dumps(after,indent=2)+"\n")
report=json.loads((R/"browser-report.json").read_text());stats=report["stats"]
fresh=R/"screenshots";fresh.mkdir()
for f in (T/"test-results").glob("*.png"):
 if f.name not in old or f.stat().st_mtime_ns!=old[f.name]["mtime_ns"]:shutil.copyfile(f,fresh/f.name)
artifact=T/outputRel
artifacts={str(f.relative_to(artifact)):sha(f) for f in sorted(artifact.rglob("*")) if f.is_file()}
(R/"playwright-artifacts-sha256.json").write_text(json.dumps(artifacts,indent=2)+"\n")
record={"schema":"options_final_journeys.v1","capture_revision":"options-navigation-r4","mode":mode,"captured_root":str(ROOT),"port":port,"protectedBase":"11531481b0a540ee96bcd86df418fd1e42715363","optionsPublishedParent":"98ffa891116ccc9e6be58a64148dbe45591e6ce8","acceptedExposureDependency":"0182a45abccb9c0e77b2c8e4626431e89635b35f","exit":result.returncode,"expected":39,"passed":stats["expected"],"failed":stats["unexpected"],"skipped":stats["skipped"],"flaky":stats["flaky"],"retries":0,"source_stable":before==after,"source_count":len(after),"source_map_sha256":sha(R/"source-after.json"),"source_before_sha256":sha(R/"source-before.json"),"browser_report_sha256":sha(R/"browser-report.json"),"log_sha256":sha(log),"server_log_sha256":sha(serverlog),"offline_font_sha256":sha(FONT),"command":command,"owned_server_stopped":proc is not None and proc.poll() is not None,"playwright_output":str(artifact),"artifact_count":len(artifacts),"artifact_index_sha256":sha(R/"playwright-artifacts-sha256.json"),"screenshots":{f.name:sha(f) for f in sorted(fresh.glob("*.png"))},"map_source_sha256":sha(T/"components/exposure-map/ExposureMap.tsx")}
(R/"browser-receipt.json").write_text(json.dumps(record,indent=2)+"\n")
print("JOURNEYS_RESULT",json.dumps({k:record[k] for k in ["mode","exit","passed","failed","skipped","flaky","source_stable","source_count","artifact_count","owned_server_stopped"]}),flush=True)
assert result.returncode==0 and before==after and stats["expected"]==39 and not(stats["unexpected"] or stats["skipped"] or stats["flaky"]) and not report.get("errors"),"BROWSER_REQUIRES_RECONCILIATION"
