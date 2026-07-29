-- SVC-1: governed service execution and actual-cost evidence.

CREATE TABLE public.service_job_counters (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.service_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_reference text NOT NULL,
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description text,
  execution_status text NOT NULL DEFAULT 'planned'
    CHECK (execution_status IN ('planned','in_progress','completed','cancelled')),
  costing_status text NOT NULL DEFAULT 'open'
    CHECK (costing_status IN ('open','finalised')),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_completion timestamptz,
  costing_finalised_at timestamptz,
  costing_finalised_by uuid,
  costing_reopened_at timestamptz,
  costing_reopened_by uuid,
  reopen_reason text,
  zero_cost_reason text,
  material_cost numeric NOT NULL DEFAULT 0,
  labour_cost numeric NOT NULL DEFAULT 0,
  subcontractor_cost numeric NOT NULL DEFAULT 0,
  supplier_cost numeric NOT NULL DEFAULT 0,
  other_direct_cost numeric NOT NULL DEFAULT 0,
  total_actual_cost numeric NOT NULL DEFAULT 0,
  cost_fingerprint text,
  explicit_zero boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  replaces_service_job_id uuid REFERENCES public.service_jobs(id),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, job_reference),
  CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end >= scheduled_start),
  CHECK (material_cost >= 0 AND labour_cost >= 0 AND subcontractor_cost >= 0
    AND supplier_cost >= 0 AND other_direct_cost >= 0 AND total_actual_cost >= 0)
);

CREATE TABLE public.service_job_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id),
  sales_order_line_id uuid NOT NULL REFERENCES public.sales_order_lines(id),
  service_item_id uuid NOT NULL REFERENCES public.items(id),
  description_snapshot text NOT NULL,
  billing_basis text NOT NULL CHECK (billing_basis IN ('per_job','per_hour','fixed_fee')),
  commercial_quantity numeric NOT NULL CHECK (commercial_quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_job_id, sales_order_line_id)
);

ALTER TABLE public.service_job_lines
  ADD COLUMN active_link boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX service_job_lines_one_active_job_idx
  ON public.service_job_lines (sales_order_line_id) WHERE active_link;

CREATE TABLE public.service_job_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id),
  worker_user_id uuid,
  worker_display_name text NOT NULL CHECK (length(btrim(worker_display_name)) > 0),
  work_date date NOT NULL,
  started_at timestamptz,
  stopped_at timestamptz,
  duration_minutes integer,
  notes text,
  source text NOT NULL CHECK (source IN ('timer','manual')),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
  CHECK (
    (source = 'manual' AND started_at IS NULL AND stopped_at IS NULL AND duration_minutes IS NOT NULL)
    OR (source = 'timer' AND started_at IS NOT NULL
      AND ((stopped_at IS NULL AND duration_minutes IS NULL)
        OR (stopped_at >= started_at AND duration_minutes IS NOT NULL)))
  )
);
CREATE UNIQUE INDEX service_job_one_open_timer_per_worker_idx
  ON public.service_job_time_entries (company_id, worker_user_id)
  WHERE source = 'timer' AND stopped_at IS NULL;

CREATE TABLE public.service_job_direct_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id),
  category text NOT NULL CHECK (category IN ('labour','subcontractor','other_direct_cost')),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  external_reference text,
  supplier_id uuid REFERENCES public.suppliers(id),
  source_currency text NOT NULL,
  source_amount numeric NOT NULL CHECK (source_amount > 0),
  fx_to_base numeric NOT NULL CHECK (fx_to_base > 0),
  base_amount numeric NOT NULL CHECK (base_amount > 0),
  cost_date date NOT NULL,
  time_entry_id uuid REFERENCES public.service_job_time_entries(id),
  reverses_id uuid REFERENCES public.service_job_direct_costs(id),
  reversed_by_id uuid REFERENCES public.service_job_direct_costs(id),
  reversal_reason text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reverses_id)
);

CREATE TABLE public.service_job_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id),
  supply_type text NOT NULL CHECK (supply_type IN ('company','customer')),
  item_id uuid REFERENCES public.items(id),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  quantity numeric NOT NULL CHECK (quantity > 0),
  uom_id text NOT NULL REFERENCES public.uoms(id),
  warehouse_id uuid REFERENCES public.warehouses(id),
  bin_id text REFERENCES public.bins(id),
  stock_movement_id uuid REFERENCES public.stock_movements(id),
  base_quantity numeric,
  unit_cost numeric,
  base_amount numeric NOT NULL DEFAULT 0 CHECK (base_amount >= 0),
  occurred_on date NOT NULL DEFAULT current_date,
  notes text,
  reverses_id uuid REFERENCES public.service_job_materials(id),
  reversed_by_id uuid REFERENCES public.service_job_materials(id),
  reversal_reason text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stock_movement_id),
  UNIQUE (reverses_id),
  CHECK ((supply_type = 'customer' AND stock_movement_id IS NULL AND base_amount = 0)
    OR (supply_type = 'company' AND item_id IS NOT NULL AND stock_movement_id IS NOT NULL))
);

CREATE TABLE public.service_job_vendor_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id),
  vendor_bill_id uuid NOT NULL REFERENCES public.vendor_bills(id),
  vendor_bill_line_id uuid NOT NULL REFERENCES public.vendor_bill_lines(id),
  source_amount numeric NOT NULL CHECK (source_amount > 0),
  base_amount numeric NOT NULL CHECK (base_amount > 0),
  cost_category text NOT NULL DEFAULT 'supplier'
    CHECK (cost_category IN ('supplier','subcontractor')),
  allocation_date date NOT NULL,
  reverses_id uuid REFERENCES public.service_job_vendor_allocations(id),
  reversed_by_id uuid REFERENCES public.service_job_vendor_allocations(id),
  reversal_reason text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reverses_id)
);

CREATE TABLE public.service_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id),
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL DEFAULT auth.uid(),
  previous_state jsonb,
  new_state jsonb,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX service_jobs_company_status_idx ON public.service_jobs(company_id, execution_status, costing_status);
