-- Production Runs draft management, preview, idempotent posting, and reversal.
-- These functions keep stock_movements append-only and never mutate stock_levels
-- or items.unit_price directly.

CREATE OR REPLACE FUNCTION public.stockwise_require_manager_company(
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

  IF v_role NOT IN ('OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role) THEN
    RAISE EXCEPTION 'manager_role_required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.company_access_is_enabled(p_company_id) THEN
    RAISE EXCEPTION 'company_access_disabled' USING ERRCODE = '42501';
  END IF;

  RETURN v_user;
END;
$$;

ALTER FUNCTION public.stockwise_require_manager_company(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.stockwise_require_manager_company(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.next_production_run_reference(
  p_company_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_next bigint;
  v_prefix text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.production_run_counters(company_id, next_number, updated_at)
  VALUES (p_company_id, 2, now())
  ON CONFLICT (company_id) DO UPDATE
    SET next_number = public.production_run_counters.next_number + 1,
        updated_at = now()
  RETURNING next_number - 1 INTO v_next;

  v_prefix := COALESCE(NULLIF(public.company_code3(p_company_id), ''), 'RUN');
  RETURN v_prefix || '-PR' || lpad(v_next::text, 9, '0');
END;
$$;

ALTER FUNCTION public.next_production_run_reference(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.next_production_run_reference(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.production_run_payload(
  p_company_id uuid,
  p_run_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  SELECT jsonb_build_object(
    'company_id', pr.company_id,
    'run_id', pr.id,
    'bom_id', pr.bom_id,
    'bom_version', COALESCE(pr.bom_version_snapshot, ''),
    'planned_output_qty', round(pr.planned_output_qty::numeric, 12),
    'actual_output_qty', round(COALESCE(pr.actual_output_qty, 0)::numeric, 12),
    'run_date', pr.run_date,
    'finished_item_id', pr.finished_item_id,
    'output_uom_id', pr.output_uom_id,
    'destination_warehouse_id', pr.destination_warehouse_id,
    'destination_bin_id', pr.destination_bin_id,
    'notes', NULLIF(btrim(COALESCE(pr.notes, '')), ''),
    'inputs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'line_no', pri.line_no,
        'bom_component_id', pri.bom_component_id,
        'item_id', pri.item_id,
        'uom_id', pri.uom_id,
        'planned_qty', round(pri.planned_qty::numeric, 12),
        'actual_qty', round(COALESCE(pri.actual_qty, 0)::numeric, 12),
        'source_warehouse_id', pri.source_warehouse_id,
        'source_bin_id', pri.source_bin_id
      ) ORDER BY pri.line_no)
      FROM public.production_run_inputs pri
      WHERE pri.production_run_id = pr.id
        AND pri.company_id = pr.company_id
    ), '[]'::jsonb),
    'extra_costs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'line_no', prec.line_no,
        'category', prec.category,
        'description', NULLIF(btrim(COALESCE(prec.description, '')), ''),
        'amount_base', round(prec.amount_base::numeric, 12)
      ) ORDER BY prec.line_no)
      FROM public.production_run_extra_costs prec
      WHERE prec.production_run_id = pr.id
        AND prec.company_id = pr.company_id
    ), '[]'::jsonb)
  )
    INTO v_payload
  FROM public.production_runs pr
  WHERE pr.id = p_run_id
    AND pr.company_id = p_company_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'production_run_not_found' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_payload;
END;
$$;

