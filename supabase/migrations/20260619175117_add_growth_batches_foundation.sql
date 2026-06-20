-- Growth Batches G1 foundation.
-- Adds group-level long-running batch headers, company-scoped references,
-- draft-only edit protection, and read-only authenticated access.
-- Lifecycle events and RPC mutation paths are added in the following migration.

CREATE TABLE IF NOT EXISTS public.growth_batch_counters (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.growth_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reference_no text NOT NULL,
  name text NOT NULL,
  batch_family text NOT NULL,
  primary_quantity_basis text NOT NULL,
  primary_uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  species_text text,
  purpose text,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_end_date date,
  status text NOT NULL DEFAULT 'draft',
  opening_primary_qty numeric NOT NULL,
  current_primary_qty numeric,
  opening_total_weight numeric,
  current_total_weight numeric,
  weight_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  area numeric,
  area_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  bin_id text REFERENCES public.bins(id) ON DELETE RESTRICT,
  location_description text,
  base_currency_code text NOT NULL DEFAULT 'MZN',
  accumulated_material_cost numeric NOT NULL DEFAULT 0,
  accumulated_direct_cost numeric NOT NULL DEFAULT 0,
  accumulated_total_cost numeric NOT NULL DEFAULT 0,
  harvested_cost numeric NOT NULL DEFAULT 0,
  remaining_cost numeric NOT NULL DEFAULT 0,
  latest_event_sequence integer NOT NULL DEFAULT 0,
  notes text,
  cancellation_reason text,
  completion_notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT growth_batches_reference_unique UNIQUE (company_id, reference_no),
  CONSTRAINT growth_batches_reference_not_blank CHECK (NULLIF(btrim(reference_no), '') IS NOT NULL),
  CONSTRAINT growth_batches_name_not_blank CHECK (NULLIF(btrim(name), '') IS NOT NULL),
  CONSTRAINT growth_batches_family_check CHECK (
    batch_family IN ('poultry', 'livestock', 'fish', 'crop', 'nursery', 'other')
  ),
  CONSTRAINT growth_batches_quantity_basis_check CHECK (
    primary_quantity_basis IN ('count', 'weight', 'area', 'other')
  ),
  CONSTRAINT growth_batches_status_check CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
  CONSTRAINT growth_batches_opening_qty_positive CHECK (opening_primary_qty > 0),
  CONSTRAINT growth_batches_current_qty_nonnegative CHECK (
    current_primary_qty IS NULL OR current_primary_qty >= 0
  ),
  CONSTRAINT growth_batches_count_qty_whole CHECK (
    primary_quantity_basis <> 'count'
    OR (
      opening_primary_qty = trunc(opening_primary_qty)
      AND (current_primary_qty IS NULL OR current_primary_qty = trunc(current_primary_qty))
    )
  ),
  CONSTRAINT growth_batches_weight_nonnegative CHECK (
    (opening_total_weight IS NULL OR opening_total_weight >= 0)
    AND (current_total_weight IS NULL OR current_total_weight >= 0)
  ),
  CONSTRAINT growth_batches_weight_requires_uom CHECK (
    (opening_total_weight IS NULL AND current_total_weight IS NULL)
    OR weight_uom_id IS NOT NULL
  ),
  CONSTRAINT growth_batches_area_nonnegative CHECK (area IS NULL OR area >= 0),
  CONSTRAINT growth_batches_area_requires_uom CHECK (area IS NULL OR area_uom_id IS NOT NULL),
  CONSTRAINT growth_batches_expected_after_start CHECK (
    expected_end_date IS NULL OR expected_end_date >= start_date
  ),
  CONSTRAINT growth_batches_costs_nonnegative CHECK (
    accumulated_material_cost >= 0
    AND accumulated_direct_cost >= 0
    AND accumulated_total_cost >= 0
    AND harvested_cost >= 0
    AND remaining_cost >= 0
  ),
  CONSTRAINT growth_batches_cost_total_consistent CHECK (
    accumulated_total_cost = accumulated_material_cost + accumulated_direct_cost
  ),
  CONSTRAINT growth_batches_remaining_cost_consistent CHECK (
    remaining_cost = accumulated_total_cost - harvested_cost
  ),
  CONSTRAINT growth_batches_harvest_not_over_total CHECK (harvested_cost <= accumulated_total_cost),
  CONSTRAINT growth_batches_latest_sequence_nonnegative CHECK (latest_event_sequence >= 0),
  CONSTRAINT growth_batches_active_requires_actor CHECK (
    status <> 'active' OR (activated_by IS NOT NULL AND activated_at IS NOT NULL)
  ),
  CONSTRAINT growth_batches_cancelled_requires_reason CHECK (
    status <> 'cancelled'
    OR (
      cancelled_by IS NOT NULL
      AND cancelled_at IS NOT NULL
      AND NULLIF(btrim(COALESCE(cancellation_reason, '')), '') IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS growth_batches_company_status_start_idx
  ON public.growth_batches(company_id, status, start_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_batches_company_family_idx
  ON public.growth_batches(company_id, batch_family);
CREATE INDEX IF NOT EXISTS growth_batches_company_basis_idx
  ON public.growth_batches(company_id, primary_quantity_basis);
CREATE INDEX IF NOT EXISTS growth_batches_company_location_idx
  ON public.growth_batches(company_id, warehouse_id, bin_id);

CREATE OR REPLACE FUNCTION public.next_growth_batch_reference(
  p_company_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_next bigint;
  v_prefix text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.growth_batch_counters(company_id, next_number, updated_at)
  VALUES (p_company_id, 2, now())
  ON CONFLICT (company_id) DO UPDATE
    SET next_number = public.growth_batch_counters.next_number + 1,
        updated_at = now()
  RETURNING next_number - 1 INTO v_next;

  v_prefix := COALESCE(NULLIF(public.company_code3(p_company_id), ''), 'LEN');
  RETURN v_prefix || '-GB' || lpad(v_next::text, 9, '0');
END;
$$;

ALTER FUNCTION public.next_growth_batch_reference(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.next_growth_batch_reference(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.growth_batches_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  NEW.updated_at := now();
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
        OR NEW.accumulated_material_cost IS DISTINCT FROM OLD.accumulated_material_cost
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

CREATE TRIGGER growth_batches_touch_updated_at
  BEFORE UPDATE ON public.growth_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.growth_batches_touch_updated_at();

CREATE TRIGGER validate_growth_batches_row
  BEFORE INSERT OR UPDATE ON public.growth_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_row();

REVOKE ALL ON FUNCTION public.growth_batches_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_growth_batch_row() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.growth_batch_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.growth_batch_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batches FORCE ROW LEVEL SECURITY;

CREATE POLICY growth_batch_counters_select_active_company
  ON public.growth_batch_counters
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY growth_batches_select_active_company
  ON public.growth_batches
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

REVOKE ALL ON public.growth_batch_counters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batches FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.growth_batch_counters TO authenticated;
GRANT SELECT ON public.growth_batches TO authenticated;

GRANT ALL ON public.growth_batch_counters TO service_role;
GRANT ALL ON public.growth_batches TO service_role;

COMMENT ON TABLE public.growth_batches IS
  'Company-scoped group-level Growth Batch headers. G1-G2 supports draft creation/editing, activation, measurements, memo direct costs, and draft cancellation only.';
COMMENT ON COLUMN public.growth_batches.accumulated_material_cost IS
  'G1-G2 material cost remains zero because stock input consumption is future scope.';
COMMENT ON COLUMN public.growth_batches.accumulated_direct_cost IS
  'Memo direct-cost total from valid growth_batch_direct_costs events. Does not create finance postings.';
COMMENT ON COLUMN public.growth_batches.remaining_cost IS
  'G1-G2 remaining cost equals accumulated total cost because harvest/completion is future scope.';
