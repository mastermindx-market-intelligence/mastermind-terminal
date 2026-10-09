-- Ledger row: 0031 (TERMINAL-AUDIT20-A04)
-- Rollback: DROP FUNCTION public.replace_drawings_collection(text,jsonb,text,uuid); DROP FUNCTION public.read_drawings_collection(text); DROP FUNCTION public.validate_drawing_replace_input(text,jsonb,uuid); existing drawings are retained.
-- Re-runnable, SECURITY INVOKER; the existing table, owner filters and RLS remain authoritative.
-- GET does not bootstrap writes or historical receipts. Legacy tokens bind the entire observed row set.
-- The short SHARE ROW EXCLUSIVE fence also protects against unupgraded direct-table INSERTs.
-- Tradeoff: collection writes serialize across this table; ordinary SELECT/GET remains readable.
-- Source ships unapplied. Apply out of band after source review, with pre/post catalog receipts.
BEGIN;
-- Fail before publishing RPCs if this environment cannot enforce the reviewed
-- invoker fence. This migration does not broaden table grants or bypass RLS.
DO $prerequisites$
BEGIN
  IF NOT has_table_privilege('authenticated','public.drawings','UPDATE') THEN
    RAISE EXCEPTION 'authenticated lacks UPDATE privilege required for the drawing table-write fence' USING ERRCODE='42501';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.drawings'::regclass) THEN
    RAISE EXCEPTION 'drawing row level security must be enabled' USING ERRCODE='42501';
  END IF;
