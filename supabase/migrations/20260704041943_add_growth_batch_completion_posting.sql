-- G5.2 governed Growth Batch completion posting.
-- Completion is lifecycle-only: no stock movement, stock-level update, finance row,
-- cost mutation, harvest output, sale, COGS, or item-price change is created here.

CREATE OR REPLACE FUNCTION public.growth_batch_completion_state_fingerprint(
  p_company_id uuid,
  p_growth_batch_id uuid,
  p_status text,
  p_current_primary_qty numeric,
  p_current_total_weight numeric,
  p_accumulated_total_cost numeric,
  p_harvested_cost numeric,
  p_remaining_cost numeric,
  p_latest_event_sequence integer
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
  SELECT md5(jsonb_build_object(
    'company_id', COALESCE(p_company_id::text, ''),
    'growth_batch_id', COALESCE(p_growth_batch_id::text, ''),
    'status', COALESCE(NULLIF(btrim(p_status), ''), ''),
    'current_primary_qty', CASE WHEN p_current_primary_qty IS NULL THEN NULL ELSE round(p_current_primary_qty::numeric, 12)::text END,
    'current_total_weight', CASE WHEN p_current_total_weight IS NULL THEN NULL ELSE round(p_current_total_weight::numeric, 12)::text END,
    'accumulated_total_cost', CASE WHEN p_accumulated_total_cost IS NULL THEN NULL ELSE round(p_accumulated_total_cost::numeric, 6)::text END,
    'harvested_cost', CASE WHEN p_harvested_cost IS NULL THEN NULL ELSE round(p_harvested_cost::numeric, 6)::text END,
    'remaining_cost', CASE WHEN p_remaining_cost IS NULL THEN NULL ELSE round(p_remaining_cost::numeric, 6)::text END,
    'latest_event_sequence', COALESCE(p_latest_event_sequence, 0)
  )::text);
$$;

CREATE OR REPLACE FUNCTION public.apply_growth_batch_completion_update(
  p_company_id uuid,
  p_growth_batch_id uuid,
  p_expected_status text,
  p_expected_latest_event_sequence integer,
  p_new_status text,
  p_new_event_sequence integer,
  p_user uuid,
  p_completed_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_batch public.growth_batches%ROWTYPE;
BEGIN
  IF current_setting('stockwise.growth_batch_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'growth_batch_rpc_required' USING ERRCODE = '42501';
  END IF;
  IF current_setting('stockwise.growth_batch_completion_update', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'growth_batch_completion_update_guard_required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_status NOT IN ('active', 'completed')
    OR p_new_status NOT IN ('active', 'completed')
    OR p_expected_status = p_new_status THEN
    RAISE EXCEPTION 'growth_batch_completion_status_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches gb
  WHERE gb.id = p_growth_batch_id
    AND gb.company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_batch.status IS DISTINCT FROM p_expected_status
    OR v_batch.latest_event_sequence IS DISTINCT FROM p_expected_latest_event_sequence THEN
    RAISE EXCEPTION 'growth_batch_completion_state_changed' USING ERRCODE = 'P0001';
  END IF;

  IF p_new_status = 'completed' THEN
    UPDATE public.growth_batches
       SET status = 'completed',
           latest_event_sequence = p_new_event_sequence,
           completed_by = p_user,
           completed_at = COALESCE(p_completed_at, now()),
           updated_by = p_user,
           updated_at = now()
     WHERE id = p_growth_batch_id
       AND company_id = p_company_id;
  ELSE
    UPDATE public.growth_batches
       SET status = 'active',
           latest_event_sequence = p_new_event_sequence,
           completed_by = NULL,
           completed_at = NULL,
           updated_by = p_user,
           updated_at = now()
     WHERE id = p_growth_batch_id
       AND company_id = p_company_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_growth_batch_completion(
  p_growth_batch_id uuid,
  p_effective_date date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_company_id uuid := public.current_company_id();
  v_user uuid;
  v_batch public.growth_batches%ROWTYPE;
  v_quantity numeric;
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_latest_state_date date;
  v_primary_uom_code text;
  v_weight_uom_code text;
  v_can_complete boolean := false;
  v_blockers jsonb := '[]'::jsonb;
  v_source_fingerprint text;
BEGIN
  v_user := public.stockwise_require_operator_company(v_company_id);

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_growth_batch_id
    AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_can_complete := public.has_company_role(
    v_company_id,
    ARRAY['OWNER','ADMIN','MANAGER']::public.member_role[]
  );
  IF NOT v_can_complete THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_completion_manager_required'));
  END IF;

  v_quantity := COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty);
  IF v_batch.status <> 'active' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_completion_status_invalid'));
  END IF;
  IF COALESCE(v_quantity, 0) <> 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_completion_quantity_remaining'));
  END IF;
  IF COALESCE(v_batch.current_total_weight, 0) <> 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_completion_weight_remaining'));
  END IF;
  IF COALESCE(v_batch.remaining_cost, 0) <> 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_completion_cost_remaining'));
  END IF;
  IF v_effective_date < v_batch.start_date THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_completion_date_before_start'));
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_completion_date_in_future'));
  END IF;

  SELECT max(e.event_date)
    INTO v_latest_state_date
  FROM public.growth_batch_events e
  WHERE e.company_id = v_company_id
    AND e.growth_batch_id = p_growth_batch_id
    AND (
      e.event_type IN (
        'activation',
        'direct_cost',
        'stock_input',
        'stock_input_reversal',
        'mortality',
        'mortality_reversal',
        'shrinkage',
        'shrinkage_reversal',
        'transfer',
        'transfer_reversal',
        'harvest',
        'harvest_reversal',
        'completion',
        'completion_reversal'
      )
      OR EXISTS (
        SELECT 1
        FROM public.growth_batch_measurements m
        WHERE m.growth_batch_event_id = e.id
          AND m.company_id = e.company_id
          AND m.growth_batch_id = e.growth_batch_id
          AND m.measurement_type = 'total_weight'
      )
    );
  IF v_latest_state_date IS NOT NULL AND v_effective_date < v_latest_state_date THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_completion_chronology_invalid'));
  END IF;

  SELECT u.code INTO v_primary_uom_code FROM public.uoms u WHERE u.id = v_batch.primary_uom_id;
  SELECT u.code INTO v_weight_uom_code FROM public.uoms u WHERE u.id = v_batch.weight_uom_id;

  v_source_fingerprint := public.growth_batch_completion_state_fingerprint(
    v_company_id,
    p_growth_batch_id,
    v_batch.status,
    v_quantity,
    v_batch.current_total_weight,
    v_batch.accumulated_total_cost,
    v_batch.harvested_cost,
    v_batch.remaining_cost,
    v_batch.latest_event_sequence
  );

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'batch_id', p_growth_batch_id,
    'reference_no', v_batch.reference_no,
    'name', v_batch.name,
    'batch_family', v_batch.batch_family,
    'status_before', v_batch.status,
    'status_after', 'completed',
    'effective_date', v_effective_date,
    'current_primary_qty', v_quantity,
    'primary_uom_id', v_batch.primary_uom_id,
    'primary_uom_code', v_primary_uom_code,
    'current_total_weight', v_batch.current_total_weight,
    'weight_uom_id', v_batch.weight_uom_id,
    'weight_uom_code', v_weight_uom_code,
    'accumulated_material_cost', v_batch.accumulated_material_cost,
    'accumulated_direct_cost', v_batch.accumulated_direct_cost,
    'accumulated_total_cost', v_batch.accumulated_total_cost,
    'harvested_cost', v_batch.harvested_cost,
    'remaining_cost', v_batch.remaining_cost,
    'latest_event_sequence', v_batch.latest_event_sequence,
    'source_fingerprint', v_source_fingerprint,
    'stock_effect', 'none',
    'finance_effect', 'none',
    'sale_effect', 'none',
    'cogs_effect', 'none',
    'explanation', 'completion_closes_batch_lifecycle_only'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_growth_batch(
  p_growth_batch_id uuid,
  p_request_key text,
  p_preview_fingerprint text,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_completion_reason text DEFAULT NULL,
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
  v_completion_reason text := public.growth_batch_normalize_location_description(p_completion_reason);
  v_notes text := public.growth_batch_normalize_location_description(p_notes);
  v_notes_present boolean := p_notes IS NOT NULL;
  v_expected_fingerprint text := NULLIF(btrim(COALESCE(p_preview_fingerprint, '')), '');
  v_current_fingerprint text;
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_quantity numeric;
  v_latest_state_date date;
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_event_id uuid;
  v_event_reference text;
  v_completion_id uuid := gen_random_uuid();
  v_completed_at timestamptz := now();
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_manager_company(v_company_id);

  IF v_expected_fingerprint IS NULL THEN
    RAISE EXCEPTION 'growth_batch_completion_source_fingerprint_required' USING ERRCODE = '22023';
  END IF;
  IF v_completion_reason IS NULL THEN
    RAISE EXCEPTION 'growth_batch_completion_reason_required' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'company_id', v_company_id,
    'batch_id', p_growth_batch_id,
    'effective_date', v_effective_date,
    'completion_reason', v_completion_reason,
    'notes_present', v_notes_present,
    'notes', v_notes,
    'preview_fingerprint', v_expected_fingerprint
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(v_company_id, 'growth.batch.complete', p_request_key, v_hash);

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

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_growth_batch_id
    AND company_id = v_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_batch.status <> 'active' THEN
    RAISE EXCEPTION 'growth_batch_completion_status_invalid' USING ERRCODE = 'P0001';
  END IF;

  v_quantity := COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty);
  v_current_fingerprint := public.growth_batch_completion_state_fingerprint(
    v_company_id,
    p_growth_batch_id,
    v_batch.status,
    v_quantity,
    v_batch.current_total_weight,
    v_batch.accumulated_total_cost,
    v_batch.harvested_cost,
    v_batch.remaining_cost,
    v_batch.latest_event_sequence
  );
  IF v_current_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
    RAISE EXCEPTION 'growth_batch_completion_stale_source' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_quantity, 0) <> 0 THEN
    RAISE EXCEPTION 'growth_batch_completion_quantity_remaining' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_batch.current_total_weight, 0) <> 0 THEN
    RAISE EXCEPTION 'growth_batch_completion_weight_remaining' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_batch.remaining_cost, 0) <> 0 THEN
    RAISE EXCEPTION 'growth_batch_completion_cost_remaining' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date < v_batch.start_date THEN
    RAISE EXCEPTION 'growth_batch_completion_date_before_start' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_completion_date_in_future' USING ERRCODE = '22023';
  END IF;

  SELECT max(e.event_date)
    INTO v_latest_state_date
  FROM public.growth_batch_events e
  WHERE e.company_id = v_company_id
    AND e.growth_batch_id = p_growth_batch_id
    AND (
      e.event_type IN (
        'activation',
        'direct_cost',
        'stock_input',
        'stock_input_reversal',
        'mortality',
        'mortality_reversal',
        'shrinkage',
        'shrinkage_reversal',
        'transfer',
        'transfer_reversal',
        'harvest',
        'harvest_reversal',
        'completion',
        'completion_reversal'
      )
      OR EXISTS (
        SELECT 1
        FROM public.growth_batch_measurements m
        WHERE m.growth_batch_event_id = e.id
          AND m.company_id = e.company_id
          AND m.growth_batch_id = e.growth_batch_id
          AND m.measurement_type = 'total_weight'
      )
    );
  IF v_latest_state_date IS NOT NULL AND v_effective_date < v_latest_state_date THEN
    RAISE EXCEPTION 'growth_batch_completion_chronology_invalid' USING ERRCODE = '22023';
  END IF;

  v_sequence := v_batch.latest_event_sequence + 1;
  v_event_reference := v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0');

  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);
  PERFORM set_config('stockwise.growth_batch_completion_update', 'on', true);

  INSERT INTO public.growth_batch_events (
    company_id,
    growth_batch_id,
    event_sequence,
    event_reference,
    event_type,
    event_at,
    event_date,
    quantity_delta,
    weight_delta,
    weight_uom_id,
    material_cost_delta,
    direct_cost_delta,
    total_cost_delta,
    currency_code,
    notes,
    reason,
    posting_request_id,
    created_by
  ) VALUES (
    v_company_id,
    p_growth_batch_id,
    v_sequence,
    v_event_reference,
    'completion',
    now(),
    v_effective_date,
    0,
    CASE WHEN v_batch.current_total_weight IS NULL THEN NULL ELSE 0 END,
    CASE WHEN v_batch.current_total_weight IS NULL THEN NULL ELSE v_batch.weight_uom_id END,
    0,
    0,
    0,
    v_batch.base_currency_code,
    v_notes,
    v_completion_reason,
    v_request.request_id,
    v_user
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.growth_batch_completions (
    id,
    company_id,
    growth_batch_id,
    event_id,
    event_sequence,
    event_reference,
    status_before,
    status_after,
    current_primary_qty,
    primary_uom_id,
    current_total_weight,
    weight_uom_id,
    accumulated_material_cost,
    accumulated_direct_cost,
    accumulated_total_cost,
    harvested_cost,
    remaining_cost,
    source_state_fingerprint,
    completion_reason,
    effective_date,
    notes,
    completed_by,
    completed_at
  ) VALUES (
    v_completion_id,
    v_company_id,
    p_growth_batch_id,
    v_event_id,
    v_sequence,
    v_event_reference,
    'active',
    'completed',
    v_quantity,
    v_batch.primary_uom_id,
    v_batch.current_total_weight,
    CASE WHEN v_batch.current_total_weight IS NULL THEN NULL ELSE v_batch.weight_uom_id END,
    v_batch.accumulated_material_cost,
    v_batch.accumulated_direct_cost,
    v_batch.accumulated_total_cost,
    v_batch.harvested_cost,
    v_batch.remaining_cost,
    v_current_fingerprint,
    v_completion_reason,
    v_effective_date,
    v_notes,
    v_user,
    v_completed_at
  );

  PERFORM public.apply_growth_batch_completion_update(
    v_company_id,
    p_growth_batch_id,
    'active',
    v_batch.latest_event_sequence,
    'completed',
    v_sequence,
    v_user,
    v_completed_at
  );

  v_result := jsonb_build_object(
    'batch_id', p_growth_batch_id,
    'reference_no', v_batch.reference_no,
    'event_id', v_event_id,
    'event_reference', v_event_reference,
    'event_sequence', v_sequence,
    'event_type', 'completion',
    'completion_detail_id', v_completion_id,
    'status_before', 'active',
    'status_after', 'completed',
    'completion_reason', v_completion_reason,
    'effective_date', v_effective_date,
    'completed_at', v_completed_at,
    'request_id', v_request.request_id,
    'request_status', 'succeeded'
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

CREATE OR REPLACE FUNCTION public.reverse_growth_batch_completion(
  p_original_event_id uuid,
  p_request_key text,
  p_reason text,
  p_effective_date date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_company_id uuid := public.current_company_id();
  v_user uuid;
  v_reason text := public.growth_batch_normalize_location_description(p_reason);
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_original_event public.growth_batch_events%ROWTYPE;
  v_completion public.growth_batch_completions%ROWTYPE;
  v_existing_reversal public.growth_batch_completion_reversal_lines%ROWTYPE;
  v_batch public.growth_batches%ROWTYPE;
  v_current_fingerprint text;
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_reversal_event_id uuid;
  v_event_reference text;
  v_reversal_line_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_manager_company(v_company_id);
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reversal_reason_required' USING ERRCODE = '22023';
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
  FROM public.stockwise_claim_growth_request(v_company_id, 'growth.batch.complete.reverse', p_request_key, v_hash);

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

  SELECT *
    INTO v_original_event
  FROM public.growth_batch_events e
  WHERE e.id = p_original_event_id
    AND e.company_id = v_company_id
  FOR UPDATE;
  IF NOT FOUND OR v_original_event.event_type <> 'completion' THEN
    RAISE EXCEPTION 'growth_batch_completion_original_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_completion
  FROM public.growth_batch_completions c
  WHERE c.event_id = p_original_event_id
    AND c.company_id = v_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_completion_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches gb
  WHERE gb.id = v_completion.growth_batch_id
    AND gb.company_id = v_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_batch.status <> 'completed' THEN
    RAISE EXCEPTION 'growth_batch_completion_reversal_status_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_existing_reversal
  FROM public.growth_batch_completion_reversal_lines r
  WHERE r.original_completion_id = v_completion.id
    AND r.company_id = v_company_id
  FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'growth_batch_completion_already_reversed' USING ERRCODE = 'P0001';
  END IF;

  IF v_batch.latest_event_sequence IS DISTINCT FROM v_original_event.event_sequence
    OR EXISTS (
      SELECT 1
      FROM public.growth_batch_events later
      WHERE later.company_id = v_company_id
        AND later.growth_batch_id = v_completion.growth_batch_id
        AND later.event_sequence > v_original_event.event_sequence
    ) THEN
    RAISE EXCEPTION 'growth_batch_completion_reversal_dependency_exists' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty) IS DISTINCT FROM v_completion.current_primary_qty
    OR v_batch.current_total_weight IS DISTINCT FROM v_completion.current_total_weight
    OR v_batch.accumulated_material_cost IS DISTINCT FROM v_completion.accumulated_material_cost
    OR v_batch.accumulated_direct_cost IS DISTINCT FROM v_completion.accumulated_direct_cost
    OR v_batch.accumulated_total_cost IS DISTINCT FROM v_completion.accumulated_total_cost
    OR v_batch.harvested_cost IS DISTINCT FROM v_completion.harvested_cost
    OR v_batch.remaining_cost IS DISTINCT FROM v_completion.remaining_cost THEN
    RAISE EXCEPTION 'growth_batch_completion_current_state_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF v_effective_date < v_original_event.event_date THEN
    RAISE EXCEPTION 'growth_batch_completion_reversal_date_before_original' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_completion_date_in_future' USING ERRCODE = '22023';
  END IF;

  v_current_fingerprint := public.growth_batch_completion_state_fingerprint(
    v_company_id,
    v_completion.growth_batch_id,
    v_batch.status,
    COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty),
    v_batch.current_total_weight,
    v_batch.accumulated_total_cost,
    v_batch.harvested_cost,
    v_batch.remaining_cost,
    v_batch.latest_event_sequence
  );

  v_sequence := v_batch.latest_event_sequence + 1;
  v_event_reference := v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0');

  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);
  PERFORM set_config('stockwise.growth_batch_completion_update', 'on', true);

  INSERT INTO public.growth_batch_events (
    company_id,
    growth_batch_id,
    event_sequence,
    event_reference,
    event_type,
    event_at,
    event_date,
    quantity_delta,
    weight_delta,
    weight_uom_id,
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
    v_completion.growth_batch_id,
    v_sequence,
    v_event_reference,
    'completion_reversal',
    now(),
    v_effective_date,
    0,
    CASE WHEN v_completion.current_total_weight IS NULL THEN NULL ELSE 0 END,
    CASE WHEN v_completion.current_total_weight IS NULL THEN NULL ELSE v_completion.weight_uom_id END,
    0,
    0,
    0,
    v_original_event.currency_code,
    v_reason,
    v_reason,
    v_request.request_id,
    p_original_event_id,
    v_user
  )
  RETURNING id INTO v_reversal_event_id;

  INSERT INTO public.growth_batch_completion_reversal_lines (
    id,
    company_id,
    growth_batch_id,
    reversal_event_id,
    original_event_id,
    original_completion_id,
    event_sequence,
    event_reference,
    status_before,
    status_after,
    restored_status,
    current_primary_qty,
    primary_uom_id,
    current_total_weight,
    weight_uom_id,
    accumulated_material_cost,
    accumulated_direct_cost,
    accumulated_total_cost,
    harvested_cost,
    remaining_cost,
    source_state_fingerprint,
    reversal_reason,
    reversed_by
  ) VALUES (
    v_reversal_line_id,
    v_company_id,
    v_completion.growth_batch_id,
    v_reversal_event_id,
    p_original_event_id,
    v_completion.id,
    v_sequence,
    v_event_reference,
    'completed',
    'active',
    'active',
    v_completion.current_primary_qty,
    v_completion.primary_uom_id,
    v_completion.current_total_weight,
    v_completion.weight_uom_id,
    v_completion.accumulated_material_cost,
    v_completion.accumulated_direct_cost,
    v_completion.accumulated_total_cost,
    v_completion.harvested_cost,
    v_completion.remaining_cost,
    v_current_fingerprint,
    v_reason,
    v_user
  );

  PERFORM public.apply_growth_batch_completion_update(
    v_company_id,
    v_completion.growth_batch_id,
    'completed',
    v_batch.latest_event_sequence,
    'active',
    v_sequence,
    v_user,
    NULL
  );

  v_result := jsonb_build_object(
    'batch_id', v_completion.growth_batch_id,
    'reference_no', v_batch.reference_no,
    'event_id', v_reversal_event_id,
    'event_reference', v_event_reference,
    'event_sequence', v_sequence,
    'event_type', 'completion_reversal',
    'original_event_id', p_original_event_id,
    'original_completion_id', v_completion.id,
    'reversal_detail_id', v_reversal_line_id,
    'status_before', 'completed',
    'status_after', 'active',
    'reason', v_reason,
    'effective_date', v_effective_date,
    'request_id', v_request.request_id,
    'request_status', 'succeeded'
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

ALTER FUNCTION public.growth_batch_completion_state_fingerprint(uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, integer) OWNER TO postgres;
ALTER FUNCTION public.apply_growth_batch_completion_update(uuid, uuid, text, integer, text, integer, uuid, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.preview_growth_batch_completion(uuid, date) OWNER TO postgres;
ALTER FUNCTION public.complete_growth_batch(uuid, text, text, date, text, text) OWNER TO postgres;
ALTER FUNCTION public.reverse_growth_batch_completion(uuid, text, text, date) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.growth_batch_completion_state_fingerprint(uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_growth_batch_completion_update(uuid, uuid, text, integer, text, integer, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_growth_batch_completion(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_growth_batch(uuid, text, text, date, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_growth_batch_completion(uuid, text, text, date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.preview_growth_batch_completion(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_growth_batch(uuid, text, text, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_growth_batch_completion(uuid, text, text, date) TO authenticated;

GRANT SELECT ON public.growth_batch_completion_history TO authenticated;
GRANT SELECT ON public.growth_batch_completion_history TO service_role;

COMMENT ON FUNCTION public.growth_batch_completion_state_fingerprint(uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, integer)
IS 'G5.2 canonical completion fingerprint over company, batch, status, depleted quantity/weight, cost fields, and latest event sequence.';
COMMENT ON FUNCTION public.preview_growth_batch_completion(uuid, date)
IS 'G5.2 non-mutating completion preview. Creates no event, detail, posting request, stock movement, stock-level update, finance row, cost mutation, or price change.';
COMMENT ON FUNCTION public.complete_growth_batch(uuid, text, text, date, text, text)
IS 'G5.2 MANAGER+ governed completion posting for fully depleted active Growth Batches. It closes lifecycle status only.';
COMMENT ON FUNCTION public.reverse_growth_batch_completion(uuid, text, text, date)
IS 'G5.2 MANAGER+ event-specific completion reversal. It reopens status only and does not reverse harvest, stock, cost, or finance history.';
