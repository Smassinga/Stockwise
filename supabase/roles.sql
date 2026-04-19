do $$
begin
  if not exists (
    select 1
    from pg_roles
    where rolname = 'ai_reader'
  ) then
    create role ai_reader nologin;
  end if;
end
$$;
