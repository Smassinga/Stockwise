-- Phase A1: harden existing Assembly/BOM posting RPC authority, company scope,
-- and movement audit linkage. This intentionally does not add idempotency,
-- production runs, growth batches, finance posting, or valuation-policy changes.

CREATE OR REPLACE FUNCTION public.build_from_bom(
  p_bom_id uuid,
  p_qty numeric,
  p_warehouse_from uuid,
  p_bin_from text,
  p_warehouse_to uuid,
  p_bin_to text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_active_company_id uuid := public.current_company_id();
  v_company_id uuid;
  v_product_id uuid;
  v_build_id uuid := gen_random_uuid();
  v_total_cost numeric := 0;
  v_need numeric;
  v_unit_cost numeric;
  v_component_count integer := 0;
  r record;
BEGIN
  IF v_active_company_id IS NULL THEN
    RAISE EXCEPTION 'No active company selected' USING ERRCODE = '42501';
  END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be > 0' USING ERRCODE = '22023';
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = p_warehouse_from
      AND w.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Source warehouse does not belong to the active company' USING ERRCODE = '42501';
  END IF;

  IF p_bin_from IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.bins b
    WHERE b.id = p_bin_from
      AND b."warehouseId" = p_warehouse_from
      AND (b.company_id IS NULL OR b.company_id = v_company_id)
  ) THEN
    RAISE EXCEPTION 'Source bin does not belong to the source warehouse' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = p_warehouse_to
      AND w.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Destination warehouse does not belong to the active company' USING ERRCODE = '42501';
  END IF;

  IF p_bin_to IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.bins b
    WHERE b.id = p_bin_to
      AND b."warehouseId" = p_warehouse_to
      AND (b.company_id IS NULL OR b.company_id = v_company_id)
  ) THEN
    RAISE EXCEPTION 'Destination bin does not belong to the destination warehouse' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.builds(
    id, company_id, bom_id, product_id, qty,
    warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id,
    cost_total, created_by
  ) VALUES (
    v_build_id, v_company_id, p_bom_id, v_product_id, p_qty,
    p_warehouse_from, p_bin_from, p_warehouse_to, p_bin_to,
    0, auth.uid()
  );

  FOR r IN
    SELECT c.component_item_id,
           c.qty_per,
           COALESCE(c.scrap_pct, 0) AS scrap,
           i.company_id AS component_company_id
    FROM public.bom_components c
    LEFT JOIN public.items i ON i.id = c.component_item_id
    WHERE c.bom_id = p_bom_id
    ORDER BY c.created_at, c.id
  LOOP
    v_component_count := v_component_count + 1;

    IF r.component_company_id IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'Component item does not belong to the active company' USING ERRCODE = '42501';
    END IF;

    v_need := COALESCE(r.qty_per, 0) * p_qty * (1 + COALESCE(r.scrap, 0));
    IF v_need <= 0 THEN
      RAISE EXCEPTION 'Component required quantity must be > 0' USING ERRCODE = '22023';
    END IF;

    SELECT sl.avg_cost
      INTO v_unit_cost
    FROM public.stock_levels sl
    WHERE sl.company_id = v_company_id
      AND sl.item_id = r.component_item_id
      AND sl.warehouse_id = p_warehouse_from
      AND (
        (p_bin_from IS NULL AND sl.bin_id IS NULL)
        OR sl.bin_id = p_bin_from
      )
    LIMIT 1;

    v_unit_cost := COALESCE(v_unit_cost, 0);
    v_total_cost := v_total_cost + (v_need * v_unit_cost);

    INSERT INTO public.stock_movements(
      company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
      warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id,
      notes, ref_type, ref_id, created_by
    ) VALUES (
      v_company_id, 'issue', r.component_item_id, NULL,
      v_need, v_need, v_unit_cost, v_need * v_unit_cost,
      p_warehouse_from, p_bin_from, NULL, NULL,
      'Production consumption', 'BUILD', v_build_id::text, auth.uid()::text
    );
  END LOOP;

  IF v_component_count = 0 THEN
    RAISE EXCEPTION 'BOM has no components' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stock_movements(
    company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id,
    notes, ref_type, ref_id, created_by
  ) VALUES (
    v_company_id, 'receive', v_product_id, NULL,
    p_qty, p_qty,
    CASE WHEN p_qty > 0 THEN v_total_cost / p_qty ELSE 0 END,
    v_total_cost,
    NULL, NULL, p_warehouse_to, p_bin_to,
    'Production output', 'BUILD', v_build_id::text, auth.uid()::text
  );

  UPDATE public.builds
     SET cost_total = v_total_cost
   WHERE id = v_build_id
     AND company_id = v_company_id;

  RETURN v_build_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.build_from_bom_sources(
  p_bom_id uuid,
  p_qty numeric,
  p_component_sources jsonb,
  p_output_splits jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_active_company_id uuid := public.current_company_id();
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
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_issue_component(
  p_item_id uuid,
  p_qty_base numeric,
  p_warehouse_id uuid,
  p_bin_id text,
  p_note text DEFAULT 'BOM issue'
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_company_id uuid;
  v_active_company_id uuid := public.current_company_id();
  v_base_uom_id text;
  v_onhand numeric := 0;
  v_avg_cost numeric := 0;
  v_total_value numeric := 0;
BEGIN
  IF p_qty_base IS NULL OR p_qty_base <= 0 THEN
    RAISE EXCEPTION 'Quantity must be > 0' USING ERRCODE = '22023';
  END IF;

  SELECT i.company_id, i.base_uom_id
    INTO v_company_id, v_base_uom_id
  FROM public.items i
  WHERE i.id = p_item_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Item not found' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF v_active_company_id IS NULL OR v_active_company_id <> v_company_id THEN
      RAISE EXCEPTION 'Item does not belong to the active company' USING ERRCODE = '42501';
    END IF;

    IF NOT public.has_company_role(
      v_company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::public.member_role[]
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Warehouse does not belong to the item company' USING ERRCODE = '42501';
  END IF;

  IF p_bin_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.bins b
    WHERE b.id = p_bin_id
      AND b."warehouseId" = p_warehouse_id
      AND (b.company_id IS NULL OR b.company_id = v_company_id)
  ) THEN
    RAISE EXCEPTION 'Bin does not belong to the warehouse' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(sl.qty, 0), COALESCE(sl.avg_cost, 0)
    INTO v_onhand, v_avg_cost
  FROM public.stock_levels sl
  WHERE sl.company_id = v_company_id
    AND sl.item_id = p_item_id
    AND sl.warehouse_id = p_warehouse_id
    AND (
      (p_bin_id IS NULL AND sl.bin_id IS NULL)
      OR sl.bin_id = p_bin_id
    )
  LIMIT 1;

  v_onhand := COALESCE(v_onhand, 0);
  v_avg_cost := COALESCE(v_avg_cost, 0);

  IF v_onhand + 0.000001 < p_qty_base THEN
    RAISE EXCEPTION 'Insufficient stock (need %, onhand %): item %, wh %, bin %',
      p_qty_base, v_onhand, p_item_id, p_warehouse_id, p_bin_id USING ERRCODE = 'P0001';
  END IF;

  v_total_value := v_avg_cost * p_qty_base;

  INSERT INTO public.stock_movements (
    company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_from_id, bin_from_id, notes, created_by,
    ref_type, ref_id, ref_line_id
  ) VALUES (
    v_company_id, 'issue', p_item_id, v_base_uom_id,
    p_qty_base, p_qty_base,
    v_avg_cost, v_total_value,
    p_warehouse_id, p_bin_id,
    COALESCE(p_note, 'BOM issue'),
    COALESCE(auth.uid()::text, 'system'),
    'INTERNAL_USE', NULL, NULL
  );

  RETURN v_total_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_receive_finished(
  p_item_id uuid,
  p_qty_base numeric,
  p_warehouse_id uuid,
  p_bin_id text,
  p_note text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  PERFORM public.inv_receive_finished(p_item_id, p_qty_base, p_warehouse_id, p_bin_id, p_note, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_receive_finished(
  p_item_id uuid,
  p_qty_base numeric,
  p_warehouse_id uuid,
  p_bin_id text,
  p_note text DEFAULT 'BOM receive',
  p_unit_cost numeric DEFAULT 0
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_company_id uuid;
  v_active_company_id uuid := public.current_company_id();
  v_base_uom_id text;
  v_total_value numeric;
BEGIN
  IF p_qty_base IS NULL OR p_qty_base <= 0 THEN
    RAISE EXCEPTION 'Quantity must be > 0' USING ERRCODE = '22023';
  END IF;

  SELECT i.company_id, i.base_uom_id
    INTO v_company_id, v_base_uom_id
  FROM public.items i
  WHERE i.id = p_item_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Item not found' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF v_active_company_id IS NULL OR v_active_company_id <> v_company_id THEN
      RAISE EXCEPTION 'Item does not belong to the active company' USING ERRCODE = '42501';
    END IF;

    IF NOT public.has_company_role(
      v_company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::public.member_role[]
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Warehouse does not belong to the item company' USING ERRCODE = '42501';
  END IF;

  IF p_bin_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.bins b
    WHERE b.id = p_bin_id
      AND b."warehouseId" = p_warehouse_id
      AND (b.company_id IS NULL OR b.company_id = v_company_id)
  ) THEN
    RAISE EXCEPTION 'Bin does not belong to the warehouse' USING ERRCODE = '42501';
  END IF;

  v_total_value := COALESCE(p_unit_cost, 0) * p_qty_base;

  INSERT INTO public.stock_movements (
    company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_to_id, bin_to_id, notes, created_by,
    ref_type, ref_id, ref_line_id
  ) VALUES (
    v_company_id, 'receive', p_item_id, v_base_uom_id,
    p_qty_base, p_qty_base,
    COALESCE(p_unit_cost, 0), v_total_value,
    p_warehouse_id, p_bin_id,
    COALESCE(p_note, 'BOM receive'),
    COALESCE(auth.uid()::text, 'system'),
    'ADJUST', NULL, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.build_from_bom(uuid, numeric, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_from_bom(uuid, numeric, uuid, text, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.build_from_bom_sources(uuid, numeric, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_from_bom_sources(uuid, numeric, jsonb, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.inv_issue_component(uuid, numeric, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inv_receive_finished(uuid, numeric, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inv_receive_finished(uuid, numeric, uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
