from pathlib import Path
import os,subprocess,json,hashlib,time,signal,datetime
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree");R=W/"production-turbopack-navigation-r4";C=R/"tree";T=C/"terminal"
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
expected=json.loads((R/"source-inputs.json").read_text())
assert all(sha(C/rel)==sha(P/rel)==h for rel,h in expected.items())
font=P/"terminal/.next/test-fonts/google-responses-offline-20261104.cjs"
assert sha(font)=="0863e9151dab6e278d9eacf5d1560163b6fbe3bf2cac59e369199d7e4ba962fd"
env={k:v for k,v in os.environ.items() if k in ["PATH","HOME","TMPDIR","LANG","LC_ALL","SHELL","USER","LOGNAME"]}
overrides={"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(font),"NODE_OPTIONS":"--no-experimental-webstorage","NEXT_TELEMETRY_DISABLED":"1","ANALYSIS_LOCAL_PREVIEW":"1","ADMIN_DEV":"1","TERMINAL_E2E_FIXTURE":"1","TERMINAL_E2E_EMAIL":"responsive@example.com","TERMINAL_E2E_ENTITLEMENT":"unlimited","RATE_LIMIT_MAX":"100000","HUB_REALTIME_QUOTES":"1","TICKER_NEWS_RAIL":"1","FLOW_FIXTURE":"1","INVESTIGATION_API_ADMISSION":"open","NEXT_PUBLIC_SUPABASE_URL":"http://127.0.0.1:54321","NEXT_PUBLIC_SUPABASE_ANON_KEY":"fixture-anon-key","NEXT_DEPLOYMENT_ID":"options-navigation-r4-local-compiler-proof"}
env.update(overrides);log=R/"production-build.log";receipt=R/"production-build-receipt.json";assert not log.exists() and not receipt.exists()
started=datetime.datetime.now(datetime.timezone.utc).isoformat();begin=time.monotonic()
with log.open("x") as f:
 p=subprocess.Popen(["npm","run","build"],cwd=T,env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
 (R/"production-build-process.json").write_text(json.dumps({"pid":p.pid,"cwd":str(T),"command":["npm","run","build"],"started_at":started},indent=2)+"\n")
 print("BUILD_START",p.pid,flush=True)
 timed_out=False
 try:code=p.wait(timeout=1200)
 except subprocess.TimeoutExpired:
  timed_out=True;os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=12)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
  code=124
after={rel:sha(C/rel) for rel in expected}
changes={rel:{"before":h,"after":after[rel]} for rel,h in expected.items() if after[rel]!=h}
canonical_stable=all(sha(P/rel)==h for rel,h in expected.items())
(R/"build-source-after.json").write_text(json.dumps(after,indent=2)+"\n")
d={"schema":"options_production_compiler_proof.v1","command":["npm","run","build"],"compiler":"Turbopack selected by normal Next16build","exit":code,"timed_out":timed_out,"duration_seconds":round(time.monotonic()-begin,2),"started_at":started,"completed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source_input_count":len(expected),"source_input_sha256":sha(R/"source-inputs.json"),"source_after_sha256":sha(R/"build-source-after.json"),"generated_input_changes":changes,"canonical_preview_source_unchanged":canonical_stable,"config_sha256":sha(T/"next.config.ts"),"font_response_sha256":sha(font),"explicit_environment":overrides,"log_sha256":sha(log),"build_id":(T/".next/BUILD_ID").read_text().strip() if (T/".next/BUILD_ID").exists() else None,"production_browser_authentication_claimed":False,"isolated_copy":True,"owned_process_completed":p.poll() is not None}
receipt.write_text(json.dumps(d,indent=2)+"\n");print("BUILD_RESULT",json.dumps({k:d[k] for k in ["exit","timed_out","duration_seconds","canonical_preview_source_unchanged","build_id"]}),flush=True)
assert code==0 and canonical_stable and set(changes).issubset({"terminal/next-env.d.ts"}),"PRODUCTION_BUILD_REQUIRES_RECONCILIATION"
