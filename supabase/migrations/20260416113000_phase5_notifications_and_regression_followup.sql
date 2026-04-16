create policy notifications_insert_operator_plus_scoped
  on public.notifications
  for insert
  to authenticated
  with check (
    company_id = current_company_id()
    and has_company_role(
      company_id,
      array[
        'OWNER'::public.member_role,
        'ADMIN'::public.member_role,
        'MANAGER'::public.member_role,
        'OPERATOR'::public.member_role
      ]
    )
    and (user_id is null or user_id = auth.uid())
  );
