-- Growth Batches G5.2 completion lifecycle event structure.
-- Posting logic is added in the paired *_add_growth_batch_completion_posting.sql migration.

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
      'harvest_reversal',
      'completion',
      'completion_reversal'
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
        'harvest_reversal',
        'completion_reversal'
      )
      AND original_event_id IS NOT NULL
    )
    OR (
      event_type NOT IN (
        'stock_input_reversal',
        'mortality_reversal',
        'shrinkage_reversal',
        'transfer_reversal',
        'harvest_reversal',
        'completion_reversal'
      )
      AND original_event_id IS NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS growth_batch_events_one_completion_reversal_idx
  ON public.growth_batch_events(original_event_id)
  WHERE event_type = 'completion_reversal'
    AND original_event_id IS NOT NULL;

ALTER TABLE public.growth_batches
  DROP CONSTRAINT IF EXISTS growth_batches_completed_requires_actor;

ALTER TABLE public.growth_batches
  ADD CONSTRAINT growth_batches_completed_requires_actor CHECK (
    status <> 'completed'
    OR (completed_by IS NOT NULL AND completed_at IS NOT NULL)
  );

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
      'harvest_reversal',
      'completion_reversal'
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
        WHEN 'completion_reversal' THEN 'completion'
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
  v_completion_guard boolean := COALESCE(current_setting('stockwise.growth_batch_completion_update', true), '') = 'on';
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
      IF (
        (NEW.status IS DISTINCT FROM OLD.status AND (NOT v_completion_guard OR NEW.status <> 'completed'))
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
        OR (
          current_setting('stockwise.growth_batch_harvest_update', true) IS DISTINCT FROM 'on'
          AND (
            NEW.harvested_cost IS DISTINCT FROM OLD.harvested_cost
            OR (
              NEW.remaining_cost IS DISTINCT FROM OLD.remaining_cost
              AND NEW.accumulated_total_cost IS NOT DISTINCT FROM OLD.accumulated_total_cost
            )
          )
        )
        OR NEW.notes IS DISTINCT FROM OLD.notes
        OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason
        OR NEW.completion_notes IS DISTINCT FROM OLD.completion_notes
        OR NEW.activated_by IS DISTINCT FROM OLD.activated_by
        OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
        OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
        OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
        OR (NEW.completed_by IS DISTINCT FROM OLD.completed_by AND NOT v_completion_guard)
        OR (NEW.completed_at IS DISTINCT FROM OLD.completed_at AND NOT v_completion_guard)
      ) THEN
        RAISE EXCEPTION 'growth_batch_immutable' USING ERRCODE = 'P0001';
      END IF;
    ELSIF OLD.status = 'completed' THEN
      IF (
        NOT v_completion_guard
        OR NEW.status <> 'active'
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
        OR NEW.current_total_weight IS DISTINCT FROM OLD.current_total_weight
        OR NEW.weight_uom_id IS DISTINCT FROM OLD.weight_uom_id
        OR NEW.area IS DISTINCT FROM OLD.area
        OR NEW.area_uom_id IS DISTINCT FROM OLD.area_uom_id
        OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
        OR NEW.bin_id IS DISTINCT FROM OLD.bin_id
        OR NEW.location_description IS DISTINCT FROM OLD.location_description
        OR NEW.base_currency_code IS DISTINCT FROM OLD.base_currency_code
        OR NEW.accumulated_material_cost IS DISTINCT FROM OLD.accumulated_material_cost
        OR NEW.accumulated_direct_cost IS DISTINCT FROM OLD.accumulated_direct_cost
        OR NEW.accumulated_total_cost IS DISTINCT FROM OLD.accumulated_total_cost
        OR NEW.harvested_cost IS DISTINCT FROM OLD.harvested_cost
        OR NEW.remaining_cost IS DISTINCT FROM OLD.remaining_cost
        OR NEW.notes IS DISTINCT FROM OLD.notes
        OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason
        OR NEW.completion_notes IS DISTINCT FROM OLD.completion_notes
        OR NEW.activated_by IS DISTINCT FROM OLD.activated_by
        OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
        OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
        OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
      ) THEN
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

CREATE TABLE IF NOT EXISTS public.growth_batch_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE CASCADE,
  event_sequence integer NOT NULL,
  event_reference text NOT NULL,
  status_before text NOT NULL,
  status_after text NOT NULL,
  current_primary_qty numeric NOT NULL,
  primary_uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  current_total_weight numeric,
  weight_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  accumulated_material_cost numeric NOT NULL,
  accumulated_direct_cost numeric NOT NULL,
  accumulated_total_cost numeric NOT NULL,
  harvested_cost numeric NOT NULL,
  remaining_cost numeric NOT NULL,
  source_state_fingerprint text NOT NULL,
  completion_reason text NOT NULL,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_completions_event_unique UNIQUE (event_id),
  CONSTRAINT growth_batch_completions_event_reference_unique UNIQUE (company_id, event_reference),
  CONSTRAINT growth_batch_completions_status_check CHECK (status_before = 'active' AND status_after = 'completed'),
  CONSTRAINT growth_batch_completions_quantity_zero CHECK (current_primary_qty = 0),
  CONSTRAINT growth_batch_completions_weight_zero CHECK (current_total_weight IS NULL OR current_total_weight = 0),
  CONSTRAINT growth_batch_completions_weight_uom_consistent CHECK (
    (current_total_weight IS NULL AND weight_uom_id IS NULL)
    OR (current_total_weight IS NOT NULL AND weight_uom_id IS NOT NULL)
  ),
  CONSTRAINT growth_batch_completions_costs_nonnegative CHECK (
    accumulated_material_cost >= 0
    AND accumulated_direct_cost >= 0
    AND accumulated_total_cost >= 0
    AND harvested_cost >= 0
    AND remaining_cost = 0
  ),
  CONSTRAINT growth_batch_completions_cost_consistent CHECK (
    accumulated_total_cost = round((accumulated_material_cost + accumulated_direct_cost)::numeric, 6)
    AND accumulated_total_cost = round((harvested_cost + remaining_cost)::numeric, 6)
  ),
  CONSTRAINT growth_batch_completions_reason_required CHECK (
    NULLIF(btrim(COALESCE(completion_reason, '')), '') IS NOT NULL
  ),
  CONSTRAINT growth_batch_completions_sequence_positive CHECK (event_sequence > 0)
);

