-- A2.4b: backend-authoritative, idempotent purchase receiving.
-- Adds shared internal guard helpers used by the remaining A2.4 stock-posting wrappers.

CREATE OR REPLACE FUNCTION public.stockwise_require_operator_company(
  p_company_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_active_company uuid := public.current_company_id();
  v_role public.member_role;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_required' USING ERRCODE = '22023';
  END IF;

  IF v_active_company IS NULL OR v_active_company <> p_company_id THEN
    RAISE EXCEPTION 'cross_company_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT cm.role
    INTO v_role
  FROM public.company_members cm
  WHERE cm.company_id = p_company_id
    AND cm.user_id = v_user
    AND cm.status = 'active'::public.member_status
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'cross_company_access_denied' USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN (
    'OWNER'::public.member_role,
    'ADMIN'::public.member_role,
    'MANAGER'::public.member_role,
    'OPERATOR'::public.member_role
  ) THEN
    RAISE EXCEPTION 'operator_role_required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.company_access_is_enabled(p_company_id) THEN
    RAISE EXCEPTION 'company_access_disabled' USING ERRCODE = '42501';
  END IF;

  RETURN v_user;
END;
$$;

ALTER FUNCTION public.stockwise_require_operator_company(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.stockwise_require_operator_company(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.stockwise_claim_posting_request(
  p_company_id uuid,
  p_operation_type text,
  p_request_key text,
  p_payload_hash text
) RETURNS public.posting_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_request public.posting_requests%ROWTYPE;
BEGIN
  IF NULLIF(btrim(COALESCE(p_request_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(COALESCE(p_operation_type, '')), '') IS NULL THEN
    RAISE EXCEPTION 'operation_type_required' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(COALESCE(p_payload_hash, '')), '') IS NULL THEN
    RAISE EXCEPTION 'payload_hash_required' USING ERRCODE = '22023';
  END IF;

  LOOP
    BEGIN
      INSERT INTO public.posting_requests (
        company_id,
        operation_type,
        request_key,
        payload_hash,
        status,
        created_by,
        expires_at
      ) VALUES (
        p_company_id,
        p_operation_type,
        NULLIF(btrim(p_request_key), ''),
        p_payload_hash,
        'in_progress',
        auth.uid(),
        now() + interval '180 days'
      )
      RETURNING * INTO v_request;

      RETURN v_request;
    EXCEPTION WHEN unique_violation THEN
      SELECT *
        INTO v_request
      FROM public.posting_requests pr
      WHERE pr.company_id = p_company_id
        AND pr.operation_type = p_operation_type
        AND pr.request_key = NULLIF(btrim(p_request_key), '')
      FOR UPDATE;

      IF FOUND THEN
        RETURN v_request;
      END IF;
    END;
  END LOOP;
END;
$$;

ALTER FUNCTION public.stockwise_claim_posting_request(uuid, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.stockwise_claim_posting_request(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_purchase_receipt(
  p_company_id uuid,
  p_purchase_order_id uuid,
  p_purchase_order_line_id uuid,
  p_item_id uuid,
  p_qty numeric,
  p_qty_base numeric,
  p_uom_id text,
  p_warehouse_to_id uuid,
  p_bin_to_id text,
  p_unit_cost numeric,
  p_notes text DEFAULT NULL,
  p_received_by text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS TABLE(
  movement_id uuid,
  purchase_order_id uuid,
  purchase_order_line_id uuid,
  received_qty numeric,
  remaining_qty numeric,
  purchase_order_status text,
  closed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_qty numeric := COALESCE(p_qty, 0);
  v_qty_base numeric := COALESCE(p_qty_base, 0);
  v_unit_cost numeric := COALESCE(p_unit_cost, 0);
  v_notes text := NULLIF(btrim(p_notes), '');
  v_received_by text := NULLIF(btrim(p_received_by), '');
  v_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_po public.purchase_orders%ROWTYPE;
  v_line public.purchase_order_lines%ROWTYPE;
  v_already_received numeric := 0;
  v_order_remaining numeric := 0;
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

  v_hash := md5(jsonb_build_object(
    'company_id', p_company_id,
    'purchase_order_id', p_purchase_order_id,
    'purchase_order_line_id', p_purchase_order_line_id,
    'item_id', p_item_id,
    'qty', v_qty,
    'qty_base', v_qty_base,
    'uom_id', NULLIF(btrim(COALESCE(p_uom_id, '')), ''),
    'warehouse_to_id', p_warehouse_to_id,
    'bin_to_id', NULLIF(btrim(COALESCE(p_bin_to_id, '')), ''),
    'unit_cost', v_unit_cost,
    'notes', v_notes,
    'received_by', v_received_by
  )::text);

  v_request := public.stockwise_claim_posting_request(
    p_company_id,
    'purchase.receive',
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
      (v_request.result_payload ->> 'movement_id')::uuid,
      (v_request.result_payload ->> 'purchase_order_id')::uuid,
      (v_request.result_payload ->> 'purchase_order_line_id')::uuid,
      (v_request.result_payload ->> 'received_qty')::numeric,
      (v_request.result_payload ->> 'remaining_qty')::numeric,
      v_request.result_payload ->> 'purchase_order_status',
      COALESCE((v_request.result_payload ->> 'closed')::boolean, false);
    RETURN;
  ELSIF v_request.status = 'in_progress' AND v_request.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_po
  FROM public.purchase_orders po
  WHERE po.id = p_purchase_order_id
    AND po.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_order_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF lower(COALESCE(v_po.status::text, '')) IN ('cancelled', 'canceled', 'closed') THEN
    RAISE EXCEPTION 'invalid_receipt_state' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_line
  FROM public.purchase_order_lines pol
  WHERE pol.id = p_purchase_order_line_id
    AND pol.po_id = p_purchase_order_id
    AND pol.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_order_line_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_line.item_id <> p_item_id THEN
    RAISE EXCEPTION 'purchase_receipt_item_mismatch' USING ERRCODE = '22023';
  END IF;

  IF v_line.uom_id IS DISTINCT FROM NULLIF(btrim(COALESCE(p_uom_id, '')), '') THEN
    RAISE EXCEPTION 'purchase_receipt_uom_mismatch' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.items i
  WHERE i.id = p_item_id
    AND i.company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.warehouses w
  WHERE w.id = p_warehouse_to_id
    AND w.company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.bins b
  WHERE b.id = p_bin_to_id
    AND b.company_id = p_company_id
    AND b."warehouseId" = p_warehouse_to_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(sm.qty), 0)
    INTO v_already_received
  FROM public.stock_movements sm
  WHERE sm.company_id = p_company_id
    AND sm.type = 'receive'
    AND sm.ref_type = 'PO'
    AND sm.ref_id = p_purchase_order_id::text
    AND sm.ref_line_id = p_purchase_order_line_id;

  v_order_remaining := COALESCE(v_line.qty, 0) - COALESCE(v_already_received, 0);
  IF v_qty > v_order_remaining + 0.000001 THEN
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
    warehouse_to_id,
    bin_to_id,
    notes,
    created_by,
    ref_type,
    ref_id,
    ref_line_id
  ) VALUES (
    p_company_id,
    'receive',
    p_item_id,
    v_line.uom_id,
    v_qty,
    v_qty_base,
    v_unit_cost,
    round(v_unit_cost * v_qty_base, 6),
    p_warehouse_to_id,
    p_bin_to_id,
    COALESCE(v_notes, 'PO ' || COALESCE(v_po.order_no, v_po.public_id, left(v_po.id::text, 8))),
    COALESCE(v_received_by, v_user::text),
    'PO',
    p_purchase_order_id::text,
    p_purchase_order_line_id
  )
  RETURNING id INTO movement_id;

  SELECT COALESCE(sum(sm.qty), 0)
    INTO received_qty
  FROM public.stock_movements sm
  WHERE sm.company_id = p_company_id
    AND sm.type = 'receive'
    AND sm.ref_type = 'PO'
    AND sm.ref_id = p_purchase_order_id::text
    AND sm.ref_line_id = p_purchase_order_line_id;

  SELECT COALESCE(t.closed, false)
    INTO closed
  FROM public.po_trim_and_close(p_company_id, p_purchase_order_id) t
  LIMIT 1;

  IF v_received_by IS NOT NULL THEN
    UPDATE public.purchase_orders po
       SET received_by = v_received_by,
           updated_at = now()
     WHERE po.id = p_purchase_order_id
       AND po.company_id = p_company_id;
  END IF;

  SELECT po.status::text
    INTO purchase_order_status
  FROM public.purchase_orders po
  WHERE po.id = p_purchase_order_id
    AND po.company_id = p_company_id;

  purchase_order_id := p_purchase_order_id;
  purchase_order_line_id := p_purchase_order_line_id;
  remaining_qty := GREATEST(COALESCE(v_line.qty, 0) - COALESCE(received_qty, 0), 0);

  v_result := jsonb_build_object(
    'movement_id', movement_id,
    'purchase_order_id', purchase_order_id,
    'purchase_order_line_id', purchase_order_line_id,
    'received_qty', received_qty,
    'remaining_qty', remaining_qty,
    'purchase_order_status', purchase_order_status,
    'closed', COALESCE(closed, false)
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'PO_RECEIPT',
         result_ref_id = movement_id::text,
         result_payload = v_result,
         error_code = NULL,
         error_message = NULL
   WHERE id = v_request.id;

  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.post_purchase_receipt(uuid, uuid, uuid, uuid, numeric, numeric, text, uuid, text, numeric, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.post_purchase_receipt(uuid, uuid, uuid, uuid, numeric, numeric, text, uuid, text, numeric, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_purchase_receipt(uuid, uuid, uuid, uuid, numeric, numeric, text, uuid, text, numeric, text, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.post_purchase_receipt(uuid, uuid, uuid, uuid, numeric, numeric, text, uuid, text, numeric, text, text, text)
  IS 'Idempotent purchase-order receipt posting. Uses posting_requests operation_type purchase.receive and writes one receipt stock movement plus PO receipt state in one transaction.';
