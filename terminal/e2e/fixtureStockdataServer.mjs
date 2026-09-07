// Throwaway HTTP fixture for the macro per-ticker stockdata artifact (`/stockdata/<TICKER>.json`),
// COMMITTED so the B-F08-4 signed-in evidence (crops + the credentialed-vs-anonymous proof) is
// reproducible rather than an uncommitted ad hoc script (round-2 review MAJOR 2 — the earlier,
// uncommitted fixture server used to generate the round-1 crops answered 200 unconditionally,
// so those crops never actually exercised the cookie-forwarding path route.ts ships).
//
// Mirrors the ONE behavior this packet depends on from macro's real regwall (macro-main's
// app/regwall.py): a request carrying a valid Supabase session cookie (the same
// `sb-<project-ref>-auth-token` shape the unit tests' fixture and macro's real gate use) reads
// 200 with that ticker's fixture facts; a request without it is answered the same real shape the
// live regwall returns — 401, `x-regwall: deny`, `{locked:true,reason:"authentication_required"}`.
// A ticker outside FIXTURE_TICKERS answers 404 (the "no data page yet" gap), cookie or not.
//
// FIXTURE_TICKERS covers >= 3 distinct sectors and >= 3 distinct company-size buckets (round-2
// review MAJOR 4) across the same four tickers e2e/portfolio-risk-crops.spec.ts's seedBook()
// already opens positions in, so the crop matrix shows real diversity in both the Industries and
// Company-size cards without the crop generator having to seed a larger book.
//
// NOT wired into playwright.config.ts or any package.json script by this packet — `STOCKDATA_BASE`
// is read once at module load by app/api/portfolio/route.ts, so it must be set in the shell
// BEFORE the e2e webServer (`next dev`) boots; playwright.config.ts's webServer.env merges with
// the invoking shell's own environment, per e2e/portfolio-risk-crops.spec.ts's header comment.
// Invocation (run in one shell, then run the crop generator in a second with STOCKDATA_BASE set
// to the printed URL) is intentionally left to whoever actually captures the crops — this file is
// the reproducible fixture itself, not a new CI wiring.

import { createServer } from "node:http";

export const SESSION_COOKIE_NAME = "sb-testref-auth-token";
export const SESSION_COOKIE_VALUE = "base64-eyJhY2Nlc3NfdG9rZW4iOiJmYWtlIn0";

// Minor-2 (round-2 re-review): these MUST be synthetic tickers, never real symbols wearing
// counterfactual sector/size facts — the round-1 book paired AAPL/GLD/TLT with sector and
// market-cap values that do not describe the real companies, which would make every crop a
// false statement about a real, recognizable company. "ZZT*" is not a real listed ticker.
export const FIXTURE_TICKERS = {
  ZZTA: { sector: "Information Technology", marketCap: 3.2e12 }, // very_large
  ZZTB: { sector: "Communication Services", marketCap: 1.4e9 }, // small
  ZZTC: { sector: "Materials", marketCap: 8e9 }, // medium
  ZZTD: { sector: "Financials", marketCap: 55e9 }, // large
};

function hasSessionCookie(cookieHeader) {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .map((pair) => pair.trim().split("=")[0])
    .includes(SESSION_COOKIE_NAME);
}

/** Starts the fixture server on `port` (0 = OS-assigned free port). Resolves once listening,
 *  with the base URL to point `STOCKDATA_BASE` at and a `close()` to tear it down. */
export function startFixtureStockdataServer(port = 0) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = /^\/stockdata\/([A-Za-z0-9.]+)\.json$/.exec(url.pathname);
    if (!match) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    if (!hasSessionCookie(req.headers.cookie)) {
      res.writeHead(401, { "content-type": "application/json", "x-regwall": "deny" });
      res.end(JSON.stringify({ locked: true, reason: "authentication_required" }));
      return;
    }
    const ticker = match[1].toUpperCase();
    const facts = FIXTURE_TICKERS[ticker];
    if (!facts) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ sector: facts.sector, personality: { market_cap: facts.marketCap } }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${actualPort}`,
        close: () => new Promise((r) => server.close(() => r(undefined))),
      });
    });
  });
}

// `node e2e/fixtureStockdataServer.mjs [port]` — start it as a standalone process, print its
// URL, and keep it alive until killed.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 0);
  startFixtureStockdataServer(port).then(({ url }) => {
    console.log(`fixture stockdata server listening at ${url}`);
  });
}
