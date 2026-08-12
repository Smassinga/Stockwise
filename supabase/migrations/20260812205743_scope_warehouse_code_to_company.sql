alter table public.warehouses
  drop constraint if exists warehouses_code_key;

alter table public.warehouses
  add constraint warehouses_company_code_key unique (company_id, code);

comment on constraint warehouses_company_code_key on public.warehouses is
  'Warehouse codes are unique within a company, not globally across tenants.';
