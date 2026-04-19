BEGIN;

GRANT SELECT, INSERT, UPDATE ON public.landed_cost_runs TO authenticated;
GRANT SELECT, INSERT ON public.landed_cost_run_lines TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_landed_cost_run(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  text,
  numeric,
  text,
  jsonb,
  jsonb
) TO authenticated;

ALTER TABLE public.landed_cost_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landed_cost_run_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS landed_cost_runs_select_active_company ON public.landed_cost_runs;
CREATE POLICY landed_cost_runs_select_active_company
  ON public.landed_cost_runs
  FOR SELECT
  TO authenticated
  USING (company_id = current_company_id());

DROP POLICY IF EXISTS landed_cost_runs_insert_member ON public.landed_cost_runs;
CREATE POLICY landed_cost_runs_insert_member
  ON public.landed_cost_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      WHERE COALESCE(landed_cost_runs.company_id, current_company_id()) = current_company_id()
        AND has_company_role(
          COALESCE(landed_cost_runs.company_id, current_company_id()),
          ARRAY['OWNER'::member_role, 'ADMIN'::member_role, 'MANAGER'::member_role, 'OPERATOR'::member_role]
        )
    )
  );

DROP POLICY IF EXISTS landed_cost_runs_update_member ON public.landed_cost_runs;
CREATE POLICY landed_cost_runs_update_member
  ON public.landed_cost_runs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      WHERE landed_cost_runs.company_id = current_company_id()
        AND has_company_role(
          landed_cost_runs.company_id,
          ARRAY['OWNER'::member_role, 'ADMIN'::member_role, 'MANAGER'::member_role, 'OPERATOR'::member_role]
        )
    )
  )
  WITH CHECK (company_id = current_company_id());

DROP POLICY IF EXISTS landed_cost_run_lines_select_active_company ON public.landed_cost_run_lines;
CREATE POLICY landed_cost_run_lines_select_active_company
  ON public.landed_cost_run_lines
  FOR SELECT
  TO authenticated
  USING (company_id = current_company_id());

DROP POLICY IF EXISTS landed_cost_run_lines_insert_member ON public.landed_cost_run_lines;
CREATE POLICY landed_cost_run_lines_insert_member
  ON public.landed_cost_run_lines
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      WHERE COALESCE(landed_cost_run_lines.company_id, current_company_id()) = current_company_id()
        AND has_company_role(
          COALESCE(landed_cost_run_lines.company_id, current_company_id()),
          ARRAY['OWNER'::member_role, 'ADMIN'::member_role, 'MANAGER'::member_role, 'OPERATOR'::member_role]
        )
    )
  );

COMMIT;
