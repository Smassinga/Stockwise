-- Phase A2.1/A2.2: introduce a reusable posting request ledger and apply
-- backend idempotency to existing Assembly/BOM posting only. This intentionally
-- does not change apply_stock_delta, valuation, POS, PO receiving, opening
-- stock import, sales-order shipping, finance posting, or production costing.

CREATE TABLE IF NOT EXISTS public.posting_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  operation_type text NOT NULL,
  request_key text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL,
  result_ref_type text,
  result_ref_id text,
  result_payload jsonb,
  error_code text,
  error_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT posting_requests_status_check
    CHECK (status IN ('in_progress', 'succeeded', 'failed')),
  CONSTRAINT posting_requests_request_key_not_blank
    CHECK (length(btrim(request_key)) > 0),
  CONSTRAINT posting_requests_payload_hash_not_blank
    CHECK (length(btrim(payload_hash)) > 0),
  CONSTRAINT posting_requests_unique_company_operation_key
    UNIQUE (company_id, operation_type, request_key)
);

CREATE INDEX IF NOT EXISTS posting_requests_company_operation_created_idx
  ON public.posting_requests (company_id, operation_type, created_at DESC);

CREATE INDEX IF NOT EXISTS posting_requests_status_updated_idx
  ON public.posting_requests (status, updated_at);

