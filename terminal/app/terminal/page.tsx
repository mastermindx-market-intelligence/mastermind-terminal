import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { GUEST_COOKIE } from "@/lib/layoutsFixtureDb";
import TerminalShell from "@/components/TerminalShell";
import { canonicalChartSymbol, criticalTerminalDataUrls, resolveTerminalLandingSymbol } from "@/lib/terminalBoot";
import { preload } from "react-dom";

// dynamic='auto': supabase reads cookies → Next auto-detects dynamic; no need to force it.

export default async function Terminal({ searchParams }: { searchParams: Promise<{ sym?: string; symbol?: string; shell?: string; tray?: string; dossier?: string }> }) {
  const sp = await searchParams;
  // Canonicalized HERE, at the route boundary, so exactly one string reaches the shell, the
  // preload, and `dataCache`. A value that is not a usable symbol resolves to `undefined` — the
  // same state as no deep link at all — rather than travelling on as a raw URL fragment.
  const initialSymbol = canonicalChartSymbol(sp?.symbol ?? sp?.sym) ?? undefined;
  // ?shell=app — the installable apps' WebView mode: chart-only chrome + window.__mmShell bridge.
  const shellMode = sp?.shell === "app";
  // ?tray=1 (shell mode only) — keeps the TF quick tray visible; the symbol-preview sheet
  // embeds the full chart and has no native roller to own the interval.
  const shellTray = shellMode && sp?.tray === "1";
  // ?dossier=1 (shell mode only) — the detail rail becomes the ONLY content and the chart
  // workspace is not rendered at all; the native symbol sheet draws its own chart above it.
  const shellDossier = shellMode && sp?.dossier === "1";
  // Start the two chart-blocking JSON requests while the browser is still
  // downloading/hydrating the Terminal JavaScript. getSliceAndOhlc() reuses
  // these same-origin preloads when ChartPanel mounts.
  //
  // ⚠️ crossOrigin MUST stay "anonymous" so the preload is actually reused. The browser
  // matches a preload against a later fetch by request mode + credentials mode, not by
  // effective behavior. dataCache's `fetch(url)` is mode "cors" / credentials "same-origin";
  // "anonymous" is the only crossOrigin value that produces that same pair. Both alternatives
  // silently MISS and download the payload a second time — verified in-browser: "use-credentials"
  // (mode cors / credentials include) and omitting crossOrigin entirely (mode no-cors /
  // credentials include) each cost a full extra fetch of both files, ~141 KB on production's
  // critical path, delaying first chart paint by exactly what the preload was meant to save.
  //
  // `preload` is idempotent per href, so the deep-link call below and the landing-symbol call
  // that follows the rows collapse to one hint when they name the same file.
  const preloadChartData = (symbol: string) => {
    for (const href of criticalTerminalDataUrls(symbol)) {
      preload(href, {
        as: "fetch",
        crossOrigin: "anonymous",
        fetchPriority: "high",
      });
    }
  };
  // A deep link already names the landing symbol, so its hint goes out BEFORE the auth round
  // trip. Everything else has to wait for the rows that decide which symbol the first chart
  // opens on — see the `preloadChartData(resolveTerminalLandingSymbol(...))` calls below, one per
  // return path. Until that landed, a plain `/terminal` visit emitted NO chart-data preload at
  // all (`criticalTerminalDataUrls(undefined)` is `[]`), which is the single most common entry
  // into the flagship: the preload repaired in #420 only ever applied to `?sym=` links.
  if (initialSymbol) preloadChartData(initialSymbol);
  // Browser smoke tests exercise the real responsive shell with checked-in market fixtures. They
  // deliberately skip remote auth so CI remains deterministic and never depends on Supabase.
  // The second-resolution band is real-time-derived, so it rides the same operator lever as
  // the real-time quote leg (HUB_REALTIME_QUOTES). Read HERE, on the server, and handed down
  // as a prop: a NEXT_PUBLIC_ twin would put a second switch in play and let the two drift.
  // Default OFF — /api/intraday refuses the band unless this is set, so the picker must agree.
  const secondBarsEnabled = process.env.HUB_REALTIME_QUOTES === "1";
  const e2eFixture = process.env.TERMINAL_E2E_FIXTURE === "1";
  const guestSymbols: [string, string][] = [["Crypto", "BTC-USD"], ["Crypto", "ETH-USD"], ["Equities", "NVDA"], ["Equities", "AAPL"], ["Equities", "MSFT"], ["Equities", "QQQ"]];
  const guestRows = guestSymbols.map(([section, symbol]) => ({ symbol, section }));
  if (e2eFixture) {
    // The fixture server signs every session in (TERMINAL_E2E_EMAIL), which leaves the signed-OUT
    // workspace — the one that carried a Save button wired to a guaranteed 401 — untestable. One
    // cookie renders a genuine guest, and `/api/layouts` honours the same cookie, so the page and
    // the API agree about who is asking. Fixture branch only: unreachable in production.
    const jar = await cookies();
    const guest = jar.get(GUEST_COOKIE)?.value === "1";
    const fixtureEmail = guest ? "" : (process.env.TERMINAL_E2E_EMAIL || "");
    // Imported lazily: the watchlist fixture store must stay unreachable from a production bundle.
    const { createFixtureDb, fixtureUserId, FIXTURE_STORE_COOKIE } = await import("@/lib/watchlistsFixtureDb");
    const { listWatchlists } = await import("@/lib/watchlists");
    const fixtureKey = jar.get(FIXTURE_STORE_COOKIE)?.value || "default";
    // Read the SAME store `/api/watchlist` serves, through the same service, instead of handing
    // down a constant. The constant made the harness disagree with itself: a spec could delete a
    // symbol through the real route and the very next render would still prop in the seeded six,
    // so the shell adopted the "server-only" row straight back — a resurrection the product does
    // not have. The seed is identical to `guestRows`, so every existing spec sees what it did.
    // A cookie-declared GUEST has no server store to read and gets the plain seed.
    const fixtureRows = fixtureEmail
      ? ((await listWatchlists(createFixtureDb(fixtureKey), fixtureUserId(fixtureKey)))[0]?.symbols
          .map(({ symbol, section }) => ({ symbol, section })) ?? [])
      : guestRows;
    preloadChartData(resolveTerminalLandingSymbol(initialSymbol, fixtureRows));
    return <TerminalShell symbols={fixtureRows} email={fixtureEmail} userId={fixtureEmail ? fixtureUserId(fixtureKey) : undefined} initialSymbol={initialSymbol} shellMode={shellMode} shellTray={shellTray} shellDossier={shellDossier} secondBarsEnabled={secondBarsEnabled} />;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // login disabled for now — render an open guest workspace (no server-side persistence)
  if (!user) {
    preloadChartData(resolveTerminalLandingSymbol(initialSymbol, guestRows));
    return <TerminalShell symbols={guestRows} email="" initialSymbol={initialSymbol} shellMode={shellMode} shellTray={shellTray} shellDossier={shellDossier} secondBarsEnabled={secondBarsEnabled} />;
  }

  // load or seed the user's first watchlist (idempotent via unique (user_id,name)).
  // UPSERT, not insert: right after signup the router.refresh and the page load race
  // this block concurrently — a plain insert made the loser error out and fall through
  // with no row visible yet (operator-reported stuck "Setting up your workspace").
  const { data: lists0 } = await supabase.from("watchlists").select("id,name").order("position");
  let lists = lists0;
  if (!lists || lists.length === 0) {
    const { data: wl } = await supabase
      .from("watchlists")
      .upsert({ user_id: user!.id, name: "Default", position: 0 }, { onConflict: "user_id,name" })
      .select("id").single();
    if (wl) {
      // Seed symbols only when the list is empty (the concurrent winner may have seeded).
      //
      // TWO things make this race-safe, and neither is the count on its own:
      //   * `error` is checked, because `!count` was ALSO true for a FAILED count — a transient
      //     PostgREST error read as "this list is empty", which is permission to seed a list that
      //     may already hold the user's own symbols. An unknown count is not an empty count, so a
      //     failed read now seeds nothing and the next request re-decides on real data;
      //   * the write is an UPSERT on `(watchlist_id, symbol)` (migration 0008). The two concurrent
      //     post-signup requests this block exists for can both observe count 0 and both write;
      //     before the unique index that produced TWELVE Default rows, six of them duplicates.
      const { count, error: countError } = await supabase.from("watchlist_symbols")
        .select("watchlist_id", { count: "exact", head: true }).eq("watchlist_id", wl.id);
      if (!countError && !count) {
        const { seedMembership } = await import("@/lib/watchlists");
        await seedMembership(supabase as never,
          guestSymbols.map(([section, symbol], i) => ({ watchlist_id: wl.id, section, symbol, position: i })));
      }
    }
    // Re-read with a short backoff — the concurrent request's commit can land a beat later.
    for (let attempt = 0; attempt < 3; attempt++) {
      ({ data: lists } = await supabase.from("watchlists").select("id,name").order("position"));
      if (lists && lists.length > 0) break;
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  const active = lists?.[0];
  if (!active) {
    // Still nothing after the retries — render the honest holding screen, but with
    // AUTO-RECOVERY (bounded refresh loop + manual Retry), never a dead end.
    const { default: ProvisioningRetry } = await import("@/components/ProvisioningRetry");
    const { T } = await import("@/components/LocalizedCopy");
    return <main className="center"><div className="hero"><T as="h1" k="provSettingUp" style={{ fontSize: 20 }} /><T as="p" k="provOneMoment" className="tag" /><ProvisioningRetry /></div></main>;
  }
  const { data: syms } = await supabase
    .from("watchlist_symbols").select("symbol,section").eq("watchlist_id", active.id).order("position");

  const rows = (syms as { symbol: string; section: string }[] | null) || [];
  preloadChartData(resolveTerminalLandingSymbol(initialSymbol, rows));
  // `userId`, not `email`, is what watchlist local state is namespaced by: an address can be
  // changed and reassigned, the auth uuid cannot, and a durable owner key that can be recycled is
  // not an owner boundary.
  return <TerminalShell symbols={rows} email={user?.email || ""} userId={user.id} initialSymbol={initialSymbol} shellMode={shellMode} shellTray={shellTray} shellDossier={shellDossier} secondBarsEnabled={secondBarsEnabled} />;
}
