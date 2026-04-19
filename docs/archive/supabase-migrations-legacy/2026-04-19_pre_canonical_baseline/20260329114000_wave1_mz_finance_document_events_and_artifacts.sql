create table if not exists public.finance_document_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_kind text not null
    check (document_kind in ('sales_invoice', 'sales_credit_note', 'sales_debit_note', 'vendor_bill', 'saft_moz_export')),
  document_id uuid not null,
  event_type text not null,
  from_status text null,
  to_status text null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists finance_document_events_document_idx
  on public.finance_document_events (company_id, document_kind, document_id, occurred_at desc);

create table if not exists public.fiscal_document_artifacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_kind text not null
    check (document_kind in ('sales_invoice', 'sales_credit_note', 'sales_debit_note')),
  document_id uuid not null,
  artifact_type text not null
    check (artifact_type in ('pdf', 'xml', 'imported_source')),
  storage_bucket text null,
  storage_path text not null,
  file_name text null,
  mime_type text null,
  content_sha256 text null,
  size_bytes bigint null,
  is_canonical boolean not null default false,
  retained_until date null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists fiscal_document_artifacts_document_idx
  on public.fiscal_document_artifacts (company_id, document_kind, document_id, created_at desc);

create unique index if not exists fiscal_document_artifacts_canonical_key
  on public.fiscal_document_artifacts (company_id, document_kind, document_id, artifact_type)
  where is_canonical;

