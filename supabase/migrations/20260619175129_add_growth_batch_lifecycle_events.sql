-- Growth Batches G1-G2 lifecycle events, RPCs, and read models.
-- This migration intentionally creates no stock movements, finance postings,
-- cash/bank rows, vendor bills, settlements, journals, harvests, or reversals.

CREATE TABLE IF NOT EXISTS public.growth_batch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  event_sequence integer NOT NULL CHECK (event_sequence > 0),
  event_reference text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('activation', 'measurement', 'direct_cost', 'cancellation')),
  event_at timestamptz NOT NULL DEFAULT now(),
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  quantity_delta numeric,
  weight_value numeric,
  weight_delta numeric,
  weight_uom_id text REFERENCES public.uoms(id) ON DELETE RESTRICT,
  material_cost_delta numeric NOT NULL DEFAULT 0,
  direct_cost_delta numeric NOT NULL DEFAULT 0,
  total_cost_delta numeric NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'MZN',
  notes text,
  reason text,
  posting_request_id uuid REFERENCES public.posting_requests(id) ON DELETE SET NULL,
  original_event_id uuid REFERENCES public.growth_batch_events(id) ON DELETE RESTRICT,
  reversal_event_id uuid REFERENCES public.growth_batch_events(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_events_sequence_unique UNIQUE (growth_batch_id, event_sequence),
  CONSTRAINT growth_batch_events_reference_unique UNIQUE (company_id, event_reference),
  CONSTRAINT growth_batch_events_reference_not_blank CHECK (NULLIF(btrim(event_reference), '') IS NOT NULL),
  CONSTRAINT growth_batch_events_cost_deltas_valid CHECK (
    material_cost_delta >= 0
    AND direct_cost_delta >= 0
    AND total_cost_delta >= 0
    AND total_cost_delta = material_cost_delta + direct_cost_delta
  ),
  CONSTRAINT growth_batch_events_measurement_weight_nonnegative CHECK (
    weight_value IS NULL OR weight_value >= 0
  )
);

CREATE TABLE IF NOT EXISTS public.growth_batch_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  growth_batch_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE CASCADE,
  measurement_type text NOT NULL CHECK (
    measurement_type IN ('total_weight', 'average_weight', 'height', 'area_observation', 'temperature', 'other')
  ),
  description text,
  value numeric NOT NULL CHECK (measurement_type = 'temperature' OR value >= 0),
  uom_id text NOT NULL REFERENCES public.uoms(id) ON DELETE RESTRICT,
  sample_size numeric CHECK (sample_size IS NULL OR sample_size > 0),
  minimum_value numeric CHECK (measurement_type = 'temperature' OR minimum_value IS NULL OR minimum_value >= 0),
  maximum_value numeric CHECK (measurement_type = 'temperature' OR maximum_value IS NULL OR maximum_value >= 0),
  average_value numeric CHECK (measurement_type = 'temperature' OR average_value IS NULL OR average_value >= 0),
  observed_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_measurements_event_unique UNIQUE (growth_batch_event_id),
  CONSTRAINT growth_batch_measurements_other_description CHECK (
    measurement_type <> 'other' OR NULLIF(btrim(COALESCE(description, '')), '') IS NOT NULL
  ),
  CONSTRAINT growth_batch_measurements_min_max CHECK (
    minimum_value IS NULL OR maximum_value IS NULL OR minimum_value <= maximum_value
  )
);

