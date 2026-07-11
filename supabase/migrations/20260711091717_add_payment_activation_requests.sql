begin;

create table public.platform_payment_channels (
  id uuid primary key default gen_random_uuid(),
  method_code text not null unique,
  display_name text not null,
  provider_category text not null check (provider_category in ('mpesa', 'emola', 'mkesh', 'bank_transfer', 'other')),
  destination_identifier text not null,
  account_name text,
  currency_code text not null default 'MZN' check (currency_code ~ '^[A-Z]{3}$'),
  operator_instructions text,
  customer_instructions text not null,
  is_active boolean not null default false,
  sort_order integer not null default 100,
  effective_from timestamptz,
  effective_until timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default timezone('utc', now()),
  check (btrim(method_code) <> ''),
  check (btrim(display_name) <> ''),
  check (btrim(destination_identifier) <> ''),
  check (btrim(customer_instructions) <> ''),
  check (effective_until is null or effective_from is null or effective_until > effective_from)
);

create table public.platform_payment_channel_events (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.platform_payment_channels(id) on delete restrict,
  event_type text not null check (event_type in ('created', 'updated', 'activated', 'deactivated')),
  actor_user_id uuid references auth.users(id),
  actor_email text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.company_payment_request_counters (
  company_id uuid primary key references public.companies(id) on delete cascade,
  next_number bigint not null default 1 check (next_number > 0),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.company_payment_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  company_id uuid not null references public.companies(id) on delete restrict,
  requested_plan_code text not null references public.plan_catalog(code) on delete restrict,
  plan_name_snapshot text not null,
  plan_price_snapshot numeric(18,2) not null check (plan_price_snapshot >= 0),
  billing_period_snapshot text not null check (billing_period_snapshot in ('monthly', 'six_month', 'annual')),
  expected_amount_snapshot numeric(18,2) not null check (expected_amount_snapshot > 0),
  currency_snapshot text not null check (currency_snapshot ~ '^[A-Z]{3}$'),
  payment_channel_id uuid not null references public.platform_payment_channels(id) on delete restrict,
  payment_provider_category_snapshot text not null check (payment_provider_category_snapshot in ('mpesa', 'emola', 'mkesh', 'bank_transfer', 'other')),
  payment_channel_display_snapshot text not null,
  payment_destination_snapshot text not null,
  payment_instructions_snapshot text not null,
  payer_name text,
  payer_phone text,
  provider_transaction_reference text,
  provider_reference_fingerprint text,
  declared_paid_amount numeric(18,2),
  amount_mismatch boolean not null default false,
  proof_bucket text,
  proof_path text,
  proof_mime_type text,
  proof_size_bytes bigint,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'under_review', 'needs_correction', 'approved', 'rejected', 'cancelled', 'expired')),
  company_submission_note text,
  platform_review_note text,
  correction_reason text,
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejected_by uuid references auth.users(id),
  rejected_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  access_start_snapshot timestamptz,
  approved_paid_until_snapshot timestamptz,
  latest_event_sequence bigint not null default 0 check (latest_event_sequence >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (company_id, reference),
  check (provider_reference_fingerprint is null or provider_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  check (declared_paid_amount is null or declared_paid_amount > 0),
  check (proof_bucket is null or proof_bucket = 'payment-proofs'),
  check (proof_mime_type is null or proof_mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  check (proof_size_bytes is null or proof_size_bytes between 1 and 5242880),
  check ((proof_path is null) = (proof_bucket is null)),
  check ((status <> 'approved') or (approved_at is not null and approved_paid_until_snapshot is not null))
);

create unique index company_payment_requests_one_open_per_company
  on public.company_payment_requests(company_id)
  where status in ('draft', 'submitted', 'under_review', 'needs_correction');

create unique index company_payment_requests_provider_reference_live_unique
  on public.company_payment_requests(payment_provider_category_snapshot, provider_reference_fingerprint)
  where provider_reference_fingerprint is not null
    and status in ('submitted', 'under_review', 'needs_correction', 'approved');

create index company_payment_requests_company_created_idx
  on public.company_payment_requests(company_id, created_at desc);
create index company_payment_requests_review_queue_idx
  on public.company_payment_requests(status, submitted_at desc, company_id);
create index company_payment_requests_plan_status_idx
  on public.company_payment_requests(requested_plan_code, status, submitted_at desc);

create table public.company_payment_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.company_payment_requests(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  sequence bigint not null check (sequence > 0),
  event_type text not null check (event_type in ('created', 'proof_attached', 'submitted', 'review_started', 'correction_requested', 'resubmitted', 'approved', 'rejected', 'cancelled', 'expired', 'access_activated')),
  previous_status text,
  new_status text,
  actor_user_id uuid references auth.users(id),
  actor_class text not null check (actor_class in ('company_user', 'platform_admin', 'system')),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (request_id, sequence)
);

create index company_payment_request_events_company_request_idx
  on public.company_payment_request_events(company_id, request_id, sequence);

alter table public.platform_payment_channels enable row level security;
alter table public.platform_payment_channels force row level security;
alter table public.platform_payment_channel_events enable row level security;
alter table public.platform_payment_channel_events force row level security;
alter table public.company_payment_request_counters enable row level security;
alter table public.company_payment_request_counters force row level security;
alter table public.company_payment_requests enable row level security;
alter table public.company_payment_requests force row level security;
alter table public.company_payment_request_events enable row level security;
alter table public.company_payment_request_events force row level security;

create policy platform_payment_channels_company_read on public.platform_payment_channels
  for select to authenticated
  using (
    public.is_platform_admin()
    or (
      is_active
      and (effective_from is null or effective_from <= timezone('utc', now()))
      and (effective_until is null or effective_until > timezone('utc', now()))
      and exists (
        select 1 from public.company_members cm
        where cm.user_id = auth.uid() and cm.status = 'active'::public.member_status
      )
    )
  );

create policy platform_payment_channel_events_admin_read on public.platform_payment_channel_events
  for select to authenticated using (public.is_platform_admin());

create policy company_payment_requests_member_read on public.company_payment_requests
  for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.company_members cm
      where cm.company_id = company_payment_requests.company_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'::public.member_status
    )
  );