CREATE TABLE IF NOT EXISTS public.growth_batch_completion_reversal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  reversal_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE CASCADE,
  original_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE RESTRICT,
  original_completion_id uuid NOT NULL REFERENCES public.growth_batch_completions(id) ON DELETE RESTRICT,
  event_sequence integer NOT NULL,
  event_reference text NOT NULL,
  status_before text NOT NULL,
  status_after text NOT NULL,
  restored_status text NOT NULL,
  current_primary_qty numeric NOT NULL,
  primary_uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  current_total_weight numeric,
  weight_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  accumulated_material_cost numeric NOT NULL,
  accumulated_direct_cost numeric NOT NULL,
  accumulated_total_cost numeric NOT NULL,
  harvested_cost numeric NOT NULL,
  remaining_cost numeric NOT NULL,
  source_state_fingerprint text,
  reversal_reason text NOT NULL,
  reversed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reversed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_completion_reversal_event_unique UNIQUE (reversal_event_id),
  CONSTRAINT growth_batch_completion_reversal_original_unique UNIQUE (original_completion_id),
  CONSTRAINT growth_batch_completion_reversal_event_reference_unique UNIQUE (company_id, event_reference),
  CONSTRAINT growth_batch_completion_reversal_status_check CHECK (
    status_before = 'completed'
    AND status_after = 'active'
    AND restored_status = 'active'
  ),
  CONSTRAINT growth_batch_completion_reversal_quantity_zero CHECK (current_primary_qty = 0),
  CONSTRAINT growth_batch_completion_reversal_weight_zero CHECK (current_total_weight IS NULL OR current_total_weight = 0),
  CONSTRAINT growth_batch_completion_reversal_weight_uom_consistent CHECK (
    (current_total_weight IS NULL AND weight_uom_id IS NULL)
    OR (current_total_weight IS NOT NULL AND weight_uom_id IS NOT NULL)
  ),
  CONSTRAINT growth_batch_completion_reversal_costs_nonnegative CHECK (
    accumulated_material_cost >= 0
    AND accumulated_direct_cost >= 0
    AND accumulated_total_cost >= 0
    AND harvested_cost >= 0
    AND remaining_cost = 0
  ),
  CONSTRAINT growth_batch_completion_reversal_reason_required CHECK (
    NULLIF(btrim(COALESCE(reversal_reason, '')), '') IS NOT NULL
  ),
  CONSTRAINT growth_batch_completion_reversal_sequence_positive CHECK (event_sequence > 0)
);

