-- Growth Batches G3 stock-input preview, posting, reversal, and cost rollups.
-- These RPCs use stock_movements as the physical stock ledger and never update
-- stock_levels, finance tables, or items.unit_price directly.

CREATE OR REPLACE FUNCTION public.growth_batch_normalize_stock_input_lines(
  p_company_id uuid,
  p_lines jsonb
) RETURNS TABLE(
  line_no integer,
  item_id uuid,
  uom_id text,
  quantity numeric,
  source_warehouse_id uuid,
  source_bin_id text,
  line_notes text,
  line_notes_present boolean,
  item_name text,
  item_sku text,
  source_warehouse_name text,
  source_bin_code text,
  source_bin_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_raw record;
  v_item_text text;
  v_uom_text text;
  v_qty_text text;
  v_warehouse_text text;
  v_bin_text text;
  v_notes_present boolean;
  v_notes text;
  v_item public.items%ROWTYPE;
  v_warehouse public.warehouses%ROWTYPE;
  v_bin public.bins%ROWTYPE;
  v_item_id uuid;
  v_warehouse_id uuid;
  v_quantity numeric;
  v_bucket_key text;
  v_bucket_keys text[] := ARRAY[]::text[];
  v_uuid_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'growth_batch_input_lines_required' USING ERRCODE = '22023';
  END IF;

  FOR v_raw IN
    SELECT value, ordinality::integer AS ordinality
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_raw.value) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'growth_batch_input_lines_invalid' USING ERRCODE = '22023';
    END IF;

    v_item_text := NULLIF(btrim(COALESCE(v_raw.value ->> 'item_id', v_raw.value ->> 'itemId', '')), '');
    v_uom_text := NULLIF(btrim(COALESCE(v_raw.value ->> 'uom_id', v_raw.value ->> 'uomId', '')), '');
    v_qty_text := NULLIF(btrim(COALESCE(v_raw.value ->> 'quantity', v_raw.value ->> 'qty', '')), '');
    v_warehouse_text := NULLIF(btrim(COALESCE(v_raw.value ->> 'source_warehouse_id', v_raw.value ->> 'sourceWarehouseId', '')), '');
    v_bin_text := NULLIF(btrim(COALESCE(v_raw.value ->> 'source_bin_id', v_raw.value ->> 'sourceBinId', '')), '');
    v_notes_present := (v_raw.value ? 'line_notes') OR (v_raw.value ? 'lineNotes') OR (v_raw.value ? 'notes');
    v_notes := NULLIF(btrim(COALESCE(v_raw.value ->> 'line_notes', v_raw.value ->> 'lineNotes', v_raw.value ->> 'notes', '')), '');

    IF v_item_text IS NULL OR v_item_text !~* v_uuid_pattern THEN
      RAISE EXCEPTION 'growth_batch_input_lines_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_warehouse_text IS NULL OR v_warehouse_text !~* v_uuid_pattern THEN
      RAISE EXCEPTION 'growth_batch_input_source_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_bin_text IS NULL THEN
      RAISE EXCEPTION 'growth_batch_input_source_invalid' USING ERRCODE = '22023';
    END IF;

    v_item_id := v_item_text::uuid;
    v_warehouse_id := v_warehouse_text::uuid;
    BEGIN
      v_quantity := v_qty_text::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'growth_batch_input_quantity_invalid' USING ERRCODE = '22023';
    END;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'growth_batch_input_quantity_invalid' USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO v_item
    FROM public.items i
    WHERE i.id = v_item_id
      AND i.company_id = p_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_item.track_inventory, false) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'growth_batch_input_item_not_stock_tracked' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(btrim(COALESCE(v_item.base_uom_id, '')), '') IS NULL THEN
      RAISE EXCEPTION 'growth_batch_input_item_base_uom_required' USING ERRCODE = '22023';
    END IF;
    IF v_uom_text IS NOT NULL AND v_uom_text IS DISTINCT FROM v_item.base_uom_id THEN
      RAISE EXCEPTION 'growth_batch_input_uom_mismatch' USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO v_warehouse
    FROM public.warehouses w
    WHERE w.id = v_warehouse_id
      AND w.company_id = p_company_id
      AND COALESCE(w.status, 'active') = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'growth_batch_input_source_invalid' USING ERRCODE = 'P0001';
    END IF;

    SELECT *
      INTO v_bin
    FROM public.bins b
    WHERE b.id = v_bin_text
      AND b.company_id = p_company_id
      AND b."warehouseId" = v_warehouse_id
      AND COALESCE(b.status, 'active') = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'growth_batch_input_source_invalid' USING ERRCODE = 'P0001';
    END IF;

    v_bucket_key := v_item_id::text || '|' || v_warehouse_id::text || '|' || v_bin_text;
    IF v_bucket_key = ANY(v_bucket_keys) THEN
      RAISE EXCEPTION 'growth_batch_input_duplicate_bucket' USING ERRCODE = '22023';
    END IF;
    v_bucket_keys := array_append(v_bucket_keys, v_bucket_key);

    line_no := v_raw.ordinality;
    item_id := v_item_id;
    uom_id := v_item.base_uom_id;
    quantity := round(v_quantity::numeric, 12);
    source_warehouse_id := v_warehouse_id;
    source_bin_id := v_bin_text;
    line_notes := v_notes;
    line_notes_present := v_notes_present;
    item_name := v_item.name;
    item_sku := v_item.sku;
    source_warehouse_name := v_warehouse.name;
    source_bin_code := v_bin.code;
    source_bin_name := v_bin.name;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.growth_batch_recalculate_cost_rollups(
  p_company_id uuid,
  p_growth_batch_id uuid,
  p_updated_by uuid,
  p_latest_event_sequence integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_material_total numeric := 0;
  v_direct_total numeric := 0;
  v_harvested numeric := 0;
  v_total numeric := 0;
  v_remaining numeric := 0;
  v_result jsonb;
BEGIN
  SELECT
    round((
      COALESCE(sum(i.frozen_total_cost), 0)
      - COALESCE(sum(CASE WHEN r.id IS NULL THEN 0 ELSE r.frozen_total_cost END), 0)
    )::numeric, 6)
    INTO v_material_total
  FROM public.growth_batch_stock_inputs i
  LEFT JOIN public.growth_batch_stock_input_reversal_lines r
    ON r.original_stock_input_id = i.id
   AND r.company_id = i.company_id
  WHERE i.company_id = p_company_id
    AND i.growth_batch_id = p_growth_batch_id;

  SELECT round(COALESCE(sum(d.amount), 0)::numeric, 6)
    INTO v_direct_total
  FROM public.growth_batch_direct_costs d
  WHERE d.company_id = p_company_id
    AND d.growth_batch_id = p_growth_batch_id;

  SELECT COALESCE(gb.harvested_cost, 0)
    INTO v_harvested
  FROM public.growth_batches gb
  WHERE gb.id = p_growth_batch_id
    AND gb.company_id = p_company_id;

  v_material_total := COALESCE(v_material_total, 0);
  v_direct_total := COALESCE(v_direct_total, 0);
  v_harvested := COALESCE(v_harvested, 0);
  v_total := round((v_material_total + v_direct_total)::numeric, 6);
  v_remaining := round((v_total - v_harvested)::numeric, 6);

  IF v_material_total < 0 OR v_total < 0 OR v_remaining < 0 THEN
    RAISE EXCEPTION 'growth_batch_cost_rollup_negative' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);
  UPDATE public.growth_batches
     SET accumulated_material_cost = v_material_total,
         accumulated_direct_cost = v_direct_total,
         accumulated_total_cost = v_total,
         remaining_cost = v_remaining,
         latest_event_sequence = COALESCE(p_latest_event_sequence, latest_event_sequence),
         updated_by = p_updated_by
   WHERE id = p_growth_batch_id
     AND company_id = p_company_id;

  v_result := jsonb_build_object(
    'accumulated_material_cost', v_material_total,
    'accumulated_direct_cost', v_direct_total,
    'accumulated_total_cost', v_total,
    'harvested_cost', v_harvested,
    'remaining_cost', v_remaining
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_growth_batch_stock_input(
  p_batch_id uuid,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_lines jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_company_id uuid := public.current_company_id();
  v_user uuid;
  v_batch public.growth_batches%ROWTYPE;
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_line record;
  v_available numeric;
  v_unit_cost numeric;
  v_line_cost numeric;
  v_lines jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_material_delta numeric := 0;
  v_projected_material numeric;
  v_projected_total numeric;
  v_projected_remaining numeric;
  v_ready boolean := true;
BEGIN
  v_user := public.stockwise_require_operator_company(v_company_id);

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_batch_id
    AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_batch.status <> 'active' THEN
    RAISE EXCEPTION 'growth_batch_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF v_effective_date < v_batch.start_date THEN
    RAISE EXCEPTION 'growth_batch_input_date_before_start' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_input_date_in_future' USING ERRCODE = '22023';
  END IF;

  BEGIN
    FOR v_line IN
      SELECT *
      FROM public.growth_batch_normalize_stock_input_lines(v_company_id, p_lines)
      ORDER BY item_id, source_warehouse_id, source_bin_id, line_no
    LOOP
      SELECT COALESCE(sl.qty, 0), COALESCE(sl.avg_cost, 0)
        INTO v_available, v_unit_cost
      FROM public.stock_levels sl
      WHERE sl.company_id = v_company_id
        AND sl.item_id = v_line.item_id
        AND sl.warehouse_id = v_line.source_warehouse_id
        AND sl.bin_id IS NOT DISTINCT FROM v_line.source_bin_id
      LIMIT 1;

      v_available := COALESCE(v_available, 0);
      v_unit_cost := COALESCE(v_unit_cost, 0);
      v_line_cost := round((v_unit_cost * v_line.quantity)::numeric, 6);
      IF v_available < v_line.quantity THEN
        v_ready := false;
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'insufficient_stock',
          'line_no', v_line.line_no,
          'item_id', v_line.item_id,
          'available_quantity', v_available,
          'required_quantity', v_line.quantity,
          'shortage', round((v_line.quantity - v_available)::numeric, 12)
        ));
      END IF;

      v_material_delta := v_material_delta + v_line_cost;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'line_no', v_line.line_no,
        'item_id', v_line.item_id,
        'item_name', v_line.item_name,
        'item_sku', v_line.item_sku,
        'uom_id', v_line.uom_id,
        'quantity', v_line.quantity,
        'source_warehouse_id', v_line.source_warehouse_id,
        'source_warehouse_name', v_line.source_warehouse_name,
        'source_bin_id', v_line.source_bin_id,
        'source_bin_code', v_line.source_bin_code,
        'source_bin_name', v_line.source_bin_name,
        'available_quantity', v_available,
        'shortage', GREATEST(round((v_line.quantity - v_available)::numeric, 12), 0),
        'estimated_unit_cost', v_unit_cost,
        'estimated_line_cost', v_line_cost,
        'line_notes', v_line.line_notes
      ));
    END LOOP;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object(
      'batch_id', p_batch_id,
      'reference_no', v_batch.reference_no,
      'status', v_batch.status,
      'effective_date', v_effective_date,
      'ready', false,
      'blocking_reasons', jsonb_build_array(jsonb_build_object('code', SQLERRM)),
      'lines', '[]'::jsonb,
      'estimated_total_material_cost', 0,
      'current_material_cost', v_batch.accumulated_material_cost,
      'current_direct_cost', v_batch.accumulated_direct_cost,
      'current_total_cost', v_batch.accumulated_total_cost,
      'current_harvested_cost', v_batch.harvested_cost,
      'current_remaining_cost', v_batch.remaining_cost,
      'projected_material_cost', v_batch.accumulated_material_cost,
      'projected_total_cost', v_batch.accumulated_total_cost,
      'projected_remaining_cost', v_batch.remaining_cost
    );
  END;

  v_projected_material := round((v_batch.accumulated_material_cost + v_material_delta)::numeric, 6);
  v_projected_total := round((v_projected_material + v_batch.accumulated_direct_cost)::numeric, 6);
  v_projected_remaining := round((v_projected_total - v_batch.harvested_cost)::numeric, 6);

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'reference_no', v_batch.reference_no,
    'status', v_batch.status,
    'effective_date', v_effective_date,
    'ready', v_ready,
    'blocking_reasons', v_blockers,
    'lines', v_lines,
    'estimated_total_material_cost', round(v_material_delta::numeric, 6),
    'current_material_cost', v_batch.accumulated_material_cost,
    'current_direct_cost', v_batch.accumulated_direct_cost,
    'current_total_cost', v_batch.accumulated_total_cost,
    'current_harvested_cost', v_batch.harvested_cost,
    'current_remaining_cost', v_batch.remaining_cost,
    'projected_material_cost', v_projected_material,
    'projected_total_cost', v_projected_total,
    'projected_remaining_cost', v_projected_remaining
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_growth_batch_stock_input(
  p_batch_id uuid,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_lines jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_company_id uuid := public.current_company_id();
  v_user uuid;
  v_batch public.growth_batches%ROWTYPE;
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_notes text := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_notes_present boolean := p_notes IS NOT NULL;
  v_lines jsonb := '[]'::jsonb;
  v_processed_lines jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_event_id uuid;
  v_detail_id uuid;
  v_movement_id uuid;
  v_line record;
  v_line_json jsonb;
  v_available numeric;
  v_unit_cost numeric;
  v_line_cost numeric;
  v_material_delta numeric := 0;
  v_movements jsonb := '[]'::jsonb;
  v_rollups jsonb;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(v_company_id);

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_batch_id
    AND company_id = v_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_batch.status <> 'active' THEN
    RAISE EXCEPTION 'growth_batch_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF v_effective_date < v_batch.start_date THEN
    RAISE EXCEPTION 'growth_batch_input_date_before_start' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_input_date_in_future' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN
    SELECT *
    FROM public.growth_batch_normalize_stock_input_lines(v_company_id, p_lines)
    ORDER BY item_id, source_warehouse_id, source_bin_id, line_no
  LOOP
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_no', v_line.line_no,
      'item_id', v_line.item_id,
      'uom_id', v_line.uom_id,
      'quantity', round(v_line.quantity::numeric, 12),
      'source_warehouse_id', v_line.source_warehouse_id,
      'source_bin_id', v_line.source_bin_id,
      'line_notes_present', v_line.line_notes_present,
      'line_notes', v_line.line_notes
    ));
  END LOOP;
  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'growth_batch_input_lines_required' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'company_id', v_company_id,
    'batch_id', p_batch_id,
    'effective_date', v_effective_date,
    'notes_present', v_notes_present,
    'notes', v_notes,
    'lines', v_lines
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(v_company_id, 'growth.batch.input', p_request_key, v_hash);

  IF v_request.request_payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_request.request_status = 'succeeded' THEN
    RETURN v_request.request_result_payload;
  ELSIF NOT v_request.is_new AND v_request.request_status = 'in_progress' THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.request_status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  FOR v_line_json IN
    SELECT value
    FROM jsonb_array_elements(v_lines) AS t(value)
    ORDER BY
      value ->> 'item_id',
      value ->> 'source_warehouse_id',
      value ->> 'source_bin_id',
      (value ->> 'line_no')::integer
  LOOP
    SELECT COALESCE(sl.qty, 0), COALESCE(sl.avg_cost, 0)
      INTO v_available, v_unit_cost
    FROM public.stock_levels sl
    WHERE sl.company_id = v_company_id
      AND sl.item_id = (v_line_json ->> 'item_id')::uuid
      AND sl.warehouse_id = (v_line_json ->> 'source_warehouse_id')::uuid
      AND sl.bin_id IS NOT DISTINCT FROM (v_line_json ->> 'source_bin_id')
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = 'P0001';
    END IF;
    v_available := COALESCE(v_available, 0);
    v_unit_cost := COALESCE(v_unit_cost, 0);
    IF v_available < (v_line_json ->> 'quantity')::numeric THEN
      RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = 'P0001';
    END IF;

    v_line_cost := round((v_unit_cost * (v_line_json ->> 'quantity')::numeric)::numeric, 6);
    v_material_delta := v_material_delta + v_line_cost;
    v_processed_lines := v_processed_lines || jsonb_build_array(v_line_json || jsonb_build_object(
      'frozen_unit_cost', v_unit_cost,
      'frozen_total_cost', v_line_cost
    ));
  END LOOP;

  v_sequence := v_batch.latest_event_sequence + 1;
  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);

  INSERT INTO public.growth_batch_events (
    company_id,
    growth_batch_id,
    event_sequence,
    event_reference,
    event_type,
    event_at,
    event_date,
    material_cost_delta,
    direct_cost_delta,
    total_cost_delta,
    currency_code,
    notes,
    posting_request_id,
    created_by
  ) VALUES (
    v_company_id,
    p_batch_id,
    v_sequence,
    v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0'),
    'stock_input',
    now(),
    v_effective_date,
    round(v_material_delta::numeric, 6),
    0,
    round(v_material_delta::numeric, 6),
    v_batch.base_currency_code,
    v_notes,
    v_request.request_id,
    v_user
  )
  RETURNING id INTO v_event_id;

  FOR v_line_json IN
    SELECT value
    FROM jsonb_array_elements(v_processed_lines) AS t(value)
    ORDER BY
      value ->> 'item_id',
      value ->> 'source_warehouse_id',
      value ->> 'source_bin_id',
      (value ->> 'line_no')::integer
  LOOP
    v_detail_id := gen_random_uuid();

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
      v_company_id,
      'issue',
      (v_line_json ->> 'item_id')::uuid,
      v_line_json ->> 'uom_id',
      (v_line_json ->> 'quantity')::numeric,
      (v_line_json ->> 'quantity')::numeric,
      (v_line_json ->> 'frozen_unit_cost')::numeric,
      (v_line_json ->> 'frozen_total_cost')::numeric,
      (v_line_json ->> 'source_warehouse_id')::uuid,
      v_line_json ->> 'source_bin_id',
      COALESCE(v_notes, 'Growth Batch stock input ' || v_batch.reference_no),
      v_user::text,
      'GROWTH_BATCH_INPUT',
      v_event_id::text,
      v_detail_id
    )
    RETURNING id INTO v_movement_id;

    INSERT INTO public.growth_batch_stock_inputs (
      id,
      company_id,
      growth_batch_id,
      growth_batch_event_id,
      line_no,
      item_id,
      uom_id,
      quantity,
      source_warehouse_id,
      source_bin_id,
      frozen_unit_cost,
      frozen_total_cost,
      issue_movement_id,
      line_notes,
      created_by
    ) VALUES (
      v_detail_id,
      v_company_id,
      p_batch_id,
      v_event_id,
      (v_line_json ->> 'line_no')::integer,
      (v_line_json ->> 'item_id')::uuid,
      v_line_json ->> 'uom_id',
      (v_line_json ->> 'quantity')::numeric,
      (v_line_json ->> 'source_warehouse_id')::uuid,
      v_line_json ->> 'source_bin_id',
      (v_line_json ->> 'frozen_unit_cost')::numeric,
      (v_line_json ->> 'frozen_total_cost')::numeric,
      v_movement_id,
      v_line_json ->> 'line_notes',
      v_user
    );

    v_movements := v_movements || jsonb_build_array(jsonb_build_object(
      'line_no', (v_line_json ->> 'line_no')::integer,
      'detail_id', v_detail_id,
      'movement_id', v_movement_id,
      'item_id', (v_line_json ->> 'item_id')::uuid,
      'uom_id', v_line_json ->> 'uom_id',
      'quantity', (v_line_json ->> 'quantity')::numeric,
      'frozen_unit_cost', (v_line_json ->> 'frozen_unit_cost')::numeric,
      'frozen_total_cost', (v_line_json ->> 'frozen_total_cost')::numeric
    ));
  END LOOP;

  v_rollups := public.growth_batch_recalculate_cost_rollups(v_company_id, p_batch_id, v_user, v_sequence);

  v_result := jsonb_build_object(
    'batch_id', p_batch_id,
    'reference_no', v_batch.reference_no,
    'event_id', v_event_id,
    'event_sequence', v_sequence,
    'event_type', 'stock_input',
    'material_cost_delta', round(v_material_delta::numeric, 6),
    'currency_code', v_batch.base_currency_code,
    'movements', v_movements,
    'rollups', v_rollups
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'GROWTH_BATCH_EVENT',
         result_ref_id = v_event_id::text,
         result_payload = v_result,
         updated_at = now()
   WHERE id = v_request.request_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_growth_batch_stock_input(
  p_original_event_id uuid,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_reason text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_company_id uuid := public.current_company_id();
  v_user uuid;
  v_original_event public.growth_batch_events%ROWTYPE;
  v_batch public.growth_batches%ROWTYPE;
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_reversal_event_id uuid;
  v_reversal_line_id uuid;
  v_receipt_id uuid;
  v_line public.growth_batch_stock_inputs%ROWTYPE;
  v_material_delta numeric := 0;
  v_receipts jsonb := '[]'::jsonb;
  v_rollups jsonb;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_manager_company(v_company_id);
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reversal_reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_original_event
  FROM public.growth_batch_events e
  WHERE e.id = p_original_event_id
    AND e.company_id = v_company_id
  FOR UPDATE;
  IF NOT FOUND OR v_original_event.event_type <> 'stock_input' THEN
    RAISE EXCEPTION 'growth_batch_stock_input_original_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches gb
  WHERE gb.id = v_original_event.growth_batch_id
    AND gb.company_id = v_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_effective_date < v_original_event.event_date THEN
    RAISE EXCEPTION 'growth_batch_input_reversal_date_before_original' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_input_date_in_future' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'company_id', v_company_id,
    'original_event_id', p_original_event_id,
    'effective_date', v_effective_date,
    'reason', v_reason
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(v_company_id, 'growth.batch.input.reverse', p_request_key, v_hash);

  IF v_request.request_payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_request.request_status = 'succeeded' THEN
    RETURN v_request.request_result_payload;
  ELSIF NOT v_request.is_new AND v_request.request_status = 'in_progress' THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.request_status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.growth_batch_events e
  WHERE e.company_id = v_company_id
    AND e.original_event_id = p_original_event_id
    AND e.event_type = 'stock_input_reversal';
  IF FOUND THEN
    RAISE EXCEPTION 'growth_batch_stock_input_already_reversed' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(i.frozen_total_cost), 0)
    INTO v_material_delta
  FROM public.growth_batch_stock_inputs i
  WHERE i.company_id = v_company_id
    AND i.growth_batch_event_id = p_original_event_id;
  IF COALESCE(v_material_delta, 0) <= 0 THEN
    RAISE EXCEPTION 'growth_batch_stock_input_original_lines_missing' USING ERRCODE = 'P0001';
  END IF;

  v_sequence := v_batch.latest_event_sequence + 1;
  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);

  INSERT INTO public.growth_batch_events (
    company_id,
    growth_batch_id,
    event_sequence,
    event_reference,
    event_type,
    event_at,
    event_date,
    material_cost_delta,
    direct_cost_delta,
    total_cost_delta,
    currency_code,
    notes,
    reason,
    posting_request_id,
    original_event_id,
    created_by
  ) VALUES (
    v_company_id,
    v_batch.id,
    v_sequence,
    v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0'),
    'stock_input_reversal',
    now(),
    v_effective_date,
    -round(v_material_delta::numeric, 6),
    0,
    -round(v_material_delta::numeric, 6),
    v_original_event.currency_code,
    v_reason,
    v_reason,
    v_request.request_id,
    p_original_event_id,
    v_user
  )
  RETURNING id INTO v_reversal_event_id;

  FOR v_line IN
    SELECT *
    FROM public.growth_batch_stock_inputs i
    WHERE i.company_id = v_company_id
      AND i.growth_batch_event_id = p_original_event_id
    ORDER BY i.item_id, i.source_warehouse_id, i.source_bin_id, i.line_no
  LOOP
    v_reversal_line_id := gen_random_uuid();
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
      v_company_id,
      'receive',
      v_line.item_id,
      v_line.uom_id,
      v_line.quantity,
      v_line.quantity,
      v_line.frozen_unit_cost,
      v_line.frozen_total_cost,
      v_line.source_warehouse_id,
      v_line.source_bin_id,
      'Growth Batch stock input reversal ' || v_batch.reference_no || ': ' || v_reason,
      v_user::text,
      'GROWTH_BATCH_INPUT_REVERSAL',
      v_reversal_event_id::text,
      v_reversal_line_id
    )
    RETURNING id INTO v_receipt_id;

    INSERT INTO public.growth_batch_stock_input_reversal_lines (
      id,
      company_id,
      growth_batch_id,
      reversal_event_id,
      original_event_id,
      original_stock_input_id,
      line_no,
      item_id,
      uom_id,
      quantity,
      frozen_unit_cost,
      frozen_total_cost,
      destination_warehouse_id,
      destination_bin_id,
      receipt_movement_id,
      created_by
    ) VALUES (
      v_reversal_line_id,
      v_company_id,
      v_batch.id,
      v_reversal_event_id,
      p_original_event_id,
      v_line.id,
      v_line.line_no,
      v_line.item_id,
      v_line.uom_id,
      v_line.quantity,
      v_line.frozen_unit_cost,
      v_line.frozen_total_cost,
      v_line.source_warehouse_id,
      v_line.source_bin_id,
      v_receipt_id,
      v_user
    );

    v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
      'line_no', v_line.line_no,
      'original_stock_input_id', v_line.id,
      'reversal_line_id', v_reversal_line_id,
      'receipt_movement_id', v_receipt_id,
      'item_id', v_line.item_id,
      'uom_id', v_line.uom_id,
      'quantity', v_line.quantity,
      'frozen_unit_cost', v_line.frozen_unit_cost,
      'frozen_total_cost', v_line.frozen_total_cost
    ));
  END LOOP;

  v_rollups := public.growth_batch_recalculate_cost_rollups(v_company_id, v_batch.id, v_user, v_sequence);

  v_result := jsonb_build_object(
    'batch_id', v_batch.id,
    'reference_no', v_batch.reference_no,
    'event_id', v_reversal_event_id,
    'event_sequence', v_sequence,
    'event_type', 'stock_input_reversal',
    'original_event_id', p_original_event_id,
    'material_cost_delta', -round(v_material_delta::numeric, 6),
    'currency_code', v_original_event.currency_code,
    'receipt_movements', v_receipts,
    'reason', v_reason,
    'rollups', v_rollups
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'GROWTH_BATCH_EVENT',
         result_ref_id = v_reversal_event_id::text,
         result_payload = v_result,
         updated_at = now()
   WHERE id = v_request.request_id;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.growth_batch_normalize_stock_input_lines(uuid, jsonb) OWNER TO postgres;
ALTER FUNCTION public.growth_batch_recalculate_cost_rollups(uuid, uuid, uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.preview_growth_batch_stock_input(uuid, date, jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.post_growth_batch_stock_input(uuid, date, jsonb, text, text) OWNER TO postgres;
ALTER FUNCTION public.reverse_growth_batch_stock_input(uuid, date, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.growth_batch_normalize_stock_input_lines(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_batch_recalculate_cost_rollups(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_growth_batch_stock_input(uuid, date, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_growth_batch_stock_input(uuid, date, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_growth_batch_stock_input(uuid, date, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.preview_growth_batch_stock_input(uuid, date, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_growth_batch_stock_input(uuid, date, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_growth_batch_stock_input(uuid, date, text, text) TO authenticated;

COMMENT ON FUNCTION public.preview_growth_batch_stock_input(uuid, date, jsonb, text)
IS 'G3 non-mutating Growth Batch stock-input preview. It derives active company from session state and creates no rows or stock reservations.';

COMMENT ON FUNCTION public.post_growth_batch_stock_input(uuid, date, jsonb, text, text)
IS 'G3 governed physical stock-input posting. Creates one stock_input event, immutable input lines, stock issue movements, and material-cost rollups.';

COMMENT ON FUNCTION public.reverse_growth_batch_stock_input(uuid, date, text, text)
IS 'G3 MANAGER+ compensating reversal for one stock_input event. Creates receipt movements using original quantities and frozen costs.';
