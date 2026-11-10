from pathlib import Path
import hashlib,json,os,signal,socket,subprocess,sys,time,urllib.request
P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i");T=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3")/"terminal";R=P/"original-lab-integration-20261104"
phase=sys.argv[1];assert phase in ["before","after"]
port=3661
with socket.socket() as s:
 s.settimeout(1);assert s.connect_ex(("127.0.0.1",port))!=0,"ORIGINAL_SERVER_ACTIVE"
env=os.environ.copy()
env.update({"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(P/"tree/terminal/.next/test-fonts/google-responses-offline-20261104.cjs"),"NODE_OPTIONS":"--no-experimental-webstorage","ANALYSIS_LOCAL_PREVIEW":"1","ADMIN_DEV":"1","TERMINAL_E2E_FIXTURE":"1","TERMINAL_E2E_EMAIL":"responsive@example.com","TERMINAL_E2E_ENTITLEMENT":"unlimited","RATE_LIMIT_MAX":"100000","HUB_REALTIME_QUOTES":"1","TICKER_NEWS_RAIL":"1","FLOW_FIXTURE":"1","INVESTIGATION_API_ADMISSION":"open","NEXT_PUBLIC_SUPABASE_URL":"http://127.0.0.1:54321","NEXT_PUBLIC_SUPABASE_ANON_KEY":"fixture-anon-key","TERMINAL_E2E_PORT":str(port)})
serverlog=R/("browser-"+phase+"-server.log");log=R/("browser-"+phase+".log")
assert not serverlog.exists() and not log.exists()
proc=None
with serverlog.open("x") as output:
 try:
  proc=subprocess.Popen(["./node_modules/.bin/next","dev","--webpack","--hostname","127.0.0.1","--port",str(port)],cwd=T,env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
  print("ORIGINAL_LAB_SERVER",proc.pid,port,phase,flush=True)
  deadline=time.monotonic()+180
  while time.monotonic()<deadline:
   assert proc.poll() is None,"NEXT_EXIT_EARLY"
   try:
    with urllib.request.urlopen("http://127.0.0.1:"+str(port)+"/options",timeout=5) as response:
     if response.status==200:break
   except Exception:pass
   time.sleep(2)
  else:raise RuntimeError("NEXT_NOT_READY")
  command=["./node_modules/.bin/playwright","test","e2e/options-lab-source-state.spec.ts","--project=desktop","--workers=1","--retries=0","--trace=on","--output=.next/options-lab-source-"+phase+"-20261104"]
  if phase=="after":
   command[3:3]=["e2e/options-lab-reported-gamma.spec.ts"]
   command+=["--project=tablet","--project=mobile"]
  print("BROWSER_START",json.dumps(command),flush=True)
  with log.open("x") as out:result=subprocess.run(command,cwd=T,env=env,stdout=out,stderr=subprocess.STDOUT,timeout=1200)
  receipt={"phase":phase,"exit":result.returncode,"command":command,"logSha256":hashlib.sha256(log.read_bytes()).hexdigest(),"gexSourceSha256":hashlib.sha256((T/"components/gexdesk/GexDeskView.tsx").read_bytes()).hexdigest()}
  (R/("browser-"+phase+".json")).write_text(json.dumps(receipt,indent=2)+"\n")
  print("BROWSER_RESULT",json.dumps(receipt),flush=True);print("\n".join(log.read_text(errors="replace").splitlines()[-25:])[-4500:],flush=True)
 finally:
  if proc and proc.poll() is None:
   os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(timeout=12)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
  print("OWNED_ORIGINAL_SERVER_STOPPED",proc.pid if proc else None,flush=True)
