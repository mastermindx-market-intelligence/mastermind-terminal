from pathlib import Path
import base64,hashlib,json,math,os,re,shutil,signal,socket,subprocess,sys,time,urllib.request
B=Path("/Volumes/Mastermind/agent-workspaces/terminal/web");O=B/"options-workspace-surface-flow-ux-20261103-c3";P=B/"exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree";W=O/"terminal/.next/options-source-reconcile-20261105"
mode=sys.argv[1];assert mode in ["original","preview"];stage=sys.argv[2];assert stage in ["baseline","fixed"];assert stage!="baseline" or mode=="original";expected=1 if stage=="baseline" else 6;ROOT=O if mode=="original" else P;T=ROOT/"terminal";port=3697 if mode=="original" else 3699
R=W/("chart-framing-"+mode+"-"+stage+"-r4-v2");assert not R.exists();R.mkdir()
FONT=P/"terminal/.next/test-fonts/google-responses-offline-20261104.cjs";sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();assert sha(FONT)=="0863e9151dab6e278d9eacf5d1560163b6fbe3bf2cac59e369199d7e4ba962fd"
specs=["e2e/options-exposure-workspace.spec.ts"]
pattern="Connected exposure workspace "+("en" if stage=="baseline" else "(?:en|zh)")+": chart, comparison scopes, scanner and return$"
selection=["./node_modules/.bin/playwright","test",*specs,"--grep",pattern,*(["--project=mobile"] if stage=="baseline" else ["--project=desktop","--project=tablet","--project=mobile"]),"--workers=1","--retries=0"]
env=os.environ.copy()
for key in ["CI","TERMINAL_VISUAL_EVIDENCE_OPERATION","TERMINAL_EVIDENCE_COMPOSITION","TERMINAL_EVIDENCE_MODE"]:env.pop(key,None)
env.update({"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(FONT),"NODE_OPTIONS":"--no-experimental-webstorage","ANALYSIS_LOCAL_PREVIEW":"1","ADMIN_DEV":"1","TERMINAL_E2E_FIXTURE":"1","TERMINAL_E2E_EMAIL":"responsive@example.com","TERMINAL_E2E_ENTITLEMENT":"unlimited","RATE_LIMIT_MAX":"100000","HUB_REALTIME_QUOTES":"1","TICKER_NEWS_RAIL":"1","FLOW_FIXTURE":"1","INVESTIGATION_API_ADMISSION":"open","NEXT_PUBLIC_SUPABASE_URL":"http://127.0.0.1:54321","NEXT_PUBLIC_SUPABASE_ANON_KEY":"fixture-anon-key","TERMINAL_E2E_PORT":str(port),"OPTIONS_COMBINED_EXPOSURE_PREWARM":"0","OPTIONS_COMBINED_VISUAL_PREWARM":"0","PLAYWRIGHT_JSON_OUTPUT_NAME":str(R/"browser-report.json")})
with (R/"selection.log").open("x") as log:listed=subprocess.run(selection+["--list","--reporter=list"],cwd=T,env=env,stdout=log,stderr=subprocess.STDOUT)
assert listed.returncode==0 and re.search(r"Total: "+str(expected)+r" tests? in 1 file",(R/"selection.log").read_text()),"CASE_SELECTION_REQUIRES_RECONCILIATION"
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
serverlog=R/"server.log";log=R/"browser.log";proc=None;result=None;outputRel=".next/options-chart-framing-"+mode+"-"+stage+"-r4-v2"
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
  print("FRAMING_START",mode,stage,expected,flush=True)
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
record={"schema":"exposure_chart_framing_browser.v1","witness_version":"all-painted-ranked-labels.v2","stage":stage,"expected_failure":stage=="baseline","source_parent_composition":"a162a7809ffe6eb75c461c551a5146e61d2e7b03","source_amendments":"staged-final-gate-fixes-r4 and staged-phone-framing-r4 exact before/after maps","capture_revision":"options-navigation-r4","mode":mode,"captured_root":str(ROOT),"port":port,"protectedBase":"5d7b76376a8b3f5a8001f02d7f0ded29f5743798" if mode=="preview" else "11531481b0a540ee96bcd86df418fd1e42715363","optionsPublishedParent":"98ffa891116ccc9e6be58a64148dbe45591e6ce8","acceptedExposureDependency":"0182a45abccb9c0e77b2c8e4626431e89635b35f","exit":result.returncode,"expected":expected,"passed":stats["expected"],"failed":stats["unexpected"],"skipped":stats["skipped"],"flaky":stats["flaky"],"retries":0,"source_stable":before==after,"source_count":len(after),"source_map_sha256":sha(R/"source-after.json"),"source_before_sha256":sha(R/"source-before.json"),"browser_report_sha256":sha(R/"browser-report.json"),"log_sha256":sha(log),"server_log_sha256":sha(serverlog),"offline_font_sha256":sha(FONT),"command":command,"owned_server_stopped":proc is not None and proc.poll() is not None,"playwright_output":str(artifact),"artifact_count":len(artifacts),"artifact_index_sha256":sha(R/"playwright-artifacts-sha256.json"),"screenshots":{f.name:sha(f) for f in sorted(fresh.glob("*.png"))},"map_source_sha256":sha(T/"components/exposure-map/ExposureMap.tsx")}
(R/"browser-receipt.json").write_text(json.dumps(record,indent=2)+"\n")
print("JOURNEYS_RESULT",json.dumps({k:record[k] for k in ["mode","exit","passed","failed","skipped","flaky","source_stable","source_count","artifact_count","owned_server_stopped"]}),flush=True)
assert before==after and not(stats["skipped"] or stats["flaky"]) and not report.get("errors"),"BROWSER_REQUIRES_RECONCILIATION"
if stage=="fixed":assert result.returncode==0 and stats["expected"]==6 and stats["unexpected"]==0,"FRAMING_REQUIRES_RECONCILIATION"
else:assert result.returncode!=0 and stats["expected"]==0 and stats["unexpected"]==1,"BASELINE_NOT_RED"

def results(suite):
 for spec in suite.get("specs",[]):
  for test in spec.get("tests",[]):
   for result in test.get("results",[]):yield test.get("projectName"),spec.get("title"),result
 for child in suite.get("suites",[]):yield from results(child)
witnesses=[]
for project,title,result in results(report):
 for a in result.get("attachments",[]):
  if a.get("name") not in ["exposure-header-clearance-initial","exposure-header-clearance"]:continue
  raw=Path(a["path"]).read_bytes() if a.get("path") else base64.b64decode(a["body"])
  witnesses.append({"project":project,"title":title,"name":a["name"],"value":json.loads(raw)})
(R/"painted-label-witnesses.json").write_text(json.dumps(witnesses,indent=2)+"\n")
if stage=="baseline":
 initial=[w["value"] for w in witnesses if w["name"]=="exposure-header-clearance-initial"]
 assert len(initial)==1 and initial[0] and any(r["strike"]==756 for r in initial[0]) and all(math.isfinite(r["gap"]) for r in initial[0]) and min(r["gap"] for r in initial[0])<0,"BASELINE_FAILURE_NOT_ACTUAL_LABEL_COLLISION"
else:
 final=[w["value"] for w in witnesses if w["name"]=="exposure-header-clearance"]
 assert len(final)==6 and all(row[phase] and any(v["strike"]==756 for v in row[phase]) and all(math.isfinite(v["gap"]) and v["gap"]>=4 for v in row[phase]) for row in final for phase in ["initial","afterFit"]),"ACTUAL_LABEL_WITNESSES_INCOMPLETE"
print("FRAMING_WITNESSES_VERIFIED",stage,len(witnesses),flush=True)
