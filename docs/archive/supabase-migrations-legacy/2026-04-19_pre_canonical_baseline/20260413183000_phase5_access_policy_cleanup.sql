drop policy if exists "boms insert own company" on public.boms;
drop policy if exists "bomc insert via bom company" on public.bom_components;
drop policy if exists "update status by company member" on public.purchase_orders;
drop policy if exists "delete by company member" on public.purchase_order_lines;
drop policy if exists ins_stock_levels_membership on public.stock_levels;
drop policy if exists upd_stock_levels_membership on public.stock_levels;

drop policy if exists "bins select via warehouse company" on public.bins;
drop policy if exists merged_insert on public.bins;
drop policy if exists merged_update on public.bins;
drop policy if exists merged_delete on public.bins;

create policy bins_insert_operator_plus_scoped
  on public.bins
  for insert
  to authenticated
  with check (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role, 'OPERATOR'::public.member_role])
    and exists (
      select 1
      from public.warehouses w
      where w.id = bins."warehouseId"
        and w.company_id = current_company_id()
    )
  );

create policy bins_update_operator_plus_scoped
  on public.bins
  for update
  to authenticated
  using (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role, 'OPERATOR'::public.member_role])
  )
  with check (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role, 'OPERATOR'::public.member_role])
    and exists (
      select 1
      from public.warehouses w
      where w.id = bins."warehouseId"
        and w.company_id = current_company_id()
    )
  );

create policy bins_delete_manager_plus_scoped
  on public.bins
  for delete
  to authenticated
  using (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role])
  );

drop policy if exists merged_insert on public.warehouses;
drop policy if exists merged_update on public.warehouses;
drop policy if exists merged_delete on public.warehouses;

create policy warehouses_insert_operator_plus_scoped
  on public.warehouses
  for insert
  to authenticated
  with check (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role, 'OPERATOR'::public.member_role])
  );

create policy warehouses_update_operator_plus_scoped
  on public.warehouses
  for update
  to authenticated
  using (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role, 'OPERATOR'::public.member_role])
  )
  with check (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role, 'OPERATOR'::public.member_role])
  );

create policy warehouses_delete_manager_plus_scoped
  on public.warehouses
  for delete
  to authenticated
  using (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role])
  );

drop policy if exists customers_select_active_company on public.customers;
drop policy if exists merged_insert on public.customers;
drop policy if exists merged_update on public.customers;
drop policy if exists merged_delete on public.customers;
drop policy if exists merged_select on public.customers;

create policy customers_insert_operator_plus_scoped
  on public.customers
  for insert
  to authenticated
  with check (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role, 'OPERATOR'::public.member_role])
  );

create policy customers_update_operator_plus_scoped
  on public.customers
  for update
  to authenticated
  using (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role, 'OPERATOR'::public.member_role])
  )
  with check (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role, 'OPERATOR'::public.member_role])
  );

create policy customers_delete_manager_plus_scoped
  on public.customers
  for delete
  to authenticated
  using (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role])
  );

drop policy if exists merged_insert on public.stock_movements;
drop policy if exists merged_update on public.stock_movements;
drop policy if exists merged_delete on public.stock_movements;

drop policy if exists payment_terms_delete_is_member on public.payment_terms;
drop policy if exists payment_terms_insert on public.payment_terms;
drop policy if exists payment_terms_insert_is_member on public.payment_terms;
drop policy if exists payment_terms_select on public.payment_terms;
drop policy if exists payment_terms_select_active on public.payment_terms;
drop policy if exists payment_terms_select_is_member on public.payment_terms;
drop policy if exists payment_terms_select_membership on public.payment_terms;
drop policy if exists payment_terms_update on public.payment_terms;
drop policy if exists payment_terms_update_is_member on public.payment_terms;

create policy payment_terms_select_scoped
  on public.payment_terms
  for select
  to authenticated
  using (
    company_id = current_company_id()
  );

create policy payment_terms_insert_manager_plus_scoped
  on public.payment_terms
  for insert
  to authenticated
  with check (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role])
  );

create policy payment_terms_update_manager_plus_scoped
  on public.payment_terms
  for update
  to authenticated
  using (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role])
  )
  with check (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role])
  );

create policy payment_terms_delete_manager_plus_scoped
  on public.payment_terms
  for delete
  to authenticated
  using (
    company_id = current_company_id()
    and has_company_role(company_id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role])
  );

drop policy if exists companies_member_update on public.companies;

create policy companies_update_manager_plus_scoped
  on public.companies
  for update
  to authenticated
  using (
    id = current_company_id()
    and has_company_role(id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role])
  )
  with check (
    id = current_company_id()
    and has_company_role(id, array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role])
  );

drop policy if exists uoms_select on public.uoms;
drop policy if exists uoms_insert on public.uoms;
drop policy if exists uoms_update on public.uoms;
drop policy if exists uoms_delete on public.uoms;

create policy uoms_select_enabled_membership_or_platform_admin
  on public.uoms
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or coalesce(array_length(current_user_company_ids(), 1), 0) > 0
  );

create policy uoms_insert_operator_plus_scoped
  on public.uoms
  for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or (
      current_company_id() is not null
      and has_company_role(current_company_id(), array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role, 'OPERATOR'::public.member_role])
    )
  );

create policy uoms_update_operator_plus_scoped
  on public.uoms
  for update
  to authenticated
  using (
    public.is_platform_admin()
    or (
      current_company_id() is not null
      and has_company_role(current_company_id(), array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role, 'OPERATOR'::public.member_role])
    )
  )
  with check (
    public.is_platform_admin()
    or (
      current_company_id() is not null
      and has_company_role(current_company_id(), array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role, 'OPERATOR'::public.member_role])
    )
  );

create policy uoms_delete_manager_plus_or_platform_admin
  on public.uoms
  for delete
  to authenticated
  using (
    public.is_platform_admin()
    or (
      current_company_id() is not null
      and has_company_role(current_company_id(), array['OWNER'::public.member_role, 'ADMIN'::public.member_role, 'MANAGER'::public.member_role])
    )
  );