CREATE INDEX service_jobs_sales_order_idx ON public.service_jobs(company_id, sales_order_id);
CREATE INDEX service_job_lines_job_idx ON public.service_job_lines(company_id, service_job_id);
CREATE INDEX service_job_time_job_idx ON public.service_job_time_entries(company_id, service_job_id, work_date);
CREATE INDEX service_job_direct_cost_job_idx ON public.service_job_direct_costs(company_id, service_job_id);
CREATE INDEX service_job_material_job_idx ON public.service_job_materials(company_id, service_job_id);
CREATE INDEX service_job_vendor_job_idx ON public.service_job_vendor_allocations(company_id, service_job_id);
CREATE INDEX service_job_vendor_line_idx ON public.service_job_vendor_allocations(company_id, vendor_bill_line_id);
CREATE INDEX service_job_events_job_idx ON public.service_job_events(company_id, service_job_id, occurred_at);

ALTER TABLE public.service_job_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE public.service_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_time_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_direct_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_direct_costs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_materials FORCE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_vendor_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_vendor_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_events FORCE ROW LEVEL SECURITY;

CREATE POLICY service_jobs_select ON public.service_jobs FOR SELECT TO authenticated
  USING (company_id = (select public.current_company_id())
    AND public.member_has_company_access(company_id, false));
CREATE POLICY service_job_lines_select ON public.service_job_lines FOR SELECT TO authenticated
  USING (company_id = (select public.current_company_id())
    AND public.member_has_company_access(company_id, false));
CREATE POLICY service_job_time_select ON public.service_job_time_entries FOR SELECT TO authenticated
  USING (company_id = (select public.current_company_id())
    AND public.member_has_company_access(company_id, false));
CREATE POLICY service_job_direct_cost_select ON public.service_job_direct_costs FOR SELECT TO authenticated
  USING (company_id = (select public.current_company_id())
    AND public.member_has_company_access(company_id, false));
CREATE POLICY service_job_material_select ON public.service_job_materials FOR SELECT TO authenticated
  USING (company_id = (select public.current_company_id())
    AND public.member_has_company_access(company_id, false));
CREATE POLICY service_job_vendor_select ON public.service_job_vendor_allocations FOR SELECT TO authenticated
  USING (company_id = (select public.current_company_id())
    AND public.member_has_company_access(company_id, false));
CREATE POLICY service_job_events_select ON public.service_job_events FOR SELECT TO authenticated
  USING (company_id = (select public.current_company_id())
    AND public.member_has_company_access(company_id, false));

REVOKE ALL ON public.service_job_counters, public.service_jobs, public.service_job_lines,
  public.service_job_time_entries, public.service_job_direct_costs, public.service_job_materials,
  public.service_job_vendor_allocations, public.service_job_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.service_jobs, public.service_job_lines, public.service_job_time_entries,
  public.service_job_direct_costs, public.service_job_materials,
  public.service_job_vendor_allocations, public.service_job_events TO authenticated;
GRANT ALL ON public.service_job_counters, public.service_jobs, public.service_job_lines,
  public.service_job_time_entries, public.service_job_direct_costs, public.service_job_materials,
  public.service_job_vendor_allocations, public.service_job_events TO service_role;

