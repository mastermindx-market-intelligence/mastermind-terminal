// Shared upstream endpoints — DATA-ONLY module (no fs/network/react), safe to import
// from route handlers, server components and server libs alike. Every consumer of the
// R2 bucket / flow hub / Neural Web producer must import from here so a bucket or host
// rotation is a one-line change that can't miss a copy.
// Server-side only by convention: nothing here is NEXT_PUBLIC, so a client-bundle
// import would silently bake in the defaults — don't import from 'use client' code.

/** Public R2 CDN bucket — live-flow / options-hub mirrors and chart snapshots. */
export const R2_BASE = "https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev";

/** Python flow hub on this box (Quote-Hub sidecar); R2 is the fallback mirror. */
export const FLOW_BACKEND = process.env.FLOW_API_BASE || "http://127.0.0.1:8000";

/** Private Macro operator API. Never use the local flow sidecar or public R2 for decisions. */
export const ISSUE_DESK_API_BASE = process.env.ISSUE_DESK_API_BASE || "https://www.mastermind-x.com";

/** Neural Web display feeds (macro repo producer — market_plane.json etc.). The canonical host is
 * www: the bare host 301s there, and /api/nw never follows a redirect (T-NW-AUTH 2026-10-06). */
export const NW_BASE = process.env.NW_DATA_BASE || "https://www.mastermind-x.com/neuralwebdata";
