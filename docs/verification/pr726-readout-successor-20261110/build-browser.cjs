const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { createRequire } = require("node:module");
const p = __dirname, w = path.resolve(p, "../../.."), t = path.join(w, "terminal");
const req = createRequire(path.join(t, "package.json"));
const esbuild = req("esbuild"), postcss = req("postcss"), tw = req("@tailwindcss/postcss");
const out = path.join(p, "browser"), pub = path.join(out, "public");
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const files = [
  "terminal/lib/precisionEntryReadout.ts", "terminal/components/PrecisionEntryStrip.tsx",
  "terminal/components/PrecisionEntryStrip.module.css", "terminal/lib/precisionEntry.ts",
  "terminal/app/globals.css", "terminal/components/chrome/shared-shell/shared-shell.css",
  "terminal/app/layout.tsx", "terminal/package.json", "terminal/package-lock.json",
  "docs/verification/pr726-readout-successor-20261110/fixture.tsx",
  "docs/verification/pr726-readout-successor-20261110/build-browser.cjs",
  "docs/verification/pr726-readout-successor-20261110/browser-proof.cjs",
];
const snapshot = () => Object.fromEntries(files.map(f => [f, hash(fs.readFileSync(path.join(w, f)))]));
const before = snapshot();
const prior = "/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1427-exposure-browser-successor/terminal/.next/dev/static";
const fontCss = path.join(prior, "chunks/[next]_internal_font_google_inter_7b064e0d_module_css_1igg3k2._.single.css");
(async () => {
  if (fs.existsSync(out)) throw new Error("Existing browser proof must be reconciled, not overwritten");
  fs.mkdirSync(path.join(pub, "_next/static/chunks"), { recursive: true });
  fs.mkdirSync(path.join(pub, "_next/static/media"), { recursive: true });
  const fontText = fs.readFileSync(fontCss, "utf8");
  fs.writeFileSync(path.join(pub, "_next/static/chunks/inter.css"), fontText);
  const fontInputs = [{ source: fontCss, sha256: hash(Buffer.from(fontText)) }];
  for (const m of fontText.matchAll(/url\("\.\.\/media\/([^"]+\.woff2)"\)/g)) {
    const source = path.join(prior, "media", m[1]);
    const data = fs.readFileSync(source);
    fs.writeFileSync(path.join(pub, "_next/static/media", m[1]), data);
    fontInputs.push({ source, bytes: data.length, sha256: hash(data) });
  }
  if (fontInputs.length !== 8) throw new Error("Unexpected Inter cache input set");
  const globalSource = path.join(t, "app/globals.css");
  const css = await postcss([tw({ base: t })]).process(fs.readFileSync(globalSource, "utf8"), {
    from: globalSource, to: path.join(pub, "globals.css"),
  });
  fs.writeFileSync(path.join(pub, "globals.css"), css.css);
  fs.copyFileSync(path.join(t, "components/chrome/shared-shell/shared-shell.css"), path.join(pub, "presentation.css"));
  const bundle = await esbuild.build({
    entryPoints: [path.join(p, "fixture.tsx")], bundle: true, outfile: path.join(pub, "fixture.js"),
    format: "iife", platform: "browser", jsx: "automatic", nodePaths: [path.join(t, "node_modules")],
    alias: { "@": t }, loader: { ".module.css": "local-css" },
    define: { "process.env.NODE_ENV": '"production"' }, metafile: true, logLevel: "warning",
  });
  fs.writeFileSync(path.join(out, "bundle-metafile.json"), JSON.stringify(bundle.metafile, null, 2) + "\n");
  fs.writeFileSync(path.join(pub, "index.html"), '<!doctype html><html lang="en" data-theme="dark" data-terminal-appearance="1" class="inter_7b064e0d-module__MOT0tq__variable"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/_next/static/chunks/inter.css"><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/presentation.css"><link rel="stylesheet" href="/fixture.css"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get("theme")==="light"?"light":"dark";</script></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  const after = snapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Source changed during build");
  const result = {
    schema: "terminal_pr726_component_browser_build.v1", state: "BUILT", sourceStable: true,
    sourceFiles: before, fontInputs, fontOrigin: "Actual Inter CSS and seven font subsets from this principal's completed PR1427 Next capture; root layout font request remains unchanged.",
    themeOwner: "Unchanged shared-shell.css chart appearance token rules, data-terminal-appearance=1; dark uses globals.css.",
    node: process.version, esbuild: req("esbuild/package.json").version, react: req("react/package.json").version,
    warnings: [...css.warnings().map(x => x.toString()), ...bundle.warnings.map(x => x.text)],
  };
  fs.writeFileSync(path.join(out, "build.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ state: result.state, sourceFiles: files.length, fonts: fontInputs.length - 1, warnings: result.warnings }));
})().catch(error => { console.error(error); process.exitCode = 1; });