create policy company_payment_request_events_member_read on public.company_payment_request_events
  for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.company_members cm
      where cm.company_id = company_payment_request_events.company_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'::public.member_status
    )
  );

revoke all on public.platform_payment_channels from public, anon, authenticated;
revoke all on public.platform_payment_channel_events from public, anon, authenticated;
revoke all on public.company_payment_request_counters from public, anon, authenticated;
revoke all on public.company_payment_requests from public, anon, authenticated;
revoke all on public.company_payment_request_events from public, anon, authenticated;
grant select on public.platform_payment_channel_events to authenticated;
grant select on public.company_payment_requests to authenticated;
grant select on public.company_payment_request_events to authenticated;

alter table public.company_control_action_log
  drop constraint if exists company_control_action_log_action_type_check;
alter table public.company_control_action_log
  add constraint company_control_action_log_action_type_check check (action_type in (
    'operational_reset',
    'access_email_expiry_warning_sent',
    'access_email_purge_warning_sent',
    'access_email_activation_confirmation_sent',
    'payment_channel_created',
    'payment_channel_updated',
    'payment_channel_activated',
    'payment_channel_deactivated',
    'payment_request_submitted',
    'payment_request_review_started',
    'payment_request_correction_requested',
    'payment_request_rejected',
    'payment_request_approved',
    'payment_request_cancelled'
  ));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'application/pdf']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy payment_proofs_select_scoped on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (
      public.is_platform_admin()
      or exists (
        select 1
        from public.company_payment_requests pr
        join public.company_members cm on cm.company_id = pr.company_id
        where pr.id = case when split_part(name, '/', 2) ~* '^[0-9a-f-]{36}$' then split_part(name, '/', 2)::uuid else null end
          and pr.company_id = case when split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$' then split_part(name, '/', 1)::uuid else null end
          and cm.user_id = auth.uid()
          and cm.status = 'active'::public.member_status
      )
    )
  );

create policy payment_proofs_insert_scoped on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and exists (
      select 1
      from public.company_payment_requests pr
      join public.company_members cm on cm.company_id = pr.company_id
      where pr.id = case when split_part(name, '/', 2) ~* '^[0-9a-f-]{36}$' then split_part(name, '/', 2)::uuid else null end
        and pr.company_id = case when split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$' then split_part(name, '/', 1)::uuid else null end
        and pr.status in ('draft', 'needs_correction')
        and cm.user_id = auth.uid()
        and cm.status = 'active'::public.member_status
        and cm.role in ('OWNER'::public.member_role, 'ADMIN'::public.member_role)
    )
  );

create policy payment_proofs_update_scoped on storage.objects
  for update to authenticated
  using (
    bucket_id = 'payment-proofs'
    and exists (
      select 1 from public.company_payment_requests pr
      join public.company_members cm on cm.company_id = pr.company_id
      where pr.id = case when split_part(name, '/', 2) ~* '^[0-9a-f-]{36}$' then split_part(name, '/', 2)::uuid else null end
        and pr.company_id = case when split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$' then split_part(name, '/', 1)::uuid else null end
        and pr.status in ('draft', 'needs_correction')
        and cm.user_id = auth.uid() and cm.status = 'active'::public.member_status
        and cm.role in ('OWNER'::public.member_role, 'ADMIN'::public.member_role)
    )
  )
  with check (
    bucket_id = 'payment-proofs'
    and exists (
      select 1 from public.company_payment_requests pr
      join public.company_members cm on cm.company_id = pr.company_id
      where pr.id = case when split_part(name, '/', 2) ~* '^[0-9a-f-]{36}$' then split_part(name, '/', 2)::uuid else null end
        and pr.company_id = case when split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$' then split_part(name, '/', 1)::uuid else null end
        and pr.status in ('draft', 'needs_correction')
        and cm.user_id = auth.uid() and cm.status = 'active'::public.member_status
        and cm.role in ('OWNER'::public.member_role, 'ADMIN'::public.member_role)
    )
  );

create policy payment_proofs_delete_scoped on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'payment-proofs'
    and exists (
      select 1 from public.company_payment_requests pr
      join public.company_members cm on cm.company_id = pr.company_id
      where pr.id = case when split_part(name, '/', 2) ~* '^[0-9a-f-]{36}$' then split_part(name, '/', 2)::uuid else null end
        and pr.company_id = case when split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$' then split_part(name, '/', 1)::uuid else null end
        and pr.status in ('draft', 'needs_correction')
        and cm.user_id = auth.uid() and cm.status = 'active'::public.member_status
        and cm.role in ('OWNER'::public.member_role, 'ADMIN'::public.member_role)
    )
  );

commit;
