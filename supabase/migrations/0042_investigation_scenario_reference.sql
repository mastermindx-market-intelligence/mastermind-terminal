-- Ledger row: MO-PAID-052 / packet b-f12-scenario-canonical-reference-repair-01a128b7-20261023-v1
-- (typed saved scenario, INPUT/REFERENCE-ONLY canonical persistence + explicit sharing); worker
-- artifact scenario_capture_migration.sql. The numeric prefix is NOT claimed here: the parent
-- assigns the real prefix after its current reservation check and installs the file under
-- supabase/migrations/ with its numbered name. UNAPPLIED at authoring; no PR number is claimed.
-- Rollback: guidance only, at the foot of this file. Nothing in it deletes grant rows,
-- revision history or any stored reference: include_scenario, its constraint and the pure
-- reference validator survive the emergency down, and every replaced function body is restored
-- to verified exact installed bodies/policy from qualified 0041/0040 source, using targeted
-- statements and the ORIGINAL operation receipt. Never blindly replay either migration file.
-- Prerequisites: 0021, 0028, 0040 and 0041 (this file replaces bodies those files installed
-- and extends the resource_grants shape 0041 defined).
--
-- The repair in one paragraph: the superseded full-value capture draft stored a scenario
-- basis and its computed result and re-derived the arithmetic in SQL. That contract is wrong
-- for a generic canonical surface -- derived Options values are protected source data, and a
-- grant/digest/historical-owner entitlement can never confer on a current recipient the right
-- to hold or re-open them through generic Investigation rows or RPCs. This file persists a
-- REFERENCE instead: an optional typed manifest field `scenario_capture`, admitted ONLY on
-- investigation_manifest.v2, holding exactly
--   {schema:'investigation_scenario_reference.v1', model_version:'exposure-scenario/v1',
--    inputs:{targetSpot,deltaSigmaPts,days},
--    source:{owner,root,session,source_as_of,evaluated_at,lens,selection_key,
--            basis_sha256,gex:{sha256,byte_length},moves:null|{sha256,byte_length}}}
-- -- value-free input and source-pointer metadata at closed key sets, with no basis, no
-- result, no derived summary, no storage key and no qualification claim anywhere in the shape.
-- The single new SQL function is a strict PURE STRUCTURAL validator: it checks JSON types,
-- closed key sets, real calendars, zone-bearing clocks and their order, canonical selection
-- bounds, digest/byte-length bounds and nothing else. It performs no arithmetic on any source
-- quantity, retrieves no protected source bytes, and proves nothing it cannot prove: parser
-- acceptance is NOT a retention receipt, NOT a private-destination claim, NOT a current action
-- authority, NOT a native qualification, and NOT a source-availability or entitlement claim.
-- Actual source resolution must refuse `unavailable` until a true qualified backend and
-- private destination exist; that refusal lives with the native owner, not in this file.
-- Value-free input/reference metadata can be owned, pinned and shared under the existing
-- per-grant controls below; it is metadata/reference, never an exact-scenario full reopen.
--
-- Everything else is the installed 0041 surface, preserved: the additive
-- resource_grants.include_scenario flag (NOT NULL DEFAULT false, immutable for the life of the
-- row, true only on investigation rows), the amended INSERT policy that admits a
-- scenario-flagged insert only over an owned pinned reference-bearing revision, the scenario
-- create RPC with same-pin/same-mode convergence and opposite-flag conflict, terminal
-- revocation, removed-source restore honesty, the fixed value-free DTO, and the unchanged
-- list cursors, bounds and pagination. Old question-only pins never gain the flag; no mode is
-- ever upgraded in place. valid_investigation_manifest_v2 keeps the exact installed 0040 body
-- with exactly two touch points: the closed optional-key array gains 'scenario_capture', and
-- a v2 manifest bearing the key must pass the pure reference validator (a v1 manifest bearing
-- it is refused). Every prior semantic -- review, options, thesis, evidence, subjects, sizes,
-- search_path, owner -- is preserved verbatim.
--
-- This file defines functions with dollar-quoted bodies containing semicolons (the 0006-style
-- warning restated by 0014, 0021 and 0041): do NOT push it through the naive
-- split-on-semicolon Management API endpoint.
--
-- Re-runnable source. Apply this file explicitly, never the entire migration directory.
-- Applying is a separate privileged act performed by the parent; the `-- readback:` block at
-- the foot of this file is posted as a receipt before any application table is updated. The
-- begin/commit pair below is script hygiene for that future manual act; it is not, and does
-- not claim to be, an authorization to apply, an atomicity guarantee of any helper, or an
-- effect of any kind.

begin;

-- ------------------------------------------------------------
-- 1. The pure reference validator (no table, constraint, grant or row change).
-- ------------------------------------------------------------

