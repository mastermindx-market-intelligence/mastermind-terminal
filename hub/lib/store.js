"use strict";
// Central quote store + manifest-derived prev-close map.
//
// Contract §1 quote shape:
//   { sym, last, chg, prevClose?, close?, open?, high?, low?, vol?, amount?,
//     ts, live, source, market, basis, marketSession?, regularSessionDate?,
//     extPrice?, extChg?, extTs?, extSession?, extSource?, extBasis?,
//     tickOpen?, tickHigh?, tickLow?, tickClose?, tickVol?, tickStartMs?, tickEndMs? }
//
// prevClose derivation (session-keyed, not manifest-derived):
//   US:     prevClose comes from AnchorCache — daily file → Polygon REST → manifest fallback.
//           chg = (hubLast - prevClose) / prevClose * 100.
//   crypto: the active feed carries its own prevClose; OKX uses the UTC-0 day open while the
//           Coinbase fallback uses rolling open_24h. `changeBasis` makes that distinction explicit.
//
// Extended-session semantics:
//   `last`/`chg` remain regular-session values. Pre/post/overnight prints are
//   merged at read time under the separate ext* namespace and disappear in RTH.
//
// AM/ticker messages that carry only o/h/l/c/v must NOT clobber source/basis/market set at
// subscribe time — setQuote merges partials.

const fs = require("fs");
const log = require("./log");
const { classifySession, etDate } = require("./usSession");
const { NAME_REALTIME_MAX_LAG_MS } = require("./snapshot");

const STALE_EVICT_MS = 45 * 60 * 1000; // 45 min
const MANIFEST_CHECK_MIN_INTERVAL = 30 * 1000; // ≤1 stat/reparse per 30 s

function samePrice(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(0.0001, Math.abs(b) * 1e-8);
}

class Store {
  /**
   * @param {string} manifestPath
   * @param {import('./anchor').AnchorCache} [anchorCache]
   */
  constructor(manifestPath, anchorCache) {
    this.manifestPath = manifestPath;
    this.anchorCache = anchorCache || null;
    /** @type {Map<string, object>} SYM → quote object */
    this.quotes = new Map();
    this.manifest = {
      mtimeMs: 0,
      /** @type {Map<string, number>} SYM → derived prev-close (manifest-derived, legacy) */
      prevCloseBySym: new Map(),
      /** @type {Map<string, number>} SYM → manifest last (EOD close) */
      lastBySym: new Map(),
      /** @type {Set<string>} */
      syms: new Set(),
    };
    this.lastManifestCheck = 0;
    // Symbols currently held by a live subscription (crypto product list / polygon subs).
    // pruneIdle never evicts a subscribed symbol. Feeds register/unregister via markSubscribed.
    this.subscribed = new Set();
  }

  markSubscribed(sym, on) {
    if (on) this.subscribed.add(sym);
    else this.subscribed.delete(sym);
  }

  // Merge a partial quote into the existing entry. Never lets an AM-only payload
  // (o/h/l/c/v) erase source/basis/market. Stamps ts if absent, recomputes chg.
  //
  // When anchorCache is attached, prevClose comes from the session-keyed anchor (not the
  // manifest). The anchor also contributes the official regular-session close.
  setQuote(sym, partial, nowMs) {
    const now = nowMs != null ? nowMs : Date.now();
    const prev = this.quotes.get(sym) || { sym };
    const q = { ...prev, ...partial, sym };
    if (q.ts == null) q.ts = Math.floor(now / 1000);

    // ── prevClose resolution ──
    // Priority: (1) AnchorCache session-keyed entry, (2) partial carries its own prevClose
    // (crypto feed path), (3) manifest-derived legacy fallback.
    let prevClose = null;
    let anchorSource = null;
    let staleAnchor = false;

    if (this.anchorCache && q.market === "us") {
      const anchor = this.anchorCache.get(sym, now);
      if (anchor && anchor.prevClose != null) {
        prevClose = anchor.prevClose;
        anchorSource = anchor.anchor_source || "daily_file";
        staleAnchor = !!anchor.stale_anchor;

        // The regular close is a regular-session field. Extended prints are
        // carried exclusively by extPrice/extChg and never overlaid onto last.
        if (anchor.close != null) {
          q.close = anchor.close;
        } else {
          // No today-close yet. Evict a close from a prior ET session.
          delete q.close;
        }
      }
    }
    if (q.market === "us") delete q.afterHours;

    // Crypto / non-US: partial may carry prevClose (open_24h).
    if (prevClose == null && q.prevClose != null) {
      prevClose = q.prevClose;
      anchorSource = anchorSource || "quote_partial";
    }

    // Manifest fallback (US only, last resort).
    if (prevClose == null) {
      const derived = this.manifest.prevCloseBySym.get(sym);
      if (derived != null) {
        prevClose = derived;
        anchorSource = "manifest";
        staleAnchor = true;
      }
    }

    if (prevClose != null && prevClose !== 0 && q.last != null) {
      q.prevClose = prevClose;
      q.chg = ((q.last - prevClose) / prevClose) * 100;
    } else if (q.chg == null) {
      q.chg = null;
    }

    if (anchorSource) q.anchor_source = anchorSource;
    if (staleAnchor) q.stale_anchor = true;
    else delete q.stale_anchor;

    this.quotes.set(sym, q);
    return q;
  }

