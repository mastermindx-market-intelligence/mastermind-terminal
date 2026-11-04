import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";

// Bundle the actual hook and React into an isolated HTTP fixture. The browser
// uses native EventSource, fetch, effect mounting and transport reconnection.
const bundle = buildSync({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {useFlowStream} from './lib/flowStream';
      let root; function Probe({id}) {const s=useFlowStream('feed',{pollMs:1000});
        return React.createElement('output',{'data-testid':id},JSON.stringify(s));}
      export function mount(){root=createRoot(document.getElementById('root'));
        root.render(React.createElement(React.Fragment,null,
          React.createElement(Probe,{id:'first'}),React.createElement(Probe,{id:'second'})));}
      export function unmount(){root.unmount();}`,
    resolveDir: process.cwd(), sourcefile: "native-flow-harness.tsx", loader: "tsx",
  },
  bundle: true, write: false, format: "iife", globalName: "FlowTransportProbe", platform: "browser",
  tsconfig: path.resolve(process.cwd(), "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' },
}).outputFiles[0].text;

test("native SSE recovery fences a delayed fallback for two mounted consumers", async ({ page }) => {
  test.setTimeout(25_000);
  let recover = false, attempts = 0;
  const streams = new Set<ServerResponse>(), polls: ServerResponse[] = [];
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/api/flow/stream")) {
      attempts++;
      // A failed connection has no open event. Native EventSource retries;
      // three such errors admit the hook's ordinary polling fallback.
      if (!recover) { request.socket.destroy(); return; }
      streams.add(response); response.on("close", () => streams.delete(response));
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      response.write('retry: 100\n\ndata: {"value":"SSE"}\n\n');
    } else if (request.url?.startsWith("/api/flow?")) {
      polls.push(response); // Deliberately hold the earlier poll in flight.
    } else {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end('<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div>');
    }
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture did not bind");
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as any).FlowTransportProbe.mount());
    await expect.poll(() => polls.length, { timeout: 15_000 }).toBe(1);
    expect(attempts).toBeGreaterThanOrEqual(3);
    recover = true;
    const first = page.getByTestId("first"), second = page.getByTestId("second");
    await expect(first).toContainText('"value":"SSE"', { timeout: 7000 });
    await expect(first).toContainText('"connected":true');
    expect(streams.size).toBe(1); expect(await second.textContent()).toBe(await first.textContent());
    const late = page.waitForResponse(response => response.url().includes("/api/flow?"));
    polls[0].writeHead(200, { "Content-Type": "application/json" }); polls[0].end('{"value":"retired poll"}');
    await (await late).finished();
    await expect(first).toContainText('"value":"SSE"'); await expect(second).toContainText('"value":"SSE"');
    await page.evaluate(() => (window as any).FlowTransportProbe.unmount());
    await expect.poll(() => streams.size).toBe(0);
    expect(polls).toHaveLength(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
