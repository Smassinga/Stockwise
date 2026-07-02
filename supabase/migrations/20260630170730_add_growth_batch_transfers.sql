-- Growth Batches G4.2 transfer schema, immutable transfer ledgers, and read models.
-- This migration adds full-batch operational location transfer event structure only.
-- Posting logic is added in the paired *_add_growth_batch_transfer_posting.sql migration.

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
      'transfer_reversal'
    )
  );

ALTER TABLE public.growth_batch_events
  DROP CONSTRAINT IF EXISTS growth_batch_events_original_event_for_reversal;

ALTER TABLE public.growth_batch_events
  ADD CONSTRAINT growth_batch_events_original_event_for_reversal CHECK (
    (
      event_type IN ('stock_input_reversal', 'mortality_reversal', 'shrinkage_reversal', 'transfer_reversal')
      AND original_event_id IS NOT NULL
    )
    OR (
      event_type NOT IN ('stock_input_reversal', 'mortality_reversal', 'shrinkage_reversal', 'transfer_reversal')
      AND original_event_id IS NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS growth_batch_events_one_transfer_reversal_idx
  ON public.growth_batch_events(original_event_id)
  WHERE event_type = 'transfer_reversal'
    AND original_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.growth_batch_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE CASCADE,
  source_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  source_bin_id text REFERENCES public.bins(id) ON DELETE RESTRICT,
  source_location_description text,
  destination_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  destination_bin_id text REFERENCES public.bins(id) ON DELETE RESTRICT,
  destination_location_description text,
  primary_quantity_basis text NOT NULL,
  current_primary_qty numeric NOT NULL,
  primary_uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  current_total_weight numeric,
  weight_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  area numeric,
  area_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  accumulated_material_cost numeric NOT NULL,
  accumulated_direct_cost numeric NOT NULL,
  accumulated_total_cost numeric NOT NULL,
  harvested_cost numeric NOT NULL,
  remaining_cost numeric NOT NULL,
  transfer_reason text NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_transfers_event_unique UNIQUE (event_id),
  CONSTRAINT growth_batch_transfers_quantity_basis_check CHECK (
    primary_quantity_basis IN ('count', 'weight', 'area', 'other')
  ),
  CONSTRAINT growth_batch_transfers_quantity_positive CHECK (current_primary_qty > 0),
  CONSTRAINT growth_batch_transfers_count_qty_whole CHECK (
    primary_quantity_basis <> 'count' OR current_primary_qty = trunc(current_primary_qty)
  ),
  CONSTRAINT growth_batch_transfers_weight_nonnegative CHECK (current_total_weight IS NULL OR current_total_weight >= 0),
  CONSTRAINT growth_batch_transfers_weight_uom_consistent CHECK (
    (current_total_weight IS NULL AND weight_uom_id IS NULL)
    OR (current_total_weight IS NOT NULL AND weight_uom_id IS NOT NULL)
  ),
  CONSTRAINT growth_batch_transfers_area_nonnegative CHECK (area IS NULL OR area >= 0),
  CONSTRAINT growth_batch_transfers_area_uom_consistent CHECK (
    (area IS NULL AND area_uom_id IS NULL)
    OR (area IS NOT NULL AND area_uom_id IS NOT NULL)
  ),
  CONSTRAINT growth_batch_transfers_costs_nonnegative CHECK (
    accumulated_material_cost >= 0
    AND accumulated_direct_cost >= 0
    AND accumulated_total_cost >= 0
    AND harvested_cost >= 0
    AND remaining_cost >= 0
  ),
  CONSTRAINT growth_batch_transfers_cost_total_consistent CHECK (
    accumulated_total_cost = accumulated_material_cost + accumulated_direct_cost
  ),
  CONSTRAINT growth_batch_transfers_remaining_cost_consistent CHECK (
    remaining_cost = accumulated_total_cost - harvested_cost
  ),
  CONSTRAINT growth_batch_transfers_harvest_not_over_total CHECK (harvested_cost <= accumulated_total_cost),
  CONSTRAINT growth_batch_transfers_reason_check CHECK (
    transfer_reason IN (
      'operational_move',
      'space_management',
      'biosecurity',
      'environment',
      'maintenance',
      'consolidation',
      'other'
    )
  ),
  CONSTRAINT growth_batch_transfers_other_notes_required CHECK (
    transfer_reason <> 'other' OR NULLIF(btrim(COALESCE(notes, '')), '') IS NOT NULL
  ),
  CONSTRAINT growth_batch_transfers_distinct_location CHECK (
    (
      source_warehouse_id,
      source_bin_id,
      NULLIF(btrim(COALESCE(source_location_description, '')), '')
    ) IS DISTINCT FROM (
      destination_warehouse_id,
      destination_bin_id,
      NULLIF(btrim(COALESCE(destination_location_description, '')), '')
    )
  )
);

CREATE TABLE IF NOT EXISTS public.growth_batch_transfer_reversal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  reversal_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE CASCADE,
  original_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE RESTRICT,
  original_transfer_id uuid NOT NULL REFERENCES public.growth_batch_transfers(id) ON DELETE RESTRICT,
  reversal_source_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  reversal_source_bin_id text REFERENCES public.bins(id) ON DELETE RESTRICT,
  reversal_source_location_description text,
  reversal_destination_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  reversal_destination_bin_id text REFERENCES public.bins(id) ON DELETE RESTRICT,
  reversal_destination_location_description text,
  primary_quantity_basis text NOT NULL,
  current_primary_qty numeric NOT NULL,
  primary_uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  current_total_weight numeric,
  weight_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  area numeric,
  area_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  accumulated_material_cost numeric NOT NULL,
  accumulated_direct_cost numeric NOT NULL,
  accumulated_total_cost numeric NOT NULL,
  harvested_cost numeric NOT NULL,
  remaining_cost numeric NOT NULL,
  reason text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_transfer_reversal_event_unique UNIQUE (reversal_event_id),
  CONSTRAINT growth_batch_transfer_reversal_original_unique UNIQUE (original_transfer_id),
  CONSTRAINT growth_batch_transfer_reversal_quantity_basis_check CHECK (
    primary_quantity_basis IN ('count', 'weight', 'area', 'other')
  ),
  CONSTRAINT growth_batch_transfer_reversal_quantity_positive CHECK (current_primary_qty > 0),
  CONSTRAINT growth_batch_transfer_reversal_count_qty_whole CHECK (
    primary_quantity_basis <> 'count' OR current_primary_qty = trunc(current_primary_qty)
  ),
  CONSTRAINT growth_batch_transfer_reversal_weight_nonnegative CHECK (current_total_weight IS NULL OR current_total_weight >= 0),
  CONSTRAINT growth_batch_transfer_reversal_weight_uom_consistent CHECK (
    (current_total_weight IS NULL AND weight_uom_id IS NULL)
    OR (current_total_weight IS NOT NULL AND weight_uom_id IS NOT NULL)
  ),
  CONSTRAINT growth_batch_transfer_reversal_area_nonnegative CHECK (area IS NULL OR area >= 0),
  CONSTRAINT growth_batch_transfer_reversal_area_uom_consistent CHECK (
    (area IS NULL AND area_uom_id IS NULL)
    OR (area IS NOT NULL AND area_uom_id IS NOT NULL)
  ),
  CONSTRAINT growth_batch_transfer_reversal_costs_nonnegative CHECK (
    accumulated_material_cost >= 0
    AND accumulated_direct_cost >= 0
    AND accumulated_total_cost >= 0
    AND harvested_cost >= 0
    AND remaining_cost >= 0
  ),
  CONSTRAINT growth_batch_transfer_reversal_cost_total_consistent CHECK (
    accumulated_total_cost = accumulated_material_cost + accumulated_direct_cost
  ),
  CONSTRAINT growth_batch_transfer_reversal_remaining_cost_consistent CHECK (
    remaining_cost = accumulated_total_cost - harvested_cost
  ),
  CONSTRAINT growth_batch_transfer_reversal_harvest_not_over_total CHECK (harvested_cost <= accumulated_total_cost),
  CONSTRAINT growth_batch_transfer_reversal_reason_required CHECK (
    NULLIF(btrim(COALESCE(reason, '')), '') IS NOT NULL
  ),
  CONSTRAINT growth_batch_transfer_reversal_distinct_location CHECK (
    (
      reversal_source_warehouse_id,
      reversal_source_bin_id,
      NULLIF(btrim(COALESCE(reversal_source_location_description, '')), '')
    ) IS DISTINCT FROM (
      reversal_destination_warehouse_id,
      reversal_destination_bin_id,
      NULLIF(btrim(COALESCE(reversal_destination_location_description, '')), '')
    )
  )
);

