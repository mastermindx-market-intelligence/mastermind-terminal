import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import path from "path";

const isProd = process.env.NODE_ENV === "production";

// ── Deployment id (version-skew protection / stale-chunk self-heal) ───────────
// Each production deploy gets a DISTINCT id: prefer the git sha wired in by
// ops/terminal-build.sh (GIT_SHA / NEXT_DEPLOYMENT_ID), then read the deploy marker that the
// same script installs beside this config. The marker is essential because Next evaluates this
// file once during `next build` and again during `next start`; a Date.now() fallback at runtime
// creates a second id and makes embedded clients download duplicate chunks. Ad-hoc local builds
// omit the id rather than inventing a value that cannot remain stable across those two processes.
// Next appends `?dpl=<id>` to every static asset URL and injects
// `data-dpl-id` on <html> + an `x-nextjs-deployment-id` response header — so a client holding a
// stale /flow shell (served inside its SWR window after a deploy) detects the mismatch and does a
// full reload instead of resolving lazy chunks against purged content-hashed factories. This is the
// deterministic half of the options-crash fix (the chunk-retention union in deploy_terminal.sh is
// the belt-and-suspenders half). Keep the id stable ACROSS the containers of a single deploy.
function readDeploymentMarker(): string | undefined {
  try {
    return readFileSync(path.join(__dirname, ".deployment-id"), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

const DEPLOYMENT_ID =
  process.env.GIT_SHA || process.env.NEXT_DEPLOYMENT_ID || readDeploymentMarker();

// ── Content-Security-Policy ───────────────────────────────────────────────────
// Derived from an audit of every external resource the BROWSER actually reaches:
//   - inline bootstrap script (app/layout.tsx LOCALE_INIT) + Next App Router streaming
//     inject inline <script> → script-src needs 'unsafe-inline' (a nonce migration is the
//     follow-up hardening; documented in SECURITY.md).
//   - React inline style attributes → style-src 'unsafe-inline'.
//   - shared chart snapshots from Cloudflare R2 and asset identity logos from Logo.dev.
//   - Supabase auth (REST + realtime WS) → connect-src. (The former browser→Polygon trades WS was
//     removed 2026-07-19: any NEXT_PUBLIC_* key is world-readable and a dev sub is not a
//     redistribution license — live data now flows server-mediated only, so wss://socket.polygon.io
//     is no longer in connect-src.)
//   - CN/HK quote hosts are fetched SERVER-side today, but are allowed in connect-src as a safe
//     superset so a client fallback path can't silently break live quotes.
// frame-ancestors allows only the first-party Macro Dashboard (apex + www) to host the
// full-screen Terminal workspace. Every other origin remains blocked, so the integration
// does not create a general-purpose rehosting surface.
// In dev, Turbopack HMR needs 'unsafe-eval'; production stays strict.
//   - Mastermind Brain widget bundle: components/BrainWidget.tsx loads
//     https://www.mastermind-x.com/mm_brain.js on the Terminal — and, since AppShell also
//     mounts BrainWidget on /analysis, on the Analysis workspace too — so that origin is
//     allowed in script-src.
const scriptSrc = ["'self'", "'unsafe-inline'", "https://www.mastermind-x.com", ...(isProd ? [] : ["'unsafe-eval'"])].join(" ");
const dashboardFrameAncestors =
  "'self' https://mastermind-x.com https://www.mastermind-x.com" +
  (isProd ? "" : " http://localhost:* http://127.0.0.1:*");
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  `frame-ancestors ${dashboardFrameAncestors}`,
  "form-action 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.r2.dev https://img.logo.dev",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://qt.gtimg.cn https://web.ifzq.gtimg.cn https://ifzq.gtimg.cn",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

// Applied to every app response (Caddy reverse_proxies to `next start` and passes these through).
// NOTE: /data/* is served DIRECTLY by Caddy file_server in production, so it is NOT covered here —
// its CORP/nosniff headers live in the Caddyfile (app/deploy/Caddyfile, macro repo).
const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  // No X-Frame-Options: the legacy header cannot express an exact cross-origin
  // allowlist and would veto the first-party dashboard frame. CSP frame-ancestors
  // above is the modern, narrower authority.
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

// ── Embeddable widget headers (/embed/*) ──────────────────────────────────────
// The /embed/chart widget is iframed by the ~1,500 SEO stock dossier pages on
// https://mastermind-x.com/stocks/<TICKER>.html. The full Terminal and this widget now share the
// same exact first-party frame allowlist; this subtree keeps its separate noindex/cache policy:
//   - CSP stays strict and frameable only by the dossier/dashboard hosts (apex + www);
//   - X-Frame-Options remains omitted because the legacy header cannot express that allowlist;
//   - keeps nosniff / referrer / HSTS / permissions / COOP unchanged;
//   - adds X-Robots-Tag: noindex so search engines never index the widget shells directly;
//   - caps edge caching at 5 min (SWR 10 min) like the other prerendered shells.
// COEP is deliberately not set (an embedded third-party widget must stay cross-origin embeddable).
// In dev, also allow localhost parents on any port so the dossier repo's local
// preview (a plain static server on a random port) can frame the widget end-to-end.
const embedCSP = CSP;
const embedHeaders = [
  { key: "Content-Security-Policy", value: embedCSP },
  // NB: no X-Frame-Options here (its presence would block the cross-origin iframe).
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Robots-Tag", value: "noindex" },
  { key: "Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=600" },
];

const nextConfig: NextConfig = {
  // Distinct-per-build id → version-skew protection + stale-chunk self-heal (see DEPLOYMENT_ID above).
  deploymentId: DEPLOYMENT_ID,
  // pin the workspace root (sibling lockfiles exist) so Turbopack stops warning
  turbopack: { root: path.resolve(__dirname) },
  // Never ship client source maps to the browser (this is Next's default; pinned here as a
  // guardrail so proprietary chart/indicator/Pine logic can't be trivially de-minified).
  productionBrowserSourceMaps: false,
  // tsc --noEmit is clean as of 2026-07-11, so builds enforce types again — the
  // 2026-07-07 `typescript.ignoreBuildErrors` escape hatch (FinPage union nits)
  // is removed; CI (.github/workflows/ci.yml) also gates PRs on tsc + vitest.
  // Note: `eslint` key was removed in Next.js 16 — ESLint is no longer built-in.
  // ── Wave-2 IA redirect contract (permanent 308) ────────────────────────────
  // The old single-purpose route dirs (screener/heatmap/alerts/scripts/flow) were
  // deleted; the five-workspace URLs now own those destinations. Redirects are
  // checked before the filesystem, and Next passes through any request query that
  // the destination doesn't already set — so `/heatmap?v=2` → `/discover?tab=heatmap&v=2`
  // and the default `/flow?tab=gex` → `/research?tab=gex` both keep working without
  // enumerating every tab. Bookmarks, the macro dashboard's cross-links and the
  // ?v=2 cache-busted heatmap link all survive.
  async redirects() {
    return [
      { source: "/screener", destination: "/discover?tab=screener", permanent: true },
      { source: "/heatmap", destination: "/discover?tab=heatmap", permanent: true },
      // ── Wave-3 IA: Research→Options, Fundamentals→Analysis, Automate split ─────
      // Research is renamed Options. Its ex-Fundamentals chip is now the standalone
      // /analysis page — peel that specific deep-link off FIRST (ordered before the
      // catch-all), then send everything else (incl. tape/desk/tide/gex/… via ?tab=
      // passthrough) to /options.
      {
        source: "/research",
        has: [{ type: "query", key: "tab", value: "fundamentals" }],
        destination: "/analysis",
        permanent: true,
      },
      { source: "/research", destination: "/options", permanent: true },
      // Automate is split back into standalone Scripts + Alerts. Peel the two tabs
      // off first, then default bare /automate to /alerts (its old default tab).
      // NB: /alerts and /scripts are now REAL routes (their old redirects into
      // /automate are removed) — the filesystem serves them directly.
      {
        source: "/automate",
        has: [{ type: "query", key: "tab", value: "scripts" }],
        destination: "/scripts",
        permanent: true,
      },
      {
        source: "/automate",
        has: [{ type: "query", key: "tab", value: "alerts" }],
        destination: "/alerts",
        permanent: true,
      },
      { source: "/automate", destination: "/alerts", permanent: true },
      // The two ex-flow Discover tabs move to /discover; matched by query so only
      // these specific tabs peel off. Ordered BEFORE the catch-all /flow below.
      {
        source: "/flow",
        has: [{ type: "query", key: "tab", value: "leaders" }],
        destination: "/discover?tab=leaders",
        permanent: true,
      },
      {
        source: "/flow",
        has: [{ type: "query", key: "tab", value: "radar" }],
        destination: "/discover?tab=radar",
        permanent: true,
      },
      // Every other /flow (incl. no tab, and tape/desk/tide/tickers/vol/gex/prism/
      // prophet) → Options; the ?tab= value passes through untouched.
      { source: "/flow", destination: "/options", permanent: true },
    ];
  },
  async headers() {
    return [
      // Security headers on every route EXCEPT the /embed subtree (CSP, sniffing, referrer,
      // HSTS). Every app route is frameable only by the exact first-party dashboard origins so
      // users can move between Terminal workspaces without the frame being rejected mid-session.
      // /embed gets the same framing policy plus its own noindex/cache headers below.
      {
        source: "/((?!embed).*)",
        headers: securityHeaders,
      },
      // The embeddable widget subtree: frameable by the dossier host, no X-Frame-Options, noindex,
      // 5-min edge cap. See embedHeaders above.
      {
        source: "/embed/:path*",
        headers: embedHeaders,
      },
      // Cache static market-data JSON served from /data/* for 5 min, stale for 1 hour.
      {
        source: "/data/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=300, stale-while-revalidate=3600",
          },
        ],
      },
      // Statically-prerendered HTML would otherwise ship Next's s-maxage=31536000, which the
      // EdgeOne CDN pins for a year (a deploy then can't refresh these shells without a manual
      // console purge — no purge creds exist on the VPS/Mac). Cap edge caching at 5 minutes.
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=600",
          },
        ],
      },
      {
        // Auth-aware shells must never be shared by EdgeOne. Caching these as
        // public can replay a signed-out redirect or another session's shell.
        source: "/(terminal|discover|analysis|options|scripts|alerts|portfolio|admin|login)",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, no-store, must-revalidate, max-age=0",
          },
          { key: "Expires", value: "0" },
          { key: "Pragma", value: "no-cache" },
          { key: "Vary", value: "Cookie" },
        ],
      },
    ];
  },
};

export default nextConfig;
