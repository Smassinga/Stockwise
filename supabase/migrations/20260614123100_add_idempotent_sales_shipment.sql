-- A2.4c: backend-authoritative, idempotent sales-order shipping.

CREATE OR REPLACE FUNCTION public.post_sales_shipment(
  p_company_id uuid,
  p_sales_order_id uuid,
  p_sales_order_line_id uuid,
  p_allocations jsonb,
  p_request_key text DEFAULT NULL
) RETURNS TABLE(
  sales_order_id uuid,
  sales_order_line_id uuid,
  movement_ids uuid[],
  shipped_qty numeric,
  remaining_qty numeric,
  sales_order_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_hash_allocations jsonb;
  v_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_so public.sales_orders%ROWTYPE;
  v_line public.sales_order_lines%ROWTYPE;
  v_total_qty numeric := 0;
  v_total_qty_base numeric := 0;
  v_remaining numeric := 0;
  v_row jsonb;
  v_row_no integer := 0;
  v_qty numeric;
  v_qty_base numeric;
  v_wh uuid;
  v_bin text;
  v_avg_cost numeric;
  v_movement_id uuid;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  IF v_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(COALESCE(p_allocations, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_allocations, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'shipment_allocations_required' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'warehouse_id', allocation ->> 'warehouse_id',
      'bin_id', NULLIF(btrim(COALESCE(allocation ->> 'bin_id', '')), ''),
      'qty', COALESCE(NULLIF(allocation ->> 'qty', '')::numeric, 0),
      'qty_base', COALESCE(NULLIF(allocation ->> 'qty_base', '')::numeric, 0)
    )
    ORDER BY ordinality
  ), '[]'::jsonb)
    INTO v_hash_allocations
  FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) WITH ORDINALITY AS rows(allocation, ordinality);

  v_hash := md5(jsonb_build_object(
    'company_id', p_company_id,
    'sales_order_id', p_sales_order_id,
    'sales_order_line_id', p_sales_order_line_id,
    'allocations', v_hash_allocations
  )::text);

  v_request := public.stockwise_claim_posting_request(
    p_company_id,
    'sales.ship',
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
      (v_request.result_payload ->> 'sales_order_id')::uuid,
      (v_request.result_payload ->> 'sales_order_line_id')::uuid,
      COALESCE(ARRAY(
        SELECT jsonb_array_elements_text(v_request.result_payload -> 'movement_ids')::uuid
      ), ARRAY[]::uuid[]),
      (v_request.result_payload ->> 'shipped_qty')::numeric,
      (v_request.result_payload ->> 'remaining_qty')::numeric,
      v_request.result_payload ->> 'sales_order_status';
    RETURN;
  ELSIF v_request.status = 'in_progress' AND v_request.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_so
  FROM public.sales_orders so
  WHERE so.id = p_sales_order_id
    AND so.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_order_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF lower(COALESCE(v_so.status::text, '')) IN ('draft', 'cancelled', 'canceled', 'closed') THEN
    RAISE EXCEPTION 'invalid_shipment_state' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_line
  FROM public.sales_order_lines sol
  WHERE sol.id = p_sales_order_line_id
    AND sol.so_id = p_sales_order_id
    AND sol.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_order_line_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_remaining := COALESCE(v_line.qty, 0) - COALESCE(v_line.shipped_qty, 0);
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'invalid_shipment_state' USING ERRCODE = 'P0001';
  END IF;

  movement_ids := ARRAY[]::uuid[];

  FOR v_row IN
    SELECT allocation
    FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) WITH ORDINALITY AS rows(allocation, ordinality)
    ORDER BY ordinality
  LOOP
    v_row_no := v_row_no + 1;
    v_qty := COALESCE(NULLIF(v_row ->> 'qty', '')::numeric, 0);
    v_qty_base := COALESCE(NULLIF(v_row ->> 'qty_base', '')::numeric, 0);
    v_wh := NULLIF(v_row ->> 'warehouse_id', '')::uuid;
    v_bin := NULLIF(btrim(COALESCE(v_row ->> 'bin_id', '')), '');
    v_avg_cost := NULL;

    IF v_qty <= 0 OR v_qty_base <= 0 THEN
      RAISE EXCEPTION 'shipment_allocation_quantity_required' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM public.warehouses w
    WHERE w.id = v_wh
      AND w.company_id = p_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001';
    END IF;

    PERFORM 1
    FROM public.bins b
    WHERE b.id = v_bin
      AND b.company_id = p_company_id
      AND b."warehouseId" = v_wh;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(sl.avg_cost, 0)
      INTO v_avg_cost
    FROM public.stock_levels sl
    WHERE sl.company_id = p_company_id
      AND sl.item_id = v_line.item_id
      AND sl.warehouse_id = v_wh
      AND sl.bin_id IS NOT DISTINCT FROM v_bin
      AND COALESCE(sl.qty, 0) >= v_qty_base
    LIMIT 1;

    IF v_avg_cost IS NULL THEN
      RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = 'P0001';
    END IF;

    v_total_qty := v_total_qty + v_qty;
    v_total_qty_base := v_total_qty_base + v_qty_base;

    IF v_total_qty > v_remaining + 0.000001 THEN
      RAISE EXCEPTION 'quantity_exceeds_remaining' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.stock_movements (
      company_id,
      type,
      item_id,
      uom_id,
      qty,
      qty_base,
      unit_cost,
      total_value,
      warehouse_from_id,
      bin_from_id,
      notes,
      created_by,
      ref_type,
      ref_id,
      ref_line_id
    ) VALUES (
      p_company_id,
      'issue',
      v_line.item_id,
      v_line.uom_id,
      v_qty,
      v_qty_base,
      v_avg_cost,
      round(v_avg_cost * v_qty_base, 6),
      v_wh,
      v_bin,
      'SO ' || COALESCE(v_so.order_no, v_so.public_id, left(v_so.id::text, 8)),
      v_user::text,
      'SO',
      p_sales_order_id::text,
      p_sales_order_line_id
    )
    RETURNING id INTO v_movement_id;

    movement_ids := movement_ids || v_movement_id;
  END LOOP;

  SELECT sol.shipped_qty,
         GREATEST(COALESCE(sol.qty, 0) - COALESCE(sol.shipped_qty, 0), 0),
         so.status::text
    INTO shipped_qty, remaining_qty, sales_order_status
  FROM public.sales_order_lines sol
  JOIN public.sales_orders so
    ON so.id = sol.so_id
  WHERE sol.id = p_sales_order_line_id
    AND sol.company_id = p_company_id;

  sales_order_id := p_sales_order_id;
  sales_order_line_id := p_sales_order_line_id;

  v_result := jsonb_build_object(
    'sales_order_id', sales_order_id,
    'sales_order_line_id', sales_order_line_id,
    'movement_ids', to_jsonb(movement_ids),
    'shipped_qty', shipped_qty,
    'remaining_qty', remaining_qty,
    'sales_order_status', sales_order_status
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'SO_SHIPMENT',
         result_ref_id = p_sales_order_line_id::text,
         result_payload = v_result,
         error_code = NULL,
         error_message = NULL
   WHERE id = v_request.id;

  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.post_sales_shipment(uuid, uuid, uuid, jsonb, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.post_sales_shipment(uuid, uuid, uuid, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_sales_shipment(uuid, uuid, uuid, jsonb, text)
  TO authenticated;

COMMENT ON FUNCTION public.post_sales_shipment(uuid, uuid, uuid, jsonb, text)
  IS 'Idempotent sales-order shipment posting. Uses posting_requests operation_type sales.ship and writes issue stock movements through the existing sales-shipment trigger path.';
