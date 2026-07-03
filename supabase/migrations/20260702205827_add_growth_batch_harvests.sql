-- Growth Batches G5.1 depleting harvest event structure only.
-- Posting logic is added in the paired *_add_growth_batch_harvest_posting.sql migration.

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
      'stock_input_reversal',
      'mortality',
      'shrinkage',
      'mortality_reversal',
      'shrinkage_reversal',
      'transfer',
      'transfer_reversal',
      'harvest',
      'harvest_reversal'
    )
  );

ALTER TABLE public.growth_batch_events
  DROP CONSTRAINT IF EXISTS growth_batch_events_original_event_for_reversal;

ALTER TABLE public.growth_batch_events
  ADD CONSTRAINT growth_batch_events_original_event_for_reversal CHECK (
    (
      event_type IN (
        'stock_input_reversal',
        'mortality_reversal',
        'shrinkage_reversal',
        'transfer_reversal',
        'harvest_reversal'
      )
      AND original_event_id IS NOT NULL
    )
    OR (
      event_type NOT IN (
        'stock_input_reversal',
        'mortality_reversal',
        'shrinkage_reversal',
        'transfer_reversal',
        'harvest_reversal'
      )
      AND original_event_id IS NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS growth_batch_events_one_harvest_reversal_idx
  ON public.growth_batch_events(original_event_id)
  WHERE event_type = 'harvest_reversal'
    AND original_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_growth_batch_event_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_weight_uom_family text;
  v_original_event public.growth_batch_events%ROWTYPE;
  v_expected_original_type text;
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

    IF NEW.event_type IN (
      'stock_input_reversal',
      'mortality_reversal',
      'shrinkage_reversal',
      'transfer_reversal',
      'harvest_reversal'
    ) THEN
      IF NEW.original_event_id IS NULL THEN
        RAISE EXCEPTION 'growth_batch_reversal_original_event_required' USING ERRCODE = '22023';
      END IF;
      IF NEW.original_event_id = NEW.id THEN
        RAISE EXCEPTION 'growth_batch_reversal_self_reference' USING ERRCODE = '22023';
      END IF;

      v_expected_original_type := CASE NEW.event_type
        WHEN 'stock_input_reversal' THEN 'stock_input'
        WHEN 'mortality_reversal' THEN 'mortality'
        WHEN 'shrinkage_reversal' THEN 'shrinkage'
        WHEN 'transfer_reversal' THEN 'transfer'
        WHEN 'harvest_reversal' THEN 'harvest'
        ELSE NULL
      END;

      SELECT *
        INTO v_original_event
      FROM public.growth_batch_events e
      WHERE e.id = NEW.original_event_id
        AND e.company_id = NEW.company_id
        AND e.growth_batch_id = NEW.growth_batch_id
        AND e.event_type = v_expected_original_type;

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

CREATE TABLE IF NOT EXISTS public.growth_batch_harvests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE CASCADE,
  harvest_kind text NOT NULL,
  harvested_primary_qty numeric NOT NULL,
  primary_uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  quantity_before numeric NOT NULL,
  quantity_after numeric NOT NULL,
  harvested_weight numeric,
  weight_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  total_weight_before numeric,
  total_weight_after numeric,
  output_item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  output_uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  output_quantity numeric NOT NULL,
  destination_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  destination_bin_id text REFERENCES public.bins(id) ON DELETE RESTRICT,
  allocated_cost numeric NOT NULL,
  output_unit_cost numeric NOT NULL,
  accumulated_total_cost numeric NOT NULL,
  harvested_cost_before numeric NOT NULL,
  harvested_cost_after numeric NOT NULL,
  remaining_cost_before numeric NOT NULL,
  remaining_cost_after numeric NOT NULL,
  stock_receipt_movement_id uuid NOT NULL REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  source_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  source_bin_id text REFERENCES public.bins(id) ON DELETE RESTRICT,
  source_location_description text,
  source_state_fingerprint text NOT NULL,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_harvests_event_unique UNIQUE (event_id),
  CONSTRAINT growth_batch_harvests_receipt_unique UNIQUE (stock_receipt_movement_id),
  CONSTRAINT growth_batch_harvests_kind_check CHECK (harvest_kind IN ('partial', 'full')),
  CONSTRAINT growth_batch_harvests_quantity_positive CHECK (
    harvested_primary_qty > 0
    AND quantity_before > 0
    AND quantity_after >= 0
  ),
  CONSTRAINT growth_batch_harvests_quantity_arithmetic CHECK (
    quantity_after = round((quantity_before - harvested_primary_qty)::numeric, 12)
  ),
  CONSTRAINT growth_batch_harvests_kind_quantity_check CHECK (
    (harvest_kind = 'full' AND quantity_after = 0)
    OR (harvest_kind = 'partial' AND quantity_after > 0)
  ),
  CONSTRAINT growth_batch_harvests_weight_nonnegative CHECK (
    (harvested_weight IS NULL OR harvested_weight > 0)
    AND (total_weight_before IS NULL OR total_weight_before >= 0)
    AND (total_weight_after IS NULL OR total_weight_after >= 0)
  ),
  CONSTRAINT growth_batch_harvests_weight_uom_consistent CHECK (
    (harvested_weight IS NULL AND weight_uom_id IS NULL)
    OR (harvested_weight IS NOT NULL AND weight_uom_id IS NOT NULL)
  ),
  CONSTRAINT growth_batch_harvests_weight_arithmetic CHECK (
    (
      harvested_weight IS NULL
      AND total_weight_before IS NULL
      AND total_weight_after IS NULL
    )
    OR (
      harvested_weight IS NOT NULL
      AND total_weight_before IS NOT NULL
      AND total_weight_after = round((total_weight_before - harvested_weight)::numeric, 12)
    )
  ),
  CONSTRAINT growth_batch_harvests_output_quantity_positive CHECK (output_quantity > 0),
  CONSTRAINT growth_batch_harvests_costs_nonnegative CHECK (
    allocated_cost >= 0
    AND output_unit_cost >= 0
    AND accumulated_total_cost >= 0
    AND harvested_cost_before >= 0
    AND harvested_cost_after >= 0
    AND remaining_cost_before >= 0
    AND remaining_cost_after >= 0
  ),
  CONSTRAINT growth_batch_harvests_cost_arithmetic CHECK (
    harvested_cost_after = round((harvested_cost_before + allocated_cost)::numeric, 6)
    AND remaining_cost_after = round((remaining_cost_before - allocated_cost)::numeric, 6)
    AND accumulated_total_cost = harvested_cost_after + remaining_cost_after
    AND accumulated_total_cost = harvested_cost_before + remaining_cost_before
  ),
  CONSTRAINT growth_batch_harvests_unit_cost_consistent CHECK (
    output_unit_cost = round((allocated_cost / output_quantity)::numeric, 6)
  )
);

CREATE TABLE IF NOT EXISTS public.growth_batch_harvest_reversal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  reversal_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE CASCADE,
  original_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE RESTRICT,
  original_harvest_id uuid NOT NULL REFERENCES public.growth_batch_harvests(id) ON DELETE RESTRICT,
  restored_primary_qty numeric NOT NULL,
  primary_uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  quantity_before numeric NOT NULL,
  quantity_after numeric NOT NULL,
  restored_weight numeric,
  weight_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  total_weight_before numeric,
  total_weight_after numeric,
  allocated_cost_restored numeric NOT NULL,
  harvested_cost_before numeric NOT NULL,
  harvested_cost_after numeric NOT NULL,
  remaining_cost_before numeric NOT NULL,
  remaining_cost_after numeric NOT NULL,
  output_item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  output_uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  output_quantity numeric NOT NULL,
  destination_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  destination_bin_id text REFERENCES public.bins(id) ON DELETE RESTRICT,
  stock_issue_movement_id uuid NOT NULL REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_harvest_reversal_event_unique UNIQUE (reversal_event_id),
  CONSTRAINT growth_batch_harvest_reversal_original_unique UNIQUE (original_harvest_id),
  CONSTRAINT growth_batch_harvest_reversal_issue_unique UNIQUE (stock_issue_movement_id),
  CONSTRAINT growth_batch_harvest_reversal_quantity_positive CHECK (
    restored_primary_qty > 0
    AND quantity_before >= 0
    AND quantity_after > 0
  ),
  CONSTRAINT growth_batch_harvest_reversal_quantity_arithmetic CHECK (
    quantity_after = round((quantity_before + restored_primary_qty)::numeric, 12)
  ),
  CONSTRAINT growth_batch_harvest_reversal_weight_nonnegative CHECK (
    (restored_weight IS NULL OR restored_weight > 0)
    AND (total_weight_before IS NULL OR total_weight_before >= 0)
    AND (total_weight_after IS NULL OR total_weight_after >= 0)
  ),
  CONSTRAINT growth_batch_harvest_reversal_weight_uom_consistent CHECK (
    (restored_weight IS NULL AND weight_uom_id IS NULL)
    OR (restored_weight IS NOT NULL AND weight_uom_id IS NOT NULL)
  ),
  CONSTRAINT growth_batch_harvest_reversal_weight_arithmetic CHECK (
    (
      restored_weight IS NULL
      AND total_weight_before IS NULL
      AND total_weight_after IS NULL
    )
    OR (
      restored_weight IS NOT NULL
      AND total_weight_before IS NOT NULL
      AND total_weight_after = round((total_weight_before + restored_weight)::numeric, 12)
    )
  ),
  CONSTRAINT growth_batch_harvest_reversal_output_quantity_positive CHECK (output_quantity > 0),
  CONSTRAINT growth_batch_harvest_reversal_costs_nonnegative CHECK (
    allocated_cost_restored >= 0
    AND harvested_cost_before >= 0
    AND harvested_cost_after >= 0
    AND remaining_cost_before >= 0
    AND remaining_cost_after >= 0
  ),
  CONSTRAINT growth_batch_harvest_reversal_cost_arithmetic CHECK (
    harvested_cost_after = round((harvested_cost_before - allocated_cost_restored)::numeric, 6)
    AND remaining_cost_after = round((remaining_cost_before + allocated_cost_restored)::numeric, 6)
  ),
  CONSTRAINT growth_batch_harvest_reversal_reason_required CHECK (
    NULLIF(btrim(COALESCE(reason, '')), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS growth_batch_harvests_company_batch_idx
  ON public.growth_batch_harvests(company_id, growth_batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_batch_harvests_event_idx
  ON public.growth_batch_harvests(event_id);
CREATE INDEX IF NOT EXISTS growth_batch_harvests_output_idx
  ON public.growth_batch_harvests(company_id, output_item_id, destination_warehouse_id, destination_bin_id);
CREATE INDEX IF NOT EXISTS growth_batch_harvests_receipt_idx
  ON public.growth_batch_harvests(stock_receipt_movement_id);

CREATE INDEX IF NOT EXISTS growth_batch_harvest_reversal_company_batch_idx
  ON public.growth_batch_harvest_reversal_lines(company_id, growth_batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_batch_harvest_reversal_event_idx
  ON public.growth_batch_harvest_reversal_lines(reversal_event_id);
CREATE INDEX IF NOT EXISTS growth_batch_harvest_reversal_original_event_idx
  ON public.growth_batch_harvest_reversal_lines(original_event_id);
CREATE INDEX IF NOT EXISTS growth_batch_harvest_reversal_issue_idx
  ON public.growth_batch_harvest_reversal_lines(stock_issue_movement_id);

CREATE OR REPLACE FUNCTION public.validate_growth_batch_harvest_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_event public.growth_batch_events%ROWTYPE;
  v_batch public.growth_batches%ROWTYPE;
  v_item public.items%ROWTYPE;
  v_movement public.stock_movements%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'growth_batch_harvest_immutable' USING ERRCODE = 'P0001';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'growth_batch_harvest_immutable' USING ERRCODE = 'P0001';
  END IF;

  IF current_setting('stockwise.growth_batch_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'growth_batch_rpc_required' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_event
  FROM public.growth_batch_events
  WHERE id = NEW.event_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id;
  IF NOT FOUND OR v_event.event_type <> 'harvest' THEN
    RAISE EXCEPTION 'growth_batch_harvest_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = NEW.growth_batch_id
    AND company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.primary_uom_id IS DISTINCT FROM v_batch.primary_uom_id
    OR NEW.weight_uom_id IS DISTINCT FROM (CASE WHEN NEW.harvested_weight IS NULL THEN NULL ELSE v_batch.weight_uom_id END) THEN
    RAISE EXCEPTION 'growth_batch_harvest_snapshot_uom_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_batch.primary_quantity_basis = 'count'
    AND (NEW.harvested_primary_qty <> trunc(NEW.harvested_primary_qty)
      OR NEW.quantity_before <> trunc(NEW.quantity_before)
      OR NEW.quantity_after <> trunc(NEW.quantity_after)) THEN
    RAISE EXCEPTION 'fractional_count_not_allowed' USING ERRCODE = '22023';
  END IF;

  IF NEW.source_bin_id IS NOT NULL THEN
    PERFORM 1
    FROM public.bins b
    WHERE b.id = NEW.source_bin_id
      AND b.company_id = NEW.company_id
      AND b."warehouseId" = NEW.source_warehouse_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'growth_batch_harvest_source_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT *
    INTO v_item
  FROM public.items i
  WHERE i.id = NEW.output_item_id
    AND i.company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_harvest_output_item_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_item.track_inventory, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'growth_batch_harvest_output_item_not_stock_tracked' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(v_item.base_uom_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'growth_batch_harvest_output_item_base_uom_required' USING ERRCODE = '22023';
  END IF;
  IF NEW.output_uom_id IS DISTINCT FROM v_item.base_uom_id THEN
    RAISE EXCEPTION 'growth_batch_harvest_output_uom_mismatch' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.warehouses w
  WHERE w.id = NEW.destination_warehouse_id
    AND w.company_id = NEW.company_id
    AND COALESCE(w.status, 'active') = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_harvest_destination_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.destination_bin_id IS NOT NULL THEN
    PERFORM 1
    FROM public.bins b
    WHERE b.id = NEW.destination_bin_id
      AND b.company_id = NEW.company_id
      AND b."warehouseId" = NEW.destination_warehouse_id
      AND COALESCE(b.status, 'active') = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'growth_batch_harvest_destination_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT *
    INTO v_movement
  FROM public.stock_movements sm
  WHERE sm.id = NEW.stock_receipt_movement_id
    AND sm.company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_harvest_receipt_movement_missing' USING ERRCODE = 'P0001';
  END IF;
  IF v_movement.type <> 'receive'
    OR v_movement.item_id IS DISTINCT FROM NEW.output_item_id
    OR v_movement.uom_id IS DISTINCT FROM NEW.output_uom_id
    OR v_movement.qty_base IS DISTINCT FROM NEW.output_quantity
    OR v_movement.unit_cost IS DISTINCT FROM NEW.output_unit_cost
    OR v_movement.total_value IS DISTINCT FROM NEW.allocated_cost
    OR v_movement.warehouse_to_id IS DISTINCT FROM NEW.destination_warehouse_id
    OR v_movement.bin_to_id IS DISTINCT FROM NEW.destination_bin_id
    OR v_movement.ref_type IS DISTINCT FROM 'GROWTH_BATCH_HARVEST'
    OR v_movement.ref_id IS DISTINCT FROM NEW.event_id::text
    OR v_movement.ref_line_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'growth_batch_harvest_receipt_movement_invalid' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_growth_batch_harvest_reversal_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_reversal_event public.growth_batch_events%ROWTYPE;
  v_original_event public.growth_batch_events%ROWTYPE;
  v_original public.growth_batch_harvests%ROWTYPE;
  v_movement public.stock_movements%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'growth_batch_harvest_reversal_immutable' USING ERRCODE = 'P0001';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'growth_batch_harvest_reversal_immutable' USING ERRCODE = 'P0001';
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
  IF NOT FOUND OR v_reversal_event.event_type <> 'harvest_reversal' THEN
    RAISE EXCEPTION 'growth_batch_harvest_reversal_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_original_event
  FROM public.growth_batch_events
  WHERE id = NEW.original_event_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id;
  IF NOT FOUND OR v_original_event.event_type <> 'harvest' THEN
    RAISE EXCEPTION 'growth_batch_harvest_original_event_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF v_reversal_event.original_event_id IS DISTINCT FROM NEW.original_event_id THEN
    RAISE EXCEPTION 'growth_batch_harvest_reversal_event_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_original
  FROM public.growth_batch_harvests
  WHERE id = NEW.original_harvest_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id
    AND event_id = NEW.original_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_harvest_original_line_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.restored_primary_qty IS DISTINCT FROM v_original.harvested_primary_qty
    OR NEW.primary_uom_id IS DISTINCT FROM v_original.primary_uom_id
    OR NEW.restored_weight IS DISTINCT FROM v_original.harvested_weight
    OR NEW.weight_uom_id IS DISTINCT FROM v_original.weight_uom_id
    OR NEW.allocated_cost_restored IS DISTINCT FROM v_original.allocated_cost
    OR NEW.output_item_id IS DISTINCT FROM v_original.output_item_id
    OR NEW.output_uom_id IS DISTINCT FROM v_original.output_uom_id
    OR NEW.output_quantity IS DISTINCT FROM v_original.output_quantity
    OR NEW.destination_warehouse_id IS DISTINCT FROM v_original.destination_warehouse_id
    OR NEW.destination_bin_id IS DISTINCT FROM v_original.destination_bin_id THEN
    RAISE EXCEPTION 'growth_batch_harvest_reversal_line_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_movement
  FROM public.stock_movements sm
  WHERE sm.id = NEW.stock_issue_movement_id
    AND sm.company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_harvest_reversal_issue_movement_missing' USING ERRCODE = 'P0001';
  END IF;
  IF v_movement.type <> 'issue'
    OR v_movement.item_id IS DISTINCT FROM NEW.output_item_id
    OR v_movement.uom_id IS DISTINCT FROM NEW.output_uom_id
    OR v_movement.qty_base IS DISTINCT FROM NEW.output_quantity
    OR v_movement.unit_cost IS DISTINCT FROM v_original.output_unit_cost
    OR v_movement.total_value IS DISTINCT FROM NEW.allocated_cost_restored
    OR v_movement.warehouse_from_id IS DISTINCT FROM NEW.destination_warehouse_id
    OR v_movement.bin_from_id IS DISTINCT FROM NEW.destination_bin_id
    OR v_movement.ref_type IS DISTINCT FROM 'GROWTH_BATCH_HARVEST_REVERSAL'
    OR v_movement.ref_id IS DISTINCT FROM NEW.reversal_event_id::text
    OR v_movement.ref_line_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'growth_batch_harvest_reversal_issue_movement_invalid' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_growth_batch_harvests_row ON public.growth_batch_harvests;
CREATE TRIGGER validate_growth_batch_harvests_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.growth_batch_harvests
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_harvest_row();

DROP TRIGGER IF EXISTS validate_growth_batch_harvest_reversal_lines_row ON public.growth_batch_harvest_reversal_lines;
CREATE TRIGGER validate_growth_batch_harvest_reversal_lines_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.growth_batch_harvest_reversal_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_harvest_reversal_row();

CREATE OR REPLACE VIEW public.growth_batch_harvest_history WITH (security_invoker = true) AS
SELECT
  h.id,
  h.company_id,
  h.growth_batch_id,
  gb.reference_no AS growth_batch_reference,
  h.event_id,
  e.event_reference,
  e.event_sequence,
  e.event_date AS event_effective_date,
  e.event_at AS event_created_at,
  e.created_by AS actor_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), 'Team member') AS actor_display_name,
  h.harvest_kind,
  h.harvested_primary_qty,
  h.primary_uom_id,
  pu.code AS primary_uom_code,
  h.quantity_before,
  h.quantity_after,
  h.harvested_weight,
  h.weight_uom_id,
  wu.code AS weight_uom_code,
  h.total_weight_before,
  h.total_weight_after,
  h.output_item_id,
  item.sku AS output_item_sku,
  item.name AS output_item_name,
  h.output_uom_id,
  ou.code AS output_uom_code,
  h.output_quantity,
  h.destination_warehouse_id,
  dw.code AS destination_warehouse_code,
  dw.name AS destination_warehouse_name,
  h.destination_bin_id,
  db.code AS destination_bin_code,
  db.name AS destination_bin_name,
  h.allocated_cost,
  h.output_unit_cost,
  h.accumulated_total_cost,
  h.harvested_cost_before,
  h.harvested_cost_after,
  h.remaining_cost_before,
  h.remaining_cost_after,
  h.stock_receipt_movement_id,
  h.source_warehouse_id,
  sw.code AS source_warehouse_code,
  sw.name AS source_warehouse_name,
  h.source_bin_id,
  sb.code AS source_bin_code,
  sb.name AS source_bin_name,
  h.source_location_description,
  h.notes,
  h.created_at,
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
  r.stock_issue_movement_id AS reversal_stock_issue_movement_id,
  NOT EXISTS (
    SELECT 1
    FROM public.growth_batch_events later
    WHERE later.company_id = h.company_id
      AND later.growth_batch_id = h.growth_batch_id
      AND later.event_sequence > e.event_sequence
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
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.growth_batch_events later
    JOIN public.growth_batch_measurements m
      ON m.growth_batch_event_id = later.id
     AND m.company_id = later.company_id
     AND m.growth_batch_id = later.growth_batch_id
    WHERE later.company_id = h.company_id
      AND later.growth_batch_id = h.growth_batch_id
      AND later.event_sequence > e.event_sequence
      AND later.event_type = 'measurement'
      AND m.measurement_type = 'total_weight'
  ) AS is_latest_cost_quantity_weight_event,
  (
    r.id IS NULL
    AND gb.status = 'active'
    AND gb.current_primary_qty IS NOT DISTINCT FROM h.quantity_after
    AND gb.current_total_weight IS NOT DISTINCT FROM h.total_weight_after
    AND gb.harvested_cost IS NOT DISTINCT FROM h.harvested_cost_after
    AND gb.remaining_cost IS NOT DISTINCT FROM h.remaining_cost_after
    AND NOT EXISTS (
      SELECT 1
      FROM public.growth_batch_events later
      WHERE later.company_id = h.company_id
        AND later.growth_batch_id = h.growth_batch_id
        AND later.event_sequence > e.event_sequence
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
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.growth_batch_events later
      JOIN public.growth_batch_measurements m
        ON m.growth_batch_event_id = later.id
       AND m.company_id = later.company_id
       AND m.growth_batch_id = later.growth_batch_id
      WHERE later.company_id = h.company_id
        AND later.growth_batch_id = h.growth_batch_id
        AND later.event_sequence > e.event_sequence
        AND later.event_type = 'measurement'
        AND m.measurement_type = 'total_weight'
    )
  ) AS reversal_eligible
FROM public.growth_batch_harvests h
JOIN public.growth_batches gb ON gb.id = h.growth_batch_id AND gb.company_id = h.company_id
JOIN public.growth_batch_events e
  ON e.id = h.event_id
 AND e.company_id = h.company_id
 AND e.growth_batch_id = h.growth_batch_id
JOIN public.items item ON item.id = h.output_item_id AND item.company_id = h.company_id
LEFT JOIN public.warehouses sw ON sw.id = h.source_warehouse_id AND sw.company_id = h.company_id
LEFT JOIN public.bins sb ON sb.id = h.source_bin_id AND sb.company_id = h.company_id
LEFT JOIN public.warehouses dw ON dw.id = h.destination_warehouse_id AND dw.company_id = h.company_id
LEFT JOIN public.bins db ON db.id = h.destination_bin_id AND db.company_id = h.company_id
LEFT JOIN public.uoms pu ON pu.id = h.primary_uom_id
LEFT JOIN public.uoms wu ON wu.id = h.weight_uom_id
LEFT JOIN public.uoms ou ON ou.id = h.output_uom_id
LEFT JOIN public.profiles p ON p.id = e.created_by
LEFT JOIN public.growth_batch_harvest_reversal_lines r
  ON r.original_harvest_id = h.id
 AND r.company_id = h.company_id
LEFT JOIN public.growth_batch_events re
  ON re.id = r.reversal_event_id
 AND re.company_id = r.company_id
LEFT JOIN public.profiles rp ON rp.id = re.created_by
WHERE h.company_id = public.current_company_id();

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
  COALESCE(si.stock_input_material_cost, 0) AS stock_input_material_cost,
  COALESCE(losses.loss_event_count, 0) AS loss_event_count,
  COALESCE(losses.mortality_event_count, 0) AS mortality_event_count,
  COALESCE(losses.shrinkage_event_count, 0) AS shrinkage_event_count,
  COALESCE(losses.unreversed_loss_event_count, 0) AS unreversed_loss_event_count,
  COALESCE(hv.harvest_event_count, 0) AS harvest_event_count,
  COALESCE(hv.unreversed_harvest_event_count, 0) AS unreversed_harvest_event_count,
  COALESCE(hv.reversed_harvest_event_count, 0) AS reversed_harvest_event_count,
  COALESCE(hv.harvested_output_quantity, 0) AS harvested_output_quantity
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
LEFT JOIN LATERAL (
  SELECT
    count(l.id)::integer AS loss_event_count,
    count(*) FILTER (WHERE l.loss_type = 'mortality')::integer AS mortality_event_count,
    count(*) FILTER (WHERE l.loss_type = 'shrinkage')::integer AS shrinkage_event_count,
    count(*) FILTER (WHERE r.id IS NULL)::integer AS unreversed_loss_event_count
  FROM public.growth_batch_losses l
  LEFT JOIN public.growth_batch_loss_reversal_lines r
    ON r.original_loss_id = l.id
   AND r.company_id = l.company_id
  WHERE l.growth_batch_id = gb.id
    AND l.company_id = gb.company_id
) losses ON true
LEFT JOIN LATERAL (
  SELECT
    count(h.id)::integer AS harvest_event_count,
    count(*) FILTER (WHERE r.id IS NULL)::integer AS unreversed_harvest_event_count,
    count(*) FILTER (WHERE r.id IS NOT NULL)::integer AS reversed_harvest_event_count,
    COALESCE(sum(CASE WHEN r.id IS NULL THEN h.output_quantity ELSE 0 END), 0) AS harvested_output_quantity
  FROM public.growth_batch_harvests h
  LEFT JOIN public.growth_batch_harvest_reversal_lines r
    ON r.original_harvest_id = h.id
   AND r.company_id = h.company_id
  WHERE h.growth_batch_id = gb.id
    AND h.company_id = gb.company_id
) hv ON true
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
  COALESCE(rv.reversed_stock_input_event_count, 0) AS reversed_stock_input_event_count,
  r.loss_event_count,
  r.mortality_event_count,
  r.shrinkage_event_count,
  r.unreversed_loss_event_count,
  COALESCE(lr.reversed_loss_event_count, 0) AS reversed_loss_event_count,
  r.harvest_event_count,
  r.unreversed_harvest_event_count,
  r.reversed_harvest_event_count,
  r.harvested_output_quantity,
  (r.status = 'active' AND COALESCE(r.current_primary_qty, 0) = 0) AS fully_harvested_awaiting_completion
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
) rv ON true
LEFT JOIN LATERAL (
  SELECT count(DISTINCT original_event_id)::integer AS reversed_loss_event_count
  FROM public.growth_batch_loss_reversal_lines rl
  WHERE rl.growth_batch_id = r.id
    AND rl.company_id = r.company_id
) lr ON true;

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
    WHEN 'mortality' THEN 'Mortality recorded'
    WHEN 'shrinkage' THEN 'Shrinkage recorded'
    WHEN 'mortality_reversal' THEN 'Mortality reversed'
    WHEN 'shrinkage_reversal' THEN 'Shrinkage reversed'
    WHEN 'transfer' THEN 'Batch transferred'
    WHEN 'transfer_reversal' THEN 'Transfer reversed'
    WHEN 'harvest' THEN 'Harvest posted'
    WHEN 'harvest_reversal' THEN 'Harvest reversed'
    WHEN 'cancellation' THEN 'Draft cancelled'
    ELSE e.event_type
  END AS event_summary,
  CASE
    WHEN h.id IS NOT NULL THEN jsonb_build_object(
      'harvest_id', h.id,
      'harvest_kind', h.harvest_kind,
      'harvested_primary_qty', h.harvested_primary_qty,
      'primary_uom_id', h.primary_uom_id,
      'primary_uom_code', hpu.code,
      'quantity_before', h.quantity_before,
      'quantity_after', h.quantity_after,
      'harvested_weight', h.harvested_weight,
      'weight_uom_id', h.weight_uom_id,
      'weight_uom_code', hwu.code,
      'output_item_id', h.output_item_id,
      'output_item_name', hi.name,
      'output_quantity', h.output_quantity,
      'output_uom_id', h.output_uom_id,
      'output_uom_code', hou.code,
      'allocated_cost', h.allocated_cost,
      'remaining_cost_after', h.remaining_cost_after,
      'stock_receipt_movement_id', h.stock_receipt_movement_id
    )
    WHEN hr.id IS NOT NULL THEN jsonb_build_object(
      'reversal_line_id', hr.id,
      'original_event_id', hr.original_event_id,
      'original_harvest_id', hr.original_harvest_id,
      'restored_primary_qty', hr.restored_primary_qty,
      'primary_uom_id', hr.primary_uom_id,
      'primary_uom_code', hrpu.code,
      'restored_weight', hr.restored_weight,
      'weight_uom_id', hr.weight_uom_id,
      'weight_uom_code', hrwu.code,
      'allocated_cost_restored', hr.allocated_cost_restored,
      'remaining_cost_after', hr.remaining_cost_after,
      'stock_issue_movement_id', hr.stock_issue_movement_id,
      'reason', hr.reason
    )
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
    WHEN loss.id IS NOT NULL THEN jsonb_build_object(
      'loss_id', loss.id,
      'loss_type', loss.loss_type,
      'quantity_lost', loss.quantity_lost,
      'quantity_uom_id', loss.quantity_uom_id,
      'quantity_uom_code', lqu.code,
      'weight_lost', loss.weight_lost,
      'weight_uom_id', loss.weight_uom_id,
      'weight_uom_code', lwu.code,
      'reason_code', loss.reason_code,
      'quantity_before', loss.quantity_before,
      'quantity_after', loss.quantity_after,
      'total_weight_before', loss.total_weight_before,
      'total_weight_after', loss.total_weight_after
    )
    WHEN loss_reversal.id IS NOT NULL THEN jsonb_build_object(
      'reversal_line_id', loss_reversal.id,
      'original_event_id', loss_reversal.original_event_id,
      'original_loss_id', loss_reversal.original_loss_id,
      'restored_quantity', loss_reversal.restored_quantity,
      'restored_quantity_uom_id', loss_reversal.restored_quantity_uom_id,
      'restored_quantity_uom_code', rqu.code,
      'restored_weight', loss_reversal.restored_weight,
      'restored_weight_uom_id', loss_reversal.restored_weight_uom_id,
      'restored_weight_uom_code', rwu.code,
      'quantity_before', loss_reversal.quantity_before,
      'quantity_after', loss_reversal.quantity_after,
      'total_weight_before', loss_reversal.total_weight_before,
      'total_weight_after', loss_reversal.total_weight_after
    )
    WHEN transfer.id IS NOT NULL THEN jsonb_build_object(
      'transfer_id', transfer.id,
      'source_warehouse_id', transfer.source_warehouse_id,
      'source_bin_id', transfer.source_bin_id,
      'source_location_description', transfer.source_location_description,
      'destination_warehouse_id', transfer.destination_warehouse_id,
      'destination_bin_id', transfer.destination_bin_id,
      'destination_location_description', transfer.destination_location_description,
      'current_primary_qty', transfer.current_primary_qty,
      'primary_uom_id', transfer.primary_uom_id,
      'primary_uom_code', tpu.code,
      'current_total_weight', transfer.current_total_weight,
      'weight_uom_id', transfer.weight_uom_id,
      'weight_uom_code', twu.code,
      'transfer_reason', transfer.transfer_reason
    )
    WHEN transfer_reversal.id IS NOT NULL THEN jsonb_build_object(
      'reversal_line_id', transfer_reversal.id,
      'original_event_id', transfer_reversal.original_event_id,
      'original_transfer_id', transfer_reversal.original_transfer_id,
      'reversal_source_warehouse_id', transfer_reversal.reversal_source_warehouse_id,
      'reversal_source_bin_id', transfer_reversal.reversal_source_bin_id,
      'reversal_source_location_description', transfer_reversal.reversal_source_location_description,
      'reversal_destination_warehouse_id', transfer_reversal.reversal_destination_warehouse_id,
      'reversal_destination_bin_id', transfer_reversal.reversal_destination_bin_id,
      'reversal_destination_location_description', transfer_reversal.reversal_destination_location_description,
      'current_primary_qty', transfer_reversal.current_primary_qty,
      'primary_uom_id', transfer_reversal.primary_uom_id,
      'primary_uom_code', trpu.code,
      'current_total_weight', transfer_reversal.current_total_weight,
      'weight_uom_id', transfer_reversal.weight_uom_id,
      'weight_uom_code', trwu.code,
      'reason', transfer_reversal.reason
    )
    ELSE '{}'::jsonb
  END AS typed_detail_summary,
  e.original_event_id
FROM public.growth_batch_events e
LEFT JOIN public.growth_batch_harvests h
  ON h.event_id = e.id
 AND h.company_id = e.company_id
LEFT JOIN public.growth_batch_harvest_reversal_lines hr
  ON hr.reversal_event_id = e.id
 AND hr.company_id = e.company_id
LEFT JOIN public.items hi ON hi.id = h.output_item_id AND hi.company_id = h.company_id
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
LEFT JOIN public.growth_batch_losses loss
  ON loss.event_id = e.id
 AND loss.company_id = e.company_id
LEFT JOIN public.growth_batch_loss_reversal_lines loss_reversal
  ON loss_reversal.reversal_event_id = e.id
 AND loss_reversal.company_id = e.company_id
LEFT JOIN public.growth_batch_transfers transfer
  ON transfer.event_id = e.id
 AND transfer.company_id = e.company_id
LEFT JOIN public.growth_batch_transfer_reversal_lines transfer_reversal
  ON transfer_reversal.reversal_event_id = e.id
 AND transfer_reversal.company_id = e.company_id
LEFT JOIN public.uoms wu ON wu.id = e.weight_uom_id
LEFT JOIN public.uoms hpu ON hpu.id = h.primary_uom_id
LEFT JOIN public.uoms hwu ON hwu.id = h.weight_uom_id
LEFT JOIN public.uoms hou ON hou.id = h.output_uom_id
LEFT JOIN public.uoms hrpu ON hrpu.id = hr.primary_uom_id
LEFT JOIN public.uoms hrwu ON hrwu.id = hr.weight_uom_id
LEFT JOIN public.uoms mu ON mu.id = m.uom_id
LEFT JOIN public.uoms lqu ON lqu.id = loss.quantity_uom_id
LEFT JOIN public.uoms lwu ON lwu.id = loss.weight_uom_id
LEFT JOIN public.uoms rqu ON rqu.id = loss_reversal.restored_quantity_uom_id
LEFT JOIN public.uoms rwu ON rwu.id = loss_reversal.restored_weight_uom_id
LEFT JOIN public.uoms tpu ON tpu.id = transfer.primary_uom_id
LEFT JOIN public.uoms twu ON twu.id = transfer.weight_uom_id
LEFT JOIN public.uoms trpu ON trpu.id = transfer_reversal.primary_uom_id
LEFT JOIN public.uoms trwu ON trwu.id = transfer_reversal.weight_uom_id
LEFT JOIN public.profiles p ON p.id = e.created_by
WHERE e.company_id = public.current_company_id();

ALTER FUNCTION public.validate_growth_batch_event_row() OWNER TO postgres;
ALTER FUNCTION public.validate_growth_batch_harvest_row() OWNER TO postgres;
ALTER FUNCTION public.validate_growth_batch_harvest_reversal_row() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_growth_batch_event_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_growth_batch_harvest_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_growth_batch_harvest_reversal_row() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.growth_batch_harvests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_harvest_reversal_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.growth_batch_harvests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_harvest_reversal_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY growth_batch_harvests_select_active_company
  ON public.growth_batch_harvests
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

CREATE POLICY growth_batch_harvest_reversals_select_active_company
  ON public.growth_batch_harvest_reversal_lines
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

REVOKE ALL ON public.growth_batch_harvests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_harvest_reversal_lines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batches_register FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_current_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_event_timeline FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_harvest_history FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.growth_batch_harvests TO authenticated;
GRANT SELECT ON public.growth_batch_harvest_reversal_lines TO authenticated;
GRANT SELECT ON public.growth_batches_register TO authenticated;
GRANT SELECT ON public.growth_batch_current_state TO authenticated;
GRANT SELECT ON public.growth_batch_event_timeline TO authenticated;
GRANT SELECT ON public.growth_batch_harvest_history TO authenticated;

GRANT ALL ON public.growth_batch_harvests TO service_role;
GRANT ALL ON public.growth_batch_harvest_reversal_lines TO service_role;
GRANT SELECT ON public.growth_batches_register TO service_role;
GRANT SELECT ON public.growth_batch_current_state TO service_role;
GRANT SELECT ON public.growth_batch_event_timeline TO service_role;
GRANT SELECT ON public.growth_batch_harvest_history TO service_role;

COMMENT ON TABLE public.growth_batch_harvests IS
  'Immutable G5.1 governed depleting harvest detail ledger. Harvests reduce batch quantity, optionally weight, move remaining cost into harvested cost, and post one stock receipt.';
COMMENT ON TABLE public.growth_batch_harvest_reversal_lines IS
  'Immutable G5.1 event-specific harvest reversal details. Reversals restore the original frozen quantity, weight, and cost allocation and post one compensating stock issue.';
COMMENT ON VIEW public.growth_batch_harvest_history IS
  'Read model for G5.1 harvest events, output receipt movements, reversal state, and reversal eligibility.';