-- valid_investigation_scenario_reference_v1: the pure, immutable STRUCTURAL validator for the
-- frozen typed scenario reference. It admits exactly the closed shape documented in the file
-- header and refuses everything else -- unknown keys at any level, missing keys (including
-- keys that are nullable but must be present: source_as_of and moves), wrong JSON types
-- (booleans are never numbers, strings are never coerced to numbers), impossible calendar
-- dates, naive (zone-less) clocks, out-of-order clocks, non-canonical or out-of-bound
-- selections, malformed digests and out-of-bound byte lengths.
--
-- What it deliberately does NOT do: no arithmetic on any source quantity (the only numeric
-- work is domain/bound checking of the caller's own declared inputs and metadata), no reading
-- of any table, no clock, no I/O, no normalization (every string, including both clocks, is
-- retained exactly as stored; an unknown source clock stays an explicit null and is never
-- fabricated into a date), and no proof of retention, destination, authority or availability.
-- Numeric bounds mirror the native engine's declared input domain: targetSpot > 0,
-- deltaSigmaPts in [-5,5], days in [0,5], with jsonb numbers cast to float8 inside the guarded
-- block so a token that is not a finite double is refused rather than rounded; the stored
-- tokens themselves are never rewritten. The relative-spot bound needs the protected exact
-- basis and therefore remains native resolution validation -- it is never guessed here.
-- Byte bounds are explicit defensive contract caps: 8 MiB for the gex digest referent and
-- 1 MiB for moves; selection is capped at 128 canonical expiry|economic_expiry_at pairs and
-- 16 KiB (the pair grammar alone bounds a maximal selection well under that cap; both bounds
-- are enforced as independent defense in depth), and the whole capture is capped at 20 KiB,
-- which every grammatically valid capture fits with wide headroom.
-- Clock order is checked without guessing any timezone normalization: evaluated_at must be
-- zone-bearing and cannot precede the source session on the written local calendar date; a
-- known date-form source_as_of cannot be future to that written evaluation date; two zoned
-- clocks additionally compare as exact instants; every selection expiry cannot precede the
-- session. The NY-calendar-date equality between an expiry and its economic_expiry_at is a
-- native read convention that needs real timezone normalization -- it is owned by the native
-- read, never guessed here. An unknown source clock stays an explicit null.
-- ACL note: like the 0028 manifest validators, direct EXECUTE is revoked from PUBLIC, anon,
-- authenticated and service_role in the ACL block below. Every evaluation rides the existing
-- definer chain -- the 0028 apply RPC, the ownership helpers and the read RPC, all security
-- definer running as the function owner -- so no caller-facing privilege is created and no
-- existing private helper's ACL is touched or broadened.
create or replace function public.valid_investigation_scenario_reference_v1(c jsonb)
 returns boolean
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  source jsonb; inputs jsonb; lens jsonb; gex jsonb; moves jsonb;
  source_as_of text; session text; evaluated_at text; kind text;
  selection text; pairs text[]; seg text[]; pair text;
  expiry_text text; econ_text text; expiry_date date; econ_at timestamptz; evaluated_date date;
  prev_pair text; lens_exp date; found_selected boolean;
  clock_text text; clock_parts text[]; clock_index integer;
  clock_instant numeric; source_instant numeric; evaluated_instant numeric; clock_offset numeric;
  target_spot float8; delta_sigma float8; days float8; bl numeric;
  n integer;
begin
  if c is null or jsonb_typeof(c) <> 'object' or octet_length(c::text) > 20480
     or not public.investigation_keys_v2(c, array['schema','model_version','inputs','source'], '{}')
     or c#>>'{schema}' <> 'investigation_scenario_reference.v1'
     or c#>>'{model_version}' <> 'exposure-scenario/v1' then return false; end if;
  -- inputs: the exact frozen ScenarioInputs key set; finite exact JSON numbers (a jsonb number
  -- is never NaN/Infinity, a boolean is never a number, and a float8 overflow or an
  -- underflow-to-zero positive bound is refused in the guarded block), never coerced, never
  -- arithmetically normalized.
  inputs := c->'inputs';
  if jsonb_typeof(inputs) <> 'object'
     or not public.investigation_keys_v2(inputs, array['targetSpot','deltaSigmaPts','days'], '{}')
     or jsonb_typeof(inputs->'targetSpot') <> 'number'
     or jsonb_typeof(inputs->'deltaSigmaPts') <> 'number'
     or jsonb_typeof(inputs->'days') <> 'number' then return false; end if;
  target_spot := (inputs#>>'{targetSpot}')::float8;
  delta_sigma := (inputs#>>'{deltaSigmaPts}')::float8;
  days := (inputs#>>'{days}')::float8;
  if not target_spot > 0.0 or delta_sigma < -5.0 or delta_sigma > 5.0
     or days < 0.0 or days > 5.0 then return false; end if;
  -- source: the exact closed key set. source_as_of and moves are nullable but MUST be
  -- present -- they ride the optional list only because the house keys helper refuses a
  -- REQUIRED key whose value is jsonb null -- and their presence and type are checked here.
  source := c->'source';
  if jsonb_typeof(source) <> 'object'
     or not public.investigation_keys_v2(source,
          array['owner','root','session','evaluated_at','lens','selection_key','basis_sha256','gex'],
          array['source_as_of','moves']) then return false; end if;
  if source#>>'{owner}' <> 'options_hub' then return false; end if;
  -- Exact existing flowRoot.ts native alphabet and 12-character limit, without normalization.
  -- This is structural identity validation; it confers no source access or rights.
  if not public.investigation_text_v2(source->'root', 128, true)
     or char_length(source#>>'{root}') > 12
     or source#>>'{root}' !~ '^[A-Z0-9]{1,10}([.-][A-Z0-9]{1,4})?$' then return false; end if;
  -- session: a real calendar date, retained exactly.
  if jsonb_typeof(source->'session') <> 'string' then return false; end if;
  session := source#>>'{session}';
  if session !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or to_char(session::date,'YYYY-MM-DD') <> session then return false; end if;
  -- source_as_of: an explicit null (an unknown source clock is retained, never fabricated into
  -- a date and never a current-quote claim), a real calendar date, or a zone-bearing
  -- ISO-8601 datetime -- present but nullable, retained unnormalized.
  if jsonb_typeof(source->'source_as_of') is distinct from 'string'
     and jsonb_typeof(source->'source_as_of') is distinct from 'null' then return false; end if;
  if jsonb_typeof(source->'source_as_of') = 'string' then
    source_as_of := source#>>'{source_as_of}';
    if source_as_of ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      if to_char(source_as_of::date,'YYYY-MM-DD') <> source_as_of then return false; end if;
    elsif source_as_of ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,9})?([Zz]|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then
      null; -- exact calendar/offset/nanosecond check below, without timestamptz rounding
    else
      return false;
    end if;
  end if;
  -- evaluated_at: required and zone-bearing; the capture clock, retained exactly. A captured
  -- dynamic lens is a snapshot of the moment it was evaluated and is never re-evaluated
  -- against a current clock by anything in this file.
  if jsonb_typeof(source->'evaluated_at') <> 'string' then return false; end if;
  evaluated_at := source#>>'{evaluated_at}';
  if evaluated_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,9})?([Zz]|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then
    return false;
  end if;
  -- Compare declared instants at the wire's full nine-digit precision. PostgreSQL's
  -- timestamptz rounds to microseconds and rejects otherwise valid RFC3339 offsets >15:59;
  -- neither behavior may silently change this shared reference contract. No stored token is
  -- rewritten: UTC seconds and fractional seconds exist only for validation here.
  for clock_index in 1..2 loop
    clock_text := case when clock_index = 1 then evaluated_at else source_as_of end;
    if clock_text is null or clock_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then continue; end if;
    clock_parts := regexp_match(clock_text,
      '^([0-9]{4}-[0-9]{2}-[0-9]{2})[Tt]([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?([Zz]|([+-])([01][0-9]|2[0-3]):([0-5][0-9]))$');
    if clock_parts is null or to_char(clock_parts[1]::date,'YYYY-MM-DD') <> clock_parts[1] then return false; end if;
    clock_offset := case when clock_parts[7] is null then 0 else
      (clock_parts[8]::numeric * 3600 + clock_parts[9]::numeric * 60)
        * case when clock_parts[7] = '-' then -1 else 1 end end;
    clock_instant := extract(epoch from clock_parts[1]::date::timestamp)
      + clock_parts[2]::numeric * 3600 + clock_parts[3]::numeric * 60 + clock_parts[4]::numeric
      + coalesce(('0.' || clock_parts[5])::numeric,0) - clock_offset;
    if clock_index = 1 then evaluated_instant := clock_instant; else source_instant := clock_instant; end if;
  end loop;
  evaluated_date := (substring(evaluated_at from 1 for 10))::date;
  -- Evaluation order on the written local calendar date (never normalized): evaluation cannot
  -- precede the source session and a known source_as_of cannot be future to evaluation; two
  -- zoned clocks additionally compare as exact instants.
  if evaluated_date < session::date then return false; end if;
  if jsonb_typeof(source->'source_as_of') = 'string' then
    if source_as_of ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      if source_as_of::date > evaluated_date then return false; end if;
    else
      if source_instant > evaluated_instant then return false; end if;
    end if;
  end if;
  -- lens: exact kind all/zero/next-live/week with no extra key, or one plus a real expiry
  -- date that the canonical selection must actually select.
  lens := source->'lens';
  if jsonb_typeof(lens) <> 'object' then return false; end if;
  kind := lens#>>'{kind}';
  lens_exp := null;
  if kind = 'one' then
    if not public.investigation_keys_v2(lens, array['kind','exp'], '{}') then return false; end if;
    if lens#>>'{exp}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or to_char((lens#>>'{exp}')::date,'YYYY-MM-DD') <> lens#>>'{exp}' then return false; end if;
    lens_exp := (lens#>>'{exp}')::date;
  else
    if kind not in ('all','zero','next-live','week')
       or not public.investigation_keys_v2(lens, array['kind'], '{}') then return false; end if;
  end if;
  -- selection_key: the canonical native read.selectionKey form -- a nonempty, bounded,
  -- strictly ascending list of expiry|economic_expiry_at pairs joined by single commas, each
  -- expiry a real ISO date and each economic_expiry_at a zone-bearing ISO instant, every
  -- expiry not before the source session, no duplicate pair, and no arbitrary user URI or
  -- key material (the exact grammar admits nothing else). The expiry/economic grammar admits
  -- no comma and no pipe, so the split is unambiguous. NY-date equality between an expiry and
  -- its economic_expiry_at needs timezone normalization and stays native-owned, never guessed
  -- in SQL.
  if jsonb_typeof(source->'selection_key') <> 'string' then return false; end if;
  selection := source#>>'{selection_key}';
  if selection = '' or char_length(selection) > 16384 then return false; end if;
  pairs := string_to_array(selection, ',');
  n := coalesce(array_length(pairs, 1), 0);
  if n = 0 or n > 128 then return false; end if;
  prev_pair := null; found_selected := false;
  foreach pair in array pairs loop
    seg := string_to_array(pair, '|');
    if coalesce(array_length(seg, 1), 0) <> 2 then return false; end if;
    expiry_text := seg[1]; econ_text := seg[2];
    if expiry_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or to_char(expiry_text::date,'YYYY-MM-DD') <> expiry_text then return false; end if;
    expiry_date := expiry_text::date;
    if expiry_date < session::date then return false; end if;
    if econ_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,9})?([Zz]|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then
      return false;
    end if;
    if to_char(substring(econ_text from 1 for 10)::date,'YYYY-MM-DD') <> substring(econ_text from 1 for 10) then return false; end if;
    -- Native read.selectionKey sorts unique FULL strings, not normalized instants.
    if prev_pair is not null and (pair collate "C") <= (prev_pair collate "C") then return false; end if;
    prev_pair := pair;
    if lens_exp is not null then
      if expiry_date <> lens_exp then return false; end if;
      found_selected := true;
    end if;
    if kind = 'zero' and expiry_date <> session::date then return false; end if;
  end loop;
  if lens_exp is not null and not found_selected then return false; end if;
  -- basis_sha256: a digest ONLY. It names nothing stored here and proves no retention.
  if jsonb_typeof(source->'basis_sha256') <> 'string'
     or source#>>'{basis_sha256}' !~ '^[0-9a-f]{64}$' then return false; end if;
  -- gex: the exact digest referent descriptor; the hash refers exact retained native bytes
  -- held by the native owner, never bytes stored in this schema.
  gex := source->'gex';
  if jsonb_typeof(gex) <> 'object'
     or not public.investigation_keys_v2(gex, array['sha256','byte_length'], '{}')
     or jsonb_typeof(gex->'sha256') <> 'string' or gex#>>'{sha256}' !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(gex->'byte_length') <> 'number' then return false; end if;
  bl := (gex#>>'{byte_length}')::numeric;
  if bl is distinct from floor(bl) or bl < 1 or bl > 8388608 then return false; end if;
  -- moves: present but nullable; an explicit null is a retained truth, never a substitution
  -- and never a latest-version fallback.
  if jsonb_typeof(source->'moves') is distinct from 'object'
     and jsonb_typeof(source->'moves') is distinct from 'null' then return false; end if;
  if jsonb_typeof(source->'moves') = 'object' then
    moves := source->'moves';
    if not public.investigation_keys_v2(moves, array['sha256','byte_length'], '{}')
       or jsonb_typeof(moves->'sha256') <> 'string' or moves#>>'{sha256}' !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(moves->'byte_length') <> 'number' then return false; end if;
    bl := (moves#>>'{byte_length}')::numeric;
    if bl is distinct from floor(bl) or bl < 1 or bl > 1048576 then return false; end if;
  end if;
  return true;
exception when others then return false;
end $function$;

-- ------------------------------------------------------------
-- 2. valid_investigation_manifest_v2: the exact installed 0040 body with exactly two touch
-- points -- the optional-key array gains 'scenario_capture', and a manifest bearing the key
-- must be a v2 manifest whose reference passes the pure validator (a v1 manifest bearing it is
-- refused). Every prior semantic (review, options, thesis, evidence, subjects, sizes,
-- security, ACL, search_path, owner) is preserved verbatim; no old migration file is edited.
-- Signature, IMMUTABLE, owner and ACL survive create-or-replace.
-- ------------------------------------------------------------

create or replace function public.valid_investigation_manifest_v2(m jsonb)
 returns boolean
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'public'
as $function$
declare r jsonb; s jsonb; refs jsonb; k text; n integer; seen jsonb:='[]'; identity jsonb;
begin
 if not public.investigation_keys_v2(m,array['schema','intent','layout_refs','thesis_refs','evidence_refs','continuation'],array['review_baseline_ref','review','scenario_capture'])
 or m->>'schema'<>'investigation_manifest.v2' or octet_length(public.investigation_json_v2(m))>131072
 or not public.investigation_keys_v2(m->'intent',array['title','question','subjects'],array['horizon','research_as_of'])
 or not public.investigation_text_v2(m#>'{intent,title}',160,true)
 or not public.investigation_text_v2(m#>'{intent,question}',4000)
 or not public.investigation_keys_v2(m->'continuation','{}',array['next_question','next_observation']) then return false; end if;
 if m->'intent' ? 'horizon' and not public.investigation_text_v2(m#>'{intent,horizon}',64,true) then return false; end if;
 if m->'intent' ? 'research_as_of' then
   if jsonb_typeof(m#>'{intent,research_as_of}')<>'string' or (m#>>'{intent,research_as_of}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or to_char((m#>>'{intent,research_as_of}')::date,'YYYY-MM-DD')<>m#>>'{intent,research_as_of}' then return false; end if;
 end if;
 foreach k in array array['next_question','next_observation'] loop
  if m->'continuation' ? k and not public.investigation_text_v2(m->'continuation'->k,4000) then return false; end if;
 end loop;
 if m ? 'review' then
  if jsonb_typeof(m->'review')<>'object'
   or not public.investigation_keys_v2(m->'review',array['assessment'],array['fire_event_id','note'])
   or (m#>>'{review,assessment}') not in ('confirmed','contradicted','inconclusive')
   or (m->'review' ? 'fire_event_id' and (jsonb_typeof(m#>'{review,fire_event_id}')<>'string' or (m#>>'{review,fire_event_id}') !~ '^[0-9a-f]{64}$'))
   or (m->'review' ? 'note' and not public.investigation_text_v2(m#>'{review,note}',2000)) then return false; end if;
 end if;
 -- Only a v2 manifest may carry the typed scenario reference, and only when the pure
 -- reference validator admits it (the Terminal/Python pairing pins the same rule). The
 -- reference is unresolved input metadata: this proves structure only -- never retention,
 -- private destination, entitlement, current action authority or source availability -- and
 -- no path in this file retrieves protected source bytes or computes any result.
 if m ? 'scenario_capture' then
  if m->>'schema'<>'investigation_manifest.v2' or not public.valid_investigation_scenario_reference_v1(m->'scenario_capture') then return false; end if;
 end if;
 if jsonb_typeof(m#>'{intent,subjects}')<>'array' or jsonb_array_length(m#>'{intent,subjects}')>16 then return false; end if;
 for r in select value from jsonb_array_elements(m#>'{intent,subjects}') loop
  if not public.investigation_keys_v2(r,array['kind','owner','object_id'],array['version_ref'])
   or not public.investigation_text_v2(r->'object_id',256,true)
   or not ((r->>'owner'='terminal.analysis_symbol' and r->>'kind'='security') or (r->>'owner'='data_os.security_master' and r->>'kind' in ('security','issuer')))
   or (r ? 'version_ref' and not public.investigation_text_v2(r->'version_ref',256,true)) then return false; end if;
  identity:=jsonb_build_array(r->'owner',r->'kind',r->'object_id',r->'version_ref');
  if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
 end loop;
 n:=0;
 foreach k in array array['layout_refs','thesis_refs','evidence_refs'] loop
  if jsonb_typeof(m->k)<>'array' then return false; end if;
  n:=n+jsonb_array_length(m->k);
 end loop;
 if n>128 or jsonb_array_length(m->'layout_refs')>4 or jsonb_array_length(m->'thesis_refs')>16 then return false; end if;
 seen:='[]';
 for r in select value from jsonb_array_elements(m->'layout_refs') loop
  if not public.investigation_keys_v2(r,array['layout_id','layout_revision_id','digest','role'])
  or (r->>'layout_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or (r->>'layout_revision_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or (r->>'digest') !~ '^[0-9a-f]{64}$' or r->>'role' not in ('primary','supporting') then return false; end if;
  identity:=jsonb_build_array(r->'layout_id',r->'layout_revision_id');
  if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
 end loop;
 -- Only canonical, immutable Thesis version references belong in this manifest.
 seen:='[]';
 for r in select value from jsonb_array_elements(m->'thesis_refs') loop
  if not public.investigation_keys_v2(r,array['thesis_id','version_id','role'])
   or jsonb_typeof(r->'thesis_id')<>'string' or jsonb_typeof(r->'version_id')<>'string' or jsonb_typeof(r->'role')<>'string'
   or (r->>'thesis_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or (r->>'version_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or r->>'role' not in ('primary','alternative','context') then return false; end if;
  identity:=jsonb_build_array(r->'thesis_id',r->'version_id');
  if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if;
  seen:=seen||jsonb_build_array(identity);
 end loop;
 refs:=m->'evidence_refs';
 if m ? 'review_baseline_ref' then
  if m#>>'{review_baseline_ref,mode}' is distinct from 'pinned' then return false; end if;
  refs:=refs||jsonb_build_array(m->'review_baseline_ref');
 end if;
 seen:='[]';
 n:=0;
 for r in select value from jsonb_array_elements(refs) loop
  if not public.investigation_keys_v2(r,array['owner','object_type','object_id','mode'],array['version_ref','fingerprint','selection'])
  or not ((r->>'owner'='earnings.workspace_generation' and r->>'object_type'='event_workspace')
          or (r->>'owner'='terminal.options_exposure' and r->>'object_type' in ('exposure_chart_request','sector_origin','rotation_measurement')))
  or not public.investigation_text_v2(r->'object_id',256,true) or r->>'mode' not in ('pinned','follow_head')
  or (r->>'mode'='pinned' and not public.investigation_text_v2(r->'version_ref',256,true))
  or (r->>'mode'='follow_head' and (r ? 'version_ref' or r ? 'fingerprint'))
  or (r ? 'fingerprint' and (jsonb_typeof(r->'fingerprint')<>'string' or r->>'fingerprint' !~ '^[0-9a-f]{64}$'))
  or (r ? 'selection' and (not public.investigation_keys_v2(r->'selection',array['field']) or jsonb_typeof(r#>'{selection,field}')<>'string' or r#>>'{selection,field}' !~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$')) then return false; end if;
  n:=n+1;
  identity:=jsonb_build_array(r->'owner',r->'object_type',r->'object_id',r->'mode',r->'version_ref',r#>'{selection,field}');
  if n<=jsonb_array_length(m->'evidence_refs') then
   if exists(select 1 from jsonb_array_elements(seen) prior(value) where prior.value=identity) then return false; end if; seen:=seen||jsonb_build_array(identity);
  end if;
 end loop;
 return true;
exception when others then return false;
end $function$;

-- ------------------------------------------------------------
-- 3. resource_grants.include_scenario: the opt-in flag, its kind constraint, and the
-- extended guard.
-- ------------------------------------------------------------

-- The opt-in flag. NOT NULL DEFAULT false, so every pre-existing row and every insert that
-- does not name it (all 0021 watchlist inserts, the plain create) keeps the exact shape it had
-- before this file. Adding the column grants nothing: the table-level UPDATE grant stays
-- exactly 0021's revoked_at-only column list, and the guard below makes the flag immutable for
-- the life of the row.
alter table public.resource_grants add column if not exists include_scenario boolean not null default false;

comment on column public.resource_grants.include_scenario is
  'False (the default, and every pre-existing row) for the exact 0041 share shapes. True marks
  an investigation grant that additionally carries the pinned revision''s typed scenario
  REFERENCE: lists project scenario_included:true on such rows and the read RPC returns the
  stored reference after the pure validator re-checks its structure. A reference is unresolved
  input metadata -- owner-qualified pointers, digests, byte lengths and captured clocks; never
  a basis or result value, never a retention, entitlement, private-destination or
  source-availability claim. Immutable for the life of the row (guard trigger), only ever true
  alongside resource_kind = ''investigation'' (check constraint), and insertable only when the
  pinned revision is an active owned v2 manifest bearing a structurally valid reference
  (INSERT policy).';

-- include_scenario=true is admitted only on investigation rows; watchlist rows keep the 0021
-- shape exactly. Replay-safe like every other statement in this file.
do $$ begin
  alter table public.resource_grants
    add constraint resource_grants_scenario_matches_kind
    check (include_scenario = false or resource_kind = 'investigation');
exception when duplicate_object then null; end $$;

-- The 0041 guard already made revocation terminal and every immutable field immutable; the
-- same function body is extended with exactly one condition so a live grant cannot be silently
-- re-pointed onto (or off) the scenario projection. All original checks, messages and errcodes
-- are preserved verbatim. The prerequisite 0021 trigger remains unchanged; replacing the
-- function updates the trigger's guard in place.
create or replace function public.resource_grants_guard() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a withdrawn share cannot be changed' using errcode = '42501';
  end if;
  if new.resource_kind is distinct from old.resource_kind
     or new.resource_id is distinct from old.resource_id
     or new.resource_revision is distinct from old.resource_revision
     or new.grantee_user_id is distinct from old.grantee_user_id
     or new.granted_by is distinct from old.granted_by
     or new.created_at is distinct from old.created_at
     or new.include_scenario is distinct from old.include_scenario then
    raise exception 'a share record cannot be re-pointed' using errcode = '42501';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------
-- 4. The scenario ownership helper and the scenario create RPC.
-- ------------------------------------------------------------

-- The scenario mirror of owns_active_investigation_revision. The name is retained for the
-- consumer contract, but read it truthfully: it checks that the pinned revision is an active
-- owned v2 manifest bearing a STRUCTURALLY VALID REFERENCE and nothing more. It does not --
-- and cannot -- qualify the source: no retention proof, no private destination, no current
-- action authority, no native qualification, and no entitlement beyond the owner's own pin.
-- Definer with a fixed empty search_path and every reference schema-qualified, reading the
-- Investigation tables directly so the resource_grants policy never re-enters resource_grants
-- RLS (the 0041 recursion-shape, one join deeper).
create or replace function public.owns_scenario_bearing_revision(p_investigation uuid, p_revision integer)
returns boolean
  language sql stable security definer set search_path = ''
  as $$
  select exists (
    select 1
      from public.investigations h
      join public.investigation_revisions r
        on r.investigation_id = h.id and r.user_id = h.user_id and r.revision = p_revision
     where h.id = p_investigation
       and h.user_id = auth.uid()
       and h.lifecycle = 'active'
       and r.lifecycle = 'active'
       and r.manifest->>'schema' = 'investigation_manifest.v2'
       and r.manifest ? 'scenario_capture'
       and public.valid_investigation_scenario_reference_v1(r.manifest->'scenario_capture'))
$$;

-- The scenario handoff create: the 0041 create contract with one projection difference. Same
-- actor/grantee/active-head/active-pinned-revision checks, same bare not_found convergence for
-- an absent grantee, aggregate or revision, the SAME advisory lock (a plain create and a
-- scenario create of one aggregate serialize, so one projection loses explicitly rather than
-- racing), same share_conflict for a different live revision. A same-pin live grant converges
-- ONLY when it is also include_scenario=true: a live plain pin of the same revision is a
-- different projection and therefore a conflict -- explicit owner revoke, then a new grant,
-- never an UPDATE upgrade in either direction. No new operation id, no retry protocol.
create or replace function public.create_investigation_scenario_handoff_v1(
  p_id uuid, p_revision integer, p_grantee uuid
) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  actor uuid := auth.uid();
  head record;
  pinned record;
  live record;
  grant_id uuid;
  shared_at timestamptz;
begin
  if actor is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;
  if p_id is null or p_revision is null or p_grantee is null
     or p_revision < 1 or p_grantee = actor then
    return jsonb_build_object('status', 'invalid_payload');
  end if;
  -- An absent grantee account is indistinguishable from an absent aggregate: both are a bare
  -- not_found, so a share attempt discloses nothing about either side.
  if not exists (select 1 from auth.users u where u.id = p_grantee) then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- Serialize this owner's shares of this aggregate on the SAME lock the plain create holds,
  -- so convergence reads the winner of any concurrent share instead of racing a duplicate
  -- past 0021's live unique index.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('resource_grants.investigation:' || actor::text || ':' || p_id::text, 0));
  select * into head from public.investigations h where h.id = p_id for share;
  if not found or head.user_id <> actor or head.lifecycle <> 'active' then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into pinned from public.investigation_revisions r
   where r.investigation_id = p_id and r.user_id = head.user_id and r.revision = p_revision;
  if not found or pinned.lifecycle <> 'active' then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- SECURITY DEFINER bypasses table INSERT RLS: enforce the SAME pinned
  -- v2/reference invariant here, under the existing owner/aggregate lock,
  -- before either convergence or INSERT. Plain/invalid pins disclose only not_found.
  if pinned.manifest->>'schema' is distinct from 'investigation_manifest.v2'
     or not (pinned.manifest ? 'scenario_capture')
     or public.valid_investigation_scenario_reference_v1(pinned.manifest->'scenario_capture') is not true then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into live from public.resource_grants g
   where g.resource_kind = 'investigation'
     and g.resource_id = p_id
     and g.grantee_user_id = p_grantee
     and g.revoked_at is null;
  if found then
    if live.resource_revision = p_revision and live.include_scenario then
      return jsonb_build_object('status', 'already_shared', 'handoff',
        public.investigation_handoff_summary_v1(live.id, live.resource_id, live.resource_revision,
          live.granted_by, live.grantee_user_id, live.created_at, pinned.manifest)
        || jsonb_build_object('scenario_included', true));
    end if;
    -- A different revision, or the same revision pinned as a plain share, is a conflict,
    -- never a silent repoint or a silent downgrade.
    return jsonb_build_object('status', 'share_conflict');
  end if;
  -- Every fallible validation above precedes the single INSERT; the advisory lock held since
  -- the head read rules out a duplicate-live race, and any remaining storage failure rolls the
  -- whole statement back and surfaces as a bare unavailable.
  insert into public.resource_grants
    (resource_kind, resource_id, resource_revision, include_scenario, grantee_user_id, granted_by)
    values ('investigation', p_id, p_revision, true, p_grantee, actor)
    returning id, created_at into grant_id, shared_at;
  return jsonb_build_object('status', 'created', 'handoff',
    public.investigation_handoff_summary_v1(grant_id, p_id, p_revision,
      actor, p_grantee, shared_at, pinned.manifest)
    || jsonb_build_object('scenario_included', true));
exception
  when others then
    return jsonb_build_object('status', 'unavailable');
end $$;

-- ------------------------------------------------------------
-- 5. The plain create: minimally amended so a live include_scenario=true pin is a conflict
-- instead of a silently returned (or silently downgraded) already_shared.
-- ------------------------------------------------------------

create or replace function public.create_investigation_handoff_v1(
  p_id uuid, p_revision integer, p_grantee uuid
) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  actor uuid := auth.uid();
  head record;
  pinned record;
  live record;
  grant_id uuid;
  shared_at timestamptz;
begin
  if actor is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;
  if p_id is null or p_revision is null or p_grantee is null
     or p_revision < 1 or p_grantee = actor then
    return jsonb_build_object('status', 'invalid_payload');
  end if;
  -- An absent grantee account is indistinguishable from an absent aggregate: both are a bare
  -- not_found, so a share attempt discloses nothing about either side.
  if not exists (select 1 from auth.users u where u.id = p_grantee) then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- Serialize this owner's shares of this aggregate so convergence reads the winner of any
  -- concurrent share instead of racing a duplicate past 0021's live unique index.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('resource_grants.investigation:' || actor::text || ':' || p_id::text, 0));
  select * into head from public.investigations h where h.id = p_id for share;
  if not found or head.user_id <> actor or head.lifecycle <> 'active' then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into pinned from public.investigation_revisions r
   where r.investigation_id = p_id and r.user_id = head.user_id and r.revision = p_revision;
  if not found or pinned.lifecycle <> 'active' then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into live from public.resource_grants g
   where g.resource_kind = 'investigation'
     and g.resource_id = p_id
     and g.grantee_user_id = p_grantee
     and g.revoked_at is null;
  if found then
  -- A live include_scenario=true pin is a different projection of the same pin: it is
  -- never silently returned (or silently downgraded) here -- the scenario create is the
  -- exact mirror that converges it. Revoke explicitly, then share the other projection.
    if live.resource_revision = p_revision and not live.include_scenario then
      return jsonb_build_object('status', 'already_shared', 'handoff',
        public.investigation_handoff_summary_v1(live.id, live.resource_id, live.resource_revision,
          live.granted_by, live.grantee_user_id, live.created_at, pinned.manifest));
    end if;
    -- A different live revision is a conflict, never a silent repoint: the owner must revoke
    -- the existing pin explicitly first.
    return jsonb_build_object('status', 'share_conflict');
  end if;
  -- Every fallible validation above precedes the single INSERT; the advisory lock held since
  -- the head read rules out a duplicate-live race, and any remaining storage failure rolls the
  -- whole statement back and surfaces as a bare unavailable.
  insert into public.resource_grants
    (resource_kind, resource_id, resource_revision, grantee_user_id, granted_by)
    values ('investigation', p_id, p_revision, p_grantee, actor)
    returning id, created_at into grant_id, shared_at;
  return jsonb_build_object('status', 'created', 'handoff',
    public.investigation_handoff_summary_v1(grant_id, p_id, p_revision,
      actor, p_grantee, shared_at, pinned.manifest));
exception
  when others then
    return jsonb_build_object('status', 'unavailable');
end $$;

-- ------------------------------------------------------------
-- 6. The list RPC: only the two summary projections change (the conditional
-- scenario_included flag). Own inventory, bounds, keyset order, cursors and every other
-- line are the installed 0041 body.
-- ------------------------------------------------------------

create or replace function public.list_investigation_handoffs_v1(
  p_sent_after uuid default null,
  p_received_after uuid default null
)
returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  actor uuid := auth.uid();
  own jsonb;
  sent jsonb;
  received jsonb;
  sent_ids uuid[];
  received_ids uuid[];
  sent_cursor uuid;
  received_cursor uuid;
begin
  if actor is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;
  select coalesce(jsonb_agg(x.item order by x.updated_at desc, x.id), '[]'::jsonb) into own
    from (select jsonb_build_object('id', h.id, 'revision', h.current_revision,
                    'title', r.manifest #>> '{intent,title}') as item,
                 h.updated_at, h.id
            from public.investigations h
            join public.investigation_revisions r
              on r.investigation_id = h.id and r.user_id = h.user_id
             and r.revision = h.current_revision
           where h.user_id = actor and h.lifecycle = 'active'
           limit 501) x;
  if jsonb_array_length(own) > 500 then
    return jsonb_build_object('status', 'unavailable');
  end if;
  select coalesce(jsonb_agg(x.item order by x.gid), '[]'::jsonb),
         coalesce(array_agg(x.gid order by x.gid), array[]::uuid[])
    into sent, sent_ids
    from (select public.investigation_handoff_summary_v1(g.id, g.resource_id, g.resource_revision,
                    g.granted_by, g.grantee_user_id, g.created_at, r.manifest)
                    -- Only an opted-in row gains the flag; a plain row keeps the exact
                    -- 0041 keyset, so legacy query/filter/paging semantics are untouched.
                    -- The flag is metadata about the share projection only: the reference
                    -- itself never rides a list.
                    || case when g.include_scenario
                            then jsonb_build_object('scenario_included', true)
                            else '{}'::jsonb end as item,
                 g.id as gid
            from public.resource_grants g
            join public.investigations h
              on h.id = g.resource_id and h.user_id = g.granted_by
            join public.investigation_revisions r
              on r.investigation_id = h.id and r.user_id = h.user_id
             and r.revision = g.resource_revision and r.lifecycle = 'active'
           where g.granted_by = actor and g.resource_kind = 'investigation' and g.revoked_at is null
             and (p_sent_after is null or g.id > p_sent_after)
           order by g.id asc
           limit 201) x;
  if coalesce(array_length(sent_ids, 1), 0) > 200 then
    -- One row was read past the page on purpose: trim only that extra. The cursor is the 200th
    -- -- not the 201st -- grant UUID, i.e. exactly the last row this page returned.
    sent := (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
               from jsonb_array_elements(sent) with ordinality as t(e, ord)
              where ord <= 200);
    sent_cursor := sent_ids[200];
  end if;
  select coalesce(jsonb_agg(x.item order by x.gid), '[]'::jsonb),
         coalesce(array_agg(x.gid order by x.gid), array[]::uuid[])
    into received, received_ids
    from (select public.investigation_handoff_summary_v1(g.id, g.resource_id, g.resource_revision,
                    g.granted_by, g.grantee_user_id, g.created_at, r.manifest)
                    -- Only an opted-in row gains the flag; a plain row keeps the exact
                    -- 0041 keyset, so legacy query/filter/paging semantics are untouched.
                    || case when g.include_scenario
                            then jsonb_build_object('scenario_included', true)
                            else '{}'::jsonb end as item,
                 g.id as gid
            from public.resource_grants g
            join public.investigations h
              on h.id = g.resource_id and h.user_id = g.granted_by and h.lifecycle = 'active'
            join public.investigation_revisions r
              on r.investigation_id = h.id and r.user_id = h.user_id
             and r.revision = g.resource_revision and r.lifecycle = 'active'
           where g.grantee_user_id = actor and g.resource_kind = 'investigation' and g.revoked_at is null
             and (p_received_after is null or g.id > p_received_after)
           order by g.id asc
           limit 201) x;
  if coalesce(array_length(received_ids, 1), 0) > 200 then
    received := (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
                   from jsonb_array_elements(received) with ordinality as t(e, ord)
                  where ord <= 200);
    received_cursor := received_ids[200];
  end if;
  return jsonb_build_object('status', 'listed', 'own', own, 'sent', sent, 'received', received,
    'sent_next_cursor', sent_cursor, 'received_next_cursor', received_cursor);
exception
  when others then
    return jsonb_build_object('status', 'unavailable');
end $$;

-- ------------------------------------------------------------
-- 7. The read RPC: the stored typed reference rides only on an opted-in grant over the same
-- pinned revision, after strict structural re-validation.
-- ------------------------------------------------------------

create or replace function public.read_investigation_handoff_v1(p_grant_id uuid)
returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  actor uuid := auth.uid();
  handoff jsonb;
  opted_in boolean;
  capture jsonb;
begin
  if actor is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;
  if p_grant_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  select jsonb_build_object(
      'schema', 'mm.research_handoff.v1',
      'grant_id', g.id,
      'investigation_id', g.resource_id,
      'revision', g.resource_revision,
      'shared_by', g.granted_by,
      'committed_at', r.committed_at,
      'intent', jsonb_build_object('title', r.manifest #>> '{intent,title}',
                                   'question', r.manifest #>> '{intent,question}'),
      'continuation', jsonb_strip_nulls(jsonb_build_object(
        'next_question', r.manifest #> '{continuation,next_question}',
        'next_observation', r.manifest #> '{continuation,next_observation}'))),
         g.include_scenario,
         case when g.include_scenario and r.manifest->>'schema' = 'investigation_manifest.v2'
              then r.manifest->'scenario_capture' end
    into handoff, opted_in, capture
    from public.resource_grants g
    join public.investigations h
      on h.id = g.resource_id and h.user_id = g.granted_by and h.lifecycle = 'active'
    join public.investigation_revisions r
      on r.investigation_id = h.id and r.user_id = h.user_id
     and r.revision = g.resource_revision and r.lifecycle = 'active'
   where g.id = p_grant_id
     and g.resource_kind = 'investigation'
     and g.grantee_user_id = actor
     and g.revoked_at is null;
  if handoff is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- The stored typed reference rides only on an opted-in grant over the same pinned
  -- revision, and only after the pure validator re-checks its structure. What the grantee
  -- receives is exactly the owner's value-free input/source-pointer metadata -- never a
  -- basis, result or any derived value, never raw manifest/layout/evidence/review/receipt
  -- content, and never a claim that the source is retained, reachable or usable: resolution
  -- refuses `unavailable` at the native owner until a qualified private destination and the
  -- current authorizers exist. An opted-in grant whose pinned revision no longer carries a
  -- validating reference is a storage anomaly: unavailable, never an empty field and never a
  -- fabricated reference. A plain grant never returns the field at all.
  if opted_in then
    if capture is null or jsonb_typeof(capture) <> 'object'
       or not public.valid_investigation_scenario_reference_v1(capture) then
      return jsonb_build_object('status', 'unavailable');
    end if;
    handoff := handoff || jsonb_build_object('scenario_capture', capture);
  end if;
  return jsonb_build_object('status', 'found', 'handoff', handoff);
exception
  when others then
    return jsonb_build_object('status', 'unavailable');
end $$;

-- No default EXECUTE survives on the new RPC or the new ownership helper: PUBLIC, anon,
-- authenticated and service_role are stripped before the explicit authenticated grants (the
-- 0041 pattern). The pure reference validator is revoked the same way from every caller role
-- (the 0028 pattern for the manifest validators): it is evaluated only inside the existing
-- definer chain, so no caller-facing privilege is created. No existing private helper's ACL
-- is touched or broadened.
alter function public.valid_investigation_scenario_reference_v1(jsonb) owner to postgres;
alter function public.owns_scenario_bearing_revision(uuid, integer) owner to postgres;
alter function public.create_investigation_scenario_handoff_v1(uuid, integer, uuid) owner to postgres;

revoke all on function public.valid_investigation_scenario_reference_v1(jsonb)
  from public, anon, authenticated;

do $$ begin
  revoke all on function public.valid_investigation_scenario_reference_v1(jsonb)
    from service_role;
exception when undefined_object then null; end $$;

revoke all on function public.owns_scenario_bearing_revision(uuid, integer),
  public.create_investigation_scenario_handoff_v1(uuid, integer, uuid)
  from public, anon, authenticated;

do $$ begin
  revoke all on function public.owns_scenario_bearing_revision(uuid, integer),
    public.create_investigation_scenario_handoff_v1(uuid, integer, uuid)
    from service_role;
exception when undefined_object then null; end $$;

grant execute on function public.owns_scenario_bearing_revision(uuid, integer) to authenticated;

grant execute on function public.create_investigation_scenario_handoff_v1(uuid, integer, uuid)
  to authenticated;

-- The 0041 policy text preserved verbatim and extended with exactly one clause: an opt-in
-- include_scenario insert must additionally pin a valid reference-bearing owned active
-- revision. The false path is byte-identical to 0041, and 0021's watchlist-only policy is
-- untouched. Drop-then-create (not create-or-replace: policies have neither) is replay-safe
-- inside this file's single transaction.
do $$ begin
  drop policy if exists resource_grants_insert_investigation_owner on public.resource_grants;
  create policy resource_grants_insert_investigation_owner on public.resource_grants
    for insert to authenticated
    with check (
      granted_by = auth.uid()
      and grantee_user_id <> auth.uid()
      and resource_kind = 'investigation'
      and resource_revision is not null
      and public.owns_active_investigation_revision(resource_id, resource_revision)
      and (not include_scenario
           or public.owns_scenario_bearing_revision(resource_id, resource_revision)));
end $$;

commit;

-- down:
-- Guidance only; no rollback is authorized or executed by this source file. Preserve the
-- ORIGINAL operation/carrier, ordered statement results, failed_statement_index and catalog
-- receipt. A statement-at-a-time helper is NOT atomic: on partial/unknown outcome, stop and
-- reconcile each original statement's actual effect before planning any compensating effect.
-- Never replay this file, 0041 or 0040 blindly to recover or roll back.
-- A separately qualified restoration plan must bind the actual installed app/schema version,
-- active writer and target; extract the exact reviewed prior function bodies, ownership/ACLs
-- and INSERT policy from the qualified 0041/0040 source and compare current catalog first.
-- Restore ONLY the affected, identified bodies/policy in dependency order, with explicit
-- per-statement preconditions/receipts and post-catalog verification. In particular the
-- duplicate-guarded 0041 policy creation is not a substitute for targeted policy restoration.
-- Keep grant rows, immutable revisions, mutation receipts, references, include_scenario column,
-- constraint and private validator intact unless an independently authorized data-preservation
-- plan says otherwise. Do not drop helpers still referenced by surviving policies/functions.
-- qualify actual dependencies and preserve exact privileges before any removal. Unknown
-- statements must be reconciled on their original carrier; no assumed rollback/retry safety.
-- First inspect the actual installed bodies for the targeted restoration plan above.
-- This catalog read does not restore, revoke, drop or replay any object.
-- select p.oid::regprocedure as function_signature, pg_get_functiondef(p.oid) as current_definition
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname in
--    ('valid_investigation_manifest_v2', 'resource_grants_guard',
--     'create_investigation_handoff_v1', 'create_investigation_scenario_handoff_v1',
--     'list_investigation_handoffs_v1', 'read_investigation_handoff_v1')
--  order by p.oid::regprocedure::text;

-- readback: (run after applying; the seat posts this output as the receipt)
--   select attname, attnotnull, pg_get_expr(ad.adbin, ad.adrelid) as default_expr
--     from pg_attribute a
--     left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
--    where attrelid = 'public.resource_grants'::regclass and attname = 'include_scenario';
--     -- expected exactly one row: include_scenario | t | false
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.resource_grants'::regclass and contype = 'c' order by 1;
--     -- expected 4: resource_grants_not_self unchanged from 0021;
--     --             resource_grants_resource_kind_check unchanged from 0041;
--     --             resource_grants_revision_matches_kind unchanged from 0041;
--     --             resource_grants_scenario_matches_kind (false OR investigation kind)
--   select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'resource_grants' order by 1;
--     -- expected the same 4 names as 0041; resource_grants_insert_investigation_owner INSERT
--     -- now also demands owns_scenario_bearing_revision when include_scenario
--   select has_column_privilege('authenticated','public.resource_grants','include_scenario','UPDATE'),
--          has_column_privilege('authenticated','public.resource_grants','revoked_at','UPDATE');
--     -- expected: f | t
--   select proname, prosecdef, provolatile, proconfig from pg_proc
--    where pronamespace = 'public'::regnamespace and proname in
--      ('valid_investigation_scenario_reference_v1','valid_investigation_manifest_v2',
--       'owns_active_investigation_revision','owns_scenario_bearing_revision',
--       'investigation_handoff_summary_v1','create_investigation_handoff_v1',
--       'create_investigation_scenario_handoff_v1','list_investigation_handoffs_v1',
--       'read_investigation_handoff_v1','revoke_investigation_handoff_v1',
--       'resource_grants_guard') order by 1;
--     -- expected 11 rows; valid_investigation_scenario_reference_v1 and
--     -- valid_investigation_manifest_v2 are IMMUTABLE with the 0040 search_path; both creates
--     -- and the four 0041 RPCs are security definer with search_path = ''; the guard trigger
--     -- function is unchanged in shape
--   select pg_get_function_identity_arguments(oid) from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('create_investigation_handoff_v1','create_investigation_scenario_handoff_v1');
--     -- expected exactly 2 rows, both "p_id uuid, p_revision integer, p_grantee uuid" -- no
--     -- surviving overload of either create
--   select has_function_privilege('authenticated','public.create_investigation_scenario_handoff_v1(uuid,integer,uuid)','EXECUTE'),
--          has_function_privilege('authenticated','public.owns_scenario_bearing_revision(uuid,integer)','EXECUTE'),
--          has_function_privilege('authenticated','public.valid_investigation_scenario_reference_v1(jsonb)','EXECUTE'),
--          has_function_privilege('anon','public.valid_investigation_scenario_reference_v1(jsonb)','EXECUTE'),
--          has_function_privilege('postgres','public.valid_investigation_scenario_reference_v1(jsonb)','EXECUTE');
--     -- expected: t | t | f | f | t -- the pure validator keeps NO caller-facing EXECUTE by
--     -- design; every evaluation rides the definer/owner chain
--   select tgname from pg_trigger where tgrelid = 'public.resource_grants'::regclass and not tgisinternal;
--     -- expected: resource_grants_revoke_is_terminal (unchanged trigger, extended guard)
--   with sample as (
--     select '{"schema":"investigation_scenario_reference.v1","model_version":"exposure-scenario/v1","inputs":{"targetSpot":600,"deltaSigmaPts":-1,"days":0.25},"source":{"owner":"options_hub","root":"SPX","session":"2026-10-16","source_as_of":null,"evaluated_at":"2026-10-16T14:30:00+02:00","lens":{"kind":"all"},"selection_key":"2026-10-16|2026-10-16T20:00:00Z","basis_sha256":"1111111111111111111111111111111111111111111111111111111111111111","gex":{"sha256":"2222222222222222222222222222222222222222222222222222222222222222","byte_length":1234567},"moves":null}}'::jsonb as c)
--   select public.valid_investigation_scenario_reference_v1(c) as admits_worked_reference,
--          public.valid_investigation_scenario_reference_v1(c || '{"result":{}}'::jsonb) as refuses_added_result_value,
--          public.valid_investigation_scenario_reference_v1(jsonb_set(c, '{source,gex,byte_length}', '0'::jsonb, true)) as refuses_zero_byte_length,
--          public.valid_investigation_scenario_reference_v1(jsonb_set(c, '{source,evaluated_at}', '"2026-10-15T21:30:00+02:00"'::jsonb, true)) as refuses_evaluation_before_session,
--          public.valid_investigation_scenario_reference_v1('{"schema":"investigation_scenario_capture.v1"}'::jsonb) as refuses_superseded_full_value_discriminator
--   from sample;
--     -- expected: t | f | f | f | f
--   select count(*) from public.resource_grants where include_scenario;
--     -- informational: a replay must leave this count and every existing row byte-identical