create or replace function public.append_finance_document_event(
  p_company_id uuid,
  p_document_kind text,
  p_document_id uuid,
  p_event_type text,
  p_from_status text default null,
  p_to_status text default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_id uuid;
begin
  if p_company_id is null then
    raise exception using
      message = 'Finance document events require a company id.';
  end if;

  if not public.finance_documents_can_write(p_company_id) then
    raise exception using
      message = 'Finance document event write access denied.';
  end if;

  if p_document_kind not in ('sales_invoice', 'sales_credit_note', 'sales_debit_note', 'vendor_bill', 'saft_moz_export') then
    raise exception using
      message = format('Unsupported finance document event kind: %s.', coalesce(p_document_kind, '<null>'));
  end if;

  if p_document_id is null then
    raise exception using
      message = 'Finance document events require a document id.';
  end if;

  if nullif(btrim(coalesce(p_event_type, '')), '') is null then
    raise exception using
      message = 'Finance document events require an event type.';
  end if;

  insert into public.finance_document_events (
    company_id,
    document_kind,
    document_id,
    event_type,
    from_status,
    to_status,
    actor_user_id,
    payload
  )
  values (
    p_company_id,
    p_document_kind,
    p_document_id,
    btrim(p_event_type),
    p_from_status,
    p_to_status,
    auth.uid(),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

create or replace function public.fiscal_document_artifact_defaults()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_retention_years integer;
begin
  if nullif(btrim(coalesce(new.storage_path, '')), '') is null then
    raise exception using
      message = 'Fiscal document artifacts require a storage path.';
  end if;

  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if new.retained_until is null then
    select greatest(coalesce(cfs.archive_retention_years, 5), 5)
      into v_retention_years
    from public.company_fiscal_settings cfs
    where cfs.company_id = new.company_id;

    new.retained_until := (
      current_date
      + make_interval(years => coalesce(v_retention_years, 5))
    )::date;
  end if;

  return new;
end;
$$;

create or replace function public.register_fiscal_document_artifact(
  p_company_id uuid,
  p_document_kind text,
  p_document_id uuid,
  p_artifact_type text,
  p_storage_bucket text,
  p_storage_path text,
  p_file_name text default null,
  p_mime_type text default null,
  p_content_sha256 text default null,
  p_size_bytes bigint default null,
  p_is_canonical boolean default false,
  p_retained_until date default null
)
returns public.fiscal_document_artifacts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_artifact public.fiscal_document_artifacts;
  v_exists boolean;
begin
  if not public.finance_documents_can_write(p_company_id) then
    raise exception using
      message = 'Fiscal artifact registration access denied.';
  end if;

  if p_document_kind = 'sales_invoice' then
    select exists (
      select 1
      from public.sales_invoices si
      where si.id = p_document_id
        and si.company_id = p_company_id
    ) into v_exists;
  elsif p_document_kind = 'sales_credit_note' then
    select exists (
      select 1
      from public.sales_credit_notes scn
      where scn.id = p_document_id
        and scn.company_id = p_company_id
    ) into v_exists;
  elsif p_document_kind = 'sales_debit_note' then
    select exists (
      select 1
      from public.sales_debit_notes sdn
      where sdn.id = p_document_id
        and sdn.company_id = p_company_id
    ) into v_exists;
  else
    raise exception using
      message = format('Unsupported fiscal artifact document kind: %s.', coalesce(p_document_kind, '<null>'));
  end if;

  if not coalesce(v_exists, false) then
    raise exception using
      message = 'Fiscal artifact registration requires an existing finance document.';
  end if;

  insert into public.fiscal_document_artifacts (
    company_id,
    document_kind,
    document_id,
    artifact_type,
    storage_bucket,
    storage_path,
    file_name,
    mime_type,
    content_sha256,
    size_bytes,
    is_canonical,
    retained_until,
    created_by
  )
  values (
    p_company_id,
    p_document_kind,
    p_document_id,
    p_artifact_type,
    p_storage_bucket,
    p_storage_path,
    p_file_name,
    p_mime_type,
    p_content_sha256,
    p_size_bytes,
    coalesce(p_is_canonical, false),
    p_retained_until,
    auth.uid()
  )
  returning * into v_artifact;

  return v_artifact;
end;
$$;

create or replace function public.finance_document_header_event_journal()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_document_kind text;
  v_event_type text;
  v_from_status text;
  v_to_status text;
  v_payload jsonb;
begin
  v_document_kind := case tg_table_name
    when 'sales_invoices' then 'sales_invoice'
    when 'sales_credit_notes' then 'sales_credit_note'
    when 'sales_debit_notes' then 'sales_debit_note'
    else null
  end;

  if v_document_kind is null then
    raise exception using
      message = format('finance_document_header_event_journal does not support table %s.', tg_table_name);
  end if;

  if tg_op = 'INSERT' then
    v_event_type := 'draft_created';
    v_from_status := null;
    v_to_status := new.document_workflow_status;
  elsif tg_op = 'UPDATE' and new.document_workflow_status is distinct from old.document_workflow_status then
    v_from_status := old.document_workflow_status;
    v_to_status := new.document_workflow_status;
    v_event_type := case new.document_workflow_status
      when 'issued' then 'issued'
      when 'voided' then 'voided'
      else 'status_changed'
    end;
  else
    return null;
  end if;

  v_payload := jsonb_build_object(
    'internal_reference', new.internal_reference,
    'source_origin', new.source_origin,
    'document_status', new.document_workflow_status
  );

  perform public.append_finance_document_event(
    new.company_id,
    v_document_kind,
    new.id,
    v_event_type,
    v_from_status,
    v_to_status,
    v_payload
  );

  return null;
end;
$$;

create or replace function public.fiscal_document_artifact_event_journal()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform public.append_finance_document_event(
    new.company_id,
    new.document_kind,
    new.document_id,
    'artifact_registered',
    null,
    null,
    jsonb_build_object(
      'artifact_type', new.artifact_type,
      'storage_bucket', new.storage_bucket,
      'storage_path', new.storage_path,
      'file_name', new.file_name,
      'mime_type', new.mime_type,
      'is_canonical', new.is_canonical
    )
  );

  return null;
end;
$$;

drop trigger if exists ai_10_sales_invoice_event_journal on public.sales_invoices;
create trigger ai_10_sales_invoice_event_journal
after insert on public.sales_invoices
for each row execute function public.finance_document_header_event_journal();

drop trigger if exists au_10_sales_invoice_event_journal on public.sales_invoices;
create trigger au_10_sales_invoice_event_journal
after update on public.sales_invoices
for each row execute function public.finance_document_header_event_journal();

drop trigger if exists ai_10_sales_credit_note_event_journal on public.sales_credit_notes;
create trigger ai_10_sales_credit_note_event_journal
after insert on public.sales_credit_notes
for each row execute function public.finance_document_header_event_journal();

drop trigger if exists au_10_sales_credit_note_event_journal on public.sales_credit_notes;
create trigger au_10_sales_credit_note_event_journal
after update on public.sales_credit_notes
for each row execute function public.finance_document_header_event_journal();

drop trigger if exists ai_10_sales_debit_note_event_journal on public.sales_debit_notes;
create trigger ai_10_sales_debit_note_event_journal
after insert on public.sales_debit_notes
for each row execute function public.finance_document_header_event_journal();

drop trigger if exists au_10_sales_debit_note_event_journal on public.sales_debit_notes;
create trigger au_10_sales_debit_note_event_journal
after update on public.sales_debit_notes
for each row execute function public.finance_document_header_event_journal();

drop trigger if exists bi_10_fiscal_document_artifact_defaults on public.fiscal_document_artifacts;
create trigger bi_10_fiscal_document_artifact_defaults
before insert on public.fiscal_document_artifacts
for each row execute function public.fiscal_document_artifact_defaults();

drop trigger if exists ai_10_fiscal_document_artifact_event_journal on public.fiscal_document_artifacts;
create trigger ai_10_fiscal_document_artifact_event_journal
after insert on public.fiscal_document_artifacts
for each row execute function public.fiscal_document_artifact_event_journal();

alter table public.finance_document_events enable row level security;
alter table public.fiscal_document_artifacts enable row level security;

drop policy if exists finance_document_events_select on public.finance_document_events;
create policy finance_document_events_select
on public.finance_document_events
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists finance_document_events_insert on public.finance_document_events;
create policy finance_document_events_insert
on public.finance_document_events
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists fiscal_document_artifacts_select on public.fiscal_document_artifacts;
create policy fiscal_document_artifacts_select
on public.fiscal_document_artifacts
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists fiscal_document_artifacts_insert on public.fiscal_document_artifacts;

revoke all on public.finance_document_events from public, anon;
revoke all on public.fiscal_document_artifacts from public, anon;

grant select on public.finance_document_events to authenticated;
grant select on public.fiscal_document_artifacts to authenticated;

revoke all on function public.append_finance_document_event(uuid, text, uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.register_fiscal_document_artifact(uuid, text, uuid, text, text, text, text, text, text, bigint, boolean, date) from public, anon;
grant execute on function public.append_finance_document_event(uuid, text, uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.register_fiscal_document_artifact(uuid, text, uuid, text, text, text, text, text, text, bigint, boolean, date) to authenticated;

comment on table public.finance_document_events is
  'Append-only audit journal for finance document lifecycle actions relevant to Mozambique compliance.';

comment on table public.fiscal_document_artifacts is
  'Artifact metadata for archived fiscal files such as PDFs, XML exports, and imported source documents.';

comment on function public.register_fiscal_document_artifact(uuid, text, uuid, text, text, text, text, text, text, bigint, boolean, date) is
  'Registers a fiscal document artifact without mutating issued finance-document truth and lets retention defaults be derived automatically.';
