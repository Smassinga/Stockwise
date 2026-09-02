do $$
declare
  v_company_id uuid;
  v_logo_url text := 'https://stockwiseapp.com/brands/leny-docuras.png';
begin
  select c.id
    into v_company_id
  from public.companies c
  where c.name = 'Leny Doçuras'
    and exists (
      select 1
      from public.company_members cm
      where cm.company_id = c.id
        and lower(cm.email) = 'massingasamuel@hotmail.com'
        and cm.status = 'active'
    )
  order by c.created_at desc nulls last
  limit 1;

  if v_company_id is null then
    return;
  end if;

  update public.companies
     set trade_name = 'Leny Doçuras',
         logo_path = v_logo_url
   where id = v_company_id;

  update public.company_settings
     set data = jsonb_set(
                  jsonb_set(coalesce(data, '{}'::jsonb), '{documents,brand,name}', to_jsonb('Leny Doçuras'::text), true),
                  '{documents,brand,logoUrl}',
                  to_jsonb(v_logo_url),
                  true
                ),
         updated_at = now()
   where company_id = v_company_id;
end
$$;
