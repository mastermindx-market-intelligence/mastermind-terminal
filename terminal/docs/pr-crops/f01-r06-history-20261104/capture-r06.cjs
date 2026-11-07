const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const PARENT = "http://127.0.0.1:3158";
const CHILD = "http://127.0.0.1:3159";
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await ctx.addCookies([
    { name: "mm_e2e_rs30", value: "1", url: PARENT },
    { name: "mm_e2e_guest", value: "1", url: PARENT }
  ]);
  const p = await ctx.newPage();
  p.on("console", m => { if (m.text().startsWith("R06DBG")) console.log("BROWSER",m.text()); });
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  await p.addInitScript(() => {
    const trace = [];
    window.__r06Trace = trace;
    const push = (type, fields = {}) => { trace.push({ type, ...fields }); if (trace.length > 300) trace.shift(); };
    const oldSet = Map.prototype.set, oldGet = Map.prototype.get, oldClear = Map.prototype.clear;
    Map.prototype.set = function(key, value) {
      if (value && typeof value === "object" && typeof value.y === "number" && typeof value.x === "number")
        push("MAP_SET", { key, value });
      return oldSet.call(this, key, value);
    };
    Map.prototype.get = function(key) {
      const v = oldGet.call(this, key);
      if (typeof key === "string" && /^[0-9a-f-]{36}$/.test(key))
        push("MAP_GET", { key, hit: v !== undefined, value: v });
      return v;
    };
    Map.prototype.clear = function() {
      if ([...this.values()].some(v => v && typeof v.y === "number"))
        push("MAP_CLEAR", { size: this.size });
      return oldClear.call(this);
    };
    window.addEventListener("popstate", () => push("POPSTATE", { key: history.state?.mmxSharedShellEntry, href: location.href }), true);
    window.addEventListener("message", e => {
      if (e.data?.protocol === "mmx.shared-shell.v1")
        push("BRIDGE_IN", { origin: e.origin, messageType: e.data.type, view: e.data.view });
    }, true);
  });
  const parentState = () => p.evaluate(() => ({
    href: location.href,
    key: history.state?.mmxSharedShellEntry,
    phase: document.querySelector("main[data-shared-shell-phase]")?.getAttribute("data-shared-shell-phase"),
    events: (window.__r06Trace || []).slice(-45)
  }));
  const waitChild = async path => {
    await p.waitForURL(url => url.pathname === path, { timeout: 30000 });
    await p.locator('main[data-shared-shell-phase="ready"]').waitFor({ timeout: 30000 });
    for (let i = 0; i < 40; i++) {
      const f = p.frames().find(f => f.url().startsWith(CHILD + path));
      if (f) return f;
      await p.waitForTimeout(120);
    }
    throw Error("NO_CHILD_" + path + " " + p.frames().map(f => f.url()));
  };
  try {
    console.log("CHECKOUT", "4d67ee7785428a46dc78f09f6bc1dca32518d4aa");
    await p.goto(PARENT + "/macro.html", { waitUntil: "domcontentloaded", timeout: 30000 });
    const macro = await waitChild("/macro.html");
    await macro.locator("#r06-focus").focus();
    await macro.evaluate(() => scrollTo({ top: 650, behavior: "instant" }));
    await p.waitForTimeout(500);
    const before = { parent: await parentState(), child: await macro.evaluate(() => ({ href: location.href, y: scrollY, focus: document.activeElement?.id, init: window.__r06Child.inits })) };
    console.log("BEFORE", JSON.stringify(before));
    await p.getByRole("link", { name: "China", exact: true }).click({ timeout: 12000 });
    const china = await waitChild("/china.html");
    const intermediate = { parent: await parentState(), child: await china.evaluate(() => ({ href: location.href, init: window.__r06Child.inits })) };
    console.log("CHINA", JSON.stringify(intermediate));
    await p.goBack({ waitUntil: "domcontentloaded", timeout: 30000 });
    const back = await waitChild("/macro.html");
    await p.waitForTimeout(700);
    const restored = { parent: await parentState(), child: await back.evaluate(() => ({ href: location.href, y: scrollY, focus: document.activeElement?.id, init: window.__r06Child.inits })) };
    console.log("BACK", JSON.stringify(restored));
    const key = before.parent.key;
    const view = { x: 0, y: 650, focusId: "r06-focus" };
    const mapSet = before.parent.events.find(e => e.type === "MAP_SET" && e.key === key);
    const mapGet = restored.parent.events.find(e => e.type === "MAP_GET" && e.key === key && e.hit === true);
    const init = restored.child.init.at(-1);
    const checks = {
      initialSaved: JSON.stringify(mapSet?.value) === JSON.stringify(view),
      distinctNavigationEntry: intermediate.parent.key !== key,
      parentBackToOriginalEntry: restored.parent.key === key,
      parentLookupAfterBack: !!mapGet,
      exactRestorePayload: JSON.stringify(init?.restore) === JSON.stringify(view),
      restoredScroll: restored.child.y === 650,
      restoredFocus: restored.child.focus === "r06-focus",
      validRoutes: before.parent.href.endsWith("/macro.html") && intermediate.parent.href.endsWith("/china.html") && restored.parent.href.endsWith("/macro.html"),
      zeroBrowserErrors: errors.length === 0,
    };
    const evidence = {schema:"mastermind.f01.r06.local_chromium.v1", sourceBase:"4d67ee7785428a46dc78f09f6bc1dca32518d4aa", sourceMode:"isolated candidate patch on exact baseline", parent:PARENT, child:CHILD, browserVersion:b.version(), viewport:{width:1280,height:900}, checks, before, intermediate, restored, errors, status:Object.values(checks).every(Boolean)?"PASS_SCOPED":"FAIL"};
    fs.writeFileSync(path.join(__dirname,"RESULTS.json"),JSON.stringify(evidence,null,2)+"\n");
    console.log("R06_SCOPED_RESULT",JSON.stringify({status:evidence.status,checks}));
    if(evidence.status!=="PASS_SCOPED")throw Error("R06 candidate regression: "+JSON.stringify(checks));
  } finally {
    await b.close();
  }
})().catch(e => { console.error("R06_HEAD_PROBE_FAIL", e.stack); process.exitCode = 1; });