CREATE INDEX IF NOT EXISTS growth_batch_completions_company_batch_idx
  ON public.growth_batch_completions(company_id, growth_batch_id, event_sequence DESC);
CREATE INDEX IF NOT EXISTS growth_batch_completions_event_idx
  ON public.growth_batch_completions(event_id);

CREATE INDEX IF NOT EXISTS growth_batch_completion_reversal_company_batch_idx
  ON public.growth_batch_completion_reversal_lines(company_id, growth_batch_id, event_sequence DESC);
CREATE INDEX IF NOT EXISTS growth_batch_completion_reversal_original_event_idx
  ON public.growth_batch_completion_reversal_lines(original_event_id);

CREATE OR REPLACE FUNCTION public.validate_growth_batch_completion_row()
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
    RAISE EXCEPTION 'growth_batch_completion_immutable' USING ERRCODE = 'P0001';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'growth_batch_completion_immutable' USING ERRCODE = 'P0001';
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
  IF NOT FOUND OR v_event.event_type <> 'completion' THEN
    RAISE EXCEPTION 'growth_batch_completion_event_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF v_event.event_sequence IS DISTINCT FROM NEW.event_sequence
    OR v_event.event_reference IS DISTINCT FROM NEW.event_reference
    OR v_event.event_date IS DISTINCT FROM NEW.effective_date THEN
    RAISE EXCEPTION 'growth_batch_completion_event_mismatch' USING ERRCODE = 'P0001';
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
    OR NEW.weight_uom_id IS DISTINCT FROM (CASE WHEN NEW.current_total_weight IS NULL THEN NULL ELSE v_batch.weight_uom_id END) THEN
    RAISE EXCEPTION 'growth_batch_completion_snapshot_uom_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_batch.primary_quantity_basis = 'count' AND NEW.current_primary_qty <> trunc(NEW.current_primary_qty) THEN
    RAISE EXCEPTION 'fractional_count_not_allowed' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_growth_batch_completion_reversal_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_reversal_event public.growth_batch_events%ROWTYPE;
  v_original_event public.growth_batch_events%ROWTYPE;
  v_original public.growth_batch_completions%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'growth_batch_completion_reversal_immutable' USING ERRCODE = 'P0001';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'growth_batch_completion_reversal_immutable' USING ERRCODE = 'P0001';
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
  IF NOT FOUND OR v_reversal_event.event_type <> 'completion_reversal' THEN
    RAISE EXCEPTION 'growth_batch_completion_reversal_event_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF v_reversal_event.original_event_id IS DISTINCT FROM NEW.original_event_id
    OR v_reversal_event.event_sequence IS DISTINCT FROM NEW.event_sequence
    OR v_reversal_event.event_reference IS DISTINCT FROM NEW.event_reference THEN
    RAISE EXCEPTION 'growth_batch_completion_reversal_event_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_original_event
  FROM public.growth_batch_events
  WHERE id = NEW.original_event_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id;
  IF NOT FOUND OR v_original_event.event_type <> 'completion' THEN
    RAISE EXCEPTION 'growth_batch_completion_original_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_original
  FROM public.growth_batch_completions
  WHERE id = NEW.original_completion_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id
    AND event_id = NEW.original_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_completion_original_line_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.current_primary_qty IS DISTINCT FROM v_original.current_primary_qty
    OR NEW.primary_uom_id IS DISTINCT FROM v_original.primary_uom_id
    OR NEW.current_total_weight IS DISTINCT FROM v_original.current_total_weight
    OR NEW.weight_uom_id IS DISTINCT FROM v_original.weight_uom_id
    OR NEW.accumulated_material_cost IS DISTINCT FROM v_original.accumulated_material_cost
    OR NEW.accumulated_direct_cost IS DISTINCT FROM v_original.accumulated_direct_cost
    OR NEW.accumulated_total_cost IS DISTINCT FROM v_original.accumulated_total_cost
    OR NEW.harvested_cost IS DISTINCT FROM v_original.harvested_cost
    OR NEW.remaining_cost IS DISTINCT FROM v_original.remaining_cost THEN
    RAISE EXCEPTION 'growth_batch_completion_reversal_line_mismatch' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_growth_batch_completions_row ON public.growth_batch_completions;