END;
$prerequisites$;
-- Direct RPC input guard.
-- Source64c1; point bounds derived from actual DRAWING_TOOLS export. No table writes.
CREATE OR REPLACE FUNCTION public.validate_drawing_replace_input(p_symbol text, p_drawings jsonb, p_operation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE
 owner_id uuid := auth.uid(); normalized_symbol text; symbol_units integer;
 trim_chars CONSTANT text := chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
 drawing jsonb; point jsonb; bounds jsonb; drawing_id text; kind text; point_count integer;
 seen_ids text[] := '{}'::text[]; price double precision;
 rules CONSTANT jsonb := $rules${"trendline":{"min":2,"max":2},"ray":{"min":2,"max":2},"infoline":{"min":2,"max":2},"extendedline":{"min":2,"max":2},"trendangle":{"min":2,"max":2},"hline":{"min":1,"max":1},"horizontalray":{"min":1,"max":1},"vline":{"min":1,"max":1},"crossline":{"min":1,"max":1},"channel":{"min":3,"max":3},"regressiontrend":{"min":2,"max":2},"flattopbottom":{"min":3,"max":3},"disjointchannel":{"min":4,"max":4},"pitchfork":{"min":3,"max":3},"schiffpitchfork":{"min":3,"max":3},"modifiedschiffpitchfork":{"min":3,"max":3},"insidepitchfork":{"min":3,"max":3},"fib":{"min":2,"max":2},"fibtrend":{"min":3,"max":3},"fibchannel":{"min":3,"max":3},"fibtimezone":{"min":2,"max":2},"fibspeedresistancefan":{"min":2,"max":2},"trendbasedfibtime":{"min":3,"max":3},"fibcircles":{"min":2,"max":2},"fibspiral":{"min":2,"max":2},"fibspeedresistancearcs":{"min":2,"max":2},"fibwedge":{"min":3,"max":3},"pitchfan":{"min":3,"max":3},"gannbox":{"min":2,"max":2},"gannsquarefixed":{"min":2,"max":2},"gannsquare":{"min":2,"max":2},"gannfan":{"min":2,"max":2},"xabcd":{"min":5,"max":5},"cypher":{"min":5,"max":5},"headandshoulders":{"min":7,"max":7},"abcd":{"min":4,"max":4},"trianglepattern":{"min":4,"max":4},"threedrives":{"min":7,"max":7},"elliottimpulse":{"min":6,"max":6},"elliottcorrection":{"min":4,"max":4},"elliotttriangle":{"min":6,"max":6},"elliottdoublecombo":{"min":4,"max":4},"elliotttriplecombo":{"min":6,"max":6},"cycliclines":{"min":2,"max":2},"timecycles":{"min":2,"max":2},"sineline":{"min":2,"max":2},"longposition":{"min":2,"max":3},"shortposition":{"min":2,"max":3},"forecast":{"min":2,"max":2},"ghostfeed":{"min":2,"max":64},"barpattern":{"min":2,"max":2},"sector":{"min":3,"max":3},"anchoredvwap":{"min":1,"max":1},"fixedrangevolumeprofile":{"min":2,"max":2},"pricerange":{"min":2,"max":2},"daterange":{"min":2,"max":2},"dateandpricerange":{"min":2,"max":2},"measure":{"min":2,"max":2},"brush":{"min":2,"max":64},"highlighter":{"min":2,"max":64},"path":{"min":2,"max":64},"rect":{"min":2,"max":2},"rotatedrect":{"min":3,"max":3},"ellipse":{"min":3,"max":3},"circle":{"min":2,"max":2},"triangle":{"min":3,"max":3},"polyline":{"min":2,"max":64},"arc":{"min":3,"max":3},"curve":{"min":2,"max":3},"doublecurve":{"min":2,"max":4},"arrowmarker":{"min":1,"max":1},"arrow":{"min":2,"max":2},"arrowmarkleft":{"min":1,"max":1},"arrowmarkright":{"min":1,"max":1},"arrowmarktop":{"min":1,"max":1},"arrowmarkbottom":{"min":1,"max":1},"flagmark":{"min":1,"max":1},"momentum":{"min":2,"max":2},"flow":{"min":2,"max":2},"emphasis":{"min":2,"max":2},"whisper":{"min":2,"max":2},"subtle":{"min":2,"max":2},"divergence":{"min":2,"max":4},"journey":{"min":2,"max":6},"fork":{"min":2,"max":5},"threepaths":{"min":2,"max":5},"burj":{"min":2,"max":3},"text":{"min":1,"max":1},"anchoredtext":{"min":1,"max":1},"note":{"min":1,"max":1},"anchorednote":{"min":1,"max":1},"callout":{"min":2,"max":2},"pricelabel":{"min":1,"max":1},"pricenote":{"min":1,"max":1},"signpost":{"min":1,"max":1},"comment":{"min":1,"max":1},"image":{"min":2,"max":2},"emoji":{"min":1,"max":1},"icon":{"min":1,"max":1}}$rules$::jsonb;
BEGIN
 IF owner_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
 IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation id required' USING ERRCODE='22023'; END IF;
 IF p_symbol IS NULL THEN RAISE EXCEPTION 'Invalid symbol' USING ERRCODE='22023'; END IF;
 normalized_symbol:=btrim(p_symbol,trim_chars);
 IF char_length(normalized_symbol) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'Invalid symbol' USING ERRCODE='22023'; END IF;
 SELECT char_length(normalized_symbol)+count(*) FILTER (WHERE ascii(substr(normalized_symbol,i,1))>65535) INTO symbol_units FROM generate_series(1,char_length(normalized_symbol)) chars(i);
 IF symbol_units>64 THEN RAISE EXCEPTION 'Symbol exceeds64 UTF16 units' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_drawings) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Array required' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_drawings)>500 OR octet_length(convert_to(p_drawings::text,'UTF8'))>2000000 THEN
  RAISE EXCEPTION 'Payload too large' USING ERRCODE='22023';
 END IF;
 FOR drawing IN SELECT value FROM jsonb_array_elements(p_drawings) LOOP
  IF jsonb_typeof(drawing) IS DISTINCT FROM 'object' OR jsonb_typeof(drawing->'id') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid drawing or id' USING ERRCODE='22023';
  END IF;
  drawing_id:=btrim(drawing->>'id',trim_chars);
  IF drawing_id='' OR drawing_id=ANY(seen_ids) THEN RAISE EXCEPTION 'Empty or duplicate id' USING ERRCODE='22023'; END IF;
  seen_ids:=array_append(seen_ids,drawing_id);
  IF drawing->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR drawing->>'source' IS DISTINCT FROM 'user' THEN
   RAISE EXCEPTION 'Canonical user drawing required' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(drawing->'kind') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Kind required' USING ERRCODE='22023'; END IF;
  kind:=drawing->>'kind'; bounds:=rules->kind;
  IF bounds IS NULL OR jsonb_typeof(drawing->'points') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid kind or points' USING ERRCODE='22023'; END IF;
  point_count:=jsonb_array_length(drawing->'points');
  IF point_count<(bounds->>'min')::integer OR point_count>(bounds->>'max')::integer THEN RAISE EXCEPTION 'Invalid point count' USING ERRCODE='22023'; END IF;
  FOR point IN SELECT value FROM jsonb_array_elements(drawing->'points') LOOP
   IF jsonb_typeof(point) IS DISTINCT FROM 'object' OR jsonb_typeof(point->'p') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Numeric price required' USING ERRCODE='22023';
   END IF;
   BEGIN
    price:=(point->>'p')::double precision;
   EXCEPTION WHEN numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Price outside finite double range' USING ERRCODE='22023';
   END;
   IF price='Infinity'::double precision OR price='-Infinity'::double precision OR price='NaN'::double precision THEN
    RAISE EXCEPTION 'Finite price required' USING ERRCODE='22023';
   END IF;
   IF jsonb_typeof(point->'t') IS NULL OR jsonb_typeof(point->'t') NOT IN ('string','number') OR btrim(point->>'t',trim_chars)='' THEN
    RAISE EXCEPTION 'Nonempty supported time required' USING ERRCODE='22023';
   END IF;
  END LOOP;
 END LOOP;