CREATE INDEX IF NOT EXISTS growth_batch_transfers_company_batch_idx
  ON public.growth_batch_transfers(company_id, growth_batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_batch_transfers_original_location_idx
  ON public.growth_batch_transfers(company_id, source_warehouse_id, source_bin_id);
CREATE INDEX IF NOT EXISTS growth_batch_transfers_destination_location_idx
  ON public.growth_batch_transfers(company_id, destination_warehouse_id, destination_bin_id);

CREATE INDEX IF NOT EXISTS growth_batch_transfer_reversal_company_batch_idx
  ON public.growth_batch_transfer_reversal_lines(company_id, growth_batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_batch_transfer_reversal_original_event_idx
  ON public.growth_batch_transfer_reversal_lines(original_event_id);

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

    IF NEW.event_type IN ('stock_input_reversal', 'mortality_reversal', 'shrinkage_reversal', 'transfer_reversal') THEN
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

CREATE OR REPLACE FUNCTION public.validate_growth_batch_transfer_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_event public.growth_batch_events%ROWTYPE;
  v_batch public.growth_batches%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'growth_batch_transfer_immutable' USING ERRCODE = 'P0001';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'growth_batch_transfer_immutable' USING ERRCODE = 'P0001';
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
  IF NOT FOUND OR v_event.event_type <> 'transfer' THEN
    RAISE EXCEPTION 'growth_batch_transfer_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = NEW.growth_batch_id
    AND company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.primary_quantity_basis IS DISTINCT FROM v_batch.primary_quantity_basis
    OR NEW.primary_uom_id IS DISTINCT FROM v_batch.primary_uom_id
    OR NEW.weight_uom_id IS DISTINCT FROM v_batch.weight_uom_id
    OR NEW.area_uom_id IS DISTINCT FROM v_batch.area_uom_id THEN
    RAISE EXCEPTION 'growth_batch_transfer_snapshot_uom_mismatch' USING ERRCODE = '22023';
  END IF;

  IF NEW.primary_quantity_basis = 'count' AND NEW.current_primary_qty <> trunc(NEW.current_primary_qty) THEN
    RAISE EXCEPTION 'fractional_count_not_allowed' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.warehouses w
  WHERE w.id = NEW.source_warehouse_id
    AND w.company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_transfer_source_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.source_bin_id IS NOT NULL THEN
    PERFORM 1
    FROM public.bins b
    WHERE b.id = NEW.source_bin_id
      AND b.company_id = NEW.company_id
      AND b."warehouseId" = NEW.source_warehouse_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'growth_batch_transfer_source_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  PERFORM 1
  FROM public.warehouses w
  WHERE w.id = NEW.destination_warehouse_id
    AND w.company_id = NEW.company_id
    AND COALESCE(w.status, 'active') = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_transfer_destination_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.destination_bin_id IS NOT NULL THEN
    PERFORM 1
    FROM public.bins b
    WHERE b.id = NEW.destination_bin_id
      AND b.company_id = NEW.company_id
      AND b."warehouseId" = NEW.destination_warehouse_id
      AND COALESCE(b.status, 'active') = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'growth_batch_transfer_destination_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_growth_batch_transfer_reversal_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_reversal_event public.growth_batch_events%ROWTYPE;
  v_original_event public.growth_batch_events%ROWTYPE;
  v_original_transfer public.growth_batch_transfers%ROWTYPE;
  v_batch public.growth_batches%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'growth_batch_transfer_reversal_immutable' USING ERRCODE = 'P0001';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'growth_batch_transfer_reversal_immutable' USING ERRCODE = 'P0001';
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
  IF NOT FOUND OR v_reversal_event.event_type <> 'transfer_reversal' THEN
    RAISE EXCEPTION 'growth_batch_transfer_reversal_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_original_event
  FROM public.growth_batch_events
  WHERE id = NEW.original_event_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id;
  IF NOT FOUND OR v_original_event.event_type <> 'transfer' THEN
    RAISE EXCEPTION 'growth_batch_transfer_original_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_reversal_event.original_event_id IS DISTINCT FROM NEW.original_event_id THEN
    RAISE EXCEPTION 'growth_batch_transfer_reversal_event_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_original_transfer
  FROM public.growth_batch_transfers
  WHERE id = NEW.original_transfer_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id
    AND event_id = NEW.original_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_transfer_original_line_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = NEW.growth_batch_id
    AND company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.reversal_source_warehouse_id IS DISTINCT FROM v_original_transfer.destination_warehouse_id
    OR NEW.reversal_source_bin_id IS DISTINCT FROM v_original_transfer.destination_bin_id
    OR NULLIF(btrim(COALESCE(NEW.reversal_source_location_description, '')), '') IS DISTINCT FROM NULLIF(btrim(COALESCE(v_original_transfer.destination_location_description, '')), '')
    OR NEW.reversal_destination_warehouse_id IS DISTINCT FROM v_original_transfer.source_warehouse_id
    OR NEW.reversal_destination_bin_id IS DISTINCT FROM v_original_transfer.source_bin_id
    OR NULLIF(btrim(COALESCE(NEW.reversal_destination_location_description, '')), '') IS DISTINCT FROM NULLIF(btrim(COALESCE(v_original_transfer.source_location_description, '')), '') THEN
    RAISE EXCEPTION 'growth_batch_transfer_reversal_line_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.primary_quantity_basis IS DISTINCT FROM v_batch.primary_quantity_basis
    OR NEW.primary_uom_id IS DISTINCT FROM v_batch.primary_uom_id
    OR NEW.weight_uom_id IS DISTINCT FROM v_batch.weight_uom_id
    OR NEW.area_uom_id IS DISTINCT FROM v_batch.area_uom_id THEN
    RAISE EXCEPTION 'growth_batch_transfer_reversal_snapshot_uom_mismatch' USING ERRCODE = '22023';
  END IF;

  IF NEW.primary_quantity_basis = 'count' AND NEW.current_primary_qty <> trunc(NEW.current_primary_qty) THEN
    RAISE EXCEPTION 'fractional_count_not_allowed' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.warehouses w
  WHERE w.id = NEW.reversal_destination_warehouse_id
    AND w.company_id = NEW.company_id
    AND COALESCE(w.status, 'active') = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_transfer_reversal_destination_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.reversal_destination_bin_id IS NOT NULL THEN
    PERFORM 1
    FROM public.bins b
    WHERE b.id = NEW.reversal_destination_bin_id
      AND b.company_id = NEW.company_id
      AND b."warehouseId" = NEW.reversal_destination_warehouse_id
      AND COALESCE(b.status, 'active') = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'growth_batch_transfer_reversal_destination_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_growth_batch_transfers_row ON public.growth_batch_transfers;
CREATE TRIGGER validate_growth_batch_transfers_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.growth_batch_transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_transfer_row();

DROP TRIGGER IF EXISTS validate_growth_batch_transfer_reversal_lines_row ON public.growth_batch_transfer_reversal_lines;
CREATE TRIGGER validate_growth_batch_transfer_reversal_lines_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.growth_batch_transfer_reversal_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_transfer_reversal_row();

REVOKE ALL ON FUNCTION public.validate_growth_batch_transfer_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_growth_batch_transfer_reversal_row() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.growth_batch_transfer_history WITH (security_invoker = true) AS
SELECT
  t.id,
  t.company_id,
  t.growth_batch_id,
  gb.reference_no AS growth_batch_reference,
  t.event_id,
  e.event_reference,
  e.event_sequence,
  e.event_date AS event_effective_date,
  e.event_at AS event_created_at,
  e.created_by AS actor_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), 'Team member') AS actor_display_name,
  t.source_warehouse_id,
  sw.code AS source_warehouse_code,
  sw.name AS source_warehouse_name,
  t.source_bin_id,
  sb.code AS source_bin_code,
  sb.name AS source_bin_name,
  t.source_location_description,
  t.destination_warehouse_id,
  dw.code AS destination_warehouse_code,
  dw.name AS destination_warehouse_name,
  t.destination_bin_id,
  db.code AS destination_bin_code,
  db.name AS destination_bin_name,
  t.destination_location_description,
  t.primary_quantity_basis,
  t.current_primary_qty,
  t.primary_uom_id,
  pu.code AS primary_uom_code,
  t.current_total_weight,
  t.weight_uom_id,
  wu.code AS weight_uom_code,
  t.area,
  t.area_uom_id,
  au.code AS area_uom_code,
  t.accumulated_material_cost,
  t.accumulated_direct_cost,
  t.accumulated_total_cost,
  t.harvested_cost,
  t.remaining_cost,
  t.transfer_reason,
  t.notes,
  t.created_at,
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
  NOT EXISTS (
    SELECT 1
    FROM public.growth_batch_events later
    WHERE later.company_id = t.company_id
      AND later.growth_batch_id = t.growth_batch_id
      AND later.event_sequence > e.event_sequence
      AND later.event_type IN ('transfer', 'transfer_reversal')
  ) AS is_latest_location_event,
  (
    gb.warehouse_id IS NOT DISTINCT FROM t.destination_warehouse_id
    AND gb.bin_id IS NOT DISTINCT FROM t.destination_bin_id
    AND NULLIF(btrim(COALESCE(gb.location_description, '')), '') IS NOT DISTINCT FROM NULLIF(btrim(COALESCE(t.destination_location_description, '')), '')
  ) AS current_location_matches_destination,
  (COALESCE(sw.status, 'active') = 'active') AS source_warehouse_active,
  (t.source_bin_id IS NULL OR COALESCE(sb.status, 'active') = 'active') AS source_bin_active,
  (
    r.id IS NULL
    AND gb.status = 'active'
    AND COALESCE(gb.current_primary_qty, gb.opening_primary_qty) > 0
    AND gb.warehouse_id IS NOT DISTINCT FROM t.destination_warehouse_id
    AND gb.bin_id IS NOT DISTINCT FROM t.destination_bin_id
    AND NULLIF(btrim(COALESCE(gb.location_description, '')), '') IS NOT DISTINCT FROM NULLIF(btrim(COALESCE(t.destination_location_description, '')), '')
    AND COALESCE(sw.status, 'active') = 'active'
    AND (t.source_bin_id IS NULL OR COALESCE(sb.status, 'active') = 'active')
    AND NOT EXISTS (
      SELECT 1
      FROM public.growth_batch_events later
      WHERE later.company_id = t.company_id
        AND later.growth_batch_id = t.growth_batch_id
        AND later.event_sequence > e.event_sequence
        AND later.event_type IN ('transfer', 'transfer_reversal')
    )
  ) AS reversal_eligible
