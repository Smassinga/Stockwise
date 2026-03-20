BEGIN;

CREATE OR REPLACE FUNCTION public.apply_landed_cost_run(
  p_company_id uuid,
  p_purchase_order_id uuid,
  p_supplier_id uuid,
  p_applied_by uuid,
  p_currency_code text,
  p_fx_to_base numeric,
  p_allocation_method text,
  p_total_extra_cost numeric,
  p_notes text,
  p_charges jsonb,
  p_lines jsonb
)
RETURNS TABLE (
  run_id uuid,
  line_count integer,
  total_applied_value numeric,
  total_unapplied_value numeric
)
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_run_id uuid;
  v_bucket record;
  v_charge jsonb;
  v_po record;
  v_charge_amount numeric;
  v_charge_label text;
  v_line_count integer := 0;
  v_total_applied numeric := 0;
  v_total_unapplied numeric := 0;
  v_total_extra_cost numeric := 0;
  v_total_extra_cost_base numeric := 0;
  v_total_receipt_qty numeric := 0;
  v_total_receipt_value numeric := 0;
  v_allocated_so_far numeric := 0;
  v_bucket_count integer := 0;
  v_allocated_extra numeric := 0;
  v_delta_per_received_unit numeric := 0;
  v_impacted_qty numeric := 0;
  v_applied numeric := 0;
  v_unapplied numeric := 0;
  v_new_avg_cost numeric := 0;
  v_stock_movement_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_fx_to_base numeric := 1;
  v_normalized_charges jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_company_id IS NULL OR p_purchase_order_id IS NULL THEN
    RAISE EXCEPTION 'company_id_required';
  END IF;

  IF p_company_id <> current_company_id() THEN
    RAISE EXCEPTION 'company_scope_mismatch';
  END IF;

  IF NOT has_company_role(
    p_company_id,
    ARRAY['OWNER'::member_role, 'ADMIN'::member_role, 'MANAGER'::member_role, 'OPERATOR'::member_role]
  ) THEN
    RAISE EXCEPTION 'insufficient_company_role';
  END IF;

  IF p_allocation_method NOT IN ('quantity', 'value', 'equal') THEN
    RAISE EXCEPTION 'invalid_allocation_method';
  END IF;

  SELECT
    po.id,
    po.company_id,
    po.supplier_id,
    COALESCE(NULLIF(trim(po.currency_code), ''), COALESCE(NULLIF(trim(p_currency_code), ''), 'USD')) AS currency_code,
    COALESCE(NULLIF(po.fx_to_base, 0), NULLIF(p_fx_to_base, 0), 1) AS fx_to_base
  INTO v_po
  FROM public.purchase_orders po
  WHERE po.id = p_purchase_order_id
    AND po.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_order_not_found';
  END IF;

  v_fx_to_base := COALESCE(v_po.fx_to_base, 1);
  IF v_fx_to_base <= 0 THEN
    RAISE EXCEPTION 'invalid_fx_to_base';
  END IF;

  FOR v_charge IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_charges, '[]'::jsonb))
  LOOP
    v_charge_amount := round(
      CASE
        WHEN NULLIF(trim(v_charge->>'amount'), '') IS NULL THEN 0
        ELSE (v_charge->>'amount')::numeric
      END,
      6
    );

    IF v_charge_amount = 0 THEN
      CONTINUE;
    END IF;

    v_charge_label := COALESCE(NULLIF(trim(v_charge->>'label'), ''), 'Other cost');
    v_total_extra_cost := round(v_total_extra_cost + v_charge_amount, 6);
    v_total_extra_cost_base := round(v_total_extra_cost_base + round(v_charge_amount * v_fx_to_base, 6), 6);
    v_normalized_charges := v_normalized_charges || jsonb_build_array(
      jsonb_build_object(
        'label', v_charge_label,
        'amount', v_charge_amount,
        'amount_base', round(v_charge_amount * v_fx_to_base, 6)
      )
    );
  END LOOP;

  IF v_total_extra_cost_base <= 0 THEN
    RAISE EXCEPTION 'total_extra_cost_required';
  END IF;

  -- Retain p_lines for API compatibility, but rebuild persisted valuation math from trusted receipt and stock data.
  CREATE TEMP TABLE landed_cost_receipt_buckets (
    bucket_ordinal integer NOT NULL,
    item_id uuid NOT NULL,
    item_label text NULL,
    po_line_id uuid NULL,
    warehouse_id uuid NULL,
    bin_id text NULL,
    stock_level_id uuid NULL,
    received_qty_base numeric NOT NULL,
    receipt_value_base numeric NOT NULL,
    on_hand_qty_base numeric NOT NULL,
    previous_avg_cost numeric NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO landed_cost_receipt_buckets (
    bucket_ordinal,
    item_id,
    item_label,
    po_line_id,
    warehouse_id,
    bin_id,
    stock_level_id,
    received_qty_base,
    receipt_value_base,
    on_hand_qty_base,
    previous_avg_cost
  )
  WITH receipt_buckets AS (
    SELECT
      sm.item_id,
      min(NULLIF(sm.ref_line_id::text, '')) AS po_line_id_text,
      sm.warehouse_to_id AS warehouse_id,
      sm.bin_to_id AS bin_id,
      round(sum(COALESCE(sm.qty_base, 0)), 6) AS received_qty_base,
      round(sum(COALESCE(sm.total_value, 0)), 6) AS receipt_value_base
    FROM public.stock_movements sm
    WHERE sm.company_id = p_company_id
      AND sm.type = 'receive'
      AND sm.ref_type = 'PO'
      AND sm.ref_id = p_purchase_order_id::text
    GROUP BY
      sm.item_id,
      sm.warehouse_to_id,
      sm.bin_to_id
  ),
  bucket_rows AS (
    SELECT
      row_number() OVER (
        ORDER BY
          COALESCE(i.name, rb.item_id::text),
          rb.item_id,
          COALESCE(rb.warehouse_id::text, ''),
          COALESCE(rb.bin_id, '')
      )::integer AS bucket_ordinal,
      rb.item_id,
      trim(
        COALESCE(i.name, rb.item_id::text)
        || CASE
             WHEN NULLIF(i.sku, '') IS NOT NULL THEN ' (' || i.sku || ')'
             ELSE ''
           END
      ) AS item_label,
      CASE
        WHEN rb.po_line_id_text IS NULL THEN NULL
        ELSE rb.po_line_id_text::uuid
      END AS po_line_id,
      rb.warehouse_id,
      rb.bin_id,
      sl.id AS stock_level_id,
      rb.received_qty_base,
      rb.receipt_value_base,
      round(COALESCE(sl.qty, 0), 6) AS on_hand_qty_base,
      round(COALESCE(sl.avg_cost, 0), 6) AS previous_avg_cost
    FROM receipt_buckets rb
    JOIN public.items i
      ON i.id = rb.item_id
     AND i.company_id = p_company_id
    LEFT JOIN public.stock_levels sl
      ON sl.company_id = p_company_id
     AND sl.item_id = rb.item_id
     AND sl.warehouse_id IS NOT DISTINCT FROM rb.warehouse_id
     AND sl.bin_id IS NOT DISTINCT FROM rb.bin_id
    WHERE rb.received_qty_base > 0
  )
  SELECT
    bucket_ordinal,
    item_id,
    item_label,
    po_line_id,
    warehouse_id,
    bin_id,
    stock_level_id,
    received_qty_base,
    receipt_value_base,
    on_hand_qty_base,
    previous_avg_cost
  FROM bucket_rows;

  SELECT
    count(*),
    COALESCE(sum(received_qty_base), 0),
    COALESCE(sum(receipt_value_base), 0)
  INTO
    v_bucket_count,
    v_total_receipt_qty,
    v_total_receipt_value
  FROM landed_cost_receipt_buckets;

  IF v_bucket_count = 0 THEN
    RAISE EXCEPTION 'no_receipts_found_for_purchase_order';
  END IF;

  INSERT INTO public.landed_cost_runs (
    company_id,
    purchase_order_id,
    supplier_id,
    applied_by,
    currency_code,
    fx_to_base,
    allocation_method,
    total_extra_cost,
    total_applied_value,
    total_unapplied_value,
    notes,
    charges
  ) VALUES (
    p_company_id,
    p_purchase_order_id,
    v_po.supplier_id,
    COALESCE(auth.uid(), p_applied_by),
    upper(v_po.currency_code),
    v_fx_to_base,
    p_allocation_method,
    v_total_extra_cost,
    0,
    0,
    NULLIF(trim(p_notes), ''),
    v_normalized_charges
  )
  RETURNING id INTO v_run_id;

  FOR v_bucket IN
    SELECT *
    FROM landed_cost_receipt_buckets
    ORDER BY bucket_ordinal
  LOOP
    v_allocated_extra := CASE
      WHEN v_bucket.bucket_ordinal = v_bucket_count THEN
        round(v_total_extra_cost_base - v_allocated_so_far, 6)
      WHEN p_allocation_method = 'quantity' THEN
        round(
          v_total_extra_cost_base
          * CASE
              WHEN v_total_receipt_qty > 0 THEN v_bucket.received_qty_base / v_total_receipt_qty
              ELSE 0
            END,
          6
        )
      WHEN p_allocation_method = 'value' THEN
        round(
          v_total_extra_cost_base
          * CASE
              WHEN v_total_receipt_value > 0 THEN v_bucket.receipt_value_base / v_total_receipt_value
              ELSE 0
            END,
          6
        )
      ELSE
        round(v_total_extra_cost_base / v_bucket_count, 6)
    END;

    v_allocated_so_far := round(v_allocated_so_far + v_allocated_extra, 6);
    v_delta_per_received_unit := CASE
      WHEN v_bucket.received_qty_base > 0 THEN round(v_allocated_extra / v_bucket.received_qty_base, 6)
      ELSE 0
    END;
    v_impacted_qty := round(GREATEST(0, LEAST(v_bucket.on_hand_qty_base, v_bucket.received_qty_base)), 6);
    v_applied := round(v_delta_per_received_unit * v_impacted_qty, 6);
    v_unapplied := round(GREATEST(0, v_allocated_extra - v_applied), 6);
    v_new_avg_cost := CASE
      WHEN v_bucket.on_hand_qty_base > 0 THEN
        round(v_bucket.previous_avg_cost + (v_applied / v_bucket.on_hand_qty_base), 6)
      ELSE
        round(v_bucket.previous_avg_cost, 6)
    END;
    v_stock_movement_id := NULL;

    IF v_bucket.stock_level_id IS NOT NULL AND v_applied <> 0 THEN
      UPDATE public.stock_levels
      SET
        avg_cost = v_new_avg_cost,
        updated_at = v_now
      WHERE id = v_bucket.stock_level_id
        AND company_id = p_company_id
        AND item_id = v_bucket.item_id
        AND warehouse_id IS NOT DISTINCT FROM v_bucket.warehouse_id
        AND bin_id IS NOT DISTINCT FROM v_bucket.bin_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'stock_level_scope_mismatch';
      END IF;

      INSERT INTO public.stock_movements (
        company_id,
        type,
        item_id,
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
        p_company_id,
        'adjust',
        v_bucket.item_id,
        0,
        0,
        v_new_avg_cost,
        v_applied,
        v_bucket.warehouse_id,
        v_bucket.bin_id,
        COALESCE(NULLIF(trim(p_notes), ''), 'Landed cost revaluation'),
        COALESCE(auth.uid()::text, COALESCE(p_applied_by::text, 'landed_cost')),
        'PO',
        p_purchase_order_id::text,
        CASE
          WHEN v_bucket.po_line_id IS NULL THEN NULL
          ELSE v_bucket.po_line_id::text
        END
      )
      RETURNING id INTO v_stock_movement_id;
    END IF;

    INSERT INTO public.landed_cost_run_lines (
      run_id,
      company_id,
      purchase_order_id,
      po_line_id,
      item_id,
      item_label,
      warehouse_id,
      bin_id,
      stock_level_id,
      stock_movement_id,
      received_qty_base,
      impacted_qty_base,
      on_hand_qty_base,
      allocated_extra,
      applied_revaluation,
      unapplied_value,
      previous_avg_cost,
      new_avg_cost
    ) VALUES (
      v_run_id,
      p_company_id,
      p_purchase_order_id,
      v_bucket.po_line_id,
      v_bucket.item_id,
      NULLIF(v_bucket.item_label, ''),
      v_bucket.warehouse_id,
      v_bucket.bin_id,
      v_bucket.stock_level_id,
      v_stock_movement_id,
      v_bucket.received_qty_base,
      v_impacted_qty,
      v_bucket.on_hand_qty_base,
      v_allocated_extra,
      v_applied,
      v_unapplied,
      v_bucket.previous_avg_cost,
      v_new_avg_cost
    );

    v_line_count := v_line_count + 1;
    v_total_applied := round(v_total_applied + v_applied, 6);
    v_total_unapplied := round(v_total_unapplied + v_unapplied, 6);
  END LOOP;

  UPDATE public.landed_cost_runs
  SET
    total_applied_value = v_total_applied,
    total_unapplied_value = v_total_unapplied
  WHERE id = v_run_id;

  RETURN QUERY
  SELECT v_run_id, v_line_count, v_total_applied, v_total_unapplied;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_landed_cost_run(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  text,
  numeric,
  text,
  jsonb,
  jsonb
) TO authenticated;

COMMIT;
