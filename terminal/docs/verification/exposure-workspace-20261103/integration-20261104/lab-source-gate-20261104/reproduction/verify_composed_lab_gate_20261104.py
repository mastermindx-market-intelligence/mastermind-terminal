from pathlib import Path
import hashlib,json,os,signal,socket,subprocess,time,urllib.request
P=Path(__file__).resolve().parent;T=P/"tree/terminal";R=P/"protected4df-20261104";port=3663
for n in [3653,3655,3657,3659,port]:
 with socket.socket() as s:s.settimeout(1);assert s.connect_ex(("127.0.0.1",n))!=0,("PREVIEW_SERVER_ACTIVE",n)
def sources():
 return {"terminal/"+str(f.relative_to(T)):hashlib.sha256(f.read_bytes()).hexdigest() for folder in ["app","components","lib","e2e"] for f in sorted((T/folder).rglob("*")) if f.is_file()}
before=sources();(R/"source-before-final-browser.json").write_text(json.dumps(before,indent=2)+"\n")
env=os.environ.copy()
env.update({"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(T/".next/test-fonts/google-responses-offline-20261104.cjs"),"NODE_OPTIONS":"--no-experimental-webstorage","ANALYSIS_LOCAL_PREVIEW":"1","ADMIN_DEV":"1","TERMINAL_E2E_FIXTURE":"1","TERMINAL_E2E_EMAIL":"responsive@example.com","TERMINAL_E2E_ENTITLEMENT":"unlimited","RATE_LIMIT_MAX":"100000","HUB_REALTIME_QUOTES":"1","TICKER_NEWS_RAIL":"1","FLOW_FIXTURE":"1","INVESTIGATION_API_ADMISSION":"open","NEXT_PUBLIC_SUPABASE_URL":"http://127.0.0.1:54321","NEXT_PUBLIC_SUPABASE_ANON_KEY":"fixture-anon-key","TERMINAL_E2E_PORT":str(port),"OPTIONS_COMBINED_EXPOSURE_PREWARM":"0","OPTIONS_COMBINED_VISUAL_PREWARM":"0"})
serverlog=R/"browser-final-server.log";log=R/"browser-final.log";assert not log.exists() and not serverlog.exists()
proc=None
with serverlog.open("x") as output:
 try:
  proc=subprocess.Popen(["./node_modules/.bin/next","dev","--webpack","--hostname","127.0.0.1","--port",str(port)],cwd=T,env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
  print("COMPOSED_BROWSER_SERVER",proc.pid,port,flush=True)
  deadline=time.monotonic()+180
  while time.monotonic()<deadline:
   assert proc.poll() is None,"NEXT_EXIT_EARLY"
   try:
    with urllib.request.urlopen("http://127.0.0.1:"+str(port)+"/options",timeout=5) as response:
     if response.status==200:break
   except Exception:pass
   time.sleep(2)
  else:raise RuntimeError("NEXT_NOT_READY")
  command=["./node_modules/.bin/playwright","test","e2e/options-lab-source-state.spec.ts","e2e/options-lab-reported-gamma.spec.ts","e2e/exposure-workspace.spec.ts","e2e/sector-exposure-depth-return.spec.ts","--grep","Research Lab|reported Gamma exact host consumer|Exposure opens on usable strikes|stepping and Back preserve","--project=desktop","--project=tablet","--project=mobile","--workers=1","--retries=0","--trace=on","--output=.next/options-lab-composed-final-20261104"]
  print("COMPOSED_BROWSER_START",json.dumps(command),flush=True)
  with log.open("x") as out:result=subprocess.run(command,cwd=T,env=env,stdout=out,stderr=subprocess.STDOUT,timeout=1800)
  after=sources();(R/"source-after-final-browser.json").write_text(json.dumps(after,indent=2)+"\n")
  record={"exit":result.returncode,"command":command,"sourceStableAcrossBrowser":before==after,"sourceFileCount":len(after),"sourceMapBeforeSha256":hashlib.sha256((R/"source-before-final-browser.json").read_bytes()).hexdigest(),"sourceMapAfterSha256":hashlib.sha256((R/"source-after-final-browser.json").read_bytes()).hexdigest(),"logSha256":hashlib.sha256(log.read_bytes()).hexdigest(),"gexSourceSha256":after["terminal/components/gexdesk/GexDeskView.tsx"],"retry":0}
  (R/"browser-final.json").write_text(json.dumps(record,indent=2)+"\n")
  print("COMPOSED_BROWSER_RESULT",json.dumps(record),flush=True);print("\n".join(log.read_text(errors="replace").splitlines()[-35:])[-6000:],flush=True)
 finally:
  if proc and proc.poll() is None:
   os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(timeout=12)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
  print("OWNED_COMPOSED_SERVER_STOPPED",proc.pid if proc else None,flush=True)