END;
$guard$;
REVOKE ALL ON FUNCTION public.validate_drawing_replace_input(text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_drawing_replace_input(text,jsonb,uuid) TO authenticated;

-- Existing-table read/CAS snapshot. GET creates no historical operation receipt.
CREATE OR REPLACE FUNCTION public.read_drawings_collection(p_symbol text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $snapshot$
DECLARE
  trim_chars CONSTANT text := chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
  normalized_symbol text := btrim(p_symbol,trim_chars);
  -- Bounded receipt history: the live operation plus this many prior ones replay.
  prior_operation_limit CONSTANT integer := 32;
  owner_id uuid := auth.uid();
  rows_snapshot jsonb;
  selected_row jsonb;
  metadata jsonb;
  drawings jsonb;
  revision text;
  collection_count integer;
  row_count integer;
  versioned boolean := false;
  receipt jsonb;
  ring_operation uuid;
  live_operation uuid;
  seen_operations uuid[] := '{}'::uuid[];
  receipt_timestamp timestamptz;
BEGIN
  PERFORM public.validate_drawing_replace_input(p_symbol,'[]'::jsonb,'00000000-0000-4000-8000-000000000001'::uuid);
  -- One aggregate statement observes one MVCC snapshot. Epoch numerics make
  -- the token independent of the session's timestamptz display timezone.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'kind',kind,'data',data,'createdAtEpoch',extract(epoch FROM created_at)
  ) ORDER BY id),'[]'::jsonb)
  INTO rows_snapshot
  FROM public.drawings WHERE user_id=owner_id AND symbol=normalized_symbol;
  row_count := jsonb_array_length(rows_snapshot);
  IF row_count=0 THEN
    RETURN jsonb_build_object('drawings','[]'::jsonb,'revision',NULL,'schemaVersion',1,'shape','empty');
  END IF;
  SELECT count(*) INTO collection_count
    FROM jsonb_array_elements(rows_snapshot) r WHERE r->>'kind'='__collection_v1';
  IF collection_count>1 OR (collection_count=1 AND row_count<>1) THEN
    RAISE EXCEPTION 'Ambiguous stored drawing collection' USING ERRCODE='22000';
  END IF;
  IF collection_count=1 THEN
    selected_row := rows_snapshot->0; metadata := selected_row->'data';
    IF jsonb_typeof(metadata) IS DISTINCT FROM 'object'
      OR metadata->'schemaVersion' IS DISTINCT FROM '1'::jsonb
      OR jsonb_typeof(metadata->'drawings') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Malformed legacy drawing collection' USING ERRCODE='22000';
    END IF;
    drawings := metadata->'drawings';
    IF metadata ?| ARRAY['operation_id','payload_hash','prior_operations'] THEN
      IF jsonb_typeof(metadata->'revision') IS DISTINCT FROM 'string'
        OR jsonb_typeof(metadata->'operation_id') IS DISTINCT FROM 'string'
        OR jsonb_typeof(metadata->'payload_hash') IS DISTINCT FROM 'string'
        OR metadata->>'payload_hash' !~ '^[0-9a-f]{64}$'
        OR jsonb_typeof(metadata->'prior_operations') IS DISTINCT FROM 'array'
        OR jsonb_array_length(metadata->'prior_operations')>prior_operation_limit THEN
        RAISE EXCEPTION 'Malformed versioned drawing metadata' USING ERRCODE='22000';
      END IF;
      BEGIN
        revision := ((metadata->>'revision')::uuid)::text;
        live_operation := (metadata->>'operation_id')::uuid;
        IF metadata->>'payload_hash' IS DISTINCT FROM encode(sha256(convert_to(drawings::text,'UTF8')),'hex') THEN
          RAISE EXCEPTION 'Drawing payload hash mismatch';
        END IF;
        seen_operations := ARRAY[live_operation];
        FOR receipt IN SELECT value FROM jsonb_array_elements(metadata->'prior_operations') LOOP
          IF jsonb_typeof(receipt) IS DISTINCT FROM 'object'
            OR jsonb_typeof(receipt->'operation_id') IS DISTINCT FROM 'string'
            OR jsonb_typeof(receipt->'revision') IS DISTINCT FROM 'string'
            OR jsonb_typeof(receipt->'payload_hash') IS DISTINCT FROM 'string'
            OR receipt->>'payload_hash' !~ '^[0-9a-f]{64}$'
            OR jsonb_typeof(receipt->'committed_at') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'Malformed prior operation';
          END IF;
          ring_operation := (receipt->>'operation_id')::uuid;
          PERFORM (receipt->>'revision')::uuid;
          receipt_timestamp := (receipt->>'committed_at')::timestamptz;
          IF ring_operation=ANY(seen_operations) OR receipt_timestamp IS NULL THEN
            RAISE EXCEPTION 'Duplicate or malformed prior operation';
          END IF;
          seen_operations := array_append(seen_operations,ring_operation);
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Malformed versioned drawing metadata' USING ERRCODE='22000';
      END;
      versioned := true;
    ELSIF metadata ? 'revision' THEN
      BEGIN
        IF jsonb_typeof(metadata->'revision') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid legacy revision'; END IF;
        PERFORM (metadata->>'revision')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Malformed legacy revision' USING ERRCODE='22000';
      END;
    END IF;
  ELSE
    -- Preserve actual stored fields. Unsupported legacy normalization is an
    -- explicit unavailable result; it cannot become a destructive replace-all.
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows_snapshot) r WHERE jsonb_typeof(r->'data') IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION 'Malformed legacy drawing row' USING ERRCODE='22000';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('id',coalesce(nullif(r->'data'->>'id',''),r->>'id'),'kind',r->>'kind') || (r->'data') ORDER BY (r->>'createdAtEpoch')::numeric,r->>'id')
      INTO drawings FROM jsonb_array_elements(rows_snapshot) r;
  END IF;
  IF NOT versioned THEN
    -- The historical row-per-drawing format stored geometry without these
    -- canonical tags. Infer only the established user defaults; retain every
    -- raw field and refuse generated/ambiguous source hints.
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(drawings) d
      WHERE d->'auto'='true'::jsonb OR d->>'by'='ai' OR d->'meta'->>'by'='ai'
        OR left(d->>'id',3)='ai_') THEN
      RAISE EXCEPTION 'Generated legacy drawing cannot be replaced as user data' USING ERRCODE='22000';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('schemaVersion',1,'source','user') || d ORDER BY ordinal)
      INTO drawings FROM jsonb_array_elements(drawings) WITH ORDINALITY entries(d,ordinal);
  END IF;
  BEGIN
    PERFORM public.validate_drawing_replace_input(p_symbol,drawings,'00000000-0000-4000-8000-000000000001'::uuid);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Unsupported stored drawing geometry' USING ERRCODE='22000';
  END;
  IF NOT versioned THEN
    revision := 'legacy:' || encode(sha256(convert_to(jsonb_build_object(
      'owner',owner_id,'symbol',normalized_symbol,'rows',rows_snapshot
    )::text,'UTF8')),'hex');
  END IF;
  RETURN jsonb_build_object('drawings',drawings,'revision',revision,'schemaVersion',1,
    'shape',CASE WHEN versioned THEN 'versioned' WHEN collection_count=1 THEN 'legacy_collection' ELSE 'legacy_rows' END,
    'collectionId',selected_row->>'id','metadata',metadata);
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.read_drawings_collection(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_drawings_collection(text) TO authenticated;

-- Atomic existing-table replacement and operation replay.
-- Requires public.validate_drawing_replace_input from the accepted guard.
CREATE OR REPLACE FUNCTION public.replace_drawings_collection(
  p_symbol text,
  p_drawings jsonb,
  p_expected_revision text,
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $replace_drawings_collection$
DECLARE
  trim_chars CONSTANT text := chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
  -- Bounded receipt history: the live operation plus this many prior ones replay.
  -- An older operation is no longer recognized and meets revision_conflict.
  prior_operation_limit CONSTANT integer := 32;
  owner_id uuid;
  normalized_symbol text;
  payload_hash text;
  new_revision uuid;
  live_collection_id uuid;
  live_data jsonb;
  live_revision uuid;
  live_operation_id uuid;
  live_payload_hash text;
  live_prior_operations jsonb;
  receipt jsonb;
  receipt_operation_id uuid;
  receipt_revision uuid;
  receipt_payload_hash text;
  receipt_committed_at timestamptz;
  seen_ring_operations uuid[] := '{}'::uuid[];
  ring_has_operation boolean := false;
  ring_payload_hash text;
  live_committed_at timestamptz;
  new_ring jsonb;
  snapshot jsonb;
  observed_revision text;
  is_versioned boolean;
BEGIN
  PERFORM public.validate_drawing_replace_input(
    p_symbol,
    p_drawings,
    p_operation_id
  );

  owner_id := auth.uid();
  normalized_symbol := btrim(p_symbol, trim_chars);
  payload_hash := encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_drawings::text, 'UTF8')),
    'hex'
  );

  -- Predicate protection includes an unupgraded direct-table INSERT. Row locks
  -- alone cannot fence an absent row or a new row in the owner/symbol set.
  -- This short write fence serializes table mutations; GET remains readable.
  LOCK TABLE public.drawings IN SHARE ROW EXCLUSIVE MODE;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(jsonb_build_array(owner_id, normalized_symbol)::text, 0)
  );

  PERFORM 1
  FROM public.drawings
  WHERE user_id = owner_id
    AND symbol = normalized_symbol
  ORDER BY created_at DESC, id DESC
  FOR UPDATE;

  snapshot := public.read_drawings_collection(p_symbol);
  observed_revision := snapshot->>'revision';
  is_versioned := snapshot->>'shape' = 'versioned';
  live_collection_id := (snapshot->>'collectionId')::uuid;
  live_data := snapshot->'metadata';

  IF is_versioned THEN
    SELECT created_at INTO live_committed_at
    FROM public.drawings
    WHERE id = live_collection_id;

    IF jsonb_typeof(live_data) IS DISTINCT FROM 'object'
      OR live_data->'schemaVersion' IS DISTINCT FROM '1'::jsonb
      OR jsonb_typeof(live_data->'drawings') IS DISTINCT FROM 'array'
      OR jsonb_typeof(live_data->'prior_operations') IS DISTINCT FROM 'array'
      OR jsonb_array_length(live_data->'prior_operations') > prior_operation_limit
      OR jsonb_typeof(live_data->'revision') IS DISTINCT FROM 'string'
      OR jsonb_typeof(live_data->'operation_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(live_data->'payload_hash') IS DISTINCT FROM 'string'
      OR live_data->>'payload_hash' !~ '^[0-9a-f]{64}$'
    THEN
      RAISE EXCEPTION 'Malformed live collection metadata'
        USING ERRCODE = '22000';
    END IF;

    BEGIN
      live_revision := (live_data->>'revision')::uuid;
      live_operation_id := (live_data->>'operation_id')::uuid;
      live_payload_hash := live_data->>'payload_hash';
      live_prior_operations := live_data->'prior_operations';
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Malformed live collection metadata'
        USING ERRCODE = '22000';
    END;

    IF live_revision IS NULL
      OR live_operation_id IS NULL
      OR live_payload_hash IS NULL
    THEN
      RAISE EXCEPTION 'Malformed live collection metadata'
        USING ERRCODE = '22000';
    END IF;

    FOR receipt IN
      SELECT value
      FROM jsonb_array_elements(live_prior_operations)
    LOOP
      IF jsonb_typeof(receipt) IS DISTINCT FROM 'object'
        OR jsonb_typeof(receipt->'operation_id') IS DISTINCT FROM 'string'
        OR jsonb_typeof(receipt->'revision') IS DISTINCT FROM 'string'
        OR jsonb_typeof(receipt->'payload_hash') IS DISTINCT FROM 'string'
        OR jsonb_typeof(receipt->'committed_at') IS DISTINCT FROM 'string'
        OR receipt->>'payload_hash' !~ '^[0-9a-f]{64}$'
      THEN
        RAISE EXCEPTION 'Malformed live collection prior operation'
          USING ERRCODE = '22000';
      END IF;

      BEGIN
        receipt_operation_id := (receipt->>'operation_id')::uuid;
        receipt_revision := (receipt->>'revision')::uuid;
        receipt_payload_hash := receipt->>'payload_hash';
        receipt_committed_at := (receipt->>'committed_at')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Malformed live collection prior operation'
          USING ERRCODE = '22000';
      END;

      IF receipt_operation_id = ANY(seen_ring_operations) THEN
        RAISE EXCEPTION 'Duplicate prior operation id'
          USING ERRCODE = '22000';
      END IF;
      seen_ring_operations := array_append(seen_ring_operations, receipt_operation_id);

      IF receipt_operation_id = p_operation_id THEN
        ring_has_operation := true;
        ring_payload_hash := receipt_payload_hash;
      END IF;
    END LOOP;

    IF live_operation_id = p_operation_id THEN
      IF live_payload_hash = payload_hash THEN
        RETURN jsonb_build_object(
          'ok', true,
          'idempotentReplay', true,
          'superseded', false,
          'revision', live_revision
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', false,
        'code', 'operation_payload_mismatch'
      );
    END IF;

    IF ring_has_operation THEN
      IF ring_payload_hash = payload_hash THEN
        RETURN jsonb_build_object(
          'ok', true,
          'idempotentReplay', true,
          'superseded', true,
          'revision', live_revision
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', false,
        'code', 'operation_payload_mismatch'
      );
    END IF;
  END IF;

  IF p_expected_revision IS DISTINCT FROM observed_revision THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'revision_conflict',
      'operationUnknownPossible', true
    );
  END IF;

  new_revision := pg_catalog.gen_random_uuid();
  new_ring := '[]'::jsonb;

  IF is_versioned THEN
    new_ring := jsonb_build_array(
      jsonb_build_object(
        'operation_id', live_operation_id,
        'revision', live_revision,
        'payload_hash', live_payload_hash,
        'committed_at', live_committed_at
      )
    );

    FOR receipt IN
      SELECT value
      FROM jsonb_array_elements(live_prior_operations)
    LOOP
      EXIT WHEN jsonb_array_length(new_ring) = prior_operation_limit;
      new_ring := new_ring || receipt;
    END LOOP;
  END IF;

  DELETE FROM public.drawings
  WHERE user_id = owner_id
    AND symbol = normalized_symbol;

  INSERT INTO public.drawings (
    id,
    user_id,
    symbol,
    kind,
    data,
    created_at
  ) VALUES (
    pg_catalog.gen_random_uuid(),
    owner_id,
    normalized_symbol,
    '__collection_v1',
    jsonb_build_object(
      'schemaVersion', 1,
      'drawings', p_drawings,
      'revision', new_revision,
      'operation_id', p_operation_id,
      'payload_hash', payload_hash,
      'prior_operations', new_ring
    ),
    clock_timestamp()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotentReplay', false,
    'superseded', false,
    'revision', new_revision
  );
END;
$replace_drawings_collection$;

REVOKE ALL ON FUNCTION public.replace_drawings_collection(text, jsonb, text, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_drawings_collection(text, jsonb, text, uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- down:
-- DROP FUNCTION IF EXISTS public.replace_drawings_collection(text,jsonb,text,uuid);
-- DROP FUNCTION IF EXISTS public.read_drawings_collection(text);
-- DROP FUNCTION IF EXISTS public.validate_drawing_replace_input(text,jsonb,uuid);
-- readback:
-- SELECT p.oid::regprocedure AS function_signature, p.prosecdef, p.proconfig,
--   has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
--   has_function_privilege('anon',p.oid,'EXECUTE') AS anonymous_execute
-- FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
-- WHERE n.nspname='public' AND p.proname IN ('validate_drawing_replace_input','read_drawings_collection','replace_drawings_collection');
-- SELECT relrowsecurity FROM pg_class WHERE oid='public.drawings'::regclass;
-- SELECT has_table_privilege('authenticated','public.drawings','UPDATE') AS authenticated_fence_privilege;
