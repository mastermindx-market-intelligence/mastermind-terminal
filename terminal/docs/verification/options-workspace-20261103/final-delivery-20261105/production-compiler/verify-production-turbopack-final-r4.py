from pathlib import Path
import os,subprocess,json,hashlib,time,signal,datetime,threading,http.server,urllib.request,urllib.parse,shutil
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree");R=W/"production-turbopack-final-r4";C=R/"tree";T=C/"terminal"
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
expected=json.loads((R/"source-inputs.json").read_text())
assert all(sha(C/rel)==sha(P/rel)==h for rel,h in expected.items())
font=R/"google-responses-turbopack.cjs"
assert sha(font)=="9022de643fe32ffd697908b07dca73d6b9faf2eafb7570d34076a55c1b16493f"
env={k:v for k,v in os.environ.items() if k in ["PATH","HOME","TMPDIR","LANG","LC_ALL","SHELL","USER","LOGNAME"]}
overrides={"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(font),"NODE_OPTIONS":"--no-experimental-webstorage","NEXT_TELEMETRY_DISABLED":"1","ANALYSIS_LOCAL_PREVIEW":"1","ADMIN_DEV":"1","TERMINAL_E2E_FIXTURE":"1","TERMINAL_E2E_EMAIL":"responsive@example.com","TERMINAL_E2E_ENTITLEMENT":"unlimited","RATE_LIMIT_MAX":"100000","HUB_REALTIME_QUOTES":"1","TICKER_NEWS_RAIL":"1","FLOW_FIXTURE":"1","INVESTIGATION_API_ADMISSION":"open","NEXT_PUBLIC_SUPABASE_URL":"http://127.0.0.1:54321","NEXT_PUBLIC_SUPABASE_ANON_KEY":"fixture-anon-key","NEXT_DEPLOYMENT_ID":"options-final-r4-local-compiler-proof"}
env.update(overrides);log=R/"production-build-http-v2.log";receipt=R/"production-build-http-v2-receipt.json";assert not log.exists() and not receipt.exists()
fixture=json.loads((R/"font-fixture-inputs.json").read_text());requests=[]
class Fonts(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(R/"font-fixture"),**kwargs)
 def do_GET(self):
  name=urllib.parse.urlparse(self.path).path.lstrip("/")
  if name not in fixture["font_files"]:self.send_error(404);return
  requests.append(name);super().do_GET()
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(("127.0.0.1",fixture["port"]),Fonts)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();font_preflight_verified=False
(R/"font-server-binding.json").write_text(json.dumps({"pid":os.getpid(),"host":"127.0.0.1","port":fixture["port"],"files":13},indent=2)+chr(10))
try:
 for name,row in fixture["font_files"].items():
  with urllib.request.urlopen("http://127.0.0.1:"+str(fixture["port"])+"/"+name,timeout=5) as response:
   raw=response.read();assert response.status==200 and hashlib.sha256(raw).hexdigest()==row["sha256"]
 font_preflight_verified=True
 print("ALL13_LOOPBACK_FONT_BYTES_VERIFIED",flush=True)
 started=datetime.datetime.now(datetime.timezone.utc).isoformat();begin=time.monotonic()
 with log.open("x") as f:
  p=subprocess.Popen(["npm","run","build"],cwd=T,env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  (R/"production-build-http-v2-process.json").write_text(json.dumps({"pid":p.pid,"cwd":str(T),"command":["npm","run","build"],"started_at":started},indent=2)+"\n")
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
 font_hashes={str(p.relative_to(T)):sha(p) for p in sorted((T/".next").rglob("*.woff2")) if p.is_file()}
 expected_fonts={v["sha256"] for v in fixture["font_files"].values()}
 assert len(expected_fonts)==13 and expected_fonts.issubset(set(font_hashes.values())),"EMITTED_FONT_BYTES_DIFFER"
 (R/"production-emitted-fonts.json").write_text(json.dumps({"input_unique_fonts":13,"all13_exact_bytes_emitted":True,"emitted_fonts":font_hashes},indent=2)+chr(10))
 shutil.copyfile(T/"next-env.d.ts",R/"production-generated-next-env.d.ts")
 shutil.copyfile(P/"terminal/next-env.d.ts",T/"next-env.d.ts")
 assert all(sha(C/rel)==sha(P/rel)==h for rel,h in expected.items()),"BROWSER_COPY_SOURCE_MISMATCH"
 print("FINAL_TURBOPACK_PRODUCTION_BUILD_QUALIFIED",flush=True)
finally:
 server.shutdown();server.server_close();thread.join(timeout=5)
 (R/"font-server-qualification.json").write_text(json.dumps({"bound_only_to_loopback":True,"expected_font_count":13,"preflight_all13_hashes_verified":font_preflight_verified,"requests":requests,"server_closed":not thread.is_alive(),"turbopack_mock_sha256":sha(font),"original_webpack_fixture_unchanged":True},indent=2)+chr(10))
 print("OWNED_FONT_SERVER_STOPPED",flush=True)