CREATE OR REPLACE FUNCTION public.service_job_assert_role(
  p_company_id uuid, p_admin boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_company_id IS DISTINCT FROM public.current_company_id()
    OR NOT public.member_has_company_access(p_company_id, false)
    OR NOT public.has_company_role(
      p_company_id,
      CASE WHEN p_admin
        THEN ARRAY['OWNER','ADMIN']::public.member_role[]
        ELSE ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::public.member_role[]
      END
    )
  THEN
    RAISE EXCEPTION 'service_job_access_denied' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.service_job_write_event(
  p_company_id uuid, p_job_id uuid, p_type text,
  p_previous jsonb DEFAULT NULL, p_new jsonb DEFAULT NULL,
  p_reason text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.service_job_events(
    company_id, service_job_id, event_type, previous_state, new_state, reason, metadata
  ) VALUES (p_company_id, p_job_id, p_type, p_previous, p_new, p_reason, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_service_job(
  p_company_id uuid, p_sales_order_id uuid, p_line_ids uuid[],
  p_title text, p_description text DEFAULT NULL,
  p_scheduled_start timestamptz DEFAULT NULL, p_scheduled_end timestamptz DEFAULT NULL,
  p_billing_basis jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_job_id uuid := gen_random_uuid();
  v_customer_id uuid;
  v_number bigint;
  v_reference text;
  v_count integer;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id, false);
  IF NULLIF(btrim(p_title), '') IS NULL OR COALESCE(array_length(p_line_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'service_job_title_and_lines_required' USING ERRCODE = '22023';
  END IF;
  IF p_scheduled_end IS NOT NULL AND p_scheduled_start IS NOT NULL
    AND p_scheduled_end < p_scheduled_start THEN
    RAISE EXCEPTION 'service_job_invalid_schedule' USING ERRCODE = '22023';
  END IF;
  SELECT so.customer_id INTO v_customer_id
  FROM public.sales_orders so
  WHERE so.id = p_sales_order_id AND so.company_id = p_company_id
    AND lower(so.status::text) IN ('submitted','confirmed','allocated','shipped')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_job_sales_order_not_eligible' USING ERRCODE = 'P0001'; END IF;

  SELECT count(*) INTO v_count
  FROM public.sales_order_lines sol
  JOIN public.items i ON i.id = sol.item_id AND i.company_id = p_company_id
  WHERE sol.company_id = p_company_id AND sol.so_id = p_sales_order_id
    AND sol.id = ANY(p_line_ids) AND i.primary_role = 'service';
  IF v_count <> array_length(p_line_ids, 1) THEN
    RAISE EXCEPTION 'service_job_line_not_eligible' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_job_lines sjl
    WHERE sjl.sales_order_line_id = ANY(p_line_ids) AND sjl.active_link
  ) THEN RAISE EXCEPTION 'service_job_line_already_linked' USING ERRCODE = '23505'; END IF;

  INSERT INTO public.service_job_counters(company_id, next_value)
  VALUES (p_company_id, 2)
  ON CONFLICT (company_id) DO UPDATE
    SET next_value = public.service_job_counters.next_value + 1, updated_at = now()
  RETURNING next_value - 1 INTO v_number;
  v_reference := 'SVC-' || lpad(v_number::text, 6, '0');

  INSERT INTO public.service_jobs(
    id, company_id, job_reference, sales_order_id, customer_id, title, description,
    scheduled_start, scheduled_end, created_by
  ) VALUES (
    v_job_id, p_company_id, v_reference, p_sales_order_id, v_customer_id, btrim(p_title),
    NULLIF(btrim(p_description), ''), p_scheduled_start, p_scheduled_end, auth.uid()
  );
  INSERT INTO public.service_job_lines(
    company_id, service_job_id, sales_order_line_id, service_item_id,
    description_snapshot, billing_basis, commercial_quantity
  )
  SELECT p_company_id, v_job_id, sol.id, sol.item_id,
    COALESCE(NULLIF(btrim(sol.description), ''), i.name),
    CASE WHEN p_billing_basis ? sol.id::text
      THEN p_billing_basis->>sol.id::text ELSE 'per_job' END,
    sol.qty
  FROM public.sales_order_lines sol
  JOIN public.items i ON i.id = sol.item_id
  WHERE sol.id = ANY(p_line_ids);
  PERFORM public.service_job_write_event(
    p_company_id, v_job_id, 'created', NULL,
    jsonb_build_object('executionStatus','planned','costingStatus','open'),
    NULL, jsonb_build_object('salesOrderId',p_sales_order_id,'lineCount',v_count)
  );
  RETURN v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_service_job(
  p_company_id uuid, p_service_job_id uuid, p_action text, p_reason text DEFAULT NULL
) RETURNS public.service_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_job public.service_jobs; v_old text; v_new text;
BEGIN
  PERFORM public.service_job_assert_role(
    p_company_id, p_action = 'reopen'
  );
  SELECT * INTO v_job FROM public.service_jobs
  WHERE id = p_service_job_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_job_not_found' USING ERRCODE='P0002'; END IF;
  v_old := v_job.execution_status;
  v_new := CASE
    WHEN p_action='start' AND v_old='planned' THEN 'in_progress'
    WHEN p_action='complete' AND v_old='in_progress' THEN 'completed'
    WHEN p_action='cancel' AND v_old IN ('planned','in_progress') THEN 'cancelled'
    WHEN p_action='reopen' AND v_old='completed' THEN 'in_progress'
    ELSE NULL END;
  IF v_new IS NULL THEN RAISE EXCEPTION 'service_job_invalid_transition' USING ERRCODE='P0001'; END IF;
  IF p_action IN ('cancel','reopen') AND NULLIF(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'service_job_reason_required' USING ERRCODE='22023';
  END IF;
  IF p_action='complete' THEN
    IF NOT EXISTS (SELECT 1 FROM public.service_job_lines WHERE service_job_id=v_job.id AND active_link)
      OR EXISTS (SELECT 1 FROM public.service_job_time_entries WHERE service_job_id=v_job.id AND source='timer' AND stopped_at IS NULL)
    THEN RAISE EXCEPTION 'service_job_completion_blocked' USING ERRCODE='P0001'; END IF;
  END IF;
  IF p_action='cancel' AND EXISTS (
    SELECT 1 FROM public.service_job_time_entries
    WHERE service_job_id=v_job.id AND source='timer' AND stopped_at IS NULL
  ) THEN RAISE EXCEPTION 'service_job_stop_timer_before_cancel' USING ERRCODE='P0001'; END IF;
  IF p_action='reopen' AND (
    EXISTS (SELECT 1 FROM public.sales_orders so WHERE so.id=v_job.sales_order_id
      AND lower(so.status::text) IN ('cancelled','closed'))
    OR EXISTS (SELECT 1 FROM public.sales_invoices si WHERE si.sales_order_id=v_job.sales_order_id
      AND si.company_id=p_company_id AND si.document_workflow_status='issued')
  ) THEN RAISE EXCEPTION 'service_job_execution_reopen_order_blocked' USING ERRCODE='P0001'; END IF;
  IF p_action='cancel' AND EXISTS (
    SELECT 1 FROM public.service_job_materials
    WHERE service_job_id=v_job.id AND supply_type='company' AND reverses_id IS NULL AND reversed_by_id IS NULL
  ) THEN RAISE EXCEPTION 'service_job_reverse_materials_before_cancel' USING ERRCODE='P0001'; END IF;
  UPDATE public.service_jobs SET
    execution_status=v_new,
    actual_start=CASE WHEN p_action='start' THEN now() ELSE actual_start END,
    actual_completion=CASE WHEN p_action='complete' THEN now() WHEN p_action='reopen' THEN NULL ELSE actual_completion END,
    cancelled_at=CASE WHEN p_action='cancel' THEN now() ELSE cancelled_at END,
    cancelled_by=CASE WHEN p_action='cancel' THEN auth.uid() ELSE cancelled_by END,
    cancel_reason=CASE WHEN p_action='cancel' THEN btrim(p_reason) ELSE cancel_reason END,
    updated_at=now()
  WHERE id=v_job.id RETURNING * INTO v_job;
  IF p_action='cancel' THEN
    UPDATE public.service_job_lines SET active_link=false WHERE service_job_id=v_job.id;
  END IF;
  PERFORM public.service_job_write_event(p_company_id,v_job.id,p_action,
    jsonb_build_object('executionStatus',v_old),jsonb_build_object('executionStatus',v_new),p_reason);
  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_service_job_timer(
  p_company_id uuid, p_service_job_id uuid, p_worker_user_id uuid,
  p_worker_display_name text, p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid; v_worker uuid := COALESCE(p_worker_user_id, auth.uid());
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,false);
  IF NOT EXISTS (SELECT 1 FROM public.service_jobs WHERE id=p_service_job_id
    AND company_id=p_company_id AND execution_status='in_progress' AND costing_status='open')
  THEN RAISE EXCEPTION 'service_job_timer_not_allowed' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.company_id=p_company_id
    AND cm.user_id=v_worker AND cm.status='active')
  THEN RAISE EXCEPTION 'service_job_worker_not_member' USING ERRCODE='42501'; END IF;
  INSERT INTO public.service_job_time_entries(
    company_id,service_job_id,worker_user_id,worker_display_name,work_date,
    started_at,notes,source,created_by
  ) VALUES (p_company_id,p_service_job_id,v_worker,btrim(p_worker_display_name),current_date,
    now(),NULLIF(btrim(p_notes),''),'timer',auth.uid()) RETURNING id INTO v_id;
  PERFORM public.service_job_write_event(p_company_id,p_service_job_id,'timer_started',NULL,NULL,NULL,jsonb_build_object('timeEntryId',v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.stop_service_job_timer(
  p_company_id uuid, p_time_entry_id uuid
) RETURNS public.service_job_time_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_entry public.service_job_time_entries; v_minutes integer;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,false);
  SELECT * INTO v_entry FROM public.service_job_time_entries
  WHERE id=p_time_entry_id AND company_id=p_company_id AND source='timer'
    AND stopped_at IS NULL AND worker_user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_job_open_timer_not_found' USING ERRCODE='P0002'; END IF;
  v_minutes := GREATEST(1, floor(extract(epoch FROM (now()-v_entry.started_at))/60)::integer);
  IF v_minutes > 1440 THEN RAISE EXCEPTION 'service_job_timer_duration_invalid' USING ERRCODE='22023'; END IF;
  UPDATE public.service_job_time_entries SET stopped_at=now(),duration_minutes=v_minutes
  WHERE id=v_entry.id RETURNING * INTO v_entry;
  PERFORM public.service_job_write_event(p_company_id,v_entry.service_job_id,'timer_stopped',NULL,NULL,NULL,
    jsonb_build_object('timeEntryId',v_entry.id,'durationMinutes',v_minutes));
  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_service_job_manual_time(
  p_company_id uuid, p_service_job_id uuid, p_worker_user_id uuid,
  p_worker_display_name text, p_work_date date, p_duration_minutes integer,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid; v_worker uuid := COALESCE(p_worker_user_id, auth.uid());
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,false);
  IF p_duration_minutes NOT BETWEEN 1 AND 1440 OR p_work_date IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.company_id=p_company_id
      AND cm.user_id=v_worker AND cm.status='active')
    OR NOT EXISTS (SELECT 1 FROM public.service_jobs sj WHERE sj.id=p_service_job_id
      AND sj.company_id=p_company_id AND sj.execution_status <> 'cancelled' AND sj.costing_status='open')
  THEN RAISE EXCEPTION 'service_job_manual_time_invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.service_job_time_entries(
    company_id,service_job_id,worker_user_id,worker_display_name,work_date,
    duration_minutes,notes,source,created_by
  ) VALUES (p_company_id,p_service_job_id,v_worker,btrim(p_worker_display_name),
    p_work_date,p_duration_minutes,NULLIF(btrim(p_notes),''),'manual',auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.service_job_write_event(p_company_id,p_service_job_id,'manual_time_added',NULL,NULL,NULL,
    jsonb_build_object('timeEntryId',v_id,'durationMinutes',p_duration_minutes));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_service_job_direct_cost(
  p_company_id uuid, p_service_job_id uuid, p_category text, p_description text,
  p_source_currency text, p_source_amount numeric, p_fx_to_base numeric,
  p_cost_date date, p_external_reference text DEFAULT NULL, p_supplier_id uuid DEFAULT NULL,
  p_time_entry_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,false);
  IF p_category NOT IN ('labour','subcontractor','other_direct_cost')
    OR p_source_amount <= 0 OR p_fx_to_base <= 0 OR p_cost_date IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.service_jobs WHERE id=p_service_job_id
      AND company_id=p_company_id AND costing_status='open' AND execution_status <> 'cancelled')
  THEN RAISE EXCEPTION 'service_job_direct_cost_invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.service_job_direct_costs(
    company_id,service_job_id,category,description,external_reference,supplier_id,
    source_currency,source_amount,fx_to_base,base_amount,cost_date,time_entry_id,created_by
  ) VALUES (p_company_id,p_service_job_id,p_category,btrim(p_description),NULLIF(btrim(p_external_reference),''),
    p_supplier_id,upper(btrim(p_source_currency)),p_source_amount,p_fx_to_base,
    round(p_source_amount*p_fx_to_base,4),p_cost_date,p_time_entry_id,auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.service_job_write_event(p_company_id,p_service_job_id,'direct_cost_added',NULL,NULL,NULL,
    jsonb_build_object('directCostId',v_id,'category',p_category));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_service_job_direct_cost(
  p_company_id uuid, p_direct_cost_id uuid, p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_original public.service_job_direct_costs; v_id uuid;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,false);
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'service_job_reason_required' USING ERRCODE='22023'; END IF;
  SELECT dc.* INTO v_original FROM public.service_job_direct_costs dc
  JOIN public.service_jobs sj ON sj.id=dc.service_job_id AND sj.costing_status='open'
  WHERE dc.id=p_direct_cost_id AND dc.company_id=p_company_id AND dc.reverses_id IS NULL
    AND dc.reversed_by_id IS NULL FOR UPDATE OF dc;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_job_direct_cost_not_reversible' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.service_job_direct_costs(
    company_id,service_job_id,category,description,external_reference,supplier_id,
    source_currency,source_amount,fx_to_base,base_amount,cost_date,time_entry_id,
    reverses_id,reversal_reason,created_by
  ) VALUES (p_company_id,v_original.service_job_id,v_original.category,
    'Reversal: '||v_original.description,v_original.external_reference,v_original.supplier_id,
    v_original.source_currency,v_original.source_amount,v_original.fx_to_base,v_original.base_amount,
    current_date,v_original.time_entry_id,v_original.id,btrim(p_reason),auth.uid())
  RETURNING id INTO v_id;
  UPDATE public.service_job_direct_costs SET reversed_by_id=v_id WHERE id=v_original.id;
  PERFORM public.service_job_write_event(p_company_id,v_original.service_job_id,'direct_cost_reversed',NULL,NULL,p_reason,
    jsonb_build_object('directCostId',v_original.id,'reversalId',v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_customer_service_job_material(
  p_company_id uuid, p_service_job_id uuid, p_description text, p_quantity numeric,
  p_uom_id text, p_occurred_on date, p_item_id uuid DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,false);
  IF p_quantity <= 0 OR p_occurred_on IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.service_jobs WHERE id=p_service_job_id
      AND company_id=p_company_id AND costing_status='open' AND execution_status <> 'cancelled')
  THEN RAISE EXCEPTION 'service_job_customer_material_invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.service_job_materials(company_id,service_job_id,supply_type,item_id,
    description,quantity,uom_id,occurred_on,notes,created_by)
  VALUES(p_company_id,p_service_job_id,'customer',p_item_id,btrim(p_description),p_quantity,
    p_uom_id,p_occurred_on,NULLIF(btrim(p_notes),''),auth.uid()) RETURNING id INTO v_id;
  PERFORM public.service_job_write_event(p_company_id,p_service_job_id,'customer_material_added',NULL,NULL,NULL,
    jsonb_build_object('materialId',v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_service_job_material(
  p_company_id uuid, p_service_job_id uuid, p_item_id uuid,
  p_warehouse_id uuid, p_bin_id text, p_quantity numeric, p_uom_id text,
  p_posting_request_key text, p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_job public.service_jobs; v_base_uom text; v_qty_base numeric; v_factor numeric;
  v_avg_cost numeric; v_movement_id uuid; v_material_id uuid; v_hash text;
  v_request public.posting_requests;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,false);
  IF p_quantity <= 0 OR NULLIF(btrim(p_posting_request_key),'') IS NULL
  THEN RAISE EXCEPTION 'service_job_material_quantity_and_key_required' USING ERRCODE='22023'; END IF;
  v_hash := md5(jsonb_build_object('job',p_service_job_id,'item',p_item_id,'warehouse',p_warehouse_id,
    'bin',p_bin_id,'quantity',p_quantity,'uom',p_uom_id,'note',p_note)::text);
  v_request := public.stockwise_claim_posting_request(p_company_id,'service.job.material.issue',
    p_posting_request_key,v_hash);
  IF v_request.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE='22023';
  END IF;
  IF v_request.status='succeeded' THEN
    RETURN (v_request.result_payload->>'materialId')::uuid;
  END IF;
  SELECT * INTO v_job FROM public.service_jobs WHERE id=p_service_job_id
    AND company_id=p_company_id FOR UPDATE;
  IF v_job.costing_status <> 'open' OR v_job.execution_status NOT IN ('planned','in_progress','completed')
  THEN RAISE EXCEPTION 'service_job_material_issue_not_allowed' USING ERRCODE='P0001'; END IF;
  SELECT i.base_uom_id INTO v_base_uom FROM public.items i
  WHERE i.id=p_item_id AND i.company_id=p_company_id AND i.track_inventory FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_job_stock_item_not_found' USING ERRCODE='P0002'; END IF;
  IF p_uom_id=v_base_uom THEN v_factor:=1;
  ELSE
    SELECT uc.factor INTO v_factor FROM public.uom_conversions uc
    WHERE uc.from_uom_id=p_uom_id AND uc.to_uom_id=v_base_uom
      AND (uc.company_id=p_company_id OR uc.company_id IS NULL)
    ORDER BY (uc.company_id=p_company_id) DESC LIMIT 1;
  END IF;
  IF v_factor IS NULL THEN RAISE EXCEPTION 'service_job_uom_conversion_missing' USING ERRCODE='P0001'; END IF;
  v_qty_base:=p_quantity*v_factor;
  SELECT sl.avg_cost INTO v_avg_cost FROM public.stock_levels sl
  WHERE sl.company_id=p_company_id AND sl.item_id=p_item_id AND sl.warehouse_id=p_warehouse_id
    AND sl.bin_id IS NOT DISTINCT FROM p_bin_id AND sl.qty>=v_qty_base FOR UPDATE;
  IF v_avg_cost IS NULL THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.stock_movements(company_id,type,item_id,uom_id,qty,qty_base,unit_cost,total_value,
    warehouse_from_id,bin_from_id,notes,created_by,ref_type,ref_id)
  VALUES(p_company_id,'issue',p_item_id,p_uom_id,p_quantity,v_qty_base,v_avg_cost,
    round(v_avg_cost*v_qty_base,6),p_warehouse_id,p_bin_id,
    COALESCE(NULLIF(btrim(p_note),''),'Service job '||v_job.job_reference),
    auth.uid()::text,'SERVICE_JOB_MATERIAL',p_service_job_id::text)
  RETURNING id INTO v_movement_id;
  INSERT INTO public.service_job_materials(company_id,service_job_id,supply_type,item_id,description,
    quantity,uom_id,warehouse_id,bin_id,stock_movement_id,base_quantity,unit_cost,base_amount,
    occurred_on,notes,created_by)
  SELECT p_company_id,p_service_job_id,'company',i.id,i.name,p_quantity,p_uom_id,p_warehouse_id,
    p_bin_id,v_movement_id,v_qty_base,v_avg_cost,round(v_avg_cost*v_qty_base,6),current_date,
    NULLIF(btrim(p_note),''),auth.uid() FROM public.items i WHERE i.id=p_item_id
  RETURNING id INTO v_material_id;
  PERFORM public.service_job_write_event(p_company_id,p_service_job_id,'company_material_issued',
    NULL,NULL,NULL,jsonb_build_object('materialId',v_material_id,'movementId',v_movement_id));
  UPDATE public.posting_requests SET status='succeeded',result_ref_type='SERVICE_JOB_MATERIAL',
    result_ref_id=v_material_id::text,result_payload=jsonb_build_object('materialId',v_material_id,
    'movementId',v_movement_id),error_code=NULL,error_message=NULL WHERE id=v_request.id;
  RETURN v_material_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_service_job_material(
  p_company_id uuid, p_material_id uuid, p_reason text, p_posting_request_key text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_original public.service_job_materials; v_movement_id uuid; v_id uuid;
  v_hash text; v_request public.posting_requests;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,false);
  IF NULLIF(btrim(p_reason),'') IS NULL OR NULLIF(btrim(p_posting_request_key),'') IS NULL
  THEN RAISE EXCEPTION 'service_job_material_reversal_reason_and_key_required' USING ERRCODE='22023'; END IF;
  v_hash:=md5(jsonb_build_object('material',p_material_id,'reason',p_reason)::text);
  v_request:=public.stockwise_claim_posting_request(p_company_id,'service.job.material.reverse',
    p_posting_request_key,v_hash);
  IF v_request.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE='22023';
  END IF;
  IF v_request.status='succeeded' THEN RETURN (v_request.result_payload->>'materialId')::uuid; END IF;
  SELECT m.* INTO v_original FROM public.service_job_materials m
  JOIN public.service_jobs sj ON sj.id=m.service_job_id AND sj.costing_status='open'
  WHERE m.id=p_material_id AND m.company_id=p_company_id AND m.supply_type='company'
    AND m.reverses_id IS NULL AND m.reversed_by_id IS NULL FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_job_material_not_reversible' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.stock_movements(company_id,type,item_id,uom_id,qty,qty_base,unit_cost,total_value,
    warehouse_to_id,bin_to_id,notes,created_by,ref_type,ref_id)
  VALUES(p_company_id,'receive',v_original.item_id,v_original.uom_id,v_original.quantity,
    v_original.base_quantity,v_original.unit_cost,v_original.base_amount,v_original.warehouse_id,
    v_original.bin_id,'Service job material reversal: '||btrim(p_reason),auth.uid()::text,
    'SERVICE_JOB_MATERIAL',v_original.service_job_id::text)
  RETURNING id INTO v_movement_id;
  INSERT INTO public.service_job_materials(company_id,service_job_id,supply_type,item_id,description,
    quantity,uom_id,warehouse_id,bin_id,stock_movement_id,base_quantity,unit_cost,base_amount,
    occurred_on,notes,reverses_id,reversal_reason,created_by)
  VALUES(p_company_id,v_original.service_job_id,'company',v_original.item_id,
    'Reversal: '||v_original.description,v_original.quantity,v_original.uom_id,v_original.warehouse_id,
    v_original.bin_id,v_movement_id,v_original.base_quantity,v_original.unit_cost,v_original.base_amount,
    current_date,v_original.notes,v_original.id,btrim(p_reason),auth.uid()) RETURNING id INTO v_id;
  UPDATE public.service_job_materials SET reversed_by_id=v_id WHERE id=v_original.id;
  PERFORM public.service_job_write_event(p_company_id,v_original.service_job_id,'company_material_reversed',
    NULL,NULL,p_reason,jsonb_build_object('materialId',v_original.id,'reversalId',v_id,'movementId',v_movement_id));
  UPDATE public.posting_requests SET status='succeeded',result_ref_type='SERVICE_JOB_MATERIAL_REVERSAL',
    result_ref_id=v_id::text,result_payload=jsonb_build_object('materialId',v_id,'movementId',v_movement_id)
    WHERE id=v_request.id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_vendor_bill_line_to_service_job(
  p_company_id uuid, p_service_job_id uuid, p_vendor_bill_line_id uuid,
  p_source_amount numeric, p_cost_category text, p_allocation_date date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_line public.vendor_bill_lines; v_bill public.vendor_bills; v_allocated numeric; v_id uuid;
  v_current_legal_base numeric; v_bill_allocated_base numeric; v_new_base numeric;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,false);
  IF p_source_amount <= 0 OR p_allocation_date IS NULL
    OR p_cost_category NOT IN ('supplier','subcontractor') THEN
    RAISE EXCEPTION 'service_job_vendor_allocation_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_line FROM public.vendor_bill_lines
  WHERE id=p_vendor_bill_line_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_job_vendor_bill_line_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_bill FROM public.vendor_bills WHERE id=v_line.vendor_bill_id
    AND company_id=p_company_id FOR UPDATE;
  IF v_bill.document_workflow_status <> 'posted' OR v_bill.approval_status <> 'approved'
    OR v_line.line_total <= 0 OR NOT EXISTS (
      SELECT 1 FROM public.service_jobs WHERE id=p_service_job_id AND company_id=p_company_id
        AND costing_status='open' AND execution_status <> 'cancelled'
    ) THEN RAISE EXCEPTION 'service_job_vendor_bill_not_eligible' USING ERRCODE='P0001'; END IF;
  SELECT COALESCE(sum(CASE WHEN reverses_id IS NULL THEN source_amount ELSE -source_amount END),0)
    INTO v_allocated FROM public.service_job_vendor_allocations
    WHERE company_id=p_company_id AND vendor_bill_line_id=p_vendor_bill_line_id;
  IF v_allocated+p_source_amount > v_line.line_total THEN
    RAISE EXCEPTION 'service_job_vendor_allocation_exceeds_available' USING ERRCODE='22003';
  END IF;
  v_new_base:=round(p_source_amount*v_bill.fx_to_base,4);
  SELECT s.current_legal_total_base INTO v_current_legal_base
  FROM public.v_vendor_bill_state s WHERE s.id=v_bill.id AND s.company_id=p_company_id;
  SELECT COALESCE(sum(CASE WHEN reverses_id IS NULL THEN base_amount ELSE -base_amount END),0)
    INTO v_bill_allocated_base FROM public.service_job_vendor_allocations
    WHERE company_id=p_company_id AND vendor_bill_id=v_bill.id;
  IF v_bill_allocated_base+v_new_base > COALESCE(v_current_legal_base,0)+0.0001 THEN
    RAISE EXCEPTION 'service_job_vendor_allocation_exceeds_current_legal_total' USING ERRCODE='22003';
  END IF;
  INSERT INTO public.service_job_vendor_allocations(company_id,service_job_id,vendor_bill_id,
    vendor_bill_line_id,source_amount,base_amount,cost_category,allocation_date,created_by)
  VALUES(p_company_id,p_service_job_id,v_bill.id,p_vendor_bill_line_id,p_source_amount,
    v_new_base,p_cost_category,p_allocation_date,auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.service_job_write_event(p_company_id,p_service_job_id,'vendor_cost_allocated',NULL,NULL,NULL,
    jsonb_build_object('allocationId',v_id,'vendorBillId',v_bill.id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_service_job_vendor_allocation(
  p_company_id uuid, p_allocation_id uuid, p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_original public.service_job_vendor_allocations; v_id uuid;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,false);
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'service_job_reason_required' USING ERRCODE='22023'; END IF;
  SELECT a.* INTO v_original FROM public.service_job_vendor_allocations a
  JOIN public.service_jobs sj ON sj.id=a.service_job_id AND sj.costing_status='open'
  WHERE a.id=p_allocation_id AND a.company_id=p_company_id AND a.reverses_id IS NULL
    AND a.reversed_by_id IS NULL FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_job_vendor_allocation_not_reversible' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.service_job_vendor_allocations(company_id,service_job_id,vendor_bill_id,
    vendor_bill_line_id,source_amount,base_amount,cost_category,allocation_date,reverses_id,
    reversal_reason,created_by)
  VALUES(p_company_id,v_original.service_job_id,v_original.vendor_bill_id,v_original.vendor_bill_line_id,
    v_original.source_amount,v_original.base_amount,v_original.cost_category,current_date,
    v_original.id,btrim(p_reason),auth.uid()) RETURNING id INTO v_id;
  UPDATE public.service_job_vendor_allocations SET reversed_by_id=v_id WHERE id=v_original.id;
  PERFORM public.service_job_write_event(p_company_id,v_original.service_job_id,'vendor_cost_reversed',NULL,NULL,p_reason,
    jsonb_build_object('allocationId',v_original.id,'reversalId',v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_service_job_cost_summary(
  p_company_id uuid, p_service_job_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,false);
  IF NOT EXISTS (SELECT 1 FROM public.service_jobs WHERE id=p_service_job_id AND company_id=p_company_id)
  THEN RAISE EXCEPTION 'service_job_not_found' USING ERRCODE='P0002'; END IF;
  WITH
  material AS (
    SELECT COALESCE(sum(CASE WHEN reverses_id IS NULL THEN base_amount ELSE -base_amount END),0) amount
    FROM public.service_job_materials WHERE service_job_id=p_service_job_id AND supply_type='company'
  ),
  direct AS (
    SELECT
      COALESCE(sum(CASE WHEN category='labour' THEN CASE WHEN reverses_id IS NULL THEN base_amount ELSE -base_amount END END),0) labour,
      COALESCE(sum(CASE WHEN category='subcontractor' THEN CASE WHEN reverses_id IS NULL THEN base_amount ELSE -base_amount END END),0) subcontractor,
      COALESCE(sum(CASE WHEN category='other_direct_cost' THEN CASE WHEN reverses_id IS NULL THEN base_amount ELSE -base_amount END END),0) other_cost
    FROM public.service_job_direct_costs WHERE service_job_id=p_service_job_id
  ),
  vendor AS (
    SELECT
      COALESCE(sum(CASE WHEN cost_category='supplier' THEN CASE WHEN reverses_id IS NULL THEN base_amount ELSE -base_amount END END),0) supplier,
      COALESCE(sum(CASE WHEN cost_category='subcontractor' THEN CASE WHEN reverses_id IS NULL THEN base_amount ELSE -base_amount END END),0) subcontractor
    FROM public.service_job_vendor_allocations WHERE service_job_id=p_service_job_id
  )
  SELECT jsonb_build_object(
    'materials',m.amount,'labour',d.labour,'subcontractors',d.subcontractor+v.subcontractor,
    'suppliers',v.supplier,'otherDirectCosts',d.other_cost,
    'totalActualCost',m.amount+d.labour+d.subcontractor+v.subcontractor+v.supplier+d.other_cost
  ) INTO v_result FROM material m CROSS JOIN direct d CROSS JOIN vendor v;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalise_service_job_costing(
  p_company_id uuid, p_service_job_id uuid, p_posting_request_key text,
  p_confirm_zero boolean DEFAULT false, p_zero_cost_reason text DEFAULT NULL
) RETURNS public.service_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_job public.service_jobs; v_cost jsonb; v_hash text; v_req record;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,true);
  v_hash := md5(jsonb_build_object('job',p_service_job_id,'confirmZero',p_confirm_zero,
    'reason',p_zero_cost_reason)::text);
  v_req := public.stockwise_claim_posting_request(p_company_id,'service.job.cost.finalise',
    p_posting_request_key,v_hash);
  IF v_req.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE='22023';
  END IF;
  IF v_req.status='succeeded' THEN
    SELECT * INTO v_job FROM public.service_jobs WHERE id=p_service_job_id AND company_id=p_company_id;
    RETURN v_job;
  END IF;
  SELECT * INTO v_job FROM public.service_jobs WHERE id=p_service_job_id
    AND company_id=p_company_id FOR UPDATE;
  IF v_job.execution_status <> 'completed' OR v_job.costing_status <> 'open'
    OR EXISTS (SELECT 1 FROM public.service_job_time_entries WHERE service_job_id=v_job.id AND source='timer' AND stopped_at IS NULL)
    OR EXISTS (
      SELECT 1
      FROM (
        SELECT a.vendor_bill_id,
          sum(CASE WHEN a.reverses_id IS NULL THEN a.base_amount ELSE -a.base_amount END) allocated_base
        FROM public.service_job_vendor_allocations a
        WHERE a.company_id=p_company_id
        GROUP BY a.vendor_bill_id
      ) a
      JOIN public.v_vendor_bill_state s ON s.id=a.vendor_bill_id AND s.company_id=p_company_id
      WHERE a.allocated_base>s.current_legal_total_base+0.0001
    )
  THEN RAISE EXCEPTION 'service_job_costing_finalisation_blocked' USING ERRCODE='P0001'; END IF;
  v_cost := public.get_service_job_cost_summary(p_company_id,p_service_job_id);
  IF (v_cost->>'totalActualCost')::numeric = 0
    AND (NOT p_confirm_zero OR NULLIF(btrim(p_zero_cost_reason),'') IS NULL)
  THEN RAISE EXCEPTION 'service_job_zero_cost_confirmation_required' USING ERRCODE='22023'; END IF;
  UPDATE public.service_jobs SET costing_status='finalised',costing_finalised_at=now(),
    costing_finalised_by=auth.uid(),material_cost=(v_cost->>'materials')::numeric,
    labour_cost=(v_cost->>'labour')::numeric,subcontractor_cost=(v_cost->>'subcontractors')::numeric,
    supplier_cost=(v_cost->>'suppliers')::numeric,other_direct_cost=(v_cost->>'otherDirectCosts')::numeric,
    total_actual_cost=(v_cost->>'totalActualCost')::numeric,
    cost_fingerprint=md5(jsonb_build_object(
      'summary',v_cost,
      'materials',(SELECT COALESCE(jsonb_agg(jsonb_build_array(id,reverses_id,reversed_by_id,base_amount) ORDER BY id),'[]'::jsonb)
        FROM public.service_job_materials WHERE service_job_id=v_job.id),
      'directCosts',(SELECT COALESCE(jsonb_agg(jsonb_build_array(id,reverses_id,reversed_by_id,base_amount) ORDER BY id),'[]'::jsonb)
        FROM public.service_job_direct_costs WHERE service_job_id=v_job.id),
      'allocations',(SELECT COALESCE(jsonb_agg(jsonb_build_array(id,reverses_id,reversed_by_id,base_amount) ORDER BY id),'[]'::jsonb)
        FROM public.service_job_vendor_allocations WHERE service_job_id=v_job.id)
    )::text),explicit_zero=((v_cost->>'totalActualCost')::numeric=0),
    zero_cost_reason=CASE WHEN (v_cost->>'totalActualCost')::numeric=0 THEN btrim(p_zero_cost_reason) END,
    updated_at=now()
  WHERE id=v_job.id RETURNING * INTO v_job;
  PERFORM public.service_job_write_event(p_company_id,v_job.id,'costing_finalised',NULL,
    jsonb_build_object('costingStatus','finalised','cost',v_cost),p_zero_cost_reason,
    jsonb_build_object('fingerprint',v_job.cost_fingerprint));
  UPDATE public.posting_requests SET status='succeeded',result_ref_type='SERVICE_JOB_COSTING',
    result_ref_id=v_job.id::text,
    result_payload=jsonb_build_object('serviceJobId',v_job.id,'fingerprint',v_job.cost_fingerprint)
    WHERE id=v_req.id;
  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_service_job_costing(
  p_company_id uuid, p_service_job_id uuid, p_current_fingerprint text, p_reason text
) RETURNS public.service_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_job public.service_jobs;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id,true);
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'service_job_reason_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_job FROM public.service_jobs WHERE id=p_service_job_id
    AND company_id=p_company_id FOR UPDATE;
  IF v_job.costing_status <> 'finalised' OR v_job.cost_fingerprint IS DISTINCT FROM p_current_fingerprint
  THEN RAISE EXCEPTION 'service_job_costing_fingerprint_conflict' USING ERRCODE='40001'; END IF;
  UPDATE public.service_jobs SET costing_status='open',costing_reopened_at=now(),
    costing_reopened_by=auth.uid(),reopen_reason=btrim(p_reason),costing_finalised_at=NULL,
    costing_finalised_by=NULL,material_cost=0,labour_cost=0,subcontractor_cost=0,
    supplier_cost=0,other_direct_cost=0,total_actual_cost=0,cost_fingerprint=NULL,
    explicit_zero=false,zero_cost_reason=NULL,updated_at=now()
  WHERE id=v_job.id RETURNING * INTO v_job;
  PERFORM public.service_job_write_event(p_company_id,v_job.id,'costing_reopened',
    jsonb_build_object('costingStatus','finalised','fingerprint',p_current_fingerprint),
    jsonb_build_object('costingStatus','open'),p_reason);
  RETURN v_job;
END;
$$;

CREATE OR REPLACE VIEW public.service_jobs_register
WITH (security_invoker = true) AS
SELECT sj.*, so.order_no, c.name AS customer_name,
  (SELECT count(*) FROM public.service_job_lines sjl
    WHERE sjl.service_job_id=sj.id AND sjl.active_link) AS service_line_count,
  (SELECT COALESCE(sum(te.duration_minutes),0) FROM public.service_job_time_entries te
    WHERE te.service_job_id=sj.id) AS worked_minutes
FROM public.service_jobs sj
JOIN public.sales_orders so ON so.id=sj.sales_order_id AND so.company_id=sj.company_id
JOIN public.customers c ON c.id=sj.customer_id AND c.company_id=sj.company_id;

CREATE OR REPLACE VIEW public.service_job_sales_order_readiness
WITH (security_invoker = true) AS
SELECT so.id AS sales_order_id, so.company_id,
  count(*) FILTER (WHERE i.primary_role='service') AS service_line_count,
  count(*) FILTER (WHERE i.primary_role='service' AND sj.execution_status='completed') AS completed_service_line_count,
  bool_and(CASE WHEN i.primary_role='service' THEN sj.execution_status='completed'
    ELSE COALESCE(sol.shipped_qty,0)>=sol.qty END) AS ready_to_close
FROM public.sales_orders so
JOIN public.sales_order_lines sol ON sol.so_id=so.id AND sol.company_id=so.company_id
JOIN public.items i ON i.id=sol.item_id AND i.company_id=so.company_id
LEFT JOIN public.service_job_lines sjl ON sjl.sales_order_line_id=sol.id AND sjl.active_link
LEFT JOIN public.service_jobs sj ON sj.id=sjl.service_job_id
GROUP BY so.id,so.company_id;

GRANT SELECT ON public.service_jobs_register, public.service_job_sales_order_readiness
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.service_job_assert_role(uuid,boolean),
  public.service_job_write_event(uuid,uuid,text,jsonb,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_service_job(uuid,uuid,uuid[],text,text,timestamptz,timestamptz,jsonb),
  public.transition_service_job(uuid,uuid,text,text),
  public.start_service_job_timer(uuid,uuid,uuid,text,text),
  public.stop_service_job_timer(uuid,uuid),
  public.add_service_job_manual_time(uuid,uuid,uuid,text,date,integer,text),
  public.add_service_job_direct_cost(uuid,uuid,text,text,text,numeric,numeric,date,text,uuid,uuid),
  public.reverse_service_job_direct_cost(uuid,uuid,text),
  public.add_customer_service_job_material(uuid,uuid,text,numeric,text,date,uuid,text),
  public.issue_service_job_material(uuid,uuid,uuid,uuid,text,numeric,text,text,text),
  public.reverse_service_job_material(uuid,uuid,text,text),
  public.allocate_vendor_bill_line_to_service_job(uuid,uuid,uuid,numeric,text,date),
  public.reverse_service_job_vendor_allocation(uuid,uuid,text),
  public.get_service_job_cost_summary(uuid,uuid),
  public.finalise_service_job_costing(uuid,uuid,text,boolean,text),
  public.reopen_service_job_costing(uuid,uuid,text,text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_job_assert_role(uuid,boolean),
  public.service_job_write_event(uuid,uuid,text,jsonb,jsonb,text,jsonb),
  public.create_service_job(uuid,uuid,uuid[],text,text,timestamptz,timestamptz,jsonb),
  public.transition_service_job(uuid,uuid,text,text),
  public.start_service_job_timer(uuid,uuid,uuid,text,text),
  public.stop_service_job_timer(uuid,uuid),
  public.add_service_job_manual_time(uuid,uuid,uuid,text,date,integer,text),
  public.add_service_job_direct_cost(uuid,uuid,text,text,text,numeric,numeric,date,text,uuid,uuid),
  public.reverse_service_job_direct_cost(uuid,uuid,text),
  public.add_customer_service_job_material(uuid,uuid,text,numeric,text,date,uuid,text),
  public.issue_service_job_material(uuid,uuid,uuid,uuid,text,numeric,text,text,text),
  public.reverse_service_job_material(uuid,uuid,text,text),
  public.allocate_vendor_bill_line_to_service_job(uuid,uuid,uuid,numeric,text,date),
  public.reverse_service_job_vendor_allocation(uuid,uuid,text),
  public.get_service_job_cost_summary(uuid,uuid),
  public.finalise_service_job_costing(uuid,uuid,text,boolean,text),
  public.reopen_service_job_costing(uuid,uuid,text,text)
TO service_role;
