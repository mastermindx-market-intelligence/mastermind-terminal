-- Mastermind Terminal — EXACT search-log aggregates, computed in the database
--
-- ============================== WHY THIS EXISTS ==============================
-- `lib/searchEvents.ts#searchStats` fetched the trailing 14 days into node and aggregated there,
-- under `STATS_FETCH_CAP = 20_000` with `order by id desc`. That cap is a latent correctness bug,
-- not a performance knob: once the window exceeds 20k rows the fetch keeps the NEWEST 20k, so the
-- OLDEST days of `perDay14d` silently decay toward zero while today stays right. The chart would
-- have shown a tidy, entirely fictional ramp — and nothing in the payload said so.
--
-- Raising the cap only moves the number at which it starts lying. The fix is to not move the data:
-- Postgres counts the rows where they live, over the WHOLE window, with no cap at all.
--
-- ========================= THE CONTRACT IS REPRODUCED EXACTLY =========================
-- This function returns the same five fields the JS path returns, computed the same way. The
-- definitions are subtle and were read off the implementation rather than guessed:
--
--   total         count of EVERY row, not just the window.
--   today         rows since UTC midnight. The JS compares `created_at.slice(0,10) >= <UTC date>`,
--                 which is a UTC-day comparison — NOT `now() - 24h`.
--   visitors7d    distinct identity over a ROLLING 7*24h window (`now() - 7 days`), not 7 calendar
--                 days. Identity precedence is `user_id || anon_id || ip || 'unknown'` — the same
--                 order as `visitorKey`, and the same collapsing of every identity-less row into a
--                 single 'unknown' bucket. Reproducing that quirk is deliberate: this function must
--                 agree with the JS fallback, and "fix the quirk" is a separate product ruling.
--   topSymbols7d  top 20 over that same rolling 7d window, ordered count DESC then symbol ASC —
--                 the alphabetical tie-break matters, an existing test asserts it.
--   perDay14d     14 UTC day buckets, oldest first, zero-filled, where bucket i is the UTC date of
--                 `now() - i days` for i in 13..0. Bucket 13 is today.
--
-- ============================== SECURITY ==============================
-- INVOKER, not DEFINER. `search_events` carries deny-all RLS (0003) and is read exclusively by the
-- service-role client, which bypasses RLS on its own. A SECURITY DEFINER function here would hand
-- every authenticated user a read-through onto the whole visitor log — precisely the leak the
-- deny-all policy exists to prevent. EXECUTE is revoked from anon/authenticated for the same
-- reason: the only caller is the admin plane's service client.
--
-- ============================== HOW IT GETS APPLIED ==============================
-- Out of band, by an operator — there is no migration runner in this estate and no
-- `supabase_migrations` ledger. See `supabase/migrations/README.md`.
--
-- APPLIED to production 2026-08-21, on operator instruction. Verified at the time:
--   * `prosecdef = false`             — INVOKER, as intended (a DEFINER here would hand every
--                                       signed-in user a read-through onto the whole visitor log);
--   * `has_function_privilege`        — anon false, authenticated false, service_role true;
--   * through PostgREST, which is how the app actually calls it — 200 with the service key,
--     `401 42501 permission denied for function search_event_stats` with the anon key;
--   * output cross-checked against an INDEPENDENT SQL formulation of the same three aggregates:
--     total 686 = 686, today 10 = 10, visitors7d 1 = 1.
-- PostgREST's schema cache picked the function up immediately, so the exact path went live with
-- the next deploy and the fallback below is now insurance rather than the working route.
--
-- The application does NOT require this to be applied. `searchStats` calls the RPC and falls back
-- to the capped in-process path when PostgREST answers PGRST202 ("function not found"), so BOTH
-- deploy orders are safe. What it will not do is call the fallback exact: when the fallback runs
-- AND the window actually hit the cap, the payload carries `partial: true` and the console labels
-- the numbers as approximate. Exactness is claimed only when it is true.
--
-- Idempotent: `create or replace`, and the grants are absolute rather than incremental.
-- =====================================================================================

create or replace function public.search_event_stats()
returns json
language sql
stable
as $$
  with bounds as (
    select
      now()                                                as now_ts,
      now() - interval '7 days'                            as since7,
      now() - interval '14 days'                           as since14,
      date_trunc('day', now() at time zone 'utc')          as today_start_utc
  ),
  -- The 14-day window, with identity resolved once under the JS precedence.
  win as (
    select
      e.created_at,
      e.symbol,
      coalesce(nullif(e.user_id::text, ''), nullif(e.anon_id, ''), nullif(e.ip, ''), 'unknown') as visitor
    from public.search_events e, bounds b
    where e.created_at >= b.since14
  ),
  last7 as (
    select * from win, bounds b where win.created_at >= b.since7
  ),
  -- 14 UTC day buckets, oldest first. Generated independently of the data so empty days are
  -- present as zeros rather than missing keys.
  days as (
    select (b.today_start_utc - make_interval(days => i))::date as day
    from bounds b, generate_series(13, 0, -1) as i
  ),
  per_day as (
    select d.day, count(w.*) as count
    from days d
    left join win w on (w.created_at at time zone 'utc')::date = d.day
    group by d.day
    order by d.day
  ),
  top_syms as (
    select symbol, count(*) as count
    from last7
    group by symbol
    order by count(*) desc, symbol asc
    limit 20
  )
  select json_build_object(
    'total',       (select count(*) from public.search_events),
    'today',       (select count(*) from public.search_events e, bounds b
                     where e.created_at >= b.today_start_utc at time zone 'utc'),
    'visitors7d',  (select count(distinct visitor) from last7),
    'topSymbols7d',(select coalesce(json_agg(json_build_object('symbol', symbol, 'count', count)), '[]'::json)
                     from top_syms),
    'perDay14d',   (select coalesce(json_agg(json_build_object('day', to_char(day, 'YYYY-MM-DD'), 'count', count)), '[]'::json)
                     from per_day)
  );
$$;

-- Only the admin plane's service client may call this. `public` gets EXECUTE on a new function by
-- default, which would expose the visitor log to every signed-in user.
revoke all on function public.search_event_stats() from public;
revoke all on function public.search_event_stats() from anon;
revoke all on function public.search_event_stats() from authenticated;
grant execute on function public.search_event_stats() to service_role;

-- The window predicate every branch of the function filters on.
create index if not exists search_events_created_at on public.search_events (created_at desc);
