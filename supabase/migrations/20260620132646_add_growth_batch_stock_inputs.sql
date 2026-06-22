-- Growth Batches G3 stock-input schema, immutable detail ledgers, and read models.
-- This migration adds physical stock-input event structure only. Posting logic is
-- added in the paired *_add_growth_batch_stock_input_posting.sql migration.

ALTER TABLE public.growth_batch_events
  DROP CONSTRAINT IF EXISTS growth_batch_events_event_type_check;

ALTER TABLE public.growth_batch_events
  ADD CONSTRAINT growth_batch_events_event_type_check CHECK (
    event_type IN (
      'activation',
      'measurement',
      'direct_cost',
      'cancellation',
      'stock_input',
      'stock_input_reversal'
    )
  );

ALTER TABLE public.growth_batch_events
  DROP CONSTRAINT IF EXISTS growth_batch_events_cost_deltas_valid;

ALTER TABLE public.growth_batch_events
  ADD CONSTRAINT growth_batch_events_cost_deltas_valid CHECK (
    direct_cost_delta >= 0
    AND total_cost_delta = material_cost_delta + direct_cost_delta
    AND (
      (
        event_type = 'stock_input_reversal'
        AND material_cost_delta <= 0
        AND total_cost_delta <= 0
      )
      OR (
        event_type <> 'stock_input_reversal'
        AND material_cost_delta >= 0
        AND total_cost_delta >= 0
      )
    )
  );

ALTER TABLE public.growth_batch_events
  DROP CONSTRAINT IF EXISTS growth_batch_events_original_event_for_reversal;

ALTER TABLE public.growth_batch_events
  ADD CONSTRAINT growth_batch_events_original_event_for_reversal CHECK (
    (event_type = 'stock_input_reversal' AND original_event_id IS NOT NULL)
    OR (event_type <> 'stock_input_reversal' AND original_event_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS growth_batch_events_one_stock_input_reversal_idx
  ON public.growth_batch_events(original_event_id)
  WHERE event_type = 'stock_input_reversal' AND original_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.growth_batch_stock_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  growth_batch_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no > 0),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  source_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  source_bin_id text NOT NULL REFERENCES public.bins(id) ON DELETE RESTRICT,
  frozen_unit_cost numeric NOT NULL CHECK (frozen_unit_cost >= 0),
  frozen_total_cost numeric NOT NULL CHECK (frozen_total_cost >= 0),
  issue_movement_id uuid NOT NULL REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  line_notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_stock_inputs_event_line_unique UNIQUE (growth_batch_event_id, line_no),
  CONSTRAINT growth_batch_stock_inputs_movement_unique UNIQUE (issue_movement_id)
);

CREATE TABLE IF NOT EXISTS public.growth_batch_stock_input_reversal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  reversal_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE CASCADE,
  original_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE RESTRICT,
  original_stock_input_id uuid NOT NULL REFERENCES public.growth_batch_stock_inputs(id) ON DELETE RESTRICT,
  line_no integer NOT NULL CHECK (line_no > 0),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  frozen_unit_cost numeric NOT NULL CHECK (frozen_unit_cost >= 0),
  frozen_total_cost numeric NOT NULL CHECK (frozen_total_cost >= 0),
  destination_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  destination_bin_id text NOT NULL REFERENCES public.bins(id) ON DELETE RESTRICT,
  receipt_movement_id uuid NOT NULL REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_stock_input_reversal_original_unique UNIQUE (original_stock_input_id),
  CONSTRAINT growth_batch_stock_input_reversal_event_line_unique UNIQUE (reversal_event_id, line_no),
  CONSTRAINT growth_batch_stock_input_reversal_receipt_unique UNIQUE (receipt_movement_id)
);