CREATE TRIGGER validate_growth_batch_completions_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.growth_batch_completions
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_completion_row();

DROP TRIGGER IF EXISTS validate_growth_batch_completion_reversal_lines_row ON public.growth_batch_completion_reversal_lines;
CREATE TRIGGER validate_growth_batch_completion_reversal_lines_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.growth_batch_completion_reversal_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_completion_reversal_row();

CREATE OR REPLACE VIEW public.growth_batch_completion_history WITH (security_invoker = true) AS
SELECT
  c.id,
  c.company_id,
  c.growth_batch_id,
  gb.reference_no AS growth_batch_reference,
  gb.name AS growth_batch_name,
  gb.batch_family,
  c.event_id,
  c.event_reference,
  c.event_sequence,
  c.effective_date AS event_effective_date,
  e.event_at AS event_created_at,
  e.created_by AS actor_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), 'Team member') AS actor_display_name,
  c.status_before,
  c.status_after,
  c.current_primary_qty,
  c.primary_uom_id,
  pu.code AS primary_uom_code,
  c.current_total_weight,
  c.weight_uom_id,
  wu.code AS weight_uom_code,
  c.accumulated_material_cost,
  c.accumulated_direct_cost,
  c.accumulated_total_cost,
  c.harvested_cost,
  c.remaining_cost,
  c.completion_reason,
  c.notes,
  c.completed_by,
  c.completed_at,
  (r.id IS NOT NULL) AS reversed,
  r.id AS reversal_detail_id,
  r.reversal_event_id,
  re.event_reference AS reversal_event_reference,
  re.event_sequence AS reversal_event_sequence,
  re.event_date AS reversal_effective_date,
  re.event_at AS reversal_timestamp,
  re.created_by AS reversal_actor_id,
  COALESCE(NULLIF(rp.full_name, ''), NULLIF(rp.name, ''), NULL) AS reversal_actor_display_name,
  r.reversal_reason,
  (
    r.id IS NULL
    AND gb.status = 'completed'
    AND gb.latest_event_sequence = e.event_sequence
    AND NOT EXISTS (
      SELECT 1
      FROM public.growth_batch_events later
      WHERE later.company_id = c.company_id
        AND later.growth_batch_id = c.growth_batch_id
        AND later.event_sequence > e.event_sequence
    )
  ) AS reversal_eligible
FROM public.growth_batch_completions c
JOIN public.growth_batches gb ON gb.id = c.growth_batch_id AND gb.company_id = c.company_id
JOIN public.growth_batch_events e
  ON e.id = c.event_id
 AND e.company_id = c.company_id
 AND e.growth_batch_id = c.growth_batch_id
LEFT JOIN public.uoms pu ON pu.id = c.primary_uom_id
LEFT JOIN public.uoms wu ON wu.id = c.weight_uom_id
LEFT JOIN public.profiles p ON p.id = e.created_by
LEFT JOIN public.growth_batch_completion_reversal_lines r
  ON r.original_completion_id = c.id
 AND r.company_id = c.company_id
