begin;

do $$
declare
  v_function_def text;
begin
  select pg_get_functiondef(
    'public.apply_landed_cost_run(uuid, uuid, uuid, uuid, text, numeric, text, numeric, text, jsonb, jsonb)'::regprocedure
  )
    into v_function_def;

  if v_function_def is null then
    raise exception 'apply_landed_cost_run_not_found';
  end if;

  v_function_def := replace(
    v_function_def,
    'ELSE v_bucket.po_line_id::text',
    'ELSE v_bucket.po_line_id'
  );

  execute v_function_def;
end
$$;

grant execute on function public.apply_landed_cost_run(
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
) to authenticated;

commit;
