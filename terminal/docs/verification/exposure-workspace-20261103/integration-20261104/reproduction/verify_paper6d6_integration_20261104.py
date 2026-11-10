from pathlib import Path
import os,signal,socket,subprocess,sys,time,urllib.request
root=Path(__file__).resolve().parent
tree=root/'tree'/'terminal'
font=root/'tree'/'terminal'/'.next'/'test-fonts'/'google-responses-offline-20261104.cjs'
assert tree.is_dir() and font.is_file()
port=3641
sock=socket.socket();sock.settimeout(1)
try:
    assert sock.connect_ex(('127.0.0.1',port))!=0,'PORT_OCCUPIED_DO_NOT_REUSE'
finally:sock.close()
env=os.environ.copy()
env.update({
    'NEXT_FONT_GOOGLE_MOCKED_RESPONSES':str(font),
    'NODE_OPTIONS':'--no-experimental-webstorage',
    'ANALYSIS_LOCAL_PREVIEW':'1',
    'ADMIN_DEV':'1',
    'TERMINAL_E2E_FIXTURE':'1',
    'TERMINAL_E2E_EMAIL':'responsive@example.com',
    'TERMINAL_E2E_ENTITLEMENT':'unlimited',
    'RATE_LIMIT_MAX':'100000',
    'HUB_REALTIME_QUOTES':'1',
    'TICKER_NEWS_RAIL':'1',
    'FLOW_FIXTURE':'1',
    'INVESTIGATION_API_ADMISSION':'open',
    'NEXT_PUBLIC_SUPABASE_URL':'http://127.0.0.1:54321',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY':'fixture-anon-key',
    'TERMINAL_E2E_PORT':str(port),
    'OPTIONS_COMBINED_EXPOSURE_PREWARM':'1',
})
logpath=root/'paper6d6-currentbase-20261104'/'browser-server.log'
testlog=root/'paper6d6-currentbase-20261104'/'browser.log'
serverlog=open(logpath,'w')
proc=None
try:
    proc=subprocess.Popen(['./node_modules/.bin/next','dev','--webpack','--hostname','127.0.0.1','--port',str(port)],cwd=tree,env=env,stdout=serverlog,stderr=subprocess.STDOUT,start_new_session=True)
    print('NEXT_TEST_SERVER_PID',proc.pid,'port',port,'webpack_offline_source=preview',flush=True)
    ready=False
    t0=time.monotonic()
    lastupdate=0
    while time.monotonic()-t0<180:
        if proc.poll() is not None:
            print('NEXT_EXIT_EARLY',proc.returncode,flush=True);break
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/terminal?symbol=NVDA',timeout=5) as r:
                if r.status==200:
                    print('NEXT_HTTP200_READY',round(time.monotonic()-t0,1),'seconds',flush=True)
                    ready=True
                    break
        except Exception:pass
        delta=time.monotonic()-t0
        if delta-lastupdate>15:
            print('NEXT_WAIT',round(delta,1),'seconds',flush=True);lastupdate=delta
        time.sleep(2)
    if not ready:
        serverlog.flush()
        lines=logpath.read_text(errors='replace').splitlines()
        print('NEXT_NOT_READY',len(lines),'lines; tail:',flush=True)
        print('\n'.join(lines[-22:])[-2600:],flush=True)
        sys.exit(11)
    command=['./node_modules/.bin/playwright','test',
      'e2e/options-exposure-workspace.spec.ts',
      'e2e/exposure-workspace.spec.ts',
      'e2e/exposure-partial-totals.spec.ts',
      'e2e/sector-exposure-journey.spec.ts',
      'e2e/options-r1-w3a-flow-inspector.spec.ts',
      'e2e/flow-freshness-responsive.spec.ts',
      'e2e/options-research-continuity.spec.ts',
      'e2e/options-workspace-usability.spec.ts',
      '--project=desktop','--project=tablet','--project=mobile',
      '--workers=2','--retries=0','--trace=on','--output=.next/paper6d6-combined-20261104']
    print('START_REAL_BROWSER_TEST',' '.join(command[1:]),flush=True)
    assert not testlog.exists(), 'DO_NOT_OVERWRITE_PRIOR_BROWSER_RUN'
    with open(testlog,'w') as f:
        try:
            result=subprocess.run(command,cwd=tree,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=1200)
            rc=result.returncode
        except subprocess.TimeoutExpired:
            rc=124
    print('PLAYWRIGHT_EXIT',rc,flush=True)
    print('\n'.join(testlog.read_text(errors='replace').splitlines()[-28:])[-3500:],flush=True)
    if rc:sys.exit(rc)
finally:
    if proc and proc.poll() is None:
        try:os.killpg(proc.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:proc.wait(timeout=12)
        except subprocess.TimeoutExpired:
            try:os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            proc.wait(timeout=5)
    serverlog.close()
    print('OWNED_TEST_SERVER_STOPPED',proc.pid if proc else 'none',flush=True)
