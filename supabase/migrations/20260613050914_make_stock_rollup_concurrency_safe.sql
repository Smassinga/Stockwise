-- A2.3: make the shared stock_levels rollup safe under concurrent
-- stock movement inserts without changing the public stock_movements contract,
-- valuation policy, POS pricing, finance posting or assembly idempotency.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        sl.warehouse_id,
        sl.item_id,
        sl.bin_id,
        count(*) AS bucket_count
      FROM public.stock_levels sl
      GROUP BY sl.warehouse_id, sl.item_id, sl.bin_id
      HAVING count(*) > 1
    ) duplicates
  ) THEN
    RAISE EXCEPTION 'stock_level_duplicate_bucket_preflight'
      USING ERRCODE = '23505',
            HINT = 'Clean duplicate stock_levels buckets before applying A2.3 concurrency-safe rollup.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.apply_stock_delta(
  p_wh_id uuid,
  p_bin_id text,
  p_item_id uuid,
  p_delta numeric,
  p_unit_cost numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_company_id uuid;
  v_item_company_id uuid;
  v_warehouse_company_id uuid;
  v_existing_qty numeric;
  v_unit_cost numeric := COALESCE(p_unit_cost, 0);
BEGIN
  IF COALESCE(p_delta, 0) = 0 THEN
    RETURN;
  END IF;

  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'Item is required for stock rollup' USING ERRCODE = '22023';
  END IF;

  IF p_wh_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required for stock rollup' USING ERRCODE = '22023';
  END IF;

  SELECT i.company_id
    INTO v_item_company_id
  FROM public.items i
  WHERE i.id = p_item_id;

  IF v_item_company_id IS NULL THEN
    RAISE EXCEPTION 'Item not found for stock rollup: %', p_item_id USING ERRCODE = '23503';
  END IF;

  SELECT w.company_id
    INTO v_warehouse_company_id
  FROM public.warehouses w
  WHERE w.id = p_wh_id;

  IF v_warehouse_company_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse not found for stock rollup: %', p_wh_id USING ERRCODE = '23503';
  END IF;

  IF v_item_company_id <> v_warehouse_company_id THEN
    RAISE EXCEPTION 'Item and warehouse company mismatch for stock rollup'
      USING ERRCODE = '42501';
  END IF;

  v_company_id := v_item_company_id;

  IF p_bin_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.bins b
      WHERE b.id = p_bin_id
        AND b."warehouseId" = p_wh_id
        AND (b.company_id IS NULL OR b.company_id = v_company_id)
    ) THEN
      RAISE EXCEPTION 'Bin % does not belong to warehouse %', p_bin_id, p_wh_id
        USING ERRCODE = '23503';
    END IF;
  END IF;

  IF p_delta < 0 THEN
    UPDATE public.stock_levels sl
       SET qty = sl.qty + p_delta,
           updated_at = now()
     WHERE sl.company_id = v_company_id
       AND sl.item_id = p_item_id
       AND sl.warehouse_id = p_wh_id
       AND sl.bin_id IS NOT DISTINCT FROM p_bin_id
       AND sl.qty + p_delta >= 0
     RETURNING sl.qty INTO v_existing_qty;

    IF NOT FOUND THEN
      SELECT sl.qty
        INTO v_existing_qty
      FROM public.stock_levels sl
      WHERE sl.company_id = v_company_id
        AND sl.item_id = p_item_id
        AND sl.warehouse_id = p_wh_id
        AND sl.bin_id IS NOT DISTINCT FROM p_bin_id
      LIMIT 1;

      IF FOUND THEN
        RAISE EXCEPTION 'Insufficient stock (would go negative) item %, wh %, bin %',
          p_item_id, p_wh_id, p_bin_id USING ERRCODE = 'P0001';
      END IF;

      RAISE EXCEPTION 'Insufficient stock (no row) item %, wh %, bin %',
        p_item_id, p_wh_id, p_bin_id USING ERRCODE = 'P0001';
    END IF;

    RETURN;
  END IF;

  IF p_bin_id IS NULL THEN
    INSERT INTO public.stock_levels (
      id,
      company_id,
      warehouse_id,
      bin_id,
      item_id,
      qty,
      allocated_qty,
      avg_cost,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_company_id,
      p_wh_id,
      NULL,
      p_item_id,
      p_delta,
      0,
      v_unit_cost,
      now()
    )
    ON CONFLICT (warehouse_id, item_id) WHERE bin_id IS NULL
    DO UPDATE
       SET qty = public.stock_levels.qty + EXCLUDED.qty,
           avg_cost = CASE
             WHEN public.stock_levels.qty + EXCLUDED.qty > 0 THEN
               (
                 (COALESCE(public.stock_levels.qty, 0) * COALESCE(public.stock_levels.avg_cost, 0))
                 + (EXCLUDED.qty * v_unit_cost)
               ) / (public.stock_levels.qty + EXCLUDED.qty)
             ELSE v_unit_cost
           END,
           updated_at = now();
  ELSE
    INSERT INTO public.stock_levels (
      id,
      company_id,
      warehouse_id,
      bin_id,
      item_id,
      qty,
      allocated_qty,
      avg_cost,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_company_id,
      p_wh_id,
      p_bin_id,
      p_item_id,
      p_delta,
      0,
      v_unit_cost,
      now()
    )
    ON CONFLICT (warehouse_id, item_id, bin_id) WHERE bin_id IS NOT NULL
    DO UPDATE
       SET qty = public.stock_levels.qty + EXCLUDED.qty,
           avg_cost = CASE
             WHEN public.stock_levels.qty + EXCLUDED.qty > 0 THEN
               (
                 (COALESCE(public.stock_levels.qty, 0) * COALESCE(public.stock_levels.avg_cost, 0))
                 + (EXCLUDED.qty * v_unit_cost)
               ) / (public.stock_levels.qty + EXCLUDED.qty)
             ELSE v_unit_cost
           END,
           updated_at = now();
  END IF;
END;
$$;

ALTER FUNCTION public.apply_stock_delta(uuid, text, uuid, numeric, numeric) OWNER TO postgres;

COMMENT ON FUNCTION public.apply_stock_delta(uuid, text, uuid, numeric, numeric)
IS 'A2.3 concurrency-safe stock rollup helper. Negative deltas use an atomic guarded update; positive deltas use nullable-bin aware upserts. Valuation policy remains weighted-average as before.';
