-- Regression unblocker: opening-stock import must accept canonical text UOM IDs
-- such as uom_ea/uom_box. The canonical schema stores public.uoms.id and
-- public.stock_movements.uom_id as text, so this RPC must not cast UOM IDs
-- to uuid while staging import rows.

CREATE OR REPLACE FUNCTION public.import_opening_stock_batch(
  p_company_id uuid,
  p_rows jsonb DEFAULT '[]'::jsonb
) RETURNS TABLE(imported_rows integer, bucket_count integer, total_qty_base numeric)
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_active_company uuid := public.active_company_id();
  v_member_role public.member_role;
  v_invalid record;
  v_row record;
  v_updated_bucket_count integer := 0;
  v_inserted_bucket_count integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Select a company before importing opening stock.' USING ERRCODE = 'P0001';
  END IF;

  IF v_active_company IS NULL OR v_active_company <> p_company_id THEN
    RAISE EXCEPTION 'Switch into the target company before importing opening stock.' USING ERRCODE = '42501';
  END IF;

  SELECT cm.role
    INTO v_member_role
  FROM public.company_members cm
  WHERE cm.company_id = p_company_id
    AND cm.user_id = v_user
    AND cm.status = 'active'::public.member_status
  LIMIT 1;

  IF v_member_role IS NULL THEN
    RAISE EXCEPTION 'You do not have access to import opening stock in this company.' USING ERRCODE = '42501';
  END IF;

  IF v_member_role NOT IN (
    'OWNER'::public.member_role,
    'ADMIN'::public.member_role,
    'MANAGER'::public.member_role,
    'OPERATOR'::public.member_role
  ) THEN
    RAISE EXCEPTION 'Only operators and above can import opening stock.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Add at least one opening-stock row before importing.' USING ERRCODE = 'P0001';
  END IF;

  CREATE TEMPORARY TABLE tmp_opening_stock_rows_raw (
    row_no integer NOT NULL,
    item_id_text text,
    uom_id_text text,
    qty numeric,
    qty_base numeric,
    unit_cost numeric,
    total_value numeric,
    warehouse_to_id_text text,
    bin_to_id text,
    notes text
  ) ON COMMIT DROP;

  INSERT INTO tmp_opening_stock_rows_raw (
    row_no,
    item_id_text,
    uom_id_text,
    qty,
    qty_base,
    unit_cost,
    total_value,
    warehouse_to_id_text,
    bin_to_id,
    notes
  )
  SELECT
    ordinality::integer,
    NULLIF(trim(row_data ->> 'item_id'), ''),
    NULLIF(trim(row_data ->> 'uom_id'), ''),
    COALESCE(NULLIF(trim(row_data ->> 'qty'), '')::numeric, 0),
    COALESCE(NULLIF(trim(row_data ->> 'qty_base'), '')::numeric, 0),
    greatest(COALESCE(NULLIF(trim(row_data ->> 'unit_cost'), '')::numeric, 0), 0),
    greatest(COALESCE(NULLIF(trim(row_data ->> 'total_value'), '')::numeric, 0), 0),
    NULLIF(trim(row_data ->> 'warehouse_to_id'), ''),
    NULLIF(trim(row_data ->> 'bin_to_id'), ''),
    NULLIF(trim(row_data ->> 'notes'), '')
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) WITH ORDINALITY AS rows(row_data, ordinality);

  SELECT *
    INTO v_invalid
  FROM tmp_opening_stock_rows_raw r
  WHERE r.item_id_text IS NULL
     OR r.uom_id_text IS NULL
     OR r.warehouse_to_id_text IS NULL
     OR r.bin_to_id IS NULL
     OR COALESCE(r.qty, 0) <= 0
     OR COALESCE(r.qty_base, 0) <= 0
  ORDER BY r.row_no
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Opening-stock row % is incomplete. Recheck the imported item, UOM, location, and quantity.', v_invalid.row_no
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.row_no, r.item_id_text
    INTO v_invalid
  FROM tmp_opening_stock_rows_raw r
  LEFT JOIN public.items i
    ON i.id::text = r.item_id_text
   AND i.company_id = p_company_id
  WHERE i.id IS NULL
  ORDER BY r.row_no
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Opening-stock row % references an item that does not belong to this company.', v_invalid.row_no
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.row_no, r.uom_id_text
    INTO v_invalid
  FROM tmp_opening_stock_rows_raw r
  LEFT JOIN public.uoms u
    ON u.id::text = r.uom_id_text
  WHERE u.id IS NULL
  ORDER BY r.row_no
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Opening-stock row % references a unit of measure that does not exist.', v_invalid.row_no
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.row_no, r.warehouse_to_id_text
    INTO v_invalid
  FROM tmp_opening_stock_rows_raw r
  LEFT JOIN public.warehouses w
    ON w.id::text = r.warehouse_to_id_text
   AND w.company_id = p_company_id
  WHERE w.id IS NULL
  ORDER BY r.row_no
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Opening-stock row % references a warehouse that does not belong to this company.', v_invalid.row_no
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.row_no, r.bin_to_id
    INTO v_invalid
  FROM tmp_opening_stock_rows_raw r
  LEFT JOIN public.bins b
    ON b.id::text = r.bin_to_id
   AND b.company_id = p_company_id
   AND b."warehouseId"::text = r.warehouse_to_id_text
  WHERE b.id IS NULL
  ORDER BY r.row_no
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Opening-stock row % references a bin that does not belong to the selected warehouse.', v_invalid.row_no
      USING ERRCODE = 'P0001';
  END IF;

  CREATE TEMPORARY TABLE tmp_opening_stock_rows (
    row_no integer NOT NULL,
    item_id uuid NOT NULL,
    uom_id text NOT NULL,
    qty numeric NOT NULL,
    qty_base numeric NOT NULL,
    unit_cost numeric NOT NULL,
    total_value numeric NOT NULL,
    warehouse_to_id uuid NOT NULL,
    bin_to_id text NOT NULL,
    notes text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_opening_stock_rows (
    row_no,
    item_id,
    uom_id,
    qty,
    qty_base,
    unit_cost,
    total_value,
    warehouse_to_id,
    bin_to_id,
    notes
  )
  SELECT
    r.row_no,
    r.item_id_text::uuid,
    r.uom_id_text,
    r.qty,
    r.qty_base,
    r.unit_cost,
    CASE
      WHEN r.total_value > 0 THEN r.total_value
      ELSE round(r.qty_base * r.unit_cost, 2)
    END,
    r.warehouse_to_id_text::uuid,
    r.bin_to_id,
    COALESCE(r.notes, 'Stock inicial')
  FROM tmp_opening_stock_rows_raw r;

  CREATE TEMPORARY TABLE tmp_opening_stock_baseline (
    item_id uuid NOT NULL,
    warehouse_key text NOT NULL,
    bin_key text NOT NULL,
    qty numeric NOT NULL,
    avg_cost numeric NOT NULL,
    allocated_qty numeric NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_opening_stock_baseline (
    item_id,
    warehouse_key,
    bin_key,
    qty,
    avg_cost,
    allocated_qty
  )
  SELECT
    buckets.item_id,
    buckets.warehouse_to_id::text,
    buckets.bin_to_id,
    COALESCE(sl.qty, 0),
    COALESCE(sl.avg_cost, 0),
    COALESCE(sl.allocated_qty, 0)
  FROM (
    SELECT DISTINCT
      r.item_id,
      r.warehouse_to_id,
      r.bin_to_id
    FROM tmp_opening_stock_rows r
  ) buckets
  LEFT JOIN public.stock_levels sl
    ON sl.company_id = p_company_id
   AND sl.item_id = buckets.item_id
   AND sl.warehouse_id::text = buckets.warehouse_to_id::text
   AND sl.bin_id::text = buckets.bin_to_id;

  imported_rows := 0;

  FOR v_row IN
    SELECT *
    FROM tmp_opening_stock_rows
    ORDER BY row_no
  LOOP
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
    )
    VALUES (
      p_company_id,
      'receive',
      v_row.item_id,
      v_row.uom_id,
      v_row.qty,
      v_row.qty_base,
      v_row.unit_cost,
      v_row.total_value,
      v_row.warehouse_to_id,
      v_row.bin_to_id,
      v_row.notes,
      v_user,
      'ADJUST',
      NULL,
      NULL
    );

    imported_rows := imported_rows + 1;
  END LOOP;

  CREATE TEMPORARY TABLE tmp_opening_stock_final_levels (
    item_id uuid NOT NULL,
    warehouse_to_id uuid NOT NULL,
    bin_to_id text NOT NULL,
    final_qty numeric NOT NULL,
    final_avg_cost numeric NOT NULL,
    allocated_qty numeric NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_opening_stock_final_levels (
    item_id,
    warehouse_to_id,
    bin_to_id,
    final_qty,
    final_avg_cost,
    allocated_qty
  )
  SELECT
    r.item_id,
    r.warehouse_to_id,
    r.bin_to_id,
    round(COALESCE(b.qty, 0) + sum(r.qty_base), 6),
    CASE
      WHEN COALESCE(b.qty, 0) + sum(r.qty_base) > 0 THEN
        round(
          ((COALESCE(b.qty, 0) * COALESCE(b.avg_cost, 0)) + sum(r.total_value))
          / (COALESCE(b.qty, 0) + sum(r.qty_base)),
          6
        )
      ELSE 0
    END,
    COALESCE(b.allocated_qty, 0)
  FROM tmp_opening_stock_rows r
  LEFT JOIN tmp_opening_stock_baseline b
    ON b.item_id = r.item_id
   AND b.warehouse_key = r.warehouse_to_id::text
   AND b.bin_key = r.bin_to_id
  GROUP BY
    r.item_id,
    r.warehouse_to_id,
    r.bin_to_id,
    b.qty,
    b.avg_cost,
    b.allocated_qty;

  UPDATE public.stock_levels sl
     SET qty = f.final_qty,
         avg_cost = f.final_avg_cost,
         allocated_qty = f.allocated_qty,
         updated_at = now()
  FROM tmp_opening_stock_final_levels f
  WHERE sl.company_id = p_company_id
    AND sl.item_id = f.item_id
    AND sl.warehouse_id::text = f.warehouse_to_id::text
    AND sl.bin_id::text = f.bin_to_id;

  GET DIAGNOSTICS v_updated_bucket_count = ROW_COUNT;

  INSERT INTO public.stock_levels (
    company_id,
    item_id,
    warehouse_id,
    bin_id,
    qty,
    avg_cost,
    allocated_qty
  )
  SELECT
    p_company_id,
    f.item_id,
    f.warehouse_to_id,
    f.bin_to_id,
    f.final_qty,
    f.final_avg_cost,
    f.allocated_qty
  FROM tmp_opening_stock_final_levels f
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.stock_levels sl
    WHERE sl.company_id = p_company_id
      AND sl.item_id = f.item_id
      AND sl.warehouse_id::text = f.warehouse_to_id::text
      AND sl.bin_id::text = f.bin_to_id
  );

  GET DIAGNOSTICS v_inserted_bucket_count = ROW_COUNT;
  bucket_count := v_updated_bucket_count + v_inserted_bucket_count;

  SELECT round(COALESCE(sum(r.qty_base), 0), 6)
    INTO total_qty_base
  FROM tmp_opening_stock_rows r;

  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.import_opening_stock_batch(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.import_opening_stock_batch(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_opening_stock_batch(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_opening_stock_batch(uuid, jsonb) TO service_role;
