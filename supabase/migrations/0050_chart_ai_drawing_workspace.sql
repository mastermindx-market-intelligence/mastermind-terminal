-- Ledger row: 0050 (chart-ai-drawing-workspace-20261018-c4-001, Terminal #1048).
-- Extends only the incumbent invoker validator and snapshot read owner from0031.
-- Existing collection/CAS/operation replay, table grants, owner filters and RLS are retained.
-- Source ships UNAPPLIED. Installation/production proof is separate from source qualification.
-- Rollback is conditional on operation history, not merely the current rows. See the down block.
BEGIN;
DO $prerequisites$
BEGIN
 IF to_regprocedure('public.replace_drawings_collection(text,jsonb,text,uuid)') IS NULL
   OR to_regprocedure('public.read_drawings_collection(text)') IS NULL
   OR to_regprocedure('public.validate_drawing_replace_input(text,jsonb,uuid)') IS NULL THEN
  RAISE EXCEPTION 'Accepted0031 drawing RPCs must be installed first' USING ERRCODE='55000';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc
   WHERE oid IN (to_regprocedure('public.replace_drawings_collection(text,jsonb,text,uuid)'),
     to_regprocedure('public.read_drawings_collection(text)'),
     to_regprocedure('public.validate_drawing_replace_input(text,jsonb,uuid)'))
     AND prosecdef) THEN
  RAISE EXCEPTION 'Drawing RPCs must remain SECURITY INVOKER' USING ERRCODE='42501';
 END IF;
 IF NOT has_table_privilege('authenticated','public.drawings','UPDATE')
   OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.drawings'::regclass) THEN
  RAISE EXCEPTION 'Existing drawing table privilege and RLS fence required' USING ERRCODE='42501';
 END IF;
END;
$prerequisites$;

