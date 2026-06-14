-- A2.4e/A2.4f: governed manual stock receipt, issue, transfer, and adjustment.

CREATE OR REPLACE FUNCTION public.post_stock_receipt(
  p_company_id uuid,
  p_item_id uuid,
  p_uom_id text,
  p_qty numeric,
  p_qty_base numeric,
  p_unit_cost numeric,
  p_warehouse_to_id uuid,
  p_bin_to_id text,
  p_ref_type text DEFAULT NULL,
  p_ref_id text DEFAULT NULL,
  p_ref_line_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS TABLE(
  movement_id uuid,
  qty_base numeric,
  stock_qty numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_ref_type text := upper(COALESCE(NULLIF(btrim(p_ref_type), ''), 'ADJUST'));
  v_ref_id text := NULLIF(btrim(p_ref_id), '');
  v_notes text := NULLIF(btrim(p_notes), '');
  v_qty numeric := COALESCE(p_qty, 0);
  v_qty_base numeric := COALESCE(p_qty_base, 0);
  v_unit_cost numeric := COALESCE(p_unit_cost, 0);
  v_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  IF v_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023';
  END IF;
  IF v_qty <= 0 OR v_qty_base <= 0 THEN
    RAISE EXCEPTION 'quantity_required' USING ERRCODE = '22023';
  END IF;
  IF v_unit_cost < 0 THEN
    RAISE EXCEPTION 'unit_cost_must_be_nonnegative' USING ERRCODE = '22023';
  END IF;
  IF v_ref_type NOT IN ('ADJUST', 'PO', 'WRITE_OFF', 'INTERNAL_USE') THEN
    RAISE EXCEPTION 'invalid_receipt_reference' USING ERRCODE = '22023';
  END IF;
  IF v_ref_type = 'PO' AND v_ref_id IS NULL THEN
    RAISE EXCEPTION 'reference_required' USING ERRCODE = '22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'company_id', p_company_id,
    'item_id', p_item_id,
    'uom_id', NULLIF(btrim(COALESCE(p_uom_id, '')), ''),
    'qty', v_qty,
    'qty_base', v_qty_base,
    'unit_cost', v_unit_cost,
    'warehouse_to_id', p_warehouse_to_id,
    'bin_to_id', NULLIF(btrim(COALESCE(p_bin_to_id, '')), ''),
    'ref_type', v_ref_type,
    'ref_id', v_ref_id,
    'ref_line_id', p_ref_line_id,
    'notes', v_notes
  )::text);

  v_request := public.stockwise_claim_posting_request(p_company_id, 'stock.receipt', v_request_key, v_hash);

  IF v_request.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;

  IF v_request.status = 'succeeded' THEN
    IF v_request.result_payload IS NULL THEN
      RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY
    SELECT
      (v_request.result_payload ->> 'movement_id')::uuid,
      (v_request.result_payload ->> 'qty_base')::numeric,
      (v_request.result_payload ->> 'stock_qty')::numeric;
    RETURN;
  ELSIF v_request.status = 'in_progress' AND v_request.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.items i WHERE i.id = p_item_id AND i.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.uoms u WHERE u.id = NULLIF(btrim(COALESCE(p_uom_id, '')), '');
  IF NOT FOUND THEN RAISE EXCEPTION 'uom_not_found' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.warehouses w WHERE w.id = p_warehouse_to_id AND w.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1
  FROM public.bins b
  WHERE b.id = p_bin_to_id
    AND b.company_id = p_company_id
    AND b."warehouseId" = p_warehouse_to_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001'; END IF;

  IF v_ref_type = 'PO' THEN
    IF p_ref_line_id IS NULL THEN
      RAISE EXCEPTION 'reference_line_required' USING ERRCODE = '22023';
    END IF;
    IF v_ref_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'purchase_order_reference_not_found' USING ERRCODE = 'P0001';
    END IF;

    PERFORM 1
    FROM public.purchase_orders po
    JOIN public.purchase_order_lines pol
      ON pol.po_id = po.id
     AND pol.company_id = po.company_id
    WHERE po.id = v_ref_id::uuid
      AND po.company_id = p_company_id
      AND pol.id = p_ref_line_id
      AND pol.item_id = p_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'purchase_order_reference_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.stock_movements (
    company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_to_id, bin_to_id, notes, created_by, ref_type, ref_id, ref_line_id
  ) VALUES (
    p_company_id, 'receive', p_item_id, p_uom_id, v_qty, v_qty_base, v_unit_cost, round(v_unit_cost * v_qty_base, 6),
    p_warehouse_to_id, p_bin_to_id, v_notes, v_user::text, v_ref_type, v_ref_id, p_ref_line_id
  )
  RETURNING id INTO movement_id;

  qty_base := v_qty_base;

  SELECT sl.qty
    INTO stock_qty
  FROM public.stock_levels sl
  WHERE sl.company_id = p_company_id
    AND sl.item_id = p_item_id
    AND sl.warehouse_id = p_warehouse_to_id
    AND sl.bin_id IS NOT DISTINCT FROM p_bin_to_id;

  v_result := jsonb_build_object('movement_id', movement_id, 'qty_base', qty_base, 'stock_qty', stock_qty);

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'STOCK_RECEIPT',
         result_ref_id = movement_id::text,
         result_payload = v_result,
         error_code = NULL,
         error_message = NULL
   WHERE id = v_request.id;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_stock_issue(
  p_company_id uuid,
  p_item_id uuid,
  p_uom_id text,
  p_qty numeric,
  p_qty_base numeric,
  p_warehouse_from_id uuid,
  p_bin_from_id text,
  p_unit_cost numeric DEFAULT NULL,
  p_ref_type text DEFAULT NULL,
  p_ref_id text DEFAULT NULL,
  p_ref_line_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS TABLE(
  movement_id uuid,
  qty_base numeric,
  stock_qty numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_ref_type text := upper(COALESCE(NULLIF(btrim(p_ref_type), ''), 'ADJUST'));
  v_ref_id text := NULLIF(btrim(p_ref_id), '');
  v_notes text := NULLIF(btrim(p_notes), '');
  v_qty numeric := COALESCE(p_qty, 0);
  v_qty_base numeric := COALESCE(p_qty_base, 0);
  v_unit_cost numeric;
  v_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  IF v_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023';
  END IF;
  IF v_qty <= 0 OR v_qty_base <= 0 THEN
    RAISE EXCEPTION 'quantity_required' USING ERRCODE = '22023';
  END IF;
  IF v_ref_type NOT IN ('ADJUST', 'SO', 'WRITE_OFF', 'INTERNAL_USE') THEN
    RAISE EXCEPTION 'invalid_issue_reference' USING ERRCODE = '22023';
  END IF;
  IF v_ref_type = 'SO' AND v_ref_id IS NULL THEN
    RAISE EXCEPTION 'reference_required' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(p_unit_cost, sl.avg_cost, 0)
    INTO v_unit_cost
  FROM public.stock_levels sl
  WHERE sl.company_id = p_company_id
    AND sl.item_id = p_item_id
    AND sl.warehouse_id = p_warehouse_from_id
    AND sl.bin_id IS NOT DISTINCT FROM p_bin_from_id
  LIMIT 1;

  v_unit_cost := COALESCE(v_unit_cost, 0);
  IF v_unit_cost < 0 THEN
    RAISE EXCEPTION 'unit_cost_must_be_nonnegative' USING ERRCODE = '22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'company_id', p_company_id,
    'item_id', p_item_id,
    'uom_id', NULLIF(btrim(COALESCE(p_uom_id, '')), ''),
    'qty', v_qty,
    'qty_base', v_qty_base,
    'warehouse_from_id', p_warehouse_from_id,
    'bin_from_id', NULLIF(btrim(COALESCE(p_bin_from_id, '')), ''),
    'unit_cost', v_unit_cost,
    'ref_type', v_ref_type,
    'ref_id', v_ref_id,
    'ref_line_id', p_ref_line_id,
    'notes', v_notes
  )::text);

  v_request := public.stockwise_claim_posting_request(p_company_id, 'stock.issue', v_request_key, v_hash);

  IF v_request.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;

  IF v_request.status = 'succeeded' THEN
    IF v_request.result_payload IS NULL THEN
      RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY
    SELECT
      (v_request.result_payload ->> 'movement_id')::uuid,
      (v_request.result_payload ->> 'qty_base')::numeric,
      (v_request.result_payload ->> 'stock_qty')::numeric;
    RETURN;
  ELSIF v_request.status = 'in_progress' AND v_request.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.items i WHERE i.id = p_item_id AND i.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.uoms u WHERE u.id = NULLIF(btrim(COALESCE(p_uom_id, '')), '');
  IF NOT FOUND THEN RAISE EXCEPTION 'uom_not_found' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.warehouses w WHERE w.id = p_warehouse_from_id AND w.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1
  FROM public.bins b
  WHERE b.id = p_bin_from_id
    AND b.company_id = p_company_id
    AND b."warehouseId" = p_warehouse_from_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001'; END IF;

  IF v_ref_type = 'SO' THEN
    IF p_ref_line_id IS NULL THEN
      RAISE EXCEPTION 'reference_line_required' USING ERRCODE = '22023';
    END IF;
    IF v_ref_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'sales_order_reference_not_found' USING ERRCODE = 'P0001';
    END IF;

    PERFORM 1
    FROM public.sales_orders so
    JOIN public.sales_order_lines sol
      ON sol.so_id = so.id
     AND sol.company_id = so.company_id
    WHERE so.id = v_ref_id::uuid
      AND so.company_id = p_company_id
      AND sol.id = p_ref_line_id
      AND sol.item_id = p_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'sales_order_reference_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.stock_movements (
    company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_from_id, bin_from_id, notes, created_by, ref_type, ref_id, ref_line_id
  ) VALUES (
    p_company_id, 'issue', p_item_id, p_uom_id, v_qty, v_qty_base, v_unit_cost, round(v_unit_cost * v_qty_base, 6),
    p_warehouse_from_id, p_bin_from_id, v_notes, v_user::text, v_ref_type, v_ref_id, p_ref_line_id
  )
  RETURNING id INTO movement_id;

  qty_base := v_qty_base;

  SELECT sl.qty
    INTO stock_qty
  FROM public.stock_levels sl
  WHERE sl.company_id = p_company_id
    AND sl.item_id = p_item_id
    AND sl.warehouse_id = p_warehouse_from_id
    AND sl.bin_id IS NOT DISTINCT FROM p_bin_from_id;

  v_result := jsonb_build_object('movement_id', movement_id, 'qty_base', qty_base, 'stock_qty', stock_qty);

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'STOCK_ISSUE',
         result_ref_id = movement_id::text,
         result_payload = v_result,
         error_code = NULL,
         error_message = NULL
   WHERE id = v_request.id;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_stock_transfer(
  p_company_id uuid,
  p_item_id uuid,
  p_uom_id text,
  p_qty numeric,
  p_qty_base numeric,
  p_warehouse_from_id uuid,
  p_bin_from_id text,
  p_warehouse_to_id uuid,
  p_bin_to_id text,
  p_notes text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS TABLE(
  transfer_ref text,
  issue_movement_id uuid,
  receipt_movement_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_notes text := NULLIF(btrim(p_notes), '');
  v_qty numeric := COALESCE(p_qty, 0);
  v_qty_base numeric := COALESCE(p_qty_base, 0);
  v_unit_cost numeric := 0;
  v_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  IF v_request_key IS NULL THEN RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023'; END IF;
  IF v_qty <= 0 OR v_qty_base <= 0 THEN RAISE EXCEPTION 'quantity_required' USING ERRCODE = '22023'; END IF;
  IF p_warehouse_from_id = p_warehouse_to_id AND p_bin_from_id IS NOT DISTINCT FROM p_bin_to_id THEN
    RAISE EXCEPTION 'same_source_destination' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sl.avg_cost, 0)
    INTO v_unit_cost
  FROM public.stock_levels sl
  WHERE sl.company_id = p_company_id
    AND sl.item_id = p_item_id
    AND sl.warehouse_id = p_warehouse_from_id
    AND sl.bin_id IS NOT DISTINCT FROM p_bin_from_id
    AND COALESCE(sl.qty, 0) >= v_qty_base
  LIMIT 1;

  IF v_unit_cost IS NULL THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = 'P0001';
  END IF;

  v_hash := md5(jsonb_build_object(
    'company_id', p_company_id,
    'item_id', p_item_id,
    'uom_id', NULLIF(btrim(COALESCE(p_uom_id, '')), ''),
    'qty', v_qty,
    'qty_base', v_qty_base,
    'warehouse_from_id', p_warehouse_from_id,
    'bin_from_id', NULLIF(btrim(COALESCE(p_bin_from_id, '')), ''),
    'warehouse_to_id', p_warehouse_to_id,
    'bin_to_id', NULLIF(btrim(COALESCE(p_bin_to_id, '')), ''),
    'notes', v_notes
  )::text);

  v_request := public.stockwise_claim_posting_request(p_company_id, 'stock.transfer', v_request_key, v_hash);

  IF v_request.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;

  IF v_request.status = 'succeeded' THEN
    IF v_request.result_payload IS NULL THEN RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001'; END IF;
    RETURN QUERY
    SELECT
      v_request.result_payload ->> 'transfer_ref',
      (v_request.result_payload ->> 'issue_movement_id')::uuid,
      (v_request.result_payload ->> 'receipt_movement_id')::uuid;
    RETURN;
  ELSIF v_request.status = 'in_progress' AND v_request.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.items i WHERE i.id = p_item_id AND i.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.uoms u WHERE u.id = NULLIF(btrim(COALESCE(p_uom_id, '')), '');
  IF NOT FOUND THEN RAISE EXCEPTION 'uom_not_found' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.warehouses w WHERE w.id = p_warehouse_from_id AND w.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'source_warehouse_not_found' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.warehouses w WHERE w.id = p_warehouse_to_id AND w.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'destination_warehouse_not_found' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.bins b WHERE b.id = p_bin_from_id AND b.company_id = p_company_id AND b."warehouseId" = p_warehouse_from_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'source_bin_not_found' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.bins b WHERE b.id = p_bin_to_id AND b.company_id = p_company_id AND b."warehouseId" = p_warehouse_to_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'destination_bin_not_found' USING ERRCODE = 'P0001'; END IF;

  transfer_ref := gen_random_uuid()::text;

  INSERT INTO public.stock_movements (
    company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_from_id, bin_from_id, notes, created_by, ref_type, ref_id
  ) VALUES (
    p_company_id, 'issue', p_item_id, p_uom_id, v_qty, v_qty_base, v_unit_cost, round(v_unit_cost * v_qty_base, 6),
    p_warehouse_from_id, p_bin_from_id, COALESCE(v_notes, 'Transfer issue'), v_user::text, 'TRANSFER', transfer_ref
  )
  RETURNING id INTO issue_movement_id;

  INSERT INTO public.stock_movements (
    company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_to_id, bin_to_id, notes, created_by, ref_type, ref_id
  ) VALUES (
    p_company_id, 'receive', p_item_id, p_uom_id, v_qty, v_qty_base, v_unit_cost, round(v_unit_cost * v_qty_base, 6),
    p_warehouse_to_id, p_bin_to_id, COALESCE(v_notes, 'Transfer receipt'), v_user::text, 'TRANSFER', transfer_ref
  )
  RETURNING id INTO receipt_movement_id;

  v_result := jsonb_build_object(
    'transfer_ref', transfer_ref,
    'issue_movement_id', issue_movement_id,
    'receipt_movement_id', receipt_movement_id
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'STOCK_TRANSFER',
         result_ref_id = transfer_ref,
         result_payload = v_result,
         error_code = NULL,
         error_message = NULL
   WHERE id = v_request.id;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_stock_adjustment(
  p_company_id uuid,
  p_item_id uuid,
  p_uom_id text,
  p_target_qty numeric,
  p_target_qty_base numeric,
  p_warehouse_id uuid,
  p_bin_id text,
  p_unit_cost numeric DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS TABLE(
  movement_id uuid,
  delta_qty_base numeric,
  final_qty_base numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_reason text := NULLIF(btrim(p_reason), '');
  v_target_qty numeric := COALESCE(p_target_qty, 0);
  v_target_qty_base numeric := COALESCE(p_target_qty_base, 0);
  v_current_qty numeric := 0;
  v_current_avg_cost numeric := 0;
  v_unit_cost numeric := COALESCE(p_unit_cost, 0);
  v_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  IF v_request_key IS NULL THEN RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023'; END IF;
  IF v_target_qty < 0 OR v_target_qty_base < 0 THEN RAISE EXCEPTION 'target_quantity_invalid' USING ERRCODE = '22023'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'adjustment_reason_required' USING ERRCODE = '22023'; END IF;

  v_hash := md5(jsonb_build_object(
    'company_id', p_company_id,
    'item_id', p_item_id,
    'uom_id', NULLIF(btrim(COALESCE(p_uom_id, '')), ''),
    'target_qty', v_target_qty,
    'target_qty_base', v_target_qty_base,
    'warehouse_id', p_warehouse_id,
    'bin_id', NULLIF(btrim(COALESCE(p_bin_id, '')), ''),
    'unit_cost', COALESCE(p_unit_cost, 0),
    'reason', v_reason
  )::text);

  v_request := public.stockwise_claim_posting_request(p_company_id, 'stock.adjustment', v_request_key, v_hash);

  IF v_request.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;

  IF v_request.status = 'succeeded' THEN
    IF v_request.result_payload IS NULL THEN RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001'; END IF;
    RETURN QUERY
    SELECT
      (v_request.result_payload ->> 'movement_id')::uuid,
      (v_request.result_payload ->> 'delta_qty_base')::numeric,
      (v_request.result_payload ->> 'final_qty_base')::numeric;
    RETURN;
  ELSIF v_request.status = 'in_progress' AND v_request.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.items i WHERE i.id = p_item_id AND i.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.uoms u WHERE u.id = NULLIF(btrim(COALESCE(p_uom_id, '')), '');
  IF NOT FOUND THEN RAISE EXCEPTION 'uom_not_found' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.warehouses w WHERE w.id = p_warehouse_id AND w.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.bins b WHERE b.id = p_bin_id AND b.company_id = p_company_id AND b."warehouseId" = p_warehouse_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT COALESCE(sl.qty, 0), COALESCE(sl.avg_cost, 0)
    INTO v_current_qty, v_current_avg_cost
  FROM public.stock_levels sl
  WHERE sl.company_id = p_company_id
    AND sl.item_id = p_item_id
    AND sl.warehouse_id = p_warehouse_id
    AND sl.bin_id IS NOT DISTINCT FROM p_bin_id
  FOR UPDATE;

  v_current_qty := COALESCE(v_current_qty, 0);
  v_current_avg_cost := COALESCE(v_current_avg_cost, 0);
  delta_qty_base := v_target_qty_base - v_current_qty;

  IF delta_qty_base = 0 THEN
    RAISE EXCEPTION 'no_stock_change' USING ERRCODE = '22023';
  END IF;

  IF delta_qty_base > 0 THEN
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION 'unit_cost_must_be_nonnegative' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.stock_movements (
      company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
      warehouse_to_id, bin_to_id, notes, created_by, ref_type
    ) VALUES (
      p_company_id, 'adjust', p_item_id, p_uom_id, v_target_qty, delta_qty_base, v_unit_cost, round(v_unit_cost * delta_qty_base, 6),
      p_warehouse_id, p_bin_id, v_reason, v_user::text, 'ADJUST'
    )
    RETURNING id INTO movement_id;
  ELSE
    INSERT INTO public.stock_movements (
      company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
      warehouse_from_id, bin_from_id, notes, created_by, ref_type
    ) VALUES (
      p_company_id, 'issue', p_item_id, p_uom_id, abs(delta_qty_base), abs(delta_qty_base), v_current_avg_cost, round(v_current_avg_cost * abs(delta_qty_base), 6),
      p_warehouse_id, p_bin_id, v_reason, v_user::text, 'ADJUST'
    )
    RETURNING id INTO movement_id;
  END IF;

  SELECT sl.qty
    INTO final_qty_base
  FROM public.stock_levels sl
  WHERE sl.company_id = p_company_id
    AND sl.item_id = p_item_id
    AND sl.warehouse_id = p_warehouse_id
    AND sl.bin_id IS NOT DISTINCT FROM p_bin_id;

  v_result := jsonb_build_object(
    'movement_id', movement_id,
    'delta_qty_base', delta_qty_base,
    'final_qty_base', final_qty_base
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'STOCK_ADJUSTMENT',
         result_ref_id = movement_id::text,
         result_payload = v_result,
         error_code = NULL,
         error_message = NULL
   WHERE id = v_request.id;

  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.post_stock_receipt(uuid, uuid, text, numeric, numeric, numeric, uuid, text, text, text, uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.post_stock_issue(uuid, uuid, text, numeric, numeric, uuid, text, numeric, text, text, uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.post_stock_transfer(uuid, uuid, text, numeric, numeric, uuid, text, uuid, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.post_stock_adjustment(uuid, uuid, text, numeric, numeric, uuid, text, numeric, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.post_stock_receipt(uuid, uuid, text, numeric, numeric, numeric, uuid, text, text, text, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_stock_issue(uuid, uuid, text, numeric, numeric, uuid, text, numeric, text, text, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_stock_transfer(uuid, uuid, text, numeric, numeric, uuid, text, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_stock_adjustment(uuid, uuid, text, numeric, numeric, uuid, text, numeric, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.post_stock_receipt(uuid, uuid, text, numeric, numeric, numeric, uuid, text, text, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_issue(uuid, uuid, text, numeric, numeric, uuid, text, numeric, text, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_transfer(uuid, uuid, text, numeric, numeric, uuid, text, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_adjustment(uuid, uuid, text, numeric, numeric, uuid, text, numeric, text, text) TO authenticated;

COMMENT ON FUNCTION public.post_stock_receipt(uuid, uuid, text, numeric, numeric, numeric, uuid, text, text, text, uuid, text, text)
  IS 'Idempotent governed manual stock receipt posting. Uses posting_requests operation_type stock.receipt.';
COMMENT ON FUNCTION public.post_stock_issue(uuid, uuid, text, numeric, numeric, uuid, text, numeric, text, text, uuid, text, text)
  IS 'Idempotent governed manual stock issue posting. Uses posting_requests operation_type stock.issue.';
COMMENT ON FUNCTION public.post_stock_transfer(uuid, uuid, text, numeric, numeric, uuid, text, uuid, text, text, text)
  IS 'Idempotent governed stock transfer posting with atomic paired issue and receipt movements. Uses operation_type stock.transfer.';
COMMENT ON FUNCTION public.post_stock_adjustment(uuid, uuid, text, numeric, numeric, uuid, text, numeric, text, text)
  IS 'Idempotent governed target-quantity stock adjustment posting. Uses posting_requests operation_type stock.adjustment.';

NOTIFY pgrst, 'reload schema';
