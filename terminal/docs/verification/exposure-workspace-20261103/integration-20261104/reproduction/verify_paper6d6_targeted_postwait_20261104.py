from pathlib import Path
import hashlib, json, os, signal, socket, subprocess, sys, time, urllib.request

root = Path(__file__).resolve().parent
tree = root / "tree" / "terminal"
font = tree / ".next" / "test-fonts" / "google-responses-offline-20261104.cjs"
records = root / "paper6d6-currentbase-20261104"
logpath = records / "targeted-postwait-20261104-server.log"
testlog = records / "targeted-postwait-20261104.log"
port = 3642
target = "terminal/e2e/exposure-partial-totals.spec.ts"
expected_new = "15be383d94284d83c7b893dc9c1a83c3d023528b97b2527891c7801c0f1f9c16"
snapshot = json.loads((records / "source-before-browser.json").read_text())
assert tree.is_dir() and font.is_file()
assert target in snapshot and not logpath.exists() and not testlog.exists()
assert (root / "inputs.json").is_file()
actual = {}
for relative, original_digest in snapshot.items():
    source = root / "tree" / relative
    assert source.is_file() and not source.is_symlink(), f"MISSING_SOURCE {relative}"
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    assert digest == (expected_new if relative == target else original_digest), f"UNEXPECTED_SOURCE_DRIFT {relative}"
    actual[relative] = digest
print(f"SOURCE_FENCE_PASS {len(actual)} paths; exact sole source change {target}={expected_new[:12]}", flush=True)
with socket.socket() as s:
    s.settimeout(1)
    assert s.connect_ex(("127.0.0.1", port)) != 0, "PORT_OCCUPIED_DO_NOT_REUSE"
env = os.environ.copy()
env.update({
    "NEXT_FONT_GOOGLE_MOCKED_RESPONSES": str(font),
    "NODE_OPTIONS": "--no-experimental-webstorage",
    "ANALYSIS_LOCAL_PREVIEW": "1",
    "ADMIN_DEV": "1",
    "TERMINAL_E2E_FIXTURE": "1",
    "TERMINAL_E2E_EMAIL": "responsive@example.com",
    "TERMINAL_E2E_ENTITLEMENT": "unlimited",
    "RATE_LIMIT_MAX": "100000",
    "HUB_REALTIME_QUOTES": "1",
    "TICKER_NEWS_RAIL": "1",
    "FLOW_FIXTURE": "1",
    "INVESTIGATION_API_ADMISSION": "open",
    "NEXT_PUBLIC_SUPABASE_URL": "http://127.0.0.1:54321",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "fixture-anon-key",
    "TERMINAL_E2E_PORT": str(port),
    "OPTIONS_COMBINED_EXPOSURE_PREWARM": "1",
})
proc = None
with logpath.open("x") as serverlog:
    try:
        proc = subprocess.Popen(["./node_modules/.bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", str(port)], cwd=tree, env=env, stdout=serverlog, stderr=subprocess.STDOUT, start_new_session=True)
        print("TARGETED_NEXT_PID", proc.pid, flush=True)
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"NEXT_EXIT_EARLY {proc.returncode}")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/terminal?symbol=NVDA", timeout=4) as response:
                    if response.status == 200: break
            except Exception:
                pass
            time.sleep(2)
        else:
            raise RuntimeError("NEXT_NOT_READY")
        for route in ["/options", "/discover?tab=sectors", "/analysis"]:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}{route}", timeout=45) as response:
                    print("PREWARM", route, response.status, flush=True)
            except Exception as error:
                print("PREWARM_UNQUALIFIED", route, type(error).__name__, flush=True)
        tests = ["e2e/exposure-partial-totals.spec.ts", "e2e/sector-exposure-journey.spec.ts", "e2e/options-research-continuity.spec.ts"]
        args = ["./node_modules/.bin/playwright", "test", *tests, "--project=desktop", "--workers=1", "--retries=0", "--trace=on", "--output=.next/paper6d6-targeted-postwait-20261104"]
        print("TEST_STARTED", " ".join(args[1:]), flush=True)
        with testlog.open("x") as stream:
            try:
                result = subprocess.run(args, cwd=tree, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=1200)
                rc = result.returncode
            except subprocess.TimeoutExpired:
                rc = 124
        lines = testlog.read_text(errors="replace").splitlines()
        print("PLAYWRIGHT_EXIT", rc, flush=True)
        print("\n".join(lines[-24:])[-4000:], flush=True)
        sys.exit(rc)
    finally:
        if proc and proc.poll() is None:
            try: os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError: pass
            try: proc.wait(timeout=12)
            except subprocess.TimeoutExpired:
                try: os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                proc.wait(timeout=5)
        print("OWNED_TARGETED_SERVER_STOPPED", proc.pid if proc else "none", flush=True)