FROM public.growth_batch_transfers t
JOIN public.growth_batches gb ON gb.id = t.growth_batch_id AND gb.company_id = t.company_id
JOIN public.growth_batch_events e
  ON e.id = t.event_id
 AND e.company_id = t.company_id
 AND e.growth_batch_id = t.growth_batch_id
LEFT JOIN public.warehouses sw ON sw.id = t.source_warehouse_id AND sw.company_id = t.company_id
LEFT JOIN public.bins sb ON sb.id = t.source_bin_id AND sb.company_id = t.company_id
LEFT JOIN public.warehouses dw ON dw.id = t.destination_warehouse_id AND dw.company_id = t.company_id
LEFT JOIN public.bins db ON db.id = t.destination_bin_id AND db.company_id = t.company_id
LEFT JOIN public.uoms pu ON pu.id = t.primary_uom_id
LEFT JOIN public.uoms wu ON wu.id = t.weight_uom_id
LEFT JOIN public.uoms au ON au.id = t.area_uom_id
LEFT JOIN public.profiles p ON p.id = e.created_by
LEFT JOIN public.growth_batch_transfer_reversal_lines r
  ON r.original_transfer_id = t.id
 AND r.company_id = t.company_id
LEFT JOIN public.growth_batch_events re
  ON re.id = r.reversal_event_id
 AND re.company_id = r.company_id
