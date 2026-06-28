-- Growth Batches G4.1 mortality/shrinkage preview, posting, reversal, and grants.
-- Loss events update only Growth Batch current quantity/weight state. They do
-- not create stock movements, stock levels, finance rows, or cost write-offs.

CREATE OR REPLACE FUNCTION public.growth_batch_normalize_loss_type(
  p_loss_type text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_loss_type text := lower(NULLIF(btrim(COALESCE(p_loss_type, '')), ''));
BEGIN
  IF v_loss_type NOT IN ('mortality', 'shrinkage') THEN
    RAISE EXCEPTION 'growth_batch_loss_type_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN v_loss_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.growth_batch_normalize_loss_reason(
  p_loss_type text,
  p_reason_code text,
  p_notes text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_loss_type text := public.growth_batch_normalize_loss_type(p_loss_type);
  v_reason text := lower(NULLIF(btrim(COALESCE(p_reason_code, '')), ''));
  v_notes text := NULLIF(btrim(COALESCE(p_notes, '')), '');
BEGIN
  IF v_loss_type = 'mortality'
     AND v_reason NOT IN ('disease', 'injury', 'predator', 'weather', 'handling', 'culling', 'other') THEN
    RAISE EXCEPTION 'loss_reason_invalid' USING ERRCODE = '22023';
  END IF;

  IF v_loss_type = 'shrinkage'
     AND v_reason NOT IN ('weather', 'handling', 'natural_loss', 'drying', 'spoilage', 'quality_loss', 'other') THEN
    RAISE EXCEPTION 'loss_reason_invalid' USING ERRCODE = '22023';
  END IF;

  IF v_reason = 'other' AND v_notes IS NULL THEN
    RAISE EXCEPTION 'loss_notes_required' USING ERRCODE = '22023';
  END IF;

  RETURN v_reason;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_growth_batch_loss(
  p_growth_batch_id uuid,
  p_loss_type text,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_quantity_lost numeric DEFAULT NULL,
  p_weight_lost numeric DEFAULT NULL,
  p_reason_code text DEFAULT NULL,
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
  v_loss_type text;
  v_reason text;
  v_notes text := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_quantity_lost numeric;
  v_weight_lost numeric;
  v_quantity_before numeric;
  v_quantity_after numeric;
  v_weight_before numeric;
  v_weight_after numeric;
  v_primary_uom_code text;
  v_weight_uom_code text;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(v_company_id);
  v_loss_type := public.growth_batch_normalize_loss_type(p_loss_type);
  v_reason := public.growth_batch_normalize_loss_reason(v_loss_type, p_reason_code, v_notes);

  IF p_quantity_lost IS NOT NULL AND p_quantity_lost < 0 THEN
    RAISE EXCEPTION 'loss_quantity_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_weight_lost IS NOT NULL AND p_weight_lost < 0 THEN
    RAISE EXCEPTION 'loss_weight_invalid' USING ERRCODE = '22023';
  END IF;

  v_quantity_lost := CASE
    WHEN p_quantity_lost IS NULL OR round(p_quantity_lost::numeric, 12) = 0 THEN NULL
    ELSE round(p_quantity_lost::numeric, 12)
  END;
  v_weight_lost := CASE
    WHEN p_weight_lost IS NULL OR round(p_weight_lost::numeric, 12) = 0 THEN NULL
    ELSE round(p_weight_lost::numeric, 12)
  END;

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_growth_batch_id
    AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_batch.status <> 'active' THEN
    RAISE EXCEPTION 'growth_batch_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF v_effective_date < v_batch.start_date THEN
    RAISE EXCEPTION 'growth_batch_event_before_start' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_event_future' USING ERRCODE = '22023';
  END IF;

  v_quantity_before := COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty);
  v_weight_before := v_batch.current_total_weight;

  IF v_quantity_lost IS NULL AND v_weight_lost IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'loss_value_required'));
  END IF;

  IF v_quantity_lost IS NOT NULL THEN
    IF v_batch.primary_quantity_basis = 'count' AND v_quantity_lost <> trunc(v_quantity_lost) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'fractional_count_not_allowed'));
    END IF;
    IF v_quantity_lost > v_quantity_before THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'loss_quantity_exceeds_current_quantity'));
    END IF;
  END IF;

  IF v_weight_lost IS NOT NULL THEN
    IF v_batch.weight_uom_id IS NULL OR v_weight_before IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_current_weight_required'));
    ELSIF v_weight_lost > v_weight_before THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'loss_weight_exceeds_current_weight'));
    END IF;
  END IF;

  v_quantity_after := CASE WHEN v_quantity_lost IS NULL THEN v_quantity_before ELSE round((v_quantity_before - v_quantity_lost)::numeric, 12) END;
  v_weight_after := CASE WHEN v_weight_lost IS NULL THEN v_weight_before ELSE round((v_weight_before - v_weight_lost)::numeric, 12) END;

  SELECT u.code INTO v_primary_uom_code FROM public.uoms u WHERE u.id = v_batch.primary_uom_id;
  SELECT u.code INTO v_weight_uom_code FROM public.uoms u WHERE u.id = v_batch.weight_uom_id;

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'blocking_reasons', v_blockers,
    'batch_id', v_batch.id,
    'reference_no', v_batch.reference_no,
    'status', v_batch.status,
    'loss_type', v_loss_type,
    'effective_date', v_effective_date,
    'reason_code', v_reason,
    'current_quantity', v_quantity_before,
    'quantity_lost', v_quantity_lost,
    'resulting_quantity', v_quantity_after,
    'quantity_uom_id', CASE WHEN v_quantity_lost IS NULL THEN NULL ELSE v_batch.primary_uom_id END,
    'quantity_uom_code', CASE WHEN v_quantity_lost IS NULL THEN NULL ELSE v_primary_uom_code END,
    'current_total_weight', v_weight_before,
    'weight_lost', v_weight_lost,
    'resulting_total_weight', v_weight_after,
    'weight_uom_id', CASE WHEN v_weight_lost IS NULL THEN NULL ELSE v_batch.weight_uom_id END,
    'weight_uom_code', CASE WHEN v_weight_lost IS NULL THEN NULL ELSE v_weight_uom_code END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_growth_batch_loss(
  p_growth_batch_id uuid,
  p_loss_type text,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_quantity_lost numeric DEFAULT NULL,
  p_weight_lost numeric DEFAULT NULL,
  p_reason_code text DEFAULT NULL,
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
  v_loss_type text;
  v_reason text;
  v_notes text := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_notes_present boolean := p_notes IS NOT NULL;
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_quantity_lost numeric;
  v_weight_lost numeric;
  v_quantity_before numeric;
  v_quantity_after numeric;
  v_weight_before numeric;
  v_weight_after numeric;
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_event_id uuid;
  v_loss_id uuid;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(v_company_id);
  v_loss_type := public.growth_batch_normalize_loss_type(p_loss_type);
  v_reason := public.growth_batch_normalize_loss_reason(v_loss_type, p_reason_code, v_notes);

  IF p_quantity_lost IS NOT NULL AND p_quantity_lost < 0 THEN
    RAISE EXCEPTION 'loss_quantity_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_weight_lost IS NOT NULL AND p_weight_lost < 0 THEN
    RAISE EXCEPTION 'loss_weight_invalid' USING ERRCODE = '22023';
  END IF;
  v_quantity_lost := CASE
    WHEN p_quantity_lost IS NULL OR round(p_quantity_lost::numeric, 12) = 0 THEN NULL
    ELSE round(p_quantity_lost::numeric, 12)
  END;
  v_weight_lost := CASE
    WHEN p_weight_lost IS NULL OR round(p_weight_lost::numeric, 12) = 0 THEN NULL
    ELSE round(p_weight_lost::numeric, 12)
  END;

  v_payload := jsonb_build_object(
    'company_id', v_company_id,
    'batch_id', p_growth_batch_id,
    'loss_type', v_loss_type,
    'effective_date', v_effective_date,
    'quantity_lost', v_quantity_lost,
    'quantity_lost_present', v_quantity_lost IS NOT NULL,
    'weight_lost', v_weight_lost,
    'weight_lost_present', v_weight_lost IS NOT NULL,
    'reason_code', v_reason,
    'notes_present', v_notes_present,
    'notes', v_notes
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_growth_batch_id
    AND company_id = v_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(
    v_company_id,
    CASE v_loss_type WHEN 'mortality' THEN 'growth.batch.mortality' ELSE 'growth.batch.shrinkage' END,
    p_request_key,
    v_hash
  );

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

  IF v_batch.status <> 'active' THEN
    RAISE EXCEPTION 'growth_batch_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF v_effective_date < v_batch.start_date THEN
    RAISE EXCEPTION 'growth_batch_event_before_start' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_event_future' USING ERRCODE = '22023';
  END IF;

  v_quantity_before := COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty);
  v_weight_before := v_batch.current_total_weight;

  IF v_quantity_lost IS NULL AND v_weight_lost IS NULL THEN
    RAISE EXCEPTION 'loss_value_required' USING ERRCODE = '22023';
  END IF;

  IF v_quantity_lost IS NOT NULL THEN
    IF v_batch.primary_quantity_basis = 'count' AND v_quantity_lost <> trunc(v_quantity_lost) THEN
      RAISE EXCEPTION 'fractional_count_not_allowed' USING ERRCODE = '22023';
    END IF;
    IF v_quantity_lost > v_quantity_before THEN
      RAISE EXCEPTION 'loss_quantity_exceeds_current_quantity' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_weight_lost IS NOT NULL THEN
    IF v_batch.weight_uom_id IS NULL OR v_weight_before IS NULL THEN
      RAISE EXCEPTION 'growth_batch_current_weight_required' USING ERRCODE = '22023';
    END IF;
    IF v_weight_lost > v_weight_before THEN
      RAISE EXCEPTION 'loss_weight_exceeds_current_weight' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_quantity_after := CASE WHEN v_quantity_lost IS NULL THEN v_quantity_before ELSE round((v_quantity_before - v_quantity_lost)::numeric, 12) END;
  v_weight_after := CASE WHEN v_weight_lost IS NULL THEN v_weight_before ELSE round((v_weight_before - v_weight_lost)::numeric, 12) END;
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
    v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0'),
    v_loss_type,
    now(),
    v_effective_date,
    CASE WHEN v_quantity_lost IS NULL THEN NULL ELSE -v_quantity_lost END,
    CASE WHEN v_weight_lost IS NULL THEN NULL ELSE -v_weight_lost END,
    CASE WHEN v_weight_lost IS NULL THEN NULL ELSE v_batch.weight_uom_id END,
    0,
    0,
    0,
    v_batch.base_currency_code,
    v_notes,
    v_reason,
    v_request.request_id,
    v_user
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.growth_batch_losses (
    company_id,
    growth_batch_id,
    event_id,
    loss_type,
    quantity_lost,
    quantity_uom_id,
    weight_lost,
    weight_uom_id,
    reason_code,
    notes,
    quantity_before,
    quantity_after,
    total_weight_before,
    total_weight_after,
    created_by
  ) VALUES (
    v_company_id,
    p_growth_batch_id,
    v_event_id,
    v_loss_type,
    v_quantity_lost,
    CASE WHEN v_quantity_lost IS NULL THEN NULL ELSE v_batch.primary_uom_id END,
    v_weight_lost,
    CASE WHEN v_weight_lost IS NULL THEN NULL ELSE v_batch.weight_uom_id END,
    v_reason,
    v_notes,
    v_quantity_before,
    v_quantity_after,
    v_weight_before,
    v_weight_after,
    v_user
  )
  RETURNING id INTO v_loss_id;

  UPDATE public.growth_batches
     SET current_primary_qty = v_quantity_after,
         current_total_weight = v_weight_after,
         latest_event_sequence = v_sequence,
         updated_by = v_user
   WHERE id = p_growth_batch_id
     AND company_id = v_company_id;

  v_result := jsonb_build_object(
    'batch_id', p_growth_batch_id,
    'reference_no', v_batch.reference_no,
    'event_id', v_event_id,
    'event_sequence', v_sequence,
    'event_type', v_loss_type,
    'loss_detail_id', v_loss_id,
    'loss_type', v_loss_type,
    'quantity_before', v_quantity_before,
    'quantity_lost', v_quantity_lost,
    'quantity_after', v_quantity_after,
    'weight_before', v_weight_before,
    'weight_lost', v_weight_lost,
    'weight_after', v_weight_after,
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

CREATE OR REPLACE FUNCTION public.reverse_growth_batch_loss(
  p_event_id uuid,
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
  v_original_loss public.growth_batch_losses%ROWTYPE;
  v_batch public.growth_batches%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_quantity_before numeric;
  v_quantity_after numeric;
  v_weight_before numeric;
  v_weight_after numeric;
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_operation text;
  v_sequence integer;
  v_reversal_event_id uuid;
  v_reversal_line_id uuid;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_manager_company(v_company_id);
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reversal_reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_original_event
  FROM public.growth_batch_events e
  WHERE e.id = p_event_id
    AND e.company_id = v_company_id
  FOR UPDATE;
  IF NOT FOUND OR v_original_event.event_type NOT IN ('mortality', 'shrinkage') THEN
    RAISE EXCEPTION 'growth_batch_loss_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_original_loss
  FROM public.growth_batch_losses l
  WHERE l.company_id = v_company_id
    AND l.event_id = p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_loss_not_found' USING ERRCODE = 'P0001';
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
  IF v_batch.status <> 'active' THEN
    RAISE EXCEPTION 'growth_batch_not_active' USING ERRCODE = 'P0001';
  END IF;

  v_operation := CASE v_original_event.event_type
    WHEN 'mortality' THEN 'growth.batch.mortality.reverse'
    ELSE 'growth.batch.shrinkage.reverse'
  END;
  v_payload := jsonb_build_object(
    'company_id', v_company_id,
    'original_event_id', p_event_id,
    'loss_type', v_original_event.event_type,
    'reason', v_reason
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(v_company_id, v_operation, p_request_key, v_hash);

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
  FROM public.growth_batch_loss_reversal_lines r
  WHERE r.company_id = v_company_id
    AND r.original_event_id = p_event_id;
  IF FOUND THEN
    RAISE EXCEPTION 'growth_batch_loss_already_reversed' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.growth_batch_losses later_loss
    JOIN public.growth_batch_events later_event
      ON later_event.id = later_loss.event_id
     AND later_event.company_id = later_loss.company_id
     AND later_event.growth_batch_id = later_loss.growth_batch_id
    LEFT JOIN public.growth_batch_loss_reversal_lines later_reversal
      ON later_reversal.original_loss_id = later_loss.id
     AND later_reversal.company_id = later_loss.company_id
    WHERE later_loss.company_id = v_company_id
      AND later_loss.growth_batch_id = v_original_loss.growth_batch_id
      AND later_event.event_sequence > v_original_event.event_sequence
      AND later_reversal.id IS NULL
      AND (
        (v_original_loss.quantity_lost IS NOT NULL AND later_loss.quantity_lost IS NOT NULL)
        OR (v_original_loss.weight_lost IS NOT NULL AND later_loss.weight_lost IS NOT NULL)
      )
  ) THEN
    RAISE EXCEPTION 'growth_batch_loss_reversal_dependency_exists' USING ERRCODE = 'P0001';
  END IF;

  IF v_original_loss.weight_lost IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.growth_batch_measurements m
    JOIN public.growth_batch_events e
      ON e.id = m.growth_batch_event_id
     AND e.company_id = m.company_id
     AND e.growth_batch_id = m.growth_batch_id
    WHERE m.company_id = v_company_id
      AND m.growth_batch_id = v_original_loss.growth_batch_id
      AND m.measurement_type = 'total_weight'
      AND e.event_sequence > v_original_event.event_sequence
  ) THEN
    RAISE EXCEPTION 'growth_batch_loss_reversal_dependency_exists' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.growth_batch_events e
    WHERE e.company_id = v_company_id
      AND e.growth_batch_id = v_original_loss.growth_batch_id
      AND e.event_sequence > v_original_event.event_sequence
      AND e.event_type IN ('harvest', 'completion', 'split', 'batch_split')
  ) THEN
    RAISE EXCEPTION 'growth_batch_loss_reversal_dependency_exists' USING ERRCODE = 'P0001';
  END IF;

  v_quantity_before := COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty);
  v_weight_before := v_batch.current_total_weight;
  v_quantity_after := CASE
    WHEN v_original_loss.quantity_lost IS NULL THEN v_quantity_before
    ELSE round((v_quantity_before + v_original_loss.quantity_lost)::numeric, 12)
  END;
  v_weight_after := CASE
    WHEN v_original_loss.weight_lost IS NULL THEN v_weight_before
    ELSE round((v_weight_before + v_original_loss.weight_lost)::numeric, 12)
  END;
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
    v_batch.id,
    v_sequence,
    v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0'),
    v_original_event.event_type || '_reversal',
    now(),
    CURRENT_DATE,
    v_original_loss.quantity_lost,
    v_original_loss.weight_lost,
    v_original_loss.weight_uom_id,
    0,
    0,
    0,
    v_original_event.currency_code,
    v_reason,
    v_reason,
    v_request.request_id,
    p_event_id,
    v_user
  )
  RETURNING id INTO v_reversal_event_id;

  INSERT INTO public.growth_batch_loss_reversal_lines (
    company_id,
    growth_batch_id,
    reversal_event_id,
    original_event_id,
    original_loss_id,
    restored_quantity,
    restored_quantity_uom_id,
    restored_weight,
    restored_weight_uom_id,
    quantity_before,
    quantity_after,
    total_weight_before,
    total_weight_after,
    reason,
    created_by
  ) VALUES (
    v_company_id,
    v_batch.id,
    v_reversal_event_id,
    p_event_id,
    v_original_loss.id,
    v_original_loss.quantity_lost,
    v_original_loss.quantity_uom_id,
    v_original_loss.weight_lost,
    v_original_loss.weight_uom_id,
    v_quantity_before,
    v_quantity_after,
    v_weight_before,
    v_weight_after,
    v_reason,
    v_user
  )
  RETURNING id INTO v_reversal_line_id;

  UPDATE public.growth_batches
     SET current_primary_qty = v_quantity_after,
         current_total_weight = v_weight_after,
         latest_event_sequence = v_sequence,
         updated_by = v_user
   WHERE id = v_batch.id
     AND company_id = v_company_id;

  v_result := jsonb_build_object(
    'batch_id', v_batch.id,
    'reference_no', v_batch.reference_no,
    'event_id', v_reversal_event_id,
    'event_sequence', v_sequence,
    'event_type', v_original_event.event_type || '_reversal',
    'original_event_id', p_event_id,
    'original_loss_id', v_original_loss.id,
    'reversal_detail_id', v_reversal_line_id,
    'quantity_before', v_quantity_before,
    'quantity_restored', v_original_loss.quantity_lost,
    'quantity_after', v_quantity_after,
    'weight_before', v_weight_before,
    'weight_restored', v_original_loss.weight_lost,
    'weight_after', v_weight_after,
    'reason', v_reason,
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

ALTER FUNCTION public.growth_batch_normalize_loss_type(text) OWNER TO postgres;
ALTER FUNCTION public.growth_batch_normalize_loss_reason(text, text, text) OWNER TO postgres;
ALTER FUNCTION public.preview_growth_batch_loss(uuid, text, date, numeric, numeric, text, text) OWNER TO postgres;
ALTER FUNCTION public.record_growth_batch_loss(uuid, text, date, numeric, numeric, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.reverse_growth_batch_loss(uuid, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.growth_batch_normalize_loss_type(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_batch_normalize_loss_reason(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_growth_batch_loss(uuid, text, date, numeric, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_growth_batch_loss(uuid, text, date, numeric, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_growth_batch_loss(uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.preview_growth_batch_loss(uuid, text, date, numeric, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_growth_batch_loss(uuid, text, date, numeric, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_growth_batch_loss(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.preview_growth_batch_loss(uuid, text, date, numeric, numeric, text, text)
IS 'G4.1 non-mutating Growth Batch mortality/shrinkage preview. It creates no rows, stock movements, finance rows, or posting requests.';

COMMENT ON FUNCTION public.record_growth_batch_loss(uuid, text, date, numeric, numeric, text, text, text)
IS 'G4.1 governed mortality/shrinkage recording. Creates one immutable loss event/detail and updates only current quantity and total weight.';

COMMENT ON FUNCTION public.reverse_growth_batch_loss(uuid, text, text)
IS 'G4.1 MANAGER+ event-specific mortality/shrinkage reversal. Restores the original frozen quantity and weight without stock or finance posting.';