CREATE TABLE IF NOT EXISTS public.growth_batch_direct_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  growth_batch_id uuid NOT NULL REFERENCES public.growth_batches(id) ON DELETE CASCADE,
  growth_batch_event_id uuid NOT NULL REFERENCES public.growth_batch_events(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (
    category IN ('labour', 'utilities', 'veterinary', 'transport', 'land_preparation', 'water', 'rent', 'other')
  ),
  description text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  currency_code text NOT NULL DEFAULT 'MZN',
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_batch_direct_costs_event_unique UNIQUE (growth_batch_event_id),
  CONSTRAINT growth_batch_direct_costs_description_not_blank CHECK (
    NULLIF(btrim(description), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS growth_batch_events_batch_sequence_idx
  ON public.growth_batch_events(growth_batch_id, event_sequence);
CREATE INDEX IF NOT EXISTS growth_batch_events_company_type_date_idx
  ON public.growth_batch_events(company_id, event_type, event_date DESC, event_sequence DESC);
CREATE INDEX IF NOT EXISTS growth_batch_measurements_batch_observed_idx
  ON public.growth_batch_measurements(growth_batch_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS growth_batch_direct_costs_batch_date_idx
  ON public.growth_batch_direct_costs(growth_batch_id, event_date DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.validate_growth_batch_event_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_weight_uom_family text;
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

CREATE OR REPLACE FUNCTION public.validate_growth_batch_measurement_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_event public.growth_batch_events%ROWTYPE;
  v_batch public.growth_batches%ROWTYPE;
  v_uom_family text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'growth_batch_measurement_immutable' USING ERRCODE = 'P0001';
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

  IF NOT FOUND OR v_event.event_type <> 'measurement' THEN
    RAISE EXCEPTION 'growth_batch_measurement_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = NEW.growth_batch_id
    AND company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT u.family
    INTO v_uom_family
  FROM public.uoms u
  WHERE u.id = NEW.uom_id;
  IF v_uom_family IS NULL THEN
    RAISE EXCEPTION 'uom_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.measurement_type IN ('total_weight', 'average_weight') THEN
    IF v_batch.weight_uom_id IS NULL THEN
      RAISE EXCEPTION 'growth_batch_weight_uom_required' USING ERRCODE = '22023';
    END IF;
    IF NEW.uom_id <> v_batch.weight_uom_id OR v_uom_family <> 'mass' THEN
      RAISE EXCEPTION 'growth_batch_weight_uom_mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.measurement_type = 'area_observation' THEN
    IF v_batch.area_uom_id IS NULL THEN
      RAISE EXCEPTION 'growth_batch_area_uom_required' USING ERRCODE = '22023';
    END IF;
    IF NEW.uom_id <> v_batch.area_uom_id OR v_uom_family <> 'area' THEN
      RAISE EXCEPTION 'growth_batch_area_uom_mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.measurement_type = 'height' AND v_uom_family <> 'length' THEN
    RAISE EXCEPTION 'growth_batch_height_uom_mismatch' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_growth_batch_direct_cost_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_event public.growth_batch_events%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'growth_batch_direct_cost_immutable' USING ERRCODE = 'P0001';
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

  IF NOT FOUND OR v_event.event_type <> 'direct_cost' THEN
    RAISE EXCEPTION 'growth_batch_direct_cost_event_invalid' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_growth_batch_events_row
  BEFORE INSERT OR UPDATE ON public.growth_batch_events
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_event_row();

CREATE TRIGGER validate_growth_batch_measurements_row
  BEFORE INSERT OR UPDATE ON public.growth_batch_measurements
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_measurement_row();

CREATE TRIGGER validate_growth_batch_direct_costs_row
  BEFORE INSERT OR UPDATE ON public.growth_batch_direct_costs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_growth_batch_direct_cost_row();

REVOKE ALL ON FUNCTION public.validate_growth_batch_event_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_growth_batch_measurement_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_growth_batch_direct_cost_row() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.stockwise_claim_growth_request(
  p_company_id uuid,
  p_operation_type text,
  p_request_key text,
  p_payload_hash text
) RETURNS TABLE(
  request_id uuid,
  request_status text,
  request_payload_hash text,
  request_result_payload jsonb,
  request_created_by uuid,
  is_new boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_request public.posting_requests%ROWTYPE;
BEGIN
  IF NULLIF(btrim(COALESCE(p_request_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_operation_type, '')), '') IS NULL THEN
    RAISE EXCEPTION 'operation_type_required' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_payload_hash, '')), '') IS NULL THEN
    RAISE EXCEPTION 'payload_hash_required' USING ERRCODE = '22023';
  END IF;

  LOOP
    BEGIN
      INSERT INTO public.posting_requests (
        company_id,
        operation_type,
        request_key,
        payload_hash,
        status,
        created_by,
        expires_at
      ) VALUES (
        p_company_id,
        p_operation_type,
        NULLIF(btrim(p_request_key), ''),
        p_payload_hash,
        'in_progress',
        auth.uid(),
        now() + interval '180 days'
      )
      RETURNING * INTO v_request;

      request_id := v_request.id;
      request_status := v_request.status;
      request_payload_hash := v_request.payload_hash;
      request_result_payload := v_request.result_payload;
      request_created_by := v_request.created_by;
      is_new := true;
      RETURN NEXT;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      SELECT *
        INTO v_request
      FROM public.posting_requests pr
      WHERE pr.company_id = p_company_id
        AND pr.operation_type = p_operation_type
        AND pr.request_key = NULLIF(btrim(p_request_key), '')
      FOR UPDATE;

      IF FOUND THEN
        request_id := v_request.id;
        request_status := v_request.status;
        request_payload_hash := v_request.payload_hash;
        request_result_payload := v_request.result_payload;
        request_created_by := v_request.created_by;
        is_new := false;
        RETURN NEXT;
        RETURN;
      END IF;
    END;
  END LOOP;
END;
$$;

ALTER FUNCTION public.stockwise_claim_growth_request(uuid, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.stockwise_claim_growth_request(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_growth_batch_draft(
  p_company_id uuid,
  p_name text,
  p_batch_family text,
  p_primary_quantity_basis text,
  p_opening_primary_qty numeric,
  p_primary_uom_id text,
  p_start_date date DEFAULT CURRENT_DATE,
  p_expected_end_date date DEFAULT NULL,
  p_species_text text DEFAULT NULL,
  p_purpose text DEFAULT NULL,
  p_opening_total_weight numeric DEFAULT NULL,
  p_weight_uom_id text DEFAULT NULL,
  p_area numeric DEFAULT NULL,
  p_area_uom_id text DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_bin_id text DEFAULT NULL,
  p_location_description text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_request_key text DEFAULT NULL,
  p_opening_total_weight_present boolean DEFAULT false,
  p_area_present boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_family text := lower(NULLIF(btrim(COALESCE(p_batch_family, '')), ''));
  v_basis text := lower(NULLIF(btrim(COALESCE(p_primary_quantity_basis, '')), ''));
  v_uom_id text := NULLIF(btrim(COALESCE(p_primary_uom_id, '')), '');
  v_weight_uom_id text := NULLIF(btrim(COALESCE(p_weight_uom_id, '')), '');
  v_area_uom_id text := NULLIF(btrim(COALESCE(p_area_uom_id, '')), '');
  v_bin_id text := NULLIF(btrim(COALESCE(p_bin_id, '')), '');
  v_opening_weight_present boolean := COALESCE(p_opening_total_weight_present, false) OR p_opening_total_weight IS NOT NULL;
  v_area_present boolean := COALESCE(p_area_present, false) OR p_area IS NOT NULL;
  v_base_currency text := 'MZN';
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_reference text;
  v_batch_id uuid;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  IF v_name IS NULL THEN RAISE EXCEPTION 'growth_batch_name_required' USING ERRCODE = '22023'; END IF;
  IF v_family NOT IN ('poultry', 'livestock', 'fish', 'crop', 'nursery', 'other') THEN
    RAISE EXCEPTION 'invalid_growth_batch_family' USING ERRCODE = '22023';
  END IF;
  IF v_basis NOT IN ('count', 'weight', 'area', 'other') THEN
    RAISE EXCEPTION 'invalid_growth_batch_quantity_basis' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_opening_primary_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_growth_batch_quantity' USING ERRCODE = '22023';
  END IF;
  IF v_basis = 'count' AND p_opening_primary_qty <> trunc(p_opening_primary_qty) THEN
    RAISE EXCEPTION 'fractional_count_not_allowed' USING ERRCODE = '22023';
  END IF;
  IF v_uom_id IS NULL THEN
    RAISE EXCEPTION 'uom_required' USING ERRCODE = '22023';
  END IF;
  IF v_weight_uom_id IS NULL AND v_basis = 'weight' THEN
    v_weight_uom_id := v_uom_id;
  END IF;

  IF p_opening_total_weight IS NOT NULL AND p_opening_total_weight < 0 THEN
    RAISE EXCEPTION 'invalid_growth_batch_weight' USING ERRCODE = '22023';
  END IF;
  IF p_opening_total_weight IS NOT NULL AND v_weight_uom_id IS NULL THEN
    RAISE EXCEPTION 'growth_batch_weight_uom_required' USING ERRCODE = '22023';
  END IF;
  IF p_area IS NOT NULL AND p_area < 0 THEN
    RAISE EXCEPTION 'invalid_growth_batch_area' USING ERRCODE = '22023';
  END IF;
  IF p_area IS NOT NULL AND v_area_uom_id IS NULL THEN
    RAISE EXCEPTION 'area_uom_required' USING ERRCODE = '22023';
  END IF;

  IF p_expected_end_date IS NOT NULL AND p_expected_end_date < COALESCE(p_start_date, CURRENT_DATE) THEN
    RAISE EXCEPTION 'invalid_growth_batch_dates' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'company_id', p_company_id,
    'name', v_name,
    'batch_family', v_family,
    'primary_quantity_basis', v_basis,
    'opening_primary_qty', round(p_opening_primary_qty::numeric, 12),
    'primary_uom_id', v_uom_id,
    'start_date', COALESCE(p_start_date, CURRENT_DATE),
    'expected_end_date', p_expected_end_date,
    'species_text', NULLIF(btrim(COALESCE(p_species_text, '')), ''),
    'purpose', NULLIF(btrim(COALESCE(p_purpose, '')), ''),
    'opening_total_weight_present', v_opening_weight_present,
    'opening_total_weight', CASE
      WHEN v_opening_weight_present AND p_opening_total_weight IS NOT NULL
        THEN round(p_opening_total_weight::numeric, 12)
      ELSE NULL
    END,
    'weight_uom_id', v_weight_uom_id,
    'area_present', v_area_present,
    'area', CASE
      WHEN v_area_present AND p_area IS NOT NULL
        THEN round(p_area::numeric, 12)
      ELSE NULL
    END,
    'area_uom_id', v_area_uom_id,
    'warehouse_id', p_warehouse_id,
    'bin_id', v_bin_id,
    'location_description', NULLIF(btrim(COALESCE(p_location_description, '')), ''),
    'notes', NULLIF(btrim(COALESCE(p_notes, '')), '')
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(p_company_id, 'growth.batch.create', p_request_key, v_hash);

  IF v_request.request_payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_request.request_status = 'succeeded' THEN
    IF v_request.request_result_payload IS NULL THEN
      RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_request.request_result_payload;
  ELSIF NOT v_request.is_new AND v_request.request_status = 'in_progress' THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.request_status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(NULLIF(btrim(cs.base_currency_code), ''), 'MZN')
    INTO v_base_currency
  FROM public.company_settings cs
  WHERE cs.company_id = p_company_id;

  v_reference := public.next_growth_batch_reference(p_company_id);
  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);

  INSERT INTO public.growth_batches (
    company_id,
    reference_no,
    name,
    batch_family,
    primary_quantity_basis,
    primary_uom_id,
    species_text,
    purpose,
    start_date,
    expected_end_date,
    opening_primary_qty,
    opening_total_weight,
    current_total_weight,
    weight_uom_id,
    area,
    area_uom_id,
    warehouse_id,
    bin_id,
    location_description,
    base_currency_code,
    notes,
    created_by,
    updated_by
  ) VALUES (
    p_company_id,
    v_reference,
    v_name,
    v_family,
    v_basis,
    v_uom_id,
    NULLIF(btrim(COALESCE(p_species_text, '')), ''),
    NULLIF(btrim(COALESCE(p_purpose, '')), ''),
    COALESCE(p_start_date, CURRENT_DATE),
    p_expected_end_date,
    round(p_opening_primary_qty::numeric, 12),
    CASE WHEN p_opening_total_weight IS NULL THEN NULL ELSE round(p_opening_total_weight::numeric, 12) END,
    CASE WHEN p_opening_total_weight IS NULL THEN NULL ELSE round(p_opening_total_weight::numeric, 12) END,
    v_weight_uom_id,
    CASE WHEN p_area IS NULL THEN NULL ELSE round(p_area::numeric, 12) END,
    v_area_uom_id,
    p_warehouse_id,
    v_bin_id,
    NULLIF(btrim(COALESCE(p_location_description, '')), ''),
    COALESCE(v_base_currency, 'MZN'),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    v_user,
    v_user
  )
  RETURNING id INTO v_batch_id;

  v_result := jsonb_build_object(
    'batch_id', v_batch_id,
    'reference_no', v_reference,
    'status', 'draft'
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'GROWTH_BATCH',
         result_ref_id = v_batch_id::text,
         result_payload = v_result,
         updated_at = now()
   WHERE id = v_request.request_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_growth_batch_draft(
  p_company_id uuid,
  p_growth_batch_id uuid,
  p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_batch public.growth_batches%ROWTYPE;
  v_name text;
  v_family text;
  v_basis text;
  v_uom_id text;
  v_start_date date;
  v_expected_end_date date;
  v_opening_qty numeric;
  v_opening_weight numeric;
  v_weight_uom_id text;
  v_area numeric;
  v_area_uom_id text;
  v_warehouse_id uuid;
  v_bin_id text;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid_growth_batch_patch' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_growth_batch_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_batch.status <> 'draft' THEN
    IF v_batch.status = 'cancelled' THEN
      RAISE EXCEPTION 'growth_batch_cancelled' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'growth_batch_not_draft' USING ERRCODE = 'P0001';
  END IF;

  v_name := v_batch.name;
  v_family := v_batch.batch_family;
  v_basis := v_batch.primary_quantity_basis;
  v_uom_id := v_batch.primary_uom_id;
  v_start_date := v_batch.start_date;
  v_expected_end_date := v_batch.expected_end_date;
  v_opening_qty := v_batch.opening_primary_qty;
  v_opening_weight := v_batch.opening_total_weight;
  v_weight_uom_id := v_batch.weight_uom_id;
  v_area := v_batch.area;
  v_area_uom_id := v_batch.area_uom_id;
  v_warehouse_id := v_batch.warehouse_id;
  v_bin_id := v_batch.bin_id;

  IF p_patch ? 'name' THEN
    v_name := NULLIF(btrim(COALESCE(p_patch ->> 'name', '')), '');
    IF v_name IS NULL THEN RAISE EXCEPTION 'growth_batch_name_required' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_patch ? 'batch_family' THEN
    v_family := lower(NULLIF(btrim(COALESCE(p_patch ->> 'batch_family', '')), ''));
  END IF;
  IF p_patch ? 'primary_quantity_basis' THEN
    v_basis := lower(NULLIF(btrim(COALESCE(p_patch ->> 'primary_quantity_basis', '')), ''));
  END IF;
  IF p_patch ? 'primary_uom_id' THEN
    v_uom_id := NULLIF(btrim(COALESCE(p_patch ->> 'primary_uom_id', '')), '');
  END IF;
  IF p_patch ? 'start_date' THEN
    v_start_date := NULLIF(p_patch ->> 'start_date', '')::date;
    IF v_start_date IS NULL THEN RAISE EXCEPTION 'growth_batch_start_date_required' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_patch ? 'expected_end_date' THEN
    v_expected_end_date := NULLIF(p_patch ->> 'expected_end_date', '')::date;
  END IF;
  IF p_patch ? 'opening_primary_qty' THEN
    v_opening_qty := NULLIF(p_patch ->> 'opening_primary_qty', '')::numeric;
  END IF;
  IF p_patch ? 'opening_total_weight' THEN
    v_opening_weight := NULLIF(p_patch ->> 'opening_total_weight', '')::numeric;
  END IF;
  IF p_patch ? 'weight_uom_id' THEN
    v_weight_uom_id := NULLIF(btrim(COALESCE(p_patch ->> 'weight_uom_id', '')), '');
  END IF;
  IF p_patch ? 'area' THEN
    v_area := NULLIF(p_patch ->> 'area', '')::numeric;
    IF v_area IS NULL AND NOT (p_patch ? 'area_uom_id') THEN
      v_area_uom_id := NULL;
    END IF;
  END IF;
  IF p_patch ? 'area_uom_id' THEN
    v_area_uom_id := NULLIF(btrim(COALESCE(p_patch ->> 'area_uom_id', '')), '');
  END IF;
  IF p_patch ? 'warehouse_id' THEN
    v_warehouse_id := NULLIF(p_patch ->> 'warehouse_id', '')::uuid;
    IF v_warehouse_id IS NULL AND NOT (p_patch ? 'bin_id') THEN
      v_bin_id := NULL;
    END IF;
  END IF;
  IF p_patch ? 'bin_id' THEN
    v_bin_id := NULLIF(btrim(COALESCE(p_patch ->> 'bin_id', '')), '');
  END IF;

  IF v_family NOT IN ('poultry', 'livestock', 'fish', 'crop', 'nursery', 'other') THEN
    RAISE EXCEPTION 'invalid_growth_batch_family' USING ERRCODE = '22023';
  END IF;
  IF v_basis NOT IN ('count', 'weight', 'area', 'other') THEN
    RAISE EXCEPTION 'invalid_growth_batch_quantity_basis' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_opening_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_growth_batch_quantity' USING ERRCODE = '22023';
  END IF;
  IF v_basis = 'count' AND v_opening_qty <> trunc(v_opening_qty) THEN
    RAISE EXCEPTION 'fractional_count_not_allowed' USING ERRCODE = '22023';
  END IF;
  IF v_uom_id IS NULL THEN
    RAISE EXCEPTION 'uom_required' USING ERRCODE = '22023';
  END IF;
  IF v_weight_uom_id IS NULL AND v_basis = 'weight' THEN
    v_weight_uom_id := v_uom_id;
  END IF;
  IF v_opening_weight IS NOT NULL AND v_opening_weight < 0 THEN
    RAISE EXCEPTION 'invalid_growth_batch_weight' USING ERRCODE = '22023';
  END IF;
  IF v_opening_weight IS NOT NULL AND v_weight_uom_id IS NULL THEN
    RAISE EXCEPTION 'growth_batch_weight_uom_required' USING ERRCODE = '22023';
  END IF;
  IF v_area IS NOT NULL AND v_area < 0 THEN
    RAISE EXCEPTION 'invalid_growth_batch_area' USING ERRCODE = '22023';
  END IF;
  IF v_area IS NOT NULL AND v_area_uom_id IS NULL THEN
    RAISE EXCEPTION 'area_uom_required' USING ERRCODE = '22023';
  END IF;
  IF v_expected_end_date IS NOT NULL AND v_expected_end_date < v_start_date THEN
    RAISE EXCEPTION 'invalid_growth_batch_dates' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);

  UPDATE public.growth_batches
     SET name = v_name,
         batch_family = v_family,
         primary_quantity_basis = v_basis,
         primary_uom_id = v_uom_id,
         species_text = CASE WHEN p_patch ? 'species_text' THEN NULLIF(btrim(COALESCE(p_patch ->> 'species_text', '')), '') ELSE species_text END,
         purpose = CASE WHEN p_patch ? 'purpose' THEN NULLIF(btrim(COALESCE(p_patch ->> 'purpose', '')), '') ELSE purpose END,
         start_date = v_start_date,
         expected_end_date = v_expected_end_date,
         opening_primary_qty = round(v_opening_qty::numeric, 12),
         opening_total_weight = CASE WHEN v_opening_weight IS NULL THEN NULL ELSE round(v_opening_weight::numeric, 12) END,
         current_total_weight = CASE WHEN v_opening_weight IS NULL THEN NULL ELSE round(v_opening_weight::numeric, 12) END,
         weight_uom_id = v_weight_uom_id,
         area = CASE WHEN v_area IS NULL THEN NULL ELSE round(v_area::numeric, 12) END,
         area_uom_id = v_area_uom_id,
         warehouse_id = v_warehouse_id,
         bin_id = v_bin_id,
         location_description = CASE WHEN p_patch ? 'location_description' THEN NULLIF(btrim(COALESCE(p_patch ->> 'location_description', '')), '') ELSE location_description END,
         notes = CASE WHEN p_patch ? 'notes' THEN NULLIF(btrim(COALESCE(p_patch ->> 'notes', '')), '') ELSE notes END,
         updated_by = v_user
   WHERE id = p_growth_batch_id
     AND company_id = p_company_id;

  RETURN jsonb_build_object(
    'batch_id', p_growth_batch_id,
    'status', 'draft'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_growth_batch_draft(
  p_company_id uuid,
  p_growth_batch_id uuid,
  p_reason text,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_batch public.growth_batches%ROWTYPE;
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_event_id uuid;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'growth_batch_cancel_reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_growth_batch_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_payload := jsonb_build_object(
    'company_id', p_company_id,
    'batch_id', p_growth_batch_id,
    'reason', v_reason
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(p_company_id, 'growth.batch.cancel', p_request_key, v_hash);

  IF v_request.request_payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_request.request_status = 'succeeded' THEN
    RETURN v_request.request_result_payload;
  ELSIF NOT v_request.is_new AND v_request.request_status = 'in_progress' THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.request_status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  IF v_batch.status <> 'draft' THEN
    IF v_batch.status = 'active' THEN
      RAISE EXCEPTION 'growth_batch_not_draft' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'growth_batch_cancelled' USING ERRCODE = 'P0001';
  END IF;

  v_sequence := v_batch.latest_event_sequence + 1;
  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);

  INSERT INTO public.growth_batch_events (
    company_id,
    growth_batch_id,
    event_sequence,
    event_reference,
    event_type,
    event_at,
    event_date,
    currency_code,
    reason,
    posting_request_id,
    created_by
  ) VALUES (
    p_company_id,
    p_growth_batch_id,
    v_sequence,
    v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0'),
    'cancellation',
    now(),
    CURRENT_DATE,
    v_batch.base_currency_code,
    v_reason,
    v_request.request_id,
    v_user
  )
  RETURNING id INTO v_event_id;

  UPDATE public.growth_batches
     SET status = 'cancelled',
         cancellation_reason = v_reason,
         cancelled_by = v_user,
         cancelled_at = now(),
         latest_event_sequence = v_sequence,
         updated_by = v_user
   WHERE id = p_growth_batch_id
     AND company_id = p_company_id;

  v_result := jsonb_build_object(
    'batch_id', p_growth_batch_id,
    'reference_no', v_batch.reference_no,
    'event_id', v_event_id,
    'status', 'cancelled'
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'GROWTH_BATCH',
         result_ref_id = p_growth_batch_id::text,
         result_payload = v_result,
         updated_at = now()
   WHERE id = v_request.request_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_growth_batch(
  p_company_id uuid,
  p_growth_batch_id uuid,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_batch public.growth_batches%ROWTYPE;
  v_base_currency text := 'MZN';
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_event_id uuid;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_growth_batch_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_payload := jsonb_build_object(
    'company_id', p_company_id,
    'batch_id', p_growth_batch_id,
    'reference_no', v_batch.reference_no,
    'name', v_batch.name,
    'batch_family', v_batch.batch_family,
    'primary_quantity_basis', v_batch.primary_quantity_basis,
    'primary_uom_id', v_batch.primary_uom_id,
    'opening_primary_qty', round(v_batch.opening_primary_qty::numeric, 12),
    'opening_total_weight_present', v_batch.opening_total_weight IS NOT NULL,
    'opening_total_weight', CASE
      WHEN v_batch.opening_total_weight IS NULL THEN NULL
      ELSE round(v_batch.opening_total_weight::numeric, 12)
    END,
    'weight_uom_id', v_batch.weight_uom_id,
    'area_present', v_batch.area IS NOT NULL,
    'area', CASE
      WHEN v_batch.area IS NULL THEN NULL
      ELSE round(v_batch.area::numeric, 12)
    END,
    'area_uom_id', v_batch.area_uom_id,
    'start_date', v_batch.start_date,
    'expected_end_date', v_batch.expected_end_date,
    'warehouse_id', v_batch.warehouse_id,
    'bin_id', v_batch.bin_id,
    'location_description', v_batch.location_description,
    'species_text', v_batch.species_text,
    'purpose', v_batch.purpose,
    'notes', v_batch.notes
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(p_company_id, 'growth.batch.activate', p_request_key, v_hash);

  IF v_request.request_payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_request.request_status = 'succeeded' THEN
    RETURN v_request.request_result_payload;
  ELSIF NOT v_request.is_new AND v_request.request_status = 'in_progress' THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.request_status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  IF v_batch.status <> 'draft' THEN
    IF v_batch.status = 'cancelled' THEN
      RAISE EXCEPTION 'growth_batch_cancelled' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'growth_batch_not_draft' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_batch.opening_primary_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_growth_batch_quantity' USING ERRCODE = '22023';
  END IF;
  IF v_batch.primary_quantity_basis = 'count' AND v_batch.opening_primary_qty <> trunc(v_batch.opening_primary_qty) THEN
    RAISE EXCEPTION 'fractional_count_not_allowed' USING ERRCODE = '22023';
  END IF;
  IF v_batch.start_date IS NULL THEN
    RAISE EXCEPTION 'growth_batch_start_date_required' USING ERRCODE = '22023';
  END IF;
  IF v_batch.start_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_start_date_future' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(btrim(cs.base_currency_code), ''), v_batch.base_currency_code, 'MZN')
    INTO v_base_currency
  FROM public.company_settings cs
  WHERE cs.company_id = p_company_id;
  v_base_currency := COALESCE(v_base_currency, v_batch.base_currency_code, 'MZN');

  v_sequence := v_batch.latest_event_sequence + 1;
  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);

  INSERT INTO public.growth_batch_events (
    company_id,
    growth_batch_id,
    event_sequence,
    event_reference,
    event_type,
    event_at,
    event_date,
    quantity_delta,
    weight_value,
    weight_uom_id,
    currency_code,
    notes,
    posting_request_id,
    created_by
  ) VALUES (
    p_company_id,
    p_growth_batch_id,
    v_sequence,
    v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0'),
    'activation',
    now(),
    v_batch.start_date,
    v_batch.opening_primary_qty,
    v_batch.opening_total_weight,
    CASE WHEN v_batch.opening_total_weight IS NULL THEN NULL ELSE v_batch.weight_uom_id END,
    v_base_currency,
    v_batch.notes,
    v_request.request_id,
    v_user
  )
  RETURNING id INTO v_event_id;

  UPDATE public.growth_batches
     SET status = 'active',
         current_primary_qty = opening_primary_qty,
         current_total_weight = opening_total_weight,
         base_currency_code = v_base_currency,
         accumulated_material_cost = 0,
         accumulated_direct_cost = 0,
         accumulated_total_cost = 0,
         harvested_cost = 0,
         remaining_cost = 0,
         latest_event_sequence = v_sequence,
         activated_by = v_user,
         activated_at = now(),
         updated_by = v_user
   WHERE id = p_growth_batch_id
     AND company_id = p_company_id;

  v_result := jsonb_build_object(
    'batch_id', p_growth_batch_id,
    'reference_no', v_batch.reference_no,
    'event_id', v_event_id,
    'status', 'active',
    'current_primary_qty', v_batch.opening_primary_qty
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'GROWTH_BATCH',
         result_ref_id = p_growth_batch_id::text,
         result_payload = v_result,
         updated_at = now()
   WHERE id = v_request.request_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_growth_batch_measurement(
  p_company_id uuid,
  p_growth_batch_id uuid,
  p_measurement_type text,
  p_value numeric,
  p_uom_id text,
  p_observed_at timestamptz DEFAULT NULL,
  p_sample_size numeric DEFAULT NULL,
  p_minimum numeric DEFAULT NULL,
  p_maximum numeric DEFAULT NULL,
  p_average numeric DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_request_key text DEFAULT NULL,
  p_sample_size_present boolean DEFAULT false,
  p_minimum_present boolean DEFAULT false,
  p_maximum_present boolean DEFAULT false,
  p_average_present boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_batch public.growth_batches%ROWTYPE;
  v_type text := lower(NULLIF(btrim(COALESCE(p_measurement_type, '')), ''));
  v_uom_id text := NULLIF(btrim(COALESCE(p_uom_id, '')), '');
  v_uom_family text;
  v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_notes text := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_observed_at timestamptz := COALESCE(p_observed_at, now());
  v_sample_size_present boolean := COALESCE(p_sample_size_present, false) OR p_sample_size IS NOT NULL;
  v_minimum_present boolean := COALESCE(p_minimum_present, false) OR p_minimum IS NOT NULL;
  v_maximum_present boolean := COALESCE(p_maximum_present, false) OR p_maximum IS NOT NULL;
  v_average_present boolean := COALESCE(p_average_present, false) OR p_average IS NOT NULL;
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_event_id uuid;
  v_measurement_id uuid;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  IF v_type NOT IN ('total_weight', 'average_weight', 'height', 'area_observation', 'temperature', 'other') THEN
    RAISE EXCEPTION 'invalid_measurement' USING ERRCODE = '22023';
  END IF;
  IF p_value IS NULL OR v_uom_id IS NULL THEN
    RAISE EXCEPTION 'invalid_measurement' USING ERRCODE = '22023';
  END IF;
  IF v_type <> 'temperature' AND p_value < 0 THEN
    RAISE EXCEPTION 'invalid_measurement' USING ERRCODE = '22023';
  END IF;
  IF v_type = 'other' AND v_description IS NULL THEN
    RAISE EXCEPTION 'invalid_measurement' USING ERRCODE = '22023';
  END IF;
  IF p_sample_size IS NOT NULL AND p_sample_size <= 0 THEN
    RAISE EXCEPTION 'invalid_measurement' USING ERRCODE = '22023';
  END IF;
  IF v_type <> 'temperature' AND p_minimum IS NOT NULL AND p_minimum < 0 THEN RAISE EXCEPTION 'invalid_measurement' USING ERRCODE = '22023'; END IF;
  IF v_type <> 'temperature' AND p_maximum IS NOT NULL AND p_maximum < 0 THEN RAISE EXCEPTION 'invalid_measurement' USING ERRCODE = '22023'; END IF;
  IF v_type <> 'temperature' AND p_average IS NOT NULL AND p_average < 0 THEN RAISE EXCEPTION 'invalid_measurement' USING ERRCODE = '22023'; END IF;
  IF p_minimum IS NOT NULL AND p_maximum IS NOT NULL AND p_minimum > p_maximum THEN
    RAISE EXCEPTION 'invalid_measurement' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_growth_batch_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_payload := jsonb_build_object(
    'company_id', p_company_id,
    'batch_id', p_growth_batch_id,
    'measurement_type', v_type,
    'value', round(p_value::numeric, 12),
    'uom_id', v_uom_id,
    'observed_at', v_observed_at,
    'sample_size_present', v_sample_size_present,
    'sample_size', CASE
      WHEN v_sample_size_present AND p_sample_size IS NOT NULL THEN round(p_sample_size::numeric, 12)
      ELSE NULL
    END,
    'minimum_present', v_minimum_present,
    'minimum', CASE
      WHEN v_minimum_present AND p_minimum IS NOT NULL THEN round(p_minimum::numeric, 12)
      ELSE NULL
    END,
    'maximum_present', v_maximum_present,
    'maximum', CASE
      WHEN v_maximum_present AND p_maximum IS NOT NULL THEN round(p_maximum::numeric, 12)
      ELSE NULL
    END,
    'average_present', v_average_present,
    'average', CASE
      WHEN v_average_present AND p_average IS NOT NULL THEN round(p_average::numeric, 12)
      ELSE NULL
    END,
    'description', v_description,
    'notes', v_notes
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(p_company_id, 'growth.batch.measurement', p_request_key, v_hash);

  IF v_request.request_payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_request.request_status = 'succeeded' THEN
    RETURN v_request.request_result_payload;
  ELSIF NOT v_request.is_new AND v_request.request_status = 'in_progress' THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.request_status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  IF v_batch.status <> 'active' THEN
    IF v_batch.status = 'cancelled' THEN
      RAISE EXCEPTION 'growth_batch_cancelled' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'growth_batch_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF v_observed_at::date < v_batch.start_date THEN
    RAISE EXCEPTION 'growth_batch_event_before_start' USING ERRCODE = '22023';
  END IF;
  IF v_observed_at::date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_event_future' USING ERRCODE = '22023';
  END IF;

  SELECT u.family
    INTO v_uom_family
  FROM public.uoms u
  WHERE u.id = v_uom_id;
  IF v_uom_family IS NULL THEN
    RAISE EXCEPTION 'uom_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_type IN ('total_weight', 'average_weight') THEN
    IF v_batch.weight_uom_id IS NULL THEN
      RAISE EXCEPTION 'growth_batch_weight_uom_required' USING ERRCODE = '22023';
    END IF;
    IF v_uom_id <> v_batch.weight_uom_id OR v_uom_family <> 'mass' THEN
      RAISE EXCEPTION 'growth_batch_weight_uom_mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF v_type = 'area_observation' THEN
    IF v_batch.area_uom_id IS NULL THEN
      RAISE EXCEPTION 'growth_batch_area_uom_required' USING ERRCODE = '22023';
    END IF;
    IF v_uom_id <> v_batch.area_uom_id OR v_uom_family <> 'area' THEN
      RAISE EXCEPTION 'growth_batch_area_uom_mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF v_type = 'height' AND v_uom_family <> 'length' THEN
    RAISE EXCEPTION 'growth_batch_height_uom_mismatch' USING ERRCODE = '22023';
  END IF;

  v_sequence := v_batch.latest_event_sequence + 1;
  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);

  INSERT INTO public.growth_batch_events (
    company_id,
    growth_batch_id,
    event_sequence,
    event_reference,
    event_type,
    event_at,
    event_date,
    weight_value,
    weight_uom_id,
    currency_code,
    notes,
    posting_request_id,
    created_by
  ) VALUES (
    p_company_id,
    p_growth_batch_id,
    v_sequence,
    v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0'),
    'measurement',
    now(),
    v_observed_at::date,
    CASE WHEN v_type = 'total_weight' THEN p_value ELSE NULL END,
    CASE WHEN v_type = 'total_weight' THEN v_batch.weight_uom_id ELSE NULL END,
    v_batch.base_currency_code,
    v_notes,
    v_request.request_id,
    v_user
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.growth_batch_measurements (
    company_id,
    growth_batch_id,
    growth_batch_event_id,
    measurement_type,
    description,
    value,
    uom_id,
    sample_size,
    minimum_value,
    maximum_value,
    average_value,
    observed_at,
    notes,
    created_by
  ) VALUES (
    p_company_id,
    p_growth_batch_id,
    v_event_id,
    v_type,
    v_description,
    round(p_value::numeric, 12),
    v_uom_id,
    p_sample_size,
    p_minimum,
    p_maximum,
    p_average,
    v_observed_at,
    v_notes,
    v_user
  )
  RETURNING id INTO v_measurement_id;

  UPDATE public.growth_batches
     SET current_total_weight = CASE WHEN v_type = 'total_weight' THEN round(p_value::numeric, 12) ELSE current_total_weight END,
         latest_event_sequence = v_sequence,
         updated_by = v_user
   WHERE id = p_growth_batch_id
     AND company_id = p_company_id;

  v_result := jsonb_build_object(
    'batch_id', p_growth_batch_id,
    'event_id', v_event_id,
    'measurement_id', v_measurement_id,
    'event_sequence', v_sequence,
    'status', 'active'
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'GROWTH_BATCH_EVENT',
         result_ref_id = v_event_id::text,
         result_payload = v_result,
         updated_at = now()
   WHERE id = v_request.request_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_growth_batch_direct_cost(
  p_company_id uuid,
  p_growth_batch_id uuid,
  p_category text,
  p_description text,
  p_amount numeric,
  p_event_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_batch public.growth_batches%ROWTYPE;
  v_category text := lower(NULLIF(btrim(COALESCE(p_category, '')), ''));
  v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_notes text := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_event_date date := COALESCE(p_event_date, CURRENT_DATE);
  v_payload jsonb;
  v_hash text;
  v_request record;
  v_sequence integer;
  v_event_id uuid;
  v_cost_id uuid;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  IF v_category NOT IN ('labour', 'utilities', 'veterinary', 'transport', 'land_preparation', 'water', 'rent', 'other') THEN
    RAISE EXCEPTION 'invalid_direct_cost' USING ERRCODE = '22023';
  END IF;
  IF v_description IS NULL THEN
    RAISE EXCEPTION 'invalid_direct_cost' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_direct_cost' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_batch
  FROM public.growth_batches
  WHERE id = p_growth_batch_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'growth_batch_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_payload := jsonb_build_object(
    'company_id', p_company_id,
    'batch_id', p_growth_batch_id,
    'category', v_category,
    'description', v_description,
    'amount', round(p_amount::numeric, 12),
    'event_date', v_event_date,
    'notes', v_notes
  );
  v_hash := md5(v_payload::text);

  SELECT *
    INTO v_request
  FROM public.stockwise_claim_growth_request(p_company_id, 'growth.batch.cost', p_request_key, v_hash);

  IF v_request.request_payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_request.request_status = 'succeeded' THEN
    RETURN v_request.request_result_payload;
  ELSIF NOT v_request.is_new AND v_request.request_status = 'in_progress' THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.request_status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  IF v_batch.status <> 'active' THEN
    IF v_batch.status = 'cancelled' THEN
      RAISE EXCEPTION 'growth_batch_cancelled' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'growth_batch_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF v_event_date < v_batch.start_date THEN
    RAISE EXCEPTION 'growth_batch_event_before_start' USING ERRCODE = '22023';
  END IF;
  IF v_event_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'growth_batch_event_future' USING ERRCODE = '22023';
  END IF;

  v_sequence := v_batch.latest_event_sequence + 1;
  PERFORM set_config('stockwise.growth_batch_rpc', 'on', true);

  INSERT INTO public.growth_batch_events (
    company_id,
    growth_batch_id,
    event_sequence,
    event_reference,
    event_type,
    event_at,
    event_date,
    direct_cost_delta,
    total_cost_delta,
    currency_code,
    notes,
    posting_request_id,
    created_by
  ) VALUES (
    p_company_id,
    p_growth_batch_id,
    v_sequence,
    v_batch.reference_no || '-E' || lpad(v_sequence::text, 6, '0'),
    'direct_cost',
    now(),
    v_event_date,
    round(p_amount::numeric, 6),
    round(p_amount::numeric, 6),
    v_batch.base_currency_code,
    v_notes,
    v_request.request_id,
    v_user
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.growth_batch_direct_costs (
    company_id,
    growth_batch_id,
    growth_batch_event_id,
    category,
    description,
    amount,
    currency_code,
    event_date,
    created_by
  ) VALUES (
    p_company_id,
    p_growth_batch_id,
    v_event_id,
    v_category,
    v_description,
    round(p_amount::numeric, 6),
    v_batch.base_currency_code,
    v_event_date,
    v_user
  )
  RETURNING id INTO v_cost_id;

  UPDATE public.growth_batches
     SET accumulated_direct_cost = round((accumulated_direct_cost + p_amount)::numeric, 6),
         accumulated_total_cost = round((accumulated_material_cost + accumulated_direct_cost + p_amount)::numeric, 6),
         remaining_cost = round((accumulated_material_cost + accumulated_direct_cost + p_amount - harvested_cost)::numeric, 6),
         latest_event_sequence = v_sequence,
         updated_by = v_user
   WHERE id = p_growth_batch_id
     AND company_id = p_company_id;

  v_result := jsonb_build_object(
    'batch_id', p_growth_batch_id,
    'event_id', v_event_id,
    'direct_cost_id', v_cost_id,
    'event_sequence', v_sequence,
    'amount', round(p_amount::numeric, 6),
    'status', 'active'
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'GROWTH_BATCH_EVENT',
         result_ref_id = v_event_id::text,
         result_payload = v_result,
         updated_at = now()
   WHERE id = v_request.request_id;

  RETURN v_result;
END;
$$;

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
  gb.cancelled_at
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
WHERE gb.company_id = public.current_company_id();

CREATE OR REPLACE VIEW public.growth_batch_current_state WITH (security_invoker = true) AS
SELECT
  r.*,
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
  gb.cancelled_by
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
) dc ON true;

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
    ELSE '{}'::jsonb
  END AS typed_detail_summary
FROM public.growth_batch_events e
LEFT JOIN public.growth_batch_measurements m ON m.growth_batch_event_id = e.id
LEFT JOIN public.growth_batch_direct_costs d ON d.growth_batch_event_id = e.id
LEFT JOIN public.uoms wu ON wu.id = e.weight_uom_id
LEFT JOIN public.uoms mu ON mu.id = m.uom_id
LEFT JOIN public.profiles p ON p.id = e.created_by
WHERE e.company_id = public.current_company_id();

CREATE OR REPLACE VIEW public.growth_batch_measurement_history WITH (security_invoker = true) AS
SELECT
  m.id,
  m.company_id,
  m.growth_batch_id,
  m.growth_batch_event_id,
  e.id AS event_id,
  e.event_sequence,
  e.event_reference,
  e.event_date AS event_effective_date,
  e.event_at AS event_created_at,
  m.observed_at,
  m.measurement_type,
  m.description,
  m.value,
  m.uom_id,
  u.code AS uom_code,
  m.sample_size,
  m.minimum_value,
  m.maximum_value,
  m.average_value,
  m.notes,
  m.created_by AS actor_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), 'Team member') AS actor_display_name
FROM public.growth_batch_measurements m
JOIN public.growth_batch_events e
  ON e.id = m.growth_batch_event_id
 AND e.company_id = m.company_id
 AND e.growth_batch_id = m.growth_batch_id
LEFT JOIN public.uoms u ON u.id = m.uom_id
LEFT JOIN public.profiles p ON p.id = m.created_by
WHERE m.company_id = public.current_company_id();

CREATE OR REPLACE VIEW public.growth_batch_direct_cost_history WITH (security_invoker = true) AS
SELECT
  d.id,
  d.company_id,
  d.growth_batch_id,
  d.growth_batch_event_id,
  e.id AS event_id,
  e.event_sequence,
  e.event_reference,
  e.event_date AS event_effective_date,
  e.event_at AS event_created_at,
  d.event_date,
  d.category,
  d.description,
  d.amount,
  d.currency_code,
  d.created_at,
  d.created_by AS actor_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), 'Team member') AS actor_display_name
FROM public.growth_batch_direct_costs d
JOIN public.growth_batch_events e
  ON e.id = d.growth_batch_event_id
 AND e.company_id = d.company_id
 AND e.growth_batch_id = d.growth_batch_id
LEFT JOIN public.profiles p ON p.id = d.created_by
WHERE d.company_id = public.current_company_id();

ALTER TABLE public.growth_batch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_direct_costs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.growth_batch_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_measurements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_batch_direct_costs FORCE ROW LEVEL SECURITY;

CREATE POLICY growth_batch_events_select_active_company
  ON public.growth_batch_events
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

CREATE POLICY growth_batch_measurements_select_active_company
  ON public.growth_batch_measurements
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

CREATE POLICY growth_batch_direct_costs_select_active_company
  ON public.growth_batch_direct_costs
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(
      company_id,
      ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::public.member_role[]
    )
  );

REVOKE ALL ON public.growth_batch_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_measurements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_direct_costs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batches_register FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_current_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_event_timeline FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_measurement_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_batch_direct_cost_history FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.growth_batch_events TO authenticated;
GRANT SELECT ON public.growth_batch_measurements TO authenticated;
GRANT SELECT ON public.growth_batch_direct_costs TO authenticated;
GRANT SELECT ON public.growth_batches_register TO authenticated;
GRANT SELECT ON public.growth_batch_current_state TO authenticated;
GRANT SELECT ON public.growth_batch_event_timeline TO authenticated;
GRANT SELECT ON public.growth_batch_measurement_history TO authenticated;
GRANT SELECT ON public.growth_batch_direct_cost_history TO authenticated;

GRANT ALL ON public.growth_batch_events TO service_role;
GRANT ALL ON public.growth_batch_measurements TO service_role;
GRANT ALL ON public.growth_batch_direct_costs TO service_role;
GRANT SELECT ON public.growth_batches_register TO service_role;
GRANT SELECT ON public.growth_batch_current_state TO service_role;
GRANT SELECT ON public.growth_batch_event_timeline TO service_role;
GRANT SELECT ON public.growth_batch_measurement_history TO service_role;
GRANT SELECT ON public.growth_batch_direct_cost_history TO service_role;

ALTER FUNCTION public.create_growth_batch_draft(uuid, text, text, text, numeric, text, date, date, text, text, numeric, text, numeric, text, uuid, text, text, text, text, boolean, boolean) OWNER TO postgres;
ALTER FUNCTION public.update_growth_batch_draft(uuid, uuid, jsonb) OWNER TO postgres;
ALTER FUNCTION public.cancel_growth_batch_draft(uuid, uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.activate_growth_batch(uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.record_growth_batch_measurement(uuid, uuid, text, numeric, text, timestamptz, numeric, numeric, numeric, numeric, text, text, text, boolean, boolean, boolean, boolean) OWNER TO postgres;
ALTER FUNCTION public.record_growth_batch_direct_cost(uuid, uuid, text, text, numeric, date, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_growth_batch_draft(uuid, text, text, text, numeric, text, date, date, text, text, numeric, text, numeric, text, uuid, text, text, text, text, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_growth_batch_draft(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_growth_batch_draft(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.activate_growth_batch(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_growth_batch_measurement(uuid, uuid, text, numeric, text, timestamptz, numeric, numeric, numeric, numeric, text, text, text, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_growth_batch_direct_cost(uuid, uuid, text, text, numeric, date, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_growth_batch_draft(uuid, text, text, text, numeric, text, date, date, text, text, numeric, text, numeric, text, uuid, text, text, text, text, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_growth_batch_draft(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_growth_batch_draft(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_growth_batch(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_growth_batch_measurement(uuid, uuid, text, numeric, text, timestamptz, numeric, numeric, numeric, numeric, text, text, text, boolean, boolean, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_growth_batch_direct_cost(uuid, uuid, text, text, numeric, date, text, text) TO authenticated;

COMMENT ON TABLE public.growth_batch_events IS
  'Immutable Growth Batch event ledger for activation, measurement, memo direct cost, and draft cancellation in G1-G2.';
COMMENT ON TABLE public.growth_batch_measurements IS
  'Immutable typed Growth Batch measurement details. Measurements do not create stock movements or finance postings.';
COMMENT ON TABLE public.growth_batch_direct_costs IS
  'Immutable memo direct-cost details. These costs update Growth Batch rollups only and do not create cash, bank, vendor bill, settlement, journal, invoice, or stock rows.';
COMMENT ON FUNCTION public.create_growth_batch_draft(uuid, text, text, text, numeric, text, date, date, text, text, numeric, text, numeric, text, uuid, text, text, text, text, boolean, boolean)
  IS 'Idempotently creates a draft Growth Batch using operation type growth.batch.create.';
COMMENT ON FUNCTION public.activate_growth_batch(uuid, uuid, text)
  IS 'Idempotently activates a draft Growth Batch and freezes opening state using operation type growth.batch.activate.';
COMMENT ON FUNCTION public.record_growth_batch_measurement(uuid, uuid, text, numeric, text, timestamptz, numeric, numeric, numeric, numeric, text, text, text, boolean, boolean, boolean, boolean)
  IS 'Idempotently records a Growth Batch measurement using operation type growth.batch.measurement.';
COMMENT ON FUNCTION public.record_growth_batch_direct_cost(uuid, uuid, text, text, numeric, date, text, text)
  IS 'Idempotently records a memo Growth Batch direct cost using operation type growth.batch.cost.';