  // Present entries only; missing syms are simply absent from the result.
  //
  // SERVE-TIME anchor re-derivation: quotes bake prevClose/chg at message time
  // (applyPartial). After hours NO new tape message arrives, so a quote built
  // during boot with the manifest fallback would keep its stale anchor forever.
  // Re-check the AnchorCache on every read and re-derive when a better entry
  // exists — the read path is what must be correct, not the write path.
  // nowMs is optional; defaults to Date.now(). Exposed for unit tests.
  //
  // extFeed is optional; when provided, ext fields (extPrice/extChg/extTs/extSession/
  // extSource) are merged for US symbols during extended-hours windows. They are
  // NEVER emitted during RTH. Passed by hub.js; null when ext feed is disabled.
  //
  // snapshotFeed is optional; when provided, a US symbol carrying NO print from today's
  // regular session adopts the REST snapshot's session (see lib/snapshot.js). Without it
  // such a symbol falls back to the nightly manifest and shows the PREVIOUS session.
  getQuotes(symList, nowMs, extFeed, snapshotFeed) {
    const out = {};
    const now = nowMs != null ? nowMs : Date.now();
    for (const sym of symList) {
      const q = this.quotes.get(sym);
      if (!q) continue;
      const marketSession = q.market === "us" ? classifySession(now) : null;
      const cachedAnchor =
        this.anchorCache && q.market === "us" ? this.anchorCache.get(sym, now) : null;
      const hasCurrentRegularSession =
        q.regularSessionDate != null && q.regularSessionDate === etDate(now);

      // A same-session Polygon snapshot owns both halves of the day-change pair:
      // today's price AND prevDay.c. Keep that baseline ahead of the daily-file anchor.
      // The daily file can contain a bad/stale prior bar even after today's bar has rolled
      // (operator-reported SPCX recurrence, 2026-08-11: snapshot prevDay.c=138.74 while
      // the daily file said 131.66). The old order adopted 138.74 on one request, then
      // serve-time anchor re-derivation replaced it with 131.66 on the next poll and
      // turned a -3.93% close into +1.24%.
      //
      // A fresh cache row is preferred. If the REST refresh is briefly in flight, retain
      // an already-proven snapshot reference while the quote still represents that regular
      // session. After midnight, Polygon still exposes the latest completed day/prevDay pair;
      // getCompleted() accepts it only when day.c matches the independently resolved latest
      // daily close. That corroboration fixes a bad prior bar without treating yesterday as
      // today's session or carrying the pair across a newer regular print.
      const snap = snapshotFeed && q.market === "us" ? snapshotFeed.get(sym, now) : null;
      const completedSnap =
        !hasCurrentRegularSession &&
        snapshotFeed && typeof snapshotFeed.getCompleted === "function" &&
        cachedAnchor && cachedAnchor.prevClose != null &&
        typeof q.last === "number" && Number.isFinite(q.last) &&
        samePrice(q.last, cachedAnchor.prevClose)
          ? snapshotFeed.getCompleted(sym, now, cachedAnchor.prevClose)
          : null;
      const snapshotPrevClose =
        hasCurrentRegularSession &&
        snap && snap.prevClose != null && Number.isFinite(snap.prevClose) && snap.prevClose > 0
          ? snap.prevClose
          : null;
      const persistedSnapshotPrevClose =
        hasCurrentRegularSession &&
        q.anchor_source === "snapshot" &&
        q.prevClose != null && Number.isFinite(q.prevClose) && q.prevClose > 0
          ? q.prevClose
          : null;
      const completedSnapshotPrevClose =
        completedSnap && completedSnap.prevClose != null &&
        Number.isFinite(completedSnap.prevClose) && completedSnap.prevClose > 0
          ? completedSnap.prevClose
          : null;
      const persistedCompletedSnapshotPrevClose =
        !hasCurrentRegularSession &&
        q.anchor_source === "snapshot" &&
        q.regularSessionDate != null &&
        cachedAnchor && cachedAnchor.prevClose != null &&
        typeof q.last === "number" && Number.isFinite(q.last) &&
        samePrice(q.last, cachedAnchor.prevClose) &&
        q.prevClose != null && Number.isFinite(q.prevClose) && q.prevClose > 0
          ? q.prevClose
          : null;
      const snapshotClose =
        (marketSession === "post" || marketSession === "overnight") &&
        snap && snap.close != null && Number.isFinite(snap.close) && snap.close > 0
          ? snap.close
          : null;
      const persistedSnapshotClose =
        (marketSession === "post" || marketSession === "overnight") &&
        hasCurrentRegularSession &&
        q.anchor_source === "snapshot" &&
        q.close != null && Number.isFinite(q.close) && q.close > 0
          ? q.close
          : null;
      const useSnapshotReference =
        snapshotPrevClose != null ||
        persistedSnapshotPrevClose != null ||
        completedSnapshotPrevClose != null ||
        persistedCompletedSnapshotPrevClose != null;
      const snapshotReferenceClose =
        snapshotPrevClose != null
          ? snapshotClose
          : persistedSnapshotPrevClose != null
            ? persistedSnapshotClose
            : null;
      const snapshotReferenceSessionDate =
        snapshotPrevClose != null
          ? snap.date
          : persistedSnapshotPrevClose != null
            ? q.regularSessionDate
            : completedSnapshotPrevClose != null
              ? completedSnap.date
              : q.regularSessionDate;
      const anchor = useSnapshotReference
        ? {
            prevClose:
              snapshotPrevClose ??
              persistedSnapshotPrevClose ??
              completedSnapshotPrevClose ??
              persistedCompletedSnapshotPrevClose,
            close: snapshotReferenceClose,
            anchor_source: "snapshot",
            sessionDate: snapshotReferenceSessionDate,
          }
        : cachedAnchor;
      if (!anchor || anchor.prevClose == null || anchor.prevClose <= 0) {
        if (marketSession) {
          const fresh = { ...q, marketSession };
          delete fresh.afterHours;
          out[sym] = fresh;
        } else {
          out[sym] = q;
        }
        continue;
      }
      // Serve-time derivation (write-time is not enough: after hours no tape
      // message arrives, so applyPartial never re-runs on boot-built quotes):
      //   close          — anchor carries today's official close once the daily file rolls
      //   chg            — regular-session performance only
      //   prevSessionChg — last completed session's chg before a new RTH begins
      const close =
        anchor.close != null && Number.isFinite(anchor.close) ? anchor.close : null;
      const dayRef = close != null ? close : typeof q.last === "number" ? q.last : null;
      // A placeholder quote (polygon.js _writePlaceholder) carries `last` = manifest.last,
      // which is the very close the AnchorCache resolves as `prevClose` — so the difference
      // is a STRUCTURAL ZERO, an artifact of comparing a number with itself, not a flat
      // tape. Publish the last completed session's move instead.
      //
      // Two independent conditions must BOTH hold, and the pair is what makes this safe:
      //   !hasCurrentRegularSession — no print from today has ever landed for this symbol
      //   structuralZero            — the number we would publish is `x - x`
      // A symbol that genuinely trades flat has a real print, so it carries today's
      // regularSessionDate and still reports an honest 0.00% through the branch below.
      //
      // This deliberately does NOT exclude RTH. It used to (`marketSession !== "rth"`), on
      // the assumption that a live print always exists during the session — but a symbol
      // whose subscription was idle-swept, LRU-evicted, or has simply not yet been sent an
      // AM bar has no such print, and every one of them served a fabricated "0.00%" for the
      // whole session (operator-reported 2026-08-07).
      const structuralZero =
        dayRef != null && Math.abs(dayRef - anchor.prevClose) < 1e-9;
      const usePreviousSession =
        close == null &&
        !hasCurrentRegularSession &&
        structuralZero &&
        anchor.prevSessionChg != null &&
        Number.isFinite(anchor.prevSessionChg);
      const prevSessionChg =
        usePreviousSession
          ? anchor.prevSessionChg
          : null;
      const chg = prevSessionChg != null
        ? prevSessionChg
        : dayRef != null
          ? ((dayRef - anchor.prevClose) / anchor.prevClose) * 100
          : q.chg;

      const changed =
        anchor.prevClose !== q.prevClose ||
        (close != null ? q.close !== close : q.close != null) ||
        chg !== q.chg ||
        (prevSessionChg != null ? q.prevSessionChg !== prevSessionChg : q.prevSessionChg != null) ||
        q.marketSession !== marketSession ||
        (anchor.sessionDate != null && q.regularSessionDate !== anchor.sessionDate) ||
        q.afterHours != null;
      if (!changed) {
        out[sym] = q;
        continue;
      }
      const fresh = { ...q };
      fresh.prevClose = anchor.prevClose;
      fresh.chg = chg;
      if (close != null) fresh.close = close;
      else delete fresh.close;
      delete fresh.afterHours;
      if (prevSessionChg != null) fresh.prevSessionChg = prevSessionChg;
      else delete fresh.prevSessionChg;
      fresh.marketSession = marketSession;
      if (anchor.sessionDate != null) fresh.regularSessionDate = anchor.sessionDate;
      fresh.anchor_source = anchor.anchor_source;
      if (anchor.stale_anchor) fresh.stale_anchor = true;
      else delete fresh.stale_anchor;
      this.quotes.set(sym, fresh); // persist so /health + later reads agree
      out[sym] = fresh;
    }

    // ── REST snapshot: adopt today's session when the tape never delivered one ──
    // The streaming aggregate feed is idle-swept after 30 minutes, so outside the flagship 37
    // the normal state for a symbol is "no live subscription". Without this leg the only
    // fallback was `manifest.last` — a NIGHTLY artifact carrying the PREVIOUS session's
    // close — which is how SKY read 91.52 after closing at 94.66 (operator, 2026-08-07).
    //
    // Runs BEFORE the ext merge so `closeRef` below sees the real regular close and the
    // post-market percentage is measured from today's close rather than yesterday's.
    // No-op when the feed is absent/disabled, and it never overrides a symbol the tape
    // IS carrying for today — the stream stays authoritative whenever it has data.
    if (snapshotFeed) {
      // ── Freshness verdict, measured (lib/snapshot.js verdict()) ──
      // "The stream stays authoritative" was the right rule while the ONLY streaming leg and the
      // ONLY REST leg were both 15 minutes behind. It is the wrong rule once the REST leg is
      // real-time: the WebSocket cluster is still `delayed` unless HUB_POLYGON_CLUSTER=live, so
      // deferring to it would pin a 15-minute-old AM bar over a print from three seconds ago.
      // The rule is therefore FRESHEST-PRINT-WINS, and only when the feed has MEASURED itself
      // real-time — never on the strength of the env flag that merely enabled the leg.
      const rtVerdict = typeof snapshotFeed.verdict === "function" ? snapshotFeed.verdict(now) : null;
      const realtimeTier = !!rtVerdict && rtVerdict.tier === "realtime";
      for (const sym of symList) {
        const q = out[sym];
        if (!q || q.market !== "us") continue;
        const snap = snapshotFeed.get(sym, now);
        if (!snap) continue;

        const hasTodayPrint = q.regularSessionDate != null && q.regularSessionDate === etDate(now);
        // ── PER-NAME freshness, checked before adopting anything as real-time ──
        // The verdict above grades the FEED — the floor across every symbol — which is the right
        // shape for a feed-level claim but the wrong one for THIS row's badge. Two guards, and
        // the second is the one that bites:
        //   • printDate: the print must belong to today's ET session, the same rule _flush
        //     applies to the floor. Defence in depth — get() already refuses a snapshot whose
        //     own date is not today, so this rarely fires on its own.
        //   • age: the print must be younger than NAME_REALTIME_MAX_LAG_MS. This is the one that
        //     catches the measured failure — a same-session print can be hours old while a
        //     liquid sibling holds the floor at 3s, and nothing downstream capped it.
        // A row failing either keeps the delayed basis and labels; only its price is stale, and
        // saying "15-min delayed" about a stale price is far closer to true than "Live".
        const printFresh =
          snap.printMs != null &&
          snap.printDate === etDate(now) &&
          now - snap.printMs <= NAME_REALTIME_MAX_LAG_MS;
        // Real-time price for this row: the last TRADE, which is fresher than day.c.
        const rtPrice =
          realtimeTier && printFresh && snap.printPrice != null && snap.printPrice > 0
            ? snap.printPrice : null;
        const printTs = snap.printMs != null ? Math.floor(snap.printMs / 1000) : snap.ts;
        if (hasTodayPrint) {
          // The tape is carrying this symbol today. Override ONLY when measured real-time AND
          // strictly newer than what the tape gave us — a tie keeps the stream, so a quiet
          // symbol never flaps between two legs reporting the same instant.
          if (!realtimeTier || rtPrice == null) continue;
          if (!(typeof q.ts === "number") || !(printTs > q.ts)) continue;
        }

        const fresh = { ...q };
        fresh.last = rtPrice != null ? rtPrice : snap.close;
        // A newer REST lastTrade may briefly outrun the completed A.* second aggregate. Do not
        // leave the older tick OHLC attached to the newer `last`: the client prioritises tick*
        // when shaping a candle, so that mismatch would visibly move backwards until the next A.
        if (rtPrice != null && snap.printMs != null && snap.printMs > Number(q.tickEndMs || 0)) {
          delete fresh.tickOpen; delete fresh.tickHigh; delete fresh.tickLow; delete fresh.tickClose;
          delete fresh.tickVol; delete fresh.tickStartMs; delete fresh.tickEndMs;
        }
        if (snap.open != null) fresh.open = snap.open;
        if (snap.high != null) fresh.high = snap.high;
        if (snap.low != null) fresh.low = snap.low;
        if (snap.vol != null) fresh.vol = snap.vol;
        if (snap.prevClose != null) fresh.prevClose = snap.prevClose;
        // ONE chg formula. With a real-time last trade the vendor's day-close percentage is
        // already a bar behind, so recompute against the price we are actually publishing.
        if (rtPrice != null && snap.prevClose != null && snap.prevClose > 0) {
          fresh.chg = ((rtPrice - snap.prevClose) / snap.prevClose) * 100;
        } else if (snap.chg != null) {
          fresh.chg = snap.chg;
        }
        // `close` means "today's OFFICIAL close" — only true once the bell has rung.
        // During RTH day.c is merely the latest print, so it stays in `last` alone.
        const session = classifySession(now);
        if (session === "post" || session === "overnight") fresh.close = snap.close;
        else delete fresh.close;
        // Today's session is in hand; the previous session's move is no longer the answer.
        delete fresh.prevSessionChg;
        fresh.regularSessionDate = snap.date;
        fresh.regularSession = "rth";
        fresh.marketSession = session;
        fresh.ts = rtPrice != null ? printTs : snap.ts;
        // The label is the MEASUREMENT's output, never the config's. `lagMs` rides along in both
        // tiers so the UI can print the number it was graded on instead of a bare adjective.
        if (rtPrice != null) {
          fresh.live = true;
          fresh.source = "polygon-snapshot-rt";
          fresh.basis = "REALTIME";
        } else {
          fresh.live = false;
          fresh.source = "polygon-snapshot";
          fresh.basis = "DELAYED_15M";
        }
        // `asOfMs` is the STATE (the instant of the print); `lagMs` is a stopwatch reading of it.
        // Both are published because they answer different questions — but only asOfMs is stable
        // between polls, which is what lets the client bail out of a re-render on a quiet symbol
        // and still render a correct age (see terminal/lib/feedFreshness.ts).
        if (snap.printMs != null) fresh.asOfMs = snap.printMs;
        else delete fresh.asOfMs;
        if (snap.lagMs != null) fresh.lagMs = snap.lagMs;
        else delete fresh.lagMs;
        fresh.anchor_source = "snapshot";
        delete fresh.stale_anchor;
        this.quotes.set(sym, fresh); // persist so /health + later reads agree
        out[sym] = fresh;
      }
    }

    // ── Ext fields: merge extPrice/extChg/extTs/extSession/extSource ──────────
    // Performed after the anchor re-derivation loop so we can use the settled
    // close value from the anchor (needed for extChg computation).
    // Only for US symbols; suppressed during RTH; no-op when extFeed is absent.
    if (extFeed) {
      // `now` is already bound above (line 150); reuse it instead of redeclaring.
      for (const sym of symList) {
        const q = out[sym];
        if (!q || q.market !== "us") continue;
        const officialClose = typeof q.close === "number" ? q.close : null;
        // After the bell, the delayed aggregate's current-session last is already the
        // regular close even when the daily file has not rolled yet. Use it so AH % is
        // measured FROM today's close, not from yesterday's close. Pre-market/overnight
        // still reference prevClose, which is the last completed regular session.
        const currentSessionLast =
          q.marketSession === "post" &&
          q.regularSessionDate != null && q.regularSessionDate === etDate(now) &&
          typeof q.last === "number" && Number.isFinite(q.last)
            ? q.last
            : null;
        const closeRef = officialClose != null
          ? officialClose
          : currentSessionLast != null
            ? currentSessionLast
            : (typeof q.prevClose === "number" ? q.prevClose : null);
        const ext = extFeed.getExt(sym, now, closeRef);
        if (ext) {
          // Shallow-copy so we don't mutate the persisted quote object.
          out[sym] = { ...q, ...ext };
        } else {
          // Remove any stale ext fields that may have been persisted previously.
          if (q.extPrice != null) {
            const copy = { ...q };
            delete copy.extPrice;
            delete copy.extChg;
            delete copy.extTs;
            delete copy.extSession;
            delete copy.extSource;
            delete copy.extBasis;
            out[sym] = copy;
          }
        }
      }
    }

    return out;
  }

