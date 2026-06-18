-- Production Runs foundation.
-- Adds auditable production-run headers, inputs, outputs, direct-cost snapshots,
-- and a dedicated non-fiscal reference counter. Posting logic is added in the
-- following migration and continues to use stock_movements as the stock ledger.

CREATE TABLE IF NOT EXISTS public.production_run_counters (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.production_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reference_no text NOT NULL,
  bom_id uuid NOT NULL REFERENCES public.boms(id) ON DELETE RESTRICT,
  bom_name_snapshot text,
  bom_version_snapshot text,
  finished_item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  output_uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  planned_output_qty numeric NOT NULL CHECK (planned_output_qty > 0),
  actual_output_qty numeric CHECK (actual_output_qty IS NULL OR actual_output_qty > 0),
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  destination_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  destination_bin_id text REFERENCES public.bins(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed', 'cancelled')),
  notes text,
  base_currency_code text NOT NULL DEFAULT 'MZN',
  material_cost_total numeric NOT NULL DEFAULT 0 CHECK (material_cost_total >= 0),
  extra_cost_total numeric NOT NULL DEFAULT 0 CHECK (extra_cost_total >= 0),
  total_cost numeric NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  output_unit_cost numeric NOT NULL DEFAULT 0 CHECK (output_unit_cost >= 0),
  output_receipt_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  reversal_output_issue_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  posted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reversed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text,
  CONSTRAINT production_runs_reference_unique UNIQUE (company_id, reference_no),
  CONSTRAINT production_runs_posted_requires_actor CHECK (
    status <> 'posted' OR (posted_by IS NOT NULL AND posted_at IS NOT NULL)
  ),
  CONSTRAINT production_runs_reversed_requires_reason CHECK (
    status <> 'reversed'
    OR (
      posted_by IS NOT NULL
      AND posted_at IS NOT NULL
      AND reversed_by IS NOT NULL
      AND reversed_at IS NOT NULL
      AND NULLIF(btrim(COALESCE(reversal_reason, '')), '') IS NOT NULL
    )
  ),
  CONSTRAINT production_runs_cancelled_not_posted CHECK (
    status <> 'cancelled'
    OR (posted_by IS NULL AND posted_at IS NULL AND output_receipt_movement_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.production_run_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  production_run_id uuid NOT NULL REFERENCES public.production_runs(id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no > 0),
  bom_component_id uuid REFERENCES public.bom_components(id) ON DELETE SET NULL,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  planned_qty numeric NOT NULL CHECK (planned_qty > 0),
  actual_qty numeric CHECK (actual_qty IS NULL OR actual_qty > 0),
  source_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  source_bin_id text REFERENCES public.bins(id) ON DELETE RESTRICT,
  frozen_unit_cost numeric CHECK (frozen_unit_cost IS NULL OR frozen_unit_cost >= 0),
  frozen_total_cost numeric CHECK (frozen_total_cost IS NULL OR frozen_total_cost >= 0),
  issue_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  reversal_receipt_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_run_inputs_line_unique UNIQUE (production_run_id, line_no)
);

CREATE TABLE IF NOT EXISTS public.production_run_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  production_run_id uuid NOT NULL REFERENCES public.production_runs(id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no > 0),
  is_primary boolean NOT NULL DEFAULT true,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  actual_qty numeric CHECK (actual_qty IS NULL OR actual_qty > 0),
  destination_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  destination_bin_id text REFERENCES public.bins(id) ON DELETE RESTRICT,
  frozen_unit_cost numeric CHECK (frozen_unit_cost IS NULL OR frozen_unit_cost >= 0),
  frozen_total_cost numeric CHECK (frozen_total_cost IS NULL OR frozen_total_cost >= 0),
  receipt_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  reversal_issue_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_run_outputs_line_unique UNIQUE (production_run_id, line_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS production_run_outputs_one_primary
  ON public.production_run_outputs(production_run_id)
  WHERE is_primary;

CREATE TABLE IF NOT EXISTS public.production_run_extra_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  production_run_id uuid NOT NULL REFERENCES public.production_runs(id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no > 0),
  category text NOT NULL CHECK (category IN ('labour', 'utilities', 'overhead', 'transport', 'other')),
  description text,
  amount_base numeric NOT NULL CHECK (amount_base >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_run_extra_costs_line_unique UNIQUE (production_run_id, line_no),
  CONSTRAINT production_run_extra_other_description CHECK (
    category <> 'other' OR NULLIF(btrim(COALESCE(description, '')), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS production_runs_company_status_date_idx
  ON public.production_runs(company_id, status, run_date DESC);
CREATE INDEX IF NOT EXISTS production_runs_company_bom_idx
  ON public.production_runs(company_id, bom_id);
CREATE INDEX IF NOT EXISTS production_runs_company_finished_item_idx
  ON public.production_runs(company_id, finished_item_id);
CREATE INDEX IF NOT EXISTS production_run_inputs_run_idx
  ON public.production_run_inputs(production_run_id, line_no);
CREATE INDEX IF NOT EXISTS production_run_inputs_company_item_idx
  ON public.production_run_inputs(company_id, item_id);
CREATE INDEX IF NOT EXISTS production_run_inputs_issue_movement_idx
  ON public.production_run_inputs(issue_movement_id);
CREATE INDEX IF NOT EXISTS production_run_outputs_run_idx
  ON public.production_run_outputs(production_run_id, line_no);
CREATE INDEX IF NOT EXISTS production_run_outputs_company_item_idx
  ON public.production_run_outputs(company_id, item_id);
CREATE INDEX IF NOT EXISTS production_run_outputs_receipt_movement_idx
  ON public.production_run_outputs(receipt_movement_id);
CREATE INDEX IF NOT EXISTS production_run_extra_costs_run_idx
  ON public.production_run_extra_costs(production_run_id, line_no);

CREATE OR REPLACE FUNCTION public.production_runs_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER production_runs_touch_updated_at
  BEFORE UPDATE ON public.production_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.production_runs_touch_updated_at();

CREATE OR REPLACE FUNCTION public.validate_production_run_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_finished_base_uom text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'production_run_invalid_lifecycle' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'production_run_identity_immutable' USING ERRCODE = 'P0001';
    END IF;

    IF OLD.status = 'draft' THEN
      IF NEW.status NOT IN ('draft', 'posted', 'cancelled') THEN
        RAISE EXCEPTION 'production_run_invalid_lifecycle' USING ERRCODE = 'P0001';
      END IF;
    ELSIF OLD.status = 'posted' THEN
      IF NEW.status <> 'reversed'
        OR NEW.reference_no IS DISTINCT FROM OLD.reference_no
        OR NEW.bom_id IS DISTINCT FROM OLD.bom_id
        OR NEW.bom_name_snapshot IS DISTINCT FROM OLD.bom_name_snapshot
        OR NEW.bom_version_snapshot IS DISTINCT FROM OLD.bom_version_snapshot
        OR NEW.finished_item_id IS DISTINCT FROM OLD.finished_item_id
        OR NEW.output_uom_id IS DISTINCT FROM OLD.output_uom_id
        OR NEW.planned_output_qty IS DISTINCT FROM OLD.planned_output_qty
        OR NEW.actual_output_qty IS DISTINCT FROM OLD.actual_output_qty
        OR NEW.run_date IS DISTINCT FROM OLD.run_date
        OR NEW.destination_warehouse_id IS DISTINCT FROM OLD.destination_warehouse_id
        OR NEW.destination_bin_id IS DISTINCT FROM OLD.destination_bin_id
        OR NEW.notes IS DISTINCT FROM OLD.notes
        OR NEW.base_currency_code IS DISTINCT FROM OLD.base_currency_code
        OR NEW.material_cost_total IS DISTINCT FROM OLD.material_cost_total
        OR NEW.extra_cost_total IS DISTINCT FROM OLD.extra_cost_total
        OR NEW.total_cost IS DISTINCT FROM OLD.total_cost
        OR NEW.output_unit_cost IS DISTINCT FROM OLD.output_unit_cost
        OR NEW.output_receipt_movement_id IS DISTINCT FROM OLD.output_receipt_movement_id
        OR NEW.created_by IS DISTINCT FROM OLD.created_by
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
        OR NEW.posted_at IS DISTINCT FROM OLD.posted_at THEN
        RAISE EXCEPTION 'production_run_immutable' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      RAISE EXCEPTION 'production_run_immutable' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT i.base_uom_id
    INTO v_finished_base_uom
  FROM public.items i
  WHERE i.id = NEW.finished_item_id
    AND i.company_id = NEW.company_id;

  IF v_finished_base_uom IS NULL THEN
    RAISE EXCEPTION 'finished_item_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.output_uom_id IS DISTINCT FROM v_finished_base_uom THEN
    RAISE EXCEPTION 'production_run_output_uom_must_be_base_uom' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.boms b
  WHERE b.id = NEW.bom_id
    AND b.company_id = NEW.company_id
    AND b.product_id = NEW.finished_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bom_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.destination_warehouse_id IS NOT NULL THEN
    PERFORM 1
    FROM public.warehouses w
    WHERE w.id = NEW.destination_warehouse_id
      AND w.company_id = NEW.company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.destination_bin_id IS NOT NULL THEN
    IF NEW.destination_warehouse_id IS NULL THEN
      RAISE EXCEPTION 'destination_warehouse_required' USING ERRCODE = '22023';
    END IF;
    PERFORM 1
    FROM public.bins b
    WHERE b.id = NEW.destination_bin_id
      AND b.company_id = NEW.company_id
      AND b."warehouseId" = NEW.destination_warehouse_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.output_receipt_movement_id IS NOT NULL THEN
    PERFORM 1
    FROM public.stock_movements sm
    WHERE sm.id = NEW.output_receipt_movement_id
      AND sm.company_id = NEW.company_id
      AND sm.ref_type = 'PRODUCTION_RUN'
      AND sm.ref_id = NEW.id::text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'production_output_movement_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.reversal_output_issue_movement_id IS NOT NULL THEN
    PERFORM 1
    FROM public.stock_movements sm
    WHERE sm.id = NEW.reversal_output_issue_movement_id
      AND sm.company_id = NEW.company_id
      AND sm.ref_type = 'PRODUCTION_RUN_REVERSAL'
      AND sm.ref_id = NEW.id::text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'production_reversal_movement_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_production_run_input_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_run public.production_runs%ROWTYPE;
  v_item_base_uom text;
BEGIN
  SELECT *
    INTO v_run
  FROM public.production_runs
  WHERE id = NEW.production_run_id
    AND company_id = NEW.company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_run_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_run.status <> 'draft' THEN
      RAISE EXCEPTION 'production_run_not_draft' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.production_run_id IS DISTINCT FROM OLD.production_run_id
      OR NEW.line_no IS DISTINCT FROM OLD.line_no THEN
      RAISE EXCEPTION 'production_run_input_identity_immutable' USING ERRCODE = 'P0001';
    END IF;

    IF v_run.status = 'posted' THEN
      IF NEW.bom_component_id IS DISTINCT FROM OLD.bom_component_id
        OR NEW.item_id IS DISTINCT FROM OLD.item_id
        OR NEW.uom_id IS DISTINCT FROM OLD.uom_id
        OR NEW.planned_qty IS DISTINCT FROM OLD.planned_qty
        OR NEW.actual_qty IS DISTINCT FROM OLD.actual_qty
        OR NEW.source_warehouse_id IS DISTINCT FROM OLD.source_warehouse_id
        OR NEW.source_bin_id IS DISTINCT FROM OLD.source_bin_id
        OR NEW.frozen_unit_cost IS DISTINCT FROM OLD.frozen_unit_cost
        OR NEW.frozen_total_cost IS DISTINCT FROM OLD.frozen_total_cost
        OR NEW.issue_movement_id IS DISTINCT FROM OLD.issue_movement_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'production_run_input_immutable' USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_run.status <> 'draft' THEN
      RAISE EXCEPTION 'production_run_not_draft' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT i.base_uom_id
    INTO v_item_base_uom
  FROM public.items i
  WHERE i.id = NEW.item_id
    AND i.company_id = NEW.company_id;
  IF v_item_base_uom IS NULL THEN
    RAISE EXCEPTION 'input_item_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.uom_id IS DISTINCT FROM v_item_base_uom THEN
    RAISE EXCEPTION 'production_run_input_uom_must_be_base_uom' USING ERRCODE = '22023';
  END IF;

  IF NEW.bom_component_id IS NOT NULL THEN
    PERFORM 1
    FROM public.bom_components bc
    WHERE bc.id = NEW.bom_component_id
      AND bc.bom_id = v_run.bom_id
      AND bc.component_item_id = NEW.item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bom_component_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.source_warehouse_id IS NOT NULL THEN
    PERFORM 1
    FROM public.warehouses w
    WHERE w.id = NEW.source_warehouse_id
      AND w.company_id = NEW.company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.source_bin_id IS NOT NULL THEN
    IF NEW.source_warehouse_id IS NULL THEN
      RAISE EXCEPTION 'source_warehouse_required' USING ERRCODE = '22023';
    END IF;
    PERFORM 1
    FROM public.bins b
    WHERE b.id = NEW.source_bin_id
      AND b.company_id = NEW.company_id
      AND b."warehouseId" = NEW.source_warehouse_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.issue_movement_id IS NOT NULL THEN
    PERFORM 1
    FROM public.stock_movements sm
    WHERE sm.id = NEW.issue_movement_id
      AND sm.company_id = NEW.company_id
      AND sm.type = 'issue'
      AND sm.ref_type = 'PRODUCTION_RUN'
      AND sm.ref_id = NEW.production_run_id::text
      AND sm.ref_line_id::text = NEW.id::text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'production_input_movement_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.reversal_receipt_movement_id IS NOT NULL THEN
    PERFORM 1
    FROM public.stock_movements sm
    WHERE sm.id = NEW.reversal_receipt_movement_id
      AND sm.company_id = NEW.company_id
      AND sm.type = 'receive'
      AND sm.ref_type = 'PRODUCTION_RUN_REVERSAL'
      AND sm.ref_id = NEW.production_run_id::text
      AND sm.ref_line_id::text = NEW.id::text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'production_reversal_movement_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_production_run_output_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_run public.production_runs%ROWTYPE;
  v_item_base_uom text;
BEGIN
  SELECT *
    INTO v_run
  FROM public.production_runs
  WHERE id = NEW.production_run_id
    AND company_id = NEW.company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_run_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_run.status <> 'draft' THEN
      RAISE EXCEPTION 'production_run_not_draft' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.production_run_id IS DISTINCT FROM OLD.production_run_id
      OR NEW.line_no IS DISTINCT FROM OLD.line_no THEN
      RAISE EXCEPTION 'production_run_output_identity_immutable' USING ERRCODE = 'P0001';
    END IF;

    IF v_run.status = 'posted' THEN
      IF NEW.is_primary IS DISTINCT FROM OLD.is_primary
        OR NEW.item_id IS DISTINCT FROM OLD.item_id
        OR NEW.uom_id IS DISTINCT FROM OLD.uom_id
        OR NEW.actual_qty IS DISTINCT FROM OLD.actual_qty
        OR NEW.destination_warehouse_id IS DISTINCT FROM OLD.destination_warehouse_id
        OR NEW.destination_bin_id IS DISTINCT FROM OLD.destination_bin_id
        OR NEW.frozen_unit_cost IS DISTINCT FROM OLD.frozen_unit_cost
        OR NEW.frozen_total_cost IS DISTINCT FROM OLD.frozen_total_cost
        OR NEW.receipt_movement_id IS DISTINCT FROM OLD.receipt_movement_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'production_run_output_immutable' USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_run.status <> 'draft' THEN
      RAISE EXCEPTION 'production_run_not_draft' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.item_id IS DISTINCT FROM v_run.finished_item_id THEN
    RAISE EXCEPTION 'production_output_item_mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT i.base_uom_id
    INTO v_item_base_uom
  FROM public.items i
  WHERE i.id = NEW.item_id
    AND i.company_id = NEW.company_id;
  IF v_item_base_uom IS NULL THEN
    RAISE EXCEPTION 'output_item_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.uom_id IS DISTINCT FROM v_item_base_uom THEN
    RAISE EXCEPTION 'production_run_output_uom_must_be_base_uom' USING ERRCODE = '22023';
  END IF;

  IF NEW.destination_warehouse_id IS NOT NULL THEN
    PERFORM 1
    FROM public.warehouses w
    WHERE w.id = NEW.destination_warehouse_id
      AND w.company_id = NEW.company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'warehouse_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.destination_bin_id IS NOT NULL THEN
    IF NEW.destination_warehouse_id IS NULL THEN
      RAISE EXCEPTION 'destination_warehouse_required' USING ERRCODE = '22023';
    END IF;
    PERFORM 1
    FROM public.bins b
    WHERE b.id = NEW.destination_bin_id
      AND b.company_id = NEW.company_id
      AND b."warehouseId" = NEW.destination_warehouse_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bin_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.receipt_movement_id IS NOT NULL THEN
    PERFORM 1
    FROM public.stock_movements sm
    WHERE sm.id = NEW.receipt_movement_id
      AND sm.company_id = NEW.company_id
      AND sm.type = 'receive'
      AND sm.ref_type = 'PRODUCTION_RUN'
      AND sm.ref_id = NEW.production_run_id::text
      AND sm.ref_line_id::text = NEW.id::text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'production_output_movement_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.reversal_issue_movement_id IS NOT NULL THEN
    PERFORM 1
    FROM public.stock_movements sm
    WHERE sm.id = NEW.reversal_issue_movement_id
      AND sm.company_id = NEW.company_id
      AND sm.type = 'issue'
      AND sm.ref_type = 'PRODUCTION_RUN_REVERSAL'
      AND sm.ref_id = NEW.production_run_id::text
      AND sm.ref_line_id::text = NEW.id::text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'production_reversal_movement_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_production_run_extra_cost_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT pr.status
    INTO v_status
  FROM public.production_runs pr
  WHERE pr.id = NEW.production_run_id
    AND pr.company_id = NEW.company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_run_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'production_run_not_draft' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_production_runs_row
  BEFORE INSERT OR UPDATE ON public.production_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_production_run_row();

CREATE TRIGGER validate_production_run_inputs_row
  BEFORE INSERT OR UPDATE ON public.production_run_inputs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_production_run_input_row();

CREATE TRIGGER validate_production_run_outputs_row
  BEFORE INSERT OR UPDATE ON public.production_run_outputs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_production_run_output_row();

CREATE TRIGGER validate_production_run_extra_costs_row
  BEFORE INSERT OR UPDATE ON public.production_run_extra_costs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_production_run_extra_cost_row();

REVOKE ALL ON FUNCTION public.validate_production_run_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_production_run_input_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_production_run_output_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_production_run_extra_cost_row() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.production_run_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_extra_costs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.production_run_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_inputs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_outputs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_extra_costs FORCE ROW LEVEL SECURITY;

CREATE POLICY production_run_counters_select_active_company
  ON public.production_run_counters
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY production_runs_select_active_company
  ON public.production_runs
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

CREATE POLICY production_run_inputs_select_active_company
  ON public.production_run_inputs
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

CREATE POLICY production_run_outputs_select_active_company
  ON public.production_run_outputs
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

CREATE POLICY production_run_extra_costs_select_active_company
  ON public.production_run_extra_costs
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

REVOKE ALL ON public.production_run_counters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.production_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.production_run_inputs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.production_run_outputs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.production_run_extra_costs FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.production_run_counters TO authenticated;
GRANT SELECT ON public.production_runs TO authenticated;
GRANT SELECT ON public.production_run_inputs TO authenticated;
GRANT SELECT ON public.production_run_outputs TO authenticated;
GRANT SELECT ON public.production_run_extra_costs TO authenticated;

GRANT ALL ON public.production_run_counters TO service_role;
GRANT ALL ON public.production_runs TO service_role;
GRANT ALL ON public.production_run_inputs TO service_role;
GRANT ALL ON public.production_run_outputs TO service_role;
GRANT ALL ON public.production_run_extra_costs TO service_role;

COMMENT ON TABLE public.production_runs IS
  'Company-scoped production run headers with immutable posted and reversal cost snapshots.';
COMMENT ON TABLE public.production_run_inputs IS
  'Production run input lines with source buckets, frozen WAC snapshots, and movement links.';
COMMENT ON TABLE public.production_run_outputs IS
  'Production run output lines; first phase supports one primary finished output.';
COMMENT ON TABLE public.production_run_extra_costs IS
  'Direct production cost snapshots only; these rows do not create finance postings.';