CREATE INDEX IF NOT EXISTS growth_batch_stock_inputs_company_batch_idx
  ON public.growth_batch_stock_inputs(company_id, growth_batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_batch_stock_inputs_event_idx
  ON public.growth_batch_stock_inputs(growth_batch_event_id);
CREATE INDEX IF NOT EXISTS growth_batch_stock_inputs_item_idx
  ON public.growth_batch_stock_inputs(company_id, item_id);
CREATE INDEX IF NOT EXISTS growth_batch_stock_inputs_source_idx
  ON public.growth_batch_stock_inputs(company_id, source_warehouse_id, source_bin_id);
CREATE INDEX IF NOT EXISTS growth_batch_stock_inputs_movement_idx
  ON public.growth_batch_stock_inputs(issue_movement_id);

CREATE INDEX IF NOT EXISTS growth_batch_stock_input_reversal_company_batch_idx
  ON public.growth_batch_stock_input_reversal_lines(company_id, growth_batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_batch_stock_input_reversal_event_idx
  ON public.growth_batch_stock_input_reversal_lines(reversal_event_id);
CREATE INDEX IF NOT EXISTS growth_batch_stock_input_reversal_original_event_idx
  ON public.growth_batch_stock_input_reversal_lines(original_event_id);
CREATE INDEX IF NOT EXISTS growth_batch_stock_input_reversal_receipt_idx
  ON public.growth_batch_stock_input_reversal_lines(receipt_movement_id);

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
        OR NEW.current_primary_qty IS DISTINCT FROM OLD.current_primary_qty
        OR NEW.opening_total_weight IS DISTINCT FROM OLD.opening_total_weight
        OR NEW.weight_uom_id IS DISTINCT FROM OLD.weight_uom_id
        OR NEW.area IS DISTINCT FROM OLD.area
        OR NEW.area_uom_id IS DISTINCT FROM OLD.area_uom_id
        OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
        OR NEW.bin_id IS DISTINCT FROM OLD.bin_id
        OR NEW.location_description IS DISTINCT FROM OLD.location_description
        OR NEW.base_currency_code IS DISTINCT FROM OLD.base_currency_code
        OR NEW.harvested_cost IS DISTINCT FROM OLD.harvested_cost
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

CREATE OR REPLACE FUNCTION public.validate_growth_batch_event_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_weight_uom_family text;
  v_original_event public.growth_batch_events%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'growth_batch_event_immutable' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF current_setting('stockwise.growth_batch_rpc', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'growth_batch_rpc_required' USING ERRCODE = '42501';
    END IF;

    PERFORM 1
    FROM public.growth_batches gb
    WHERE gb.id = NEW.growth_batch_id
      AND gb.company_id = NEW.company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
    END IF;

    IF NEW.event_type = 'stock_input_reversal' THEN
      IF NEW.original_event_id IS NULL THEN
        RAISE EXCEPTION 'growth_batch_reversal_original_event_required' USING ERRCODE = '22023';
      END IF;

      SELECT *
        INTO v_original_event
      FROM public.growth_batch_events e
      WHERE e.id = NEW.original_event_id
        AND e.company_id = NEW.company_id
        AND e.growth_batch_id = NEW.growth_batch_id
        AND e.event_type = 'stock_input';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'growth_batch_reversal_original_event_invalid' USING ERRCODE = 'P0001';
      END IF;
    ELSIF NEW.original_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'growth_batch_original_event_only_for_reversal' USING ERRCODE = '22023';
    END IF;

    IF (NEW.weight_value IS NOT NULL OR NEW.weight_delta IS NOT NULL)
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
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_growth_batch_stock_input_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_event public.growth_batch_events%ROWTYPE;
  v_item public.items%ROWTYPE;
  v_movement public.stock_movements%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'growth_batch_stock_input_immutable' USING ERRCODE = 'P0001';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'growth_batch_stock_input_immutable' USING ERRCODE = 'P0001';
  END IF;

  IF current_setting('stockwise.growth_batch_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'growth_batch_rpc_required' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_event
  FROM public.growth_batch_events
  WHERE id = NEW.growth_batch_event_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id;

  IF NOT FOUND OR v_event.event_type <> 'stock_input' THEN
    RAISE EXCEPTION 'growth_batch_stock_input_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_item
  FROM public.items
  WHERE id = NEW.item_id
    AND company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_item.track_inventory, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'growth_batch_input_item_not_stock_tracked' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(v_item.base_uom_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'growth_batch_input_item_base_uom_required' USING ERRCODE = '22023';
  END IF;
  IF NEW.uom_id IS DISTINCT FROM v_item.base_uom_id THEN
    RAISE EXCEPTION 'growth_batch_input_uom_mismatch' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.warehouses w
  WHERE w.id = NEW.source_warehouse_id
    AND w.company_id = NEW.company_id
    AND COALESCE(w.status, 'active') = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_input_source_invalid' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.bins b
  WHERE b.id = NEW.source_bin_id
    AND b.company_id = NEW.company_id
    AND b."warehouseId" = NEW.source_warehouse_id
    AND COALESCE(b.status, 'active') = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_input_source_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_movement
  FROM public.stock_movements sm
  WHERE sm.id = NEW.issue_movement_id
    AND sm.company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_input_movement_missing' USING ERRCODE = 'P0001';
  END IF;
  IF v_movement.type <> 'issue'
    OR v_movement.item_id IS DISTINCT FROM NEW.item_id
    OR v_movement.uom_id IS DISTINCT FROM NEW.uom_id
    OR v_movement.qty_base IS DISTINCT FROM NEW.quantity
    OR v_movement.warehouse_from_id IS DISTINCT FROM NEW.source_warehouse_id
    OR v_movement.bin_from_id IS DISTINCT FROM NEW.source_bin_id
    OR v_movement.ref_type IS DISTINCT FROM 'GROWTH_BATCH_INPUT'
    OR v_movement.ref_id IS DISTINCT FROM NEW.growth_batch_event_id::text
    OR v_movement.ref_line_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'growth_batch_input_movement_invalid' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_growth_batch_stock_input_reversal_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_reversal_event public.growth_batch_events%ROWTYPE;
  v_original_event public.growth_batch_events%ROWTYPE;
  v_original public.growth_batch_stock_inputs%ROWTYPE;
  v_movement public.stock_movements%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'growth_batch_stock_input_reversal_immutable' USING ERRCODE = 'P0001';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'growth_batch_stock_input_reversal_immutable' USING ERRCODE = 'P0001';
  END IF;

  IF current_setting('stockwise.growth_batch_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'growth_batch_rpc_required' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_reversal_event
  FROM public.growth_batch_events
  WHERE id = NEW.reversal_event_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id;
  IF NOT FOUND OR v_reversal_event.event_type <> 'stock_input_reversal' THEN
    RAISE EXCEPTION 'growth_batch_stock_input_reversal_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_original_event
  FROM public.growth_batch_events
  WHERE id = NEW.original_event_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id;
  IF NOT FOUND OR v_original_event.event_type <> 'stock_input' THEN
    RAISE EXCEPTION 'growth_batch_stock_input_original_event_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF v_reversal_event.original_event_id IS DISTINCT FROM NEW.original_event_id THEN
    RAISE EXCEPTION 'growth_batch_stock_input_reversal_event_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_original
  FROM public.growth_batch_stock_inputs
  WHERE id = NEW.original_stock_input_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id
    AND growth_batch_event_id = NEW.original_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_stock_input_original_line_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.line_no IS DISTINCT FROM v_original.line_no
    OR NEW.item_id IS DISTINCT FROM v_original.item_id
    OR NEW.uom_id IS DISTINCT FROM v_original.uom_id
    OR NEW.quantity IS DISTINCT FROM v_original.quantity
    OR NEW.frozen_unit_cost IS DISTINCT FROM v_original.frozen_unit_cost
    OR NEW.frozen_total_cost IS DISTINCT FROM v_original.frozen_total_cost
    OR NEW.destination_warehouse_id IS DISTINCT FROM v_original.source_warehouse_id
    OR NEW.destination_bin_id IS DISTINCT FROM v_original.source_bin_id THEN
    RAISE EXCEPTION 'growth_batch_stock_input_reversal_line_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_movement
  FROM public.stock_movements sm
  WHERE sm.id = NEW.receipt_movement_id
    AND sm.company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_stock_input_reversal_movement_missing' USING ERRCODE = 'P0001';
  END IF;
  IF v_movement.type <> 'receive'
    OR v_movement.item_id IS DISTINCT FROM NEW.item_id
    OR v_movement.uom_id IS DISTINCT FROM NEW.uom_id
    OR v_movement.qty_base IS DISTINCT FROM NEW.quantity
    OR v_movement.warehouse_to_id IS DISTINCT FROM NEW.destination_warehouse_id
    OR v_movement.bin_to_id IS DISTINCT FROM NEW.destination_bin_id
    OR v_movement.ref_type IS DISTINCT FROM 'GROWTH_BATCH_INPUT_REVERSAL'
    OR v_movement.ref_id IS DISTINCT FROM NEW.reversal_event_id::text
    OR v_movement.ref_line_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'growth_batch_stock_input_reversal_movement_invalid' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_growth_batch_stock_inputs_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.growth_batch_stock_inputs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_stock_input_row();

CREATE TRIGGER validate_growth_batch_stock_input_reversal_lines_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.growth_batch_stock_input_reversal_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_stock_input_reversal_row();

REVOKE ALL ON FUNCTION public.validate_growth_batch_stock_input_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_growth_batch_stock_input_reversal_row() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.growth_batches_register WITH (security_invoker = true) AS
SELECT
  gb.id,
  gb.company_id,
  gb.reference_no,
  gb.name,
  gb.batch_family,
  gb.primary_quantity_basis,
  gb.status,
  gb.start_date,
  gb.expected_end_date,
  gb.opening_primary_qty,
  gb.current_primary_qty,
  gb.primary_uom_id,
  pu.code AS primary_uom_code,
  gb.opening_total_weight,
  gb.current_total_weight AS latest_total_weight,
  gb.weight_uom_id,
  wu.code AS weight_uom_code,
  gb.area,
  gb.area_uom_id,
  au.code AS area_uom_code,
  gb.accumulated_material_cost,
  gb.accumulated_direct_cost,
  gb.accumulated_total_cost,
  gb.harvested_cost,
  gb.remaining_cost,
  gb.warehouse_id,
  w.name AS warehouse_name,
  gb.bin_id,
  b.code AS bin_code,
  b.name AS bin_name,
  gb.location_description,
  gb.base_currency_code,
  gb.latest_event_sequence,
  le.event_type AS latest_event_type,
  le.event_at AS latest_event_at,
  gb.created_at,
  gb.activated_at,
  gb.cancelled_at,
  COALESCE(si.stock_input_event_count, 0) AS stock_input_event_count,
  COALESCE(si.stock_input_line_count, 0) AS stock_input_line_count,
  COALESCE(si.stock_input_material_cost, 0) AS stock_input_material_cost
FROM public.growth_batches gb
LEFT JOIN public.uoms pu ON pu.id = gb.primary_uom_id
LEFT JOIN public.uoms wu ON wu.id = gb.weight_uom_id
LEFT JOIN public.uoms au ON au.id = gb.area_uom_id
LEFT JOIN public.warehouses w ON w.id = gb.warehouse_id AND w.company_id = gb.company_id
LEFT JOIN public.bins b ON b.id = gb.bin_id AND b.company_id = gb.company_id
LEFT JOIN LATERAL (
  SELECT gbe.event_type, gbe.event_at
  FROM public.growth_batch_events gbe
  WHERE gbe.growth_batch_id = gb.id
    AND gbe.company_id = gb.company_id
  ORDER BY gbe.event_sequence DESC
  LIMIT 1
) le ON true
LEFT JOIN LATERAL (
  SELECT
    count(DISTINCT i.growth_batch_event_id)::integer AS stock_input_event_count,
    count(i.id)::integer AS stock_input_line_count,
    COALESCE(sum(i.frozen_total_cost), 0)
      - COALESCE(sum(CASE WHEN r.id IS NULL THEN 0 ELSE r.frozen_total_cost END), 0) AS stock_input_material_cost
  FROM public.growth_batch_stock_inputs i
  LEFT JOIN public.growth_batch_stock_input_reversal_lines r
    ON r.original_stock_input_id = i.id
   AND r.company_id = i.company_id
  WHERE i.growth_batch_id = gb.id
    AND i.company_id = gb.company_id
) si ON true
WHERE gb.company_id = public.current_company_id();

CREATE OR REPLACE VIEW public.growth_batch_current_state WITH (security_invoker = true) AS
SELECT
  r.id,
  r.company_id,
  r.reference_no,
  r.name,
  r.batch_family,
  r.primary_quantity_basis,
  r.status,
  r.start_date,
  r.expected_end_date,
  r.opening_primary_qty,
  r.current_primary_qty,
  r.primary_uom_id,
  r.primary_uom_code,
  r.opening_total_weight,
  r.latest_total_weight,
  r.weight_uom_id,
  r.weight_uom_code,
  r.area,
  r.area_uom_id,
  r.area_uom_code,
  r.accumulated_material_cost,
  r.accumulated_direct_cost,
  r.accumulated_total_cost,
  r.harvested_cost,
  r.remaining_cost,
  r.warehouse_id,
  r.warehouse_name,
  r.bin_id,
  r.bin_code,
  r.bin_name,
  r.location_description,
  r.base_currency_code,
  r.latest_event_sequence,
  r.latest_event_type,
  r.latest_event_at,
  r.created_at,
  r.activated_at,
  r.cancelled_at,
  lm.measurement_type AS latest_measurement_type,
  lm.value AS latest_measurement_value,
  lm.uom_id AS latest_measurement_uom_id,
  lm.uom_code AS latest_measurement_uom_code,
  lm.observed_at AS latest_measurement_observed_at,
  COALESCE(ec.event_count, 0) AS event_count,
  COALESCE(mc.measurement_count, 0) AS measurement_count,
  COALESCE(dc.direct_cost_count, 0) AS direct_cost_count,
  COALESCE(dc.direct_cost_total, 0) AS direct_cost_total,
  gb.created_by,
  gb.updated_by,
  gb.activated_by,
  gb.cancelled_by,
  r.stock_input_event_count,
  r.stock_input_line_count,
  r.stock_input_material_cost,
  COALESCE(rv.reversed_stock_input_event_count, 0) AS reversed_stock_input_event_count
FROM public.growth_batches_register r
JOIN public.growth_batches gb ON gb.id = r.id AND gb.company_id = r.company_id
LEFT JOIN LATERAL (
  SELECT m.measurement_type, m.value, m.uom_id, u.code AS uom_code, m.observed_at
  FROM public.growth_batch_measurements m
  JOIN public.growth_batch_events e
    ON e.id = m.growth_batch_event_id
   AND e.growth_batch_id = m.growth_batch_id
   AND e.company_id = m.company_id
  LEFT JOIN public.uoms u ON u.id = m.uom_id
  WHERE m.growth_batch_id = r.id
    AND m.company_id = r.company_id
  ORDER BY e.event_sequence DESC
  LIMIT 1
) lm ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS event_count
  FROM public.growth_batch_events e
  WHERE e.growth_batch_id = r.id
    AND e.company_id = r.company_id
) ec ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS measurement_count
  FROM public.growth_batch_measurements m
  WHERE m.growth_batch_id = r.id
    AND m.company_id = r.company_id
) mc ON true
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS direct_cost_count, COALESCE(sum(amount), 0) AS direct_cost_total
  FROM public.growth_batch_direct_costs d
  WHERE d.growth_batch_id = r.id
    AND d.company_id = r.company_id
) dc ON true
LEFT JOIN LATERAL (
  SELECT count(DISTINCT original_event_id)::integer AS reversed_stock_input_event_count
  FROM public.growth_batch_stock_input_reversal_lines rl
  WHERE rl.growth_batch_id = r.id
    AND rl.company_id = r.company_id
) rv ON true;

CREATE OR REPLACE VIEW public.growth_batch_event_timeline WITH (security_invoker = true) AS
SELECT
  e.id,
  e.company_id,
  e.growth_batch_id,
  e.event_sequence,
  e.event_reference,
  e.event_type,
  e.event_at,
  e.event_date,
  e.created_by AS actor_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), 'Team member') AS actor_display_name,
  e.quantity_delta,
  e.weight_value,
  e.weight_delta,
  e.weight_uom_id,
  wu.code AS weight_uom_code,
  e.material_cost_delta,
  e.direct_cost_delta,
  e.total_cost_delta,
  e.currency_code,
  e.notes,
  e.reason,
  CASE e.event_type
    WHEN 'activation' THEN 'Batch activated'
    WHEN 'measurement' THEN 'Measurement recorded'
    WHEN 'direct_cost' THEN 'Direct cost recorded'
    WHEN 'stock_input' THEN 'Stock input posted'
    WHEN 'stock_input_reversal' THEN 'Stock input reversed'
    WHEN 'cancellation' THEN 'Draft cancelled'
    ELSE e.event_type
  END AS event_summary,
  CASE
    WHEN m.id IS NOT NULL THEN jsonb_build_object(
      'measurement_type', m.measurement_type,
      'value', m.value,
      'uom_id', m.uom_id,
      'uom_code', mu.code,
      'observed_at', m.observed_at
    )
    WHEN d.id IS NOT NULL THEN jsonb_build_object(
      'category', d.category,
      'description', d.description,
      'amount', d.amount,
      'currency_code', d.currency_code
    )
    WHEN si.line_count IS NOT NULL THEN jsonb_build_object(
      'line_count', si.line_count,
      'material_cost', si.material_cost,
      'currency_code', e.currency_code,
      'items', si.items
    )
    WHEN rv.line_count IS NOT NULL THEN jsonb_build_object(
      'line_count', rv.line_count,
      'reversed_material_cost', rv.material_cost,
      'currency_code', e.currency_code,
      'original_event_id', e.original_event_id,
      'items', rv.items
    )
    ELSE '{}'::jsonb
  END AS typed_detail_summary,
  e.original_event_id
FROM public.growth_batch_events e
LEFT JOIN public.growth_batch_measurements m ON m.growth_batch_event_id = e.id
LEFT JOIN public.growth_batch_direct_costs d ON d.growth_batch_event_id = e.id
LEFT JOIN LATERAL (
  SELECT
    count(*)::integer AS line_count,
    COALESCE(sum(i.frozen_total_cost), 0) AS material_cost,
    jsonb_agg(jsonb_build_object(
      'line_no', i.line_no,
      'item_id', i.item_id,
      'item_name', item.name,
      'item_sku', item.sku,
      'quantity', i.quantity,
      'uom_id', i.uom_id,
      'uom_code', iu.code,
      'source_warehouse_id', i.source_warehouse_id,
      'source_bin_id', i.source_bin_id,
      'frozen_total_cost', i.frozen_total_cost,
      'issue_movement_id', i.issue_movement_id
    ) ORDER BY i.line_no) AS items
  FROM public.growth_batch_stock_inputs i
  JOIN public.items item ON item.id = i.item_id AND item.company_id = i.company_id
  LEFT JOIN public.uoms iu ON iu.id = i.uom_id
  WHERE i.growth_batch_event_id = e.id
    AND i.company_id = e.company_id
) si ON e.event_type = 'stock_input'
LEFT JOIN LATERAL (
  SELECT
    count(*)::integer AS line_count,
    COALESCE(sum(r.frozen_total_cost), 0) AS material_cost,
    jsonb_agg(jsonb_build_object(
      'line_no', r.line_no,
      'item_id', r.item_id,
      'item_name', item.name,
      'item_sku', item.sku,
      'quantity', r.quantity,
      'uom_id', r.uom_id,
      'uom_code', ru.code,
      'destination_warehouse_id', r.destination_warehouse_id,
      'destination_bin_id', r.destination_bin_id,
      'frozen_total_cost', r.frozen_total_cost,
      'receipt_movement_id', r.receipt_movement_id,
      'original_stock_input_id', r.original_stock_input_id
    ) ORDER BY r.line_no) AS items
  FROM public.growth_batch_stock_input_reversal_lines r
  JOIN public.items item ON item.id = r.item_id AND item.company_id = r.company_id
  LEFT JOIN public.uoms ru ON ru.id = r.uom_id
  WHERE r.reversal_event_id = e.id
    AND r.company_id = e.company_id
) rv ON e.event_type = 'stock_input_reversal'
LEFT JOIN public.uoms wu ON wu.id = e.weight_uom_id
LEFT JOIN public.uoms mu ON mu.id = m.uom_id
LEFT JOIN public.profiles p ON p.id = e.created_by
WHERE e.company_id = public.current_company_id();

CREATE OR REPLACE VIEW public.growth_batch_stock_input_history WITH (security_invoker = true) AS
SELECT
  i.id,
  i.company_id,
  i.growth_batch_id,
  gb.reference_no AS growth_batch_reference,
  i.growth_batch_event_id AS event_id,
  e.event_sequence,
  e.event_reference,
  e.event_date AS event_effective_date,
  e.event_at AS event_created_at,
  e.created_by AS actor_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), 'Team member') AS actor_display_name,
  i.line_no,
  i.item_id,
  item.name AS item_name,
  item.sku AS item_sku,
  i.quantity,
  i.uom_id,
  u.code AS uom_code,
  i.source_warehouse_id,
  w.name AS source_warehouse_name,
  i.source_bin_id,
  b.code AS source_bin_code,
  b.name AS source_bin_name,
  i.frozen_unit_cost,
  i.frozen_total_cost,
  e.currency_code,
  i.issue_movement_id,
  i.line_notes,
  CASE WHEN r.id IS NULL THEN 'not_reversed' ELSE 'reversed' END AS reversal_status,
  r.reversal_event_id,
  re.event_reference AS reversal_event_reference,
  re.event_at AS reversal_timestamp,
  re.event_date AS reversal_effective_date,
  re.created_by AS reversal_actor_id,
  COALESCE(NULLIF(rp.full_name, ''), NULLIF(rp.name, ''), NULL) AS reversal_actor_display_name,
  re.reason AS reversal_reason,
  r.receipt_movement_id AS reversal_receipt_movement_id