ALTER FUNCTION public.production_run_payload(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.production_run_payload(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_production_run_draft(
  p_company_id uuid,
  p_bom_id uuid,
  p_planned_output_qty numeric,
  p_run_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_bom record;
  v_reference text;
  v_run_id uuid;
  v_base_currency text := 'MZN';
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  IF COALESCE(p_planned_output_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'planned_output_quantity_required' USING ERRCODE = '22023';
  END IF;

  SELECT b.id, b.name, b.version, b.product_id, i.base_uom_id
    INTO v_bom
  FROM public.boms b
  JOIN public.items i
    ON i.id = b.product_id
   AND i.company_id = b.company_id
  WHERE b.id = p_bom_id
    AND b.company_id = p_company_id
    AND COALESCE(b.is_active, true) = true;

  IF v_bom.id IS NULL THEN
    RAISE EXCEPTION 'bom_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(btrim(COALESCE(v_bom.base_uom_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'finished_item_uom_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(NULLIF(btrim(cs.base_currency_code), ''), 'MZN')
    INTO v_base_currency
  FROM public.company_settings cs
  WHERE cs.company_id = p_company_id;

  v_reference := public.next_production_run_reference(p_company_id);

  INSERT INTO public.production_runs (
    company_id,
    reference_no,
    bom_id,
    bom_name_snapshot,
    bom_version_snapshot,
    finished_item_id,
    output_uom_id,
    planned_output_qty,
    actual_output_qty,
    run_date,
    notes,
    base_currency_code,
    created_by,
    updated_by
  ) VALUES (
    p_company_id,
    v_reference,
    v_bom.id,
    v_bom.name,
    v_bom.version,
    v_bom.product_id,
    v_bom.base_uom_id,
    p_planned_output_qty,
    p_planned_output_qty,
    COALESCE(p_run_date, CURRENT_DATE),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    COALESCE(v_base_currency, 'MZN'),
    v_user,
    v_user
  )
  RETURNING id INTO v_run_id;

  INSERT INTO public.production_run_inputs (
    company_id,
    production_run_id,
    line_no,
    bom_component_id,
    item_id,
    uom_id,
    planned_qty,
    actual_qty
  )
  SELECT
    p_company_id,
    v_run_id,
    row_number() OVER (ORDER BY bc.created_at, bc.id)::integer,
    bc.id,
    bc.component_item_id,
    i.base_uom_id,
    round((bc.qty_per * p_planned_output_qty * (1 + COALESCE(bc.scrap_pct, 0)))::numeric, 12),
    round((bc.qty_per * p_planned_output_qty * (1 + COALESCE(bc.scrap_pct, 0)))::numeric, 12)
  FROM public.bom_components bc
  JOIN public.items i
    ON i.id = bc.component_item_id
   AND i.company_id = p_company_id
  WHERE bc.bom_id = v_bom.id
  ORDER BY bc.created_at, bc.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bom_has_no_components' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.production_run_outputs (
    company_id,
    production_run_id,
    line_no,
    is_primary,
    item_id,
    uom_id,
    actual_qty
  ) VALUES (
    p_company_id,
    v_run_id,
    1,
    true,
    v_bom.product_id,
    v_bom.base_uom_id,
    p_planned_output_qty
  );

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'reference_no', v_reference,
    'status', 'draft'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_production_run_draft(
  p_company_id uuid,
  p_run_id uuid,
  p_planned_output_qty numeric DEFAULT NULL,
  p_actual_output_qty numeric DEFAULT NULL,
  p_run_date date DEFAULT NULL,
  p_destination_warehouse_id uuid DEFAULT NULL,
  p_destination_bin_id text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_inputs jsonb DEFAULT NULL,
  p_extra_costs jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_run public.production_runs%ROWTYPE;
  v_entry jsonb;
  v_line_no integer;
  v_actual_qty numeric;
  v_source_warehouse_id uuid;
  v_source_bin_id text;
  v_category text;
  v_description text;
  v_amount numeric;
  v_ord bigint;
  v_new_planned numeric;
  v_new_actual numeric;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  SELECT *
    INTO v_run
  FROM public.production_runs
  WHERE id = p_run_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_run_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_run.status <> 'draft' THEN
    RAISE EXCEPTION 'production_run_not_draft' USING ERRCODE = 'P0001';
  END IF;

  v_new_planned := COALESCE(p_planned_output_qty, v_run.planned_output_qty);
  v_new_actual := COALESCE(p_actual_output_qty, v_run.actual_output_qty, v_new_planned);

  IF v_new_planned <= 0 OR v_new_actual <= 0 THEN
    RAISE EXCEPTION 'production_quantity_required' USING ERRCODE = '22023';
  END IF;

  IF p_destination_warehouse_id IS NOT NULL THEN
    PERFORM 1
    FROM public.warehouses w
    WHERE w.id = p_destination_warehouse_id
      AND w.company_id = p_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_destination_bin_id IS NOT NULL THEN
    PERFORM 1
    FROM public.bins b
    WHERE b.id = p_destination_bin_id
      AND b.company_id = p_company_id
      AND (p_destination_warehouse_id IS NULL OR b."warehouseId" = p_destination_warehouse_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.production_runs
     SET planned_output_qty = v_new_planned,
         actual_output_qty = v_new_actual,
         run_date = COALESCE(p_run_date, run_date),
         destination_warehouse_id = COALESCE(p_destination_warehouse_id, destination_warehouse_id),
         destination_bin_id = COALESCE(NULLIF(btrim(COALESCE(p_destination_bin_id, '')), ''), destination_bin_id),
         notes = CASE WHEN p_notes IS NULL THEN notes ELSE NULLIF(btrim(p_notes), '') END,
         updated_by = v_user
   WHERE id = p_run_id
     AND company_id = p_company_id;

  UPDATE public.production_run_outputs
     SET actual_qty = v_new_actual,
         destination_warehouse_id = COALESCE(p_destination_warehouse_id, destination_warehouse_id),
         destination_bin_id = COALESCE(NULLIF(btrim(COALESCE(p_destination_bin_id, '')), ''), destination_bin_id)
   WHERE production_run_id = p_run_id
     AND company_id = p_company_id
     AND is_primary = true;

  UPDATE public.production_run_inputs pri
     SET planned_qty = round((bc.qty_per * v_new_planned * (1 + COALESCE(bc.scrap_pct, 0)))::numeric, 12)
  FROM public.bom_components bc
  WHERE pri.production_run_id = p_run_id
    AND pri.company_id = p_company_id
    AND pri.bom_component_id = bc.id;

  IF p_inputs IS NOT NULL THEN
    FOR v_entry, v_ord IN
      SELECT value, ordinality
      FROM jsonb_array_elements(COALESCE(p_inputs, '[]'::jsonb)) WITH ORDINALITY
    LOOP
      v_line_no := COALESCE(NULLIF(v_entry ->> 'line_no', '')::integer, NULLIF(v_entry ->> 'lineNo', '')::integer, v_ord::integer);
      v_actual_qty := COALESCE(NULLIF(v_entry ->> 'actual_qty', '')::numeric, NULLIF(v_entry ->> 'actualQty', '')::numeric);
      v_source_warehouse_id := COALESCE(NULLIF(v_entry ->> 'source_warehouse_id', '')::uuid, NULLIF(v_entry ->> 'sourceWarehouseId', '')::uuid);
      v_source_bin_id := COALESCE(NULLIF(v_entry ->> 'source_bin_id', ''), NULLIF(v_entry ->> 'sourceBinId', ''));

      IF v_actual_qty IS NULL OR v_actual_qty <= 0 THEN
        RAISE EXCEPTION 'input_quantity_required' USING ERRCODE = '22023';
      END IF;

      IF v_source_warehouse_id IS NOT NULL THEN
        PERFORM 1
        FROM public.warehouses w
        WHERE w.id = v_source_warehouse_id
          AND w.company_id = p_company_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001';
        END IF;
      END IF;

      IF v_source_bin_id IS NOT NULL THEN
        PERFORM 1
        FROM public.bins b
        WHERE b.id = v_source_bin_id
          AND b.company_id = p_company_id
          AND (v_source_warehouse_id IS NULL OR b."warehouseId" = v_source_warehouse_id);
        IF NOT FOUND THEN
          RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001';
        END IF;
      END IF;

      UPDATE public.production_run_inputs
         SET actual_qty = v_actual_qty,
             source_warehouse_id = v_source_warehouse_id,
             source_bin_id = v_source_bin_id
       WHERE production_run_id = p_run_id
         AND company_id = p_company_id
         AND line_no = v_line_no;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'production_run_input_not_found' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  IF p_extra_costs IS NOT NULL THEN
    DELETE FROM public.production_run_extra_costs
    WHERE production_run_id = p_run_id
      AND company_id = p_company_id;

    FOR v_entry, v_ord IN
      SELECT value, ordinality
      FROM jsonb_array_elements(COALESCE(p_extra_costs, '[]'::jsonb)) WITH ORDINALITY
    LOOP
      v_category := lower(NULLIF(btrim(COALESCE(v_entry ->> 'category', '')), ''));
      v_description := NULLIF(btrim(COALESCE(v_entry ->> 'description', '')), '');
      v_amount := COALESCE(NULLIF(v_entry ->> 'amount_base', '')::numeric, NULLIF(v_entry ->> 'amountBase', '')::numeric, 0);

      IF v_category NOT IN ('labour', 'utilities', 'overhead', 'transport', 'other') THEN
        RAISE EXCEPTION 'invalid_extra_cost_category' USING ERRCODE = '22023';
      END IF;
      IF v_amount < 0 THEN
        RAISE EXCEPTION 'extra_cost_must_be_nonnegative' USING ERRCODE = '22023';
      END IF;
      IF v_category = 'other' AND v_description IS NULL THEN
        RAISE EXCEPTION 'extra_cost_description_required' USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.production_run_extra_costs(
        company_id,
        production_run_id,
        line_no,
        category,
        description,
        amount_base
      ) VALUES (
        p_company_id,
        p_run_id,
        v_ord::integer,
        v_category,
        v_description,
        v_amount
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'status', 'draft'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_production_run_draft(
  p_company_id uuid,
  p_run_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  UPDATE public.production_runs
     SET status = 'cancelled',
         updated_by = v_user
   WHERE id = p_run_id
     AND company_id = p_company_id
     AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_run_not_draft' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('run_id', p_run_id, 'status', 'cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_production_run(
  p_company_id uuid,
  p_run_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_run record;
  v_input record;
  v_available numeric;
  v_avg_cost numeric;
  v_shortage numeric;
  v_inputs jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_ready boolean := true;
  v_material_total numeric := 0;
  v_extra_total numeric := 0;
  v_total numeric := 0;
  v_unit_cost numeric := 0;
  v_advisory_minutes numeric;
BEGIN
  PERFORM public.stockwise_require_operator_company(p_company_id);

  SELECT
    pr.*,
    b.assembly_time_per_unit_minutes,
    b.setup_time_per_batch_minutes,
    i.name AS finished_item_name,
    i.base_uom_id AS finished_base_uom_id,
    b.name AS bom_name
    INTO v_run
  FROM public.production_runs pr
  JOIN public.boms b
    ON b.id = pr.bom_id
   AND b.company_id = pr.company_id
  JOIN public.items i
    ON i.id = pr.finished_item_id
   AND i.company_id = pr.company_id
  WHERE pr.id = p_run_id
    AND pr.company_id = p_company_id;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'production_run_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_run.output_uom_id IS DISTINCT FROM v_run.finished_base_uom_id THEN
    RAISE EXCEPTION 'production_run_output_uom_must_be_base_uom' USING ERRCODE = '22023';
  END IF;

  IF v_run.actual_output_qty IS NULL OR v_run.actual_output_qty <= 0 THEN
    v_ready := false;
    v_blockers := v_blockers || jsonb_build_array('actual_output_quantity_required');
  END IF;
  IF v_run.destination_warehouse_id IS NULL OR v_run.destination_bin_id IS NULL THEN
    v_ready := false;
    v_blockers := v_blockers || jsonb_build_array('destination_required');
  END IF;

  FOR v_input IN
    SELECT
      pri.*,
      i.name AS item_name,
      i.base_uom_id AS item_base_uom_id,
      w.name AS warehouse_name,
      b.code AS bin_code,
      b.name AS bin_name
    FROM public.production_run_inputs pri
    JOIN public.items i
      ON i.id = pri.item_id
     AND i.company_id = pri.company_id
    LEFT JOIN public.warehouses w
      ON w.id = pri.source_warehouse_id
     AND w.company_id = pri.company_id
    LEFT JOIN public.bins b
      ON b.id = pri.source_bin_id
     AND b.company_id = pri.company_id
    WHERE pri.production_run_id = p_run_id
      AND pri.company_id = p_company_id
    ORDER BY pri.line_no
  LOOP
    IF v_input.uom_id IS DISTINCT FROM v_input.item_base_uom_id THEN
      RAISE EXCEPTION 'production_run_input_uom_must_be_base_uom' USING ERRCODE = '22023';
    END IF;

    v_available := 0;
    v_avg_cost := 0;
    IF v_input.source_warehouse_id IS NOT NULL AND v_input.source_bin_id IS NOT NULL THEN
      SELECT COALESCE(sl.qty, 0), COALESCE(sl.avg_cost, 0)
        INTO v_available, v_avg_cost
      FROM public.stock_levels sl
      WHERE sl.company_id = p_company_id
        AND sl.item_id = v_input.item_id
        AND sl.warehouse_id = v_input.source_warehouse_id
        AND sl.bin_id = v_input.source_bin_id;
      v_available := COALESCE(v_available, 0);
      v_avg_cost := COALESCE(v_avg_cost, 0);
    ELSE
      v_ready := false;
      v_blockers := v_blockers || jsonb_build_array('input_source_required');
    END IF;

    IF COALESCE(v_input.actual_qty, 0) <= 0 THEN
      v_ready := false;
      v_blockers := v_blockers || jsonb_build_array('input_quantity_required');
    END IF;

    v_shortage := GREATEST(COALESCE(v_input.actual_qty, 0) - COALESCE(v_available, 0), 0);
    IF v_shortage > 0 THEN
      v_ready := false;
      v_blockers := v_blockers || jsonb_build_array('insufficient_stock');
    END IF;

    v_material_total := v_material_total + round((COALESCE(v_input.actual_qty, 0) * v_avg_cost)::numeric, 6);
    v_inputs := v_inputs || jsonb_build_array(jsonb_build_object(
      'id', v_input.id,
      'line_no', v_input.line_no,
      'item_id', v_input.item_id,
      'item_name', v_input.item_name,
      'uom_id', v_input.uom_id,
      'planned_qty', v_input.planned_qty,
      'actual_qty', v_input.actual_qty,
      'source_warehouse_id', v_input.source_warehouse_id,
      'source_bin_id', v_input.source_bin_id,
      'source_label', concat_ws(' / ', v_input.warehouse_name, concat_ws(' - ', v_input.bin_code, v_input.bin_name)),
      'available_qty', v_available,
      'shortage_qty', v_shortage,
      'preview_unit_cost', v_avg_cost,
      'preview_total_cost', round((COALESCE(v_input.actual_qty, 0) * v_avg_cost)::numeric, 6),
      'ready', v_shortage = 0 AND COALESCE(v_input.actual_qty, 0) > 0 AND v_input.source_warehouse_id IS NOT NULL AND v_input.source_bin_id IS NOT NULL
    ));
  END LOOP;

  SELECT COALESCE(sum(amount_base), 0)
    INTO v_extra_total
  FROM public.production_run_extra_costs
  WHERE production_run_id = p_run_id
    AND company_id = p_company_id;

  v_total := v_material_total + COALESCE(v_extra_total, 0);
  IF COALESCE(v_run.actual_output_qty, 0) > 0 THEN
    v_unit_cost := round((v_total / v_run.actual_output_qty)::numeric, 6);
  END IF;

  IF v_run.assembly_time_per_unit_minutes IS NOT NULL OR v_run.setup_time_per_batch_minutes IS NOT NULL THEN
    v_advisory_minutes := COALESCE(v_run.setup_time_per_batch_minutes, 0)
      + COALESCE(v_run.assembly_time_per_unit_minutes, 0) * COALESCE(v_run.actual_output_qty, v_run.planned_output_qty, 0);
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'reference_no', v_run.reference_no,
    'status', v_run.status,
    'bom_id', v_run.bom_id,
    'bom_name', v_run.bom_name,
    'finished_item_id', v_run.finished_item_id,
    'finished_item_name', v_run.finished_item_name,
    'planned_output_qty', v_run.planned_output_qty,
    'actual_output_qty', v_run.actual_output_qty,
    'run_date', v_run.run_date,
    'destination_warehouse_id', v_run.destination_warehouse_id,
    'destination_bin_id', v_run.destination_bin_id,
    'inputs', v_inputs,
    'extra_cost_total', COALESCE(v_extra_total, 0),
    'estimated_material_cost', v_material_total,
    'estimated_total_cost', v_total,
    'estimated_unit_cost', v_unit_cost,
    'yield_variance_qty', COALESCE(v_run.actual_output_qty, 0) - COALESCE(v_run.planned_output_qty, 0),
    'advisory_minutes', v_advisory_minutes,
    'ready', v_ready,
    'blocking_reasons', v_blockers
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_production_run(
  p_company_id uuid,
  p_run_id uuid,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_run public.production_runs%ROWTYPE;
  v_payload jsonb;
  v_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_input record;
  v_available numeric;
  v_unit_cost numeric;
  v_item_base_uom text;
  v_finished_base_uom text;
  v_issue_id uuid;
  v_output_id uuid;
  v_output_receipt_id uuid;
  v_material_total numeric := 0;
  v_extra_total numeric := 0;
  v_total numeric := 0;
  v_output_unit_cost numeric := 0;
  v_input_movements jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);
  IF v_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_run
  FROM public.production_runs
  WHERE id = p_run_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_run_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_payload := public.production_run_payload(p_company_id, p_run_id);
  v_hash := md5(v_payload::text);
  v_request := public.stockwise_claim_posting_request(p_company_id, 'production.run.post', v_request_key, v_hash);

  IF v_request.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_request.status = 'succeeded' THEN
    IF v_request.result_payload IS NULL THEN
      RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_request.result_payload;
  ELSIF v_request.status = 'in_progress' AND v_request.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  IF v_run.status <> 'draft' THEN
    RAISE EXCEPTION 'production_run_not_draft' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_run.actual_output_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'production_run_not_ready' USING ERRCODE = '22023';
  END IF;
  IF v_run.destination_warehouse_id IS NULL OR v_run.destination_bin_id IS NULL THEN
    RAISE EXCEPTION 'production_run_not_ready' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.boms b WHERE b.id = v_run.bom_id AND b.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bom_not_found' USING ERRCODE = 'P0001'; END IF;
  SELECT i.base_uom_id
    INTO v_finished_base_uom
  FROM public.items i
  WHERE i.id = v_run.finished_item_id
    AND i.company_id = p_company_id;
  IF v_finished_base_uom IS NULL THEN RAISE EXCEPTION 'finished_item_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_run.output_uom_id IS DISTINCT FROM v_finished_base_uom THEN
    RAISE EXCEPTION 'production_run_output_uom_must_be_base_uom' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.warehouses w WHERE w.id = v_run.destination_warehouse_id AND w.company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.bins b WHERE b.id = v_run.destination_bin_id AND b.company_id = p_company_id AND b."warehouseId" = v_run.destination_warehouse_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001'; END IF;

  FOR v_input IN
    SELECT pri.*
    FROM public.production_run_inputs pri
    WHERE pri.production_run_id = p_run_id
      AND pri.company_id = p_company_id
    ORDER BY pri.item_id, pri.source_warehouse_id, pri.source_bin_id, pri.line_no
  LOOP
    IF COALESCE(v_input.actual_qty, 0) <= 0 OR v_input.source_warehouse_id IS NULL OR v_input.source_bin_id IS NULL THEN
      RAISE EXCEPTION 'production_run_not_ready' USING ERRCODE = '22023';
    END IF;

    SELECT i.base_uom_id
      INTO v_item_base_uom
    FROM public.items i
    WHERE i.id = v_input.item_id
      AND i.company_id = p_company_id;
    IF v_item_base_uom IS NULL THEN RAISE EXCEPTION 'input_item_not_found' USING ERRCODE = 'P0001'; END IF;
    IF v_input.uom_id IS DISTINCT FROM v_item_base_uom THEN
      RAISE EXCEPTION 'production_run_input_uom_must_be_base_uom' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.warehouses w WHERE w.id = v_input.source_warehouse_id AND w.company_id = p_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001'; END IF;
    PERFORM 1 FROM public.bins b WHERE b.id = v_input.source_bin_id AND b.company_id = p_company_id AND b."warehouseId" = v_input.source_warehouse_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001'; END IF;

    SELECT COALESCE(sl.qty, 0), COALESCE(sl.avg_cost, 0)
      INTO v_available, v_unit_cost
    FROM public.stock_levels sl
    WHERE sl.company_id = p_company_id
      AND sl.item_id = v_input.item_id
      AND sl.warehouse_id = v_input.source_warehouse_id
      AND sl.bin_id = v_input.source_bin_id
    FOR UPDATE;

    v_available := COALESCE(v_available, 0);
    v_unit_cost := COALESCE(v_unit_cost, 0);
    IF v_available < v_input.actual_qty THEN
      RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.stock_movements (
      company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
      warehouse_from_id, bin_from_id, notes, created_by, ref_type, ref_id, ref_line_id
    ) VALUES (
      p_company_id, 'issue', v_input.item_id, v_input.uom_id, v_input.actual_qty, v_input.actual_qty,
      v_unit_cost, round((v_unit_cost * v_input.actual_qty)::numeric, 6),
      v_input.source_warehouse_id, v_input.source_bin_id,
      'Production run input ' || v_run.reference_no,
      v_user::text, 'PRODUCTION_RUN', p_run_id::text, v_input.id
    )
    RETURNING id INTO v_issue_id;

    UPDATE public.production_run_inputs
       SET frozen_unit_cost = v_unit_cost,
           frozen_total_cost = round((v_unit_cost * v_input.actual_qty)::numeric, 6),
           issue_movement_id = v_issue_id
     WHERE id = v_input.id;

    v_material_total := v_material_total + round((v_unit_cost * v_input.actual_qty)::numeric, 6);
    v_input_movements := v_input_movements || jsonb_build_array(jsonb_build_object(
      'input_id', v_input.id,
      'movement_id', v_issue_id,
      'line_no', v_input.line_no,
      'item_id', v_input.item_id,
      'qty', v_input.actual_qty,
      'unit_cost', v_unit_cost
    ));
  END LOOP;

  SELECT COALESCE(sum(amount_base), 0)
    INTO v_extra_total
  FROM public.production_run_extra_costs
  WHERE production_run_id = p_run_id
    AND company_id = p_company_id;

  v_total := round((v_material_total + COALESCE(v_extra_total, 0))::numeric, 6);
  v_output_unit_cost := round((v_total / v_run.actual_output_qty)::numeric, 6);

  SELECT id
    INTO v_output_id
  FROM public.production_run_outputs
  WHERE production_run_id = p_run_id
    AND company_id = p_company_id
    AND is_primary = true
  FOR UPDATE;

  IF v_output_id IS NULL THEN
    RAISE EXCEPTION 'production_output_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.stock_movements (
    company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_to_id, bin_to_id, notes, created_by, ref_type, ref_id, ref_line_id
  ) VALUES (
    p_company_id, 'receive', v_run.finished_item_id, v_run.output_uom_id, v_run.actual_output_qty, v_run.actual_output_qty,
    v_output_unit_cost, v_total,
    v_run.destination_warehouse_id, v_run.destination_bin_id,
    'Production run output ' || v_run.reference_no,
    v_user::text, 'PRODUCTION_RUN', p_run_id::text, v_output_id
  )
  RETURNING id INTO v_output_receipt_id;

  UPDATE public.production_run_outputs
     SET actual_qty = v_run.actual_output_qty,
         destination_warehouse_id = v_run.destination_warehouse_id,
         destination_bin_id = v_run.destination_bin_id,
         frozen_unit_cost = v_output_unit_cost,
         frozen_total_cost = v_total,
         receipt_movement_id = v_output_receipt_id
   WHERE id = v_output_id;

  UPDATE public.production_runs
     SET status = 'posted',
         material_cost_total = v_material_total,
         extra_cost_total = COALESCE(v_extra_total, 0),
         total_cost = v_total,
         output_unit_cost = v_output_unit_cost,
         output_receipt_movement_id = v_output_receipt_id,
         posted_by = v_user,
         posted_at = now(),
         updated_by = v_user
   WHERE id = p_run_id
     AND company_id = p_company_id;

  v_result := jsonb_build_object(
    'run_id', p_run_id,
    'reference_no', v_run.reference_no,
    'status', 'posted',
    'input_movements', v_input_movements,
    'output_movement_id', v_output_receipt_id,
    'material_cost_total', v_material_total,
    'extra_cost_total', COALESCE(v_extra_total, 0),
    'total_cost', v_total,
    'actual_output_qty', v_run.actual_output_qty,
    'output_unit_cost', v_output_unit_cost
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'PRODUCTION_RUN',
         result_ref_id = p_run_id::text,
         result_payload = v_result,
         updated_at = now()
   WHERE id = v_request.id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_production_run(
  p_company_id uuid,
  p_run_id uuid,
  p_reason text,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_run public.production_runs%ROWTYPE;
  v_payload jsonb;
  v_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_output public.production_run_outputs%ROWTYPE;
  v_output_available numeric;
  v_item_base_uom text;
  v_output_issue_id uuid;
  v_input record;
  v_receipt_id uuid;
  v_input_reversals jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_manager_company(p_company_id);
  IF v_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reversal_reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_run
  FROM public.production_runs
  WHERE id = p_run_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_run_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_payload := jsonb_build_object(
    'company_id', p_company_id,
    'run_id', p_run_id,
    'reason', v_reason,
    'posted_at', v_run.posted_at,
    'output_receipt_movement_id', v_run.output_receipt_movement_id
  );
  v_hash := md5(v_payload::text);
  v_request := public.stockwise_claim_posting_request(p_company_id, 'production.run.reverse', v_request_key, v_hash);

  IF v_request.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_request.status = 'succeeded' THEN
    IF v_request.result_payload IS NULL THEN
      RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_request.result_payload;
  ELSIF v_request.status = 'in_progress' AND v_request.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  IF v_run.status <> 'posted' THEN
    RAISE EXCEPTION 'production_run_not_posted' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_output
  FROM public.production_run_outputs
  WHERE production_run_id = p_run_id
    AND company_id = p_company_id
    AND is_primary = true
  FOR UPDATE;

  IF NOT FOUND OR v_output.receipt_movement_id IS NULL THEN
    RAISE EXCEPTION 'production_output_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT i.base_uom_id
    INTO v_item_base_uom
  FROM public.items i
  WHERE i.id = v_output.item_id
    AND i.company_id = p_company_id;
  IF v_item_base_uom IS NULL THEN RAISE EXCEPTION 'output_item_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_output.uom_id IS DISTINCT FROM v_item_base_uom THEN
    RAISE EXCEPTION 'production_run_output_uom_must_be_base_uom' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sl.qty, 0)
    INTO v_output_available
  FROM public.stock_levels sl
  WHERE sl.company_id = p_company_id
    AND sl.item_id = v_output.item_id
    AND sl.warehouse_id = v_output.destination_warehouse_id
    AND sl.bin_id = v_output.destination_bin_id
  FOR UPDATE;

  v_output_available := COALESCE(v_output_available, 0);
  IF v_output_available < v_output.actual_qty THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.stock_movements (
    company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_from_id, bin_from_id, notes, created_by, ref_type, ref_id, ref_line_id
  ) VALUES (
    p_company_id, 'issue', v_output.item_id, v_output.uom_id, v_output.actual_qty, v_output.actual_qty,
    COALESCE(v_output.frozen_unit_cost, 0), COALESCE(v_output.frozen_total_cost, 0),
    v_output.destination_warehouse_id, v_output.destination_bin_id,
    'Production run reversal output ' || v_run.reference_no || ': ' || v_reason,
    v_user::text, 'PRODUCTION_RUN_REVERSAL', p_run_id::text, v_output.id
  )
  RETURNING id INTO v_output_issue_id;

  UPDATE public.production_run_outputs
     SET reversal_issue_movement_id = v_output_issue_id
   WHERE id = v_output.id;

  FOR v_input IN
    SELECT *
    FROM public.production_run_inputs
    WHERE production_run_id = p_run_id
      AND company_id = p_company_id
    ORDER BY item_id, source_warehouse_id, source_bin_id, line_no
  LOOP
    IF v_input.issue_movement_id IS NULL THEN
      RAISE EXCEPTION 'production_input_movement_missing' USING ERRCODE = 'P0001';
    END IF;

    SELECT i.base_uom_id
      INTO v_item_base_uom
    FROM public.items i
    WHERE i.id = v_input.item_id
      AND i.company_id = p_company_id;
    IF v_item_base_uom IS NULL THEN RAISE EXCEPTION 'input_item_not_found' USING ERRCODE = 'P0001'; END IF;
    IF v_input.uom_id IS DISTINCT FROM v_item_base_uom THEN
      RAISE EXCEPTION 'production_run_input_uom_must_be_base_uom' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.stock_movements (
      company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
      warehouse_to_id, bin_to_id, notes, created_by, ref_type, ref_id, ref_line_id
    ) VALUES (
      p_company_id, 'receive', v_input.item_id, v_input.uom_id, v_input.actual_qty, v_input.actual_qty,
      COALESCE(v_input.frozen_unit_cost, 0), COALESCE(v_input.frozen_total_cost, 0),
      v_input.source_warehouse_id, v_input.source_bin_id,
      'Production run reversal input ' || v_run.reference_no || ': ' || v_reason,
      v_user::text, 'PRODUCTION_RUN_REVERSAL', p_run_id::text, v_input.id
    )
    RETURNING id INTO v_receipt_id;

    UPDATE public.production_run_inputs
       SET reversal_receipt_movement_id = v_receipt_id
     WHERE id = v_input.id;

    v_input_reversals := v_input_reversals || jsonb_build_array(jsonb_build_object(
      'input_id', v_input.id,
      'movement_id', v_receipt_id,
      'line_no', v_input.line_no,
      'item_id', v_input.item_id,
      'qty', v_input.actual_qty,
      'unit_cost', v_input.frozen_unit_cost
    ));
  END LOOP;

  UPDATE public.production_runs
     SET status = 'reversed',
         reversal_output_issue_movement_id = v_output_issue_id,
         reversal_reason = v_reason,
         reversed_by = v_user,
         reversed_at = now(),
         updated_by = v_user
   WHERE id = p_run_id
     AND company_id = p_company_id;

  v_result := jsonb_build_object(
    'run_id', p_run_id,
    'reference_no', v_run.reference_no,
    'status', 'reversed',
    'output_reversal_movement_id', v_output_issue_id,
    'input_reversal_movements', v_input_reversals,
    'reason', v_reason
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'PRODUCTION_RUN',
         result_ref_id = p_run_id::text,
         result_payload = v_result,
         updated_at = now()
   WHERE id = v_request.id;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.create_production_run_draft(uuid, uuid, numeric, date, text) OWNER TO postgres;
ALTER FUNCTION public.update_production_run_draft(uuid, uuid, numeric, numeric, date, uuid, text, text, jsonb, jsonb) OWNER TO postgres;
ALTER FUNCTION public.cancel_production_run_draft(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.preview_production_run(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.post_production_run(uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.reverse_production_run(uuid, uuid, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_production_run_draft(uuid, uuid, numeric, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_production_run_draft(uuid, uuid, numeric, numeric, date, uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_production_run_draft(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preview_production_run(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_production_run(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_production_run(uuid, uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_production_run_draft(uuid, uuid, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_production_run_draft(uuid, uuid, numeric, numeric, date, uuid, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_production_run_draft(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_production_run(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_production_run(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_production_run(uuid, uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.create_production_run_draft(uuid, uuid, numeric, date, text)
  IS 'Creates an auditable draft production run from an active BOM and seeds input/output lines.';
COMMENT ON FUNCTION public.update_production_run_draft(uuid, uuid, numeric, numeric, date, uuid, text, text, jsonb, jsonb)
  IS 'Updates draft production-run quantities, source/destination buckets, notes, and direct-cost snapshots.';
COMMENT ON FUNCTION public.preview_production_run(uuid, uuid)
  IS 'Returns non-mutating readiness and estimated cost preview for a production run.';
COMMENT ON FUNCTION public.post_production_run(uuid, uuid, text)
  IS 'Idempotently posts a draft production run into stock_movements using operation type production.run.post.';
COMMENT ON FUNCTION public.reverse_production_run(uuid, uuid, text, text)
  IS 'Idempotently reverses a posted production run with compensating stock movements using operation type production.run.reverse.';
