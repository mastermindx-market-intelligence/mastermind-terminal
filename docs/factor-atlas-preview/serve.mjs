// Loopback-only component harness. Not an application route or a deployment.
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const terminal = resolve(here, "../../terminal");
const require = createRequire(resolve(terminal, "package.json"));
export const proofDirectory = resolve(terminal, ".next/factor-atlas-proof");
const buildDirectory = resolve(proofDirectory, "harness");

export async function startPreview() {
  await mkdir(buildDirectory, { recursive: true });
  const { build } = require("esbuild");
  await build({ entryPoints: [resolve(here, "preview-entry.tsx")], outfile: resolve(buildDirectory, "bundle.js"),
    absWorkingDir: terminal, nodePaths: [resolve(terminal, "node_modules")], bundle: true,
    platform: "browser", target: ["es2022"], jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("development") } });
  // Only the shared variables required by this isolated harness are supplied here.
  // Product CSS remains the incumbent Terminal tokens; no theme owner is created.
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Factor Atlas — synthetic component preview</title><link rel="stylesheet" href="/bundle.css">
    <style>:root{color-scheme:dark;--bg:#0a0b0e;--panel:#0d0f13;--text:#d6dae3;--text-2:#9ba3b4;--muted:#717a8e;--line:#23262f;--line-2:#1a1d24;--chart-grid:rgba(255,255,255,.05);--chart-axis-text:#717a8e}
    :root[data-theme=light]{color-scheme:light;--bg:#f7f8fa;--panel:#fff;--text:#18202a;--text-2:#4b5563;--muted:#647080;--line:#d8dde4;--line-2:#e9edf1;--chart-grid:#e9edf1;--chart-axis-text:#647080}
    body{margin:0;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style></head>
    <body><main id="root"></main><script type="module" src="/bundle.js"></script></body></html>`;
  const files = { "/bundle.js": ["bundle.js", "text/javascript"], "/bundle.css": ["bundle.css", "text/css"] };
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
      const path = new URL(req.url || "/", "http://127.0.0.1").pathname;
      if (path === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(html); return; }
      if (!Object.hasOwn(files, path)) { res.writeHead(404); res.end(); return; }
      const [name, type] = files[path];
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(await readFile(resolve(buildDirectory, name)));
    } catch { res.writeHead(500); res.end("Preview unavailable"); }
  });
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const preview = await startPreview();
  console.log(`Synthetic-only local component: ${preview.url}`);
  process.once("SIGINT", async () => { await preview.close(); process.exit(0); });
  process.once("SIGTERM", async () => { await preview.close(); process.exit(0); });
}