CREATE INDEX IF NOT EXISTS posting_requests_expires_at_idx
  ON public.posting_requests (expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE public.posting_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS posting_requests_select_active_company ON public.posting_requests;
CREATE POLICY posting_requests_select_active_company
  ON public.posting_requests
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

DROP TRIGGER IF EXISTS posting_requests_touch_updated_at ON public.posting_requests;
CREATE TRIGGER posting_requests_touch_updated_at
  BEFORE UPDATE ON public.posting_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at_column();

REVOKE ALL ON TABLE public.posting_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.posting_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.posting_requests TO service_role;

CREATE OR REPLACE FUNCTION public.post_build_from_bom(
  p_bom_id uuid,
  p_qty numeric,
  p_warehouse_from uuid,
  p_bin_from text,
  p_warehouse_to uuid,
  p_bin_to text,
  p_request_key text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_active_company_id uuid := public.current_company_id();
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_payload_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_build_id uuid;
BEGIN
  IF v_active_company_id IS NULL THEN
    RAISE EXCEPTION 'No active company selected' USING ERRCODE = '42501';
  END IF;

  IF v_request_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023';
  END IF;

  v_payload_hash := md5(jsonb_build_object(
    'company_id', v_active_company_id,
    'bom_id', p_bom_id,
    'qty', p_qty,
    'warehouse_from', p_warehouse_from,
    'bin_from', p_bin_from,
    'warehouse_to', p_warehouse_to,
    'bin_to', p_bin_to
  )::text);

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
        v_active_company_id,
        'assembly.build',
        v_request_key,
        v_payload_hash,
        'in_progress',
        auth.uid(),
        now() + interval '180 days'
      )
      RETURNING * INTO v_request;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      SELECT *
        INTO v_request
      FROM public.posting_requests pr
      WHERE pr.company_id = v_active_company_id
        AND pr.operation_type = 'assembly.build'
        AND pr.request_key = v_request_key
      FOR UPDATE;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      IF v_request.payload_hash IS DISTINCT FROM v_payload_hash THEN
        RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
      END IF;

      IF v_request.status = 'succeeded' THEN
        IF v_request.result_ref_id IS NULL THEN
          RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001';
        END IF;
        RETURN v_request.result_ref_id::uuid;
      ELSIF v_request.status = 'in_progress' THEN
        RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
      ELSE
        RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;

  v_build_id := public.build_from_bom(
    p_bom_id,
    p_qty,
    p_warehouse_from,
    p_bin_from,
    p_warehouse_to,
    p_bin_to
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'BUILD',
         result_ref_id = v_build_id::text,
         result_payload = jsonb_build_object('build_id', v_build_id),
         error_code = NULL,
         error_message = NULL
   WHERE id = v_request.id;

  RETURN v_build_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_build_from_bom_sources(
  p_bom_id uuid,
  p_qty numeric,
  p_component_sources jsonb,
  p_output_splits jsonb,
  p_request_key text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_active_company_id uuid := public.current_company_id();
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_payload_hash text;
  v_request public.posting_requests%ROWTYPE;

  v_company_id uuid;
  v_product_id uuid;
  v_build_id uuid := gen_random_uuid();
  v_component_count integer := 0;
  v_total_cost numeric := 0;
  v_total_qty numeric := 0;
  v_unit_cost_fg numeric := 0;

  v_comp record;
  v_need_qty numeric;
  v_need_qty_after_scrap numeric;
  v_source_entry_count integer;
  v_srcs jsonb;
  v_src jsonb;
  v_src_wh uuid;
  v_src_bin text;
  v_src_share numeric;
  v_sum_share numeric;
  v_issue_qty numeric;
  v_unit_cost numeric;

  v_out jsonb;
  v_out_wh uuid;
  v_out_bin text;
  v_out_qty numeric;
BEGIN
  IF v_active_company_id IS NULL THEN
    RAISE EXCEPTION 'No active company selected' USING ERRCODE = '42501';
  END IF;

  IF v_request_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023';
  END IF;

  v_payload_hash := md5(jsonb_build_object(
    'company_id', v_active_company_id,
    'bom_id', p_bom_id,
    'qty', p_qty,
    'component_sources', p_component_sources,
    'output_splits', p_output_splits
  )::text);

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
        v_active_company_id,
        'assembly.build_sources',
        v_request_key,
        v_payload_hash,
        'in_progress',
        auth.uid(),
        now() + interval '180 days'
      )
      RETURNING * INTO v_request;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      SELECT *
        INTO v_request
      FROM public.posting_requests pr
      WHERE pr.company_id = v_active_company_id
        AND pr.operation_type = 'assembly.build_sources'
        AND pr.request_key = v_request_key
      FOR UPDATE;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      IF v_request.payload_hash IS DISTINCT FROM v_payload_hash THEN
        RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
      END IF;

      IF v_request.status = 'succeeded' THEN
        IF v_request.result_ref_id IS NULL THEN
          RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001';
        END IF;
        RETURN v_request.result_ref_id::uuid;
      ELSIF v_request.status = 'in_progress' THEN
        RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
      ELSE
        RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be > 0' USING ERRCODE = '22023';
  END IF;

  IF p_component_sources IS NULL OR jsonb_typeof(p_component_sources) <> 'array' THEN
    RAISE EXCEPTION 'Component sources must be an array' USING ERRCODE = '22023';
  END IF;

  IF p_output_splits IS NULL OR jsonb_typeof(p_output_splits) <> 'array' THEN
    RAISE EXCEPTION 'Output splits must be an array' USING ERRCODE = '22023';
  END IF;

  SELECT b.company_id, b.product_id
    INTO v_company_id, v_product_id
  FROM public.boms b
  WHERE b.id = p_bom_id
    AND b.company_id = v_active_company_id
    AND b.is_active = true;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'BOM not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_company_role(
    v_company_id,
    ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.items i
    WHERE i.id = v_product_id
      AND i.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Finished item does not belong to the active company' USING ERRCODE = '42501';
  END IF;

  IF jsonb_array_length(p_output_splits) = 0 THEN
    RAISE EXCEPTION 'At least one output split (destination bin) is required' USING ERRCODE = '22023';
  END IF;

  FOR v_out IN SELECT * FROM jsonb_array_elements(p_output_splits) LOOP
    v_out_qty := COALESCE((v_out->>'qty')::numeric, 0);
    IF v_out_qty <= 0 THEN
      RAISE EXCEPTION 'Output split quantity must be > 0' USING ERRCODE = '22023';
    END IF;

    v_out_wh := (v_out->>'warehouse_id')::uuid;
    v_out_bin := (v_out->>'bin_id')::text;

    IF NOT EXISTS (
      SELECT 1
      FROM public.warehouses w
      WHERE w.id = v_out_wh
        AND w.company_id = v_company_id
    ) THEN
      RAISE EXCEPTION 'Destination warehouse does not belong to the active company' USING ERRCODE = '42501';
    END IF;

    IF v_out_bin IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.bins b
      WHERE b.id = v_out_bin
        AND b."warehouseId" = v_out_wh
        AND (b.company_id IS NULL OR b.company_id = v_company_id)
    ) THEN
      RAISE EXCEPTION 'Destination bin does not belong to the destination warehouse' USING ERRCODE = '42501';
    END IF;

    v_total_qty := v_total_qty + v_out_qty;
  END LOOP;

  IF abs(v_total_qty - p_qty) > 0.000001 THEN
    RAISE EXCEPTION 'Output split quantities must equal planned output quantity' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.builds(
    id, company_id, bom_id, product_id, qty,
    warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id,
    cost_total, created_by
  ) VALUES (
    v_build_id, v_company_id, p_bom_id, v_product_id, p_qty,
    NULL, NULL, NULL, NULL,
    0, auth.uid()
  );

  FOR v_comp IN
    SELECT c.component_item_id,
           c.qty_per,
           COALESCE(c.scrap_pct, 0) AS scrap_pct,
           i.company_id AS component_company_id
    FROM public.bom_components c
    LEFT JOIN public.items i ON i.id = c.component_item_id
    WHERE c.bom_id = p_bom_id
    ORDER BY c.created_at, c.id
  LOOP
    v_component_count := v_component_count + 1;

    IF v_comp.component_company_id IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'Component item does not belong to the active company' USING ERRCODE = '42501';
    END IF;

    v_need_qty := COALESCE(v_comp.qty_per, 0) * p_qty;
    v_need_qty_after_scrap := v_need_qty * (1 + COALESCE(v_comp.scrap_pct, 0));
    IF v_need_qty_after_scrap <= 0 THEN
      RAISE EXCEPTION 'Component required quantity must be > 0' USING ERRCODE = '22023';
    END IF;

    SELECT count(*)
      INTO v_source_entry_count
    FROM jsonb_to_recordset(COALESCE(p_component_sources, '[]'::jsonb))
      AS t(component_item_id uuid, sources jsonb)
    WHERE t.component_item_id = v_comp.component_item_id;

    IF v_source_entry_count = 1 THEN
      SELECT t.sources
        INTO v_srcs
      FROM jsonb_to_recordset(COALESCE(p_component_sources, '[]'::jsonb))
        AS t(component_item_id uuid, sources jsonb)
      WHERE t.component_item_id = v_comp.component_item_id
      LIMIT 1;
    END IF;

    IF v_source_entry_count <> 1 OR v_srcs IS NULL OR jsonb_typeof(v_srcs) <> 'array' THEN
      RAISE EXCEPTION 'Exactly one source list is required for component %', v_comp.component_item_id USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(v_srcs) = 0 THEN
      RAISE EXCEPTION 'Exactly one source list is required for component %', v_comp.component_item_id USING ERRCODE = '22023';
    END IF;

    v_sum_share := 0;
    FOR v_src IN SELECT * FROM jsonb_array_elements(v_srcs) LOOP
      v_src_share := COALESCE((v_src->>'share_pct')::numeric, 0);
      IF v_src_share < 0 THEN
        RAISE EXCEPTION 'share_pct cannot be negative for component %', v_comp.component_item_id USING ERRCODE = '22023';
      END IF;
      v_sum_share := v_sum_share + v_src_share;
    END LOOP;

    IF v_sum_share <= 0 THEN
      RAISE EXCEPTION 'Sum of share_pct must be > 0 for component %', v_comp.component_item_id USING ERRCODE = '22023';
    END IF;

    FOR v_src IN SELECT * FROM jsonb_array_elements(v_srcs) LOOP
      v_src_share := COALESCE((v_src->>'share_pct')::numeric, 0) / v_sum_share;
      IF v_src_share <= 0 THEN
        CONTINUE;
      END IF;

      v_src_wh := (v_src->>'warehouse_id')::uuid;
      v_src_bin := (v_src->>'bin_id')::text;
      v_issue_qty := v_need_qty_after_scrap * v_src_share;

      IF v_issue_qty <= 0 THEN
        RAISE EXCEPTION 'Component source quantity must be > 0' USING ERRCODE = '22023';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.warehouses w
        WHERE w.id = v_src_wh
          AND w.company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Source warehouse does not belong to the active company' USING ERRCODE = '42501';
      END IF;

      IF v_src_bin IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.bins b
        WHERE b.id = v_src_bin
          AND b."warehouseId" = v_src_wh
          AND (b.company_id IS NULL OR b.company_id = v_company_id)
      ) THEN
        RAISE EXCEPTION 'Source bin does not belong to the source warehouse' USING ERRCODE = '42501';
      END IF;

      SELECT sl.avg_cost
        INTO v_unit_cost
      FROM public.stock_levels sl
      WHERE sl.company_id = v_company_id
        AND sl.item_id = v_comp.component_item_id
        AND sl.warehouse_id = v_src_wh
        AND (
          (v_src_bin IS NULL AND sl.bin_id IS NULL)
          OR sl.bin_id = v_src_bin
        )
      LIMIT 1;

      v_unit_cost := COALESCE(v_unit_cost, 0);
      v_total_cost := v_total_cost + (v_issue_qty * v_unit_cost);

      INSERT INTO public.stock_movements(
        company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
        warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id,
        notes, ref_type, ref_id, created_by
      ) VALUES (
        v_company_id, 'issue', v_comp.component_item_id, NULL,
        v_issue_qty, v_issue_qty, v_unit_cost, v_issue_qty * v_unit_cost,
        v_src_wh, v_src_bin, NULL, NULL,
        'Production consumption (source split)', 'BUILD', v_build_id::text, auth.uid()::text
      );
    END LOOP;
  END LOOP;

  IF v_component_count = 0 THEN
    RAISE EXCEPTION 'BOM has no components' USING ERRCODE = '22023';
  END IF;

  v_unit_cost_fg := CASE WHEN v_total_qty > 0 THEN v_total_cost / v_total_qty ELSE 0 END;

  FOR v_out IN SELECT * FROM jsonb_array_elements(p_output_splits) LOOP
    v_out_wh := (v_out->>'warehouse_id')::uuid;
    v_out_bin := (v_out->>'bin_id')::text;
    v_out_qty := COALESCE((v_out->>'qty')::numeric, 0);

    INSERT INTO public.stock_movements(
      company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
      warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id,
      notes, ref_type, ref_id, created_by
    ) VALUES (
      v_company_id, 'receive', v_product_id, NULL,
      v_out_qty, v_out_qty, v_unit_cost_fg, v_out_qty * v_unit_cost_fg,
      NULL, NULL, v_out_wh, v_out_bin,
      'Production output (source split)', 'BUILD', v_build_id::text, auth.uid()::text
    );
  END LOOP;

  UPDATE public.builds
     SET cost_total = v_total_cost
   WHERE id = v_build_id
     AND company_id = v_company_id;

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'BUILD',
         result_ref_id = v_build_id::text,
         result_payload = jsonb_build_object('build_id', v_build_id),
         error_code = NULL,
         error_message = NULL
   WHERE id = v_request.id;

  RETURN v_build_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_build_from_bom(uuid, numeric, uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_build_from_bom(uuid, numeric, uuid, text, uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.post_build_from_bom_sources(uuid, numeric, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_build_from_bom_sources(uuid, numeric, jsonb, jsonb, text) TO authenticated;