FROM public.growth_batch_stock_inputs i
JOIN public.growth_batches gb ON gb.id = i.growth_batch_id AND gb.company_id = i.company_id
JOIN public.growth_batch_events e
  ON e.id = i.growth_batch_event_id
 AND e.company_id = i.company_id
 AND e.growth_batch_id = i.growth_batch_id
JOIN public.items item ON item.id = i.item_id AND item.company_id = i.company_id
LEFT JOIN public.uoms u ON u.id = i.uom_id
LEFT JOIN public.warehouses w ON w.id = i.source_warehouse_id AND w.company_id = i.company_id
LEFT JOIN public.bins b ON b.id = i.source_bin_id AND b.company_id = i.company_id
LEFT JOIN public.profiles p ON p.id = e.created_by
LEFT JOIN public.growth_batch_stock_input_reversal_lines r
  ON r.original_stock_input_id = i.id
 AND r.company_id = i.company_id
LEFT JOIN public.growth_batch_events re
  ON re.id = r.reversal_event_id
 AND re.company_id = r.company_id
LEFT JOIN public.profiles rp ON rp.id = re.created_by
WHERE i.company_id = public.current_company_id();

ALTER TABLE public.growth_batch_stock_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_stock_input_reversal_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.growth_batch_stock_inputs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_stock_input_reversal_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY growth_batch_stock_inputs_select_active_company
  ON public.growth_batch_stock_inputs
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

CREATE POLICY growth_batch_stock_input_reversals_select_active_company
  ON public.growth_batch_stock_input_reversal_lines
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

REVOKE ALL ON public.growth_batch_stock_inputs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_stock_input_reversal_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.growth_batch_stock_inputs TO authenticated;
GRANT SELECT ON public.growth_batch_stock_input_reversal_lines TO authenticated;
GRANT SELECT ON public.growth_batch_stock_input_history TO authenticated;

GRANT ALL ON public.growth_batch_stock_inputs TO service_role;
GRANT ALL ON public.growth_batch_stock_input_reversal_lines TO service_role;

COMMENT ON TABLE public.growth_batch_stock_inputs
IS 'G3 immutable physical stock-input detail lines. Each row is tied to one stock issue movement and one stock_input Growth Batch event.';

COMMENT ON TABLE public.growth_batch_stock_input_reversal_lines
IS 'G3 immutable compensating reversal lines for stock-input events. Receipts use original quantities and frozen costs; intervening stock activity may mean WAC does not return exactly to its historical value.';
