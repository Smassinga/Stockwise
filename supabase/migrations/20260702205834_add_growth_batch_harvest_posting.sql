-- Growth Batches G5.1 depleting harvest preview, posting, reversal, and grants.
-- Harvests create one stock receipt, reverse with one stock issue, and never post
-- finance documents, mutate stock_levels directly, or change items.unit_price.

CREATE OR REPLACE FUNCTION public.growth_batch_harvest_state_fingerprint(
  p_company_id uuid,
  p_growth_batch_id uuid,
  p_status text,
  p_warehouse_id uuid,
  p_bin_id text,
  p_location_description text,
  p_current_primary_qty numeric,
  p_current_total_weight numeric,
  p_accumulated_total_cost numeric,
  p_harvested_cost numeric,
  p_remaining_cost numeric
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
  SELECT md5(jsonb_build_object(
    'company_id', CASE WHEN p_company_id IS NULL THEN NULL ELSE lower(p_company_id::text) END,
    'growth_batch_id', CASE WHEN p_growth_batch_id IS NULL THEN NULL ELSE lower(p_growth_batch_id::text) END,
    'status', NULLIF(btrim(COALESCE(p_status, '')), ''),
    'warehouse_id', CASE WHEN p_warehouse_id IS NULL THEN NULL ELSE lower(p_warehouse_id::text) END,
    'bin_id', NULLIF(btrim(COALESCE(p_bin_id, '')), ''),
    'location_description', public.growth_batch_normalize_location_description(p_location_description),
    'current_primary_qty', CASE WHEN p_current_primary_qty IS NULL THEN NULL ELSE round(p_current_primary_qty::numeric, 12) END,
    'current_total_weight', CASE WHEN p_current_total_weight IS NULL THEN NULL ELSE round(p_current_total_weight::numeric, 12) END,
    'accumulated_total_cost', CASE WHEN p_accumulated_total_cost IS NULL THEN NULL ELSE round(p_accumulated_total_cost::numeric, 6) END,
    'harvested_cost', CASE WHEN p_harvested_cost IS NULL THEN NULL ELSE round(p_harvested_cost::numeric, 6) END,
    'remaining_cost', CASE WHEN p_remaining_cost IS NULL THEN NULL ELSE round(p_remaining_cost::numeric, 6) END
  )::text);
$$;

CREATE OR REPLACE FUNCTION public.validate_growth_batch_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_primary_uom_family text;
  v_weight_uom_family text;
  v_area_uom_family text;
BEGIN
  IF current_setting('stockwise.growth_batch_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'growth_batch_rpc_required' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'growth_batch_invalid_lifecycle' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.current_primary_qty IS NOT NULL THEN
      RAISE EXCEPTION 'growth_batch_current_qty_initialized_on_activation' USING ERRCODE = '22023';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.reference_no IS DISTINCT FROM OLD.reference_no
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'growth_batch_identity_immutable' USING ERRCODE = 'P0001';
    END IF;

    IF OLD.status = 'draft' THEN
      IF NEW.status NOT IN ('draft', 'active', 'cancelled') THEN
        RAISE EXCEPTION 'growth_batch_invalid_lifecycle' USING ERRCODE = 'P0001';
      END IF;
    ELSIF OLD.status = 'active' THEN
      IF NEW.status IS DISTINCT FROM OLD.status
        OR NEW.name IS DISTINCT FROM OLD.name
        OR NEW.batch_family IS DISTINCT FROM OLD.batch_family
        OR NEW.primary_quantity_basis IS DISTINCT FROM OLD.primary_quantity_basis
        OR NEW.primary_uom_id IS DISTINCT FROM OLD.primary_uom_id
        OR NEW.species_text IS DISTINCT FROM OLD.species_text
        OR NEW.purpose IS DISTINCT FROM OLD.purpose
        OR NEW.start_date IS DISTINCT FROM OLD.start_date
        OR NEW.expected_end_date IS DISTINCT FROM OLD.expected_end_date
        OR NEW.opening_primary_qty IS DISTINCT FROM OLD.opening_primary_qty
        OR NEW.opening_total_weight IS DISTINCT FROM OLD.opening_total_weight
        OR NEW.weight_uom_id IS DISTINCT FROM OLD.weight_uom_id
        OR NEW.area IS DISTINCT FROM OLD.area
        OR NEW.area_uom_id IS DISTINCT FROM OLD.area_uom_id
        OR (
          current_setting('stockwise.growth_batch_location_transfer', true) IS DISTINCT FROM 'on'
          AND (
            NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
            OR NEW.bin_id IS DISTINCT FROM OLD.bin_id
            OR NEW.location_description IS DISTINCT FROM OLD.location_description
          )
        )
        OR NEW.base_currency_code IS DISTINCT FROM OLD.base_currency_code
        OR (
          current_setting('stockwise.growth_batch_harvest_update', true) IS DISTINCT FROM 'on'
          AND (
            NEW.harvested_cost IS DISTINCT FROM OLD.harvested_cost
            OR (
              NEW.remaining_cost IS DISTINCT FROM OLD.remaining_cost
              AND NEW.accumulated_total_cost IS NOT DISTINCT FROM OLD.accumulated_total_cost
            )
          )
        )
        OR NEW.notes IS DISTINCT FROM OLD.notes
        OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason
        OR NEW.completion_notes IS DISTINCT FROM OLD.completion_notes
        OR NEW.activated_by IS DISTINCT FROM OLD.activated_by
        OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
        OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
        OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
        OR NEW.completed_by IS DISTINCT FROM OLD.completed_by
        OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
        RAISE EXCEPTION 'growth_batch_immutable' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      RAISE EXCEPTION 'growth_batch_immutable' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT u.family
    INTO v_primary_uom_family
  FROM public.uoms u
  WHERE u.id = NEW.primary_uom_id;

  IF v_primary_uom_family IS NULL THEN
    RAISE EXCEPTION 'uom_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.primary_quantity_basis = 'count' AND v_primary_uom_family <> 'count' THEN
    RAISE EXCEPTION 'growth_batch_primary_uom_basis_mismatch' USING ERRCODE = '22023';
  ELSIF NEW.primary_quantity_basis = 'weight' AND v_primary_uom_family <> 'mass' THEN
    RAISE EXCEPTION 'growth_batch_primary_uom_basis_mismatch' USING ERRCODE = '22023';
  ELSIF NEW.primary_quantity_basis = 'area' AND v_primary_uom_family <> 'area' THEN
    RAISE EXCEPTION 'growth_batch_primary_uom_basis_mismatch' USING ERRCODE = '22023';
  END IF;

  IF NEW.primary_quantity_basis = 'count' AND NEW.opening_primary_qty <> trunc(NEW.opening_primary_qty) THEN
    RAISE EXCEPTION 'fractional_count_not_allowed' USING ERRCODE = '22023';
  END IF;

  IF (NEW.opening_total_weight IS NOT NULL OR NEW.current_total_weight IS NOT NULL)
     AND NEW.weight_uom_id IS NULL THEN
    RAISE EXCEPTION 'growth_batch_weight_uom_required' USING ERRCODE = '22023';
  END IF;

  IF NEW.weight_uom_id IS NOT NULL THEN
    SELECT u.family
      INTO v_weight_uom_family
    FROM public.uoms u
    WHERE u.id = NEW.weight_uom_id;
    IF v_weight_uom_family IS NULL THEN
      RAISE EXCEPTION 'uom_not_found' USING ERRCODE = 'P0001';
    END IF;
    IF v_weight_uom_family <> 'mass' THEN
      RAISE EXCEPTION 'growth_batch_weight_uom_must_be_mass' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.area_uom_id IS NOT NULL THEN
    SELECT u.family
      INTO v_area_uom_family
    FROM public.uoms u
    WHERE u.id = NEW.area_uom_id;
    IF v_area_uom_family IS NULL THEN
      RAISE EXCEPTION 'uom_not_found' USING ERRCODE = 'P0001';
    END IF;
    IF v_area_uom_family <> 'area' THEN
      RAISE EXCEPTION 'growth_batch_area_uom_must_be_area' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.warehouse_id IS NOT NULL THEN
    PERFORM 1
    FROM public.warehouses w
    WHERE w.id = NEW.warehouse_id
      AND w.company_id = NEW.company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.bin_id IS NOT NULL THEN
    IF NEW.warehouse_id IS NULL THEN
      RAISE EXCEPTION 'warehouse_required' USING ERRCODE = '22023';
    END IF;
    PERFORM 1
    FROM public.bins b
    WHERE b.id = NEW.bin_id
      AND b.company_id = NEW.company_id
      AND b."warehouseId" = NEW.warehouse_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_growth_batch_harvest_update(
  p_company_id uuid,
  p_growth_batch_id uuid,
  p_expected_quantity numeric,
  p_expected_weight numeric,
  p_expected_harvested_cost numeric,
  p_expected_remaining_cost numeric,
  p_new_quantity numeric,
  p_new_weight numeric,
  p_new_harvested_cost numeric,
  p_new_remaining_cost numeric,
  p_user uuid,
  p_event_sequence integer
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

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_growth_batch_id
    AND company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty) IS DISTINCT FROM p_expected_quantity
    OR v_batch.current_total_weight IS DISTINCT FROM p_expected_weight
    OR v_batch.harvested_cost IS DISTINCT FROM p_expected_harvested_cost
    OR v_batch.remaining_cost IS DISTINCT FROM p_expected_remaining_cost THEN
    RAISE EXCEPTION 'growth_batch_harvest_source_changed' USING ERRCODE = 'P0001';
  END IF;

  IF p_event_sequence IS NULL OR p_event_sequence <> v_batch.latest_event_sequence + 1 THEN
    RAISE EXCEPTION 'growth_batch_harvest_sequence_invalid' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);
  PERFORM set_config('stockwise.growth_batch_harvest_update', 'on', true);

  UPDATE public.growth_batches
     SET current_primary_qty = p_new_quantity,
         current_total_weight = p_new_weight,
         harvested_cost = p_new_harvested_cost,
         remaining_cost = p_new_remaining_cost,
         latest_event_sequence = p_event_sequence,
         updated_by = p_user
   WHERE id = p_growth_batch_id
     AND company_id = p_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_growth_batch_harvest(
  p_growth_batch_id uuid,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_harvested_primary_qty numeric DEFAULT NULL,
  p_harvested_total_weight numeric DEFAULT NULL,
  p_output_item_id uuid DEFAULT NULL,
  p_output_quantity numeric DEFAULT NULL,
  p_destination_warehouse_id uuid DEFAULT NULL,
  p_destination_bin_id text DEFAULT NULL,
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
  v_item public.items%ROWTYPE;
  v_warehouse record;
  v_bin record;
  v_destination_bin_id text := NULLIF(btrim(COALESCE(p_destination_bin_id, '')), '');
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_notes text := public.growth_batch_normalize_location_description(p_notes);
  v_quantity_before numeric;
  v_quantity_after numeric;
  v_harvest_qty numeric;
  v_weight_before numeric;
  v_weight_after numeric;
  v_harvest_weight numeric;
  v_output_qty numeric;
  v_allocated_cost numeric := 0;
  v_output_unit_cost numeric := 0;
  v_harvested_cost_after numeric := 0;
  v_remaining_cost_after numeric := 0;
  v_harvest_kind text;
  v_latest_state_date date;
  v_primary_uom_code text;
  v_weight_uom_code text;
  v_output_item_name text;
  v_output_uom_id text;
  v_output_uom_code text;
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

  v_quantity_before := COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty);
  v_weight_before := v_batch.current_total_weight;
  v_harvest_qty := CASE WHEN p_harvested_primary_qty IS NULL THEN NULL ELSE round(p_harvested_primary_qty::numeric, 12) END;
  v_harvest_weight := CASE WHEN p_harvested_total_weight IS NULL THEN NULL ELSE round(p_harvested_total_weight::numeric, 12) END;
  v_output_qty := CASE WHEN p_output_quantity IS NULL THEN NULL ELSE round(p_output_quantity::numeric, 12) END;

  IF v_batch.status <> 'active' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_not_active'));
  END IF;
  IF COALESCE(v_quantity_before, 0) <= 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_empty_batch'));
  END IF;
  IF v_effective_date < v_batch.start_date THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_date_before_start'));
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_date_in_future'));
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
        'harvest_reversal'
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
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_date_before_latest_state_event'));
  END IF;

  IF v_harvest_qty IS NULL OR v_harvest_qty <= 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_quantity_required'));
  ELSIF v_harvest_qty > v_quantity_before THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_quantity_exceeds_current'));
  ELSIF v_batch.primary_quantity_basis = 'count' AND v_harvest_qty <> trunc(v_harvest_qty) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'fractional_count_not_allowed'));
  END IF;

  IF v_weight_before IS NOT NULL THEN
    IF v_harvest_weight IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_weight_required'));
    ELSIF v_harvest_weight <= 0 THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_weight_invalid'));
    ELSIF v_harvest_weight > v_weight_before THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_weight_exceeds_current'));
    END IF;
  ELSIF v_harvest_weight IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_weight_without_current_weight'));
  END IF;

  IF v_harvest_qty IS NOT NULL AND v_quantity_before > 0 THEN
    v_harvest_kind := CASE WHEN v_harvest_qty = v_quantity_before THEN 'full' ELSE 'partial' END;
    IF v_harvest_kind = 'full' AND v_weight_before IS NOT NULL AND v_harvest_weight IS DISTINCT FROM v_weight_before THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_full_weight_must_match_current'));
    END IF;
  ELSE
    v_harvest_kind := 'partial';
  END IF;

  IF v_output_qty IS NULL OR v_output_qty <= 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_output_quantity_required'));
  END IF;

  IF p_output_item_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_output_item_required'));
  ELSE
    SELECT *
      INTO v_item
    FROM public.items i
    WHERE i.id = p_output_item_id
      AND i.company_id = v_company_id;
    IF NOT FOUND THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_output_item_invalid'));
    ELSIF COALESCE(v_item.track_inventory, false) IS DISTINCT FROM true THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_output_item_not_stock_tracked'));
    ELSIF NULLIF(btrim(COALESCE(v_item.base_uom_id, '')), '') IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_output_item_base_uom_required'));
    ELSE
      v_output_item_name := v_item.name;
      v_output_uom_id := v_item.base_uom_id;
    END IF;
  END IF;

  IF p_destination_warehouse_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_destination_required'));
  ELSE
    SELECT w.id, w.code, w.name, w.status
      INTO v_warehouse
    FROM public.warehouses w
    WHERE w.id = p_destination_warehouse_id
      AND w.company_id = v_company_id;
    IF NOT FOUND THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_destination_invalid'));
    ELSIF COALESCE(v_warehouse.status, 'active') <> 'active' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_destination_inactive'));
    END IF;
  END IF;

  IF v_destination_bin_id IS NOT NULL THEN
    SELECT b.id, b.code, b.name, b.status, b."warehouseId"
      INTO v_bin
    FROM public.bins b
    WHERE b.id = v_destination_bin_id
      AND b.company_id = v_company_id;
    IF NOT FOUND OR v_bin."warehouseId" IS DISTINCT FROM p_destination_warehouse_id THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_destination_bin_invalid'));
    ELSIF COALESCE(v_bin.status, 'active') <> 'active' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'growth_batch_harvest_destination_inactive'));
    END IF;
  END IF;

  v_quantity_after := CASE
    WHEN v_harvest_qty IS NULL THEN v_quantity_before
    ELSE round((v_quantity_before - v_harvest_qty)::numeric, 12)
  END;
  v_weight_after := CASE
    WHEN v_weight_before IS NULL THEN NULL
    WHEN v_harvest_weight IS NULL THEN v_weight_before
    ELSE round((v_weight_before - v_harvest_weight)::numeric, 12)
  END;
  IF v_harvest_qty IS NOT NULL AND v_quantity_before > 0 THEN
    v_allocated_cost := CASE
      WHEN v_harvest_qty = v_quantity_before THEN round(v_batch.remaining_cost::numeric, 6)
      ELSE round((v_batch.remaining_cost * v_harvest_qty / v_quantity_before)::numeric, 6)
    END;
  END IF;
  v_harvested_cost_after := round((v_batch.harvested_cost + v_allocated_cost)::numeric, 6);
  v_remaining_cost_after := round((v_batch.remaining_cost - v_allocated_cost)::numeric, 6);
  IF v_output_qty IS NOT NULL AND v_output_qty > 0 THEN
    v_output_unit_cost := round((v_allocated_cost / v_output_qty)::numeric, 6);
  END IF;

  SELECT u.code INTO v_primary_uom_code FROM public.uoms u WHERE u.id = v_batch.primary_uom_id;
  SELECT u.code INTO v_weight_uom_code FROM public.uoms u WHERE u.id = v_batch.weight_uom_id;
  IF v_output_uom_id IS NOT NULL THEN
    SELECT u.code INTO v_output_uom_code FROM public.uoms u WHERE u.id = v_output_uom_id;
  END IF;

  v_source_fingerprint := public.growth_batch_harvest_state_fingerprint(
    v_company_id,
    p_growth_batch_id,
    v_batch.status,
    v_batch.warehouse_id,
    v_batch.bin_id,
    v_batch.location_description,
    v_quantity_before,
    v_batch.current_total_weight,
    v_batch.accumulated_total_cost,
    v_batch.harvested_cost,
    v_batch.remaining_cost
  );

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'blocking_reasons', v_blockers,
    'batch_id', v_batch.id,
    'reference_no', v_batch.reference_no,
    'name', v_batch.name,
    'batch_family', v_batch.batch_family,
    'status', v_batch.status,
    'effective_date', v_effective_date,
    'harvest_kind', v_harvest_kind,
    'current_quantity', v_quantity_before,
    'harvested_primary_qty', v_harvest_qty,
    'resulting_quantity', v_quantity_after,
    'primary_uom_id', v_batch.primary_uom_id,
    'primary_uom_code', v_primary_uom_code,
    'current_total_weight', v_weight_before,
    'harvested_total_weight', v_harvest_weight,
    'resulting_total_weight', v_weight_after,
    'weight_uom_id', v_batch.weight_uom_id,
    'weight_uom_code', v_weight_uom_code,
    'accumulated_total_cost', v_batch.accumulated_total_cost,
    'harvested_cost_before', v_batch.harvested_cost,
    'harvested_cost_after', v_harvested_cost_after,
    'remaining_cost_before', v_batch.remaining_cost,
    'remaining_cost_after', v_remaining_cost_after,
    'allocated_cost', v_allocated_cost,
    'output_item_id', p_output_item_id,
    'output_item_name', v_output_item_name,
    'output_uom_id', v_output_uom_id,
    'output_uom_code', v_output_uom_code,
    'output_quantity', v_output_qty,
    'output_unit_cost', v_output_unit_cost,
    'destination_location', public.growth_batch_transfer_location_display(v_company_id, p_destination_warehouse_id, v_destination_bin_id, NULL),
    'source_location', public.growth_batch_transfer_location_display(v_company_id, v_batch.warehouse_id, v_batch.bin_id, v_batch.location_description),
    'source_fingerprint', v_source_fingerprint,
    'stock_effect', 'one_stock_receipt',
    'stock_effect_note', 'One receipt is posted for the harvested output item only.',
    'finance_effect', 'not_affected',
    'cogs_effect', 'not_affected',
    'sale_effect', 'not_affected',
    'items_unit_price_effect', 'unchanged',
    'notes', v_notes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_growth_batch_harvest(
  p_growth_batch_id uuid,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_harvested_primary_qty numeric DEFAULT NULL,
  p_harvested_total_weight numeric DEFAULT NULL,
  p_output_item_id uuid DEFAULT NULL,
  p_output_quantity numeric DEFAULT NULL,
  p_destination_warehouse_id uuid DEFAULT NULL,
  p_destination_bin_id text DEFAULT NULL,
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
  v_item public.items%ROWTYPE;
  v_destination_warehouse record;
  v_destination_bin record;
  v_destination_bin_id text := NULLIF(btrim(COALESCE(p_destination_bin_id, '')), '');
  v_notes text := public.growth_batch_normalize_location_description(p_notes);
  v_notes_present boolean := p_notes IS NOT NULL;
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_harvest_qty numeric := CASE WHEN p_harvested_primary_qty IS NULL THEN NULL ELSE round(p_harvested_primary_qty::numeric, 12) END;
  v_harvest_weight numeric := CASE WHEN p_harvested_total_weight IS NULL THEN NULL ELSE round(p_harvested_total_weight::numeric, 12) END;
  v_output_qty numeric := CASE WHEN p_output_quantity IS NULL THEN NULL ELSE round(p_output_quantity::numeric, 12) END;
  v_expected_fingerprint text := NULLIF(btrim(COALESCE(p_expected_source_fingerprint, '')), '');
  v_current_fingerprint text;
  v_quantity_before numeric;
  v_quantity_after numeric;
  v_weight_before numeric;
  v_weight_after numeric;
  v_allocated_cost numeric;
  v_output_unit_cost numeric;
  v_harvested_cost_after numeric;
  v_remaining_cost_after numeric;
  v_harvest_kind text;
  v_latest_state_date date;
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_event_id uuid;
  v_event_reference text;
  v_harvest_id uuid := gen_random_uuid();
  v_receipt_movement_id uuid;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(v_company_id);

  IF v_expected_fingerprint IS NULL THEN
    RAISE EXCEPTION 'growth_batch_harvest_source_fingerprint_required' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'company_id', v_company_id,
    'batch_id', p_growth_batch_id,
    'effective_date', v_effective_date,
    'harvested_primary_qty', v_harvest_qty,
    'harvested_total_weight_present', v_harvest_weight IS NOT NULL,
    'harvested_total_weight', v_harvest_weight,
    'output_item_id', p_output_item_id,
    'output_quantity', v_output_qty,
    'destination_warehouse_id', p_destination_warehouse_id,
    'destination_bin_id', v_destination_bin_id,
    'notes_present', v_notes_present,
    'notes', v_notes,
    'expected_source_fingerprint', v_expected_fingerprint
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(v_company_id, 'growth.batch.harvest', p_request_key, v_hash);

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

  v_quantity_before := COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty);
  v_weight_before := v_batch.current_total_weight;
  IF COALESCE(v_quantity_before, 0) <= 0 THEN
    RAISE EXCEPTION 'growth_batch_harvest_empty_batch' USING ERRCODE = '22023';
  END IF;

  v_current_fingerprint := public.growth_batch_harvest_state_fingerprint(
    v_company_id,
    p_growth_batch_id,
    v_batch.status,
    v_batch.warehouse_id,
    v_batch.bin_id,
    v_batch.location_description,
    v_quantity_before,
    v_weight_before,
    v_batch.accumulated_total_cost,
    v_batch.harvested_cost,
    v_batch.remaining_cost
  );
  IF v_current_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
    RAISE EXCEPTION 'growth_batch_harvest_source_changed' USING ERRCODE = 'P0001';
  END IF;

  IF v_effective_date < v_batch.start_date THEN
    RAISE EXCEPTION 'growth_batch_harvest_date_before_start' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_harvest_date_in_future' USING ERRCODE = '22023';
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
        'harvest_reversal'
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
    RAISE EXCEPTION 'growth_batch_harvest_date_before_latest_state_event' USING ERRCODE = '22023';
  END IF;

  IF v_harvest_qty IS NULL OR v_harvest_qty <= 0 THEN
    RAISE EXCEPTION 'growth_batch_harvest_quantity_required' USING ERRCODE = '22023';
  END IF;
  IF v_batch.primary_quantity_basis = 'count' AND v_harvest_qty <> trunc(v_harvest_qty) THEN
    RAISE EXCEPTION 'fractional_count_not_allowed' USING ERRCODE = '22023';
  END IF;
  IF v_harvest_qty > v_quantity_before THEN
    RAISE EXCEPTION 'growth_batch_harvest_quantity_exceeds_current' USING ERRCODE = '22023';
  END IF;

  v_harvest_kind := CASE WHEN v_harvest_qty = v_quantity_before THEN 'full' ELSE 'partial' END;
  IF v_weight_before IS NOT NULL THEN
    IF v_harvest_weight IS NULL THEN
      RAISE EXCEPTION 'growth_batch_harvest_weight_required' USING ERRCODE = '22023';
    END IF;
    IF v_harvest_weight <= 0 THEN
      RAISE EXCEPTION 'growth_batch_harvest_weight_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_harvest_weight > v_weight_before THEN
      RAISE EXCEPTION 'growth_batch_harvest_weight_exceeds_current' USING ERRCODE = '22023';
    END IF;
    IF v_harvest_kind = 'full' AND v_harvest_weight IS DISTINCT FROM v_weight_before THEN
      RAISE EXCEPTION 'growth_batch_harvest_full_weight_must_match_current' USING ERRCODE = '22023';
    END IF;
  ELSIF v_harvest_weight IS NOT NULL THEN
    RAISE EXCEPTION 'growth_batch_harvest_weight_without_current_weight' USING ERRCODE = '22023';
  END IF;

  IF p_output_item_id IS NULL THEN
    RAISE EXCEPTION 'growth_batch_harvest_output_item_required' USING ERRCODE = '22023';
  END IF;
  SELECT *
    INTO v_item
  FROM public.items i
  WHERE i.id = p_output_item_id
    AND i.company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_harvest_output_item_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_item.track_inventory, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'growth_batch_harvest_output_item_not_stock_tracked' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(v_item.base_uom_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'growth_batch_harvest_output_item_base_uom_required' USING ERRCODE = '22023';
  END IF;
  IF v_output_qty IS NULL OR v_output_qty <= 0 THEN
    RAISE EXCEPTION 'growth_batch_harvest_output_quantity_required' USING ERRCODE = '22023';
  END IF;

  IF p_destination_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'growth_batch_harvest_destination_required' USING ERRCODE = '22023';
  END IF;
  SELECT w.id, w.code, w.name, w.status
    INTO v_destination_warehouse
  FROM public.warehouses w
  WHERE w.id = p_destination_warehouse_id
    AND w.company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_harvest_destination_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_destination_warehouse.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'growth_batch_harvest_destination_inactive' USING ERRCODE = 'P0001';
  END IF;

  IF v_destination_bin_id IS NOT NULL THEN
    SELECT b.id, b.code, b.name, b.status, b."warehouseId"
      INTO v_destination_bin
    FROM public.bins b
    WHERE b.id = v_destination_bin_id
      AND b.company_id = v_company_id;
    IF NOT FOUND OR v_destination_bin."warehouseId" IS DISTINCT FROM p_destination_warehouse_id THEN
      RAISE EXCEPTION 'growth_batch_harvest_destination_bin_invalid' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_destination_bin.status, 'active') <> 'active' THEN
      RAISE EXCEPTION 'growth_batch_harvest_destination_inactive' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_quantity_after := round((v_quantity_before - v_harvest_qty)::numeric, 12);
  v_weight_after := CASE
    WHEN v_weight_before IS NULL THEN NULL
    ELSE round((v_weight_before - v_harvest_weight)::numeric, 12)
  END;
  v_allocated_cost := CASE
    WHEN v_harvest_kind = 'full' THEN round(v_batch.remaining_cost::numeric, 6)
    ELSE round((v_batch.remaining_cost * v_harvest_qty / v_quantity_before)::numeric, 6)
  END;
  v_output_unit_cost := round((v_allocated_cost / v_output_qty)::numeric, 6);
  v_harvested_cost_after := round((v_batch.harvested_cost + v_allocated_cost)::numeric, 6);
  v_remaining_cost_after := CASE
    WHEN v_harvest_kind = 'full' THEN 0
    ELSE round((v_batch.remaining_cost - v_allocated_cost)::numeric, 6)
  END;
  v_sequence := v_batch.latest_event_sequence + 1;
  v_event_reference := v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0');

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
    posting_request_id,
    created_by
  ) VALUES (
    v_company_id,
    p_growth_batch_id,
    v_sequence,
    v_event_reference,
    'harvest',
    now(),
    v_effective_date,
    -v_harvest_qty,
    CASE WHEN v_harvest_weight IS NULL THEN NULL ELSE -v_harvest_weight END,
    CASE WHEN v_harvest_weight IS NULL THEN NULL ELSE v_batch.weight_uom_id END,
    0,
    0,
    0,
    v_batch.base_currency_code,
    v_notes,
    v_request.request_id,
    v_user
  )
  RETURNING id INTO v_event_id;

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
    p_output_item_id,
    v_item.base_uom_id,
    v_output_qty,
    v_output_qty,
    v_output_unit_cost,
    v_allocated_cost,
    p_destination_warehouse_id,
    v_destination_bin_id,
    COALESCE(v_notes, 'Growth Batch harvest ' || v_batch.reference_no),
    v_user::text,
    'GROWTH_BATCH_HARVEST',
    v_event_id::text,
    v_harvest_id
  )
  RETURNING id INTO v_receipt_movement_id;

  INSERT INTO public.growth_batch_harvests (
    id,
    company_id,
    growth_batch_id,
    event_id,
    harvest_kind,
    harvested_primary_qty,
    primary_uom_id,
    quantity_before,
    quantity_after,
    harvested_weight,
    weight_uom_id,
    total_weight_before,
    total_weight_after,
    output_item_id,
    output_uom_id,
    output_quantity,
    destination_warehouse_id,
    destination_bin_id,
    allocated_cost,
    output_unit_cost,
    accumulated_total_cost,
    harvested_cost_before,
    harvested_cost_after,
    remaining_cost_before,
    remaining_cost_after,
    stock_receipt_movement_id,
    source_warehouse_id,
    source_bin_id,
    source_location_description,
    source_state_fingerprint,
    effective_date,
    notes,
    created_by
  ) VALUES (
    v_harvest_id,
    v_company_id,
    p_growth_batch_id,
    v_event_id,
    v_harvest_kind,
    v_harvest_qty,
    v_batch.primary_uom_id,
    v_quantity_before,
    v_quantity_after,
    v_harvest_weight,
    CASE WHEN v_harvest_weight IS NULL THEN NULL ELSE v_batch.weight_uom_id END,
    v_weight_before,
    v_weight_after,
    p_output_item_id,
    v_item.base_uom_id,
    v_output_qty,
    p_destination_warehouse_id,
    v_destination_bin_id,
    v_allocated_cost,
    v_output_unit_cost,
    v_batch.accumulated_total_cost,
    v_batch.harvested_cost,
    v_harvested_cost_after,
    v_batch.remaining_cost,
    v_remaining_cost_after,
    v_receipt_movement_id,
    v_batch.warehouse_id,
    v_batch.bin_id,
    public.growth_batch_normalize_location_description(v_batch.location_description),
    v_current_fingerprint,
    v_effective_date,
    v_notes,
    v_user
  );

  PERFORM public.apply_growth_batch_harvest_update(
    v_company_id,
    p_growth_batch_id,
    v_quantity_before,
    v_weight_before,
    v_batch.harvested_cost,
    v_batch.remaining_cost,
    v_quantity_after,
    v_weight_after,
    v_harvested_cost_after,
    v_remaining_cost_after,
    v_user,
    v_sequence
  );

  v_result := jsonb_build_object(
    'batch_id', p_growth_batch_id,
    'reference_no', v_batch.reference_no,
    'event_id', v_event_id,
    'event_reference', v_event_reference,
    'event_sequence', v_sequence,
    'event_type', 'harvest',
    'harvest_detail_id', v_harvest_id,
    'harvest_kind', v_harvest_kind,
    'stock_receipt_movement_id', v_receipt_movement_id,
    'quantity_before', v_quantity_before,
    'quantity_harvested', v_harvest_qty,
    'quantity_after', v_quantity_after,
    'weight_before', v_weight_before,
    'weight_harvested', v_harvest_weight,
    'weight_after', v_weight_after,
    'allocated_cost', v_allocated_cost,
    'output_unit_cost', v_output_unit_cost,
    'harvested_cost_after', v_harvested_cost_after,
    'remaining_cost_after', v_remaining_cost_after,
    'output_item_id', p_output_item_id,
    'output_uom_id', v_item.base_uom_id,
    'output_quantity', v_output_qty,
    'destination_location', public.growth_batch_transfer_location_display(v_company_id, p_destination_warehouse_id, v_destination_bin_id, NULL),
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

CREATE OR REPLACE FUNCTION public.reverse_growth_batch_harvest(
  p_original_event_id uuid,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_reason text DEFAULT NULL,
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
  v_original_event public.growth_batch_events%ROWTYPE;
  v_harvest public.growth_batch_harvests%ROWTYPE;
  v_batch public.growth_batches%ROWTYPE;
  v_existing_reversal public.growth_batch_harvest_reversal_lines%ROWTYPE;
  v_reason text := public.growth_batch_normalize_location_description(p_reason);
  v_effective_date date := COALESCE(p_effective_date, CURRENT_DATE);
  v_expected_fingerprint text := NULLIF(btrim(COALESCE(p_expected_source_fingerprint, '')), '');
  v_current_fingerprint text;
  v_quantity_before numeric;
  v_quantity_after numeric;
  v_weight_before numeric;
  v_weight_after numeric;
  v_harvested_cost_after numeric;
  v_remaining_cost_after numeric;
  v_available numeric;
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_reversal_event_id uuid;
  v_event_reference text;
  v_reversal_line_id uuid := gen_random_uuid();
  v_issue_movement_id uuid;
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
    'reason', v_reason,
    'expected_source_fingerprint', v_expected_fingerprint
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(v_company_id, 'growth.batch.harvest.reverse', p_request_key, v_hash);

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
  IF NOT FOUND OR v_original_event.event_type <> 'harvest' THEN
    RAISE EXCEPTION 'growth_batch_harvest_original_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_harvest
  FROM public.growth_batch_harvests h
  WHERE h.event_id = p_original_event_id
    AND h.company_id = v_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_harvest_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches gb
  WHERE gb.id = v_harvest.growth_batch_id
    AND gb.company_id = v_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_batch.status <> 'active' THEN
    RAISE EXCEPTION 'growth_batch_not_active' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_existing_reversal
  FROM public.growth_batch_harvest_reversal_lines r
  WHERE r.original_harvest_id = v_harvest.id
    AND r.company_id = v_company_id
  FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'growth_batch_harvest_already_reversed' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.growth_batch_events later
    WHERE later.company_id = v_company_id
      AND later.growth_batch_id = v_harvest.growth_batch_id
      AND later.event_sequence > v_original_event.event_sequence
      AND later.event_type IN (
        'harvest',
        'harvest_reversal',
        'mortality',
        'mortality_reversal',
        'shrinkage',
        'shrinkage_reversal',
        'stock_input',
        'stock_input_reversal',
        'direct_cost'
      )
  ) THEN
    RAISE EXCEPTION 'growth_batch_harvest_reversal_dependency_exists' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.growth_batch_events later
    JOIN public.growth_batch_measurements m
      ON m.growth_batch_event_id = later.id
     AND m.company_id = later.company_id
     AND m.growth_batch_id = later.growth_batch_id
    WHERE later.company_id = v_company_id
      AND later.growth_batch_id = v_harvest.growth_batch_id
      AND later.event_sequence > v_original_event.event_sequence
      AND later.event_type = 'measurement'
      AND m.measurement_type = 'total_weight'
  ) THEN
    RAISE EXCEPTION 'growth_batch_harvest_reversal_dependency_exists' USING ERRCODE = 'P0001';
  END IF;

  v_quantity_before := COALESCE(v_batch.current_primary_qty, v_batch.opening_primary_qty);
  v_weight_before := v_batch.current_total_weight;
  IF v_quantity_before IS DISTINCT FROM v_harvest.quantity_after
    OR v_weight_before IS DISTINCT FROM v_harvest.total_weight_after
    OR v_batch.harvested_cost IS DISTINCT FROM v_harvest.harvested_cost_after
    OR v_batch.remaining_cost IS DISTINCT FROM v_harvest.remaining_cost_after THEN
    RAISE EXCEPTION 'growth_batch_harvest_current_state_mismatch' USING ERRCODE = 'P0001';
  END IF;

  v_current_fingerprint := public.growth_batch_harvest_state_fingerprint(
    v_company_id,
    v_harvest.growth_batch_id,
    v_batch.status,
    v_batch.warehouse_id,
    v_batch.bin_id,
    v_batch.location_description,
    v_quantity_before,
    v_weight_before,
    v_batch.accumulated_total_cost,
    v_batch.harvested_cost,
    v_batch.remaining_cost
  );
  IF v_expected_fingerprint IS NOT NULL AND v_current_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
    RAISE EXCEPTION 'growth_batch_harvest_source_changed' USING ERRCODE = 'P0001';
  END IF;

  IF v_effective_date < v_original_event.event_date THEN
    RAISE EXCEPTION 'growth_batch_harvest_reversal_date_before_original' USING ERRCODE = '22023';
  END IF;
  IF v_effective_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_harvest_date_in_future' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sl.qty, 0)
    INTO v_available
  FROM public.stock_levels sl
  WHERE sl.company_id = v_company_id
    AND sl.item_id = v_harvest.output_item_id
    AND sl.warehouse_id = v_harvest.destination_warehouse_id
    AND sl.bin_id IS NOT DISTINCT FROM v_harvest.destination_bin_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_available, 0) < v_harvest.output_quantity THEN
    RAISE EXCEPTION 'growth_batch_harvest_reversal_insufficient_output_stock' USING ERRCODE = 'P0001';
  END IF;

  v_quantity_after := round((v_quantity_before + v_harvest.harvested_primary_qty)::numeric, 12);
  v_weight_after := CASE
    WHEN v_harvest.harvested_weight IS NULL THEN v_weight_before
    ELSE round((v_weight_before + v_harvest.harvested_weight)::numeric, 12)
  END;
  v_harvested_cost_after := round((v_batch.harvested_cost - v_harvest.allocated_cost)::numeric, 6);
  v_remaining_cost_after := round((v_batch.remaining_cost + v_harvest.allocated_cost)::numeric, 6);
  v_sequence := v_batch.latest_event_sequence + 1;
  v_event_reference := v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0');

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
    v_harvest.growth_batch_id,
    v_sequence,
    v_event_reference,
    'harvest_reversal',
    now(),
    v_effective_date,
    v_harvest.harvested_primary_qty,
    v_harvest.harvested_weight,
    v_harvest.weight_uom_id,
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
    v_harvest.output_item_id,
    v_harvest.output_uom_id,
    v_harvest.output_quantity,
    v_harvest.output_quantity,
    v_harvest.output_unit_cost,
    v_harvest.allocated_cost,
    v_harvest.destination_warehouse_id,
    v_harvest.destination_bin_id,
    'Growth Batch harvest reversal ' || v_batch.reference_no || ': ' || v_reason,
    v_user::text,
    'GROWTH_BATCH_HARVEST_REVERSAL',
    v_reversal_event_id::text,
    v_reversal_line_id
  )
  RETURNING id INTO v_issue_movement_id;

  INSERT INTO public.growth_batch_harvest_reversal_lines (
    id,
    company_id,
    growth_batch_id,
    reversal_event_id,
    original_event_id,
    original_harvest_id,
    restored_primary_qty,
    primary_uom_id,
    quantity_before,
    quantity_after,
    restored_weight,
    weight_uom_id,
    total_weight_before,
    total_weight_after,
    allocated_cost_restored,
    harvested_cost_before,
    harvested_cost_after,
    remaining_cost_before,
    remaining_cost_after,
    output_item_id,
    output_uom_id,
    output_quantity,
    destination_warehouse_id,
    destination_bin_id,
    stock_issue_movement_id,
    reason,
    created_by
  ) VALUES (
    v_reversal_line_id,
    v_company_id,
    v_harvest.growth_batch_id,
    v_reversal_event_id,
    p_original_event_id,
    v_harvest.id,
    v_harvest.harvested_primary_qty,
    v_harvest.primary_uom_id,
    v_quantity_before,
    v_quantity_after,
    v_harvest.harvested_weight,
    v_harvest.weight_uom_id,
    v_weight_before,
    v_weight_after,
    v_harvest.allocated_cost,
    v_batch.harvested_cost,
    v_harvested_cost_after,
    v_batch.remaining_cost,
    v_remaining_cost_after,
    v_harvest.output_item_id,
    v_harvest.output_uom_id,
    v_harvest.output_quantity,
    v_harvest.destination_warehouse_id,
    v_harvest.destination_bin_id,
    v_issue_movement_id,
    v_reason,
    v_user
  );

  PERFORM public.apply_growth_batch_harvest_update(
    v_company_id,
    v_harvest.growth_batch_id,
    v_quantity_before,
    v_weight_before,
    v_batch.harvested_cost,
    v_batch.remaining_cost,
    v_quantity_after,
    v_weight_after,
    v_harvested_cost_after,
    v_remaining_cost_after,
    v_user,
    v_sequence
  );

  v_result := jsonb_build_object(
    'batch_id', v_harvest.growth_batch_id,
    'reference_no', v_batch.reference_no,
    'event_id', v_reversal_event_id,
    'event_reference', v_event_reference,
    'event_sequence', v_sequence,
    'event_type', 'harvest_reversal',
    'original_event_id', p_original_event_id,
    'original_harvest_id', v_harvest.id,
    'reversal_detail_id', v_reversal_line_id,
    'stock_issue_movement_id', v_issue_movement_id,
    'quantity_before', v_quantity_before,
    'quantity_restored', v_harvest.harvested_primary_qty,
    'quantity_after', v_quantity_after,
    'weight_before', v_weight_before,
    'weight_restored', v_harvest.harvested_weight,
    'weight_after', v_weight_after,
    'allocated_cost_restored', v_harvest.allocated_cost,
    'harvested_cost_after', v_harvested_cost_after,
    'remaining_cost_after', v_remaining_cost_after,
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

ALTER FUNCTION public.growth_batch_harvest_state_fingerprint(uuid, uuid, text, uuid, text, text, numeric, numeric, numeric, numeric, numeric) OWNER TO postgres;
ALTER FUNCTION public.validate_growth_batch_row() OWNER TO postgres;
ALTER FUNCTION public.apply_growth_batch_harvest_update(uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.preview_growth_batch_harvest(uuid, date, numeric, numeric, uuid, numeric, uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.post_growth_batch_harvest(uuid, date, numeric, numeric, uuid, numeric, uuid, text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.reverse_growth_batch_harvest(uuid, date, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.growth_batch_harvest_state_fingerprint(uuid, uuid, text, uuid, text, text, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_growth_batch_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_growth_batch_harvest_update(uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_growth_batch_harvest(uuid, date, numeric, numeric, uuid, numeric, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_growth_batch_harvest(uuid, date, numeric, numeric, uuid, numeric, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_growth_batch_harvest(uuid, date, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.preview_growth_batch_harvest(uuid, date, numeric, numeric, uuid, numeric, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_growth_batch_harvest(uuid, date, numeric, numeric, uuid, numeric, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_growth_batch_harvest(uuid, date, text, text, text) TO authenticated;

GRANT SELECT ON public.growth_batch_harvest_history TO authenticated;
GRANT SELECT ON public.growth_batch_harvest_history TO service_role;

COMMENT ON FUNCTION public.growth_batch_harvest_state_fingerprint(uuid, uuid, text, uuid, text, text, numeric, numeric, numeric, numeric, numeric)
IS 'G5.1 canonical harvest source-state fingerprint over company, batch, status, location, quantity, weight, and cost allocation fields only.';
COMMENT ON FUNCTION public.preview_growth_batch_harvest(uuid, date, numeric, numeric, uuid, numeric, uuid, text, text)
IS 'G5.1 non-mutating depleting harvest preview. It creates no event, posting request, stock movement, stock-level update, finance row, cost mutation, or price change.';
COMMENT ON FUNCTION public.post_growth_batch_harvest(uuid, date, numeric, numeric, uuid, numeric, uuid, text, text, text, text)
IS 'G5.1 governed OPERATOR+ depleting harvest posting. Creates one immutable harvest event/detail, one output stock receipt, and moves proportional remaining cost to harvested cost.';
COMMENT ON FUNCTION public.reverse_growth_batch_harvest(uuid, date, text, text, text)
IS 'G5.1 MANAGER+ event-specific harvest reversal. Creates one immutable reversal event/detail, one compensating output stock issue, and restores the frozen quantity, weight, and cost allocation.';