LEFT JOIN public.profiles rp ON rp.id = re.created_by
WHERE t.company_id = public.current_company_id();

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

ALTER TABLE public.growth_batch_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_transfer_reversal_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.growth_batch_transfers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_transfer_reversal_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY growth_batch_transfers_select_active_company
  ON public.growth_batch_transfers
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

CREATE POLICY growth_batch_transfer_reversals_select_active_company
  ON public.growth_batch_transfer_reversal_lines
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

REVOKE ALL ON public.growth_batch_transfers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_transfer_reversal_lines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_transfer_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_event_timeline FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.growth_batch_transfers TO authenticated;
GRANT SELECT ON public.growth_batch_transfer_reversal_lines TO authenticated;
GRANT SELECT ON public.growth_batch_transfer_history TO authenticated;
GRANT SELECT ON public.growth_batch_event_timeline TO authenticated;

GRANT ALL ON public.growth_batch_transfers TO service_role;
GRANT ALL ON public.growth_batch_transfer_reversal_lines TO service_role;
GRANT SELECT ON public.growth_batch_transfer_history TO service_role;
GRANT SELECT ON public.growth_batch_event_timeline TO service_role;

COMMENT ON TABLE public.growth_batch_transfers IS
  'Immutable G4.2 full-batch operational location transfer ledger. Transfers move the whole active Growth Batch between canonical company locations and create no stock or finance rows.';
COMMENT ON TABLE public.growth_batch_transfer_reversal_lines IS
  'Immutable G4.2 event-specific transfer reversal details. Reversals move the whole current batch back to the original active source location without restoring old quantities, weights, or costs.';
COMMENT ON VIEW public.growth_batch_transfer_history IS
  'Read model for G4.2 transfer events and their event-specific reversals, one row per original transfer.';