LEFT JOIN public.growth_batch_events re
  ON re.id = r.reversal_event_id
 AND re.company_id = r.company_id
LEFT JOIN public.profiles rp ON rp.id = re.created_by
WHERE c.company_id = public.current_company_id();

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
  COALESCE(hv.harvested_output_quantity, 0) AS harvested_output_quantity,
  COALESCE(comp.completion_event_count, 0) AS completion_event_count,
  COALESCE(comp.unreversed_completion_event_count, 0) AS unreversed_completion_event_count,
  COALESCE(comp.reversed_completion_event_count, 0) AS reversed_completion_event_count,
  gb.completed_at
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
LEFT JOIN LATERAL (
  SELECT
    count(c.id)::integer AS completion_event_count,
    count(*) FILTER (WHERE r.id IS NULL)::integer AS unreversed_completion_event_count,
    count(*) FILTER (WHERE r.id IS NOT NULL)::integer AS reversed_completion_event_count
  FROM public.growth_batch_completions c
  LEFT JOIN public.growth_batch_completion_reversal_lines r
    ON r.original_completion_id = c.id
   AND r.company_id = c.company_id
  WHERE c.growth_batch_id = gb.id
    AND c.company_id = gb.company_id
) comp ON true
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
  (
    r.status = 'active'
    AND COALESCE(r.current_primary_qty, 0) = 0
    AND (r.latest_total_weight IS NULL OR r.latest_total_weight = 0)
    AND r.remaining_cost = 0
  ) AS fully_harvested_awaiting_completion,
  r.completion_event_count,
  r.unreversed_completion_event_count,
  r.reversed_completion_event_count,
  r.completed_at,
  gb.completed_by
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

ALTER FUNCTION public.validate_growth_batch_event_row() OWNER TO postgres;
ALTER FUNCTION public.validate_growth_batch_row() OWNER TO postgres;
ALTER FUNCTION public.validate_growth_batch_completion_row() OWNER TO postgres;
ALTER FUNCTION public.validate_growth_batch_completion_reversal_row() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.validate_growth_batch_event_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_growth_batch_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_growth_batch_completion_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_growth_batch_completion_reversal_row() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.growth_batch_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_completion_reversal_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.growth_batch_completions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_completion_reversal_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY growth_batch_completions_select_active_company
  ON public.growth_batch_completions
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

CREATE POLICY growth_batch_completion_reversals_select_active_company
  ON public.growth_batch_completion_reversal_lines
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

REVOKE ALL ON public.growth_batch_completions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_completion_reversal_lines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batches_register FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_current_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_completion_history FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.growth_batch_completions TO authenticated;
GRANT SELECT ON public.growth_batch_completion_reversal_lines TO authenticated;
GRANT SELECT ON public.growth_batches_register TO authenticated;
GRANT SELECT ON public.growth_batch_current_state TO authenticated;
GRANT SELECT ON public.growth_batch_completion_history TO authenticated;

GRANT ALL ON public.growth_batch_completions TO service_role;
GRANT ALL ON public.growth_batch_completion_reversal_lines TO service_role;
GRANT SELECT ON public.growth_batches_register TO service_role;
GRANT SELECT ON public.growth_batch_current_state TO service_role;
GRANT SELECT ON public.growth_batch_completion_history TO service_role;

COMMENT ON TABLE public.growth_batch_completions IS
  'Immutable G5.2 completion detail ledger. Completion closes a fully depleted active Growth Batch lifecycle and creates no stock, cost, price, or finance posting.';
COMMENT ON TABLE public.growth_batch_completion_reversal_lines IS
  'Immutable G5.2 event-specific completion reversal detail ledger. Reversal reopens only the completion lifecycle state and does not reverse prior harvests or stock movements.';
COMMENT ON VIEW public.growth_batch_completion_history IS
  'Read model for G5.2 completion events, reversal state, and completion-reversal eligibility.';
