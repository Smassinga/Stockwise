-- A2.4d: idempotent opening-stock import wrapper.

CREATE OR REPLACE FUNCTION public.post_opening_stock_import(
  p_company_id uuid,
  p_rows jsonb DEFAULT '[]'::jsonb,
  p_request_key text DEFAULT NULL
) RETURNS TABLE(
  imported_rows integer,
  bucket_count integer,
  total_qty_base numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_hash_rows jsonb;
  v_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_import record;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  IF v_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'opening_stock_rows_required' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'item_id', NULLIF(btrim(COALESCE(row_data ->> 'item_id', '')), ''),
      'uom_id', NULLIF(btrim(COALESCE(row_data ->> 'uom_id', '')), ''),
      'qty', COALESCE(NULLIF(row_data ->> 'qty', '')::numeric, 0),
      'qty_base', COALESCE(NULLIF(row_data ->> 'qty_base', '')::numeric, 0),
      'unit_cost', COALESCE(NULLIF(row_data ->> 'unit_cost', '')::numeric, 0),
      'total_value', COALESCE(NULLIF(row_data ->> 'total_value', '')::numeric, 0),
      'warehouse_to_id', NULLIF(btrim(COALESCE(row_data ->> 'warehouse_to_id', '')), ''),
      'bin_to_id', NULLIF(btrim(COALESCE(row_data ->> 'bin_to_id', '')), ''),
      'notes', NULLIF(btrim(COALESCE(row_data ->> 'notes', '')), '')
    )
    ORDER BY ordinality
  ), '[]'::jsonb)
    INTO v_hash_rows
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) WITH ORDINALITY AS rows(row_data, ordinality);

  v_hash := md5(jsonb_build_object(
    'company_id', p_company_id,
    'rows', v_hash_rows
  )::text);

  v_request := public.stockwise_claim_posting_request(
    p_company_id,
    'opening_stock.import',
    v_request_key,
    v_hash
  );

  IF v_request.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;

  IF v_request.status = 'succeeded' THEN
    IF v_request.result_payload IS NULL THEN
      RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY
    SELECT
      (v_request.result_payload ->> 'imported_rows')::integer,
      (v_request.result_payload ->> 'bucket_count')::integer,
      (v_request.result_payload ->> 'total_qty_base')::numeric;
    RETURN;
  ELSIF v_request.status = 'in_progress' AND v_request.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_import
  FROM public.import_opening_stock_batch(p_company_id, p_rows)
  LIMIT 1;

  imported_rows := COALESCE(v_import.imported_rows, 0);
  bucket_count := COALESCE(v_import.bucket_count, 0);
  total_qty_base := COALESCE(v_import.total_qty_base, 0);

  v_result := jsonb_build_object(
    'imported_rows', imported_rows,
    'bucket_count', bucket_count,
    'total_qty_base', total_qty_base
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'OPENING_STOCK_IMPORT',
         result_ref_id = v_request.id::text,
         result_payload = v_result,
         error_code = NULL,
         error_message = NULL
   WHERE id = v_request.id;

  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.post_opening_stock_import(uuid, jsonb, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.post_opening_stock_import(uuid, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_opening_stock_import(uuid, jsonb, text)
  TO authenticated;

COMMENT ON FUNCTION public.post_opening_stock_import(uuid, jsonb, text)
  IS 'Idempotent wrapper for opening-stock import. Uses posting_requests operation_type opening_stock.import and preserves canonical text UOM identifiers.';
