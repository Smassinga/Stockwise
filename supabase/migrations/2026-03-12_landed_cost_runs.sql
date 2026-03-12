CREATE TABLE IF NOT EXISTS public.landed_cost_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  supplier_id uuid NULL REFERENCES public.suppliers(id) ON DELETE SET NULL,
  applied_by uuid NULL,
  currency_code text NOT NULL,
  fx_to_base numeric NOT NULL DEFAULT 1,
  allocation_method text NOT NULL CHECK (allocation_method IN ('quantity', 'value', 'equal')),
  total_extra_cost numeric NOT NULL DEFAULT 0,
  total_applied_value numeric NOT NULL DEFAULT 0,
  total_unapplied_value numeric NOT NULL DEFAULT 0,
  notes text NULL,
  charges jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_landed_cost_runs_company_po_created
  ON public.landed_cost_runs (company_id, purchase_order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.landed_cost_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.landed_cost_runs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  po_line_id uuid NULL REFERENCES public.purchase_order_lines(id) ON DELETE SET NULL,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  item_label text NULL,
  warehouse_id uuid NULL REFERENCES public.warehouses(id) ON DELETE SET NULL,
  bin_id text NULL REFERENCES public.bins(id) ON DELETE SET NULL,
  stock_level_id uuid NULL REFERENCES public.stock_levels(id) ON DELETE SET NULL,
  stock_movement_id uuid NULL REFERENCES public.stock_movements(id) ON DELETE SET NULL,
  received_qty_base numeric NOT NULL DEFAULT 0,
  impacted_qty_base numeric NOT NULL DEFAULT 0,
  on_hand_qty_base numeric NOT NULL DEFAULT 0,
  allocated_extra numeric NOT NULL DEFAULT 0,
  applied_revaluation numeric NOT NULL DEFAULT 0,
  unapplied_value numeric NOT NULL DEFAULT 0,
  previous_avg_cost numeric NOT NULL DEFAULT 0,
  new_avg_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_landed_cost_run_lines_run_id
  ON public.landed_cost_run_lines (run_id);

CREATE INDEX IF NOT EXISTS idx_landed_cost_run_lines_company_po
  ON public.landed_cost_run_lines (company_id, purchase_order_id);

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
AS $$
DECLARE
  v_run_id uuid;
  v_line jsonb;
  v_line_count integer := 0;
  v_total_applied numeric := 0;
  v_total_unapplied numeric := 0;
  v_stock_movement_id uuid;
  v_applied numeric;
  v_unapplied numeric;
  v_stock_level_id uuid;
  v_po_line_id uuid;
BEGIN
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
    p_supplier_id,
    p_applied_by,
    p_currency_code,
    COALESCE(p_fx_to_base, 1),
    p_allocation_method,
    COALESCE(p_total_extra_cost, 0),
    0,
    0,
    p_notes,
    COALESCE(p_charges, '[]'::jsonb)
  )
  RETURNING id INTO v_run_id;

  FOR v_line IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    v_applied := COALESCE((v_line->>'applied_revaluation')::numeric, 0);
    v_unapplied := COALESCE((v_line->>'unapplied_value')::numeric, 0);
    v_stock_movement_id := NULL;
    v_stock_level_id := NULLIF(v_line->>'stock_level_id', '')::uuid;
    v_po_line_id := NULLIF(v_line->>'po_line_id', '')::uuid;

    IF v_stock_level_id IS NOT NULL AND v_applied <> 0 THEN
      UPDATE public.stock_levels
      SET
        avg_cost = COALESCE((v_line->>'new_avg_cost')::numeric, avg_cost),
        updated_at = timezone('utc', now())
      WHERE id = v_stock_level_id
        AND company_id = p_company_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock level % not found for landed cost revaluation', v_stock_level_id;
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
        (v_line->>'item_id')::uuid,
        0,
        0,
        COALESCE((v_line->>'new_avg_cost')::numeric, 0),
        v_applied,
        NULLIF(v_line->>'warehouse_id', '')::uuid,
        NULLIF(v_line->>'bin_id', ''),
        COALESCE(p_notes, 'Landed cost revaluation'),
        'landed_cost',
        'PO',
        p_purchase_order_id::text,
        NULLIF(v_line->>'po_line_id', '')
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
      v_po_line_id,
      (v_line->>'item_id')::uuid,
      NULLIF(v_line->>'item_label', ''),
      NULLIF(v_line->>'warehouse_id', '')::uuid,
      NULLIF(v_line->>'bin_id', ''),
      v_stock_level_id,
      v_stock_movement_id,
      COALESCE((v_line->>'received_qty_base')::numeric, 0),
      COALESCE((v_line->>'impacted_qty_base')::numeric, 0),
      COALESCE((v_line->>'on_hand_qty_base')::numeric, 0),
      COALESCE((v_line->>'allocated_extra')::numeric, 0),
      v_applied,
      v_unapplied,
      COALESCE((v_line->>'previous_avg_cost')::numeric, 0),
      COALESCE((v_line->>'new_avg_cost')::numeric, 0)
    );

    v_line_count := v_line_count + 1;
    v_total_applied := v_total_applied + v_applied;
    v_total_unapplied := v_total_unapplied + v_unapplied;
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
