/* eslint-disable @typescript-eslint/no-require-imports -- Incumbent CommonJS capture contracts. */
"use strict";

// Page-specific failure handlers run first. This last context boundary closes
// provider reachability without replacing a Retry/heal or inventing live quotes.
async function installFixtureBoundary(context, base) {
  const origin = new URL(base);
  if (origin.origin !== base || origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port)
    throw Error("GEX_CAPTURE_BASE");
  await context.route("**/*", async route => {
    const request = route.request(); let url;
    try { url = new URL(request.url()); } catch { return route.abort("blockedbyclient"); }
    if (url.origin !== base || url.username || url.password || url.hash || !["GET", "HEAD"].includes(request.method()))
      return route.abort("blockedbyclient");
    // The actual Heatmap -> quote -> QuoteHub edge never reaches the server.
    // No fixture price is fabricated: the overlay correctly remains unavailable.
    if (url.pathname === "/api/quote" || (url.pathname.startsWith("/api/") && !["/api/flow", "/api/flow/stream"].includes(url.pathname)))
      return route.fulfill({ status: 503, json: { error: "fixture provider unavailable" } });
    if (["/options", "/discover", "/api/flow", "/api/flow/stream", "/data/manifest.json", "/data/flow_idx.json", "/favicon.ico"].includes(url.pathname)
        || (url.pathname.startsWith("/_next/static/") && !/%(?:2f|5c|00|25)/i.test(url.pathname)))
      return route.fallback(); // FLOW_FIXTURE is unconditional in this child, not a quote guard.
    return route.abort("blockedbyclient"); // Includes Next image-optimizer upstream URLs.
  });
  await context.routeWebSocket("**/*", socket => {
    // Keep only the incumbent Next development/debug channel on its exact owned
    // origin; a market/provider socket is never forwarded.
    const prefix = base.replace("http:", "ws:") + "/_next/webpack-hmr?id=";
    if (socket.url().startsWith(prefix) && /^[A-Za-z0-9_-]{1,128}$/.test(socket.url().slice(prefix.length))) socket.connectToServer();
    else socket.close();
  });
}

module.exports = { installFixtureBoundary };
