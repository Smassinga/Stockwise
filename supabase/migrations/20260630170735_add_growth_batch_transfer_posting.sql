-- Growth Batches G4.2 transfer preview, posting, reversal, guards, and grants.
-- These RPCs move only the Growth Batch operational location fields. They never
-- create stock movements, mutate stock levels, post finance rows, or change costs.

CREATE OR REPLACE FUNCTION public.growth_batch_normalize_location_description(
  p_description text
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
  SELECT NULLIF(btrim(COALESCE(p_description, '')), '');
$$;

CREATE OR REPLACE FUNCTION public.growth_batch_normalize_transfer_reason(
  p_reason text,
  p_notes text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_reason text := lower(NULLIF(btrim(COALESCE(p_reason, '')), ''));
  v_notes text := public.growth_batch_normalize_location_description(p_notes);
BEGIN
  IF v_reason NOT IN (
    'operational_move',
    'space_management',
    'biosecurity',
    'environment',
    'maintenance',
    'consolidation',
    'other'
  ) THEN
    RAISE EXCEPTION 'growth_batch_transfer_reason_invalid' USING ERRCODE = '22023';
  END IF;

  IF v_reason = 'other' AND v_notes IS NULL THEN
    RAISE EXCEPTION 'growth_batch_transfer_notes_required' USING ERRCODE = '22023';
  END IF;

  RETURN v_reason;
END;
$$;

CREATE OR REPLACE FUNCTION public.growth_batch_location_fingerprint(
  p_company_id uuid,
  p_growth_batch_id uuid,
  p_warehouse_id uuid,
  p_bin_id text,
  p_location_description text
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
  SELECT md5(jsonb_build_object(
    'company_id', CASE WHEN p_company_id IS NULL THEN NULL ELSE lower(p_company_id::text) END,
    'growth_batch_id', CASE WHEN p_growth_batch_id IS NULL THEN NULL ELSE lower(p_growth_batch_id::text) END,
    'warehouse_id', CASE WHEN p_warehouse_id IS NULL THEN NULL ELSE lower(p_warehouse_id::text) END,
    'bin_id', NULLIF(btrim(COALESCE(p_bin_id, '')), ''),
    'location_description', public.growth_batch_normalize_location_description(p_location_description)
  )::text);
$$;

CREATE OR REPLACE FUNCTION public.growth_batch_transfer_location_display(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_bin_id text,
  p_location_description text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_warehouse_code text;
  v_warehouse_name text;
  v_warehouse_status text;
  v_bin_code text;
  v_bin_name text;
  v_bin_status text;
BEGIN
  IF p_warehouse_id IS NOT NULL THEN
    SELECT w.code, w.name, w.status
      INTO v_warehouse_code, v_warehouse_name, v_warehouse_status
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.company_id = p_company_id;
  END IF;

  IF p_bin_id IS NOT NULL THEN
    SELECT b.code, b.name, b.status
      INTO v_bin_code, v_bin_name, v_bin_status
    FROM public.bins b
    WHERE b.id = p_bin_id
      AND b.company_id = p_company_id;
  END IF;

  RETURN jsonb_build_object(
    'warehouse_id', p_warehouse_id,
    'warehouse_code', v_warehouse_code,
    'warehouse_name', v_warehouse_name,
    'warehouse_status', v_warehouse_status,
    'bin_id', p_bin_id,
    'bin_code', v_bin_code,
    'bin_name', v_bin_name,
    'bin_status', v_bin_status,
    'location_description', public.growth_batch_normalize_location_description(p_location_description)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_growth_batch_location_transfer(
  p_company_id uuid,
  p_growth_batch_id uuid,
  p_expected_warehouse_id uuid,
  p_expected_bin_id text,
  p_expected_location_description text,
  p_destination_warehouse_id uuid,
  p_destination_bin_id text,
  p_destination_location_description text,
  p_user uuid,
  p_event_sequence integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_batch public.growth_batches%ROWTYPE;
  v_expected_bin_id text := NULLIF(btrim(COALESCE(p_expected_bin_id, '')), '');
  v_destination_bin_id text := NULLIF(btrim(COALESCE(p_destination_bin_id, '')), '');
  v_expected_description text := public.growth_batch_normalize_location_description(p_expected_location_description);
  v_destination_description text := public.growth_batch_normalize_location_description(p_destination_location_description);
BEGIN
  IF current_setting('stockwise.growth_batch_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'growth_batch_rpc_required' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_growth_batch_id
    AND company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_batch.warehouse_id IS DISTINCT FROM p_expected_warehouse_id
    OR v_batch.bin_id IS DISTINCT FROM v_expected_bin_id
    OR public.growth_batch_normalize_location_description(v_batch.location_description) IS DISTINCT FROM v_expected_description THEN
    RAISE EXCEPTION 'growth_batch_transfer_source_changed' USING ERRCODE = 'P0001';
  END IF;

  IF p_event_sequence IS NULL OR p_event_sequence <> v_batch.latest_event_sequence + 1 THEN
    RAISE EXCEPTION 'growth_batch_transfer_sequence_invalid' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);
  PERFORM set_config('stockwise.growth_batch_location_transfer', 'on', true);

  UPDATE public.growth_batches
     SET warehouse_id = p_destination_warehouse_id,
         bin_id = v_destination_bin_id,
         location_description = v_destination_description,
         latest_event_sequence = p_event_sequence,
         updated_by = p_user
   WHERE id = p_growth_batch_id
     AND company_id = p_company_id;
END;
$$;

DROP VIEW IF EXISTS public.growth_batch_transfer_history;

CREATE VIEW public.growth_batch_transfer_history WITH (security_invoker = true) AS
SELECT
  t.id,
  t.company_id,
  t.growth_batch_id,
  gb.reference_no AS growth_batch_reference,
  t.event_id,
  e.event_reference,
  e.event_sequence,
  e.event_date AS event_effective_date,
  e.event_at AS event_created_at,
  e.created_by AS actor_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), 'Team member') AS actor_display_name,
  t.source_warehouse_id,
  sw.code AS source_warehouse_code,
  sw.name AS source_warehouse_name,
  t.source_bin_id,
  sb.code AS source_bin_code,
  sb.name AS source_bin_name,
  t.source_location_description,
  t.destination_warehouse_id,
  dw.code AS destination_warehouse_code,
  dw.name AS destination_warehouse_name,
  t.destination_bin_id,
  db.code AS destination_bin_code,
  db.name AS destination_bin_name,
  t.destination_location_description,
  md5(jsonb_build_object(
    'company_id', lower(t.company_id::text),
    'growth_batch_id', lower(t.growth_batch_id::text),
    'warehouse_id', CASE WHEN gb.warehouse_id IS NULL THEN NULL ELSE lower(gb.warehouse_id::text) END,
    'bin_id', NULLIF(btrim(COALESCE(gb.bin_id, '')), ''),
    'location_description', NULLIF(btrim(COALESCE(gb.location_description, '')), '')
  )::text) AS current_location_fingerprint,
  t.primary_quantity_basis,
  t.current_primary_qty,
  t.primary_uom_id,
  pu.code AS primary_uom_code,
  t.current_total_weight,
  t.weight_uom_id,
  wu.code AS weight_uom_code,
  t.area,
  t.area_uom_id,
  au.code AS area_uom_code,
  t.accumulated_material_cost,
  t.accumulated_direct_cost,
  t.accumulated_total_cost,
  t.harvested_cost,
  t.remaining_cost,
  t.transfer_reason,
  t.notes,
  t.created_at,
  (r.id IS NOT NULL) AS reversed,
  r.id AS reversal_detail_id,
  r.reversal_event_id,
  re.event_reference AS reversal_event_reference,
  re.event_sequence AS reversal_event_sequence,
  re.event_date AS reversal_effective_date,
  re.event_at AS reversal_timestamp,
  re.created_by AS reversal_actor_id,
  COALESCE(NULLIF(rp.full_name, ''), NULLIF(rp.name, ''), NULL) AS reversal_actor_display_name,
  r.reason AS reversal_reason,
  NOT EXISTS (
    SELECT 1
    FROM public.growth_batch_events later
    WHERE later.company_id = t.company_id
      AND later.growth_batch_id = t.growth_batch_id
      AND later.event_sequence > e.event_sequence
      AND later.event_type IN ('transfer', 'transfer_reversal')
  ) AS is_latest_location_event,
  (
    gb.warehouse_id IS NOT DISTINCT FROM t.destination_warehouse_id
    AND gb.bin_id IS NOT DISTINCT FROM t.destination_bin_id
    AND NULLIF(btrim(COALESCE(gb.location_description, '')), '') IS NOT DISTINCT FROM NULLIF(btrim(COALESCE(t.destination_location_description, '')), '')
  ) AS current_location_matches_destination,
  (COALESCE(sw.status, 'active') = 'active') AS source_warehouse_active,
  (t.source_bin_id IS NULL OR COALESCE(sb.status, 'active') = 'active') AS source_bin_active,
  (
    r.id IS NULL
    AND gb.status = 'active'
    AND COALESCE(gb.current_primary_qty, gb.opening_primary_qty) > 0
    AND gb.warehouse_id IS NOT DISTINCT FROM t.destination_warehouse_id
    AND gb.bin_id IS NOT DISTINCT FROM t.destination_bin_id
    AND NULLIF(btrim(COALESCE(gb.location_description, '')), '') IS NOT DISTINCT FROM NULLIF(btrim(COALESCE(t.destination_location_description, '')), '')
    AND COALESCE(sw.status, 'active') = 'active'
    AND (t.source_bin_id IS NULL OR COALESCE(sb.status, 'active') = 'active')
    AND NOT EXISTS (
      SELECT 1
      FROM public.growth_batch_events later
      WHERE later.company_id = t.company_id
        AND later.growth_batch_id = t.growth_batch_id
        AND later.event_sequence > e.event_sequence
        AND later.event_type IN ('transfer', 'transfer_reversal')
    )
  ) AS reversal_eligible
FROM public.growth_batch_transfers t
JOIN public.growth_batches gb ON gb.id = t.growth_batch_id AND gb.company_id = t.company_id
JOIN public.growth_batch_events e
  ON e.id = t.event_id
 AND e.company_id = t.company_id
 AND e.growth_batch_id = t.growth_batch_id
LEFT JOIN public.warehouses sw ON sw.id = t.source_warehouse_id AND sw.company_id = t.company_id
LEFT JOIN public.bins sb ON sb.id = t.source_bin_id AND sb.company_id = t.company_id
LEFT JOIN public.warehouses dw ON dw.id = t.destination_warehouse_id AND dw.company_id = t.company_id
LEFT JOIN public.bins db ON db.id = t.destination_bin_id AND db.company_id = t.company_id
LEFT JOIN public.uoms pu ON pu.id = t.primary_uom_id
LEFT JOIN public.uoms wu ON wu.id = t.weight_uom_id
LEFT JOIN public.uoms au ON au.id = t.area_uom_id
LEFT JOIN public.profiles p ON p.id = e.created_by
LEFT JOIN public.growth_batch_transfer_reversal_lines r
  ON r.original_transfer_id = t.id
 AND r.company_id = t.company_id
LEFT JOIN public.growth_batch_events re
  ON re.id = r.reversal_event_id
 AND re.company_id = r.company_id
LEFT JOIN public.profiles rp ON rp.id = re.created_by
WHERE t.company_id = public.current_company_id();

CREATE OR REPLACE FUNCTION public.preview_growth_batch_transfer(
  p_growth_batch_id uuid,
  p_destination_warehouse_id uuid,
  p_destination_bin_id text DEFAULT NULL,
  p_location_description text DEFAULT NULL,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_transfer_reason text DEFAULT NULL,
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
  v_destination_warehouse record;
  v_destination_bin record;
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_destination_bin_id text := NULLIF(btrim(COALESCE(p_destination_bin_id, '')), '');
  v_destination_description text := public.growth_batch_normalize_location_description(p_location_description);
  v_notes text := public.growth_batch_normalize_location_description(p_notes);
  v_reason text := lower(NULLIF(btrim(COALESCE(p_transfer_reason, '')), ''));
  v_current_qty numeric;
  v_source_fingerprint text;
  v_latest_location_date date;
  v_blockers jsonb := '[]'::jsonb;
  v_primary_uom_code text;
  v_weight_uom_code text;
  v_area_uom_code text;
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

  v_current_qty := COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty);
  v_source_fingerprint := public.growth_batch_location_fingerprint(
    v_company_id,
    p_growth_batch_id,
    v_batch.warehouse_id,
    v_batch.bin_id,
    v_batch.location_description
  );

  IF v_batch.status <> 'active' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_not_active'));
  END IF;
  IF v_batch.warehouse_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'source_location_not_canonical'));
  ELSE
    PERFORM 1
    FROM public.warehouses w
    WHERE w.id = v_batch.warehouse_id
      AND w.company_id = v_company_id;
    IF NOT FOUND THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'source_location_not_canonical'));
    END IF;
  END IF;
  IF COALESCE(v_current_qty, 0) <= 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_transfer_empty_batch'));
  END IF;
  IF v_effective_date < v_batch.start_date THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_transfer_date_before_start'));
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_transfer_date_in_future'));
  END IF;

  SELECT max(e.event_date)
    INTO v_latest_location_date
  FROM public.growth_batch_events e
  WHERE e.company_id = v_company_id
    AND e.growth_batch_id = p_growth_batch_id
    AND e.event_type IN ('transfer', 'transfer_reversal');
  IF v_latest_location_date IS NOT NULL AND v_effective_date < v_latest_location_date THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_transfer_date_before_latest_location_event'));
  END IF;

  IF v_reason NOT IN ('operational_move', 'space_management', 'biosecurity', 'environment', 'maintenance', 'consolidation', 'other') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_transfer_reason_invalid'));
  ELSIF v_reason = 'other' AND v_notes IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_transfer_notes_required'));
  END IF;

  IF p_destination_warehouse_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'destination_warehouse_required'));
  ELSE
    SELECT w.id, w.code, w.name, w.status
      INTO v_destination_warehouse
    FROM public.warehouses w
    WHERE w.id = p_destination_warehouse_id
      AND w.company_id = v_company_id;
    IF NOT FOUND THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'destination_warehouse_invalid'));
    ELSIF COALESCE(v_destination_warehouse.status, 'active') <> 'active' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'destination_warehouse_inactive'));
    END IF;
  END IF;

  IF v_destination_bin_id IS NOT NULL THEN
    SELECT b.id, b.code, b.name, b.status, b."warehouseId"
      INTO v_destination_bin
    FROM public.bins b
    WHERE b.id = v_destination_bin_id
      AND b.company_id = v_company_id;
    IF NOT FOUND OR v_destination_bin."warehouseId" IS DISTINCT FROM p_destination_warehouse_id THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'destination_bin_invalid'));
    ELSIF COALESCE(v_destination_bin.status, 'active') <> 'active' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'destination_bin_inactive'));
    END IF;
  END IF;

  IF v_batch.warehouse_id IS NOT DISTINCT FROM p_destination_warehouse_id
    AND v_batch.bin_id IS NOT DISTINCT FROM v_destination_bin_id
    AND public.growth_batch_normalize_location_description(v_batch.location_description) IS NOT DISTINCT FROM v_destination_description THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_transfer_same_location'));
  END IF;

  SELECT u.code INTO v_primary_uom_code FROM public.uoms u WHERE u.id = v_batch.primary_uom_id;
  SELECT u.code INTO v_weight_uom_code FROM public.uoms u WHERE u.id = v_batch.weight_uom_id;
  SELECT u.code INTO v_area_uom_code FROM public.uoms u WHERE u.id = v_batch.area_uom_id;

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'blocking_reasons', v_blockers,
    'batch_id', v_batch.id,
    'reference_no', v_batch.reference_no,
    'name', v_batch.name,
    'status', v_batch.status,
    'effective_date', v_effective_date,
    'transfer_reason', v_reason,
    'source_location_fingerprint', v_source_fingerprint,
    'source_location', public.growth_batch_transfer_location_display(v_company_id, v_batch.warehouse_id, v_batch.bin_id, v_batch.location_description),
    'destination_location', public.growth_batch_transfer_location_display(v_company_id, p_destination_warehouse_id, v_destination_bin_id, v_destination_description),
    'current_quantity', v_current_qty,
    'resulting_quantity', v_current_qty,
    'primary_uom_id', v_batch.primary_uom_id,
    'primary_uom_code', v_primary_uom_code,
    'current_total_weight', v_batch.current_total_weight,
    'resulting_total_weight', v_batch.current_total_weight,
    'weight_uom_id', v_batch.weight_uom_id,
    'weight_uom_code', v_weight_uom_code,
    'area', v_batch.area,
    'area_uom_id', v_batch.area_uom_id,
    'area_uom_code', v_area_uom_code,
    'current_material_cost', v_batch.accumulated_material_cost,
    'current_direct_cost', v_batch.accumulated_direct_cost,
    'current_total_cost', v_batch.accumulated_total_cost,
    'current_harvested_cost', v_batch.harvested_cost,
    'current_remaining_cost', v_batch.remaining_cost,
    'projected_material_cost', v_batch.accumulated_material_cost,
    'projected_direct_cost', v_batch.accumulated_direct_cost,
    'projected_total_cost', v_batch.accumulated_total_cost,
    'projected_harvested_cost', v_batch.harvested_cost,
    'projected_remaining_cost', v_batch.remaining_cost,
    'full_batch_transfer', true,
    'stock_ledger_effect', 'not_affected',
    'finance_effect', 'not_affected',
    'cost_effect', 'unchanged'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_growth_batch(
  p_growth_batch_id uuid,
  p_destination_warehouse_id uuid,
  p_destination_bin_id text DEFAULT NULL,
  p_location_description text DEFAULT NULL,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_transfer_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_expected_source_fingerprint text DEFAULT NULL,
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
  v_destination_warehouse record;
  v_destination_bin record;
  v_destination_bin_id text := NULLIF(btrim(COALESCE(p_destination_bin_id, '')), '');
  v_destination_description text := public.growth_batch_normalize_location_description(p_location_description);
  v_notes text := public.growth_batch_normalize_location_description(p_notes);
  v_notes_present boolean := p_notes IS NOT NULL;
  v_reason text;
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_current_qty numeric;
  v_current_fingerprint text;
  v_expected_fingerprint text := NULLIF(btrim(COALESCE(p_expected_source_fingerprint, '')), '');
  v_latest_location_date date;
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_event_id uuid;
  v_transfer_id uuid;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(v_company_id);
  v_reason := public.growth_batch_normalize_transfer_reason(p_transfer_reason, v_notes);

  IF v_expected_fingerprint IS NULL THEN
    RAISE EXCEPTION 'growth_batch_transfer_source_fingerprint_required' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'company_id', v_company_id,
    'batch_id', p_growth_batch_id,
    'destination_warehouse_id', p_destination_warehouse_id,
    'destination_bin_id', v_destination_bin_id,
    'destination_location_description', v_destination_description,
    'effective_date', v_effective_date,
    'transfer_reason', v_reason,
    'notes_present', v_notes_present,
    'notes', v_notes,
    'expected_source_fingerprint', v_expected_fingerprint
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(v_company_id, 'growth.batch.transfer', p_request_key, v_hash);

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
    RAISE EXCEPTION 'growth_batch_not_active' USING ERRCODE = 'P0001';
  END IF;

  v_current_qty := COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty);
  IF COALESCE(v_current_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'growth_batch_transfer_empty_batch' USING ERRCODE = '22023';
  END IF;
  IF v_batch.warehouse_id IS NULL THEN
    RAISE EXCEPTION 'source_location_not_canonical' USING ERRCODE = '22023';
  END IF;

  v_current_fingerprint := public.growth_batch_location_fingerprint(
    v_company_id,
    p_growth_batch_id,
    v_batch.warehouse_id,
    v_batch.bin_id,
    v_batch.location_description
  );
  IF v_current_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
    RAISE EXCEPTION 'growth_batch_transfer_source_changed' USING ERRCODE = 'P0001';
  END IF;

  IF v_effective_date < v_batch.start_date THEN
    RAISE EXCEPTION 'growth_batch_transfer_date_before_start' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_transfer_date_in_future' USING ERRCODE = '22023';
  END IF;
  SELECT max(e.event_date)
    INTO v_latest_location_date
  FROM public.growth_batch_events e
  WHERE e.company_id = v_company_id
    AND e.growth_batch_id = p_growth_batch_id
    AND e.event_type IN ('transfer', 'transfer_reversal');
  IF v_latest_location_date IS NOT NULL AND v_effective_date < v_latest_location_date THEN
    RAISE EXCEPTION 'growth_batch_transfer_date_before_latest_location_event' USING ERRCODE = '22023';
  END IF;

  IF p_destination_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'destination_warehouse_required' USING ERRCODE = '22023';
  END IF;
  SELECT w.id, w.code, w.name, w.status
    INTO v_destination_warehouse
  FROM public.warehouses w
  WHERE w.id = p_destination_warehouse_id
    AND w.company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'destination_warehouse_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_destination_warehouse.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'destination_warehouse_inactive' USING ERRCODE = 'P0001';
  END IF;

  IF v_destination_bin_id IS NOT NULL THEN
    SELECT b.id, b.code, b.name, b.status, b."warehouseId"
      INTO v_destination_bin
    FROM public.bins b
    WHERE b.id = v_destination_bin_id
      AND b.company_id = v_company_id;
    IF NOT FOUND OR v_destination_bin."warehouseId" IS DISTINCT FROM p_destination_warehouse_id THEN
      RAISE EXCEPTION 'destination_bin_invalid' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_destination_bin.status, 'active') <> 'active' THEN
      RAISE EXCEPTION 'destination_bin_inactive' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_batch.warehouse_id IS NOT DISTINCT FROM p_destination_warehouse_id
    AND v_batch.bin_id IS NOT DISTINCT FROM v_destination_bin_id
    AND public.growth_batch_normalize_location_description(v_batch.location_description) IS NOT DISTINCT FROM v_destination_description THEN
    RAISE EXCEPTION 'growth_batch_transfer_same_location' USING ERRCODE = '22023';
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
    created_by
  ) VALUES (
    v_company_id,
    p_growth_batch_id,
    v_sequence,
    v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0'),
    'transfer',
    now(),
    v_effective_date,
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

  INSERT INTO public.growth_batch_transfers (
    company_id,
    growth_batch_id,
    event_id,
    source_warehouse_id,
    source_bin_id,
    source_location_description,
    destination_warehouse_id,
    destination_bin_id,
    destination_location_description,
    primary_quantity_basis,
    current_primary_qty,
    primary_uom_id,
    current_total_weight,
    weight_uom_id,
    area,
    area_uom_id,
    accumulated_material_cost,
    accumulated_direct_cost,
    accumulated_total_cost,
    harvested_cost,
    remaining_cost,
    transfer_reason,
    notes,
    created_by
  ) VALUES (
    v_company_id,
    p_growth_batch_id,
    v_event_id,
    v_batch.warehouse_id,
    v_batch.bin_id,
    public.growth_batch_normalize_location_description(v_batch.location_description),
    p_destination_warehouse_id,
    v_destination_bin_id,
    v_destination_description,
    v_batch.primary_quantity_basis,
    v_current_qty,
    v_batch.primary_uom_id,
    v_batch.current_total_weight,
    v_batch.weight_uom_id,
    v_batch.area,
    v_batch.area_uom_id,
    v_batch.accumulated_material_cost,
    v_batch.accumulated_direct_cost,
    v_batch.accumulated_total_cost,
    v_batch.harvested_cost,
    v_batch.remaining_cost,
    v_reason,
    v_notes,
    v_user
  )
  RETURNING id INTO v_transfer_id;

  PERFORM public.apply_growth_batch_location_transfer(
    v_company_id,
    p_growth_batch_id,
    v_batch.warehouse_id,
    v_batch.bin_id,
    v_batch.location_description,
    p_destination_warehouse_id,
    v_destination_bin_id,
    v_destination_description,
    v_user,
    v_sequence
  );

  v_result := jsonb_build_object(
    'batch_id', p_growth_batch_id,
    'reference_no', v_batch.reference_no,
    'event_id', v_event_id,
    'event_reference', v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0'),
    'event_sequence', v_sequence,
    'event_type', 'transfer',
    'transfer_detail_id', v_transfer_id,
    'source_location', public.growth_batch_transfer_location_display(v_company_id, v_batch.warehouse_id, v_batch.bin_id, v_batch.location_description),
    'destination_location', public.growth_batch_transfer_location_display(v_company_id, p_destination_warehouse_id, v_destination_bin_id, v_destination_description),
    'current_quantity', v_current_qty,
    'current_total_weight', v_batch.current_total_weight,
    'material_cost', v_batch.accumulated_material_cost,
    'direct_cost', v_batch.accumulated_direct_cost,
    'total_cost', v_batch.accumulated_total_cost,
    'harvested_cost', v_batch.harvested_cost,
    'remaining_cost', v_batch.remaining_cost,
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

CREATE OR REPLACE FUNCTION public.reverse_growth_batch_transfer(
  p_growth_batch_id uuid,
  p_original_event_id uuid,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_reason text DEFAULT NULL,
  p_expected_current_location_fingerprint text DEFAULT NULL,
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
  v_original_event public.growth_batch_events%ROWTYPE;
  v_transfer public.growth_batch_transfers%ROWTYPE;
  v_existing_reversal public.growth_batch_transfer_reversal_lines%ROWTYPE;
  v_reason text := public.growth_batch_normalize_location_description(p_reason);
  v_expected_fingerprint text := NULLIF(btrim(COALESCE(p_expected_current_location_fingerprint, '')), '');
  v_current_fingerprint text;
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_current_qty numeric;
  v_latest_location_date date;
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_reversal_event_id uuid;
  v_reversal_line_id uuid;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_manager_company(v_company_id);

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reversal_reason_required' USING ERRCODE = '22023';
  END IF;
  IF v_expected_fingerprint IS NULL THEN
    RAISE EXCEPTION 'growth_batch_transfer_source_fingerprint_required' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'company_id', v_company_id,
    'batch_id', p_growth_batch_id,
    'original_event_id', p_original_event_id,
    'effective_date', v_effective_date,
    'reason', v_reason,
    'expected_current_location_fingerprint', v_expected_fingerprint
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(v_company_id, 'growth.batch.transfer.reverse', p_request_key, v_hash);

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
    RAISE EXCEPTION 'growth_batch_not_active' USING ERRCODE = 'P0001';
  END IF;

  v_current_qty := COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty);
  IF COALESCE(v_current_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'growth_batch_transfer_empty_batch' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_original_event
  FROM public.growth_batch_events e
  WHERE e.id = p_original_event_id
    AND e.company_id = v_company_id
    AND e.growth_batch_id = p_growth_batch_id
  FOR UPDATE;
  IF NOT FOUND OR v_original_event.event_type <> 'transfer' THEN
    RAISE EXCEPTION 'growth_batch_transfer_original_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_transfer
  FROM public.growth_batch_transfers t
  WHERE t.event_id = p_original_event_id
    AND t.company_id = v_company_id
    AND t.growth_batch_id = p_growth_batch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_transfer_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_existing_reversal
  FROM public.growth_batch_transfer_reversal_lines r
  WHERE r.original_transfer_id = v_transfer.id
    AND r.company_id = v_company_id
  FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'growth_batch_transfer_already_reversed' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.growth_batch_events later
    WHERE later.company_id = v_company_id
      AND later.growth_batch_id = p_growth_batch_id
      AND later.event_sequence > v_original_event.event_sequence
      AND later.event_type IN ('transfer', 'transfer_reversal')
  ) THEN
    RAISE EXCEPTION 'growth_batch_transfer_reversal_dependency_exists' USING ERRCODE = 'P0001';
  END IF;

  IF v_batch.warehouse_id IS DISTINCT FROM v_transfer.destination_warehouse_id
    OR v_batch.bin_id IS DISTINCT FROM v_transfer.destination_bin_id
    OR public.growth_batch_normalize_location_description(v_batch.location_description) IS DISTINCT FROM public.growth_batch_normalize_location_description(v_transfer.destination_location_description) THEN
    RAISE EXCEPTION 'growth_batch_transfer_current_location_mismatch' USING ERRCODE = 'P0001';
  END IF;

  v_current_fingerprint := public.growth_batch_location_fingerprint(
    v_company_id,
    p_growth_batch_id,
    v_batch.warehouse_id,
    v_batch.bin_id,
    v_batch.location_description
  );
  IF v_current_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
    RAISE EXCEPTION 'growth_batch_transfer_source_changed' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.warehouses w
  WHERE w.id = v_transfer.source_warehouse_id
    AND w.company_id = v_company_id
    AND COALESCE(w.status, 'active') = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_transfer_original_source_inactive' USING ERRCODE = 'P0001';
  END IF;

  IF v_transfer.source_bin_id IS NOT NULL THEN
    PERFORM 1
    FROM public.bins b
    WHERE b.id = v_transfer.source_bin_id
      AND b.company_id = v_company_id
      AND b."warehouseId" = v_transfer.source_warehouse_id
      AND COALESCE(b.status, 'active') = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'growth_batch_transfer_original_source_inactive' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_effective_date < v_batch.start_date THEN
    RAISE EXCEPTION 'growth_batch_transfer_date_before_start' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date < v_original_event.event_date THEN
    RAISE EXCEPTION 'growth_batch_transfer_reversal_date_before_original' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_transfer_date_in_future' USING ERRCODE = '22023';
  END IF;
  SELECT max(e.event_date)
    INTO v_latest_location_date
  FROM public.growth_batch_events e
  WHERE e.company_id = v_company_id
    AND e.growth_batch_id = p_growth_batch_id
    AND e.event_type IN ('transfer', 'transfer_reversal');
  IF v_latest_location_date IS NOT NULL AND v_effective_date < v_latest_location_date THEN
    RAISE EXCEPTION 'growth_batch_transfer_date_before_latest_location_event' USING ERRCODE = '22023';
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
    p_growth_batch_id,
    v_sequence,
    v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0'),
    'transfer_reversal',
    now(),
    v_effective_date,
    0,
    0,
    0,
    v_batch.base_currency_code,
    v_reason,
    v_reason,
    v_request.request_id,
    p_original_event_id,
    v_user
  )
  RETURNING id INTO v_reversal_event_id;

  INSERT INTO public.growth_batch_transfer_reversal_lines (
    company_id,
    growth_batch_id,
    reversal_event_id,
    original_event_id,
    original_transfer_id,
    reversal_source_warehouse_id,
    reversal_source_bin_id,
    reversal_source_location_description,
    reversal_destination_warehouse_id,
    reversal_destination_bin_id,
    reversal_destination_location_description,
    primary_quantity_basis,
    current_primary_qty,
    primary_uom_id,
    current_total_weight,
    weight_uom_id,
    area,
    area_uom_id,
    accumulated_material_cost,
    accumulated_direct_cost,
    accumulated_total_cost,
    harvested_cost,
    remaining_cost,
    reason,
    created_by
  ) VALUES (
    v_company_id,
    p_growth_batch_id,
    v_reversal_event_id,
    p_original_event_id,
    v_transfer.id,
    v_batch.warehouse_id,
    v_batch.bin_id,
    public.growth_batch_normalize_location_description(v_batch.location_description),
    v_transfer.source_warehouse_id,
    v_transfer.source_bin_id,
    public.growth_batch_normalize_location_description(v_transfer.source_location_description),
    v_batch.primary_quantity_basis,
    v_current_qty,
    v_batch.primary_uom_id,
    v_batch.current_total_weight,
    v_batch.weight_uom_id,
    v_batch.area,
    v_batch.area_uom_id,
    v_batch.accumulated_material_cost,
    v_batch.accumulated_direct_cost,
    v_batch.accumulated_total_cost,
    v_batch.harvested_cost,
    v_batch.remaining_cost,
    v_reason,
    v_user
  )
  RETURNING id INTO v_reversal_line_id;

  PERFORM public.apply_growth_batch_location_transfer(
    v_company_id,
    p_growth_batch_id,
    v_batch.warehouse_id,
    v_batch.bin_id,
    v_batch.location_description,
    v_transfer.source_warehouse_id,
    v_transfer.source_bin_id,
    v_transfer.source_location_description,
    v_user,
    v_sequence
  );

  v_result := jsonb_build_object(
    'batch_id', p_growth_batch_id,
    'reference_no', v_batch.reference_no,
    'event_id', v_reversal_event_id,
    'event_reference', v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0'),
    'event_sequence', v_sequence,
    'event_type', 'transfer_reversal',
    'original_event_id', p_original_event_id,
    'original_transfer_id', v_transfer.id,
    'reversal_detail_id', v_reversal_line_id,
    'source_location', public.growth_batch_transfer_location_display(v_company_id, v_batch.warehouse_id, v_batch.bin_id, v_batch.location_description),
    'destination_location', public.growth_batch_transfer_location_display(v_company_id, v_transfer.source_warehouse_id, v_transfer.source_bin_id, v_transfer.source_location_description),
    'current_quantity', v_current_qty,
    'current_total_weight', v_batch.current_total_weight,
    'material_cost', v_batch.accumulated_material_cost,
    'direct_cost', v_batch.accumulated_direct_cost,
    'total_cost', v_batch.accumulated_total_cost,
    'harvested_cost', v_batch.harvested_cost,
    'remaining_cost', v_batch.remaining_cost,
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

ALTER FUNCTION public.growth_batch_normalize_location_description(text) OWNER TO postgres;
ALTER FUNCTION public.growth_batch_normalize_transfer_reason(text, text) OWNER TO postgres;
ALTER FUNCTION public.growth_batch_location_fingerprint(uuid, uuid, uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.growth_batch_transfer_location_display(uuid, uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.apply_growth_batch_location_transfer(uuid, uuid, uuid, text, text, uuid, text, text, uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.preview_growth_batch_transfer(uuid, uuid, text, text, date, text, text) OWNER TO postgres;
ALTER FUNCTION public.transfer_growth_batch(uuid, uuid, text, text, date, text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.reverse_growth_batch_transfer(uuid, uuid, date, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.growth_batch_normalize_location_description(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_batch_normalize_transfer_reason(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_batch_location_fingerprint(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_batch_transfer_location_display(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_growth_batch_location_transfer(uuid, uuid, uuid, text, text, uuid, text, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_growth_batch_transfer(uuid, uuid, text, text, date, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_growth_batch(uuid, uuid, text, text, date, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_growth_batch_transfer(uuid, uuid, date, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.preview_growth_batch_transfer(uuid, uuid, text, text, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_growth_batch(uuid, uuid, text, text, date, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_growth_batch_transfer(uuid, uuid, date, text, text, text) TO authenticated;

GRANT SELECT ON public.growth_batch_transfer_history TO authenticated;
GRANT SELECT ON public.growth_batch_transfer_history TO service_role;

COMMENT ON FUNCTION public.growth_batch_location_fingerprint(uuid, uuid, uuid, text, text)
IS 'G4.2 canonical source-location fingerprint over company, batch, warehouse, bin, and normalized description only.';
COMMENT ON FUNCTION public.preview_growth_batch_transfer(uuid, uuid, text, text, date, text, text)
IS 'G4.2 non-mutating full-batch operational location transfer preview. It creates no rows, stock movements, finance rows, posting requests, or cost changes.';
COMMENT ON FUNCTION public.transfer_growth_batch(uuid, uuid, text, text, date, text, text, text, text)
IS 'G4.2 governed OPERATOR+ full-batch operational location transfer. Creates one immutable transfer event/detail and updates only current location fields.';
COMMENT ON FUNCTION public.reverse_growth_batch_transfer(uuid, uuid, date, text, text, text)
IS 'G4.2 MANAGER+ event-specific transfer reversal. Moves the current active batch back to the original active source without restoring old quantities, weights, or costs.';
