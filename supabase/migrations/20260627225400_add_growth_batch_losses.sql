-- Growth Batches G4.1 loss schema, immutable loss ledgers, and read models.
-- This migration adds mortality/shrinkage event structure only. Posting logic
-- is added in the paired *_add_growth_batch_loss_posting.sql migration.

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
      'shrinkage_reversal'
    )
  );

ALTER TABLE public.growth_batch_events
  DROP CONSTRAINT IF EXISTS growth_batch_events_original_event_for_reversal;

ALTER TABLE public.growth_batch_events
  ADD CONSTRAINT growth_batch_events_original_event_for_reversal CHECK (
    (
      event_type IN ('stock_input_reversal', 'mortality_reversal', 'shrinkage_reversal')
      AND original_event_id IS NOT NULL
    )
    OR (
      event_type NOT IN ('stock_input_reversal', 'mortality_reversal', 'shrinkage_reversal')
      AND original_event_id IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS growth_batch_events_original_event_idx
  ON public.growth_batch_events(company_id, growth_batch_id, original_event_id)
  WHERE original_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS growth_batch_events_one_loss_reversal_idx
  ON public.growth_batch_events(original_event_id)
  WHERE event_type IN ('mortality_reversal', 'shrinkage_reversal')
    AND original_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.growth_batch_losses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE CASCADE,
  loss_type text NOT NULL,
  quantity_lost numeric,
  quantity_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  weight_lost numeric,
  weight_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  notes text,
  quantity_before numeric,
  quantity_after numeric,
  total_weight_before numeric,
  total_weight_after numeric,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_losses_event_unique UNIQUE (event_id),
  CONSTRAINT growth_batch_losses_type_check CHECK (loss_type IN ('mortality', 'shrinkage')),
  CONSTRAINT growth_batch_losses_quantity_nonnegative CHECK (quantity_lost IS NULL OR quantity_lost >= 0),
  CONSTRAINT growth_batch_losses_weight_nonnegative CHECK (weight_lost IS NULL OR weight_lost >= 0),
  CONSTRAINT growth_batch_losses_value_required CHECK (
    COALESCE(quantity_lost, 0) > 0 OR COALESCE(weight_lost, 0) > 0
  ),
  CONSTRAINT growth_batch_losses_quantity_uom_consistent CHECK (
    (quantity_lost IS NULL AND quantity_uom_id IS NULL)
    OR (quantity_lost IS NOT NULL AND quantity_uom_id IS NOT NULL)
  ),
  CONSTRAINT growth_batch_losses_weight_uom_consistent CHECK (
    (weight_lost IS NULL AND weight_uom_id IS NULL)
    OR (weight_lost IS NOT NULL AND weight_uom_id IS NOT NULL)
  ),
  CONSTRAINT growth_batch_losses_before_after_nonnegative CHECK (
    (quantity_before IS NULL OR quantity_before >= 0)
    AND (quantity_after IS NULL OR quantity_after >= 0)
    AND (total_weight_before IS NULL OR total_weight_before >= 0)
    AND (total_weight_after IS NULL OR total_weight_after >= 0)
  ),
  CONSTRAINT growth_batch_losses_mortality_reason_check CHECK (
    loss_type <> 'mortality'
    OR reason_code IN ('disease', 'injury', 'predator', 'weather', 'handling', 'culling', 'other')
  ),
  CONSTRAINT growth_batch_losses_shrinkage_reason_check CHECK (
    loss_type <> 'shrinkage'
    OR reason_code IN ('weather', 'handling', 'natural_loss', 'drying', 'spoilage', 'quality_loss', 'other')
  ),
  CONSTRAINT growth_batch_losses_other_notes_required CHECK (
    reason_code <> 'other' OR NULLIF(btrim(COALESCE(notes, '')), '') IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.growth_batch_loss_reversal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  reversal_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE CASCADE,
  original_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE RESTRICT,
  original_loss_id uuid NOT NULL REFERENCES public.growth_batch_losses(id) ON DELETE RESTRICT,
  restored_quantity numeric,
  restored_quantity_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  restored_weight numeric,
  restored_weight_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  quantity_before numeric,
  quantity_after numeric,
  total_weight_before numeric,
  total_weight_after numeric,
  reason text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_loss_reversal_event_unique UNIQUE (reversal_event_id),
  CONSTRAINT growth_batch_loss_reversal_original_unique UNIQUE (original_loss_id),
  CONSTRAINT growth_batch_loss_reversal_quantity_nonnegative CHECK (restored_quantity IS NULL OR restored_quantity >= 0),
  CONSTRAINT growth_batch_loss_reversal_weight_nonnegative CHECK (restored_weight IS NULL OR restored_weight >= 0),
  CONSTRAINT growth_batch_loss_reversal_value_required CHECK (
    COALESCE(restored_quantity, 0) > 0 OR COALESCE(restored_weight, 0) > 0
  ),
  CONSTRAINT growth_batch_loss_reversal_quantity_uom_consistent CHECK (
    (restored_quantity IS NULL AND restored_quantity_uom_id IS NULL)
    OR (restored_quantity IS NOT NULL AND restored_quantity_uom_id IS NOT NULL)
  ),
  CONSTRAINT growth_batch_loss_reversal_weight_uom_consistent CHECK (
    (restored_weight IS NULL AND restored_weight_uom_id IS NULL)
    OR (restored_weight IS NOT NULL AND restored_weight_uom_id IS NOT NULL)
  ),
  CONSTRAINT growth_batch_loss_reversal_reason_required CHECK (
    NULLIF(btrim(COALESCE(reason, '')), '') IS NOT NULL
  ),
  CONSTRAINT growth_batch_loss_reversal_before_after_nonnegative CHECK (
    (quantity_before IS NULL OR quantity_before >= 0)
    AND (quantity_after IS NULL OR quantity_after >= 0)
    AND (total_weight_before IS NULL OR total_weight_before >= 0)
    AND (total_weight_after IS NULL OR total_weight_after >= 0)
  )
);

CREATE INDEX IF NOT EXISTS growth_batch_losses_company_batch_idx
  ON public.growth_batch_losses(company_id, growth_batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_batch_losses_event_idx
  ON public.growth_batch_losses(event_id);
CREATE INDEX IF NOT EXISTS growth_batch_losses_type_idx
  ON public.growth_batch_losses(company_id, loss_type, reason_code);

CREATE INDEX IF NOT EXISTS growth_batch_loss_reversal_company_batch_idx
  ON public.growth_batch_loss_reversal_lines(company_id, growth_batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_batch_loss_reversal_event_idx
  ON public.growth_batch_loss_reversal_lines(reversal_event_id);
CREATE INDEX IF NOT EXISTS growth_batch_loss_reversal_original_event_idx
  ON public.growth_batch_loss_reversal_lines(original_event_id);

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

    IF NEW.event_type IN ('stock_input_reversal', 'mortality_reversal', 'shrinkage_reversal') THEN
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

CREATE OR REPLACE FUNCTION public.validate_growth_batch_loss_row()
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
    RAISE EXCEPTION 'growth_batch_loss_immutable' USING ERRCODE = 'P0001';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'growth_batch_loss_immutable' USING ERRCODE = 'P0001';
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
  IF NOT FOUND OR v_event.event_type NOT IN ('mortality', 'shrinkage') THEN
    RAISE EXCEPTION 'growth_batch_loss_event_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.loss_type IS DISTINCT FROM v_event.event_type THEN
    RAISE EXCEPTION 'growth_batch_loss_type_mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = NEW.growth_batch_id
    AND company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.quantity_lost IS NOT NULL THEN
    IF NEW.quantity_uom_id IS DISTINCT FROM v_batch.primary_uom_id THEN
      RAISE EXCEPTION 'growth_batch_loss_quantity_uom_mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_batch.primary_quantity_basis = 'count' AND NEW.quantity_lost <> trunc(NEW.quantity_lost) THEN
      RAISE EXCEPTION 'fractional_count_not_allowed' USING ERRCODE = '22023';
    END IF;
    IF NEW.quantity_before IS NULL OR NEW.quantity_after IS NULL THEN
      RAISE EXCEPTION 'growth_batch_loss_quantity_snapshot_required' USING ERRCODE = '22023';
    END IF;
    IF round((NEW.quantity_before - NEW.quantity_lost)::numeric, 12) IS DISTINCT FROM NEW.quantity_after THEN
      RAISE EXCEPTION 'growth_batch_loss_quantity_snapshot_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF NEW.quantity_before IS DISTINCT FROM NEW.quantity_after THEN
      RAISE EXCEPTION 'growth_batch_loss_quantity_snapshot_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.weight_lost IS NOT NULL THEN
    IF v_batch.weight_uom_id IS NULL THEN
      RAISE EXCEPTION 'growth_batch_weight_uom_required' USING ERRCODE = '22023';
    END IF;
    IF NEW.weight_uom_id IS DISTINCT FROM v_batch.weight_uom_id THEN
      RAISE EXCEPTION 'growth_batch_loss_weight_uom_mismatch' USING ERRCODE = '22023';
    END IF;
    IF NEW.total_weight_before IS NULL OR NEW.total_weight_after IS NULL THEN
      RAISE EXCEPTION 'growth_batch_loss_weight_snapshot_required' USING ERRCODE = '22023';
    END IF;
    IF round((NEW.total_weight_before - NEW.weight_lost)::numeric, 12) IS DISTINCT FROM NEW.total_weight_after THEN
      RAISE EXCEPTION 'growth_batch_loss_weight_snapshot_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF NEW.total_weight_before IS DISTINCT FROM NEW.total_weight_after THEN
      RAISE EXCEPTION 'growth_batch_loss_weight_snapshot_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_growth_batch_loss_reversal_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_reversal_event public.growth_batch_events%ROWTYPE;
  v_original_event public.growth_batch_events%ROWTYPE;
  v_original_loss public.growth_batch_losses%ROWTYPE;
  v_expected_reversal_type text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'growth_batch_loss_reversal_immutable' USING ERRCODE = 'P0001';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'growth_batch_loss_reversal_immutable' USING ERRCODE = 'P0001';
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
  IF NOT FOUND OR v_reversal_event.event_type NOT IN ('mortality_reversal', 'shrinkage_reversal') THEN
    RAISE EXCEPTION 'growth_batch_loss_reversal_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_original_event
  FROM public.growth_batch_events
  WHERE id = NEW.original_event_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id;
  IF NOT FOUND OR v_original_event.event_type NOT IN ('mortality', 'shrinkage') THEN
    RAISE EXCEPTION 'growth_batch_loss_original_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  v_expected_reversal_type := CASE v_original_event.event_type
    WHEN 'mortality' THEN 'mortality_reversal'
    WHEN 'shrinkage' THEN 'shrinkage_reversal'
    ELSE NULL
  END;
  IF v_reversal_event.event_type IS DISTINCT FROM v_expected_reversal_type
    OR v_reversal_event.original_event_id IS DISTINCT FROM NEW.original_event_id THEN
    RAISE EXCEPTION 'growth_batch_loss_reversal_event_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_original_loss
  FROM public.growth_batch_losses
  WHERE id = NEW.original_loss_id
    AND company_id = NEW.company_id
    AND growth_batch_id = NEW.growth_batch_id
    AND event_id = NEW.original_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_loss_original_line_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.restored_quantity IS DISTINCT FROM v_original_loss.quantity_lost
    OR NEW.restored_quantity_uom_id IS DISTINCT FROM v_original_loss.quantity_uom_id
    OR NEW.restored_weight IS DISTINCT FROM v_original_loss.weight_lost
    OR NEW.restored_weight_uom_id IS DISTINCT FROM v_original_loss.weight_uom_id THEN
    RAISE EXCEPTION 'growth_batch_loss_reversal_line_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.restored_quantity IS NOT NULL THEN
    IF NEW.quantity_before IS NULL OR NEW.quantity_after IS NULL THEN
      RAISE EXCEPTION 'growth_batch_loss_reversal_quantity_snapshot_required' USING ERRCODE = '22023';
    END IF;
    IF round((NEW.quantity_before + NEW.restored_quantity)::numeric, 12) IS DISTINCT FROM NEW.quantity_after THEN
      RAISE EXCEPTION 'growth_batch_loss_reversal_quantity_snapshot_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF NEW.quantity_before IS DISTINCT FROM NEW.quantity_after THEN
      RAISE EXCEPTION 'growth_batch_loss_reversal_quantity_snapshot_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.restored_weight IS NOT NULL THEN
    IF NEW.total_weight_before IS NULL OR NEW.total_weight_after IS NULL THEN
      RAISE EXCEPTION 'growth_batch_loss_reversal_weight_snapshot_required' USING ERRCODE = '22023';
    END IF;
    IF round((NEW.total_weight_before + NEW.restored_weight)::numeric, 12) IS DISTINCT FROM NEW.total_weight_after THEN
      RAISE EXCEPTION 'growth_batch_loss_reversal_weight_snapshot_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF NEW.total_weight_before IS DISTINCT FROM NEW.total_weight_after THEN
      RAISE EXCEPTION 'growth_batch_loss_reversal_weight_snapshot_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_growth_batch_losses_row ON public.growth_batch_losses;
CREATE TRIGGER validate_growth_batch_losses_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.growth_batch_losses
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_loss_row();

DROP TRIGGER IF EXISTS validate_growth_batch_loss_reversal_lines_row ON public.growth_batch_loss_reversal_lines;
CREATE TRIGGER validate_growth_batch_loss_reversal_lines_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.growth_batch_loss_reversal_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_loss_reversal_row();

REVOKE ALL ON FUNCTION public.validate_growth_batch_loss_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_growth_batch_loss_reversal_row() FROM PUBLIC, anon, authenticated;

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
  COALESCE(losses.unreversed_loss_event_count, 0) AS unreversed_loss_event_count
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
  COALESCE(lr.reversed_loss_event_count, 0) AS reversed_loss_event_count
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
LEFT JOIN public.uoms wu ON wu.id = e.weight_uom_id
LEFT JOIN public.uoms mu ON mu.id = m.uom_id
LEFT JOIN public.uoms lqu ON lqu.id = loss.quantity_uom_id
LEFT JOIN public.uoms lwu ON lwu.id = loss.weight_uom_id
LEFT JOIN public.uoms rqu ON rqu.id = loss_reversal.restored_quantity_uom_id
LEFT JOIN public.uoms rwu ON rwu.id = loss_reversal.restored_weight_uom_id
LEFT JOIN public.profiles p ON p.id = e.created_by
WHERE e.company_id = public.current_company_id();

CREATE OR REPLACE VIEW public.growth_batch_loss_history WITH (security_invoker = true) AS
SELECT
  l.id,
  l.company_id,
  l.growth_batch_id,
  gb.reference_no AS growth_batch_reference,
  l.event_id,
  e.event_sequence,
  e.event_reference,
  e.event_date AS event_effective_date,
  e.event_at AS event_created_at,
  e.created_by AS actor_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), 'Team member') AS actor_display_name,
  l.loss_type,
  l.quantity_lost,
  l.quantity_uom_id,
  qu.code AS quantity_uom_code,
  l.weight_lost,
  l.weight_uom_id,
  wu.code AS weight_uom_code,
  l.reason_code,
  l.notes,
  l.quantity_before,
  l.quantity_after,
  l.total_weight_before,
  l.total_weight_after,
  CASE WHEN r.id IS NULL THEN 'not_reversed' ELSE 'reversed' END AS reversal_status,
  r.reversal_event_id,
  re.event_reference AS reversal_event_reference,
  re.event_sequence AS reversal_event_sequence,
  re.event_at AS reversal_timestamp,
  re.event_date AS reversal_effective_date,
  re.created_by AS reversal_actor_id,
  COALESCE(NULLIF(rp.full_name, ''), NULLIF(rp.name, ''), NULL) AS reversal_actor_display_name,
  r.reason AS reversal_reason,
  r.restored_quantity,
  r.restored_quantity_uom_id,
  rqu.code AS restored_quantity_uom_code,
  r.restored_weight,
  r.restored_weight_uom_id,
  rwu.code AS restored_weight_uom_code
FROM public.growth_batch_losses l
JOIN public.growth_batches gb ON gb.id = l.growth_batch_id AND gb.company_id = l.company_id
JOIN public.growth_batch_events e
  ON e.id = l.event_id
 AND e.company_id = l.company_id
 AND e.growth_batch_id = l.growth_batch_id
LEFT JOIN public.uoms qu ON qu.id = l.quantity_uom_id
LEFT JOIN public.uoms wu ON wu.id = l.weight_uom_id
LEFT JOIN public.profiles p ON p.id = e.created_by
LEFT JOIN public.growth_batch_loss_reversal_lines r
  ON r.original_loss_id = l.id
 AND r.company_id = l.company_id
LEFT JOIN public.growth_batch_events re
  ON re.id = r.reversal_event_id
 AND re.company_id = r.company_id
LEFT JOIN public.profiles rp ON rp.id = re.created_by
LEFT JOIN public.uoms rqu ON rqu.id = r.restored_quantity_uom_id
LEFT JOIN public.uoms rwu ON rwu.id = r.restored_weight_uom_id
WHERE l.company_id = public.current_company_id();

ALTER TABLE public.growth_batch_losses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_loss_reversal_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.growth_batch_losses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_loss_reversal_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY growth_batch_losses_select_active_company
  ON public.growth_batch_losses
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

CREATE POLICY growth_batch_loss_reversal_select_active_company
  ON public.growth_batch_loss_reversal_lines
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

REVOKE ALL ON public.growth_batch_losses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_loss_reversal_lines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batches_register FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_current_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_event_timeline FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_loss_history FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.growth_batch_losses TO authenticated;
GRANT SELECT ON public.growth_batch_loss_reversal_lines TO authenticated;
GRANT SELECT ON public.growth_batches_register TO authenticated;
GRANT SELECT ON public.growth_batch_current_state TO authenticated;
GRANT SELECT ON public.growth_batch_event_timeline TO authenticated;
GRANT SELECT ON public.growth_batch_loss_history TO authenticated;

GRANT ALL ON public.growth_batch_losses TO service_role;
GRANT ALL ON public.growth_batch_loss_reversal_lines TO service_role;
GRANT SELECT ON public.growth_batches_register TO service_role;
GRANT SELECT ON public.growth_batch_current_state TO service_role;
GRANT SELECT ON public.growth_batch_event_timeline TO service_role;
GRANT SELECT ON public.growth_batch_loss_history TO service_role;

COMMENT ON TABLE public.growth_batch_losses IS
  'Immutable G4.1 mortality and shrinkage detail ledger. Losses update Growth Batch quantity and weight only and do not create stock or finance rows.';
COMMENT ON TABLE public.growth_batch_loss_reversal_lines IS
  'Immutable G4.1 event-specific mortality/shrinkage reversal details. Reversals restore the original frozen quantity and weight.';
COMMENT ON VIEW public.growth_batch_loss_history IS
  'Read model for G4.1 mortality and shrinkage events and their event-specific reversals.';