  // Stat the manifest; on mtime change reparse and rebuild prevCloseBySym + syms.
  // Rate-limited to ≤1 stat per 30 s. Corrupt manifest → keep last-good, never throw.
  loadManifestIfStale(force) {
    const now = Date.now();
    if (!force && now - this.lastManifestCheck < MANIFEST_CHECK_MIN_INTERVAL) return;
    this.lastManifestCheck = now;

    let st;
    try {
      st = fs.statSync(this.manifestPath);
    } catch (e) {
      log.warn("manifest stat failed", this.manifestPath, e.message);
      return;
    }
    if (st.mtimeMs === this.manifest.mtimeMs) return;

    let raw;
    try {
      raw = fs.readFileSync(this.manifestPath, "utf8");
    } catch (e) {
      log.warn("manifest read failed", e.message);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      log.warn("manifest parse failed — keeping last-good map", e.message);
      return;
    }

    const symsObj = parsed && parsed.symbols;
    if (!symsObj || typeof symsObj !== "object") {
      log.warn("manifest missing symbols object — keeping last-good map");
      return;
    }

    const prevCloseBySym = new Map();
    const lastBySym = new Map();
    const syms = new Set();
    for (const sym of Object.keys(symsObj)) {
      syms.add(sym);
      const row = symsObj[sym];
      if (!row || typeof row !== "object") continue;
      const last = typeof row.last === "number" ? row.last : null;
      const chg = typeof row.chg === "number" ? row.chg : null;
      if (last == null) continue;
      lastBySym.set(sym, last);
      // Legacy US derivation: prevClose = last / (1 + chg/100).
      // Guard null chg or chg ≈ -100 (denominator ≈ 0) → prevClose = last (chg falls out as 0).
      if (chg == null || Math.abs(1 + chg / 100) < 1e-6) {
        prevCloseBySym.set(sym, last);
      } else {
        prevCloseBySym.set(sym, last / (1 + chg / 100));
      }
    }

    this.manifest = { mtimeMs: st.mtimeMs, prevCloseBySym, lastBySym, syms };
    log.info("manifest reloaded", `symbols=${syms.size}`, `mtime=${new Date(st.mtimeMs).toISOString()}`);
  }

  // Evict entries older than STALE_EVICT_MS that are NOT currently subscribed.
  pruneIdle(now) {
    const cutoff = Math.floor((now - STALE_EVICT_MS) / 1000);
    let evicted = 0;
    for (const [sym, q] of this.quotes) {
      if (this.subscribed.has(sym)) continue;
      if (typeof q.ts === "number" && q.ts < cutoff) {
        this.quotes.delete(sym);
        evicted++;
      }
    }
    if (evicted) log.info("pruneIdle evicted", evicted, "stale entries");
    return evicted;
  }
}

module.exports = { Store, STALE_EVICT_MS };