CREATE OR REPLACE FUNCTION public.validate_drawing_replace_input(p_symbol text, p_drawings jsonb, p_operation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE
 owner_id uuid := auth.uid(); normalized_symbol text; symbol_units integer;
 trim_chars CONSTANT text := chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
 drawing jsonb; point jsonb; bounds jsonb; drawing_id text; kind text; point_count integer;
 seen_ids text[] := '{}'::text[]; price double precision;
 ai_meta jsonb; ai_op text; ai_count integer := 0; ai_layer_hidden boolean;
 text_value text; text_limit integer; text_min integer; text_units integer;
 control_chars CONSTANT text := '['||chr(1)||'-'||chr(31)||chr(127)||']';
 ai_tools CONSTANT text[] := ARRAY['trendline','ray','extendedline','infoline','hline','horizontalray','vline','crossline','channel','disjointchannel','pitchfork','modifiedschiffpitchfork','fib','fibtrend','fibchannel','fibspeedresistancefan','pitchfan','xabcd','cypher','abcd','headandshoulders','trianglepattern','threedrives','elliottimpulse','elliottcorrection','elliotttriangle','pricerange','daterange','dateandpricerange','measure','path','polyline','rect','triangle','arrow','arrowmarker','arrowmarkleft','arrowmarkright','arrowmarktop','arrowmarkbottom','flagmark','text','note','callout','pricelabel','pricenote','signpost','comment']::text[];
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
  IF drawing->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR drawing->>'source' IS NULL OR drawing->>'source' NOT IN ('user','ai') THEN
   RAISE EXCEPTION 'Canonical user or AI drawing required' USING ERRCODE='22023';
  END IF;
  IF drawing->>'source'='user' AND (drawing->'auto'='true'::jsonb
    OR drawing->>'by'='ai' OR drawing->'meta'->>'by'='ai'
    OR drawing->'meta' ? 'chart_ai' OR left(drawing_id,3)='ai_') THEN
   RAISE EXCEPTION 'Contradictory user drawing provenance' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(drawing->'kind') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Kind required' USING ERRCODE='22023'; END IF;
  kind:=drawing->>'kind'; bounds:=rules->kind;
  IF bounds IS NULL OR jsonb_typeof(drawing->'points') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid kind or points' USING ERRCODE='22023'; END IF;
  point_count:=jsonb_array_length(drawing->'points');
  IF point_count<(bounds->>'min')::integer OR point_count>(bounds->>'max')::integer THEN RAISE EXCEPTION 'Invalid point count' USING ERRCODE='22023'; END IF;
  IF drawing->>'source'='ai' THEN
   ai_count := ai_count+1;
   IF ai_count>60 OR point_count>64
     OR jsonb_typeof(drawing->'meta') IS DISTINCT FROM 'object'
     OR ((drawing ? 'auto') AND drawing->'auto' IS DISTINCT FROM 'true'::jsonb)
     OR ((drawing ? 'by') AND drawing->>'by' IS DISTINCT FROM 'ai')
     OR ((drawing->'meta' ? 'by') AND drawing->'meta'->>'by' IS DISTINCT FROM 'ai') THEN
    RAISE EXCEPTION 'Invalid AI drawing provenance or capacity' USING ERRCODE='22023';
   END IF;
   ai_meta := drawing->'meta'->'chart_ai';
   IF jsonb_typeof(ai_meta) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'AI drawing metadata required' USING ERRCODE='22023';
   END IF;
   IF ai_meta->>'schema' IS DISTINCT FROM 'chart.ai_drawing.v1'
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(ai_meta) keys(k)
       WHERE k NOT IN ('schema','command_id','op','batch_id','seq','caption','layer_hidden'))
     OR jsonb_typeof(ai_meta->'command_id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(ai_meta->'batch_id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(ai_meta->'op') IS DISTINCT FROM 'string'
     OR jsonb_typeof(ai_meta->'seq') IS DISTINCT FROM 'number'
     OR jsonb_typeof(ai_meta->'layer_hidden') IS DISTINCT FROM 'boolean'
     OR ((ai_meta ? 'caption') AND jsonb_typeof(ai_meta->'caption') IS DISTINCT FROM 'string') THEN
    RAISE EXCEPTION 'Invalid AI drawing metadata' USING ERRCODE='22023';
   END IF;
   IF left(drawing->>'id',3)<>'ai_' OR left(ai_meta->>'command_id',3)<>'ai_'
     OR (ai_meta->>'seq')::numeric<0 OR (ai_meta->>'seq')::numeric>9007199254740991
     OR mod((ai_meta->>'seq')::numeric,1)<>0 THEN
    RAISE EXCEPTION 'Invalid AI drawing identity or sequence' USING ERRCODE='22023';
   END IF;
   -- Match JavaScript string.length (UTF16 units), including supplementary Unicode.
   -- JSONB already refuses U+0000; the remaining C0 controls and DEL are checked here.
   FOR text_value,text_limit,text_min IN
    SELECT * FROM (VALUES
     (drawing->>'id',96,1),(ai_meta->>'command_id',64,1),
     (ai_meta->>'batch_id',40,1),(coalesce(ai_meta->>'caption',''),140,0)
    ) tokens(value,limit_units,min_units)
   LOOP
    SELECT char_length(text_value)+count(*) FILTER (WHERE ascii(substr(text_value,i,1))>65535)
      INTO text_units FROM generate_series(1,char_length(text_value)) chars(i);
    IF text_units<text_min OR text_units>text_limit OR text_value ~ control_chars THEN
     RAISE EXCEPTION 'Invalid AI metadata text' USING ERRCODE='22023';
    END IF;
   END LOOP;
   ai_op := ai_meta->>'op';
   IF NOT (
     (ai_op='draw.tool' AND kind=ANY(ai_tools))
     OR (ai_op IN ('draw.trendline','draw.channel','draw.path') AND kind='trendline')
     OR (ai_op='draw.ray' AND kind='ray')
     OR (ai_op='draw.hline' AND kind='hline')
     OR (ai_op='draw.zone' AND kind='rect')
     OR (ai_op='draw.fib' AND kind='fib')
     OR (ai_op IN ('draw.label','draw.marker') AND kind='text')
     OR (ai_op='draw.risk_box' AND kind IN ('rect','hline'))
   ) THEN
    RAISE EXCEPTION 'AI operation does not match native drawing kind' USING ERRCODE='22023';
   END IF;
   IF ai_count>1 AND ai_layer_hidden IS DISTINCT FROM (ai_meta->>'layer_hidden')::boolean THEN
    RAISE EXCEPTION 'Inconsistent AI layer visibility' USING ERRCODE='22023';
   END IF;
   ai_layer_hidden := (ai_meta->>'layer_hidden')::boolean;
  END IF;
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
   IF drawing->>'source'='ai' THEN
    IF price<=0 THEN
     RAISE EXCEPTION 'AI drawing requires a positive price and integer epoch time' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(point->'t')='string' THEN
     IF point->>'t' !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'AI drawing requires an integer epoch string' USING ERRCODE='22023';
     END IF;
    ELSIF mod((point->>'t')::numeric,1)<>0 THEN
     RAISE EXCEPTION 'AI drawing requires an integer numeric epoch' USING ERRCODE='22023';
    END IF;
    IF (point->>'t')::numeric<631152000 OR (point->>'t')::numeric>4102444800 THEN
     RAISE EXCEPTION 'AI drawing time outside supported range' USING ERRCODE='22023';
    END IF;
   END IF;
  END LOOP;
 END LOOP;
END;
$guard$;
REVOKE ALL ON FUNCTION public.validate_drawing_replace_input(text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
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
    RETURN jsonb_build_object('drawings','[]'::jsonb,'revision',NULL,'schemaVersion',1,'aiDrawingSchema','chart.ai_drawing.v1','shape','empty');
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
        OR left(btrim(d->>'id',trim_chars),3)='ai_'
        OR ((d ? 'source') AND d->>'source' IS DISTINCT FROM 'user')
        OR d->'meta' ? 'chart_ai') THEN
      RAISE EXCEPTION 'Generated legacy drawing cannot be replaced as user data' USING ERRCODE='22000';
    END IF;
    -- An empty legacy collection (every drawing deleted) aggregates to NULL.
    SELECT coalesce(jsonb_agg(jsonb_build_object('schemaVersion',1,'source','user') || d ORDER BY ordinal),'[]'::jsonb)
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
  RETURN jsonb_build_object('drawings',drawings,'revision',revision,'schemaVersion',1,'aiDrawingSchema','chart.ai_drawing.v1',
    'shape',CASE WHEN versioned THEN 'versioned' WHEN collection_count=1 THEN 'legacy_collection' ELSE 'legacy_rows' END,
    'collectionId',selected_row->>'id','metadata',metadata);
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.read_drawings_collection(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_drawings_collection(text) TO authenticated;

COMMIT;

-- down:
-- -- Automatic downgrade is deliberately refused; this statement restores nothing.
-- -- Manual pre-activation recovery requires proof that no mixed operation was ever accepted,
-- -- all relevant writers are quiesced, and no mixed attempt is in flight or EFFECT_UNKNOWN.
-- -- Empty current AI rows cannot prove that condition: prior_operations keeps hashes, not types.
-- -- Only then restore validate_drawing_replace_input and read_drawings_collection from
-- -- 0031 blob3dbb8ae55fab62d7324cd41c715805bd8df69cc6, together in one genuine transaction.
-- -- Verify the installed preimage and restored definitions. Retain the unchanged replace RPC,
-- -- function ownership/ACLs, table grants, RLS, rows, collection metadata and operation receipts.
-- -- If any mixed operation was accepted or remains unknown, retain mixed-compatible reads,
-- -- stop new affected work through the existing owner, and use a forward-compatible repair.
-- -- Never strip AI drawings or delete/rewrite attempt history to permit a downgrade.
-- DO $no_automatic_down$ BEGIN RAISE EXCEPTION '0050 has no automatic data-safe downgrade; follow the operation-history and exact-0031 restoration procedure' USING ERRCODE='55000'; END; $no_automatic_down$;

-- readback:
-- -- Compare complete definitions and catalog facts before/after against qualified source.
-- -- Names alone are insufficient because all three RPCs already exist under0031.
-- -- Only validator/reader definitions change. The replacement definition and ownership/ACLs
-- -- remain exact; authenticated_execute=true, anonymous_execute=false, prosecdef=false.
-- SELECT p.oid::regprocedure AS function_signature, p.proowner::regrole AS function_owner,
--   p.prosecdef, p.proconfig, p.proacl, pg_get_functiondef(p.oid) AS function_definition,
--   has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
--   has_function_privilege('anon',p.oid,'EXECUTE') AS anonymous_execute,
--   position('chart.ai_drawing.v1' IN pg_get_functiondef(p.oid)) > 0 AS declares_ai_capability
-- FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
-- WHERE n.nspname='public' AND p.proname IN ('validate_drawing_replace_input','read_drawings_collection','replace_drawings_collection')
-- ORDER BY p.oid::regprocedure::text;
-- -- Reader capability must change from false to true; qualified authenticated behavior is
-- -- separately required. Catalog text is not an accepted collection-read receipt.
-- SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='public.drawings'::regclass;
-- SELECT has_table_privilege('authenticated','public.drawings','UPDATE') AS authenticated_fence_privilege;
-- SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='drawings' ORDER BY policyname;
