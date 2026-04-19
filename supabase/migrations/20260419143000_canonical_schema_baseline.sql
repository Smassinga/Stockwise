SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "postgres";


CREATE TYPE "public"."company_role" AS ENUM (
    'OWNER',
    'ADMIN',
    'MANAGER',
    'OPERATOR',
    'VIEWER'
);


ALTER TYPE "public"."company_role" OWNER TO "postgres";


CREATE TYPE "public"."member_role" AS ENUM (
    'OWNER',
    'ADMIN',
    'MANAGER',
    'OPERATOR',
    'VIEWER'
);


ALTER TYPE "public"."member_role" OWNER TO "postgres";


CREATE TYPE "public"."member_status" AS ENUM (
    'invited',
    'active',
    'disabled'
);


ALTER TYPE "public"."member_status" OWNER TO "postgres";


CREATE TYPE "public"."po_status" AS ENUM (
    'draft',
    'submitted',
    'approved',
    'partially_received',
    'closed',
    'cancelled'
);


ALTER TYPE "public"."po_status" OWNER TO "postgres";


CREATE TYPE "public"."so_status" AS ENUM (
    'draft',
    'submitted',
    'confirmed',
    'allocated',
    'shipped',
    'closed',
    'cancelled'
);


ALTER TYPE "public"."so_status" OWNER TO "postgres";


CREATE TYPE "public"."subscription_status" AS ENUM (
    'trial',
    'active_paid',
    'expired',
    'suspended',
    'disabled'
);


ALTER TYPE "public"."subscription_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_end_of_day"("p_date" "date") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select (p_date::timestamptz + interval '1 day') - interval '1 millisecond'
$$;


ALTER FUNCTION "public"."_end_of_day"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_link_invites_on_user_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.company_members
     set user_id = new.id
   where user_id is null
     and lower(email) = lower(new.email);

  update public.company_members
     set status = 'active'
   where user_id = new.id
     and status = 'invited';

  return new;
end;
$$;


ALTER FUNCTION "public"."_link_invites_on_user_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_notify_on_member_activated"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_name text;
begin
  if tg_op = 'UPDATE'
     and new.status = 'active'
     and (old.status is distinct from new.status) then

    -- try profiles.name first
    select p.name into v_name
    from public.profiles p
    where p.user_id = new.user_id
    limit 1;

    -- then auth.users.raw_user_meta_data->>name
    if v_name is null then
      select u.raw_user_meta_data->>'name' into v_name
      from auth.users u
      where u.id = new.user_id
      limit 1;
    end if;

    -- final fallback: email local-part
    if v_name is null then
      v_name := split_part(coalesce(new.email, ''), '@', 1);
    end if;

    insert into public.notifications
      (company_id, user_id, level, title, body, url, created_at)
    values
      (new.company_id,
       new.user_id,
       'info',
       'New team member joined',
       coalesce(v_name, 'A user') || ' joined the company.',
       '/users',
       now());
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."_notify_on_member_activated"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_sol_recompute_is_shipped"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
begin
  new.is_shipped := coalesce(new.shipped_qty,0) >= coalesce(new.qty,0);
  return new;
end
$$;


ALTER FUNCTION "public"."_sol_recompute_is_shipped"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_upsert_level"("p_company" "uuid", "p_item" "uuid", "p_wh" "uuid", "p_bin" "text", "p_delta" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
BEGIN
  IF p_delta = 0 THEN
    RETURN;
  END IF;

  LOOP
    UPDATE public.stock_levels
       SET qty = qty + p_delta,
           updated_at = now()
     WHERE company_id = p_company
       AND item_id    = p_item
       AND warehouse_id IS NOT DISTINCT FROM p_wh
       AND bin_id       IS NOT DISTINCT FROM p_bin;
    IF FOUND THEN
      RETURN;
    END IF;

    BEGIN
      INSERT INTO public.stock_levels (id, company_id, item_id, warehouse_id, bin_id, qty, updated_at)
      VALUES (gen_random_uuid(), p_company, p_item, p_wh, p_bin, p_delta, now());
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- concurrent insert; retry UPDATE
    END;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."_upsert_level"("p_company" "uuid", "p_item" "uuid", "p_wh" "uuid", "p_bin" "text", "p_delta" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_company_invite"("p_token" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_claim_email text := nullif(current_setting('request.jwt.claim.email', true), '');
  v_uid uuid := auth.uid();
  v_company uuid;
  v_email citext;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  select company_id, email
    into v_company, v_email
  from public.company_invites
  where token = p_token
    and accepted_at is null
    and now() < expires_at
  limit 1;

  if v_company is null then
    raise exception 'invalid or expired token' using errcode = '22023';
  end if;

  -- email must match the invite
  if lower(coalesce(v_claim_email, '')) <> lower(v_email::text) then
    raise exception 'token email does not match signed-in user' using errcode = '22023';
  end if;

  -- link membership to this user and activate
  insert into public.company_members(company_id, email, role, status, user_id, invited_by)
  values (v_company, v_email, 'VIEWER', 'active', v_uid, null)
  on conflict (company_id, email)
  do update set user_id = v_uid, status = 'active';

  update public.company_invites
     set accepted_at = now()
   where token = p_token;

  return v_company; -- frontend can route user to this company
end;
$$;


ALTER FUNCTION "public"."accept_company_invite"("p_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_invite_with_token"("p_token" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_invite record;
  v_email text;
  v_now   timestamptz := now();
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'Missing invite token';
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    raise exception 'No email for auth.uid()';
  end if;

  select * into v_invite
    from public.company_invites
   where token = p_token
   order by created_at desc
   limit 1;

  if v_invite is null then
    raise exception 'Invite not found for token';
  end if;

  if lower(v_invite.email) <> lower(v_email) then
    raise exception 'Invite email % does not match your account %', v_invite.email, v_email;
  end if;

  insert into public.company_members(company_id, email, user_id, role, status, created_at)
  values (v_invite.company_id, v_email, auth.uid(), v_invite.role, 'active', v_now)
  on conflict (company_id, email) do update
     set user_id = excluded.user_id,
         role    = excluded.role,
         status  = 'active';

  update public.company_invites
     set accepted_at = coalesce(accepted_at, v_now)
   where company_id = v_invite.company_id
     and lower(email) = lower(v_email);

  return true;
end;
$$;


ALTER FUNCTION "public"."accept_invite_with_token"("p_token" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."accept_invite_with_token"("p_token" "text") IS 'Redeem an invite token for the logged-in user; activates membership and marks invites accepted.';



CREATE OR REPLACE FUNCTION "public"."accept_invite_with_token"("p_token" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_email text;
  v_company uuid;
  v_role public.company_role;
  v_inv_id uuid;
begin
  -- Require an authenticated user
  select auth.uid(), (select email from auth.users where id = auth.uid())
    into v_user_id, v_email;
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  -- Find a matching invite (not expired, not accepted)
  select i.id, i.company_id, i.role
    into v_inv_id, v_company, v_role
  from public.company_invites i
  where i.token = p_token
    and (i.expires_at is null or i.expires_at > now())
    and i.accepted_at is null
  limit 1;

  if v_inv_id is null then
    raise exception 'invalid_or_expired_token';
  end if;

  -- Enforce email match (case-insensitive)
  if not exists (
    select 1
    from public.company_invites i
    where i.id = v_inv_id
      and lower(i.email) = lower(v_email)
  ) then
    raise exception 'invite_email_mismatch';
  end if;

  -- Upsert membership and activate it (fires the trigger)
  insert into public.company_members (company_id, user_id, email, role, status, invited_by)
  values (v_company, v_user_id, v_email, v_role, 'active',
          (select created_by from public.company_invites where id = v_inv_id))
  on conflict (company_id, email) do update
  set user_id = excluded.user_id,
      role    = excluded.role,
      status  = 'active';

  -- Mark invite as used (single-use)
  update public.company_invites
    set accepted_at = now()
  where id = v_inv_id;

  return jsonb_build_object('ok', true, 'company_id', v_company, 'role', v_role);
end;
$$;


ALTER FUNCTION "public"."accept_invite_with_token"("p_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_my_invite"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_email text;
  v_role  public.company_members.role%type;
  v_now   timestamptz := now();
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    raise exception 'No email for auth.uid()';
  end if;

  -- Promote existing email-based membership
  update public.company_members cm
     set user_id = auth.uid(),
         status  = 'active'
   where cm.company_id = p_company_id
     and lower(cm.email) = lower(v_email)
  returning cm.role into v_role;

  if not found then
    -- Take role from most recent invite
    select i.role into v_role
      from public.company_invites i
     where i.company_id = p_company_id
       and lower(i.email) = lower(v_email)
     order by i.created_at desc
     limit 1;

    if v_role is null then
      raise exception 'No invite found for % in company %', v_email, p_company_id;
    end if;

    insert into public.company_members(company_id, email, user_id, role, status, created_at)
    values (p_company_id, v_email, auth.uid(), v_role, 'active', v_now)
    on conflict (company_id, email) do update
      set user_id = excluded.user_id,
          role    = excluded.role,
          status  = 'active';
  end if;

  update public.company_invites
     set accepted_at = coalesce(accepted_at, v_now)
   where company_id = p_company_id
     and lower(email) = lower(v_email);

  return true;
end;
$$;


ALTER FUNCTION "public"."accept_my_invite"("p_company_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."accept_my_invite"("p_company_id" "uuid") IS 'Promote the current user''s pending invite/email membership to an active membership for the given company.';



CREATE OR REPLACE FUNCTION "public"."active_company_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  with primary_source as (
    select uac.company_id
    from public.user_active_company uac
    join public.company_members cm
      on cm.company_id = uac.company_id
     and cm.user_id = uac.user_id
     and cm.status = 'active'::member_status
    where uac.user_id = auth.uid()
      and public.company_access_is_enabled(uac.company_id)
    order by uac.updated_at desc
    limit 1
  ),
  fallback as (
    select cm.company_id
    from public.company_members cm
    where cm.user_id = auth.uid()
      and cm.status = 'active'::member_status
      and public.company_access_is_enabled(cm.company_id)
    order by cm.role asc, cm.created_at asc
    limit 1
  )
  select coalesce(
    (select company_id from primary_source),
    (select company_id from fallback)
  );
$$;


ALTER FUNCTION "public"."active_company_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."actor_role_for"("p_company" "uuid") RETURNS "public"."member_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
  select cm.role
  from public.company_members cm
  where cm.company_id = p_company
    and cm.user_id = auth.uid()
    and cm.status = 'active'
    and public.company_access_is_enabled(p_company)
  order by public.role_rank(cm.role) desc, cm.created_at asc
  limit 1
$$;


ALTER FUNCTION "public"."actor_role_for"("p_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_allowed_currency_for_current_company"("p_code" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  v_company_id uuid := public.current_company_id();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or v_company_id is null
       or not public.has_company_role(v_company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  insert into public.company_currencies(company_id, currency_code)
  values (v_company_id, p_code)
  on conflict do nothing;
end
$$;


ALTER FUNCTION "public"."add_allowed_currency_for_current_company"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_exec_one"("p_sql" "text", "p_dry_run" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  norm text := public.ai_sql_norm(p_sql);
  low  text := lower(norm);
  started timestamptz := now();
  is_dml boolean := false;
  is_ddl boolean := false;
  plan jsonb;
  msg text;
begin
  if not public.ai_sql_is_allowed(norm) then
    return jsonb_build_object(
      'ok', false,
      'error', 'blocked_by_guardrail',
      'message', 'Statement violates AI execution guardrails',
      'sql', norm
    );
  end if;

  -- classify basic statement kind
  is_dml := low ~ '^(select|insert|update|delete)\b';
  is_ddl := low ~ '^(create|alter|drop|grant|revoke|comment|truncate)\b'
            or low ~ '^(create[[:space:]]+index)\b';

  if p_dry_run then
    if is_dml then
      -- Explain without executing; returns a single JSON doc
      begin
        execute 'EXPLAIN (FORMAT JSON, VERBOSE, COSTS FALSE) ' || norm into plan;
        msg := 'dry_run_plan';
        return jsonb_build_object(
          'ok', true,
          'message', msg,
          'sql', norm,
          'dry_run', true,
          'plan', plan,
          'started_at', started,
          'ended_at', now()
        );
      exception when others then
        return jsonb_build_object(
          'ok', false,
          'message', sqlerrm,
          'error', 'explain_failed',
          'sql', norm,
          'dry_run', true,
          'started_at', started,
          'ended_at', now()
        );
      end;
    else
      -- DDL or other: we cannot EXPLAIN reliably; report guardrails-only pass.
      return jsonb_build_object(
        'ok', true,
        'message', 'dry_run_guardrails_passed_only',
        'note', 'No execution performed; DDL syntax not validated in function context.',
        'sql', norm,
        'dry_run', true,
        'started_at', started,
        'ended_at', now()
      );
    end if;
  else
    -- APPLY for real (single statement)
    begin
      execute norm;
      return jsonb_build_object(
        'ok', true,
        'message', 'applied',
        'sql', norm,
        'dry_run', false,
        'started_at', started,
        'ended_at', now()
      );
    exception when others then
      return jsonb_build_object(
        'ok', false,
        'message', sqlerrm,
        'error', 'apply_failed',
        'sql', norm,
        'dry_run', false,
        'started_at', started,
        'ended_at', now()
      );
    end;
  end if;
end
$$;


ALTER FUNCTION "public"."ai_exec_one"("p_sql" "text", "p_dry_run" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_sql_classify"("p_sql" "text") RETURNS TABLE("verb" "text", "target_table" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  s text := trim(regexp_replace(p_sql, '\s+', ' ', 'g'));
  low text := lower(s);
  m text[];
begin
  -- INSERT INTO {schema.table}
  if low ~ '^insert[ ]+into[ ]+' then
    m := regexp_match(low, '^insert[ ]+into[ ]+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)');
    if m is not null then return query select 'insert', m[1]; return; end if;
  end if;

  -- UPDATE {schema.table}
  if low ~ '^update[ ]+' then
    m := regexp_match(low, '^update[ ]+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)');
    if m is not null then return query select 'update', m[1]; return; end if;
  end if;

  -- DELETE FROM {schema.table}
  if low ~ '^delete[ ]+from[ ]+' then
    m := regexp_match(low, '^delete[ ]+from[ ]+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)');
    if m is not null then return query select 'delete', m[1]; return; end if;
  end if;

  -- SELECT ... FROM {schema.table}
  if low ~ '^select[ ]+' then
    m := regexp_match(low, 'from[ ]+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)');
    if m is not null then return query select 'select', m[1]; return; end if;
  end if;

  -- CREATE TABLE {schema.table}
  if low ~ '^create[ ]+table' then
    m := regexp_match(low, '^create[ ]+table( if not exists)?[ ]+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)');
    if m is not null then return query select 'create_table', m[2]; return; end if;
  end if;

  -- CREATE INDEX ... ON {schema.table}
  if low ~ '^create[ ]+index' then
    m := regexp_match(low, ' on[ ]+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)');
    if m is not null then return query select 'create_index', m[1]; return; end if;
  end if;

  -- ALTER TABLE {schema.table}
  if low ~ '^alter[ ]+table' then
    m := regexp_match(low, '^alter[ ]+table[ ]+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)');
    if m is not null then return query select 'alter_table', m[1]; return; end if;
  end if;

  -- DROP TABLE {schema.table}
  if low ~ '^drop[ ]+table' then
    m := regexp_match(low, '^drop[ ]+table( if exists)?[ ]+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)');
    if m is not null then return query select 'drop_table', m[2]; return; end if;
  end if;

  -- TRUNCATE {schema.table}
  if low ~ '^truncate[ ]+' then
    m := regexp_match(low, '^truncate[ ]+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)');
    if m is not null then return query select 'truncate', m[1]; return; end if;
  end if;

  -- Fallback: unknown target; return a row with nulls so the caller can block.
  return query select null::text, null::text;
end
$$;


ALTER FUNCTION "public"."ai_sql_classify"("p_sql" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_sql_is_allowed"("p_sql" "text") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  s text := lower(public.ai_sql_norm(p_sql));
  v text;
  t text;
  hit boolean;
begin
  -- existing coarse guardrails
  if s ~ '\bdrop\s+(database|schema)\b'
     or s ~ '\balter\s+system\b'
     or s ~ '\bcreate\s+extension\b'
     or s ~ '\balter\s+extension\b'
     or s ~ '\bcopy\b.*\bprogram\b'
     or s ~ '\bcreate\s+server\b'
     or s ~ '\bcreate\s+user\b' or s ~ '\balter\s+user\b' or s ~ '\bdrop\s+user\b'
     or s ~ '\bgrant\b.+\bon\b.+\ball\b+'
  then
    return false;
  end if;

  -- never touch privileged/internal schemas
  if s ~ '\b(auth|pg_catalog|information_schema|pg_toast|storage)\.' then
    return false;
  end if;

  -- Only allow explicit schema qualification for 'public'
  if s ~ '\b(?!public\.)[a-z_][a-z0-9_]*\.' then
    return false;
  end if;

  -- classify and check allowlist
  select verb, target_table into v, t from public.ai_sql_classify(s);

  -- If we cannot classify a target table (e.g., complex SELECT), treat as blocked for now.
  if t is null then
    return false;
  end if;

  -- look for an allowlist row where table_pattern LIKE matches the target
  select exists (
    select 1
    from public.ai_ops_allowlist
    where is_allowed = true
      and lower(verb) = v
      and (lower(t) like lower(table_pattern))
  ) into hit;

  return coalesce(hit, false);
end
$$;


ALTER FUNCTION "public"."ai_sql_is_allowed"("p_sql" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_sql_norm"("p_sql" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select regexp_replace(trim(p_sql), '\s+', ' ', 'g')
$$;


ALTER FUNCTION "public"."ai_sql_norm"("p_sql" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."append_finance_document_event"("p_company_id" "uuid", "p_document_kind" "text", "p_document_id" "uuid", "p_event_type" "text", "p_from_status" "text" DEFAULT NULL::"text", "p_to_status" "text" DEFAULT NULL::"text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
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

  if p_document_kind not in ('sales_invoice', 'sales_credit_note', 'sales_debit_note', 'vendor_bill', 'vendor_credit_note', 'vendor_debit_note', 'saft_moz_export') then
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


ALTER FUNCTION "public"."append_finance_document_event"("p_company_id" "uuid", "p_document_kind" "text", "p_document_id" "uuid", "p_event_type" "text", "p_from_status" "text", "p_to_status" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_company_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.company_id is null then
    select cm.company_id
      into new.company_id
    from public.company_members cm
    where cm.user_id = auth.uid()
      and cm.status = 'active'::member_status
    order by cm.created_at asc
    limit 1;
  end if;
  return new;
end
$$;


ALTER FUNCTION "public"."apply_company_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_company_policies"("tbl" "regclass") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
declare
  tname text := tbl::text;
  base text := split_part(tname, '.', 2);
begin
  execute format('alter table %s enable row level security', tname);

  execute format('drop policy if exists %I_select on %s', base||'_select', tname);
  execute format('drop policy if exists %I_insert on %s', base||'_insert', tname);
  execute format('drop policy if exists %I_update on %s', base||'_update', tname);
  execute format('drop policy if exists %I_delete on %s', base||'_delete', tname);

  execute format('create policy %I_select on %s for select using (public.is_member_of_company(company_id))', base||'_select', tname);
  execute format('create policy %I_insert on %s for insert with check (public.is_member_of_company(company_id))', base||'_insert', tname);
  execute format('create policy %I_update on %s for update using (public.is_member_of_company(company_id)) with check (public.is_member_of_company(company_id))', base||'_update', tname);
  execute format('create policy %I_delete on %s for delete using (public.is_member_of_company(company_id))', base||'_delete', tname);
end;
$$;


ALTER FUNCTION "public"."apply_company_policies"("tbl" "regclass") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_landed_cost_run"("p_company_id" "uuid", "p_purchase_order_id" "uuid", "p_supplier_id" "uuid", "p_applied_by" "uuid", "p_currency_code" "text", "p_fx_to_base" numeric, "p_allocation_method" "text", "p_total_extra_cost" numeric, "p_notes" "text", "p_charges" "jsonb", "p_lines" "jsonb") RETURNS TABLE("run_id" "uuid", "line_count" integer, "total_applied_value" numeric, "total_unapplied_value" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_run_id uuid;
  v_bucket record;
  v_charge jsonb;
  v_po record;
  v_charge_amount numeric;
  v_charge_label text;
  v_line_count integer := 0;
  v_total_applied numeric := 0;
  v_total_unapplied numeric := 0;
  v_total_extra_cost numeric := 0;
  v_total_extra_cost_base numeric := 0;
  v_total_receipt_qty numeric := 0;
  v_total_receipt_value numeric := 0;
  v_allocated_so_far numeric := 0;
  v_bucket_count integer := 0;
  v_allocated_extra numeric := 0;
  v_delta_per_received_unit numeric := 0;
  v_impacted_qty numeric := 0;
  v_applied numeric := 0;
  v_unapplied numeric := 0;
  v_new_avg_cost numeric := 0;
  v_stock_movement_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_fx_to_base numeric := 1;
  v_normalized_charges jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_company_id IS NULL OR p_purchase_order_id IS NULL THEN
    RAISE EXCEPTION 'company_id_required';
  END IF;

  IF p_company_id <> current_company_id() THEN
    RAISE EXCEPTION 'company_scope_mismatch';
  END IF;

  IF NOT has_company_role(
    p_company_id,
    ARRAY['OWNER'::member_role, 'ADMIN'::member_role, 'MANAGER'::member_role, 'OPERATOR'::member_role]
  ) THEN
    RAISE EXCEPTION 'insufficient_company_role';
  END IF;

  IF p_allocation_method NOT IN ('quantity', 'value', 'equal') THEN
    RAISE EXCEPTION 'invalid_allocation_method';
  END IF;

  SELECT
    po.id,
    po.company_id,
    po.supplier_id,
    COALESCE(NULLIF(trim(po.currency_code), ''), COALESCE(NULLIF(trim(p_currency_code), ''), 'USD')) AS currency_code,
    COALESCE(NULLIF(po.fx_to_base, 0), NULLIF(p_fx_to_base, 0), 1) AS fx_to_base
  INTO v_po
  FROM public.purchase_orders po
  WHERE po.id = p_purchase_order_id
    AND po.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_order_not_found';
  END IF;

  v_fx_to_base := COALESCE(v_po.fx_to_base, 1);
  IF v_fx_to_base <= 0 THEN
    RAISE EXCEPTION 'invalid_fx_to_base';
  END IF;

  FOR v_charge IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_charges, '[]'::jsonb))
  LOOP
    v_charge_amount := round(
      CASE
        WHEN NULLIF(trim(v_charge->>'amount'), '') IS NULL THEN 0
        ELSE (v_charge->>'amount')::numeric
      END,
      6
    );

    IF v_charge_amount = 0 THEN
      CONTINUE;
    END IF;

    v_charge_label := COALESCE(NULLIF(trim(v_charge->>'label'), ''), 'Other cost');
    v_total_extra_cost := round(v_total_extra_cost + v_charge_amount, 6);
    v_total_extra_cost_base := round(v_total_extra_cost_base + round(v_charge_amount * v_fx_to_base, 6), 6);
    v_normalized_charges := v_normalized_charges || jsonb_build_array(
      jsonb_build_object(
        'label', v_charge_label,
        'amount', v_charge_amount,
        'amount_base', round(v_charge_amount * v_fx_to_base, 6)
      )
    );
  END LOOP;

  IF v_total_extra_cost_base <= 0 THEN
    RAISE EXCEPTION 'total_extra_cost_required';
  END IF;

  -- Retain p_lines for API compatibility, but rebuild persisted valuation math from trusted receipt and stock data.
  CREATE TEMP TABLE landed_cost_receipt_buckets (
    bucket_ordinal integer NOT NULL,
    item_id uuid NOT NULL,
    item_label text NULL,
    po_line_id uuid NULL,
    warehouse_id uuid NULL,
    bin_id text NULL,
    stock_level_id uuid NULL,
    received_qty_base numeric NOT NULL,
    receipt_value_base numeric NOT NULL,
    on_hand_qty_base numeric NOT NULL,
    previous_avg_cost numeric NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO landed_cost_receipt_buckets (
    bucket_ordinal,
    item_id,
    item_label,
    po_line_id,
    warehouse_id,
    bin_id,
    stock_level_id,
    received_qty_base,
    receipt_value_base,
    on_hand_qty_base,
    previous_avg_cost
  )
  WITH receipt_buckets AS (
    SELECT
      sm.item_id,
      min(NULLIF(sm.ref_line_id::text, '')) AS po_line_id_text,
      sm.warehouse_to_id AS warehouse_id,
      sm.bin_to_id AS bin_id,
      round(sum(COALESCE(sm.qty_base, 0)), 6) AS received_qty_base,
      round(sum(COALESCE(sm.total_value, 0)), 6) AS receipt_value_base
    FROM public.stock_movements sm
    WHERE sm.company_id = p_company_id
      AND sm.type = 'receive'
      AND sm.ref_type = 'PO'
      AND sm.ref_id = p_purchase_order_id::text
    GROUP BY
      sm.item_id,
      sm.warehouse_to_id,
      sm.bin_to_id
  ),
  bucket_rows AS (
    SELECT
      row_number() OVER (
        ORDER BY
          COALESCE(i.name, rb.item_id::text),
          rb.item_id,
          COALESCE(rb.warehouse_id::text, ''),
          COALESCE(rb.bin_id, '')
      )::integer AS bucket_ordinal,
      rb.item_id,
      trim(
        COALESCE(i.name, rb.item_id::text)
        || CASE
             WHEN NULLIF(i.sku, '') IS NOT NULL THEN ' (' || i.sku || ')'
             ELSE ''
           END
      ) AS item_label,
      CASE
        WHEN rb.po_line_id_text IS NULL THEN NULL
        ELSE rb.po_line_id_text::uuid
      END AS po_line_id,
      rb.warehouse_id,
      rb.bin_id,
      sl.id AS stock_level_id,
      rb.received_qty_base,
      rb.receipt_value_base,
      round(COALESCE(sl.qty, 0), 6) AS on_hand_qty_base,
      round(COALESCE(sl.avg_cost, 0), 6) AS previous_avg_cost
    FROM receipt_buckets rb
    JOIN public.items i
      ON i.id = rb.item_id
     AND i.company_id = p_company_id
    LEFT JOIN public.stock_levels sl
      ON sl.company_id = p_company_id
     AND sl.item_id = rb.item_id
     AND sl.warehouse_id IS NOT DISTINCT FROM rb.warehouse_id
     AND sl.bin_id IS NOT DISTINCT FROM rb.bin_id
    WHERE rb.received_qty_base > 0
  )
  SELECT
    bucket_ordinal,
    item_id,
    item_label,
    po_line_id,
    warehouse_id,
    bin_id,
    stock_level_id,
    received_qty_base,
    receipt_value_base,
    on_hand_qty_base,
    previous_avg_cost
  FROM bucket_rows;

  SELECT
    count(*),
    COALESCE(sum(received_qty_base), 0),
    COALESCE(sum(receipt_value_base), 0)
  INTO
    v_bucket_count,
    v_total_receipt_qty,
    v_total_receipt_value
  FROM landed_cost_receipt_buckets;

  IF v_bucket_count = 0 THEN
    RAISE EXCEPTION 'no_receipts_found_for_purchase_order';
  END IF;

  INSERT INTO public.landed_cost_runs (
    company_id,
    purchase_order_id,
    supplier_id,
    applied_by,
    currency_code,
    fx_to_base,
    allocation_method,
    total_extra_cost,
    total_applied_value,
    total_unapplied_value,
    notes,
    charges
  ) VALUES (
    p_company_id,
    p_purchase_order_id,
    v_po.supplier_id,
    COALESCE(auth.uid(), p_applied_by),
    upper(v_po.currency_code),
    v_fx_to_base,
    p_allocation_method,
    v_total_extra_cost,
    0,
    0,
    NULLIF(trim(p_notes), ''),
    v_normalized_charges
  )
  RETURNING id INTO v_run_id;

  FOR v_bucket IN
    SELECT *
    FROM landed_cost_receipt_buckets
    ORDER BY bucket_ordinal
  LOOP
    v_allocated_extra := CASE
      WHEN v_bucket.bucket_ordinal = v_bucket_count THEN
        round(v_total_extra_cost_base - v_allocated_so_far, 6)
      WHEN p_allocation_method = 'quantity' THEN
        round(
          v_total_extra_cost_base
          * CASE
              WHEN v_total_receipt_qty > 0 THEN v_bucket.received_qty_base / v_total_receipt_qty
              ELSE 0
            END,
          6
        )
      WHEN p_allocation_method = 'value' THEN
        round(
          v_total_extra_cost_base
          * CASE
              WHEN v_total_receipt_value > 0 THEN v_bucket.receipt_value_base / v_total_receipt_value
              ELSE 0
            END,
          6
        )
      ELSE
        round(v_total_extra_cost_base / v_bucket_count, 6)
    END;

    v_allocated_so_far := round(v_allocated_so_far + v_allocated_extra, 6);
    v_delta_per_received_unit := CASE
      WHEN v_bucket.received_qty_base > 0 THEN round(v_allocated_extra / v_bucket.received_qty_base, 6)
      ELSE 0
    END;
    v_impacted_qty := round(GREATEST(0, LEAST(v_bucket.on_hand_qty_base, v_bucket.received_qty_base)), 6);
    v_applied := round(v_delta_per_received_unit * v_impacted_qty, 6);
    v_unapplied := round(GREATEST(0, v_allocated_extra - v_applied), 6);
    v_new_avg_cost := CASE
      WHEN v_bucket.on_hand_qty_base > 0 THEN
        round(v_bucket.previous_avg_cost + (v_applied / v_bucket.on_hand_qty_base), 6)
      ELSE
        round(v_bucket.previous_avg_cost, 6)
    END;
    v_stock_movement_id := NULL;

    IF v_bucket.stock_level_id IS NOT NULL AND v_applied <> 0 THEN
      UPDATE public.stock_levels
      SET
        avg_cost = v_new_avg_cost,
        updated_at = v_now
      WHERE id = v_bucket.stock_level_id
        AND company_id = p_company_id
        AND item_id = v_bucket.item_id
        AND warehouse_id IS NOT DISTINCT FROM v_bucket.warehouse_id
        AND bin_id IS NOT DISTINCT FROM v_bucket.bin_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'stock_level_scope_mismatch';
      END IF;

      INSERT INTO public.stock_movements (
        company_id,
        type,
        item_id,
        qty,
        qty_base,
        unit_cost,
        total_value,
        warehouse_to_id,
        bin_to_id,
        notes,
        created_by,
        ref_type,
        ref_id,
        ref_line_id
      ) VALUES (
        p_company_id,
        'adjust',
        v_bucket.item_id,
        0,
        0,
        v_new_avg_cost,
        v_applied,
        v_bucket.warehouse_id,
        v_bucket.bin_id,
        COALESCE(NULLIF(trim(p_notes), ''), 'Landed cost revaluation'),
        COALESCE(auth.uid()::text, COALESCE(p_applied_by::text, 'landed_cost')),
        'PO',
        p_purchase_order_id::text,
        CASE
          WHEN v_bucket.po_line_id IS NULL THEN NULL
          ELSE v_bucket.po_line_id
        END
      )
      RETURNING id INTO v_stock_movement_id;
    END IF;

    INSERT INTO public.landed_cost_run_lines (
      run_id,
      company_id,
      purchase_order_id,
      po_line_id,
      item_id,
      item_label,
      warehouse_id,
      bin_id,
      stock_level_id,
      stock_movement_id,
      received_qty_base,
      impacted_qty_base,
      on_hand_qty_base,
      allocated_extra,
      applied_revaluation,
      unapplied_value,
      previous_avg_cost,
      new_avg_cost
    ) VALUES (
      v_run_id,
      p_company_id,
      p_purchase_order_id,
      v_bucket.po_line_id,
      v_bucket.item_id,
      NULLIF(v_bucket.item_label, ''),
      v_bucket.warehouse_id,
      v_bucket.bin_id,
      v_bucket.stock_level_id,
      v_stock_movement_id,
      v_bucket.received_qty_base,
      v_impacted_qty,
      v_bucket.on_hand_qty_base,
      v_allocated_extra,
      v_applied,
      v_unapplied,
      v_bucket.previous_avg_cost,
      v_new_avg_cost
    );

    v_line_count := v_line_count + 1;
    v_total_applied := round(v_total_applied + v_applied, 6);
    v_total_unapplied := round(v_total_unapplied + v_unapplied, 6);
  END LOOP;

  UPDATE public.landed_cost_runs
  SET
    total_applied_value = v_total_applied,
    total_unapplied_value = v_total_unapplied
  WHERE id = v_run_id;

  RETURN QUERY
  SELECT v_run_id, v_line_count, v_total_applied, v_total_unapplied;
END;
$$;


ALTER FUNCTION "public"."apply_landed_cost_run"("p_company_id" "uuid", "p_purchase_order_id" "uuid", "p_supplier_id" "uuid", "p_applied_by" "uuid", "p_currency_code" "text", "p_fx_to_base" numeric, "p_allocation_method" "text", "p_total_extra_cost" numeric, "p_notes" "text", "p_charges" "jsonb", "p_lines" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_stock_delta"("p_wh_id" "uuid", "p_bin_id" "text", "p_item_id" "uuid", "p_delta" numeric, "p_unit_cost" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row stock_levels%ROWTYPE;
  v_qty numeric;
  v_avg numeric;
BEGIN
  IF COALESCE(p_delta,0) = 0 THEN
    RETURN;
  END IF;

  -- Validate bin belongs to warehouse (when bin_id is not null)
  IF p_bin_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM bins b
      WHERE b.id = p_bin_id
        AND b."warehouseId" = p_wh_id
    ) THEN
      RAISE EXCEPTION 'Bin % does not belong to warehouse %', p_bin_id, p_wh_id;
    END IF;
  END IF;

  -- Fetch existing stock_levels row
  IF p_bin_id IS NULL THEN
    SELECT * INTO v_row
    FROM stock_levels
    WHERE warehouse_id = p_wh_id
      AND item_id = p_item_id
      AND bin_id IS NULL
    LIMIT 1;
  ELSE
    SELECT * INTO v_row
    FROM stock_levels
    WHERE warehouse_id = p_wh_id
      AND item_id = p_item_id
      AND bin_id = p_bin_id
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    IF p_delta < 0 THEN
      RAISE EXCEPTION 'Insufficient stock (no row) item %, wh %, bin %', p_item_id, p_wh_id, p_bin_id;
    END IF;
    INSERT INTO stock_levels (warehouse_id, bin_id, item_id, qty, allocated_qty, avg_cost, updated_at)
    VALUES (p_wh_id, p_bin_id, p_item_id, p_delta, 0, COALESCE(NULLIF(p_unit_cost,0),0), now());
    RETURN;
  END IF;

  v_qty := COALESCE(v_row.qty,0) + p_delta;
  IF v_qty < 0 THEN
    RAISE EXCEPTION 'Insufficient stock (would go negative) item %, wh %, bin %', p_item_id, p_wh_id, p_bin_id;
  END IF;

  v_avg := COALESCE(v_row.avg_cost,0);
  IF p_delta > 0 THEN
    v_avg := CASE WHEN v_qty > 0
      THEN ((COALESCE(v_row.qty,0) * COALESCE(v_row.avg_cost,0)) + (p_delta * COALESCE(p_unit_cost,0))) / v_qty
      ELSE COALESCE(p_unit_cost,0)
    END;
  END IF;

  UPDATE stock_levels
     SET qty = v_qty,
         avg_cost = v_avg,
         updated_at = now()
   WHERE id = v_row.id;
END;
$$;


ALTER FUNCTION "public"."apply_stock_delta"("p_wh_id" "uuid", "p_bin_id" "text", "p_item_id" "uuid", "p_delta" numeric, "p_unit_cost" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_stock_levels_from_movement"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  -- OUT of FROM bin
  if new.warehouse_from_id is not null and new.bin_from_id is not null then
    insert into public.stock_levels (id,item_id,warehouse_id,bin_id,qty,avg_cost,company_id,updated_at)
    values (gen_random_uuid(), new.item_id, new.warehouse_from_id, new.bin_from_id, 0 - new.qty_base, 0, new.company_id, now())
    on conflict (item_id, warehouse_id, bin_id) do update
      set qty       = public.stock_levels.qty + excluded.qty,
          updated_at= now();
  end if;

  -- INTO TO bin
  if new.warehouse_to_id is not null and new.bin_to_id is not null then
    insert into public.stock_levels (id,item_id,warehouse_id,bin_id,qty,avg_cost,company_id,updated_at)
    values (gen_random_uuid(), new.item_id, new.warehouse_to_id, new.bin_to_id, new.qty_base, coalesce(new.unit_cost,0), new.company_id, now())
    on conflict (item_id, warehouse_id, bin_id) do update
      set qty      = public.stock_levels.qty + excluded.qty,
          avg_cost = case
                       when excluded.qty > 0
                       then ((public.stock_levels.avg_cost * greatest(public.stock_levels.qty,0))
                             + (coalesce(new.unit_cost,0) * excluded.qty))
                            / nullif(greatest(public.stock_levels.qty,0) + excluded.qty, 0)
                       else public.stock_levels.avg_cost
                     end,
          updated_at = now();
  end if;

  return new;
end
$$;


ALTER FUNCTION "public"."apply_stock_levels_from_movement"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."sales_invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "sales_order_id" "uuid",
    "customer_id" "uuid",
    "internal_reference" "text" NOT NULL,
    "invoice_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date" NOT NULL,
    "currency_code" "text" DEFAULT 'MZN'::"text" NOT NULL,
    "fx_to_base" numeric DEFAULT 1 NOT NULL,
    "subtotal" numeric DEFAULT 0 NOT NULL,
    "tax_total" numeric DEFAULT 0 NOT NULL,
    "total_amount" numeric DEFAULT 0 NOT NULL,
    "document_workflow_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "issued_at" timestamp with time zone,
    "issued_by" "uuid",
    "voided_at" timestamp with time zone,
    "voided_by" "uuid",
    "void_reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_origin" "text" DEFAULT 'native'::"text" NOT NULL,
    "moz_document_code" "text" DEFAULT 'INV'::"text" NOT NULL,
    "fiscal_series_code" "text",
    "fiscal_year" integer,
    "fiscal_sequence_number" integer,
    "seller_legal_name_snapshot" "text",
    "seller_trade_name_snapshot" "text",
    "seller_nuit_snapshot" "text",
    "seller_address_line1_snapshot" "text",
    "seller_address_line2_snapshot" "text",
    "seller_city_snapshot" "text",
    "seller_state_snapshot" "text",
    "seller_postal_code_snapshot" "text",
    "seller_country_code_snapshot" "text",
    "buyer_legal_name_snapshot" "text",
    "buyer_nuit_snapshot" "text",
    "buyer_address_line1_snapshot" "text",
    "buyer_address_line2_snapshot" "text",
    "buyer_city_snapshot" "text",
    "buyer_state_snapshot" "text",
    "buyer_postal_code_snapshot" "text",
    "buyer_country_code_snapshot" "text",
    "document_language_code_snapshot" "text",
    "computer_processed_phrase_snapshot" "text",
    "subtotal_mzn" numeric DEFAULT 0 NOT NULL,
    "tax_total_mzn" numeric DEFAULT 0 NOT NULL,
    "total_amount_mzn" numeric DEFAULT 0 NOT NULL,
    "compliance_rule_version_snapshot" "text",
    "vat_exemption_reason_text" "text",
    "approval_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "approval_requested_at" timestamp with time zone,
    "approval_requested_by" "uuid",
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    CONSTRAINT "sales_invoices_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['draft'::"text", 'pending_approval'::"text", 'approved'::"text"]))),
    CONSTRAINT "sales_invoices_document_workflow_status_check" CHECK (("document_workflow_status" = ANY (ARRAY['draft'::"text", 'issued'::"text", 'voided'::"text"]))),
    CONSTRAINT "sales_invoices_fiscal_sequence_number_check" CHECK ((("fiscal_sequence_number" IS NULL) OR ("fiscal_sequence_number" >= 1))),
    CONSTRAINT "sales_invoices_fiscal_year_check" CHECK ((("fiscal_year" IS NULL) OR (("fiscal_year" >= 2000) AND ("fiscal_year" <= 9999)))),
    CONSTRAINT "sales_invoices_fx_to_base_check" CHECK (("fx_to_base" > (0)::numeric)),
    CONSTRAINT "sales_invoices_internal_reference_format" CHECK (((("source_origin" = 'native'::"text") AND ("internal_reference" ~ '^[A-Z0-9]{3}-[A-Z0-9]{2,10}[0-9]{4}-[0-9]{5}$'::"text")) OR (("source_origin" = 'imported'::"text") AND (NULLIF("btrim"(COALESCE("internal_reference", ''::"text")), ''::"text") IS NOT NULL)))),
    CONSTRAINT "sales_invoices_moz_document_code_check" CHECK (("moz_document_code" = 'INV'::"text")),
    CONSTRAINT "sales_invoices_mzn_totals_nonnegative" CHECK ((("subtotal_mzn" >= (0)::numeric) AND ("tax_total_mzn" >= (0)::numeric) AND ("total_amount_mzn" >= (0)::numeric))),
    CONSTRAINT "sales_invoices_source_origin_check" CHECK (("source_origin" = ANY (ARRAY['native'::"text", 'imported'::"text"]))),
    CONSTRAINT "sales_invoices_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "sales_invoices_tax_total_check" CHECK (("tax_total" >= (0)::numeric)),
    CONSTRAINT "sales_invoices_total_amount_check" CHECK (("total_amount" >= (0)::numeric))
);


ALTER TABLE "public"."sales_invoices" OWNER TO "postgres";


COMMENT ON TABLE "public"."sales_invoices" IS 'Step 2 finance-document foundation. Sales invoices use Stockwise-generated internal references as the primary outbound AR document identity.';



COMMENT ON COLUMN "public"."sales_invoices"."internal_reference" IS 'Visible legal fiscal reference for Mozambique sales invoices. Internal joins and workflow logic must continue to use stable ids and fiscal metadata fields, not the text shape.';



COMMENT ON COLUMN "public"."sales_invoices"."vat_exemption_reason_text" IS 'Manual Mozambique VAT exemption reason captured before invoice issue when exempt lines exist.';



CREATE OR REPLACE FUNCTION "public"."approve_sales_invoice_mz"("p_invoice_id" "uuid") RETURNS "public"."sales_invoices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row public.sales_invoices%rowtype;
begin
  select si.*
    into v_row
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_row.id is null then
    raise exception 'sales_invoice_not_found';
  end if;

  if not public.finance_documents_can_approve(v_row.company_id) then
    raise exception using
      message = 'Sales invoice approval access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft sales invoices can be approved.';
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'pending_approval' then
    raise exception using
      message = 'Sales invoices must be pending approval before they can be approved.';
  end if;

  update public.sales_invoices si
     set approval_status = 'approved',
         approval_requested_at = coalesce(si.approval_requested_at, now()),
         approval_requested_by = coalesce(si.approval_requested_by, auth.uid()),
         approved_at = now(),
         approved_by = auth.uid()
   where si.id = p_invoice_id
  returning si.* into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."approve_sales_invoice_mz"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_supplier_invoice_reference"("p_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select nullif(upper(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g')), '');
$$;


ALTER FUNCTION "public"."normalize_supplier_invoice_reference"("p_value" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_bills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "purchase_order_id" "uuid",
    "supplier_id" "uuid",
    "internal_reference" "text" NOT NULL,
    "supplier_invoice_reference" "text",
    "supplier_invoice_reference_normalized" "text" GENERATED ALWAYS AS ("public"."normalize_supplier_invoice_reference"("supplier_invoice_reference")) STORED,
    "supplier_invoice_date" "date",
    "bill_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date" NOT NULL,
    "currency_code" "text" DEFAULT 'MZN'::"text" NOT NULL,
    "fx_to_base" numeric DEFAULT 1 NOT NULL,
    "subtotal" numeric DEFAULT 0 NOT NULL,
    "tax_total" numeric DEFAULT 0 NOT NULL,
    "total_amount" numeric DEFAULT 0 NOT NULL,
    "document_workflow_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "posted_at" timestamp with time zone,
    "posted_by" "uuid",
    "voided_at" timestamp with time zone,
    "voided_by" "uuid",
    "void_reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approval_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "approval_requested_at" timestamp with time zone,
    "approval_requested_by" "uuid",
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    CONSTRAINT "vendor_bills_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['draft'::"text", 'pending_approval'::"text", 'approved'::"text"]))),
    CONSTRAINT "vendor_bills_document_workflow_status_check" CHECK (("document_workflow_status" = ANY (ARRAY['draft'::"text", 'posted'::"text", 'voided'::"text"]))),
    CONSTRAINT "vendor_bills_fx_to_base_check" CHECK (("fx_to_base" > (0)::numeric)),
    CONSTRAINT "vendor_bills_internal_reference_format" CHECK (("internal_reference" ~ '^[A-Z0-9]{3}-VB[0-9]{5}$'::"text")),
    CONSTRAINT "vendor_bills_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "vendor_bills_tax_total_check" CHECK (("tax_total" >= (0)::numeric)),
    CONSTRAINT "vendor_bills_total_amount_check" CHECK (("total_amount" >= (0)::numeric))
);


ALTER TABLE "public"."vendor_bills" OWNER TO "postgres";


COMMENT ON TABLE "public"."vendor_bills" IS 'Step 2 finance-document foundation. Vendor bills keep a Stockwise internal reference plus the supplier invoice reference as separate documentary identity.';



COMMENT ON COLUMN "public"."vendor_bills"."internal_reference" IS 'System-generated internal business reference in the format PREFIX-VB00001.';



COMMENT ON COLUMN "public"."vendor_bills"."supplier_invoice_reference" IS 'Supplier-provided invoice reference preserved exactly as received.';



COMMENT ON COLUMN "public"."vendor_bills"."supplier_invoice_reference_normalized" IS 'Trimmed and uppercased helper used for duplicate detection without changing the raw supplier reference.';



COMMENT ON COLUMN "public"."vendor_bills"."supplier_invoice_date" IS 'Supplier-provided invoice date preserved for documentary fidelity.';



CREATE OR REPLACE FUNCTION "public"."approve_vendor_bill_mz"("p_bill_id" "uuid") RETURNS "public"."vendor_bills"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row public.vendor_bills%rowtype;
begin
  select vb.*
    into v_row
  from public.vendor_bills vb
  where vb.id = p_bill_id;

  if v_row.id is null then
    raise exception using
      message = 'Vendor bill not found.';
  end if;

  if not public.finance_documents_can_approve(v_row.company_id) then
    raise exception using
      message = 'Vendor bill approval access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft vendor bills can be approved.';
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'pending_approval' then
    raise exception using
      message = 'Vendor bills must be pending approval before they can be approved.';
  end if;

  update public.vendor_bills vb
     set approval_status = 'approved',
         approval_requested_at = coalesce(vb.approval_requested_at, now()),
         approval_requested_by = coalesce(vb.approval_requested_by, auth.uid()),
         approved_at = now(),
         approved_by = auth.uid()
   where vb.id = p_bill_id
  returning vb.* into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."approve_vendor_bill_mz"("p_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_company_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select cm.company_id
  from public.company_members cm
  where (
      (cm.user_id is not null and cm.user_id = auth.uid())
      or (
        cm.user_id is null
        and cm.email is not null
        and exists (
          select 1
          from auth.users u
          where u.id = auth.uid()
            and lower(u.email) = lower(cm.email)
        )
      )
    )
    and cm.status = 'active'::member_status;
$$;


ALTER FUNCTION "public"."auth_company_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bank_account_balances"("p_company" "uuid") RETURNS TABLE("bank_id" "uuid", "balance_base" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company is distinct from public.current_company_id()
       or not public.is_company_member(auth.uid(), p_company, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::text[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  select ba.id as bank_id, coalesce(sum(t.amount_base), 0) as balance_base
  from public.bank_accounts ba
  left join public.bank_transactions t
    on t.bank_id = ba.id
  where ba.company_id = p_company
  group by ba.id
  order by ba.id;
end
$$;


ALTER FUNCTION "public"."bank_account_balances"("p_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bank_book_balance"("p_bank" "uuid") RETURNS numeric
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select coalesce(sum(t.amount_base),0)
  from public.bank_transactions t
  where t.bank_id = p_bank;
$$;


ALTER FUNCTION "public"."bank_book_balance"("p_bank" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."block_delete_last_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
declare
  owner_count int;
begin
  select count(*) into owner_count
  from public.company_members
  where company_id = old.company_id
    and role = 'OWNER'
    and email <> old.email; -- count other owners

  if old.role = 'OWNER' and owner_count = 0 then
    raise exception 'Cannot remove the last OWNER of this company';
  end if;

  return old;
end$$;


ALTER FUNCTION "public"."block_delete_last_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bootstrap_owner"("p_company_id" "uuid") RETURNS TABLE("company_id" "uuid", "company_name" "text", "role" "text", "status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid   uuid;
  v_email text;
  v_cnt   int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select u.email into v_email
  from auth.users u
  where u.id = v_uid;

  -- Only allowed if the company has NO members at all
  select count(*) into v_cnt
  from company_members
  where company_id = p_company_id;

  if v_cnt > 0 then
    raise exception 'company already has members';
  end if;

  insert into company_members (company_id, email, user_id, role, status)
  values (p_company_id, v_email, v_uid, 'OWNER', 'active');

  return query
  select c.id, c.name, 'OWNER', 'active'
  from companies c
  where c.id = p_company_id;
end;
$$;


ALTER FUNCTION "public"."bootstrap_owner"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."build_daily_digest_payload"("p_company_id" "uuid", "p_local_day" "date", "p_timezone" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_utc timestamptz;
  v_end_utc   timestamptz;
  v_rev       numeric := 0;
  v_cogs      numeric := 0;
  v_gp        numeric := 0;
  v_gm_pct    numeric := 0;

  v_result    jsonb;
BEGIN
  -- local day window → UTC
  v_start_utc := (timezone('UTC', timezone(p_timezone, p_local_day::timestamp)));
  v_end_utc   := v_start_utc + interval '1 day';

  -- Revenue from revenue_events (view): already base currency
  SELECT COALESCE(SUM(re.revenue_base_amount), 0)
    INTO v_rev
  FROM public.revenue_events re
  WHERE re.company_id = p_company_id
    AND re.created_at >= v_start_utc
    AND re.created_at <  v_end_utc;

  -- COGS = sales issues − SO reversals
  WITH
  sales_issues AS (
    SELECT sm.item_id,
           COALESCE(sm.total_value, sm.unit_cost * sm.qty_base) AS val
    FROM public.stock_movements sm
    WHERE sm.company_id = p_company_id
      AND sm.created_at >= v_start_utc
      AND sm.created_at <  v_end_utc
      AND sm.type = 'issue'
      AND sm.ref_type IN ('SO','CASH_SALE','POS','CASH')
  ),
  so_reversals AS (
    SELECT sm.item_id,
           COALESCE(sm.total_value, sm.unit_cost * sm.qty_base) AS val
    FROM public.stock_movements sm
    WHERE sm.company_id = p_company_id
      AND sm.created_at >= v_start_utc
      AND sm.created_at <  v_end_utc
      AND sm.type = 'receive'
      AND sm.ref_type = 'SO_REVERSAL'
  )
  SELECT COALESCE((SELECT SUM(val) FROM sales_issues), 0)
       - COALESCE((SELECT SUM(val) FROM so_reversals), 0)
    INTO v_cogs;

  v_gp     := v_rev - v_cogs;
  v_gm_pct := CASE WHEN v_rev <> 0 THEN ROUND((v_gp / v_rev) * 100, 2) ELSE 0 END;

  -- By-product rows (NOTE: ORDER BY is inside jsonb_agg)
  WITH
  rev_by_item AS (
    SELECT re.item_id,
           COALESCE(SUM(re.qty_base), 0)            AS qty,
           COALESCE(SUM(re.revenue_base_amount), 0) AS revenue
    FROM public.revenue_events re
    WHERE re.company_id = p_company_id
      AND re.created_at >= v_start_utc
      AND re.created_at <  v_end_utc
    GROUP BY re.item_id
  ),
  cogs_issue_by_item AS (
    SELECT sm.item_id,
           COALESCE(SUM(COALESCE(sm.total_value, sm.unit_cost * sm.qty_base)), 0) AS cogs_issue
    FROM public.stock_movements sm
    WHERE sm.company_id = p_company_id
      AND sm.created_at >= v_start_utc
      AND sm.created_at <  v_end_utc
      AND sm.type = 'issue'
      AND sm.ref_type IN ('SO','CASH_SALE','POS','CASH')
    GROUP BY sm.item_id
  ),
  cogs_rev_by_item AS (
    SELECT sm.item_id,
           COALESCE(SUM(COALESCE(sm.total_value, sm.unit_cost * sm.qty_base)), 0) AS cogs_rev
    FROM public.stock_movements sm
    WHERE sm.company_id = p_company_id
      AND sm.created_at >= v_start_utc
      AND sm.created_at <  v_end_utc
      AND sm.type = 'receive'
      AND sm.ref_type = 'SO_REVERSAL'
    GROUP BY sm.item_id
  ),
  cogs_by_item AS (
    SELECT COALESCE(i.item_id, r.item_id) AS item_id,
           COALESCE(i.cogs_issue, 0) - COALESCE(r.cogs_rev, 0) AS cogs
    FROM cogs_issue_by_item i
    FULL OUTER JOIN cogs_rev_by_item r ON r.item_id = i.item_id
  ),
  merged AS (
    SELECT rb.item_id, rb.qty, rb.revenue, COALESCE(cb.cogs, 0) AS cogs
    FROM rev_by_item rb
    LEFT JOIN cogs_by_item cb ON cb.item_id = rb.item_id
  ),
  enriched AS (
    SELECT m.item_id, m.qty, m.revenue, m.cogs,
           (m.revenue - m.cogs) AS gp,
           CASE WHEN m.revenue <> 0 THEN ROUND(((m.revenue - m.cogs)/m.revenue)*100, 2) ELSE 0 END AS gm_pct,
           i.name AS item_name, i.sku AS item_sku
    FROM merged m
    LEFT JOIN public.items i ON i.id = m.item_id
  )
  SELECT COALESCE(
           JSONB_AGG(
             JSONB_BUILD_OBJECT(
               'item_id',          e.item_id,
               'item_name',        COALESCE(e.item_name, e.item_id::text),
               'item_sku',         e.item_sku,
               'item_label',       CASE WHEN e.item_name IS NOT NULL AND e.item_sku IS NOT NULL
                                        THEN e.item_name || ' (' || e.item_sku || ')' ELSE NULL END,
               'qty',              COALESCE(e.qty, 0),
               'revenue',          COALESCE(e.revenue, 0),
               'cogs',             COALESCE(e.cogs, 0),
               'gross_profit',     COALESCE(e.gp, 0),
               'gross_margin_pct', COALESCE(e.gm_pct, 0)
             )
             ORDER BY e.gp DESC NULLS LAST
           ),
           '[]'::jsonb
         )
    INTO v_result
  FROM enriched e;

  RETURN JSONB_BUILD_OBJECT(
    'window', JSONB_BUILD_OBJECT(
      'local_day',  TO_CHAR(p_local_day, 'YYYY-MM-DD'),
      'timezone',   p_timezone,
      'start_utc',  TO_CHAR(v_start_utc, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      'end_utc',    TO_CHAR((v_end_utc - INTERVAL '1 second'), 'YYYY-MM-DD"T"HH24:MI:SSOF')
    ),
    'totals', JSONB_BUILD_OBJECT(
      'revenue',          COALESCE(v_rev, 0),
      'cogs',             COALESCE(v_cogs, 0),
      'gross_profit',     COALESCE(v_gp, 0),
      'gross_margin_pct', COALESCE(v_gm_pct, 0)
    ),
    'by_product', v_result
  );
END
$$;


ALTER FUNCTION "public"."build_daily_digest_payload"("p_company_id" "uuid", "p_local_day" "date", "p_timezone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."build_due_reminder_batch"("p_company_id" "uuid", "p_local_day" "date", "p_timezone" "text", "p_lead_days" integer[] DEFAULT ARRAY[3, 1, 0, '-3'::integer]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_start_utc timestamptz;
  v_end_utc timestamptz;
  v_rows jsonb;
BEGIN
  v_start_utc := timezone('UTC', timezone(p_timezone, p_local_day::timestamp));
  v_end_utc := v_start_utc + interval '1 day';

  WITH cfg AS (
    SELECT unnest(p_lead_days) AS d
  ),
  order_candidates AS (
    SELECT
      'sales_order'::text AS anchor_kind,
      so.id AS anchor_id,
      COALESCE(NULLIF(so.order_no, ''), NULLIF(so.code, ''), so.id::text) AS document_reference,
      so.id AS sales_order_id,
      COALESCE(NULLIF(so.order_no, ''), NULLIF(so.code, ''), so.id::text) AS sales_order_reference,
      NULL::uuid AS sales_invoice_id,
      NULL::text AS sales_invoice_reference,
      sos.due_date AS due_date,
      sos.legacy_outstanding_base::numeric AS amount,
      COALESCE(NULLIF(so.bill_to_email, ''), NULLIF(c.email, '')) AS email,
      COALESCE(NULLIF(c.name, ''), NULLIF(sos.counterparty_name, ''), NULLIF(so.customer, '')) AS customer_name,
      (sos.due_date - p_local_day) AS days_until_due,
      sos.currency_code,
      sos.settlement_status,
      NULL::text AS resolution_status,
      NULL::text AS language_hint
    FROM public.v_sales_order_state sos
    JOIN public.sales_orders so
      ON so.id = sos.id
    LEFT JOIN public.customers c
      ON c.id = so.customer_id
    WHERE sos.company_id = p_company_id
      AND sos.workflow_status = 'approved'
      AND sos.financial_anchor = 'legacy_order_link'
      AND sos.due_date IS NOT NULL
      AND sos.legacy_outstanding_base > 0.005
  ),
  invoice_candidates AS (
    SELECT
      'sales_invoice'::text AS anchor_kind,
      si.id AS anchor_id,
      COALESCE(NULLIF(si.internal_reference, ''), si.id::text) AS document_reference,
      si.sales_order_id AS sales_order_id,
      COALESCE(NULLIF(so.order_no, ''), NULLIF(so.code, ''), so.id::text) AS sales_order_reference,
      si.id AS sales_invoice_id,
      COALESCE(NULLIF(si.internal_reference, ''), si.id::text) AS sales_invoice_reference,
      vis.due_date AS due_date,
      vis.outstanding_base::numeric AS amount,
      COALESCE(NULLIF(so.bill_to_email, ''), NULLIF(c.email, '')) AS email,
      COALESCE(NULLIF(si.buyer_legal_name_snapshot, ''), NULLIF(vis.counterparty_name, ''), NULLIF(c.name, '')) AS customer_name,
      (vis.due_date - p_local_day) AS days_until_due,
      vis.currency_code,
      vis.settlement_status,
      vis.resolution_status,
      CASE
        WHEN lower(COALESCE(si.document_language_code_snapshot, '')) LIKE 'pt%' THEN 'pt'
        WHEN lower(COALESCE(si.document_language_code_snapshot, '')) LIKE 'en%' THEN 'en'
        ELSE NULL
      END::text AS language_hint
    FROM public.v_sales_invoice_state vis
    JOIN public.sales_invoices si
      ON si.id = vis.id
    LEFT JOIN public.sales_orders so
      ON so.id = si.sales_order_id
    LEFT JOIN public.customers c
      ON c.id = si.customer_id
    WHERE vis.company_id = p_company_id
      AND si.document_workflow_status = 'issued'
      AND vis.due_date IS NOT NULL
      AND vis.outstanding_base > 0.005
  ),
  filtered AS (
    SELECT candidate.*
    FROM (
      SELECT * FROM order_candidates
      UNION ALL
      SELECT * FROM invoice_candidates
    ) candidate
    JOIN cfg
      ON cfg.d = candidate.days_until_due
  )
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'anchor_kind', anchor_kind,
               'anchor_id', anchor_id,
               'document_reference', document_reference,
               'due_date', to_char(due_date, 'YYYY-MM-DD'),
               'amount', amount,
               'email', email,
               'customer_name', customer_name,
               'days_until_due', days_until_due,
               'currency_code', currency_code,
               'settlement_status', settlement_status,
               'resolution_status', resolution_status,
               'sales_order_id', sales_order_id,
               'sales_order_reference', sales_order_reference,
               'sales_invoice_id', sales_invoice_id,
               'sales_invoice_reference', sales_invoice_reference,
               'language_hint', language_hint
             )
             ORDER BY days_until_due, due_date, document_reference
           ),
           '[]'::jsonb
         )
    INTO v_rows
  FROM filtered;

  RETURN jsonb_build_object(
    'window', jsonb_build_object(
      'local_day', to_char(p_local_day, 'YYYY-MM-DD'),
      'timezone', p_timezone,
      'start_utc', to_char(v_start_utc, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      'end_utc', to_char((v_end_utc - interval '1 second'), 'YYYY-MM-DD"T"HH24:MI:SSOF')
    ),
    'reminders', v_rows
  );
END
$$;


ALTER FUNCTION "public"."build_due_reminder_batch"("p_company_id" "uuid", "p_local_day" "date", "p_timezone" "text", "p_lead_days" integer[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."build_from_bom"("p_bom_id" "uuid", "p_qty" numeric, "p_warehouse_from" "uuid", "p_bin_from" "text", "p_warehouse_to" "uuid", "p_bin_to" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_company_id   uuid;
  v_product_id   uuid;
  v_build_id     uuid := gen_random_uuid();

  v_total_cost   numeric := 0;
  v_need         numeric;
  v_unit_cost    numeric;
  r              record;
begin
  -- 1) Load BOM
  select b.company_id, b.product_id
    into v_company_id, v_product_id
  from public.boms b
  where b.id = p_bom_id
    and b.is_active = true;

  if v_company_id is null or v_company_id <> current_company_id() then
    raise exception 'BOM not found or inactive';
  end if;

  -- 2) Membership (by uid or email)
  if not public.is_member_by_jwt(v_company_id) then
    raise exception 'forbidden';
  end if;

  -- 3) Validate warehouses/bins (bins."warehouseId" is camelCase in your table)
  if not exists (select 1 from public.warehouses w where w.id = p_warehouse_from and w.company_id = v_company_id) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.bins b where b.id = p_bin_from and b."warehouseId" = p_warehouse_from) then
    raise exception 'forbidden';
  end if;

  if not exists (select 1 from public.warehouses w where w.id = p_warehouse_to and w.company_id = v_company_id) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.bins b where b.id = p_bin_to and b."warehouseId" = p_warehouse_to) then
    raise exception 'forbidden';
  end if;

  -- 4) Consume components
  for r in
    select c.component_item_id, c.qty_per, coalesce(c.scrap_pct,0) as scrap
    from public.bom_components c
    where c.bom_id = p_bom_id
  loop
    v_need := r.qty_per * p_qty * (1 + r.scrap);

    -- pull a cost (fallback 0). Adjust if you price elsewhere.
    select sl.avg_cost
      into v_unit_cost
    from public.stock_levels sl
    where sl.item_id = r.component_item_id
      and sl.company_id = v_company_id
      and (sl.warehouse_id is null or sl.warehouse_id = p_warehouse_from)
      and (sl.bin_id       is null or sl.bin_id       = p_bin_from)
    order by (sl.warehouse_id is null) desc, (sl.bin_id is null) desc
    limit 1;

    v_unit_cost := coalesce(v_unit_cost, 0);
    v_total_cost := v_total_cost + (v_need * v_unit_cost);

    insert into public.stock_movements(
      type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
      warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id,
      notes, ref_type, company_id, created_by
    ) values (
      'issue', r.component_item_id, null,
      v_need, v_need, v_unit_cost, v_need * v_unit_cost,
      p_warehouse_from, p_bin_from, null, null,
      'Production consumption', 'BUILD', v_company_id, auth.uid()
    );
  end loop;

  -- 5) Receive finished good
  insert into public.stock_movements(
    type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id,
    notes, ref_type, company_id, created_by
  ) values (
    'receive', v_product_id, null,
    p_qty, p_qty,
    case when p_qty > 0 then v_total_cost / p_qty else 0 end,
    v_total_cost,
    null, null, p_warehouse_to, p_bin_to,
    'Production output', 'BUILD', v_company_id, auth.uid()
  );

  -- 6) Build header
  insert into public.builds(
    id, company_id, bom_id, product_id, qty,
    warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id,
    cost_total, created_by
  ) values (
    v_build_id, v_company_id, p_bom_id, v_product_id, p_qty,
    p_warehouse_from, p_bin_from, p_warehouse_to, p_bin_to,
    v_total_cost, auth.uid()
  );

  return v_build_id;
end
$$;


ALTER FUNCTION "public"."build_from_bom"("p_bom_id" "uuid", "p_qty" numeric, "p_warehouse_from" "uuid", "p_bin_from" "text", "p_warehouse_to" "uuid", "p_bin_to" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."build_from_bom_sources"("p_bom_id" "uuid", "p_qty" numeric, "p_component_sources" "jsonb", "p_output_splits" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  _prod_id          uuid;
  _comp record;
  _need_qty         numeric;
  _need_qty_after_scrap numeric;

  _src         jsonb;
  _src_wh      uuid;
  _src_bin     text;
  _src_share   numeric;
  _srcs        jsonb;
  _sum_share   numeric;

  _out         jsonb;
  _out_wh      uuid;
  _out_bin     text;
  _out_qty     numeric;

  _total_cost  numeric := 0;
  _total_qty   numeric := 0;
  _unit_cost_fg numeric := 0;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be > 0';
  end if;

  select b.product_id into _prod_id
  from public.boms b where b.id = p_bom_id;
  if _prod_id is null then
    raise exception 'BOM % not found (or product missing)', p_bom_id;
  end if;

  -- 1) post component issues & accumulate total cost
  for _comp in
    select bc.component_item_id, bc.qty_per, coalesce(bc.scrap_pct,0) as scrap_pct
    from public.bom_components bc
    where bc.bom_id = p_bom_id
  loop
    _need_qty := coalesce(_comp.qty_per,0) * p_qty;
    _need_qty_after_scrap := _need_qty * (1 + coalesce(_comp.scrap_pct,0));

    _srcs := (
      select t.sources
      from jsonb_to_recordset(coalesce(p_component_sources, '[]'::jsonb))
           as t(component_item_id uuid, sources jsonb)
      where t.component_item_id = _comp.component_item_id
      limit 1
    );
    if _srcs is null or jsonb_array_length(_srcs) = 0 then
      raise exception 'No sources provided for component %', _comp.component_item_id;
    end if;

    _sum_share := 0;
    for _src in select * from jsonb_array_elements(_srcs) loop
      _src_share := coalesce((_src->>'share_pct')::numeric, 0);
      if _src_share < 0 then
        raise exception 'share_pct cannot be negative (component %)', _comp.component_item_id;
      end if;
      _sum_share := _sum_share + _src_share;
    end loop;
    if _sum_share <= 0 then
      raise exception 'Sum of share_pct must be > 0 for component %', _comp.component_item_id;
    end if;

    for _src in select * from jsonb_array_elements(_srcs) loop
      _src_wh    := (_src->>'warehouse_id')::uuid;
      _src_bin   := (_src->>'bin_id')::text;
      _src_share := coalesce((_src->>'share_pct')::numeric, 0) / _sum_share;
      if _src_share <= 0 then continue; end if;

      if not exists (select 1 from public.warehouses w where w.id = _src_wh) then
        raise exception 'Unknown warehouse UUID: % (component %)', _src_wh, _comp.component_item_id;
      end if;
      if not exists (
        select 1 from public.bins b
        where b.id = _src_bin and b."warehouseId" = _src_wh
      ) then
        raise exception 'Bin % does not exist or does not belong to warehouse % (component %)',
          _src_bin, _src_wh, _comp.component_item_id;
      end if;

      _total_cost := _total_cost + public.inv_issue_component(
        _comp.component_item_id,
        _need_qty_after_scrap * _src_share,
        _src_wh,
        _src_bin,
        format(
          'BOM %s build, source split %s',
          p_bom_id,
          to_char(_src_share, 'FM999999999.0000')
        )::text
      );
    end loop;
  end loop;

  -- 2) receive finished goods with cost (split aware)
  if coalesce(jsonb_array_length(p_output_splits),0) = 0 then
    raise exception 'At least one output split (destination bin) is required';
  end if;

  _total_qty := 0;
  for _out in select * from jsonb_array_elements(p_output_splits) loop
    _total_qty := _total_qty + coalesce((_out->>'qty')::numeric,0);
  end loop;
  if _total_qty <= 0 then
    raise exception 'Total output quantity must be > 0';
  end if;

  _unit_cost_fg := _total_cost / _total_qty;

  for _out in select * from jsonb_array_elements(p_output_splits) loop
    _out_wh  := (_out->>'warehouse_id')::uuid;
    _out_bin := (_out->>'bin_id')::text;
    _out_qty := coalesce((_out->>'qty')::numeric, 0);
    if _out_qty <= 0 then continue; end if;

    if not exists (select 1 from public.warehouses w where w.id = _out_wh) then
      raise exception 'Unknown destination warehouse UUID: %', _out_wh;
    end if;
    if not exists (
      select 1 from public.bins b
      where b.id = _out_bin and b."warehouseId" = _out_wh
    ) then
      raise exception 'Destination bin % does not exist or does not belong to warehouse %',
        _out_bin, _out_wh;
    end if;

    perform public.inv_receive_finished(
      _prod_id,
      _out_qty,
      _out_wh,
      _out_bin,
      format('BOM %s build receive', p_bom_id)::text,
      _unit_cost_fg
    );
  end loop;
end;
$$;


ALTER FUNCTION "public"."build_from_bom_sources"("p_bom_id" "uuid", "p_qty" numeric, "p_component_sources" "jsonb", "p_output_splits" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_invite_admins"("p_company" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select public.has_company_role_any_status(p_company, array['OWNER','ADMIN']::public.member_role[]);
$$;


ALTER FUNCTION "public"."can_invite_admins"("p_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_company_storage_prefix"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_members m
    WHERE m.company_id = p_company_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
      AND m.role IN ('OWNER'::member_role, 'ADMIN'::member_role, 'MANAGER'::member_role)
  );
$$;


ALTER FUNCTION "public"."can_manage_company_storage_prefix"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_company"("p_company_id" "uuid", "p_roles" "text"[] DEFAULT ARRAY['OWNER'::"text", 'ADMIN'::"text", 'MANAGER'::"text", 'OPERATOR'::"text", 'VIEWER'::"text"]) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or p_company_id is null then
    return false;
  end if;

  -- Company owner shortcut
  if exists (
    select 1 from public.companies c
    where c.id = p_company_id
      and c.owner_user_id = uid
  ) then
    return true;
  end if;

  -- Direct membership with allowed roles
  if exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id
      and m.user_id    = uid
      and m.status     = 'active'
      and m.role::text = any(p_roles)
  ) then
    return true;
  end if;

  -- Legacy/extra membership table
  if exists (
    select 1 from public.org_members om
    where om.company_id = p_company_id
      and om.user_id    = uid
  ) then
    return true;
  end if;

  return false;
end;
$$;


ALTER FUNCTION "public"."can_read_company"("p_company_id" "uuid", "p_roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_write_company"("p_company_id" "uuid", "p_roles" "public"."member_role"[] DEFAULT ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"]) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company_id
      and m.user_id    = auth.uid()
      and m.status     = 'active'::public.member_status
      and m.role       = any(p_roles)
  );
$$;


ALTER FUNCTION "public"."can_write_company"("p_company_id" "uuid", "p_roles" "public"."member_role"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cash_approve_po"("p_company" "uuid", "p_po_id" "uuid", "p_amount_base" numeric DEFAULT NULL::numeric, "p_memo" "text" DEFAULT 'PO cash approval'::"text") RETURNS TABLE("posted_id" "uuid", "posted_amount_base" numeric, "new_balance_due_base" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  v public.v_po_cash_status%ROWTYPE;
  v_amount_pos numeric;  -- positive magnitude
begin
  select * into v
  from public.v_po_cash_status
  where id = p_po_id;

  if v.id is null then
    raise exception 'PO % not found in v_po_cash_status', p_po_id;
  end if;

  if v.company_id <> p_company then
    raise exception 'PO % does not belong to company %', p_po_id, p_company;
  end if;

  if coalesce(v.balance_due_base, 0) <= 0 then
    posted_id := null;
    posted_amount_base := 0;
    new_balance_due_base := v.balance_due_base;
    return;
  end if;

  v_amount_pos := coalesce(p_amount_base, v.balance_due_base);
  if v_amount_pos <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if v_amount_pos > v.balance_due_base + 1e-9 then
    v_amount_pos := v.balance_due_base; -- clamp
  end if;

  insert into public.cash_transactions
    (company_id, happened_at, type, ref_type, ref_id, memo, amount_base)
  values
    (p_company, now()::timestamp, 'purchase_payment', 'PO', p_po_id, p_memo, -v_amount_pos)
  returning id into posted_id;

  posted_amount_base := -v_amount_pos;
  new_balance_due_base := v.balance_due_base - v_amount_pos;
  return;
end;
$$;


ALTER FUNCTION "public"."cash_approve_po"("p_company" "uuid", "p_po_id" "uuid", "p_amount_base" numeric, "p_memo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cash_approve_so"("p_company" "uuid", "p_so_id" "uuid", "p_amount_base" numeric DEFAULT NULL::numeric, "p_memo" "text" DEFAULT 'SO cash approval'::"text") RETURNS TABLE("posted_id" "uuid", "posted_amount_base" numeric, "new_balance_due_base" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  v public.v_so_cash_status%ROWTYPE;
  v_amount numeric;
begin
  select * into v
  from public.v_so_cash_status
  where id = p_so_id;

  if v.id is null then
    raise exception 'SO % not found in v_so_cash_status', p_so_id;
  end if;

  if v.company_id <> p_company then
    raise exception 'SO % does not belong to company %', p_so_id, p_company;
  end if;

  if coalesce(v.balance_due_base, 0) <= 0 then
    posted_id := null;
    posted_amount_base := 0;
    new_balance_due_base := v.balance_due_base;
    return;
  end if;

  v_amount := coalesce(p_amount_base, v.balance_due_base);
  if v_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if v_amount > v.balance_due_base + 1e-9 then
    v_amount := v.balance_due_base; -- clamp to outstanding
  end if;

  insert into public.cash_transactions
    (company_id, happened_at, type, ref_type, ref_id, memo, amount_base)
  values
    (p_company, now()::timestamp, 'sale_receipt', 'SO', p_so_id, p_memo, v_amount)
  returning id into posted_id;

  posted_amount_base := v_amount;
  new_balance_due_base := v.balance_due_base - v_amount;
  return;
end;
$$;


ALTER FUNCTION "public"."cash_approve_so"("p_company" "uuid", "p_so_id" "uuid", "p_amount_base" numeric, "p_memo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cash_audit_beginning_balance"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_old numeric := coalesce(old.beginning_balance_base, 0);
  v_new numeric := coalesce(new.beginning_balance_base, 0);
  v_delta numeric := v_new - v_old;
begin
  if tg_op = 'INSERT' then
    if v_new <> 0 then
      insert into public.cash_transactions
        (company_id, happened_at, type, ref_type, ref_id, memo, amount_base)
      values
        (new.company_id,
         new.beginning_as_of::timestamptz,
         'adjustment',
         'ADJ',
         new.id,
         'Opening balance set',
         v_new);
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if v_delta <> 0 or new.beginning_as_of is distinct from old.beginning_as_of then
      insert into public.cash_transactions
        (company_id, happened_at, type, ref_type, ref_id, memo, amount_base)
      values
        (new.company_id,
         new.beginning_as_of::timestamptz,
         'adjustment',
         'ADJ',
         new.id,
         'Opening balance change',
         v_delta);
    end if;
    return new;
  end if;
  return new;
end
$$;


ALTER FUNCTION "public"."cash_audit_beginning_balance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cash_book_audit_trg"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_delta numeric;
begin
  -- Only act if something meaningful changed
  if tg_op = 'INSERT' then
    v_delta := coalesce(new.beginning_balance_base, 0);
  else
    if coalesce(new.beginning_balance_base,0) = coalesce(old.beginning_balance_base,0)
       and coalesce(new.beginning_as_of, date '0001-01-01') = coalesce(old.beginning_as_of, date '0001-01-01')
    then
      return new;
    end if;
    v_delta := coalesce(new.beginning_balance_base,0) - coalesce(old.beginning_balance_base,0);
  end if;

  -- Zero delta? nothing to audit.
  if coalesce(v_delta,0) = 0 then
    return new;
  end if;

  -- Insert an ADJ transaction linked to this book (ref_type='ADJ', ref_id=book id)
  insert into public.cash_transactions(
    company_id,
    happened_at,
    type,
    ref_type,
    ref_id,
    memo,
    amount_base
  ) values (
    new.company_id,
    new.beginning_as_of::timestamptz,        -- dated on the book's as_of day
    'adjustment',
    'ADJ',
    new.id,
    'Opening balance change',
    v_delta
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."cash_book_audit_trg"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cash_get_book"("p_company" "uuid") RETURNS TABLE("id" "uuid", "company_id" "uuid", "beginning_balance_base" numeric, "beginning_as_of" "date")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company is distinct from public.current_company_id()
       or not public.is_company_member(auth.uid(), p_company, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::text[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  select b.id, b.company_id, b.beginning_balance_base, b.beginning_as_of::date
  from public.cash_books b
  where b.company_id = p_company
  order by b.beginning_as_of desc
  limit 1;
end
$$;


ALTER FUNCTION "public"."cash_get_book"("p_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cash_ledger"("p_company" "uuid", "p_from" "date", "p_to" "date") RETURNS TABLE("id" "uuid", "happened_at" "date", "type" "text", "ref_type" "text", "ref_id" "uuid", "memo" "text", "amount_base" numeric, "running_balance" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company is distinct from public.current_company_id()
       or not public.is_company_member(auth.uid(), p_company, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::text[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  with params as (
    select
      p_company as company_id,
      p_from::date as dfrom,
      (p_to::date + interval '1 day')::date as dto_ex
  ),
  opening as (
    select (
      coalesce((
        select coalesce(sum(ct.amount_base), 0)
        from public.cash_transactions ct
        where ct.company_id = (select p.company_id from params p)
          and ct.happened_at < (select p.dfrom from params p)
      ), 0)
      + coalesce((
        select coalesce(sum(ct.amount_base), 0)
        from public.cash_transactions ct
        where ct.company_id = (select p.company_id from params p)
          and ct.happened_at = (select p.dfrom from params p)
          and ct.type = 'adjustment'
          and ct.memo ilike 'Opening balance%'
      ), 0)
    )::numeric as opening_balance
  ),
  tx as (
    select
      ct.id as tx_id,
      ct.happened_at::date as tx_happened_at,
      ct.type::text as tx_type,
      ct.ref_type::text as tx_ref_type,
      ct.ref_id::uuid as tx_ref_id,
      ct.memo as tx_memo,
      ct.amount_base as tx_amount_base,
      ct.created_at as tx_created_at
    from public.cash_transactions ct
    where ct.company_id = (select p.company_id from params p)
      and ct.happened_at >= (select p.dfrom from params p)
      and ct.happened_at < (select p.dto_ex from params p)
      and not (
        ct.happened_at = (select p.dfrom from params p)
        and ct.type = 'adjustment'
        and ct.memo ilike 'Opening balance%'
      )
  ),
  tx_running as (
    select
      t.tx_id,
      t.tx_happened_at,
      t.tx_type,
      t.tx_ref_type,
      t.tx_ref_id,
      t.tx_memo,
      t.tx_amount_base,
      (
        (select o.opening_balance from opening o)
        + sum(t.tx_amount_base) over (
            order by t.tx_happened_at, t.tx_created_at, t.tx_id
            rows between unbounded preceding and current row
          )
      )::numeric as tx_running_balance,
      t.tx_created_at
    from tx t
  ),
  opening_row as (
    select
      null::uuid as row_id,
      (select p.dfrom from params p) as row_happened_at,
      'opening'::text as row_type,
      null::text as row_ref_type,
      null::uuid as row_ref_id,
      'Opening balance'::text as row_memo,
      0::numeric as row_amount_base,
      (select o.opening_balance from opening o)::numeric as row_running_balance,
      '00000000-0000-0000-0000-000000000000'::uuid as sort_id,
      'epoch'::timestamp as sort_ts
  ),
  detail_rows as (
    select
      r.tx_id as row_id,
      r.tx_happened_at as row_happened_at,
      r.tx_type as row_type,
      r.tx_ref_type as row_ref_type,
      r.tx_ref_id as row_ref_id,
      r.tx_memo as row_memo,
      r.tx_amount_base as row_amount_base,
      r.tx_running_balance as row_running_balance,
      r.tx_id as sort_id,
      r.tx_created_at as sort_ts
    from tx_running r
  )
  select
    u.row_id as id,
    u.row_happened_at as happened_at,
    u.row_type as type,
    u.row_ref_type as ref_type,
    u.row_ref_id as ref_id,
    u.row_memo as memo,
    u.row_amount_base as amount_base,
    u.row_running_balance as running_balance
  from (
    select * from opening_row
    union all
    select * from detail_rows
  ) u
  order by u.row_happened_at, u.sort_ts, u.sort_id;
end
$$;


ALTER FUNCTION "public"."cash_ledger"("p_company" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cash_summary"("p_company" "uuid", "p_from" "date", "p_to" "date") RETURNS TABLE("beginning" numeric, "inflows" numeric, "outflows" numeric, "net" numeric, "ending" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company is distinct from public.current_company_id()
       or not public.is_company_member(auth.uid(), p_company, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::text[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  with params as (
    select
      p_company as company_id,
      p_from::date as dfrom,
      (p_to::date + interval '1 day')::date as dto_ex
  ),
  opening as (
    select (
      coalesce((
        select coalesce(sum(ct.amount_base), 0)
        from public.cash_transactions ct
        where ct.company_id = (select p.company_id from params p)
          and ct.happened_at < (select p.dfrom from params p)
      ), 0)
      + coalesce((
        select coalesce(sum(ct.amount_base), 0)
        from public.cash_transactions ct
        where ct.company_id = (select p.company_id from params p)
          and ct.happened_at = (select p.dfrom from params p)
          and ct.type = 'adjustment'
          and ct.memo ilike 'Opening balance%'
      ), 0)
    )::numeric as opening_balance
  ),
  inrange as (
    select ct.*
    from public.cash_transactions ct
    where ct.company_id = (select p.company_id from params p)
      and ct.happened_at >= (select p.dfrom from params p)
      and ct.happened_at < (select p.dto_ex from params p)
      and not (
        ct.happened_at = (select p.dfrom from params p)
        and ct.type = 'adjustment'
        and ct.memo ilike 'Opening balance%'
      )
  ),
  agg as (
    select
      coalesce(sum(case when ir.type = 'sale_receipt' then ir.amount_base else 0 end), 0)::numeric as inflows_amount,
      coalesce(sum(case when ir.type = 'purchase_payment' then abs(ir.amount_base) else 0 end), 0)::numeric as outflows_amount,
      coalesce(sum(ir.amount_base), 0)::numeric as delta_all
    from inrange ir
  )
  select
    o.opening_balance as beginning,
    a.inflows_amount as inflows,
    a.outflows_amount as outflows,
    (a.inflows_amount - a.outflows_amount)::numeric as net,
    (o.opening_balance + a.delta_all)::numeric as ending
  from opening o
  cross join agg a;
end
$$;


ALTER FUNCTION "public"."cash_summary"("p_company" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."company_access_effective_status"("p_company_id" "uuid") RETURNS "public"."subscription_status"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
declare
  v_state public.company_subscription_state%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  select *
    into v_state
  from public.company_subscription_state css
  where css.company_id = p_company_id;

  if not found then
    return 'disabled'::public.subscription_status;
  end if;

  if v_state.subscription_status = 'trial'::public.subscription_status
     and v_state.trial_expires_at is not null
     and v_state.trial_expires_at <= v_now then
    return 'expired'::public.subscription_status;
  end if;

  if v_state.subscription_status = 'active_paid'::public.subscription_status
     and v_state.paid_until is not null
     and v_state.paid_until <= v_now then
    return 'expired'::public.subscription_status;
  end if;

  return v_state.subscription_status;
end;
$$;


ALTER FUNCTION "public"."company_access_effective_status"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."company_access_is_enabled"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
  select public.company_access_effective_status(p_company_id) in ('trial'::public.subscription_status, 'active_paid'::public.subscription_status);
$$;


ALTER FUNCTION "public"."company_access_is_enabled"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."company_code3"("cid" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with n as (
    select upper(regexp_replace(coalesce(c.name,''), '[^A-Za-z]', '', 'g')) as nm
    from public.companies c
    where c.id = cid
  )
  select case
           when length(nm) >= 3 then substr(nm,1,3)
           when length(nm) = 2 then nm || 'X'
           when length(nm) = 1 then nm || 'XX'
           else 'CMP'
         end
  from n;
$$;


ALTER FUNCTION "public"."company_code3"("cid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."company_currencies_bi_set_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
begin
  if new.company_id is null then
    new.company_id := current_company_id();
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."company_currencies_bi_set_defaults"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."company_prefix3"("p_company_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select substr(strip_nonalpha(coalesce(c.name, 'XXX')) || 'XXX', 1, 3)
  from public.companies c
  where c.id = p_company_id
$$;


ALTER FUNCTION "public"."company_prefix3"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."company_settings_defaults"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select jsonb_build_object(
    'locale', jsonb_build_object('language', 'en'),
    'dashboard', jsonb_build_object('defaultWindowDays', 30, 'defaultWarehouseId', 'ALL', 'hideZeros', false),
    'sales', jsonb_build_object(
      'allowLineShip', true,
      'autoCompleteWhenShipped', true,
      'revenueRule', 'order_total_first',
      'allocateMissingRevenueBy', 'cogs_share',
      'defaultFulfilWarehouseId',''
    ),
    'documents', jsonb_build_object(
      'brand', jsonb_build_object('name','', 'logoUrl',''),
      'packingSlipShowsPrices', false
    ),
    'revenueSources', jsonb_build_object(
      'ordersSource','',
      'cashSales', jsonb_build_object(
        'source','',
        'dateCol','created_at',
        'customerCol','customer_id',
        'amountCol','amount',
        'currencyCol','currency_code'
      )
    ),
    'notifications', jsonb_build_object(
      'dailyDigest', false,
      'dailyDigestTime', '08:00',
      'timezone', 'Africa/Maputo',
      'dailyDigestChannels', jsonb_build_object('email', true, 'sms', false, 'whatsapp', false),
      'recipients', jsonb_build_object('emails', to_jsonb(array[]::text[]), 'phones', to_jsonb(array[]::text[]), 'whatsapp', to_jsonb(array[]::text[])),
      'lowStock', jsonb_build_object('channel','email')
    )
  );
$$;


ALTER FUNCTION "public"."company_settings_defaults"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_due_date"("p_order_date" "date", "p_terms_id" "uuid") RETURNS "date"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT CASE
           WHEN p_order_date IS NULL THEN NULL
           WHEN p_terms_id IS NULL THEN p_order_date
           ELSE p_order_date + COALESCE(pt.net_days, 0)
         END
  FROM public.payment_terms pt
  WHERE pt.id = p_terms_id;
$$;


ALTER FUNCTION "public"."compute_due_date"("p_order_date" "date", "p_terms_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_security_rate_limit"("p_scope" "text", "p_subject" "text", "p_window_seconds" integer, "p_max_hits" integer) RETURNS TABLE("allowed" boolean, "hit_count" integer, "retry_after_seconds" integer, "bucket_started_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'app'
    AS $$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_bucket timestamptz;
  v_count integer;
  v_retry integer;
BEGIN
  IF COALESCE(btrim(p_scope), '') = '' THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_subject), '') = '' THEN
    RAISE EXCEPTION 'subject_required' USING ERRCODE = '22023';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_window_seconds' USING ERRCODE = '22023';
  END IF;
  IF p_max_hits IS NULL OR p_max_hits < 1 OR p_max_hits > 10000 THEN
    RAISE EXCEPTION 'invalid_max_hits' USING ERRCODE = '22023';
  END IF;

  v_bucket := to_timestamp(floor(extract(epoch FROM v_now) / p_window_seconds) * p_window_seconds);

  INSERT INTO app.security_rate_limits (
    scope,
    subject,
    bucket_start,
    window_seconds,
    hit_count,
    first_seen_at,
    last_seen_at
  )
  VALUES (
    p_scope,
    p_subject,
    v_bucket,
    p_window_seconds,
    1,
    v_now,
    v_now
  )
  ON CONFLICT (scope, subject, bucket_start)
  DO UPDATE
     SET hit_count = app.security_rate_limits.hit_count + 1,
         last_seen_at = v_now
  RETURNING app.security_rate_limits.hit_count
    INTO v_count;

  v_retry := GREATEST(
    0,
    CEIL(
      EXTRACT(
        EPOCH FROM ((v_bucket + make_interval(secs => p_window_seconds)) - v_now)
      )
    )::integer
  );

  RETURN QUERY
    SELECT v_count <= p_max_hits,
           v_count,
           CASE WHEN v_count <= p_max_hits THEN 0 ELSE v_retry END,
           v_bucket;
END;
$$;


ALTER FUNCTION "public"."consume_security_rate_limit"("p_scope" "text", "p_subject" "text", "p_window_seconds" integer, "p_max_hits" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_company_and_bootstrap"("p_name" "text") RETURNS TABLE("out_company_id" "uuid", "company_name" "text", "out_role" "public"."member_role")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_company_id uuid;
  v_trial_started_at timestamptz := timezone('utc', now());
  v_trial_expires_at timestamptz := timezone('utc', now()) + interval '7 days';
  v_purge_scheduled_at timestamptz := timezone('utc', now()) + interval '21 days';
  v_rate_allowed boolean;
  v_rate_retry integer;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select allowed, retry_after_seconds
    into v_rate_allowed, v_rate_retry
  from public.consume_security_rate_limit(
    'create_company_and_bootstrap',
    v_user::text,
    3600,
    3
  );

  if coalesce(v_rate_allowed, false) = false then
    raise exception 'company_bootstrap_rate_limited_retry_after_%s', coalesce(v_rate_retry, 3600)
      using errcode = 'P0001';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user;

  select cm.company_id
    into v_company_id
  from public.company_members cm
  where cm.user_id = v_user
    and cm.status = 'active'::member_status
  order by cm.created_at asc, cm.company_id asc
  limit 1;

  if v_company_id is not null then
    return query
      select c.id as out_company_id,
             c.name as company_name,
             cm.role as out_role
      from public.companies c
      join public.company_members cm
        on cm.company_id = c.id
       and cm.user_id = v_user
       and cm.status = 'active'::member_status
      where c.id = v_company_id
      order by cm.created_at asc, cm.company_id asc
      limit 1;
    return;
  end if;

  with activated as (
    update public.company_members m
       set user_id = v_user,
           status = 'active'::member_status
     where m.status = 'invited'::member_status
       and (
         m.user_id = v_user
         or (
           v_email is not null
           and lower(m.email) = v_email
           and (m.user_id is null or m.user_id = v_user)
         )
       )
    returning m.company_id, m.created_at
  )
  select a.company_id
    into v_company_id
  from activated a
  order by a.created_at asc nulls last, a.company_id asc
  limit 1;

  if v_company_id is not null then
    return query
      select c.id as out_company_id,
             c.name as company_name,
             cm.role as out_role
      from public.companies c
      join public.company_members cm
        on cm.company_id = c.id
       and cm.user_id = v_user
       and cm.status = 'active'::member_status
      where c.id = v_company_id
      order by cm.created_at asc, cm.company_id asc
      limit 1;
    return;
  end if;

  insert into public.companies (name, owner_user_id)
  values (coalesce(nullif(trim(p_name), ''), 'My Company'), v_user)
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, email, role, status, invited_by)
  values (v_company_id, v_user, v_email, 'OWNER'::member_role, 'active'::member_status, v_user)
  on conflict on constraint company_members_pkey do update
    set user_id = excluded.user_id,
        role = 'OWNER'::member_role,
        status = 'active'::member_status,
        invited_by = excluded.invited_by;

  insert into public.company_settings (company_id, data)
  values (v_company_id, '{}'::jsonb)
  on conflict (company_id) do nothing;

  perform public.seed_default_payment_terms(v_company_id);

  insert into public.company_subscription_state (
    company_id,
    plan_code,
    subscription_status,
    trial_started_at,
    trial_expires_at,
    purge_scheduled_at,
    access_granted_by,
    access_granted_at,
    grant_reason,
    updated_by
  )
  values (
    v_company_id,
    'trial_7d',
    'trial'::public.subscription_status,
    v_trial_started_at,
    v_trial_expires_at,
    v_purge_scheduled_at,
    v_user,
    v_trial_started_at,
    'Initial 7-day trial',
    v_user
  )
  on conflict (company_id) do nothing;

  perform public.sync_company_purge_queue(
    v_company_id,
    v_purge_scheduled_at,
    'Scheduled operational-data purge after 7-day trial expiry',
    v_user
  );

  perform public.record_company_access_audit(
    v_company_id,
    null,
    'trial_7d',
    null,
    'trial'::public.subscription_status,
    'Initial 7-day trial',
    jsonb_build_object(
      'trial_started_at', v_trial_started_at,
      'trial_expires_at', v_trial_expires_at,
      'purge_scheduled_at', v_purge_scheduled_at
    )
  );

  return query
    select c.id as out_company_id,
           c.name as company_name,
           'OWNER'::member_role as out_role
    from public.companies c
    where c.id = v_company_id
    limit 1;

exception
  when others then
    raise exception 'bootstrap_error: % (SQLSTATE=%)', sqlerrm, sqlstate;
end;
$$;


ALTER FUNCTION "public"."create_company_and_bootstrap"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_operator_sale_issue"("p_company_id" "uuid", "p_bin_from_id" "text", "p_customer_id" "uuid" DEFAULT NULL::"uuid", "p_order_date" "date" DEFAULT CURRENT_DATE, "p_currency_code" "text" DEFAULT 'MZN'::"text", "p_fx_to_base" numeric DEFAULT 1, "p_reference_no" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text", "p_lines" "jsonb" DEFAULT '[]'::"jsonb") RETURNS TABLE("sales_order_id" "uuid", "order_no" "text", "customer_id" "uuid", "customer_name" "text", "line_count" integer, "total_amount" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_active_company uuid := public.active_company_id();
  v_member_role public.member_role;
  v_source_bin record;
  v_customer record;
  v_line record;
  v_item record;
  v_so_id uuid;
  v_order_no text;
  v_so_line_id uuid;
  v_subtotal numeric := 0;
  v_line_total numeric := 0;
  v_line_qty numeric := 0;
  v_line_price numeric := 0;
  v_available_qty numeric := 0;
  v_line_cost numeric := 0;
  v_line_count integer := 0;
  v_normalized_currency text := upper(coalesce(nullif(trim(p_currency_code), ''), 'MZN'));
  v_fx_to_base numeric := case when coalesce(p_fx_to_base, 0) > 0 then p_fx_to_base else 1 end;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_company_id is null then
    raise exception 'Select a company before posting the operator issue.' using errcode = 'P0001';
  end if;

  if v_active_company is null or v_active_company <> p_company_id then
    raise exception 'Switch into the target company before posting the operator issue.' using errcode = '42501';
  end if;

  select cm.role
    into v_member_role
  from public.company_members cm
  where cm.company_id = p_company_id
    and cm.user_id = v_user
    and cm.status = 'active'::public.member_status
  limit 1;

  if v_member_role is null then
    raise exception 'You do not have access to post operator issues in this company.' using errcode = '42501';
  end if;

  if v_member_role not in (
    'OWNER'::public.member_role,
    'ADMIN'::public.member_role,
    'MANAGER'::public.member_role,
    'OPERATOR'::public.member_role
  ) then
    raise exception 'Only operators and above can post operator issues.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item before posting the operator issue.' using errcode = 'P0001';
  end if;

  select
    b.id,
    b.code,
    b.name,
    b."warehouseId" as warehouse_id,
    w.name as warehouse_name
    into v_source_bin
  from public.bins b
  join public.warehouses w
    on w.id = b."warehouseId"
   and w.company_id = p_company_id
  where b.id = p_bin_from_id
    and b.company_id = p_company_id
  limit 1;

  if v_source_bin.id is null then
    raise exception 'Choose a valid source bin before posting the operator issue.' using errcode = 'P0001';
  end if;

  if p_customer_id is null then
    insert into public.customers (
      company_id,
      code,
      name,
      is_cash
    )
    values (
      p_company_id,
      'CASH',
      'Cash Customer',
      true
    )
    on conflict (company_id, code) do update
      set
        name = public.customers.name,
        is_cash = true
    returning id, name, email, tax_id, billing_address, shipping_address, is_cash
      into v_customer;
  else
    select
      c.id,
      c.name,
      c.email,
      c.tax_id,
      c.billing_address,
      c.shipping_address
      into v_customer
    from public.customers c
    where c.company_id = p_company_id
      and c.id = p_customer_id
    limit 1;

    if v_customer.id is null then
      raise exception 'The selected customer does not belong to this company.' using errcode = 'P0001';
    end if;
  end if;

  for v_line in
    select ordinality::integer as line_no, value as line_data
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality
  loop
    select
      i.id,
      i.name,
      i.sku,
      i.base_uom_id,
      coalesce(i.unit_price, 0) as default_unit_price,
      coalesce(i.track_inventory, true) as track_inventory,
      coalesce(i.can_sell, true) as can_sell
      into v_item
    from public.items i
    where i.company_id = p_company_id
      and i.id = nullif(trim(v_line.line_data ->> 'item_id'), '')::uuid
    limit 1;

    if v_item.id is null then
      raise exception 'Operator issue line % references an unknown item.', v_line.line_no using errcode = 'P0001';
    end if;

    if coalesce(v_item.track_inventory, false) = false then
      raise exception 'Operator issue line % uses an item that is not tracked in stock.', v_line.line_no using errcode = 'P0001';
    end if;

    if coalesce(v_item.can_sell, false) = false then
      raise exception 'Operator issue line % uses an item that is not marked for selling.', v_line.line_no using errcode = 'P0001';
    end if;

    v_line_qty := coalesce(nullif(trim(v_line.line_data ->> 'qty'), '')::numeric, 0);
    if v_line_qty <= 0 then
      raise exception 'Operator issue line % needs a quantity above zero.', v_line.line_no using errcode = 'P0001';
    end if;

    v_line_price := coalesce(
      nullif(trim(v_line.line_data ->> 'unit_price'), '')::numeric,
      v_item.default_unit_price,
      0
    );
    if v_line_price < 0 then
      raise exception 'Operator issue line % cannot use a negative sell price.', v_line.line_no using errcode = 'P0001';
    end if;

    select
      greatest(coalesce(sl.qty, 0) - coalesce(sl.allocated_qty, 0), 0),
      coalesce(sl.avg_cost, 0)
      into v_available_qty, v_line_cost
    from public.stock_levels sl
    where sl.company_id = p_company_id
      and sl.item_id = v_item.id
      and sl.warehouse_id = v_source_bin.warehouse_id
      and sl.bin_id = v_source_bin.id
    limit 1;

    if coalesce(v_available_qty, 0) < v_line_qty then
      raise exception 'Operator issue line % does not have enough stock for %.', v_line.line_no, coalesce(v_item.name, v_item.sku, 'the selected item')
        using errcode = 'P0001';
    end if;

    v_line_total := round(v_line_qty * v_line_price, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_line_count := v_line_count + 1;
  end loop;

  insert into public.sales_orders (
    company_id,
    customer_id,
    customer,
    status,
    order_date,
    due_date,
    currency_code,
    fx_to_base,
    reference_no,
    notes,
    created_by,
    bill_to_name,
    bill_to_email,
    bill_to_tax_id,
    bill_to_billing_address,
    bill_to_shipping_address,
    subtotal,
    tax_total,
    total,
    total_amount
  )
  values (
    p_company_id,
    v_customer.id,
    v_customer.name,
    'shipped',
    coalesce(p_order_date, current_date),
    coalesce(p_order_date, current_date),
    v_normalized_currency,
    v_fx_to_base,
    nullif(trim(p_reference_no), ''),
    nullif(trim(p_notes), ''),
    v_user,
    v_customer.name,
    v_customer.email,
    v_customer.tax_id,
    v_customer.billing_address,
    v_customer.shipping_address,
    round(v_subtotal, 2),
    0,
    round(v_subtotal, 2),
    round(v_subtotal, 2)
  )
  returning public.sales_orders.id, public.sales_orders.order_no
    into v_so_id, v_order_no;

  for v_line in
    select ordinality::integer as line_no, value as line_data
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality
  loop
    select
      i.id,
      i.name,
      i.sku,
      i.base_uom_id,
      coalesce(i.unit_price, 0) as default_unit_price
      into v_item
    from public.items i
    where i.company_id = p_company_id
      and i.id = nullif(trim(v_line.line_data ->> 'item_id'), '')::uuid
    limit 1;

    v_line_qty := coalesce(nullif(trim(v_line.line_data ->> 'qty'), '')::numeric, 0);
    v_line_price := coalesce(
      nullif(trim(v_line.line_data ->> 'unit_price'), '')::numeric,
      v_item.default_unit_price,
      0
    );
    v_line_total := round(v_line_qty * v_line_price, 2);

    select coalesce(sl.avg_cost, 0)
      into v_line_cost
    from public.stock_levels sl
    where sl.company_id = p_company_id
      and sl.item_id = v_item.id
      and sl.warehouse_id = v_source_bin.warehouse_id
      and sl.bin_id = v_source_bin.id
    limit 1;

    insert into public.sales_order_lines (
      company_id,
      so_id,
      item_id,
      uom_id,
      description,
      line_no,
      qty,
      shipped_qty,
      is_shipped,
      shipped_at,
      unit_price,
      discount_pct,
      line_total
    )
    values (
      p_company_id,
      v_so_id,
      v_item.id,
      v_item.base_uom_id,
      coalesce(v_item.name, v_item.sku, 'Sale line'),
      v_line.line_no,
      v_line_qty,
      v_line_qty,
      true,
      now(),
      v_line_price,
      0,
      v_line_total
    )
    returning id into v_so_line_id;

    insert into public.stock_movements (
      company_id,
      type,
      item_id,
      uom_id,
      qty,
      qty_base,
      unit_cost,
      total_value,
      warehouse_from_id,
      bin_from_id,
      notes,
      created_by,
      ref_type,
      ref_id,
      ref_line_id
    )
    values (
      p_company_id,
      'issue',
      v_item.id,
      v_item.base_uom_id,
      v_line_qty,
      v_line_qty,
      v_line_cost,
      round(v_line_cost * v_line_qty, 2),
      v_source_bin.warehouse_id,
      v_source_bin.id,
      trim(
        both ' '
        from concat(
          'Operator sale from ',
          coalesce(v_source_bin.warehouse_name, 'warehouse'),
          ' / ',
          coalesce(v_source_bin.code, v_source_bin.name, 'bin'),
          case when nullif(trim(p_notes), '') is not null then ' | ' || trim(p_notes) else '' end
        )
      ),
      v_user,
      'SO',
      v_so_id,
      v_so_line_id
    );
  end loop;

  sales_order_id := v_so_id;
  order_no := v_order_no;
  customer_id := v_customer.id;
  customer_name := v_customer.name;
  line_count := v_line_count;
  total_amount := round(v_subtotal, 2);

  return next;
end;
$$;


ALTER FUNCTION "public"."create_operator_sale_issue"("p_company_id" "uuid", "p_bin_from_id" "text", "p_customer_id" "uuid", "p_order_date" "date", "p_currency_code" "text", "p_fx_to_base" numeric, "p_reference_no" "text", "p_notes" "text", "p_lines" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."saft_moz_exports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "status" "text" NOT NULL,
    "requested_by" "uuid",
    "generated_by" "uuid",
    "generated_at" timestamp with time zone,
    "submitted_by" "uuid",
    "submitted_at" timestamp with time zone,
    "submission_reference" "text",
    "storage_bucket" "text",
    "storage_path" "text",
    "file_name" "text",
    "mime_type" "text",
    "file_sha256" "text",
    "size_bytes" bigint,
    "source_document_count" integer DEFAULT 0 NOT NULL,
    "source_total_mzn" numeric DEFAULT 0 NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "saft_moz_exports_period_check" CHECK (("period_end" >= "period_start")),
    CONSTRAINT "saft_moz_exports_source_total_mzn_check" CHECK (("source_total_mzn" >= (0)::numeric)),
    CONSTRAINT "saft_moz_exports_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'generated'::"text", 'submitted'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."saft_moz_exports" OWNER TO "postgres";


COMMENT ON TABLE "public"."saft_moz_exports" IS 'Monthly SAF-T (Mozambique) export runs, file metadata, and submission lifecycle state.';



CREATE OR REPLACE FUNCTION "public"."create_saft_moz_export_run"("p_company_id" "uuid", "p_period_start" "date", "p_period_end" "date") RETURNS "public"."saft_moz_exports"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_export public.saft_moz_exports;
  v_settings public.company_fiscal_settings%rowtype;
begin
  if p_company_id is null then
    raise exception using
      message = 'SAF-T export creation requires a company id.';
  end if;

  if not public.finance_documents_can_write(p_company_id) then
    raise exception using
      message = 'SAF-T export creation access denied.';
  end if;

  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception using
      message = 'SAF-T export creation requires a valid period range.';
  end if;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = p_company_id
    and cfs.jurisdiction_code = 'MZ';

  if v_settings.company_id is null then
    raise exception using
      message = 'SAF-T export creation requires Mozambique fiscal settings for the company.';
  end if;

  if not coalesce(v_settings.saft_moz_enabled, false) then
    raise exception using
      message = 'SAF-T export generation is disabled for this company.';
  end if;

  if exists (
    select 1
    from public.saft_moz_exports sme
    where sme.company_id = p_company_id
      and sme.period_start = p_period_start
      and sme.period_end = p_period_end
  ) then
    raise exception using
      message = 'An SAF-T export run already exists for this company and period.';
  end if;

  insert into public.saft_moz_exports (
    company_id,
    period_start,
    period_end,
    status,
    requested_by
  )
  values (
    p_company_id,
    p_period_start,
    p_period_end,
    'pending',
    auth.uid()
  )
  returning * into v_export;

  perform public.append_finance_document_event(
    v_export.company_id,
    'saft_moz_export',
    v_export.id,
    'saft_export_requested',
    null,
    v_export.status,
    jsonb_build_object(
      'period_start', v_export.period_start,
      'period_end', v_export.period_end
    )
  );

  return v_export;
end;
$$;


ALTER FUNCTION "public"."create_saft_moz_export_run"("p_company_id" "uuid", "p_period_start" "date", "p_period_end" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_saft_moz_export_run"("p_company_id" "uuid", "p_period_start" "date", "p_period_end" "date") IS 'Creates a pending SAF-T (Mozambique) export run for a company and period and journals the request.';



CREATE OR REPLACE FUNCTION "public"."create_vendor_bill_draft_from_purchase_order"("p_company_id" "uuid", "p_purchase_order_id" "uuid", "p_supplier_invoice_reference" "text" DEFAULT NULL::"text", "p_supplier_invoice_date" "date" DEFAULT NULL::"date", "p_bill_date" "date" DEFAULT NULL::"date", "p_due_date" "date" DEFAULT NULL::"date", "p_currency_code" "text" DEFAULT NULL::"text", "p_fx_to_base" numeric DEFAULT NULL::numeric, "p_lines" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "public"."vendor_bills"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_po public.purchase_orders%rowtype;
  v_bill public.vendor_bills%rowtype;
  v_bill_date date;
  v_due_date date;
  v_currency_code text;
  v_fx_to_base numeric;
  v_line_count integer := 0;
  v_expected_line_count integer := 0;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_total_amount numeric := 0;
  v_derive_lines boolean := false;
begin
  if p_company_id is null or p_purchase_order_id is null then
    raise exception using
      message = 'A company and purchase order are required before creating a vendor bill draft.';
  end if;

  if not public.finance_documents_can_prepare_draft(p_company_id) then
    raise exception using
      message = 'Vendor bill draft creation access denied.';
  end if;

  select po.*
    into v_po
  from public.purchase_orders po
  where po.company_id = p_company_id
    and po.id = p_purchase_order_id;

  if v_po.id is null then
    raise exception using
      message = 'Purchase order not found for the active company.';
  end if;

  if lower(coalesce(v_po.status::text, '')) not in ('approved', 'open', 'authorised', 'authorized', 'submitted', 'partially_received', 'closed') then
    raise exception using
      message = 'Only approved, receiving, or closed purchase orders can create vendor bill drafts.';
  end if;

  if exists (
    select 1
    from public.vendor_bills vb
    where vb.company_id = p_company_id
      and vb.purchase_order_id = p_purchase_order_id
      and vb.document_workflow_status in ('draft', 'posted')
  ) then
    raise exception using
      message = 'A draft or posted vendor bill already exists for this purchase order.';
  end if;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception using
      message = 'Vendor bill draft lines must be provided as a JSON array.';
  end if;

  v_expected_line_count := coalesce(jsonb_array_length(coalesce(p_lines, '[]'::jsonb)), 0);
  v_derive_lines := v_expected_line_count = 0;

  create temporary table if not exists pg_temp.vendor_bill_draft_source_lines (
    source_key text not null,
    purchase_order_line_id uuid null,
    item_id uuid null,
    description text not null,
    qty numeric not null,
    unit_cost numeric not null,
    tax_rate numeric null,
    tax_amount numeric not null,
    line_total numeric not null,
    sort_order integer not null
  ) on commit drop;

  truncate table pg_temp.vendor_bill_draft_source_lines;

  if not v_derive_lines then
    insert into pg_temp.vendor_bill_draft_source_lines (
      source_key,
      purchase_order_line_id,
      item_id,
      description,
      qty,
      unit_cost,
      tax_rate,
      tax_amount,
      line_total,
      sort_order
    )
    select
      pol.id::text as source_key,
      pol.id,
      coalesce(src.item_id, pol.item_id),
      coalesce(
        nullif(btrim(src.description), ''),
        nullif(btrim(pol.description), ''),
        nullif(btrim(it.name), ''),
        nullif(btrim(it.sku), ''),
        'Item'
      ) as description,
      round(coalesce(src.qty, 0), 6) as qty,
      round(coalesce(src.unit_cost, 0), 6) as unit_cost,
      case
        when src.tax_rate is null then null
        else round(src.tax_rate, 4)
      end as tax_rate,
      round(coalesce(src.tax_amount, 0), 2) as tax_amount,
      round(coalesce(src.line_total, 0), 2) as line_total,
      coalesce(src.sort_order, pol.line_no, 0) as sort_order
    from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as src(
      purchase_order_line_id uuid,
      item_id uuid,
      description text,
      qty numeric,
      unit_cost numeric,
      tax_rate numeric,
      tax_amount numeric,
      line_total numeric,
      sort_order integer
    )
    join public.purchase_order_lines pol
      on pol.company_id = p_company_id
     and pol.po_id = p_purchase_order_id
     and pol.id = src.purchase_order_line_id
    left join public.items it
      on it.company_id = p_company_id
     and it.id = coalesce(src.item_id, pol.item_id)
    where round(coalesce(src.qty, 0), 6) > 0
      and (round(coalesce(src.line_total, 0), 2) > 0 or round(coalesce(src.tax_amount, 0), 2) > 0);

    get diagnostics v_line_count = row_count;

    if v_line_count <> v_expected_line_count then
      raise exception using
        message = 'Every vendor bill draft line must point to a valid purchase-order line with a positive quantity and amount.';
    end if;
  else
    insert into pg_temp.vendor_bill_draft_source_lines (
      source_key,
      purchase_order_line_id,
      item_id,
      description,
      qty,
      unit_cost,
      tax_rate,
      tax_amount,
      line_total,
      sort_order
    )
    select
      pol.id::text as source_key,
      pol.id,
      pol.item_id,
      coalesce(
        nullif(btrim(pol.description), ''),
        nullif(btrim(it.name), ''),
        nullif(btrim(it.sku), ''),
        'Item'
      ) as description,
      round(coalesce(pol.qty, 0), 6) as qty,
      round(coalesce(pol.unit_price, 0), 6) as unit_cost,
      null::numeric as tax_rate,
      0::numeric as tax_amount,
      round(coalesce(pol.line_total, coalesce(pol.qty, 0) * coalesce(pol.unit_price, 0)), 2) as line_total,
      coalesce(pol.line_no, 0) as sort_order
    from public.purchase_order_lines pol
    left join public.items it
      on it.company_id = p_company_id
     and it.id = pol.item_id
    where pol.company_id = p_company_id
      and pol.po_id = p_purchase_order_id
      and round(coalesce(pol.qty, 0), 6) > 0
      and round(coalesce(pol.line_total, coalesce(pol.qty, 0) * coalesce(pol.unit_price, 0)), 2) > 0;

    insert into pg_temp.vendor_bill_draft_source_lines (
      source_key,
      purchase_order_line_id,
      item_id,
      description,
      qty,
      unit_cost,
      tax_rate,
      tax_amount,
      line_total,
      sort_order
    )
    with receipt_rollup as (
      select
        sm.ref_line_id,
        sm.item_id,
        coalesce(sum(coalesce(sm.qty, sm.qty_base, 0)), 0) as qty,
        coalesce(sum(coalesce(sm.total_value, coalesce(sm.qty, sm.qty_base, 0) * coalesce(sm.unit_cost, 0))), 0) as line_total,
        min(sm.created_at) as first_received_at
      from public.stock_movements sm
      where sm.company_id = p_company_id
        and sm.ref_type = 'PO'
        and sm.type = 'receive'
        and sm.ref_id = p_purchase_order_id::text
        and (
          sm.ref_line_id is null
          or not exists (
            select 1
            from public.purchase_order_lines pol
            where pol.company_id = p_company_id
              and pol.po_id = p_purchase_order_id
              and pol.id = sm.ref_line_id
          )
        )
      group by sm.ref_line_id, sm.item_id
    )
    select
      coalesce(rr.ref_line_id::text, 'receipt:' || coalesce(rr.item_id::text, 'line') || ':' || row_number() over (order by rr.first_received_at, rr.item_id)::text) as source_key,
      null::uuid as purchase_order_line_id,
      rr.item_id,
      coalesce(
        nullif(btrim(it.name), ''),
        nullif(btrim(it.sku), ''),
        'Received purchase line'
      ) as description,
      round(rr.qty, 6) as qty,
      case
        when rr.qty > 0 then round(rr.line_total / rr.qty, 6)
        else round(rr.line_total, 6)
      end as unit_cost,
      null::numeric as tax_rate,
      0::numeric as tax_amount,
      round(rr.line_total, 2) as line_total,
      10000 + row_number() over (order by rr.first_received_at, rr.item_id)::integer as sort_order
    from receipt_rollup rr
    left join public.items it
      on it.company_id = p_company_id
     and it.id = rr.item_id
    where round(rr.qty, 6) > 0
      and round(rr.line_total, 2) > 0
      and (
        rr.ref_line_id is not null
        or not exists (select 1 from pg_temp.vendor_bill_draft_source_lines)
      );
  end if;

  select count(*)::integer
    into v_line_count
  from pg_temp.vendor_bill_draft_source_lines;

  if v_line_count = 0 then
    raise exception using
      message = 'The selected purchase order has no positive purchasable lines to bill.';
  end if;

  select
    round(coalesce(sum(line_total), 0), 2),
    round(coalesce(sum(tax_amount), 0), 2)
    into v_subtotal, v_tax_total
  from pg_temp.vendor_bill_draft_source_lines;

  if v_derive_lines then
    v_tax_total := round(coalesce(v_po.tax_total, 0), 2);

    if v_tax_total > 0 and v_subtotal <= 0 then
      raise exception using
        message = 'The selected purchase order has tax recorded but no positive subtotal to bill.';
    end if;

    if v_tax_total > 0 then
      with ordered as (
        select
          source_key,
          line_total,
          sort_order,
          row_number() over (order by sort_order, source_key) as rn,
          count(*) over () as ct
        from pg_temp.vendor_bill_draft_source_lines
      ),
      allocated as (
        select
          source_key,
          case
            when rn = ct then round(v_tax_total - coalesce(sum(round(line_total / nullif(v_subtotal, 0) * v_tax_total, 2)) over (order by sort_order, source_key rows between unbounded preceding and 1 preceding), 0), 2)
            else round(line_total / nullif(v_subtotal, 0) * v_tax_total, 2)
          end as allocated_tax
        from ordered
      )
      update pg_temp.vendor_bill_draft_source_lines src
         set tax_amount = allocated.allocated_tax,
             tax_rate = round((v_tax_total / nullif(v_subtotal, 0)) * 100, 4)
      from allocated
      where allocated.source_key = src.source_key;
    end if;
  end if;

  v_total_amount := round(v_subtotal + v_tax_total, 2);
  v_bill_date := coalesce(p_bill_date, p_supplier_invoice_date, current_date);
  v_due_date := coalesce(p_due_date, v_po.due_date, v_bill_date);
  if v_due_date < v_bill_date then
    v_due_date := v_bill_date;
  end if;

  v_currency_code := coalesce(nullif(btrim(coalesce(p_currency_code, '')), ''), v_po.currency_code::text, 'MZN');
  v_fx_to_base := coalesce(p_fx_to_base, v_po.fx_to_base, 1);
  if coalesce(v_fx_to_base, 0) <= 0 then
    v_fx_to_base := 1;
  end if;

  insert into public.vendor_bills (
    company_id,
    purchase_order_id,
    supplier_id,
    supplier_invoice_reference,
    supplier_invoice_date,
    bill_date,
    due_date,
    currency_code,
    fx_to_base,
    subtotal,
    tax_total,
    total_amount,
    document_workflow_status,
    approval_status,
    created_by
  ) values (
    p_company_id,
    p_purchase_order_id,
    v_po.supplier_id,
    nullif(btrim(coalesce(p_supplier_invoice_reference, '')), ''),
    p_supplier_invoice_date,
    v_bill_date,
    v_due_date,
    v_currency_code,
    v_fx_to_base,
    v_subtotal,
    v_tax_total,
    v_total_amount,
    'draft',
    'draft',
    auth.uid()
  )
  returning * into v_bill;

  insert into public.vendor_bill_lines (
    company_id,
    vendor_bill_id,
    purchase_order_line_id,
    item_id,
    description,
    qty,
    unit_cost,
    tax_rate,
    tax_amount,
    line_total,
    sort_order
  )
  select
    p_company_id,
    v_bill.id,
    purchase_order_line_id,
    item_id,
    description,
    qty,
    unit_cost,
    tax_rate,
    tax_amount,
    line_total,
    sort_order
  from pg_temp.vendor_bill_draft_source_lines
  order by sort_order, source_key;

  return v_bill;
end;
$$;


ALTER FUNCTION "public"."create_vendor_bill_draft_from_purchase_order"("p_company_id" "uuid", "p_purchase_order_id" "uuid", "p_supplier_invoice_reference" "text", "p_supplier_invoice_date" "date", "p_bill_date" "date", "p_due_date" "date", "p_currency_code" "text", "p_fx_to_base" numeric, "p_lines" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_company_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select uac.company_id
  from public.user_active_company uac
  join public.company_members cm
    on cm.company_id = uac.company_id
   and cm.user_id = uac.user_id
   and cm.status = 'active'::member_status
  where uac.user_id = auth.uid()
    and public.company_access_is_enabled(uac.company_id)
  order by uac.updated_at desc
  limit 1;
$$;


ALTER FUNCTION "public"."current_company_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_company_ids"() RETURNS "uuid"[]
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    SET "row_security" TO 'off'
    AS $$
  select coalesce(array_agg(cm.company_id), '{}')
  from public.company_members cm
  where cm.user_id = auth.uid()
    and cm.status = 'active'::member_status
    and public.company_access_is_enabled(cm.company_id);
$$;


ALTER FUNCTION "public"."current_user_company_ids"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_user_company_ids"() IS 'Returns array of company_ids the current auth user belongs to. SECURITY DEFINER, row_security off to avoid recursion.';



CREATE OR REPLACE FUNCTION "public"."customers_set_company_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.company_id is null then
    new.company_id := public.current_company_id();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."customers_set_company_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."debug_context"() RETURNS TABLE("uid" "uuid", "email" "text", "current_company" "uuid")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select
    auth.uid()                     as uid,
    coalesce(auth.email(), '')     as email,
    public.current_company_id()    as current_company
$$;


ALTER FUNCTION "public"."debug_context"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."debug_my_company"("p_company" "uuid") RETURNS TABLE("jwt_uid" "uuid", "jwt_email" "text", "cm_user_id" "uuid", "cm_email" "text", "cm_status" "public"."member_status", "cm_role" "public"."member_role", "match_kind" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with me as (
    select
      auth.uid() as jwt_uid,
      nullif(current_setting('request.jwt.claims', true)::jsonb->>'email','')::text as jwt_email
  ),
  by_uid as (
    select m.user_id, m.email, m.status, m.role, 'by_user_id'::text as match_kind
    from public.company_members m, me
    where m.company_id = p_company
      and m.user_id = me.jwt_uid
  ),
  by_email as (
    select m.user_id, m.email, m.status, m.role, 'by_email'::text as match_kind
    from public.company_members m, me
    where m.company_id = p_company
      and m.user_id is null
      and lower(m.email) = lower(coalesce(me.jwt_email,''))
  ),
  pick as (
    -- prefer user_id match; else fall back to pending invite by email
    select * from by_uid
    union all
    select * from by_email
    limit 1
  )
  select
    me.jwt_uid, me.jwt_email,
    p.user_id, p.email, p.status, p.role, p.match_kind
  from me
  left join pick p on true;
$$;


ALTER FUNCTION "public"."debug_my_company"("p_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."display_name_for_user"("p_user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select
    coalesce(
      (select p.name from public.profiles p where p.user_id = p_user_id and p.name is not null),
      (select u.raw_user_meta_data->>'name' from auth.users u where u.id = p_user_id and u.raw_user_meta_data ? 'name'),
      (select split_part(u.email, '@', 1) from auth.users u where u.id = p_user_id),
      'New member'
    )
$$;


ALTER FUNCTION "public"."display_name_for_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."emit_cash_approval_notif"("p_company_id" "uuid", "p_title" "text", "p_body" "text", "p_url" "text", "p_level" "text" DEFAULT 'warning'::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.company_id = p_company_id
      AND n.title = p_title
      AND COALESCE(n.url,'') = COALESCE(p_url,'')
      AND n.created_at >= now() - interval '10 minutes'
  ) THEN
    INSERT INTO public.notifications (id, company_id, user_id, level, title, body, url, created_at)
    VALUES (gen_random_uuid(), p_company_id, NULL, p_level, p_title, p_body, p_url, now());
  END IF;
END;
$$;


ALTER FUNCTION "public"."emit_cash_approval_notif"("p_company_id" "uuid", "p_title" "text", "p_body" "text", "p_url" "text", "p_level" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_same_family"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
declare
  f_from text;
  f_to   text;
begin
  select family into f_from from public.uoms where id = new.from_uom_id;
  select family into f_to   from public.uoms where id = new.to_uom_id;

  if f_from is null or f_to is null then
    raise exception 'UoM family missing for conversion (% -> %)', new.from_uom_id, new.to_uom_id;
  end if;

  if f_from <> f_to then
    raise exception 'Cannot convert across families: % -> % (% vs %)', new.from_uom_id, new.to_uom_id, f_from, f_to;
  end if;

  return new;
end $$;


ALTER FUNCTION "public"."enforce_same_family"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_due_reminder"("p_company_id" "uuid", "p_local_day" "date", "p_timezone" "text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.due_reminder_queue (
    company_id,
    run_for_local_date,
    timezone,
    payload,
    status,
    created_at
  ) VALUES (
    p_company_id,
    p_local_day,
    p_timezone,
    p_payload,
    'pending',
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;


ALTER FUNCTION "public"."enqueue_due_reminder"("p_company_id" "uuid", "p_local_day" "date", "p_timezone" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_due_reminder_for_company"("p_company_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_hours int[]; v_tz text; v_today date; v_payload jsonb; v_job_id bigint;
BEGIN
  SELECT COALESCE(settings->>'timezone','Africa/Maputo'),
         COALESCE((settings->'reminders'->'hours')::int[], ARRAY[9])
  INTO v_tz, v_hours
  FROM public.company_settings
  WHERE company_id = p_company_id;

  v_today := CURRENT_DATE;
  v_payload := jsonb_build_object(
    'channels', jsonb_build_object('email', true),
    'lead_days', jsonb_build_array(3,1,0,-3)
  );

  SELECT public.enqueue_due_reminder(p_company_id, v_today, COALESCE(v_tz,'Africa/Maputo'), v_payload) INTO v_job_id;
  RETURN v_job_id;
END$$;


ALTER FUNCTION "public"."enqueue_due_reminder_for_company"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_due_reminder_for_company"("p_company_id" "uuid", "p_local_day" "date") RETURNS bigint
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  SELECT public.enqueue_due_reminder_for_company(p_company_id, p_local_day, false);
$$;


ALTER FUNCTION "public"."enqueue_due_reminder_for_company"("p_company_id" "uuid", "p_local_day" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_due_reminder_for_company"("p_company_id" "uuid", "p_local_day" "date", "p_force" boolean DEFAULT false) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_company record;
  v_settings jsonb := '{}'::jsonb;
  v_due_cfg jsonb := '{}'::jsonb;
  v_timezone text := 'Africa/Maputo';
  v_local_now timestamp without time zone;
  v_run_day date;
  v_send_at time;
  v_send_window_start timestamp without time zone;
  v_send_window_end timestamp without time zone;
  v_lead_days int[];
  v_lang text := 'en';
  v_payload jsonb;
  v_bcc jsonb := '[]'::jsonb;
  v_existing_id bigint;
  v_job_id bigint := 0;
  v_document_base_url text;
BEGIN
  SELECT
    c.id,
    c.preferred_lang,
    cs.data
  INTO v_company
  FROM public.companies c
  LEFT JOIN public.company_settings cs
    ON cs.company_id = c.id
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_settings := COALESCE(v_company.data, '{}'::jsonb);
  v_due_cfg := COALESCE(v_settings->'dueReminders', '{}'::jsonb);

  IF NOT p_force AND COALESCE(NULLIF(v_due_cfg->>'enabled', '')::boolean, true) = false THEN
    RETURN 0;
  END IF;

  v_timezone := COALESCE(
    NULLIF(v_due_cfg->>'timezone', ''),
    NULLIF(v_settings->'notifications'->>'timezone', ''),
    'Africa/Maputo'
  );
  v_local_now := timezone(v_timezone, now());
  v_run_day := COALESCE(
    CASE WHEN p_force THEN p_local_day ELSE NULL END,
    v_local_now::date
  );
  v_send_at := public.parse_due_reminder_send_at(v_settings);
  v_lead_days := public.parse_due_reminder_lead_days(v_settings);

  IF COALESCE(array_length(v_lead_days, 1), 0) = 0 THEN
    v_lead_days := ARRAY[3, 1, 0, -3];
  END IF;

  v_lang := lower(COALESCE(
    NULLIF(v_company.preferred_lang, ''),
    NULLIF(v_settings->'locale'->>'language', ''),
    'en'
  ));
  IF v_lang NOT IN ('en', 'pt') THEN
    v_lang := 'en';
  END IF;

  IF jsonb_typeof(v_due_cfg->'bcc') = 'array' THEN
    v_bcc := v_due_cfg->'bcc';
  END IF;

  IF NOT p_force THEN
    v_send_window_start := v_local_now::date + v_send_at;
    v_send_window_end := v_send_window_start + interval '2 minutes';

    IF v_local_now < v_send_window_start OR v_local_now >= v_send_window_end THEN
      RETURN 0;
    END IF;
  END IF;

  IF p_force THEN
    DELETE FROM public.due_reminder_queue
    WHERE company_id = p_company_id
      AND run_for_local_date = v_run_day;
  ELSE
    SELECT id
    INTO v_existing_id
    FROM public.due_reminder_queue
    WHERE company_id = p_company_id
      AND run_for_local_date = v_run_day
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN 0;
    END IF;
  END IF;

  v_payload := jsonb_build_object(
    'channels', jsonb_build_object('email', true),
    'lead_days', to_jsonb(v_lead_days),
    'bcc', v_bcc,
    'lang', v_lang
  );

  v_document_base_url := COALESCE(
    NULLIF(v_due_cfg->>'documentBaseUrl', ''),
    NULLIF(v_due_cfg->>'invoiceBaseUrl', '')
  );

  IF v_document_base_url IS NOT NULL THEN
    v_payload := v_payload
      || jsonb_build_object('document_base_url', v_document_base_url)
      || jsonb_build_object('invoice_base_url', v_document_base_url);
  END IF;

  v_job_id := public.enqueue_due_reminder(
    p_company_id,
    v_run_day,
    v_timezone,
    v_payload
  );

  RETURN COALESCE(v_job_id, 0);
END;
$$;


ALTER FUNCTION "public"."enqueue_due_reminder_for_company"("p_company_id" "uuid", "p_local_day" "date", "p_force" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_due_reminders_for_all_companies"("p_local_day" "date" DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  SELECT public.enqueue_due_reminders_for_all_companies(p_local_day, false);
$$;


ALTER FUNCTION "public"."enqueue_due_reminders_for_all_companies"("p_local_day" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_due_reminders_for_all_companies"("p_local_day" "date") IS 'Enqueue due_reminder_queue jobs for all companies for the given local day, reading company_settings.data->dueReminders. Skips duplicates via anti-join.';



CREATE OR REPLACE FUNCTION "public"."enqueue_due_reminders_for_all_companies"("p_local_day" "date", "p_force" boolean DEFAULT false) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_company record;
  v_job_id bigint;
  v_count integer := 0;
BEGIN
  FOR v_company IN
    SELECT id
    FROM public.companies
  LOOP
    v_job_id := public.enqueue_due_reminder_for_company(v_company.id, p_local_day, p_force);
    IF COALESCE(v_job_id, 0) > 0 THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."enqueue_due_reminders_for_all_companies"("p_local_day" "date", "p_force" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_cash_customer"("p_company_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id uuid;
begin
  -- try existing
  select c.id
    into v_id
    from public.customers c
   where c.company_id = p_company_id
     and c.is_cash is true
   limit 1;

  -- create if missing
  if v_id is null then
    insert into public.customers (company_id, name, is_cash)
    values (p_company_id, 'Walk-in (Cash)', true)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."ensure_cash_customer"("p_company_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_fiscal_settings" (
    "company_id" "uuid" NOT NULL,
    "jurisdiction_code" "text" DEFAULT 'MZ'::"text" NOT NULL,
    "invoice_series_code" "text" NOT NULL,
    "credit_note_series_code" "text" NOT NULL,
    "debit_note_series_code" "text" NOT NULL,
    "computer_processed_phrase_text" "text" NOT NULL,
    "document_language_code" "text" DEFAULT 'pt-MZ'::"text" NOT NULL,
    "presentation_currency_code" "text" DEFAULT 'MZN'::"text" NOT NULL,
    "saft_moz_enabled" boolean DEFAULT true NOT NULL,
    "archive_retention_years" integer DEFAULT 5 NOT NULL,
    "compliance_rule_version" "text" NOT NULL,
    "homologation_reference" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "company_fiscal_settings_archive_retention_years_check" CHECK (("archive_retention_years" >= 5)),
    CONSTRAINT "company_fiscal_settings_credit_note_series_code_check" CHECK (("credit_note_series_code" ~ '^[A-Z0-9]{2,10}$'::"text")),
    CONSTRAINT "company_fiscal_settings_debit_note_series_code_check" CHECK (("debit_note_series_code" ~ '^[A-Z0-9]{2,10}$'::"text")),
    CONSTRAINT "company_fiscal_settings_invoice_series_code_check" CHECK (("invoice_series_code" ~ '^[A-Z0-9]{2,10}$'::"text"))
);


ALTER TABLE "public"."company_fiscal_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."company_fiscal_settings" IS 'Mozambique fiscal-compliance settings per company, including document language, phrase, series defaults, and archive retention policy.';



CREATE OR REPLACE FUNCTION "public"."ensure_mz_company_fiscal_configuration"("p_company_id" "uuid", "p_document_date" "date" DEFAULT NULL::"date") RETURNS "public"."company_fiscal_settings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_company public.companies%rowtype;
  v_settings public.company_fiscal_settings%rowtype;
  v_base_currency_code text;
  v_document_date date := coalesce(p_document_date, current_date);
  v_fiscal_year integer;
begin
  if p_company_id is null then
    raise exception 'finance_document_company_required';
  end if;

  if not public.finance_documents_can_write(p_company_id) then
    raise exception 'finance_document_company_write_denied';
  end if;

  select c.*
    into v_company
  from public.companies c
  where c.id = p_company_id;

  if v_company.id is null then
    raise exception 'finance_document_company_missing';
  end if;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = p_company_id
    and cfs.jurisdiction_code = 'MZ';

  if v_settings.company_id is null then
    select nullif(btrim(coalesce(cs.base_currency_code::text, '')), '')
      into v_base_currency_code
    from public.company_settings cs
    where cs.company_id = p_company_id;

    insert into public.company_fiscal_settings (
      company_id,
      jurisdiction_code,
      invoice_series_code,
      credit_note_series_code,
      debit_note_series_code,
      computer_processed_phrase_text,
      document_language_code,
      presentation_currency_code,
      saft_moz_enabled,
      archive_retention_years,
      compliance_rule_version,
      homologation_reference
    )
    values (
      p_company_id,
      'MZ',
      'INV',
      'NC',
      'ND',
      'PROCESSADO POR COMPUTADOR',
      'pt-MZ',
      coalesce(v_base_currency_code, 'MZN'),
      true,
      5,
      'MZ-WAVE1-2026-03-29',
      null
    )
    on conflict (company_id) do nothing;

    select cfs.*
      into v_settings
    from public.company_fiscal_settings cfs
    where cfs.company_id = p_company_id
      and cfs.jurisdiction_code = 'MZ';
  end if;

  if v_settings.company_id is null then
    raise exception 'company_fiscal_settings_missing';
  end if;

  v_fiscal_year := extract(year from v_document_date)::integer;

  insert into public.finance_document_fiscal_series (
    company_id,
    document_type,
    series_code,
    fiscal_year,
    next_number,
    is_active,
    valid_from,
    valid_to
  )
  values
    (p_company_id, 'sales_invoice', v_settings.invoice_series_code, v_fiscal_year, 1, true, make_date(v_fiscal_year, 1, 1), null),
    (p_company_id, 'sales_credit_note', v_settings.credit_note_series_code, v_fiscal_year, 1, true, make_date(v_fiscal_year, 1, 1), null),
    (p_company_id, 'sales_debit_note', v_settings.debit_note_series_code, v_fiscal_year, 1, true, make_date(v_fiscal_year, 1, 1), null)
  on conflict (company_id, document_type, series_code, fiscal_year) do nothing;

  return v_settings;
end;
$$;


ALTER FUNCTION "public"."ensure_mz_company_fiscal_configuration"("p_company_id" "uuid", "p_document_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ensure_mz_company_fiscal_configuration"("p_company_id" "uuid", "p_document_date" "date") IS 'Bootstraps the minimum Mozambique fiscal settings and current-year series required for native finance-document draft references.';



CREATE OR REPLACE FUNCTION "public"."ensure_stock_row"("p_item_id" "uuid", "p_warehouse_id" "uuid", "p_bin_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Try fast path
  if exists (
    select 1
    from public.stock_levels sl
    where sl.item_id = p_item_id
      and sl.warehouse_id = p_warehouse_id
      and sl.bin_id = p_bin_id
  ) then
    return;
  end if;

  -- Insert a zero row (tolerate race with ON CONFLICT)
  insert into public.stock_levels (item_id, warehouse_id, bin_id, qty, avg_cost)
  values (p_item_id, p_warehouse_id, p_bin_id, 0, 0)
  on conflict (item_id, warehouse_id, bin_id) do nothing;
end;
$$;


ALTER FUNCTION "public"."ensure_stock_row"("p_item_id" "uuid", "p_warehouse_id" "uuid", "p_bin_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_saft_moz_export_run"("p_export_id" "uuid", "p_error_message" "text") RETURNS "public"."saft_moz_exports"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_export public.saft_moz_exports;
begin
  select sme.*
    into v_export
  from public.saft_moz_exports sme
  where sme.id = p_export_id;

  if v_export.id is null then
    raise exception using
      message = 'SAF-T export run not found.';
  end if;

  if not public.finance_documents_can_write(v_export.company_id) then
    raise exception using
      message = 'SAF-T export failure update access denied.';
  end if;

  if v_export.status <> 'pending' then
    raise exception using
      message = format('SAF-T export can only transition from pending to failed, not %s.', coalesce(v_export.status, '<null>'));
  end if;

  update public.saft_moz_exports sme
     set status = 'failed',
         error_message = nullif(btrim(coalesce(p_error_message, '')), '')
   where sme.id = p_export_id
  returning sme.* into v_export;

  perform public.append_finance_document_event(
    v_export.company_id,
    'saft_moz_export',
    v_export.id,
    'saft_export_failed',
    null,
    v_export.status,
    jsonb_build_object(
      'error_message', v_export.error_message
    )
  );

  return v_export;
end;
$$;


ALTER FUNCTION "public"."fail_saft_moz_export_run"("p_export_id" "uuid", "p_error_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_cash_sale_so_with_cogs"("p_item_id" "uuid", "p_qty" numeric, "p_qty_base" numeric, "p_uom_id" "uuid", "p_unit_price" numeric, "p_customer_id" "uuid", "p_currency_code" "text", "p_fx_to_base" numeric, "p_status" "text", "p_bin_id" "uuid", "p_cogs_unit_cost" numeric, "p_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_so_id uuid;
  v_wh_id uuid;
BEGIN
  -- … your existing logic …

  -- when you insert the stock movement, pass p_notes
  INSERT INTO public.stock_movements (
    type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_from_id, bin_from_id, created_by,
    ref_type, ref_id, ref_line_id, notes
  )
  VALUES (
    'issue', p_item_id, p_uom_id, p_qty, p_qty_base, p_cogs_unit_cost,
    p_cogs_unit_cost * p_qty_base,
    v_wh_id, p_bin_id, 'so_ship',
    'SO', v_so_id, NULL, NULLIF(TRIM(p_notes), '')
  );

  -- (optional) annotate the SO as well
  UPDATE public.sales_orders
  SET notes = COALESCE(NULLIF(TRIM(p_notes), ''), notes)
  WHERE id = v_so_id;

  -- rest of your function…
  RETURN v_so_id;
END;
$$;


ALTER FUNCTION "public"."finalize_cash_sale_so_with_cogs"("p_item_id" "uuid", "p_qty" numeric, "p_qty_base" numeric, "p_uom_id" "uuid", "p_unit_price" numeric, "p_customer_id" "uuid", "p_currency_code" "text", "p_fx_to_base" numeric, "p_status" "text", "p_bin_id" "uuid", "p_cogs_unit_cost" numeric, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_saft_moz_export_run"("p_export_id" "uuid", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_sha256" "text", "p_size_bytes" bigint, "p_source_document_count" integer, "p_source_total_mzn" numeric) RETURNS "public"."saft_moz_exports"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_export public.saft_moz_exports;
begin
  select sme.*
    into v_export
  from public.saft_moz_exports sme
  where sme.id = p_export_id;

  if v_export.id is null then
    raise exception using
      message = 'SAF-T export run not found.';
  end if;

  if not public.finance_documents_can_write(v_export.company_id) then
    raise exception using
      message = 'SAF-T export finalize access denied.';
  end if;

  if v_export.status <> 'pending' then
    raise exception using
      message = format('SAF-T export can only transition from pending to generated, not %s.', coalesce(v_export.status, '<null>'));
  end if;

  update public.saft_moz_exports sme
     set status = 'generated',
         generated_by = auth.uid(),
         generated_at = now(),
         storage_bucket = p_storage_bucket,
         storage_path = p_storage_path,
         file_name = p_file_name,
         mime_type = p_mime_type,
         file_sha256 = p_file_sha256,
         size_bytes = p_size_bytes,
         source_document_count = greatest(coalesce(p_source_document_count, 0), 0),
         source_total_mzn = greatest(coalesce(p_source_total_mzn, 0), 0),
         error_message = null
   where sme.id = p_export_id
  returning sme.* into v_export;

  perform public.append_finance_document_event(
    v_export.company_id,
    'saft_moz_export',
    v_export.id,
    'saft_export_generated',
    null,
    v_export.status,
    jsonb_build_object(
      'storage_bucket', v_export.storage_bucket,
      'storage_path', v_export.storage_path,
      'file_name', v_export.file_name,
      'source_document_count', v_export.source_document_count,
      'source_total_mzn', v_export.source_total_mzn
    )
  );

  return v_export;
end;
$$;


ALTER FUNCTION "public"."finalize_saft_moz_export_run"("p_export_id" "uuid", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_sha256" "text", "p_size_bytes" bigint, "p_source_document_count" integer, "p_source_total_mzn" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_document_adjustment_line_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_company_id uuid;
  v_parent_id uuid;
  v_workflow_status text;
  v_label text;
  v_can_adjust boolean;
begin
  case tg_table_name
    when 'sales_credit_note_lines' then
      if tg_op = 'INSERT' then
        v_parent_id := new.sales_credit_note_id;
      elsif tg_op = 'UPDATE' then
        v_parent_id := coalesce(new.sales_credit_note_id, old.sales_credit_note_id);
      else
        v_parent_id := old.sales_credit_note_id;
      end if;

      select scn.company_id, scn.document_workflow_status, 'Sales credit note'
        into v_company_id, v_workflow_status, v_label
      from public.sales_credit_notes scn
      where scn.id = v_parent_id;
      v_can_adjust := public.finance_documents_can_issue_adjustment(v_company_id);
    when 'sales_debit_note_lines' then
      if tg_op = 'INSERT' then
        v_parent_id := new.sales_debit_note_id;
      elsif tg_op = 'UPDATE' then
        v_parent_id := coalesce(new.sales_debit_note_id, old.sales_debit_note_id);
      else
        v_parent_id := old.sales_debit_note_id;
      end if;

      select sdn.company_id, sdn.document_workflow_status, 'Sales debit note'
        into v_company_id, v_workflow_status, v_label
      from public.sales_debit_notes sdn
      where sdn.id = v_parent_id;
      v_can_adjust := public.finance_documents_can_issue_adjustment(v_company_id);
    when 'vendor_credit_note_lines' then
      if tg_op = 'INSERT' then
        v_parent_id := new.vendor_credit_note_id;
      elsif tg_op = 'UPDATE' then
        v_parent_id := coalesce(new.vendor_credit_note_id, old.vendor_credit_note_id);
      else
        v_parent_id := old.vendor_credit_note_id;
      end if;

      select vcn.company_id, vcn.document_workflow_status, 'Supplier credit note'
        into v_company_id, v_workflow_status, v_label
      from public.vendor_credit_notes vcn
      where vcn.id = v_parent_id;
      v_can_adjust := public.finance_documents_can_post_adjustment(v_company_id);
    when 'vendor_debit_note_lines' then
      if tg_op = 'INSERT' then
        v_parent_id := new.vendor_debit_note_id;
      elsif tg_op = 'UPDATE' then
        v_parent_id := coalesce(new.vendor_debit_note_id, old.vendor_debit_note_id);
      else
        v_parent_id := old.vendor_debit_note_id;
      end if;

      select vdn.company_id, vdn.document_workflow_status, 'Supplier debit note'
        into v_company_id, v_workflow_status, v_label
      from public.vendor_debit_notes vdn
      where vdn.id = v_parent_id;
      v_can_adjust := public.finance_documents_can_post_adjustment(v_company_id);
    else
      raise exception using
        message = format('finance_document_adjustment_line_guard does not support table %s.', tg_table_name);
  end case;

  if v_company_id is null then
    raise exception using
      message = format('%s lines require a parent draft document.', v_label);
  end if;

  if public.finance_documents_internal_transition_bypass() then
    if tg_op <> 'DELETE' then
      new.company_id := coalesce(new.company_id, v_company_id);
      if new.company_id is distinct from v_company_id then
        raise exception using
          message = format('%s line company must match the parent document company.', v_label);
      end if;
      return new;
    end if;

    return old;
  end if;

  if not coalesce(v_can_adjust, false) then
    raise exception using
      message = format('%s line access denied.', v_label);
  end if;

  if v_workflow_status <> 'draft' then
    raise exception using
      message = format('%s lines can only be changed while the parent note is still a draft.', v_label);
  end if;

  if tg_op <> 'DELETE' then
    new.company_id := coalesce(new.company_id, v_company_id);
    if new.company_id is distinct from v_company_id then
      raise exception using
        message = format('%s line company must match the parent document company.', v_label);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."finance_document_adjustment_line_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_document_base_line_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_company_id uuid;
  v_parent_id uuid;
  v_workflow_status text;
  v_approval_status text;
  v_label text;
begin
  case tg_table_name
    when 'sales_invoice_lines' then
      if tg_op = 'INSERT' then
        v_parent_id := new.sales_invoice_id;
      elsif tg_op = 'UPDATE' then
        v_parent_id := coalesce(new.sales_invoice_id, old.sales_invoice_id);
      else
        v_parent_id := old.sales_invoice_id;
      end if;

      select si.company_id, si.document_workflow_status, coalesce(si.approval_status, 'draft'), 'Sales invoice'
        into v_company_id, v_workflow_status, v_approval_status, v_label
      from public.sales_invoices si
      where si.id = v_parent_id;
    when 'vendor_bill_lines' then
      if tg_op = 'INSERT' then
        v_parent_id := new.vendor_bill_id;
      elsif tg_op = 'UPDATE' then
        v_parent_id := coalesce(new.vendor_bill_id, old.vendor_bill_id);
      else
        v_parent_id := old.vendor_bill_id;
      end if;

      select vb.company_id, vb.document_workflow_status, coalesce(vb.approval_status, 'draft'), 'Vendor bill'
        into v_company_id, v_workflow_status, v_approval_status, v_label
      from public.vendor_bills vb
      where vb.id = v_parent_id;
    else
      raise exception using
        message = format('finance_document_base_line_guard does not support table %s.', tg_table_name);
  end case;

  if v_company_id is null then
    raise exception using
      message = format('%s lines require a parent draft document.', v_label);
  end if;

  if public.finance_documents_internal_transition_bypass() then
    if tg_op <> 'DELETE' then
      new.company_id := coalesce(new.company_id, v_company_id);
      if new.company_id is distinct from v_company_id then
        raise exception using
          message = format('%s line company must match the parent document company.', v_label);
      end if;
      return new;
    end if;

    return old;
  end if;

  if not public.finance_documents_can_prepare_draft(v_company_id) then
    raise exception using
      message = format('%s draft line access denied.', v_label);
  end if;

  if v_workflow_status <> 'draft' then
    raise exception using
      message = format('%s lines can only be changed while the parent document is still a draft.', v_label);
  end if;

  if v_approval_status <> 'draft' then
    raise exception using
      message = format('%s lines are locked once the parent document is pending approval or approved.', v_label);
  end if;

  if tg_op <> 'DELETE' then
    new.company_id := coalesce(new.company_id, v_company_id);
    if new.company_id is distinct from v_company_id then
      raise exception using
        message = format('%s line company must match the parent document company.', v_label);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."finance_document_base_line_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_document_company_prefix"("p_company_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $_$
declare
  v_prefix text;
  v_name text;
begin
  if p_company_id is null then
    return 'CMP';
  end if;

  if not public.finance_documents_can_read(p_company_id) then
    raise exception 'finance_document_company_access_denied';
  end if;

  if to_regprocedure('public.company_prefix3(uuid)') is not null then
    begin
      execute 'select public.company_prefix3($1)' into v_prefix using p_company_id;
    exception when others then
      v_prefix := null;
    end;
  end if;

  if v_prefix is null or btrim(v_prefix) = '' then
    select c.name
      into v_name
    from public.companies c
    where c.id = p_company_id;

    v_prefix := upper(substr(regexp_replace(coalesce(v_name, ''), '[^A-Za-z0-9]', '', 'g'), 1, 3));
  end if;

  v_prefix := upper(coalesce(nullif(btrim(v_prefix), ''), 'CMP'));
  if length(v_prefix) < 3 then
    v_prefix := rpad(v_prefix, 3, 'X');
  end if;

  return substr(v_prefix, 1, 3);
end;
$_$;


ALTER FUNCTION "public"."finance_document_company_prefix"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_document_company_settings_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_old_due jsonb := case when tg_op = 'UPDATE' then coalesce(old.data -> 'dueReminders', 'null'::jsonb) else 'null'::jsonb end;
  v_new_due jsonb := coalesce(new.data -> 'dueReminders', 'null'::jsonb);
  v_default_due jsonb := coalesce(public.company_settings_defaults() -> 'dueReminders', 'null'::jsonb);
begin
  if tg_op = 'UPDATE' then
    if v_new_due is distinct from v_old_due
       and not public.finance_documents_can_manage_due_reminders(new.company_id) then
      raise exception using
        message = 'Due reminder settings require finance authority.';
    end if;
  elsif tg_op = 'INSERT' then
    if v_new_due is distinct from v_default_due
       and not public.finance_documents_can_manage_due_reminders(new.company_id) then
      raise exception using
        message = 'Due reminder settings require finance authority.';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."finance_document_company_settings_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_document_header_event_journal"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_document_kind text;
  v_event_type text;
  v_from_status text;
  v_to_status text;
  v_payload jsonb;
  v_new_json jsonb;
  v_old_json jsonb;
  v_comparable_new jsonb;
  v_comparable_old jsonb;
begin
  v_document_kind := case tg_table_name
    when 'sales_invoices' then 'sales_invoice'
    when 'sales_credit_notes' then 'sales_credit_note'
    when 'sales_debit_notes' then 'sales_debit_note'
    when 'vendor_bills' then 'vendor_bill'
    when 'vendor_credit_notes' then 'vendor_credit_note'
    when 'vendor_debit_notes' then 'vendor_debit_note'
    else null
  end;

  if v_document_kind is null then
    raise exception using
      message = format('finance_document_header_event_journal does not support table %s.', tg_table_name);
  end if;

  v_new_json := to_jsonb(new);
  v_old_json := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;

  if tg_op = 'INSERT' then
    v_event_type := 'draft_created';
    v_from_status := null;
    v_to_status := nullif(v_new_json ->> 'document_workflow_status', '');
  elsif tg_op = 'UPDATE' then
    if (v_new_json ? 'approval_status')
       and coalesce(v_new_json ->> 'approval_status', '') is distinct from coalesce(v_old_json ->> 'approval_status', '') then
      v_from_status := nullif(v_old_json ->> 'approval_status', '');
      v_to_status := nullif(v_new_json ->> 'approval_status', '');
      v_event_type := case
        when v_to_status = 'pending_approval' then 'approval_requested'
        when v_to_status = 'approved' then 'approved'
        when v_to_status = 'draft' and coalesce(v_from_status, '') in ('pending_approval', 'approved') then 'returned_to_draft'
        else 'approval_status_changed'
      end;
    elsif coalesce(v_new_json ->> 'document_workflow_status', '') is distinct from coalesce(v_old_json ->> 'document_workflow_status', '') then
      v_from_status := nullif(v_old_json ->> 'document_workflow_status', '');
      v_to_status := nullif(v_new_json ->> 'document_workflow_status', '');
      v_event_type := case v_to_status
        when 'issued' then 'issued'
        when 'posted' then 'posted'
        when 'voided' then 'voided'
        else 'status_changed'
      end;
    else
      if coalesce(v_new_json ->> 'document_workflow_status', 'draft') <> 'draft' then
        return null;
      end if;

      v_comparable_new := v_new_json - array[
        'updated_at',
        'document_workflow_status',
        'issued_at',
        'issued_by',
        'posted_at',
        'posted_by',
        'voided_at',
        'voided_by',
        'void_reason',
        'approval_status',
        'approval_requested_at',
        'approval_requested_by',
        'approved_at',
        'approved_by',
        'supplier_invoice_reference_normalized',
        'supplier_document_reference_normalized'
      ];
      v_comparable_old := v_old_json - array[
        'updated_at',
        'document_workflow_status',
        'issued_at',
        'issued_by',
        'posted_at',
        'posted_by',
        'voided_at',
        'voided_by',
        'void_reason',
        'approval_status',
        'approval_requested_at',
        'approval_requested_by',
        'approved_at',
        'approved_by',
        'supplier_invoice_reference_normalized',
        'supplier_document_reference_normalized'
      ];

      if v_comparable_new = v_comparable_old then
        return null;
      end if;

      v_event_type := 'draft_edited';
      v_from_status := nullif(v_old_json ->> 'document_workflow_status', '');
      v_to_status := nullif(v_new_json ->> 'document_workflow_status', '');
    end if;
  else
    return null;
  end if;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'internal_reference', nullif(v_new_json ->> 'internal_reference', ''),
    'primary_reference', coalesce(
      nullif(v_new_json ->> 'supplier_invoice_reference', ''),
      nullif(v_new_json ->> 'supplier_document_reference', ''),
      nullif(v_new_json ->> 'internal_reference', '')
    ),
    'source_origin', nullif(v_new_json ->> 'source_origin', ''),
    'document_status', nullif(v_new_json ->> 'document_workflow_status', ''),
    'approval_status', nullif(v_new_json ->> 'approval_status', ''),
    'sales_order_id', nullif(v_new_json ->> 'sales_order_id', ''),
    'purchase_order_id', nullif(v_new_json ->> 'purchase_order_id', ''),
    'original_sales_invoice_id', nullif(v_new_json ->> 'original_sales_invoice_id', ''),
    'original_vendor_bill_id', nullif(v_new_json ->> 'original_vendor_bill_id', ''),
    'correction_reason_code', nullif(v_new_json ->> 'correction_reason_code', ''),
    'correction_reason_text', nullif(v_new_json ->> 'correction_reason_text', ''),
    'adjustment_reason_code', nullif(v_new_json ->> 'adjustment_reason_code', ''),
    'adjustment_reason_text', nullif(v_new_json ->> 'adjustment_reason_text', '')
  ));

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


ALTER FUNCTION "public"."finance_document_header_event_journal"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finance_document_header_event_journal"() IS 'Captures draft, approval, issue/post, void, and draft-edit lifecycle events for finance documents.';



CREATE OR REPLACE FUNCTION "public"."finance_document_line_company_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_parent_company_id uuid;
begin
  if tg_table_name = 'sales_invoice_lines' then
    select si.company_id into v_parent_company_id
    from public.sales_invoices si
    where si.id = new.sales_invoice_id;
  elsif tg_table_name = 'vendor_bill_lines' then
    select vb.company_id into v_parent_company_id
    from public.vendor_bills vb
    where vb.id = new.vendor_bill_id;
  end if;

  if v_parent_company_id is null then
    raise exception 'finance_document_parent_not_found';
  end if;

  new.company_id := v_parent_company_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."finance_document_line_company_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_document_parent_adjustment_event_journal"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_child_kind text;
  v_parent_kind text;
  v_parent_id uuid;
  v_event_type text;
  v_new_json jsonb;
  v_old_json jsonb;
  v_payload jsonb;
  v_reference text;
begin
  v_child_kind := case tg_table_name
    when 'sales_credit_notes' then 'sales_credit_note'
    when 'sales_debit_notes' then 'sales_debit_note'
    when 'vendor_credit_notes' then 'vendor_credit_note'
    when 'vendor_debit_notes' then 'vendor_debit_note'
    else null
  end;

  if v_child_kind is null then
    raise exception using
      message = format('finance_document_parent_adjustment_event_journal does not support table %s.', tg_table_name);
  end if;

  v_new_json := to_jsonb(new);
  v_old_json := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;

  if v_child_kind in ('sales_credit_note', 'sales_debit_note') then
    v_parent_kind := 'sales_invoice';
    v_parent_id := new.original_sales_invoice_id;
  else
    v_parent_kind := 'vendor_bill';
    v_parent_id := new.original_vendor_bill_id;
  end if;

  if v_parent_id is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_event_type := case v_child_kind
      when 'sales_credit_note' then 'related_sales_credit_note_created'
      when 'sales_debit_note' then 'related_sales_debit_note_created'
      when 'vendor_credit_note' then 'related_vendor_credit_note_created'
      when 'vendor_debit_note' then 'related_vendor_debit_note_created'
      else null
    end;
  elsif tg_op = 'UPDATE'
        and coalesce(v_new_json ->> 'document_workflow_status', '') is distinct from coalesce(v_old_json ->> 'document_workflow_status', '') then
    v_event_type := case
      when v_child_kind = 'sales_credit_note' and v_new_json ->> 'document_workflow_status' = 'issued' then 'related_sales_credit_note_issued'
      when v_child_kind = 'sales_debit_note' and v_new_json ->> 'document_workflow_status' = 'issued' then 'related_sales_debit_note_issued'
      when v_child_kind = 'vendor_credit_note' and v_new_json ->> 'document_workflow_status' = 'posted' then 'related_vendor_credit_note_posted'
      when v_child_kind = 'vendor_debit_note' and v_new_json ->> 'document_workflow_status' = 'posted' then 'related_vendor_debit_note_posted'
      else null
    end;
  else
    return null;
  end if;

  if v_event_type is null then
    return null;
  end if;

  v_reference := coalesce(
    nullif(v_new_json ->> 'supplier_document_reference', ''),
    nullif(v_new_json ->> 'internal_reference', '')
  );

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'related_document_kind', v_child_kind,
    'related_document_id', new.id,
    'related_reference', v_reference,
    'related_document_status', nullif(v_new_json ->> 'document_workflow_status', ''),
    'reason_code', coalesce(
      nullif(v_new_json ->> 'correction_reason_code', ''),
      nullif(v_new_json ->> 'adjustment_reason_code', '')
    ),
    'reason_text', coalesce(
      nullif(v_new_json ->> 'correction_reason_text', ''),
      nullif(v_new_json ->> 'adjustment_reason_text', '')
    )
  ));

  perform public.append_finance_document_event(
    new.company_id,
    v_parent_kind,
    v_parent_id,
    v_event_type,
    null,
    null,
    v_payload
  );

  return null;
end;
$$;


ALTER FUNCTION "public"."finance_document_parent_adjustment_event_journal"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finance_document_parent_adjustment_event_journal"() IS 'Projects related sales/vendor adjustment note creation and posting events onto the parent invoice or vendor bill timeline.';



CREATE OR REPLACE FUNCTION "public"."finance_document_settlement_event_journal"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_company_id uuid;
  v_document_kind text;
  v_event_type text;
  v_amount_abs numeric;
  v_payload jsonb;
  v_bank_account_name text;
  v_bank_name text;
begin
  if tg_table_name = 'cash_transactions' then
    v_company_id := new.company_id;
    v_document_kind := case new.ref_type
      when 'SI' then 'sales_invoice'
      when 'VB' then 'vendor_bill'
      else null
    end;
    v_event_type := case new.ref_type
      when 'SI' then 'cash_receipt_recorded'
      when 'VB' then 'cash_payment_recorded'
      else null
    end;
    v_amount_abs := abs(coalesce(new.amount_base, 0));
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'transaction_id', new.id,
      'channel', 'cash',
      'happened_at', new.happened_at,
      'memo', nullif(new.memo, ''),
      'amount_base', v_amount_abs,
      'signed_amount_base', new.amount_base,
      'user_ref', nullif(new.user_ref, '')
    ));
  elsif tg_table_name = 'bank_transactions' then
    select ba.company_id, nullif(ba.name, ''), nullif(ba.bank_name, '')
      into v_company_id, v_bank_account_name, v_bank_name
    from public.bank_accounts ba
    where ba.id = new.bank_id;

    v_document_kind := case new.ref_type
      when 'SI' then 'sales_invoice'
      when 'VB' then 'vendor_bill'
      else null
    end;
    v_event_type := case new.ref_type
      when 'SI' then 'bank_receipt_recorded'
      when 'VB' then 'bank_payment_recorded'
      else null
    end;
    v_amount_abs := abs(coalesce(new.amount_base, 0));
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'transaction_id', new.id,
      'channel', 'bank',
      'happened_at', new.happened_at,
      'memo', nullif(new.memo, ''),
      'amount_base', v_amount_abs,
      'signed_amount_base', new.amount_base,
      'bank_id', new.bank_id,
      'bank_account_name', v_bank_account_name,
      'bank_name', v_bank_name
    ));
  else
    return null;
  end if;

  if v_company_id is null or v_document_kind is null or v_event_type is null or new.ref_id is null then
    return null;
  end if;

  perform public.append_finance_document_event(
    v_company_id,
    v_document_kind,
    new.ref_id,
    v_event_type,
    null,
    null,
    v_payload
  );

  return null;
end;
$$;


ALTER FUNCTION "public"."finance_document_settlement_event_journal"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finance_document_settlement_event_journal"() IS 'Appends settlement-linked cash and bank events onto the active sales-invoice or vendor-bill audit trail using the current cash and bank account models.';



CREATE OR REPLACE FUNCTION "public"."finance_document_settlement_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_company_id uuid;
  v_bank_id uuid;
  v_ref_type text;
  v_tx_type text;
begin
  if tg_table_name = 'cash_transactions' then
    if tg_op = 'INSERT' then
      v_ref_type := new.ref_type;
      v_tx_type := new.type;
      v_company_id := new.company_id;
    else
      v_ref_type := coalesce(new.ref_type, old.ref_type);
      v_tx_type := coalesce(new.type, old.type);
      v_company_id := coalesce(new.company_id, old.company_id);
    end if;

    if (
      v_tx_type in ('sale_receipt', 'purchase_payment')
      or v_ref_type in ('SO', 'PO', 'SI', 'VB')
    ) and not public.finance_documents_can_manage_settlement(v_company_id) then
      raise exception using
        message = 'Settlement-linked cash transactions require finance authority.';
    end if;
    return new;
  end if;

  if tg_table_name = 'bank_transactions' then
    if tg_op = 'INSERT' then
      v_ref_type := new.ref_type;
      v_bank_id := new.bank_id;
    else
      v_ref_type := coalesce(new.ref_type, old.ref_type);
      v_bank_id := coalesce(new.bank_id, old.bank_id);
    end if;

    select ba.company_id
      into v_company_id
    from public.bank_accounts ba
    where ba.id = v_bank_id;

    if v_ref_type in ('SO', 'PO', 'SI', 'VB')
       and not public.finance_documents_can_manage_settlement(v_company_id) then
      raise exception using
        message = 'Settlement-linked bank transactions require finance authority.';
    end if;
    return new;
  end if;

  raise exception using
    message = format('finance_document_settlement_guard does not support table %s.', tg_table_name);
end;
$$;


ALTER FUNCTION "public"."finance_document_settlement_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_can_approve"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$$;


ALTER FUNCTION "public"."finance_documents_can_approve"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_can_issue_adjustment"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$$;


ALTER FUNCTION "public"."finance_documents_can_issue_adjustment"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_can_issue_legal"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$$;


ALTER FUNCTION "public"."finance_documents_can_issue_legal"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_can_manage_due_reminders"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$$;


ALTER FUNCTION "public"."finance_documents_can_manage_due_reminders"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_can_manage_settlement"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$$;


ALTER FUNCTION "public"."finance_documents_can_manage_settlement"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_can_post_adjustment"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$$;


ALTER FUNCTION "public"."finance_documents_can_post_adjustment"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_can_prepare_draft"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.finance_documents_has_min_role(p_company_id, 'OPERATOR'::public.member_role);
$$;


ALTER FUNCTION "public"."finance_documents_can_prepare_draft"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_can_read"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
  and public.company_access_is_enabled(p_company_id);
$$;


ALTER FUNCTION "public"."finance_documents_can_read"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_can_submit_for_approval"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.finance_documents_has_min_role(p_company_id, 'OPERATOR'::public.member_role);
$$;


ALTER FUNCTION "public"."finance_documents_can_submit_for_approval"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_can_void"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$$;


ALTER FUNCTION "public"."finance_documents_can_void"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_can_write"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.finance_documents_can_prepare_draft(p_company_id);
$$;


ALTER FUNCTION "public"."finance_documents_can_write"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_has_min_role"("p_company_id" "uuid", "p_min_role" "public"."member_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.finance_documents_is_system_context()
      or (
        public.company_access_is_enabled(p_company_id)
        and exists (
          select 1
          from public.company_members cm
          where cm.company_id = p_company_id
            and cm.user_id = auth.uid()
            and cm.status = 'active'
            and cm.role <= p_min_role
        )
      );
$$;


ALTER FUNCTION "public"."finance_documents_has_min_role"("p_company_id" "uuid", "p_min_role" "public"."member_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_internal_transition_bypass"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.finance_documents_is_system_context()
      or coalesce(current_setting('stockwise.finance_transition_bypass', true), '') = 'on';
$$;


ALTER FUNCTION "public"."finance_documents_internal_transition_bypass"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_is_system_context"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select coalesce(auth.role(), '') = 'service_role'
      or (auth.uid() is null and coalesce(auth.role(), '') = '');
$$;


ALTER FUNCTION "public"."finance_documents_is_system_context"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_documents_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."finance_documents_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_note_line_company_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_parent_company_id uuid;
  v_original_invoice_id uuid;
  v_sales_invoice_id uuid;
begin
  if tg_table_name = 'sales_credit_note_lines' then
    select scn.company_id, scn.original_sales_invoice_id
      into v_parent_company_id, v_original_invoice_id
    from public.sales_credit_notes scn
    where scn.id = new.sales_credit_note_id;
  elsif tg_table_name = 'sales_debit_note_lines' then
    select sdn.company_id, sdn.original_sales_invoice_id
      into v_parent_company_id, v_original_invoice_id
    from public.sales_debit_notes sdn
    where sdn.id = new.sales_debit_note_id;
  end if;

  if v_parent_company_id is null then
    raise exception 'finance_document_parent_not_found';
  end if;

  if new.sales_invoice_line_id is not null then
    select sil.sales_invoice_id
      into v_sales_invoice_id
    from public.sales_invoice_lines sil
    where sil.id = new.sales_invoice_line_id;

    if v_sales_invoice_id is null then
      raise exception using
        message = 'Sales note lines must reference an existing sales invoice line when a source line is provided.';
    end if;

    if v_sales_invoice_id is distinct from v_original_invoice_id then
      raise exception using
        message = 'Sales note lines must reference lines from the original sales invoice.';
    end if;
  end if;

  new.company_id := v_parent_company_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."finance_note_line_company_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fiscal_document_artifact_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
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


ALTER FUNCTION "public"."fiscal_document_artifact_defaults"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fiscal_document_artifact_event_journal"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
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


ALTER FUNCTION "public"."fiscal_document_artifact_event_journal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_convert_qty"("p_from_uom" "text", "p_to_uom" "text", "p_qty" numeric) RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE v_factor numeric;
BEGIN
  IF p_from_uom IS NULL OR p_to_uom IS NULL OR p_from_uom = p_to_uom THEN
    RETURN p_qty;
  END IF;

  SELECT uc.factor INTO v_factor
  FROM public.uom_conversions uc
  WHERE uc.from_uom_id = p_from_uom AND uc.to_uom_id = p_to_uom
  LIMIT 1;

  IF v_factor IS NULL THEN
    -- No direct conversion: try inverse
    SELECT 1/uc.factor INTO v_factor
    FROM public.uom_conversions uc
    WHERE uc.from_uom_id = p_to_uom AND uc.to_uom_id = p_from_uom
    LIMIT 1;
  END IF;

  RETURN COALESCE(v_factor, 1) * p_qty;
END;
$$;


ALTER FUNCTION "public"."fn_convert_qty"("p_from_uom" "text", "p_to_uom" "text", "p_qty" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_record_revenue_on_issue_so"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  l_sol_id uuid;
  l_unit_price numeric;
  l_discount numeric := 0;
  l_currency text := 'MZN';
  l_fx numeric := 1;
  l_qty numeric := coalesce(NEW.qty, 0);
  l_qty_base numeric := coalesce(NEW.qty_base, 0);
  l_revenue numeric;
  l_revenue_base numeric;
begin
  if NEW.type <> 'issue' or upper(coalesce(NEW.ref_type,'')) <> 'SO' then
    return NEW;
  end if;

  if NEW.ref_line_id is not null then
    select sol.id, sol.unit_price, coalesce(sol.discount_pct,0), so.currency_code, coalesce(so.fx_to_base,1)
      into l_sol_id, l_unit_price, l_discount, l_currency, l_fx
    from public.sales_order_lines sol
    join public.sales_orders so on so.id = sol.so_id
    where sol.id = NEW.ref_line_id;
  end if;

  if l_sol_id is null and NEW.ref_id is not null then
    select sol.id, sol.unit_price, coalesce(sol.discount_pct,0), so.currency_code, coalesce(so.fx_to_base,1)
      into l_sol_id, l_unit_price, l_discount, l_currency, l_fx
    from public.sales_order_lines sol
    join public.sales_orders so on so.id = sol.so_id
    where sol.so_id = NEW.ref_id and sol.item_id = NEW.item_id
    order by coalesce(sol.line_no, 1)
    limit 1;
  end if;

  if l_sol_id is null then
    return NEW;
  end if;

  l_revenue := l_qty * l_unit_price * (1 - l_discount/100.0);
  l_revenue_base := l_revenue * l_fx;

  insert into public.sales_shipments(
    movement_id, so_id, so_line_id, item_id,
    qty, qty_base, unit_price, discount_pct,
    revenue_amount, currency_code, fx_to_base, revenue_base_amount, created_at
  )
  select
    NEW.id, (select so_id from public.sales_order_lines where id = l_sol_id),
    l_sol_id, NEW.item_id,
    l_qty, l_qty_base, l_unit_price, l_discount,
    l_revenue, l_currency, l_fx, l_revenue_base, now();

  return NEW;
end;
$$;


ALTER FUNCTION "public"."fn_record_revenue_on_issue_so"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_so_ship_line"("p_so_line_id" "uuid", "p_qty" numeric, "p_warehouse_from" "uuid", "p_bin_from" "text", "p_user" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_sol   public.sales_order_lines%ROWTYPE;
  v_so    public.sales_orders%ROWTYPE;
  v_sl    public.stock_levels%ROWTYPE;
  v_qty_base numeric;
  v_new_shipped numeric;
  v_now timestamptz := now();
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be > 0';
  END IF;

  -- fetch line, then its parent SO
  SELECT * INTO v_sol FROM public.sales_order_lines WHERE id = p_so_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SO line not found: %', p_so_line_id; END IF;

  SELECT * INTO v_so FROM public.sales_orders WHERE id = v_sol.so_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SO not found for line %', p_so_line_id; END IF;

  IF v_so.status = 'cancelled'::so_status THEN
    RAISE EXCEPTION 'Cannot ship cancelled SO %', v_so.code;
  END IF;

  v_new_shipped := COALESCE(v_sol.shipped_qty,0) + p_qty;
  IF v_new_shipped > v_sol.qty THEN
    RAISE EXCEPTION 'Over-ship: new shipped % exceeds ordered % (SO % line %)',
      v_new_shipped, v_sol.qty, v_so.code, v_sol.id;
  END IF;

  -- pick a stock_levels row if present (for unit_cost)
  SELECT sl.* INTO v_sl
  FROM public.stock_levels sl
  WHERE sl.item_id = v_sol.item_id AND sl.company_id = v_so.company_id
    AND (p_warehouse_from IS NULL OR sl.warehouse_id = p_warehouse_from)
    AND (p_bin_from IS NULL OR sl.bin_id = p_bin_from)
  ORDER BY COALESCE(sl.qty, sl.qty_on_hand) DESC NULLS LAST, sl.updated_at DESC NULLS LAST
  LIMIT 1;

  v_qty_base := p_qty; -- adjust if you standardize to a base UOM

  INSERT INTO public.stock_movements
  (id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
   warehouse_from_id, bin_from_id,
   notes, created_by, created_at, ref_type, ref_id, ref_line_id, company_id)
  VALUES
  (gen_random_uuid(), 'issue', v_sol.item_id, v_sol.uom_id,
   p_qty, v_qty_base, COALESCE(v_sl.avg_cost,0), COALESCE(v_sl.avg_cost,0)*v_qty_base,
   p_warehouse_from, p_bin_from,
   'SO ship', p_user, v_now, 'SO', v_so.id::text, v_sol.id, v_so.company_id);

  UPDATE public.sales_order_lines
  SET shipped_qty = v_new_shipped,
      is_shipped = (v_new_shipped >= qty),
      shipped_at = CASE WHEN v_new_shipped >= qty THEN v_now ELSE shipped_at END
  WHERE id = v_sol.id;

  RETURN jsonb_build_object('status','ok','so',v_so.code,'so_line_id',v_sol.id,'qty',p_qty);
END;
$$;


ALTER FUNCTION "public"."fn_so_ship_line"("p_so_line_id" "uuid", "p_qty" numeric, "p_warehouse_from" "uuid", "p_bin_from" "text", "p_user" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_so_unship_line"("p_so_line_id" "uuid", "p_qty" numeric, "p_warehouse_to" "uuid", "p_bin_to" "text", "p_user" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_sol public.sales_order_lines%ROWTYPE;
  v_so  public.sales_orders%ROWTYPE;
  v_sl  public.stock_levels%ROWTYPE;
  v_new_shipped numeric;
  v_now timestamptz := now();
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be > 0';
  END IF;

  SELECT * INTO v_sol FROM public.sales_order_lines WHERE id = p_so_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SO line not found'; END IF;

  SELECT * INTO v_so FROM public.sales_orders WHERE id = v_sol.so_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SO not found'; END IF;

  v_new_shipped := GREATEST(COALESCE(v_sol.shipped_qty,0) - p_qty, 0);

  SELECT sl.* INTO v_sl
  FROM public.stock_levels sl
  WHERE sl.item_id = v_sol.item_id AND sl.company_id = v_so.company_id
  ORDER BY COALESCE(sl.qty, sl.qty_on_hand) DESC NULLS LAST, sl.updated_at DESC NULLS LAST
  LIMIT 1;

  INSERT INTO public.stock_movements
  (id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
   warehouse_to_id, bin_to_id,
   notes, created_by, created_at, ref_type, ref_id, ref_line_id, company_id)
  VALUES
  (gen_random_uuid(), 'adjust', v_sol.item_id, v_sol.uom_id,
   p_qty, p_qty, COALESCE(v_sl.avg_cost,0), COALESCE(v_sl.avg_cost,0)*p_qty,
   p_warehouse_to, p_bin_to,
   'SO unship (correction)', p_user, v_now, 'ADJ', v_so.id::text, v_sol.id, v_so.company_id);

  UPDATE public.sales_order_lines
  SET shipped_qty = v_new_shipped,
      is_shipped = (v_new_shipped >= qty),
      shipped_at = CASE WHEN v_new_shipped >= qty THEN v_now ELSE shipped_at END
  WHERE id = v_sol.id;

  RETURN jsonb_build_object('status','ok','so',v_so.code,'so_line_id',v_sol.id,'qty',p_qty);
END;
$$;


ALTER FUNCTION "public"."fn_so_unship_line"("p_so_line_id" "uuid", "p_qty" numeric, "p_warehouse_to" "uuid", "p_bin_to" "text", "p_user" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."force_so_status_if_fully_shipped"("p_so_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_all_shipped boolean;
BEGIN
  SELECT bool_and(COALESCE(sol.shipped_qty,0) >= sol.qty) INTO v_all_shipped
  FROM public.sales_order_lines sol
  WHERE sol.so_id = p_so_id;

  IF v_all_shipped THEN
    UPDATE public.sales_orders so
    SET status = 'shipped'
    WHERE so.id = p_so_id AND so.status IN ('confirmed','allocated');
  END IF;
END;$$;


ALTER FUNCTION "public"."force_so_status_if_fully_shipped"("p_so_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fx_rates_bi_set_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
begin
  if new.company_id is null then
    new.company_id := current_company_id();
  end if;

  if coalesce(new.id,'') = '' then
    new.id := 'fx_' || coalesce(new.company_id::text,'global') || '_' ||
              to_char(new.date,'YYYYMMDD') || '_' || new.from_code || '_' || new.to_code;
  end if;

  return new;
end $$;


ALTER FUNCTION "public"."fx_rates_bi_set_defaults"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_company"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
declare v uuid;
begin
  select company_id into v from public.user_active_company where user_id = auth.uid();
  if v is not null then return v; end if;
  select cm.company_id into v from public.company_members cm where cm.user_id = auth.uid() and cm.status in ('active','invited') order by cm.created_at asc limit 1;
  if v is not null then
    insert into public.user_active_company(user_id, company_id) values (auth.uid(), v)
    on conflict (user_id) do update set company_id = excluded.company_id, updated_at = now();
  end if;
  return v;
end;
$$;


ALTER FUNCTION "public"."get_active_company"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cash_approvals_queue"("p_company" "uuid") RETURNS TABLE("kind" "text", "ref_id" "uuid", "order_no" "text", "status" "text", "total_amount_base" numeric, "cash_posted_base" numeric, "balance_due_base" numeric, "suggested_amount_base" numeric, "last_activity_at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    kind,
    ref_id,
    order_no,
    status,
    total_amount_base,
    cash_posted_base,
    balance_due_base,
    suggested_amount_base,
    last_activity_at
  from public.get_cash_approvals_queue_raw(p_company)
  where balance_due_base > 0
    and (
      (kind = 'SO' and status = 'shipped')
      or
      (kind = 'PO' and status = 'closed')
    )
  order by last_activity_at desc nulls last, order_no;
$$;


ALTER FUNCTION "public"."get_cash_approvals_queue"("p_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cash_approvals_queue_raw"("p_company" "uuid") RETURNS TABLE("kind" "text", "ref_id" "uuid", "order_no" "text", "status" "text", "total_amount_base" numeric, "cash_posted_base" numeric, "balance_due_base" numeric, "suggested_amount_base" numeric, "last_activity_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company is distinct from public.current_company_id()
       or not public.is_company_member(auth.uid(), p_company, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::text[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  select
    'SO'::text as kind,
    s.id as ref_id,
    s.order_no,
    s.status::text as status,
    s.total_amount_base,
    coalesce(s.cash_received_base, 0) as cash_posted_base,
    (s.total_amount_base - coalesce(s.cash_received_base, 0)) as balance_due_base,
    greatest(s.total_amount_base - coalesce(s.cash_received_base, 0), 0) as suggested_amount_base,
    s.last_ship_activity_at as last_activity_at
  from public.v_so_cash_status s
  where s.company_id = p_company
    and (s.total_amount_base - coalesce(s.cash_received_base, 0)) > 0

  union all

  select
    'PO'::text as kind,
    p.id as ref_id,
    p.order_no,
    p.status::text as status,
    p.total_amount_base,
    coalesce(p.cash_paid_base, 0) as cash_posted_base,
    (p.total_amount_base + coalesce(p.cash_paid_base, 0)) as balance_due_base,
    greatest(p.total_amount_base + coalesce(p.cash_paid_base, 0), 0) as suggested_amount_base,
    p.last_receive_activity_at as last_activity_at
  from public.v_po_cash_status p
  where p.company_id = p_company
    and (p.total_amount_base + coalesce(p.cash_paid_base, 0)) > 0

  order by last_activity_at desc nulls last, order_no;
end
$$;


ALTER FUNCTION "public"."get_cash_approvals_queue_raw"("p_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cash_book"("p_company" "uuid") RETURNS TABLE("id" "uuid", "company_id" "uuid", "beginning_balance_base" numeric, "beginning_as_of" "date")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company is distinct from public.current_company_id()
       or not public.is_company_member(auth.uid(), p_company, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::text[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  select id, company_id, beginning_balance_base, beginning_as_of
  from public.cash_books
  where company_id = p_company
  order by beginning_as_of desc
  limit 1;
end
$$;


ALTER FUNCTION "public"."get_cash_book"("p_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_whatsapp_creds"("p_company_id" "uuid") RETURNS TABLE("waba_id" "text", "phone_number_id" "text", "access_token" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT waba_id, phone_number_id, access_token
  FROM public.whatsapp_credentials
  WHERE company_id = p_company_id;
$$;


ALTER FUNCTION "public"."get_company_whatsapp_creds"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_company_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select public.current_company_id()
$$;


ALTER FUNCTION "public"."get_current_company_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_company_access_state"("p_company_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("company_id" "uuid", "company_name" "text", "plan_code" "text", "plan_name" "text", "subscription_status" "public"."subscription_status", "effective_status" "public"."subscription_status", "trial_started_at" timestamp with time zone, "trial_expires_at" timestamp with time zone, "paid_until" timestamp with time zone, "purge_scheduled_at" timestamp with time zone, "purge_completed_at" timestamp with time zone, "access_enabled" boolean, "manual_activation_only" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
  with target_company as (
    select coalesce(
      p_company_id,
      (
        select uac.company_id
        from public.user_active_company uac
        join public.company_members cm
          on cm.company_id = uac.company_id
         and cm.user_id = uac.user_id
         and cm.status = 'active'::public.member_status
        where uac.user_id = auth.uid()
        order by uac.updated_at desc
        limit 1
      )
    ) as company_id
  )
  select
    c.id,
    c.name,
    css.plan_code,
    pc.display_name,
    css.subscription_status,
    public.company_access_effective_status(c.id) as effective_status,
    css.trial_started_at,
    css.trial_expires_at,
    css.paid_until,
    css.purge_scheduled_at,
    css.purge_completed_at,
    public.company_access_is_enabled(c.id) as access_enabled,
    pc.manual_activation_only
  from target_company tc
  join public.companies c
    on c.id = tc.company_id
  join public.company_subscription_state css
    on css.company_id = c.id
  join public.plan_catalog pc
    on pc.code = css.plan_code
  where exists (
    select 1
    from public.company_members cm
    where cm.company_id = c.id
      and (
        cm.user_id = auth.uid()
        or lower(cm.email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
      )
      and cm.status = any(array['active'::public.member_status, 'invited'::public.member_status])
  );
$$;


ALTER FUNCTION "public"."get_my_company_access_state"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_payment_terms"("p_company_id" "uuid") RETURNS TABLE("id" "uuid", "code" "text", "name" "text", "net_days" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT pt.id, pt.code, pt.name, pt.net_days
  FROM public.payment_terms pt
  WHERE pt.company_id = p_company_id
    AND ( public.is_member(p_company_id) OR p_company_id = public.current_company_id() )
  ORDER BY pt.net_days ASC, pt.code ASC;
$$;


ALTER FUNCTION "public"."get_payment_terms"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_platform_admin_status"() RETURNS TABLE("is_admin" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
  select public.is_platform_admin();
$$;


ALTER FUNCTION "public"."get_platform_admin_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_schema_snapshot"("p_schema" "text" DEFAULT 'public'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_tables    jsonb;
  v_columns   jsonb;
  v_pks       jsonb;
  v_fks       jsonb;
  v_indexes   jsonb;
  v_enums     jsonb;
  v_views     jsonb;
  v_functions jsonb;
  v_policies  jsonb;
begin
  -- Tables
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', c.relname,
    'oid',   c.oid
  ) order by c.relname), '[]'::jsonb)
  into v_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = p_schema and c.relkind = 'r';

  -- Columns
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', table_name,
    'column', column_name,
    'data_type', data_type,
    'is_nullable', is_nullable,
    'column_default', column_default
  ) order by table_name, ordinal_position), '[]'::jsonb)
  into v_columns
  from information_schema.columns
  where table_schema = p_schema;

  -- Primary Keys
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', t.relname,
    'constraint', con.conname,
    'columns', a.attname
  ) order by t.relname, con.conname), '[]'::jsonb)
  into v_pks
  from pg_constraint con
  join pg_class t on t.oid = con.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join unnest(con.conkey) with ordinality as cols(attnum, ord) on true
  join pg_attribute a on a.attrelid = t.oid and a.attnum = cols.attnum
  where n.nspname = p_schema and con.contype = 'p';

  -- Foreign Keys
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', t.relname,
    'constraint', con.conname,
    'fk_columns', fk_cols.cols,
    'ref_table', rt.relname,
    'ref_columns', ref_cols.cols
  ) order by t.relname, con.conname), '[]'::jsonb)
  into v_fks
  from pg_constraint con
  join pg_class t on t.oid = con.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join pg_class rt on rt.oid = con.confrelid
  join lateral (
    select jsonb_agg(a.attname order by ord) as cols
    from unnest(con.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
  ) fk_cols on true
  join lateral (
    select jsonb_agg(a.attname order by ord) as cols
    from unnest(con.confkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = rt.oid and a.attnum = k.attnum
  ) ref_cols on true
  where n.nspname = p_schema and con.contype = 'f';

  -- Indexes
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', t.relname,
    'index', i.relname,
    'definition', pg_get_indexdef(ix.indexrelid)
  ) order by t.relname, i.relname), '[]'::jsonb)
  into v_indexes
  from pg_index ix
  join pg_class t on t.oid = ix.indrelid
  join pg_class i on i.oid = ix.indexrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = p_schema;

  -- Enums
  select coalesce(jsonb_agg(jsonb_build_object(
    'type', t.typname,
    'labels', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)
  ) order by t.typname), '[]'::jsonb)
  into v_enums
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = p_schema and t.typtype = 'e';

  -- Views
  select coalesce(jsonb_agg(jsonb_build_object(
    'view', table_name,
    'definition', view_definition
  ) order by table_name), '[]'::jsonb)
  into v_views
  from information_schema.views
  where table_schema = p_schema;

  -- Functions (reduced signature)
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', p.proname,
    'rettype', pt.typname,
    'volatility', p.provolatile
  ) order by p.proname), '[]'::jsonb)
  into v_functions
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_type pt on pt.oid = p.prorettype
  where n.nspname = p_schema;

  -- RLS Policies
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', pol.tablename,
    'policy', pol.policyname,
    'cmd', pol.cmd,
    'permissive', pol.permissive,
    'roles', pol.roles
  ) order by pol.tablename, pol.policyname), '[]'::jsonb)
  into v_policies
  from pg_policies pol
  where pol.schemaname = p_schema;

  return jsonb_build_object(
    'schema',       p_schema,
    'tables',       v_tables,
    'columns',      v_columns,
    'primary_keys', v_pks,
    'foreign_keys', v_fks,
    'indexes',      v_indexes,
    'enums',        v_enums,
    'views',        v_views,
    'functions',    v_functions,
    'rls_policies', v_policies,
    'generated_at', now()
  );
end
$$;


ALTER FUNCTION "public"."get_schema_snapshot"("p_schema" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, user_id, role)
  values (new.id, new.id, 'staff')
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_profile_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ begin insert into public.profiles (id, email, full_name, avatar_url, email_confirmed_at, last_sign_in_at, created_at, updated_at) values ( new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', null), coalesce(new.raw_user_meta_data->>'avatar_url', null), new.email_confirmed_at, new.last_sign_in_at, now(), now() ) on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, avatar_url = excluded.avatar_url, email_confirmed_at = excluded.email_confirmed_at, last_sign_in_at = excluded.last_sign_in_at, updated_at = now(); return new; end; $$;


ALTER FUNCTION "public"."handle_user_profile_sync"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_company_role"("cid" "uuid", "p_roles" "public"."member_role"[]) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select exists(
    select 1
    from public.company_members m
    where m.company_id = cid
      and m.user_id = auth.uid()
      and m.status = 'active'::member_status
      and m.role = any(p_roles)
  )
  and public.company_access_is_enabled(cid);
$$;


ALTER FUNCTION "public"."has_company_role"("cid" "uuid", "p_roles" "public"."member_role"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_company_role_any_status"("cid" "uuid", "p_roles" "public"."member_role"[]) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = cid
      and m.user_id = auth.uid()
      and m.status = any(array['active'::public.member_status, 'invited'::public.member_status])
      and m.role = any(p_roles)
  )
  and public.company_access_is_enabled(cid);
$$;


ALTER FUNCTION "public"."has_company_role_any_status"("cid" "uuid", "p_roles" "public"."member_role"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_company_role_any_status_for_user"("p_company" "uuid", "p_user" "uuid", "p_roles" "public"."member_role"[]) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and coalesce(m.user_id, '00000000-0000-0000-0000-000000000000'::uuid) = p_user
      and m.status = any (ARRAY['active','invited']::public.member_status[])
      and m.role   = any (p_roles)
  );
$$;


ALTER FUNCTION "public"."has_company_role_any_status_for_user"("p_company" "uuid", "p_user" "uuid", "p_roles" "public"."member_role"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_min_company_role"("p_company" "uuid", "p_user" "uuid", "p_min" "public"."member_role") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and m.user_id    = p_user
      and m.status     = 'active'::member_status
      and public.role_rank(m.role) <= public.role_rank(p_min)
  );
$$;


ALTER FUNCTION "public"."has_min_company_role"("p_company" "uuid", "p_user" "uuid", "p_min" "public"."member_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_opening_stock_batch"("p_company_id" "uuid", "p_rows" "jsonb" DEFAULT '[]'::"jsonb") RETURNS TABLE("imported_rows" integer, "bucket_count" integer, "total_qty_base" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_active_company uuid := public.active_company_id();
  v_member_role public.member_role;
  v_invalid record;
  v_row record;
  v_updated_bucket_count integer := 0;
  v_inserted_bucket_count integer := 0;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_company_id is null then
    raise exception 'Select a company before importing opening stock.' using errcode = 'P0001';
  end if;

  if v_active_company is null or v_active_company <> p_company_id then
    raise exception 'Switch into the target company before importing opening stock.' using errcode = '42501';
  end if;

  select cm.role
    into v_member_role
  from public.company_members cm
  where cm.company_id = p_company_id
    and cm.user_id = v_user
    and cm.status = 'active'::public.member_status
  limit 1;

  if v_member_role is null then
    raise exception 'You do not have access to import opening stock in this company.' using errcode = '42501';
  end if;

  if v_member_role not in (
    'OWNER'::public.member_role,
    'ADMIN'::public.member_role,
    'MANAGER'::public.member_role,
    'OPERATOR'::public.member_role
  ) then
    raise exception 'Only operators and above can import opening stock.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one opening-stock row before importing.' using errcode = 'P0001';
  end if;

  create temporary table tmp_opening_stock_rows_raw (
    row_no integer not null,
    item_id_text text,
    uom_id_text text,
    qty numeric,
    qty_base numeric,
    unit_cost numeric,
    total_value numeric,
    warehouse_to_id_text text,
    bin_to_id text,
    notes text
  ) on commit drop;

  insert into tmp_opening_stock_rows_raw (
    row_no,
    item_id_text,
    uom_id_text,
    qty,
    qty_base,
    unit_cost,
    total_value,
    warehouse_to_id_text,
    bin_to_id,
    notes
  )
  select
    ordinality::integer,
    nullif(trim(row_data ->> 'item_id'), ''),
    nullif(trim(row_data ->> 'uom_id'), ''),
    coalesce(nullif(trim(row_data ->> 'qty'), '')::numeric, 0),
    coalesce(nullif(trim(row_data ->> 'qty_base'), '')::numeric, 0),
    greatest(coalesce(nullif(trim(row_data ->> 'unit_cost'), '')::numeric, 0), 0),
    greatest(coalesce(nullif(trim(row_data ->> 'total_value'), '')::numeric, 0), 0),
    nullif(trim(row_data ->> 'warehouse_to_id'), ''),
    nullif(trim(row_data ->> 'bin_to_id'), ''),
    nullif(trim(row_data ->> 'notes'), '')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as rows(row_data, ordinality);

  select *
    into v_invalid
  from tmp_opening_stock_rows_raw r
  where r.item_id_text is null
     or r.uom_id_text is null
     or r.warehouse_to_id_text is null
     or r.bin_to_id is null
     or coalesce(r.qty, 0) <= 0
     or coalesce(r.qty_base, 0) <= 0
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % is incomplete. Recheck the imported item, UOM, location, and quantity.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  select r.row_no, r.item_id_text
    into v_invalid
  from tmp_opening_stock_rows_raw r
  left join public.items i
    on i.id::text = r.item_id_text
   and i.company_id = p_company_id
  where i.id is null
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % references an item that does not belong to this company.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  select r.row_no, r.uom_id_text
    into v_invalid
  from tmp_opening_stock_rows_raw r
  left join public.uoms u
    on u.id::text = r.uom_id_text
  where u.id is null
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % references a unit of measure that does not exist.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  select r.row_no, r.warehouse_to_id_text
    into v_invalid
  from tmp_opening_stock_rows_raw r
  left join public.warehouses w
    on w.id::text = r.warehouse_to_id_text
   and w.company_id = p_company_id
  where w.id is null
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % references a warehouse that does not belong to this company.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  select r.row_no, r.bin_to_id
    into v_invalid
  from tmp_opening_stock_rows_raw r
  left join public.bins b
    on b.id::text = r.bin_to_id
   and b.company_id = p_company_id
   and b."warehouseId"::text = r.warehouse_to_id_text
  where b.id is null
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % references a bin that does not belong to the selected warehouse.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  create temporary table tmp_opening_stock_rows (
    row_no integer not null,
    item_id uuid not null,
    uom_id uuid not null,
    qty numeric not null,
    qty_base numeric not null,
    unit_cost numeric not null,
    total_value numeric not null,
    warehouse_to_id uuid not null,
    bin_to_id text not null,
    notes text not null
  ) on commit drop;

  insert into tmp_opening_stock_rows (
    row_no,
    item_id,
    uom_id,
    qty,
    qty_base,
    unit_cost,
    total_value,
    warehouse_to_id,
    bin_to_id,
    notes
  )
  select
    r.row_no,
    r.item_id_text::uuid,
    r.uom_id_text::uuid,
    r.qty,
    r.qty_base,
    r.unit_cost,
    case
      when r.total_value > 0 then r.total_value
      else round(r.qty_base * r.unit_cost, 2)
    end,
    r.warehouse_to_id_text::uuid,
    r.bin_to_id,
    coalesce(r.notes, 'Stock inicial')
  from tmp_opening_stock_rows_raw r;

  create temporary table tmp_opening_stock_baseline (
    item_id uuid not null,
    warehouse_key text not null,
    bin_key text not null,
    qty numeric not null,
    avg_cost numeric not null,
    allocated_qty numeric not null
  ) on commit drop;

  insert into tmp_opening_stock_baseline (
    item_id,
    warehouse_key,
    bin_key,
    qty,
    avg_cost,
    allocated_qty
  )
  select
    buckets.item_id,
    buckets.warehouse_to_id::text,
    buckets.bin_to_id,
    coalesce(sl.qty, 0),
    coalesce(sl.avg_cost, 0),
    coalesce(sl.allocated_qty, 0)
  from (
    select distinct
      r.item_id,
      r.warehouse_to_id,
      r.bin_to_id
    from tmp_opening_stock_rows r
  ) buckets
  left join public.stock_levels sl
    on sl.company_id = p_company_id
   and sl.item_id = buckets.item_id
   and sl.warehouse_id::text = buckets.warehouse_to_id::text
   and sl.bin_id::text = buckets.bin_to_id;

  imported_rows := 0;

  for v_row in
    select *
    from tmp_opening_stock_rows
    order by row_no
  loop
    insert into public.stock_movements (
      company_id,
      type,
      item_id,
      uom_id,
      qty,
      qty_base,
      unit_cost,
      total_value,
      warehouse_to_id,
      bin_to_id,
      notes,
      created_by,
      ref_type,
      ref_id,
      ref_line_id
    )
    values (
      p_company_id,
      'receive',
      v_row.item_id,
      v_row.uom_id,
      v_row.qty,
      v_row.qty_base,
      v_row.unit_cost,
      v_row.total_value,
      v_row.warehouse_to_id,
      v_row.bin_to_id,
      v_row.notes,
      v_user,
      'ADJUST',
      null,
      null
    );

    imported_rows := imported_rows + 1;
  end loop;

  create temporary table tmp_opening_stock_final_levels (
    item_id uuid not null,
    warehouse_to_id uuid not null,
    bin_to_id text not null,
    final_qty numeric not null,
    final_avg_cost numeric not null,
    allocated_qty numeric not null
  ) on commit drop;

  insert into tmp_opening_stock_final_levels (
    item_id,
    warehouse_to_id,
    bin_to_id,
    final_qty,
    final_avg_cost,
    allocated_qty
  )
  select
    r.item_id,
    r.warehouse_to_id,
    r.bin_to_id,
    round(coalesce(b.qty, 0) + sum(r.qty_base), 6),
    case
      when coalesce(b.qty, 0) + sum(r.qty_base) > 0 then
        round(
          ((coalesce(b.qty, 0) * coalesce(b.avg_cost, 0)) + sum(r.total_value))
          / (coalesce(b.qty, 0) + sum(r.qty_base)),
          6
        )
      else 0
    end,
    coalesce(b.allocated_qty, 0)
  from tmp_opening_stock_rows r
  left join tmp_opening_stock_baseline b
    on b.item_id = r.item_id
   and b.warehouse_key = r.warehouse_to_id::text
   and b.bin_key = r.bin_to_id
  group by
    r.item_id,
    r.warehouse_to_id,
    r.bin_to_id,
    b.qty,
    b.avg_cost,
    b.allocated_qty;

  update public.stock_levels sl
     set qty = f.final_qty,
         avg_cost = f.final_avg_cost,
         allocated_qty = f.allocated_qty,
         updated_at = now()
  from tmp_opening_stock_final_levels f
  where sl.company_id = p_company_id
    and sl.item_id = f.item_id
    and sl.warehouse_id::text = f.warehouse_to_id::text
    and sl.bin_id::text = f.bin_to_id;

  get diagnostics v_updated_bucket_count = row_count;

  insert into public.stock_levels (
    company_id,
    item_id,
    warehouse_id,
    bin_id,
    qty,
    avg_cost,
    allocated_qty
  )
  select
    p_company_id,
    f.item_id,
    f.warehouse_to_id,
    f.bin_to_id,
    f.final_qty,
    f.final_avg_cost,
    f.allocated_qty
  from tmp_opening_stock_final_levels f
  where not exists (
    select 1
    from public.stock_levels sl
    where sl.company_id = p_company_id
      and sl.item_id = f.item_id
      and sl.warehouse_id::text = f.warehouse_to_id::text
      and sl.bin_id::text = f.bin_to_id
  );

  get diagnostics v_inserted_bucket_count = row_count;
  bucket_count := v_updated_bucket_count + v_inserted_bucket_count;

  select round(coalesce(sum(r.qty_base), 0), 6)
    into total_qty_base
  from tmp_opening_stock_rows r;

  return next;
end;
$$;


ALTER FUNCTION "public"."import_opening_stock_batch"("p_company_id" "uuid", "p_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."inv_adjust_to"("p_company" "uuid", "p_item" "uuid", "p_bin" "text", "p_target" numeric, "p_reason" "text" DEFAULT 'ADJUST'::"text") RETURNS TABLE("id" "uuid", "delta" numeric, "new_onhand" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_now timestamptz := now();
  v_curr numeric;
  v_delta numeric;
  v_id uuid := gen_random_uuid();
BEGIN
  IF p_target IS NULL THEN
    RAISE EXCEPTION 'target cannot be NULL';
  END IF;

  v_curr  := inv_onhand_from_movements(p_company, p_item, p_bin);
  v_delta := p_target - v_curr;

  IF v_delta = 0 THEN
    RETURN QUERY SELECT NULL::uuid, 0::numeric, v_curr::numeric;
    RETURN;
  END IF;

  IF v_delta > 0 THEN
    INSERT INTO public.stock_movements(
      id, company_id, item_id, ref_type, ref_id, qty,
      warehouse_from_id, bin_from_id,
      warehouse_to_id,   bin_to_id,
      created_at
    )
    SELECT v_id, p_company, p_item, p_reason, NULL, v_delta,
           NULL, NULL,
           w.id, p_bin,
           v_now
    FROM public.warehouses w
    WHERE w.company_id = p_company
      AND p_bin IN (SELECT b.id FROM public.bins b WHERE b.warehouseid = w.id::text)
    LIMIT 1;  -- any owning warehouse; bin text ties it.
  ELSE
    INSERT INTO public.stock_movements(
      id, company_id, item_id, ref_type, ref_id, qty,
      warehouse_from_id, bin_from_id,
      warehouse_to_id,   bin_to_id,
      created_at
    )
    SELECT v_id, p_company, p_item, p_reason, NULL, ABS(v_delta),
           w.id, p_bin,
           NULL, NULL,
           v_now
    FROM public.warehouses w
    WHERE w.company_id = p_company
      AND p_bin IN (SELECT b.id FROM public.bins b WHERE b.warehouseid = w.id::text)
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT v_id, v_delta, inv_onhand_from_movements(p_company,p_item,p_bin);
END;
$$;


ALTER FUNCTION "public"."inv_adjust_to"("p_company" "uuid", "p_item" "uuid", "p_bin" "text", "p_target" numeric, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."inv_issue_component"("p_item_id" "uuid", "p_qty_base" numeric, "p_warehouse_id" "uuid", "p_bin_id" "text", "p_note" "text" DEFAULT 'BOM issue'::"text") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  v_base_uom_id uuid;
  v_sl_id       uuid;
  v_onhand      numeric;
  v_avg_cost    numeric;
  v_total_value numeric;
begin
  select i.base_uom_id into v_base_uom_id
  from public.items i where i.id = p_item_id;

  -- ensure stock_levels row exists (strictness comes from onhand check)
  select id, qty, avg_cost
    into v_sl_id, v_onhand, v_avg_cost
  from public.stock_levels
  where item_id = p_item_id
    and warehouse_id = p_warehouse_id
    and bin_id = p_bin_id
  limit 1;

  if v_sl_id is null then
    insert into public.stock_levels (id, item_id, warehouse_id, bin_id, qty, avg_cost)
    values (gen_random_uuid(), p_item_id, p_warehouse_id, p_bin_id, 0, 0);
    v_onhand := 0;
    v_avg_cost := 0;
  end if;

  -- strict: require enough stock
  if coalesce(v_onhand,0) + 0.000001 < p_qty_base then
    raise exception 'Insufficient stock (need %, onhand %): item %, wh %, bin %',
      p_qty_base, v_onhand, p_item_id, p_warehouse_id, p_bin_id;
  end if;

  v_total_value := coalesce(v_avg_cost,0) * p_qty_base;

  insert into public.stock_movements (
    type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_from_id, bin_from_id, notes, created_by,
    ref_type, ref_id, ref_line_id
  )
  values (
    'issue', p_item_id, v_base_uom_id,
    p_qty_base, p_qty_base,
    v_avg_cost, v_total_value,
    p_warehouse_id, p_bin_id,
    coalesce(p_note, 'BOM issue'),
    'system',
    'INTERNAL_USE', null, null
  );

  return v_total_value;
end;
$$;


ALTER FUNCTION "public"."inv_issue_component"("p_item_id" "uuid", "p_qty_base" numeric, "p_warehouse_id" "uuid", "p_bin_id" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."inv_onhand_from_movements"("p_company" "uuid", "p_item" "uuid", "p_bin" "text") RETURNS numeric
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT COALESCE(SUM(
           CASE
             WHEN bin_to_id   = p_bin THEN qty
             WHEN bin_from_id = p_bin THEN -qty
             ELSE 0
           END
         ),0)::numeric
  FROM public.stock_movements
  WHERE company_id = p_company AND item_id = p_item
$$;


ALTER FUNCTION "public"."inv_onhand_from_movements"("p_company" "uuid", "p_item" "uuid", "p_bin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."inv_receive_finished"("p_item_id" "uuid", "p_qty_base" numeric, "p_warehouse_id" "uuid", "p_bin_id" "text", "p_note" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  perform public.inv_receive_finished(p_item_id, p_qty_base, p_warehouse_id, p_bin_id, p_note, 0);
end;
$$;


ALTER FUNCTION "public"."inv_receive_finished"("p_item_id" "uuid", "p_qty_base" numeric, "p_warehouse_id" "uuid", "p_bin_id" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."inv_receive_finished"("p_item_id" "uuid", "p_qty_base" numeric, "p_warehouse_id" "uuid", "p_bin_id" "text", "p_note" "text" DEFAULT 'BOM receive'::"text", "p_unit_cost" numeric DEFAULT 0) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  v_base_uom_id uuid;
  v_sl_id       uuid;
  v_onhand      numeric;
  v_avg_cost    numeric;
  v_total_value numeric;
begin
  select i.base_uom_id into v_base_uom_id
  from public.items i where i.id = p_item_id;

  select id, qty, avg_cost
    into v_sl_id, v_onhand, v_avg_cost
  from public.stock_levels
  where item_id = p_item_id
    and warehouse_id = p_warehouse_id
    and bin_id = p_bin_id
  limit 1;

  if v_sl_id is null then
    insert into public.stock_levels (id, item_id, warehouse_id, bin_id, qty, avg_cost)
    values (gen_random_uuid(), p_item_id, p_warehouse_id, p_bin_id, 0, 0);
    v_onhand := 0; v_avg_cost := 0;
  end if;

  v_total_value := coalesce(p_unit_cost,0) * p_qty_base;

  insert into public.stock_movements (
    type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
    warehouse_to_id, bin_to_id, notes, created_by,
    ref_type, ref_id, ref_line_id
  )
  values (
    'receive', p_item_id, v_base_uom_id,
    p_qty_base, p_qty_base,
    coalesce(p_unit_cost,0), v_total_value,
    p_warehouse_id, p_bin_id,
    coalesce(p_note, 'BOM receive'),
    'system',
    'ADJUST', null, null
  );
end;
$$;


ALTER FUNCTION "public"."inv_receive_finished"("p_item_id" "uuid", "p_qty_base" numeric, "p_warehouse_id" "uuid", "p_bin_id" "text", "p_note" "text", "p_unit_cost" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invite_company_member"("p_company" "uuid", "p_email" "text", "p_role" "public"."member_role") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'app'
    AS $$
DECLARE
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_token uuid;
  v_actor_role member_role;
  v_target_role member_role;
  v_target_status member_status;
  v_limit record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  IF p_role IS NULL THEN
    RAISE EXCEPTION 'role_required' USING ERRCODE = '22023';
  END IF;

  SELECT cm.role
    INTO v_actor_role
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND cm.user_id = auth.uid()
    AND cm.status = 'active'
  ORDER BY public.role_rank(cm.role) DESC, cm.created_at ASC
  LIMIT 1;

  IF v_actor_role IS NULL OR public.role_rank(v_actor_role) < public.role_rank('MANAGER'::member_role) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF (
    (v_actor_role = 'OWNER')
    OR (v_actor_role = 'ADMIN' AND p_role = ANY (ARRAY['ADMIN','MANAGER','OPERATOR','VIEWER']::member_role[]))
    OR (v_actor_role = 'MANAGER' AND p_role = ANY (ARRAY['MANAGER','OPERATOR','VIEWER']::member_role[]))
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT allowed, hit_count, retry_after_seconds, bucket_started_at
    INTO v_limit
  FROM public.consume_security_rate_limit(
    'invite_company_member_actor',
    auth.uid()::text || ':' || p_company::text,
    900,
    20
  );

  IF NOT COALESCE(v_limit.allowed, false) THEN
    RAISE EXCEPTION 'rate limit exceeded'
      USING ERRCODE = 'P0001',
            DETAIL = format('retry_after_seconds=%s', COALESCE(v_limit.retry_after_seconds, 0));
  END IF;

  SELECT allowed, hit_count, retry_after_seconds, bucket_started_at
    INTO v_limit
  FROM public.consume_security_rate_limit(
    'invite_company_member_target',
    p_company::text || ':' || v_email,
    1800,
    3
  );

  IF NOT COALESCE(v_limit.allowed, false) THEN
    RAISE EXCEPTION 'rate limit exceeded'
      USING ERRCODE = 'P0001',
            DETAIL = format('retry_after_seconds=%s', COALESCE(v_limit.retry_after_seconds, 0));
  END IF;

  SELECT cm.role, cm.status
    INTO v_target_role, v_target_status
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND lower(cm.email) = v_email
  ORDER BY public.role_rank(cm.role) DESC, cm.created_at ASC
  LIMIT 1;

  IF FOUND THEN
    IF v_target_status = 'active' THEN
      RAISE EXCEPTION 'already_active' USING ERRCODE = '23505';
    END IF;

    IF public.role_rank(v_target_role) > public.role_rank(v_actor_role)
      OR (v_target_role = 'OWNER' AND v_actor_role <> 'OWNER') THEN
      RAISE EXCEPTION 'target_not_allowed' USING ERRCODE = '42501';
    END IF;

    UPDATE public.company_members
       SET role = p_role,
           status = 'invited',
           invited_by = auth.uid()
     WHERE company_id = p_company
       AND lower(email) = v_email;
  ELSE
    INSERT INTO public.company_members(company_id, email, role, status, invited_by)
    VALUES (p_company, v_email, p_role, 'invited', auth.uid());
  END IF;

  INSERT INTO public.company_invites(company_id, email, role)
  VALUES (p_company, v_email, p_role)
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;


ALTER FUNCTION "public"."invite_company_member"("p_company" "uuid", "p_email" "text", "p_role" "public"."member_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invoke_digest_worker"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_url     text  := 'https://ogzhwoqqumkuqhbvuzzp.functions.supabase.co/functions/v1/digest-worker';
  v_headers jsonb := jsonb_build_object('Content-Type','application/json');
begin
  -- Fire-and-forget; pg_net returns (status, headers, body). We don't need them here.
  perform net.http_post(
    url     := v_url,
    headers := v_headers,
    body    := '{}'::jsonb
  );
exception
  when others then
    -- swallow network errors so we don't fail the insert transaction;
    -- your cron drain will retry shortly.
    raise notice 'invoke_digest_worker() http_post failed: %', sqlerrm;
end
$$;


ALTER FUNCTION "public"."invoke_digest_worker"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invoke_due_reminder_worker"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_url    text := COALESCE(
                current_setting('app.due_reminder_worker_url', true),
                'https://ogzhwoqqumkuqhbvuzzp.supabase.co/functions/v1/due-reminder-worker'
              );
  v_secret text := COALESCE(
                current_setting('app.due_reminder_worker_secret', true),
                (SELECT value FROM public.app_secrets WHERE key='due_reminder_worker_secret')
              );
  v_anon   text := COALESCE(
                current_setting('app.supabase_anon_key', true),
                (SELECT value FROM public.app_secrets WHERE key='supabase_anon_key')
              );
  v_hdrs   jsonb := jsonb_build_object('content-type','application/json');
  v_req    bigint;
BEGIN
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'Missing config: app.due_reminder_worker_url';
  END IF;

  IF v_secret IS NOT NULL THEN
    v_hdrs := v_hdrs || jsonb_build_object('x-webhook-secret', v_secret);
  END IF;
  IF v_anon IS NOT NULL THEN
    v_hdrs := v_hdrs || jsonb_build_object('authorization', 'Bearer '||v_anon);
  END IF;

  SELECT net.http_post(
           url := v_url,
           body := jsonb_build_object('source','pg_cron'),
           params := '{}'::jsonb,
           headers := v_hdrs,
           timeout_milliseconds := 3000
         )
    INTO v_req;

  RETURN jsonb_build_object('request_id', v_req, 'queued', true, 'used_auth_header', (v_anon IS NOT NULL));
END;
$$;


ALTER FUNCTION "public"."invoke_due_reminder_worker"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invoke_due_reminder_worker_collect"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_url    text := COALESCE(
                current_setting('app.due_reminder_worker_url', true),
                'https://ogzhwoqqumkuqhbvuzzp.supabase.co/functions/v1/due-reminder-worker'
              );
  v_secret text := current_setting('app.due_reminder_worker_secret', true);
  v_hdrs   jsonb := jsonb_build_object('content-type','application/json');
  v_req    bigint;
  v_res    net.http_response_result;
BEGIN
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'Missing config: app.due_reminder_worker_url';
  END IF;
  IF v_secret IS NOT NULL THEN
    v_hdrs := v_hdrs || jsonb_build_object('x-webhook-secret', v_secret);
  END IF;
  SELECT net.http_post(
           url := v_url,
           body := jsonb_build_object('source','pg_cron'),
           params := '{}'::jsonb,
           headers := v_hdrs,
           timeout_milliseconds := 8000
         )
    INTO v_req;
  SELECT net.http_collect_response(v_req, false) INTO v_res;
  RETURN jsonb_build_object(
    'request_id', v_req,
    'status',     v_res.status,
    'message',    v_res.message,
    'response',   to_jsonb(v_res.response)
  );
END;
$$;


ALTER FUNCTION "public"."invoke_due_reminder_worker_collect"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invoke_due_reminder_worker_qs"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_base   text := COALESCE(
                current_setting('app.due_reminder_worker_url', true),
                'https://ogzhwoqqumkuqhbvuzzp.supabase.co/functions/v1/due-reminder-worker'
              );
  v_secret text := current_setting('app.due_reminder_worker_secret', true);
  v_url    text := v_base;
  v_hdrs   jsonb := jsonb_build_object('content-type','application/json');
  v_req    bigint;
BEGIN
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Missing config: app.due_reminder_worker_url';
  END IF;

  -- keep headers (both) AND pass secret via query param to satisfy authorized() when DEBUG_ACCEPT_QUERY_KEY=true
  IF v_secret IS NOT NULL THEN
    v_hdrs := v_hdrs
      || jsonb_build_object('x-webhook-secret', v_secret)
      || jsonb_build_object('authorization', 'Bearer '||v_secret);
    v_url := v_base || CASE WHEN position('?' in v_base) > 0 THEN '&' ELSE '?' END || 'key=' || v_secret;
  END IF;

  SELECT net.http_post(
           url := v_url,
           body := jsonb_build_object('source','pg_cron'),
           params := '{}'::jsonb,
           headers := v_hdrs,
           timeout_milliseconds := 5000
         )
    INTO v_req;

  RETURN jsonb_build_object('request_id', v_req, 'queued', true, 'url', v_url);
END;
$$;


ALTER FUNCTION "public"."invoke_due_reminder_worker_qs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_member"("target_company" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = target_company
      and m.user_id = auth.uid()
      and m.status in ('active'::member_status, 'invited'::member_status)
  );
$$;


ALTER FUNCTION "public"."is_active_member"("target_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_member"("p_company" "uuid", "p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and coalesce(m.user_id, '00000000-0000-0000-0000-000000000000'::uuid) = p_user
      and m.status in ('active','invited')
  );
$$;


ALTER FUNCTION "public"."is_active_member"("p_company" "uuid", "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_company_admin"("target_company" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = target_company
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('OWNER','ADMIN')
  );
$$;


ALTER FUNCTION "public"."is_company_admin"("target_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_company_member"("target_company" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = target_company
      and cm.user_id = auth.uid()
      and cm.status = 'active'::member_status
  )
  and public.company_access_is_enabled(target_company);
$$;


ALTER FUNCTION "public"."is_company_member"("target_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_company_member"("p_company_id" "uuid", "p_status" "public"."member_status"[] DEFAULT ARRAY['active'::"public"."member_status", 'invited'::"public"."member_status"]) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
      and m.status = any(p_status)
  )
  and public.company_access_is_enabled(p_company_id);
$$;


ALTER FUNCTION "public"."is_company_member"("p_company_id" "uuid", "p_status" "public"."member_status"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_company_member"("p_user" "uuid", "p_company" "uuid", "p_roles" "text"[] DEFAULT ARRAY['OWNER'::"text", 'ADMIN'::"text", 'MANAGER'::"text", 'OPERATOR'::"text", 'VIEWER'::"text"]) RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select exists (
    select 1
    from public.company_members m
    where m.user_id = coalesce(p_user, auth.uid())
      and m.company_id = p_company
      and m.status = 'active'::member_status
      and (
        p_roles is null
        or m.role::text = any (p_roles)
      )
  )
  and public.company_access_is_enabled(p_company);
$$;


ALTER FUNCTION "public"."is_company_member"("p_user" "uuid", "p_company" "uuid", "p_roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_manager_plus"("p_company" "uuid", "p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and coalesce(m.user_id, '00000000-0000-0000-0000-000000000000'::uuid) = p_user
      and m.status = 'active'
      and m.role in ('OWNER','ADMIN','MANAGER')
  );
$$;


ALTER FUNCTION "public"."is_manager_plus"("p_company" "uuid", "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_me_or_my_email"("p_company" "uuid", "p_email" "text", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- allow if the row is bound to me, OR (while unlinked) it matches my email
  select (p_user_id = auth.uid())
      or (
        p_user_id is null
        and exists (
          select 1
          from auth.users u
          where u.id = auth.uid()
            and lower(u.email) = lower(coalesce(p_email, ''))
        )
      );
$$;


ALTER FUNCTION "public"."is_me_or_my_email"("p_company" "uuid", "p_email" "text", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN FALSE;
  END IF;
  -- Your company_members schema uses a text status column (e.g., 'active')
  RETURN EXISTS (
    SELECT 1
    FROM public.company_members cm
    WHERE cm.company_id = p_company_id
      AND cm.user_id = uid
      AND (cm.status IS NULL OR cm.status = 'active')
  );
END;
$$;


ALTER FUNCTION "public"."is_member"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member_any_status"("p_company" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and m.user_id    = auth.uid()
      and m.status = any(ARRAY['active','invited']::public.member_status[])
  );
$$;


ALTER FUNCTION "public"."is_member_any_status"("p_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member_by_jwt"("p_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company_id
      and coalesce(cm.status,'active') in ('active','invited')
      and (
        cm.user_id = auth.uid()
        or lower(cm.email) = lower(coalesce(auth.jwt() ->> 'email',''))
      )
  )
  and public.company_access_is_enabled(p_company_id);
$$;


ALTER FUNCTION "public"."is_member_by_jwt"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member_of_company"("cid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = cid
      and m.status = 'active'::member_status
      and (
        m.user_id = auth.uid()
        or lower(m.email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
      )
  )
  and public.company_access_is_enabled(cid);
$$;


ALTER FUNCTION "public"."is_member_of_company"("cid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_platform_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.is_active
      and (
        pa.user_id = auth.uid()
        or lower(pa.email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
      )
  );
$$;


ALTER FUNCTION "public"."is_platform_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_privileged_member"("p_company" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('OWNER','ADMIN','MANAGER')
  );
$$;


ALTER FUNCTION "public"."is_privileged_member"("p_company" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_credit_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "original_sales_invoice_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "internal_reference" "text" NOT NULL,
    "source_origin" "text" DEFAULT 'native'::"text" NOT NULL,
    "moz_document_code" "text" DEFAULT 'NC'::"text" NOT NULL,
    "fiscal_series_code" "text",
    "fiscal_year" integer,
    "fiscal_sequence_number" integer,
    "credit_note_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date",
    "currency_code" "text" DEFAULT 'MZN'::"text" NOT NULL,
    "fx_to_base" numeric DEFAULT 1 NOT NULL,
    "subtotal" numeric DEFAULT 0 NOT NULL,
    "tax_total" numeric DEFAULT 0 NOT NULL,
    "total_amount" numeric DEFAULT 0 NOT NULL,
    "subtotal_mzn" numeric DEFAULT 0 NOT NULL,
    "tax_total_mzn" numeric DEFAULT 0 NOT NULL,
    "total_amount_mzn" numeric DEFAULT 0 NOT NULL,
    "correction_reason_code" "text",
    "correction_reason_text" "text" DEFAULT ''::"text" NOT NULL,
    "seller_legal_name_snapshot" "text",
    "seller_trade_name_snapshot" "text",
    "seller_nuit_snapshot" "text",
    "seller_address_line1_snapshot" "text",
    "seller_address_line2_snapshot" "text",
    "seller_city_snapshot" "text",
    "seller_state_snapshot" "text",
    "seller_postal_code_snapshot" "text",
    "seller_country_code_snapshot" "text",
    "buyer_legal_name_snapshot" "text",
    "buyer_nuit_snapshot" "text",
    "buyer_address_line1_snapshot" "text",
    "buyer_address_line2_snapshot" "text",
    "buyer_city_snapshot" "text",
    "buyer_state_snapshot" "text",
    "buyer_postal_code_snapshot" "text",
    "buyer_country_code_snapshot" "text",
    "document_language_code_snapshot" "text",
    "computer_processed_phrase_snapshot" "text",
    "compliance_rule_version_snapshot" "text",
    "document_workflow_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "issued_at" timestamp with time zone,
    "issued_by" "uuid",
    "voided_at" timestamp with time zone,
    "voided_by" "uuid",
    "void_reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vat_exemption_reason_text" "text",
    CONSTRAINT "sales_credit_notes_document_workflow_status_check" CHECK (("document_workflow_status" = ANY (ARRAY['draft'::"text", 'issued'::"text", 'voided'::"text"]))),
    CONSTRAINT "sales_credit_notes_fiscal_sequence_number_check" CHECK ((("fiscal_sequence_number" IS NULL) OR ("fiscal_sequence_number" >= 1))),
    CONSTRAINT "sales_credit_notes_fiscal_year_check" CHECK ((("fiscal_year" IS NULL) OR (("fiscal_year" >= 2000) AND ("fiscal_year" <= 9999)))),
    CONSTRAINT "sales_credit_notes_fx_to_base_check" CHECK (("fx_to_base" > (0)::numeric)),
    CONSTRAINT "sales_credit_notes_internal_reference_format" CHECK (((("source_origin" = 'native'::"text") AND ("internal_reference" ~ '^[A-Z0-9]{3}-[A-Z0-9]{2,10}[0-9]{4}-[0-9]{5}$'::"text")) OR (("source_origin" = 'imported'::"text") AND (NULLIF("btrim"(COALESCE("internal_reference", ''::"text")), ''::"text") IS NOT NULL)))),
    CONSTRAINT "sales_credit_notes_moz_document_code_check" CHECK (("moz_document_code" = 'NC'::"text")),
    CONSTRAINT "sales_credit_notes_source_origin_check" CHECK (("source_origin" = ANY (ARRAY['native'::"text", 'imported'::"text"]))),
    CONSTRAINT "sales_credit_notes_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "sales_credit_notes_subtotal_mzn_check" CHECK (("subtotal_mzn" >= (0)::numeric)),
    CONSTRAINT "sales_credit_notes_tax_total_check" CHECK (("tax_total" >= (0)::numeric)),
    CONSTRAINT "sales_credit_notes_tax_total_mzn_check" CHECK (("tax_total_mzn" >= (0)::numeric)),
    CONSTRAINT "sales_credit_notes_total_amount_check" CHECK (("total_amount" >= (0)::numeric)),
    CONSTRAINT "sales_credit_notes_total_amount_mzn_check" CHECK (("total_amount_mzn" >= (0)::numeric))
);


ALTER TABLE "public"."sales_credit_notes" OWNER TO "postgres";


COMMENT ON TABLE "public"."sales_credit_notes" IS 'Mozambique-compliant sales credit notes linked to the original issued sales invoice.';



COMMENT ON COLUMN "public"."sales_credit_notes"."vat_exemption_reason_text" IS 'Manual Mozambique VAT exemption reason captured before credit-note issue when exempt lines exist.';



CREATE OR REPLACE FUNCTION "public"."issue_sales_credit_note_mz"("p_note_id" "uuid") RETURNS "public"."sales_credit_notes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_note public.sales_credit_notes;
begin
  select scn.*
    into v_note
  from public.sales_credit_notes scn
  where scn.id = p_note_id;

  if v_note.id is null then
    raise exception using
      message = 'Sales credit note not found.';
  end if;

  if not public.finance_documents_can_issue_adjustment(v_note.company_id) then
    raise exception using
      message = 'Sales credit note issue access denied.';
  end if;

  if v_note.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft sales credit notes can be issued.';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  update public.sales_credit_notes scn
     set document_workflow_status = 'issued'
   where scn.id = p_note_id
  returning scn.* into v_note;

  return v_note;
end;
$$;


ALTER FUNCTION "public"."issue_sales_credit_note_mz"("p_note_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_debit_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "original_sales_invoice_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "internal_reference" "text" NOT NULL,
    "source_origin" "text" DEFAULT 'native'::"text" NOT NULL,
    "moz_document_code" "text" DEFAULT 'ND'::"text" NOT NULL,
    "fiscal_series_code" "text",
    "fiscal_year" integer,
    "fiscal_sequence_number" integer,
    "debit_note_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date" NOT NULL,
    "currency_code" "text" DEFAULT 'MZN'::"text" NOT NULL,
    "fx_to_base" numeric DEFAULT 1 NOT NULL,
    "subtotal" numeric DEFAULT 0 NOT NULL,
    "tax_total" numeric DEFAULT 0 NOT NULL,
    "total_amount" numeric DEFAULT 0 NOT NULL,
    "subtotal_mzn" numeric DEFAULT 0 NOT NULL,
    "tax_total_mzn" numeric DEFAULT 0 NOT NULL,
    "total_amount_mzn" numeric DEFAULT 0 NOT NULL,
    "correction_reason_code" "text",
    "correction_reason_text" "text" DEFAULT ''::"text" NOT NULL,
    "seller_legal_name_snapshot" "text",
    "seller_trade_name_snapshot" "text",
    "seller_nuit_snapshot" "text",
    "seller_address_line1_snapshot" "text",
    "seller_address_line2_snapshot" "text",
    "seller_city_snapshot" "text",
    "seller_state_snapshot" "text",
    "seller_postal_code_snapshot" "text",
    "seller_country_code_snapshot" "text",
    "buyer_legal_name_snapshot" "text",
    "buyer_nuit_snapshot" "text",
    "buyer_address_line1_snapshot" "text",
    "buyer_address_line2_snapshot" "text",
    "buyer_city_snapshot" "text",
    "buyer_state_snapshot" "text",
    "buyer_postal_code_snapshot" "text",
    "buyer_country_code_snapshot" "text",
    "document_language_code_snapshot" "text",
    "computer_processed_phrase_snapshot" "text",
    "compliance_rule_version_snapshot" "text",
    "document_workflow_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "issued_at" timestamp with time zone,
    "issued_by" "uuid",
    "voided_at" timestamp with time zone,
    "voided_by" "uuid",
    "void_reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_debit_notes_document_workflow_status_check" CHECK (("document_workflow_status" = ANY (ARRAY['draft'::"text", 'issued'::"text", 'voided'::"text"]))),
    CONSTRAINT "sales_debit_notes_fiscal_sequence_number_check" CHECK ((("fiscal_sequence_number" IS NULL) OR ("fiscal_sequence_number" >= 1))),
    CONSTRAINT "sales_debit_notes_fiscal_year_check" CHECK ((("fiscal_year" IS NULL) OR (("fiscal_year" >= 2000) AND ("fiscal_year" <= 9999)))),
    CONSTRAINT "sales_debit_notes_fx_to_base_check" CHECK (("fx_to_base" > (0)::numeric)),
    CONSTRAINT "sales_debit_notes_internal_reference_format" CHECK (((("source_origin" = 'native'::"text") AND ("internal_reference" ~ '^[A-Z0-9]{3}-[A-Z0-9]{2,10}[0-9]{4}-[0-9]{5}$'::"text")) OR (("source_origin" = 'imported'::"text") AND (NULLIF("btrim"(COALESCE("internal_reference", ''::"text")), ''::"text") IS NOT NULL)))),
    CONSTRAINT "sales_debit_notes_moz_document_code_check" CHECK (("moz_document_code" = 'ND'::"text")),
    CONSTRAINT "sales_debit_notes_source_origin_check" CHECK (("source_origin" = ANY (ARRAY['native'::"text", 'imported'::"text"]))),
    CONSTRAINT "sales_debit_notes_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "sales_debit_notes_subtotal_mzn_check" CHECK (("subtotal_mzn" >= (0)::numeric)),
    CONSTRAINT "sales_debit_notes_tax_total_check" CHECK (("tax_total" >= (0)::numeric)),
    CONSTRAINT "sales_debit_notes_tax_total_mzn_check" CHECK (("tax_total_mzn" >= (0)::numeric)),
    CONSTRAINT "sales_debit_notes_total_amount_check" CHECK (("total_amount" >= (0)::numeric)),
    CONSTRAINT "sales_debit_notes_total_amount_mzn_check" CHECK (("total_amount_mzn" >= (0)::numeric))
);


ALTER TABLE "public"."sales_debit_notes" OWNER TO "postgres";


COMMENT ON TABLE "public"."sales_debit_notes" IS 'Mozambique-compliant sales debit notes linked to the original issued sales invoice.';



CREATE OR REPLACE FUNCTION "public"."issue_sales_debit_note_mz"("p_note_id" "uuid") RETURNS "public"."sales_debit_notes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_note public.sales_debit_notes;
begin
  select sdn.*
    into v_note
  from public.sales_debit_notes sdn
  where sdn.id = p_note_id;

  if v_note.id is null then
    raise exception using
      message = 'Sales debit note not found.';
  end if;

  if not public.finance_documents_can_issue_adjustment(v_note.company_id) then
    raise exception using
      message = 'Sales debit note issue access denied.';
  end if;

  if v_note.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft sales debit notes can be issued.';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  update public.sales_debit_notes sdn
     set document_workflow_status = 'issued'
   where sdn.id = p_note_id
  returning sdn.* into v_note;

  return v_note;
end;
$$;


ALTER FUNCTION "public"."issue_sales_debit_note_mz"("p_note_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_sales_invoice_mz"("p_invoice_id" "uuid") RETURNS "public"."sales_invoices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row public.sales_invoices%rowtype;
begin
  select si.*
    into v_row
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_row.id is null then
    raise exception 'sales_invoice_not_found';
  end if;

  if not public.finance_documents_can_issue_legal(v_row.company_id) then
    raise exception 'sales_invoice_issue_access_denied';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception 'sales_invoice_issue_not_draft';
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'approved' then
    raise exception 'sales_invoice_issue_requires_approved_status';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  update public.sales_invoices si
     set document_workflow_status = 'issued'
   where si.id = p_invoice_id
  returning si.* into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."issue_sales_invoice_mz"("p_invoice_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."issue_sales_invoice_mz"("p_invoice_id" "uuid") IS 'Helper path for issuing one Mozambique sales invoice through the same trigger-based validation and immutability rules as direct updates.';



CREATE OR REPLACE FUNCTION "public"."jsonb_deep_merge"("a" "jsonb", "b" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  result jsonb := coalesce(a, '{}'::jsonb);
  k text; v jsonb;
begin
  if b is null then
    return result;
  end if;
  for k, v in select key, value from jsonb_each(b) loop
    if result ? k and jsonb_typeof(result->k) = 'object' and jsonb_typeof(v) = 'object' then
      result := jsonb_set(result, ARRAY[k], public.jsonb_deep_merge(result->k, v), true);
    else
      result := result || jsonb_build_object(k, v);
    end if;
  end loop;
  return result;
end
$$;


ALTER FUNCTION "public"."jsonb_deep_merge"("a" "jsonb", "b" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kick_due_reminder_worker"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_local_day date := (timezone('Africa/Maputo', now()))::date;
BEGIN
  PERFORM public.enqueue_due_reminders_for_all_companies(v_local_day, false);
  PERFORM public.invoke_due_reminder_worker();
END;
$$;


ALTER FUNCTION "public"."kick_due_reminder_worker"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kick_schema_snapshot"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_url text := 'https://ogzhwoqqumkuqhbvuzzp.functions.supabase.co/schema-snapshot-cron?schema=public&persist=true';
  v_resp jsonb;
begin
  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type','application/json'),
    body    := 'null'::jsonb
  )
  into v_resp;

  -- Optional: log response
  raise notice 'schema-snapshot-cron -> %', v_resp;
end;
$$;


ALTER FUNCTION "public"."kick_schema_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."link_invites_to_user"("p_user_id" "uuid", "p_email" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count int := 0;
begin
  update public.company_members
     set user_id = p_user_id
   where user_id is null
     and lower(email) = lower(p_email);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."link_invites_to_user"("p_user_id" "uuid", "p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."link_membership_for_me"("p_company" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_email text := nullif(current_setting('request.jwt.claims', true)::jsonb->>'email','');
  v_uid   uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;

  update public.company_members m
     set user_id = v_uid,
         status  = case when m.status = 'invited'::member_status then 'active'::member_status else m.status end
   where m.company_id = p_company
     and (m.user_id is null or m.user_id = v_uid)
     and coalesce(lower(m.email), '') = lower(coalesce(v_email,''));
  return true;
end;
$$;


ALTER FUNCTION "public"."link_membership_for_me"("p_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."make_order_no"("cid" "uuid", "typ" "text") RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  select public.company_code3(cid)
         || typ
         || to_char(public.next_order_seq(cid, typ), 'FM000000000');
$$;


ALTER FUNCTION "public"."make_order_no"("cid" "uuid", "typ" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."member_has_company_access"("p_company_id" "uuid", "p_include_invited" boolean DEFAULT false) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company_id
      and (
        cm.user_id = auth.uid()
        or lower(cm.email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
      )
      and cm.status = any(
        case
          when p_include_invited
            then array['active'::public.member_status, 'invited'::public.member_status]
          else array['active'::public.member_status]
        end
      )
  )
  and public.company_access_is_enabled(p_company_id);
$$;


ALTER FUNCTION "public"."member_has_company_access"("p_company_id" "uuid", "p_include_invited" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_company_and_role"() RETURNS TABLE("company_id" "uuid", "role" "public"."member_role")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select m.company_id, m.role
  from public.company_members m
  where m.user_id = auth.uid()
    and m.status = 'active'
  order by m.created_at asc
  limit 1
$$;


ALTER FUNCTION "public"."my_company_and_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_default_company"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
  select id
  from public.my_companies
  order by created_at desc
  limit 1
$$;


ALTER FUNCTION "public"."my_default_company"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_role"("p_company" "uuid") RETURNS "public"."member_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  SELECT cm.role
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND cm.user_id = auth.uid()
    AND cm.status = 'active'
  ORDER BY public.role_rank(cm.role) DESC, cm.created_at ASC
  LIMIT 1
$$;


ALTER FUNCTION "public"."my_role"("p_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_finance_document_reference"("p_company_id" "uuid", "p_document_type" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_sequence integer;
  v_prefix text;
  v_code text;
begin
  if p_company_id is null then
    raise exception 'finance_document_company_required';
  end if;

  if not public.finance_documents_can_write(p_company_id) then
    raise exception 'finance_document_company_write_denied';
  end if;

  if p_document_type not in ('sales_invoice', 'vendor_bill', 'vendor_credit_note', 'vendor_debit_note') then
    raise exception 'unsupported_finance_document_type: %', p_document_type;
  end if;

  insert into public.document_number_counters (company_id, document_type, next_number)
  values (p_company_id, p_document_type, 1)
  on conflict (company_id, document_type) do nothing;

  update public.document_number_counters dnc
     set next_number = dnc.next_number + 1,
         updated_at = now()
   where dnc.company_id = p_company_id
     and dnc.document_type = p_document_type
  returning dnc.next_number - 1 into v_sequence;

  if v_sequence is null then
    raise exception 'finance_document_counter_update_failed';
  end if;

  v_prefix := public.finance_document_company_prefix(p_company_id);
  v_code := case
    when p_document_type = 'sales_invoice' then 'INV'
    when p_document_type = 'vendor_bill' then 'VB'
    when p_document_type = 'vendor_credit_note' then 'VCN'
    when p_document_type = 'vendor_debit_note' then 'VDN'
    else 'DOC'
  end;

  return v_prefix || '-' || v_code || lpad(v_sequence::text, 5, '0');
end;
$$;


ALTER FUNCTION "public"."next_finance_document_reference"("p_company_id" "uuid", "p_document_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_fiscal_document_reference"("p_company_id" "uuid", "p_document_type" "text", "p_document_date" "date", "p_source_origin" "text", "p_explicit_reference" "text" DEFAULT NULL::"text") RETURNS TABLE("internal_reference" "text", "fiscal_series_code" "text", "fiscal_year" integer, "fiscal_sequence_number" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_series public.finance_document_fiscal_series%rowtype;
  v_sequence integer;
  v_prefix text;
begin
  if p_company_id is null then
    raise exception 'finance_document_company_required';
  end if;

  if not public.finance_documents_can_write(p_company_id) then
    raise exception 'finance_document_company_write_denied';
  end if;

  if p_source_origin not in ('native', 'imported') then
    raise exception 'finance_document_source_origin_invalid';
  end if;

  if p_source_origin = 'imported' then
    if nullif(btrim(coalesce(p_explicit_reference, '')), '') is null then
      raise exception 'imported_sales_invoice_reference_required';
    end if;

    internal_reference := btrim(p_explicit_reference);
    fiscal_series_code := null;
    fiscal_year := extract(year from coalesce(p_document_date, current_date))::integer;
    fiscal_sequence_number := null;
    return next;
    return;
  end if;

  perform public.ensure_mz_company_fiscal_configuration(
    p_company_id,
    coalesce(p_document_date, current_date)
  );

  v_series := public.resolve_fiscal_series(
    p_company_id,
    p_document_type,
    coalesce(p_document_date, current_date)
  );

  update public.finance_document_fiscal_series fdfs
     set next_number = fdfs.next_number + 1,
         updated_at = now()
   where fdfs.id = v_series.id
  returning fdfs.next_number - 1
    into v_sequence;

  if v_sequence is null then
    raise exception 'finance_document_fiscal_series_update_failed';
  end if;

  v_prefix := public.finance_document_company_prefix(p_company_id);

  internal_reference := v_prefix
    || '-'
    || v_series.series_code
    || v_series.fiscal_year::text
    || '-'
    || lpad(v_sequence::text, 5, '0');
  fiscal_series_code := v_series.series_code;
  fiscal_year := v_series.fiscal_year;
  fiscal_sequence_number := v_sequence;
  return next;
end;
$$;


ALTER FUNCTION "public"."next_fiscal_document_reference"("p_company_id" "uuid", "p_document_type" "text", "p_document_date" "date", "p_source_origin" "text", "p_explicit_reference" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."next_fiscal_document_reference"("p_company_id" "uuid", "p_document_type" "text", "p_document_date" "date", "p_source_origin" "text", "p_explicit_reference" "text") IS 'Allocates the next finance-document reference, auto-bootstrapping Mozambique draft defaults for native documents when the company has not been configured yet.';



CREATE OR REPLACE FUNCTION "public"."next_order_seq"("cid" "uuid", "typ" "text") RETURNS bigint
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with up as (
    insert into public.order_counters(company_id, type, last_value)
    values (cid, typ, 1)
    on conflict (company_id, type)
    do update set last_value = public.order_counters.last_value + 1,
                 updated_at = now()
    returning last_value
  )
  select last_value from up;
$$;


ALTER FUNCTION "public"."next_order_seq"("cid" "uuid", "typ" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_so_order_no"("p_company_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $_$
declare
  v_prefix text;
  v_next   bigint;
begin
  if p_company_id is null then
    raise exception 'next_so_order_no(): company_id is required';
  end if;

  v_prefix := public.company_prefix3(p_company_id);

  select coalesce(
           max( (regexp_match(order_no, '([0-9]+)$'))[1]::bigint ),
           0
         ) + 1
    into v_next
    from public.sales_orders
   where company_id = p_company_id
     and order_no ~ ('^' || v_prefix || '-SO[0-9]{9}$');

  return v_prefix || '-SO' || lpad(v_next::text, 9, '0');
end;
$_$;


ALTER FUNCTION "public"."next_so_order_no"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."only_read_at_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  -- disallow any change to columns other than read_at
  if (to_jsonb(new) - 'read_at') <> (to_jsonb(old) - 'read_at') then
    raise exception 'Only read_at can be updated on notifications';
  end if;

  -- allow setting read_at once (NULL -> NOT NULL). Idempotent if equal.
  if old.read_at is null then
    if new.read_at is null then
      raise exception 'read_at must be set to mark as read';
    end if;
  else
    -- already set; allow no-op but reject changing the timestamp
    if new.read_at is distinct from old.read_at then
      raise exception 'read_at can only be set once';
    end if;
  end if;

  return new;
end
$$;


ALTER FUNCTION "public"."only_read_at_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."parse_due_reminder_lead_days"("p_settings" "jsonb") RETURNS integer[]
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  WITH due_cfg AS (
    SELECT CASE
      WHEN jsonb_typeof(COALESCE(p_settings->'dueReminders'->'leadDays', '[]'::jsonb)) = 'array'
        THEN COALESCE(p_settings->'dueReminders'->'leadDays', '[]'::jsonb)
      ELSE '[]'::jsonb
    END AS cfg
  ),
  parsed AS (
    SELECT DISTINCT (value)::int AS offset_days
    FROM due_cfg, jsonb_array_elements_text(cfg)
    WHERE value ~ '^-?\d+$'
  ),
  sorted AS (
    SELECT offset_days
    FROM parsed
    ORDER BY
      CASE
        WHEN offset_days > 0 THEN 0
        WHEN offset_days = 0 THEN 1
        ELSE 2
      END,
      CASE
        WHEN offset_days > 0 THEN -offset_days
        WHEN offset_days < 0 THEN abs(offset_days)
        ELSE 0
      END
  )
  SELECT COALESCE(
    ARRAY(SELECT offset_days FROM sorted),
    ARRAY[]::int[]
  );
$_$;


ALTER FUNCTION "public"."parse_due_reminder_lead_days"("p_settings" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."parse_due_reminder_send_at"("p_settings" "jsonb") RETURNS time without time zone
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  WITH due_cfg AS (
    SELECT COALESCE(p_settings->'dueReminders', '{}'::jsonb) AS cfg
  ),
  explicit_time AS (
    SELECT NULLIF(trim(cfg->>'sendAt'), '') AS send_at_text
    FROM due_cfg
  ),
  legacy_time AS (
    SELECT
      CASE
        WHEN jsonb_typeof(cfg->'hours') = 'array' AND jsonb_array_length(cfg->'hours') > 0
          THEN NULLIF(cfg->'hours'->>0, '')::numeric
        ELSE NULL
      END AS hour_value
    FROM due_cfg
  )
  SELECT COALESCE(
    CASE
      WHEN explicit_time.send_at_text ~ '^\d{2}:\d{2}$'
        THEN explicit_time.send_at_text::time
      ELSE NULL
    END,
    make_time(
      GREATEST(0, LEAST(23, floor(COALESCE(legacy_time.hour_value, 9))::int)),
      GREATEST(
        0,
        LEAST(
          59,
          round((COALESCE(legacy_time.hour_value, 9) - floor(COALESCE(legacy_time.hour_value, 9))) * 60)::int
        )
      ),
      0
    )
  )
  FROM explicit_time, legacy_time;
$_$;


ALTER FUNCTION "public"."parse_due_reminder_send_at"("p_settings" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pg_column_exists"("p_schema" "name", "p_table" "name", "p_column" "name") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
      from information_schema.columns
     where table_schema = p_schema
       and table_name   = p_table
       and column_name  = p_column
  );
$$;


ALTER FUNCTION "public"."pg_column_exists"("p_schema" "name", "p_table" "name", "p_column" "name") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."platform_admin_get_company_detail"("p_company_id" "uuid") RETURNS TABLE("company_id" "uuid", "company_name" "text", "legal_name" "text", "trade_name" "text", "company_email" "text", "company_preferred_lang" "text", "company_created_at" timestamp with time zone, "owner_user_id" "uuid", "owner_full_name" "text", "owner_email" "text", "owner_member_role" "public"."member_role", "owner_member_status" "public"."member_status", "owner_member_since" timestamp with time zone, "owner_source" "text", "owner_last_sign_in_at" timestamp with time zone, "latest_member_user_id" "uuid", "latest_member_full_name" "text", "latest_member_email" "text", "latest_member_role" "public"."member_role", "latest_member_last_sign_in_at" timestamp with time zone, "member_count" integer, "active_member_count" integer, "plan_code" "text", "plan_name" "text", "subscription_status" "public"."subscription_status", "effective_status" "public"."subscription_status", "trial_started_at" timestamp with time zone, "trial_expires_at" timestamp with time zone, "access_granted_at" timestamp with time zone, "paid_until" timestamp with time zone, "purge_scheduled_at" timestamp with time zone, "purge_completed_at" timestamp with time zone, "access_enabled" boolean, "manual_activation_only" boolean, "notification_recipient_email" "text", "notification_recipient_name" "text", "notification_recipient_source" "text", "reset_allowed" boolean, "reset_blocked_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  return query
  with base as (
    select
      c.id,
      c.name,
      c.legal_name,
      c.trade_name,
      nullif(trim(coalesce(c.email::text, '')), '') as company_email,
      c.preferred_lang,
      c.created_at,
      c.owner_user_id,
      css.plan_code,
      pc.display_name as plan_name,
      css.subscription_status,
      public.company_access_effective_status(c.id) as effective_status,
      css.trial_started_at,
      css.trial_expires_at,
      css.access_granted_at,
      css.paid_until,
      css.purge_scheduled_at,
      css.purge_completed_at,
      public.company_access_is_enabled(c.id) as access_enabled,
      pc.manual_activation_only
    from public.companies c
    join public.company_subscription_state css
      on css.company_id = c.id
    join public.plan_catalog pc
      on pc.code = css.plan_code
    where c.id = p_company_id
  ),
  owner_member as (
    select
      cm.user_id,
      cm.role,
      cm.status,
      cm.created_at,
      p.full_name,
      coalesce(p.email::text, cm.email) as email,
      p.last_sign_in_at
    from public.company_members cm
    join base b
      on b.id = cm.company_id
    left join public.profiles p
      on p.id = cm.user_id
    where cm.status = 'active'::public.member_status
      and cm.role = 'OWNER'::public.member_role
    order by cm.created_at asc, cm.user_id asc
    limit 1
  ),
  admin_member as (
    select
      cm.user_id,
      cm.role,
      cm.status,
      cm.created_at,
      p.full_name,
      coalesce(p.email::text, cm.email) as email,
      p.last_sign_in_at
    from public.company_members cm
    join base b
      on b.id = cm.company_id
    left join public.profiles p
      on p.id = cm.user_id
    where cm.status = 'active'::public.member_status
      and cm.role = 'ADMIN'::public.member_role
    order by cm.created_at asc, cm.user_id asc
    limit 1
  ),
  owner_choice as (
    select
      coalesce(
        b.owner_user_id,
        om.user_id,
        am.user_id
      ) as user_id,
      case
        when b.owner_user_id is not null then 'company_owner'
        when om.user_id is not null then 'active_owner_member'
        when am.user_id is not null then 'active_admin_member'
        else 'not_captured'
      end as owner_source
    from base b
    left join owner_member om on true
    left join admin_member am on true
  ),
  owner_membership as (
    select
      cm.user_id,
      cm.role,
      cm.status,
      cm.created_at,
      p.full_name,
      coalesce(p.email::text, cm.email) as email,
      p.last_sign_in_at
    from owner_choice oc
    join base b
      on true
    left join public.company_members cm
      on cm.company_id = b.id
     and cm.user_id = oc.user_id
    left join public.profiles p
      on p.id = oc.user_id
    order by
      case when cm.status = 'active'::public.member_status then 0 else 1 end,
      case
        when cm.role = 'OWNER'::public.member_role then 0
        when cm.role = 'ADMIN'::public.member_role then 1
        else 2
      end,
      cm.created_at asc nulls last
    limit 1
  ),
  latest_member as (
    select
      cm.user_id,
      cm.role,
      p.full_name,
      coalesce(p.email::text, cm.email) as email,
      p.last_sign_in_at
    from public.company_members cm
    join base b
      on b.id = cm.company_id
    left join public.profiles p
      on p.id = cm.user_id
    where cm.status = 'active'::public.member_status
    order by p.last_sign_in_at desc nulls last, cm.created_at desc
    limit 1
  ),
  member_stats as (
    select
      count(*)::integer as member_count,
      count(*) filter (where cm.status = 'active'::public.member_status)::integer as active_member_count
    from public.company_members cm
    join base b
      on b.id = cm.company_id
  ),
  notification_recipient as (
    select *
    from public.platform_admin_resolve_company_notification_recipient(p_company_id)
  )
  select
    b.id,
    b.name,
    b.legal_name,
    b.trade_name,
    b.company_email,
    b.preferred_lang,
    b.created_at,
    coalesce(oc.user_id, om.user_id, b.owner_user_id),
    coalesce(om.full_name, om.email, null),
    coalesce(om.email, null),
    om.role,
    om.status,
    om.created_at,
    oc.owner_source,
    om.last_sign_in_at,
    lm.user_id,
    lm.full_name,
    lm.email,
    lm.role,
    lm.last_sign_in_at,
    coalesce(ms.member_count, 0),
    coalesce(ms.active_member_count, 0),
    b.plan_code,
    b.plan_name,
    b.subscription_status,
    b.effective_status,
    b.trial_started_at,
    b.trial_expires_at,
    b.access_granted_at,
    b.paid_until,
    b.purge_scheduled_at,
    b.purge_completed_at,
    b.access_enabled,
    b.manual_activation_only,
    nr.recipient_email,
    nr.recipient_name,
    nr.recipient_source,
    (b.effective_status <> 'active_paid'::public.subscription_status) as reset_allowed,
    case
      when b.effective_status = 'active_paid'::public.subscription_status
        then 'Move the company out of active paid access before resetting operational data.'
      else null
    end as reset_blocked_reason
  from base b
  left join owner_choice oc on true
  left join owner_membership om on true
  left join latest_member lm on true
  left join member_stats ms on true
  left join notification_recipient nr on true;
end;
$$;


ALTER FUNCTION "public"."platform_admin_get_company_detail"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."platform_admin_list_company_access"("p_search" "text" DEFAULT NULL::"text") RETURNS TABLE("company_id" "uuid", "company_name" "text", "owner_user_id" "uuid", "plan_code" "text", "plan_name" "text", "subscription_status" "public"."subscription_status", "effective_status" "public"."subscription_status", "trial_started_at" timestamp with time zone, "trial_expires_at" timestamp with time zone, "paid_until" timestamp with time zone, "purge_scheduled_at" timestamp with time zone, "purge_completed_at" timestamp with time zone, "member_count" integer, "active_member_count" integer, "access_enabled" boolean, "updated_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
  select
    c.id,
    c.name,
    c.owner_user_id,
    css.plan_code,
    pc.display_name,
    css.subscription_status,
    public.company_access_effective_status(c.id) as effective_status,
    css.trial_started_at,
    css.trial_expires_at,
    css.paid_until,
    css.purge_scheduled_at,
    css.purge_completed_at,
    (
      select count(*)::integer
      from public.company_members cm
      where cm.company_id = c.id
    ) as member_count,
    (
      select count(*)::integer
      from public.company_members cm
      where cm.company_id = c.id
        and cm.status = 'active'::public.member_status
    ) as active_member_count,
    public.company_access_is_enabled(c.id) as access_enabled,
    css.updated_at
  from public.companies c
  join public.company_subscription_state css
    on css.company_id = c.id
  join public.plan_catalog pc
    on pc.code = css.plan_code
  where public.is_platform_admin()
    and (
      p_search is null
      or btrim(p_search) = ''
      or c.name ilike '%' || btrim(p_search) || '%'
      or c.id::text = btrim(p_search)
      or css.plan_code ilike '%' || btrim(p_search) || '%'
    )
  order by css.updated_at desc, c.created_at desc;
$$;


ALTER FUNCTION "public"."platform_admin_list_company_access"("p_search" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."platform_admin_list_company_access_events"("p_company_id" "uuid") RETURNS TABLE("id" "uuid", "company_id" "uuid", "previous_plan_code" "text", "next_plan_code" "text", "previous_status" "public"."subscription_status", "next_status" "public"."subscription_status", "actor_user_id" "uuid", "actor_email" "text", "reason" "text", "context" "jsonb", "created_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
  select
    log.id,
    log.company_id,
    log.previous_plan_code,
    log.next_plan_code,
    log.previous_status,
    log.next_status,
    log.actor_user_id,
    log.actor_email,
    log.reason,
    log.context,
    log.created_at
  from public.company_access_audit_log log
  where public.is_platform_admin()
    and log.company_id = p_company_id
  order by log.created_at desc;
$$;


ALTER FUNCTION "public"."platform_admin_list_company_access_events"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."platform_admin_list_company_control_actions"("p_company_id" "uuid") RETURNS TABLE("id" "uuid", "company_id" "uuid", "action_type" "text", "actor_user_id" "uuid", "actor_email" "text", "reason" "text", "context" "jsonb", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  return query
  select
    log.id,
    log.company_id,
    log.action_type,
    log.actor_user_id,
    log.actor_email,
    log.reason,
    log.context,
    log.created_at
  from public.company_control_action_log log
  where log.company_id = p_company_id
  order by log.created_at desc;
end;
$$;


ALTER FUNCTION "public"."platform_admin_list_company_control_actions"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."platform_admin_record_company_access_email"("p_company_id" "uuid", "p_template_key" "text", "p_recipient_email" "text", "p_recipient_source" "text", "p_subject" "text", "p_reason" "text" DEFAULT NULL::"text", "p_context" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
declare
  v_action_type text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_recipient_email text := nullif(trim(coalesce(p_recipient_email, '')), '');
  v_recipient_source text := nullif(trim(coalesce(p_recipient_source, '')), '');
  v_subject text := nullif(trim(coalesce(p_subject, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  if p_company_id is null then
    raise exception 'company_required' using errcode = '22023';
  end if;

  if v_recipient_email is null then
    raise exception 'company_notification_recipient_missing' using errcode = 'P0001';
  end if;

  if v_subject is null then
    raise exception 'company_access_email_subject_required' using errcode = 'P0001';
  end if;

  v_action_type := case trim(coalesce(p_template_key, ''))
    when 'expiry_warning' then 'access_email_expiry_warning_sent'
    when 'purge_warning' then 'access_email_purge_warning_sent'
    when 'activation_confirmation' then 'access_email_activation_confirmation_sent'
    else null
  end;

  if v_action_type is null then
    raise exception 'company_access_email_template_invalid' using errcode = '22023';
  end if;

  return public.record_company_control_action(
    p_company_id,
    v_action_type,
    coalesce(v_reason, 'Company access email sent'),
    coalesce(p_context, '{}'::jsonb) || jsonb_build_object(
      'template_key', trim(coalesce(p_template_key, '')),
      'recipient_email', v_recipient_email,
      'recipient_source', coalesce(v_recipient_source, 'not_captured'),
      'subject', v_subject
    )
  );
end;
$$;


ALTER FUNCTION "public"."platform_admin_record_company_access_email"("p_company_id" "uuid", "p_template_key" "text", "p_recipient_email" "text", "p_recipient_source" "text", "p_subject" "text", "p_reason" "text", "p_context" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."platform_admin_reset_company_operational_data"("p_company_id" "uuid", "p_confirmation" "text", "p_reason" "text") RETURNS TABLE("company_id" "uuid", "performed_at" timestamp with time zone, "deleted_summary" "jsonb", "preserved_scope" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
declare
  v_now timestamptz := timezone('utc', now());
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_effective_status public.subscription_status;
  v_rate_allowed boolean;
  v_rate_retry integer;
  v_rows integer := 0;
  v_summary jsonb := '{}'::jsonb;
  v_preserved_scope jsonb := jsonb_build_object(
    'retained', jsonb_build_array(
      'company_shell',
      'company_memberships',
      'user_active_company',
      'company_settings',
      'payment_terms',
      'company_currencies',
      'company_fiscal_settings',
      'finance_document_fiscal_series',
      'document_number_counters',
      'subscription_state',
      'company_access_audit_log',
      'company_purge_queue',
      'company_control_action_log',
      'platform_admin_identity',
      'auth_credentials'
    )
  );
begin
  if not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select allowed, retry_after_seconds
    into v_rate_allowed, v_rate_retry
  from public.consume_security_rate_limit(
    'platform_admin_reset_company_operational_data',
    coalesce(auth.uid()::text, lower(coalesce((auth.jwt() ->> 'email')::text, 'anonymous'))),
    900,
    5
  );

  if coalesce(v_rate_allowed, false) = false then
    raise exception 'platform_admin_company_reset_rate_limited_retry_after_%s', coalesce(v_rate_retry, 900)
      using errcode = 'P0001';
  end if;

  if p_company_id is null then
    raise exception 'company_reset_company_required' using errcode = '22023';
  end if;

  if p_confirmation is distinct from p_company_id::text then
    raise exception 'company_reset_confirmation_mismatch' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'company_reset_reason_required' using errcode = 'P0001';
  end if;

  perform 1
  from public.companies c
  where c.id = p_company_id
  for update;

  if not found then
    raise exception 'company_not_found' using errcode = 'P0001';
  end if;

  perform 1
  from public.company_subscription_state css
  where css.company_id = p_company_id
  for update;

  if not found then
    raise exception 'company_subscription_state_missing' using errcode = 'P0001';
  end if;

  v_effective_status := public.company_access_effective_status(p_company_id);

  if v_effective_status = 'active_paid'::public.subscription_status then
    raise exception 'company_reset_active_paid_not_allowed' using errcode = 'P0001';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  delete from public.notifications n where n.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('notifications', v_rows);

  delete from public.due_reminder_queue drq where drq.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('due_reminder_queue', v_rows);

  delete from public.whatsapp_webhook_events wwe where wwe.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('whatsapp_webhook_events', v_rows);

  delete from public.whatsapp_outbox wo where wo.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('whatsapp_outbox', v_rows);

  delete from public.bank_transactions bt
  where bt.bank_id in (
    select ba.id
    from public.bank_accounts ba
    where ba.company_id = p_company_id
  );
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('bank_transactions', v_rows);

  delete from public.cash_transactions ct where ct.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('cash_transactions', v_rows);

  delete from public.fiscal_document_artifacts fda where fda.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('fiscal_document_artifacts', v_rows);

  delete from public.finance_document_events fde where fde.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('finance_document_events', v_rows);

  delete from public.landed_cost_run_lines lcrl where lcrl.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('landed_cost_run_lines', v_rows);

  delete from public.landed_cost_runs lcr where lcr.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('landed_cost_runs', v_rows);

  delete from public.sales_credit_note_lines scnl where scnl.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_credit_note_lines', v_rows);

  delete from public.sales_debit_note_lines sdnl where sdnl.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_debit_note_lines', v_rows);

  delete from public.vendor_credit_note_lines vcnl where vcnl.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('vendor_credit_note_lines', v_rows);

  delete from public.vendor_debit_note_lines vdnl where vdnl.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('vendor_debit_note_lines', v_rows);

  delete from public.vendor_bill_lines vbl where vbl.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('vendor_bill_lines', v_rows);

  delete from public.sales_invoice_lines sil where sil.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_invoice_lines', v_rows);

  delete from public.sales_credit_notes scn where scn.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_credit_notes', v_rows);

  delete from public.sales_debit_notes sdn where sdn.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_debit_notes', v_rows);

  delete from public.vendor_credit_notes vcn where vcn.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('vendor_credit_notes', v_rows);

  delete from public.vendor_debit_notes vdn where vdn.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('vendor_debit_notes', v_rows);

  delete from public.saft_moz_exports sme where sme.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('saft_moz_exports', v_rows);

  delete from public.vendor_bills vb where vb.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('vendor_bills', v_rows);

  delete from public.sales_invoices si where si.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_invoices', v_rows);

  delete from public.purchase_order_lines pol where pol.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('purchase_order_lines', v_rows);

  delete from public.sales_order_lines sol where sol.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_order_lines', v_rows);

  delete from public.purchase_orders po where po.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('purchase_orders', v_rows);

  delete from public.sales_orders so where so.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_orders', v_rows);

  delete from public.stock_movements sm where sm.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('stock_movements', v_rows);

  delete from public.stock_levels sl where sl.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('stock_levels', v_rows);

  delete from public.builds bld where bld.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('builds', v_rows);

  delete from public.bom_components bc
  where bc.bom_id in (
    select b.id
    from public.boms b
    where b.company_id = p_company_id
  );
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('bom_components', v_rows);

  delete from public.boms b where b.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('boms', v_rows);

  delete from public.bank_accounts ba where ba.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('bank_accounts', v_rows);

  delete from public.cash_books cb where cb.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('cash_books', v_rows);

  delete from public.bins bin
  where bin."warehouseId" in (
    select w.id
    from public.warehouses w
    where w.company_id = p_company_id
  );
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('bins', v_rows);

  delete from public.warehouses w where w.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('warehouses', v_rows);

  delete from public.customers c where c.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('customers', v_rows);

  delete from public.suppliers s where s.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('suppliers', v_rows);

  delete from public.items i where i.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('items', v_rows);

  delete from public.uom_conversions uc where uc.company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('uom_conversions', v_rows);

  update public.company_subscription_state css
     set purge_scheduled_at = null,
         purge_completed_at = v_now,
         updated_by = auth.uid()
   where css.company_id = p_company_id;

  insert into public.company_purge_queue (
    company_id,
    scheduled_for,
    status,
    target_scope,
    reason,
    created_by,
    completed_at
  )
  values (
    p_company_id,
    v_now,
    'completed',
    jsonb_build_object('operational_data', true, 'identity_credentials', false),
    v_reason,
    auth.uid(),
    v_now
  )
  on conflict on constraint company_purge_queue_company_id_key do update
     set scheduled_for = excluded.scheduled_for,
         status = 'completed',
         target_scope = excluded.target_scope,
         reason = excluded.reason,
         completed_at = excluded.completed_at,
         updated_at = v_now;

  perform public.record_company_control_action(
    p_company_id,
    'operational_reset',
    v_reason,
    jsonb_build_object(
      'effective_status', v_effective_status,
      'deleted_summary', v_summary,
      'preserved_scope', v_preserved_scope
    )
  );

  return query
  select
    p_company_id,
    v_now,
    v_summary,
    v_preserved_scope;
end;
$$;


ALTER FUNCTION "public"."platform_admin_reset_company_operational_data"("p_company_id" "uuid", "p_confirmation" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."platform_admin_resolve_company_notification_recipient"("p_company_id" "uuid") RETURNS TABLE("recipient_email" "text", "recipient_name" "text", "recipient_source" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  return query
  with base as (
    select
      c.id,
      c.name,
      nullif(trim(coalesce(c.email::text, '')), '') as company_email,
      c.owner_user_id
    from public.companies c
    where c.id = p_company_id
  ),
  owner_member as (
    select
      cm.user_id,
      cm.role,
      cm.status,
      cm.created_at,
      p.full_name,
      nullif(trim(coalesce(p.email::text, cm.email, '')), '') as email
    from public.company_members cm
    join base b
      on b.id = cm.company_id
    left join public.profiles p
      on p.id = cm.user_id
    where cm.status = 'active'::public.member_status
      and cm.role = 'OWNER'::public.member_role
    order by cm.created_at asc, cm.user_id asc
    limit 1
  ),
  admin_member as (
    select
      cm.user_id,
      cm.role,
      cm.status,
      cm.created_at,
      p.full_name,
      nullif(trim(coalesce(p.email::text, cm.email, '')), '') as email
    from public.company_members cm
    join base b
      on b.id = cm.company_id
    left join public.profiles p
      on p.id = cm.user_id
    where cm.status = 'active'::public.member_status
      and cm.role = 'ADMIN'::public.member_role
    order by cm.created_at asc, cm.user_id asc
    limit 1
  ),
  owner_choice as (
    select
      coalesce(
        b.owner_user_id,
        om.user_id,
        am.user_id
      ) as user_id
    from base b
    left join owner_member om on true
    left join admin_member am on true
  ),
  owner_profile as (
    select
      coalesce(p.full_name, cm.email, p.email::text) as full_name,
      nullif(trim(coalesce(p.email::text, cm.email, '')), '') as email
    from owner_choice oc
    join base b
      on true
    left join public.company_members cm
      on cm.company_id = b.id
     and cm.user_id = oc.user_id
    left join public.profiles p
      on p.id = oc.user_id
    order by
      case when cm.status = 'active'::public.member_status then 0 else 1 end,
      case
        when cm.role = 'OWNER'::public.member_role then 0
        when cm.role = 'ADMIN'::public.member_role then 1
        else 2
      end,
      cm.created_at asc nulls last
    limit 1
  )
  select
    coalesce(b.company_email, op.email, am.email) as recipient_email,
    case
      when b.company_email is not null then coalesce(nullif(trim(coalesce(b.name, '')), ''), 'Company contact')
      when op.full_name is not null then op.full_name
      when op.email is not null then op.email
      when am.full_name is not null then am.full_name
      when am.email is not null then am.email
      else null
    end as recipient_name,
    case
      when b.company_email is not null then 'company_email'
      when op.email is not null then 'owner_email'
      when am.email is not null then 'active_admin_email'
      else 'not_captured'
    end as recipient_source
  from base b
  left join owner_profile op on true
  left join admin_member am on true;
end;
$$;


ALTER FUNCTION "public"."platform_admin_resolve_company_notification_recipient"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."platform_admin_set_company_access"("p_company_id" "uuid", "p_plan_code" "text", "p_status" "public"."subscription_status", "p_paid_until" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_trial_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_purge_scheduled_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("company_id" "uuid", "plan_code" "text", "subscription_status" "public"."subscription_status", "effective_status" "public"."subscription_status", "trial_expires_at" timestamp with time zone, "paid_until" timestamp with time zone, "purge_scheduled_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
declare
  v_existing public.company_subscription_state%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_rate_allowed boolean;
  v_rate_retry integer;
  v_trial_expires_at timestamptz;
  v_purge_scheduled_at timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select allowed, retry_after_seconds
    into v_rate_allowed, v_rate_retry
  from public.consume_security_rate_limit(
    'platform_admin_set_company_access',
    coalesce(auth.uid()::text, lower(coalesce((auth.jwt() ->> 'email')::text, 'anonymous'))),
    60,
    30
  );

  if coalesce(v_rate_allowed, false) = false then
    raise exception 'platform_admin_rate_limited_retry_after_%s', coalesce(v_rate_retry, 60)
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.plan_catalog pc
    where pc.code = p_plan_code
  ) then
    raise exception 'invalid_plan_code' using errcode = '22023';
  end if;

  select *
    into v_existing
  from public.company_subscription_state css
  where css.company_id = p_company_id
  for update;

  if not found then
    raise exception 'company_subscription_state_missing' using errcode = 'P0001';
  end if;

  v_trial_expires_at := case
    when p_status = 'trial'::public.subscription_status then coalesce(p_trial_expires_at, v_now + interval '7 days')
    else null
  end;

  v_purge_scheduled_at := case
    when p_status = 'trial'::public.subscription_status then coalesce(p_purge_scheduled_at, v_trial_expires_at + interval '14 days')
    when p_status = 'expired'::public.subscription_status then coalesce(p_purge_scheduled_at, v_now + interval '14 days')
    else null
  end;

  update public.company_subscription_state css
     set plan_code = p_plan_code,
         subscription_status = p_status,
         trial_started_at = case
           when p_status = 'trial'::public.subscription_status then coalesce(v_existing.trial_started_at, v_now)
           else v_existing.trial_started_at
         end,
         trial_expires_at = case
           when p_status = 'trial'::public.subscription_status then v_trial_expires_at
           else null
         end,
         paid_until = case
           when p_status = 'active_paid'::public.subscription_status then p_paid_until
           else null
         end,
         access_granted_by = case
           when p_status in ('trial'::public.subscription_status, 'active_paid'::public.subscription_status) then auth.uid()
           else v_existing.access_granted_by
         end,
         access_granted_at = case
           when p_status in ('trial'::public.subscription_status, 'active_paid'::public.subscription_status) then v_now
           else v_existing.access_granted_at
         end,
         grant_reason = case
           when p_status in ('trial'::public.subscription_status, 'active_paid'::public.subscription_status) then nullif(trim(coalesce(p_reason, '')), '')
           else v_existing.grant_reason
         end,
         access_revoked_by = case
           when p_status in ('expired'::public.subscription_status, 'suspended'::public.subscription_status, 'disabled'::public.subscription_status) then auth.uid()
           else null
         end,
         access_revoked_at = case
           when p_status in ('expired'::public.subscription_status, 'suspended'::public.subscription_status, 'disabled'::public.subscription_status) then v_now
           else null
         end,
         revoke_reason = case
           when p_status in ('expired'::public.subscription_status, 'suspended'::public.subscription_status, 'disabled'::public.subscription_status) then nullif(trim(coalesce(p_reason, '')), '')
           else null
         end,
         purge_scheduled_at = v_purge_scheduled_at,
         updated_by = auth.uid()
   where css.company_id = p_company_id;

  perform public.sync_company_purge_queue(
    p_company_id,
    v_purge_scheduled_at,
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Subscription access updated'),
    auth.uid()
  );

  perform public.record_company_access_audit(
    p_company_id,
    v_existing.plan_code,
    p_plan_code,
    v_existing.subscription_status,
    p_status,
    p_reason,
    jsonb_build_object(
      'paid_until', p_paid_until,
      'trial_expires_at', v_trial_expires_at,
      'purge_scheduled_at', v_purge_scheduled_at
    )
  );

  return query
  select
    css.company_id,
    css.plan_code,
    css.subscription_status,
    public.company_access_effective_status(css.company_id),
    css.trial_expires_at,
    css.paid_until,
    css.purge_scheduled_at
  from public.company_subscription_state css
  where css.company_id = p_company_id;
end;
$$;


ALTER FUNCTION "public"."platform_admin_set_company_access"("p_company_id" "uuid", "p_plan_code" "text", "p_status" "public"."subscription_status", "p_paid_until" timestamp with time zone, "p_trial_expires_at" timestamp with time zone, "p_purge_scheduled_at" timestamp with time zone, "p_reason" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text",
    "supplier_id" "uuid" NOT NULL,
    "order_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "currency_code" character(3) NOT NULL,
    "status" "public"."po_status" DEFAULT 'draft'::"public"."po_status" NOT NULL,
    "subtotal" numeric(18,4) DEFAULT 0 NOT NULL,
    "tax_total" numeric(18,4) DEFAULT 0 NOT NULL,
    "total" numeric(18,4) DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expected_date" "date",
    "fx_to_base" numeric(18,6) DEFAULT 1 NOT NULL,
    "supplier" "text",
    "public_id" "text" GENERATED ALWAYS AS (('PO-'::"text" || "left"(("id")::"text", 8))) STORED,
    "received_at" timestamp with time zone,
    "payment_terms" "text",
    "supplier_name" "text",
    "supplier_email" "text",
    "supplier_phone" "text",
    "supplier_tax_id" "text",
    "total_amount" numeric,
    "company_id" "uuid",
    "order_no" "text",
    "payment_terms_id" "uuid",
    "due_date" "date",
    "reference_no" "text",
    "delivery_terms" "text",
    "internal_notes" "text",
    "prepared_by" "text",
    "approved_by" "text",
    "received_by" "text",
    CONSTRAINT "po_order_no_format_chk" CHECK ((("order_no" IS NULL) OR ("order_no" ~ '^[A-Z]{3}-PO[0-9]{9}$'::"text")))
);

ALTER TABLE ONLY "public"."purchase_orders" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_orders" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."po_balance_due_base"("p_row" "public"."purchase_orders") RETURNS numeric
    LANGUAGE "sql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT
    (
      COALESCE(p_row.total,0)::numeric * COALESCE(p_row.fx_to_base,1)::numeric
      -
      COALESCE((
        SELECT SUM(ct.amount_base)
        FROM public.cash_transactions ct
        WHERE ct.company_id = p_row.company_id
          AND ct.ref_type   = 'PO'
          AND ct.ref_id     = p_row.id
          AND ct.type       = 'purchase_payment'
      ), 0)::numeric
    )
$$;


ALTER FUNCTION "public"."po_balance_due_base"("p_row" "public"."purchase_orders") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."po_is_awaiting_now"("p_row" "public"."purchase_orders") RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT
    (p_row.status::text = 'closed')
    AND (
      COALESCE(p_row.total,0)::numeric * COALESCE(p_row.fx_to_base,1)::numeric
      -
      COALESCE((
        SELECT SUM(ct.amount_base)
        FROM public.cash_transactions ct
        WHERE ct.company_id = p_row.company_id
          AND ct.ref_type   = 'PO'
          AND ct.ref_id     = p_row.id
          AND ct.type       = 'purchase_payment'
      ), 0)::numeric
    ) > 0
$$;


ALTER FUNCTION "public"."po_is_awaiting_now"("p_row" "public"."purchase_orders") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."po_set_company_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.company_id is null then
    new.company_id := public.current_company_id();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."po_set_company_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."po_set_company_id_and_number"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $_$
declare
  v_prefix text;
  v_last   bigint;
  v_next   bigint;
  v_lock   bigint;
begin
  -- If company_id isn't set yet (other trigger will set it), just return
  if new.company_id is null then
    return new;
  end if;

  -- Normalize currency_code to 3-char uppercase (column is character(3))
  if new.currency_code is not null then
    new.currency_code := upper(substr(new.currency_code::text, 1, 3));
  end if;

  -- Only generate an order_no if caller didn't provide one
  if new.order_no is null then
    -- Per-company advisory lock (prevents two inserts picking same number)
    v_lock := ('x' || substr(md5(new.company_id::text), 1, 16))::bit(64)::bigint;
    perform pg_advisory_xact_lock(v_lock);

    -- Company prefix (3 letters) or 'XXX'
    select coalesce(public.company_prefix3(new.company_id), 'XXX') into v_prefix;
    if v_prefix is null or length(v_prefix) <> 3 then
      v_prefix := 'XXX';
    end if;

    -- Find last numeric tail used for this company
    select coalesce(max((regexp_match(order_no, '([0-9]+)$'))[1]::bigint), 0)
      into v_last
      from purchase_orders
     where company_id = new.company_id
       and order_no ~ '^[A-Z]{3}-PO[0-9]+$';

    v_next := v_last + 1;

    -- EXACTLY 9 digits to satisfy po_order_no_format_chk
    new.order_no := v_prefix || '-PO' || lpad(v_next::text, 9, '0');
  end if;

  return new;
end
$_$;


ALTER FUNCTION "public"."po_set_company_id_and_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."po_trim_and_close"("p_company_id" "uuid", "p_po_id" "uuid") RETURNS TABLE("closed" boolean, "removed_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_is_member boolean;
  v_line_count integer := 0;
  v_received_line_count integer := 0;
  v_partial_line_count integer := 0;
begin
  select exists(
    select 1
    from public.company_members m
    where m.company_id = p_company_id
      and (m.user_id = auth.uid() or lower(m.email) = lower(coalesce(auth.email(), '')))
      and coalesce(m.status, 'active') in ('active', 'invited')
  ) into v_is_member;

  if not v_is_member then
    raise exception 'not allowed';
  end if;

  /*
   * Receiving is an operational event. It must not delete purchase-order lines,
   * because the lines remain the AP billing source until the vendor bill exists.
   */
  with line_receipts as (
    select
      pol.id,
      coalesce(pol.qty, 0) as ordered_qty,
      coalesce(sum(
        case
          when sm.type = 'receive'
           and sm.ref_type = 'PO'
           and sm.company_id = p_company_id
           and sm.ref_id = p_po_id::text
           and sm.ref_line_id = pol.id
          then coalesce(sm.qty, 0)
          else 0
        end
      ), 0) as received_qty
    from public.purchase_order_lines pol
    left join public.stock_movements sm
      on sm.ref_line_id = pol.id
     and sm.company_id = p_company_id
     and sm.ref_type = 'PO'
     and sm.ref_id = p_po_id::text
    where pol.company_id = p_company_id
      and pol.po_id = p_po_id
    group by pol.id, pol.qty
  )
  select
    count(*)::integer,
    count(*) filter (where received_qty >= ordered_qty and ordered_qty > 0)::integer,
    count(*) filter (where received_qty > 0 and received_qty < ordered_qty)::integer
    into v_line_count, v_received_line_count, v_partial_line_count
  from line_receipts;

  if v_line_count > 0 and v_received_line_count = v_line_count then
    update public.purchase_orders
       set status = 'closed'::po_status,
           received_at = coalesce(received_at, now()),
           updated_at = now()
     where id = p_po_id
       and company_id = p_company_id
       and lower(coalesce(status::text, '')) not in ('cancelled', 'canceled');

    return query select true, 0;
    return;
  end if;

  if v_partial_line_count > 0 or v_received_line_count > 0 then
    update public.purchase_orders
       set status = 'partially_received'::po_status,
           updated_at = now()
     where id = p_po_id
       and company_id = p_company_id
       and lower(coalesce(status::text, '')) not in ('closed', 'cancelled', 'canceled');
  end if;

  return query select false, 0;
end;
$$;


ALTER FUNCTION "public"."po_trim_and_close"("p_company_id" "uuid", "p_po_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."post_vendor_bill_mz"("p_bill_id" "uuid") RETURNS "public"."vendor_bills"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row public.vendor_bills%rowtype;
begin
  select vb.*
    into v_row
  from public.vendor_bills vb
  where vb.id = p_bill_id;

  if v_row.id is null then
    raise exception using
      message = 'Vendor bill not found.';
  end if;

  if not public.finance_documents_can_issue_legal(v_row.company_id) then
    raise exception using
      message = 'Vendor bill post access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft vendor bills can be posted.';
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'approved' then
    raise exception using
      message = 'Vendor bills must be approved before posting.';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  update public.vendor_bills vb
     set document_workflow_status = 'posted'
   where vb.id = p_bill_id
  returning vb.* into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."post_vendor_bill_mz"("p_bill_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_credit_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "original_vendor_bill_id" "uuid" NOT NULL,
    "supplier_id" "uuid",
    "internal_reference" "text" NOT NULL,
    "supplier_document_reference" "text",
    "supplier_document_reference_normalized" "text" GENERATED ALWAYS AS ("public"."normalize_supplier_invoice_reference"("supplier_document_reference")) STORED,
    "note_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date",
    "currency_code" "text" DEFAULT 'MZN'::"text" NOT NULL,
    "fx_to_base" numeric DEFAULT 1 NOT NULL,
    "subtotal" numeric DEFAULT 0 NOT NULL,
    "tax_total" numeric DEFAULT 0 NOT NULL,
    "total_amount" numeric DEFAULT 0 NOT NULL,
    "subtotal_base" numeric DEFAULT 0 NOT NULL,
    "tax_total_base" numeric DEFAULT 0 NOT NULL,
    "total_amount_base" numeric DEFAULT 0 NOT NULL,
    "adjustment_reason_text" "text" DEFAULT ''::"text" NOT NULL,
    "document_workflow_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "posted_at" timestamp with time zone,
    "posted_by" "uuid",
    "voided_at" timestamp with time zone,
    "voided_by" "uuid",
    "void_reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "adjustment_reason_code" "text",
    CONSTRAINT "vendor_credit_notes_document_workflow_status_check" CHECK (("document_workflow_status" = ANY (ARRAY['draft'::"text", 'posted'::"text", 'voided'::"text"]))),
    CONSTRAINT "vendor_credit_notes_fx_to_base_check" CHECK (("fx_to_base" > (0)::numeric)),
    CONSTRAINT "vendor_credit_notes_internal_reference_format" CHECK (("internal_reference" ~ '^[A-Z0-9]{3}-VCN[0-9]{5}$'::"text")),
    CONSTRAINT "vendor_credit_notes_subtotal_base_check" CHECK (("subtotal_base" >= (0)::numeric)),
    CONSTRAINT "vendor_credit_notes_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "vendor_credit_notes_tax_total_base_check" CHECK (("tax_total_base" >= (0)::numeric)),
    CONSTRAINT "vendor_credit_notes_tax_total_check" CHECK (("tax_total" >= (0)::numeric)),
    CONSTRAINT "vendor_credit_notes_total_amount_base_check" CHECK (("total_amount_base" >= (0)::numeric)),
    CONSTRAINT "vendor_credit_notes_total_amount_check" CHECK (("total_amount" >= (0)::numeric))
);


ALTER TABLE "public"."vendor_credit_notes" OWNER TO "postgres";


COMMENT ON TABLE "public"."vendor_credit_notes" IS 'Supplier credit notes linked to the original posted vendor bill so AP liability can be reduced without breaking the audit chain.';



CREATE OR REPLACE FUNCTION "public"."post_vendor_credit_note"("p_note_id" "uuid") RETURNS "public"."vendor_credit_notes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_note public.vendor_credit_notes;
begin
  select vcn.*
    into v_note
  from public.vendor_credit_notes vcn
  where vcn.id = p_note_id;

  if v_note.id is null then
    raise exception using
      message = 'Supplier credit note not found.';
  end if;

  if not public.finance_documents_can_post_adjustment(v_note.company_id) then
    raise exception using
      message = 'Supplier credit note post access denied.';
  end if;

  if v_note.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft supplier credit notes can be posted.';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  update public.vendor_credit_notes vcn
     set document_workflow_status = 'posted'
   where vcn.id = p_note_id
  returning vcn.* into v_note;

  return v_note;
end;
$$;


ALTER FUNCTION "public"."post_vendor_credit_note"("p_note_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_debit_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "original_vendor_bill_id" "uuid" NOT NULL,
    "supplier_id" "uuid",
    "internal_reference" "text" NOT NULL,
    "supplier_document_reference" "text",
    "supplier_document_reference_normalized" "text" GENERATED ALWAYS AS ("public"."normalize_supplier_invoice_reference"("supplier_document_reference")) STORED,
    "note_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date" NOT NULL,
    "currency_code" "text" DEFAULT 'MZN'::"text" NOT NULL,
    "fx_to_base" numeric DEFAULT 1 NOT NULL,
    "subtotal" numeric DEFAULT 0 NOT NULL,
    "tax_total" numeric DEFAULT 0 NOT NULL,
    "total_amount" numeric DEFAULT 0 NOT NULL,
    "subtotal_base" numeric DEFAULT 0 NOT NULL,
    "tax_total_base" numeric DEFAULT 0 NOT NULL,
    "total_amount_base" numeric DEFAULT 0 NOT NULL,
    "adjustment_reason_text" "text" DEFAULT ''::"text" NOT NULL,
    "document_workflow_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "posted_at" timestamp with time zone,
    "posted_by" "uuid",
    "voided_at" timestamp with time zone,
    "voided_by" "uuid",
    "void_reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "adjustment_reason_code" "text",
    CONSTRAINT "vendor_debit_notes_document_workflow_status_check" CHECK (("document_workflow_status" = ANY (ARRAY['draft'::"text", 'posted'::"text", 'voided'::"text"]))),
    CONSTRAINT "vendor_debit_notes_fx_to_base_check" CHECK (("fx_to_base" > (0)::numeric)),
    CONSTRAINT "vendor_debit_notes_internal_reference_format" CHECK (("internal_reference" ~ '^[A-Z0-9]{3}-VDN[0-9]{5}$'::"text")),
    CONSTRAINT "vendor_debit_notes_subtotal_base_check" CHECK (("subtotal_base" >= (0)::numeric)),
    CONSTRAINT "vendor_debit_notes_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "vendor_debit_notes_tax_total_base_check" CHECK (("tax_total_base" >= (0)::numeric)),
    CONSTRAINT "vendor_debit_notes_tax_total_check" CHECK (("tax_total" >= (0)::numeric)),
    CONSTRAINT "vendor_debit_notes_total_amount_base_check" CHECK (("total_amount_base" >= (0)::numeric)),
    CONSTRAINT "vendor_debit_notes_total_amount_check" CHECK (("total_amount" >= (0)::numeric))
);


ALTER TABLE "public"."vendor_debit_notes" OWNER TO "postgres";


COMMENT ON TABLE "public"."vendor_debit_notes" IS 'Supplier debit notes linked to the original posted vendor bill so AP liability can increase coherently through the same document chain.';



CREATE OR REPLACE FUNCTION "public"."post_vendor_debit_note"("p_note_id" "uuid") RETURNS "public"."vendor_debit_notes"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_note public.vendor_debit_notes;
begin
  select vdn.*
    into v_note
  from public.vendor_debit_notes vdn
  where vdn.id = p_note_id;

  if v_note.id is null then
    raise exception using
      message = 'Supplier debit note not found.';
  end if;

  if not public.finance_documents_can_post_adjustment(v_note.company_id) then
    raise exception using
      message = 'Supplier debit note post access denied.';
  end if;

  if v_note.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft supplier debit notes can be posted.';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  update public.vendor_debit_notes vdn
     set document_workflow_status = 'posted'
   where vdn.id = p_note_id
  returning vdn.* into v_note;

  return v_note;
end;
$$;


ALTER FUNCTION "public"."post_vendor_debit_note"("p_note_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_sales_invoice_for_issue_mz"("p_invoice_id" "uuid", "p_vat_exemption_reason_text" "text" DEFAULT NULL::"text") RETURNS "public"."sales_invoices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $_$
declare
  v_row public.sales_invoices%rowtype;
  v_company public.companies%rowtype;
  v_customer public.customers%rowtype;
  v_order public.sales_orders%rowtype;
  v_settings public.company_fiscal_settings%rowtype;
  v_reference_match text[];
  v_fiscal_series_code text;
  v_fiscal_year integer;
  v_fiscal_sequence_number integer;
  v_seller_legal_name text;
  v_seller_trade_name text;
  v_seller_nuit text;
  v_seller_address_line1 text;
  v_seller_address_line2 text;
  v_seller_city text;
  v_seller_state text;
  v_seller_postal_code text;
  v_seller_country_code text;
  v_buyer_legal_name text;
  v_buyer_nuit text;
  v_buyer_address_line1 text;
  v_buyer_address_line2 text;
  v_buyer_country_code text;
  v_document_language_code text;
  v_computer_phrase text;
  v_vat_exemption_reason_text text;
begin
  select si.*
    into v_row
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_row.id is null then
    raise exception 'sales_invoice_not_found';
  end if;

  if not public.finance_documents_can_issue_legal(v_row.company_id) then
    raise exception 'sales_invoice_issue_access_denied';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    return v_row;
  end if;

  select c.*
    into v_company
  from public.companies c
  where c.id = v_row.company_id;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = v_row.company_id
    and cfs.jurisdiction_code = 'MZ';

  if v_row.customer_id is not null then
    select cu.*
      into v_customer
    from public.customers cu
    where cu.company_id = v_row.company_id
      and cu.id = v_row.customer_id;
  end if;

  if v_row.sales_order_id is not null then
    select so.*
      into v_order
    from public.sales_orders so
    where so.company_id = v_row.company_id
      and so.id = v_row.sales_order_id;
  end if;

  v_reference_match := regexp_match(coalesce(v_row.internal_reference, ''), '([A-Z]+)([0-9]{4})-([0-9]{5})$');
  v_fiscal_series_code := case
    when v_row.fiscal_series_code is not null then v_row.fiscal_series_code
    when v_reference_match is not null then v_reference_match[1]
    else null
  end;
  v_fiscal_year := case
    when v_row.fiscal_year is not null then v_row.fiscal_year
    when v_reference_match is not null then v_reference_match[2]::integer
    else null
  end;
  v_fiscal_sequence_number := case
    when v_row.fiscal_sequence_number is not null then v_row.fiscal_sequence_number
    when v_reference_match is not null then v_reference_match[3]::integer
    else null
  end;

  v_seller_legal_name := nullif(
    btrim(
      coalesce(
        v_row.seller_legal_name_snapshot,
        v_company.legal_name,
        v_company.trade_name,
        v_company.name,
        ''
      )
    ),
    ''
  );
  v_seller_trade_name := nullif(
    btrim(
      coalesce(
        v_row.seller_trade_name_snapshot,
        v_company.trade_name,
        v_company.name,
        ''
      )
    ),
    ''
  );
  v_seller_nuit := nullif(btrim(coalesce(v_row.seller_nuit_snapshot, v_company.tax_id, '')), '');
  v_seller_address_line1 := nullif(btrim(coalesce(v_row.seller_address_line1_snapshot, v_company.address_line1, '')), '');
  v_seller_address_line2 := nullif(btrim(coalesce(v_row.seller_address_line2_snapshot, v_company.address_line2, '')), '');
  v_seller_city := nullif(btrim(coalesce(v_row.seller_city_snapshot, v_company.city, '')), '');
  v_seller_state := nullif(btrim(coalesce(v_row.seller_state_snapshot, v_company.state, '')), '');
  v_seller_postal_code := nullif(btrim(coalesce(v_row.seller_postal_code_snapshot, v_company.postal_code, '')), '');
  v_seller_country_code := nullif(btrim(coalesce(v_row.seller_country_code_snapshot, v_company.country_code, '')), '');

  v_buyer_legal_name := nullif(
    btrim(
      coalesce(
        v_row.buyer_legal_name_snapshot,
        v_order.bill_to_name,
        v_customer.name,
        ''
      )
    ),
    ''
  );
  v_buyer_nuit := nullif(
    btrim(
      coalesce(
        v_row.buyer_nuit_snapshot,
        v_order.bill_to_tax_id,
        v_customer.tax_id,
        ''
      )
    ),
    ''
  );
  v_buyer_address_line1 := nullif(
    btrim(
      coalesce(
        v_row.buyer_address_line1_snapshot,
        v_order.bill_to_billing_address,
        v_customer.billing_address,
        ''
      )
    ),
    ''
  );
  v_buyer_address_line2 := nullif(
    btrim(
      coalesce(
        v_row.buyer_address_line2_snapshot,
        v_order.bill_to_shipping_address,
        v_customer.shipping_address,
        ''
      )
    ),
    ''
  );
  v_buyer_country_code := nullif(
    btrim(
      coalesce(
        v_row.buyer_country_code_snapshot,
        v_company.country_code,
        ''
      )
    ),
    ''
  );

  v_document_language_code := nullif(
    btrim(
      coalesce(
        v_row.document_language_code_snapshot,
        v_settings.document_language_code,
        ''
      )
    ),
    ''
  );
  v_computer_phrase := nullif(
    btrim(
      coalesce(
        v_row.computer_processed_phrase_snapshot,
        v_settings.computer_processed_phrase_text,
        ''
      )
    ),
    ''
  );
  v_vat_exemption_reason_text := nullif(
    btrim(
      coalesce(
        p_vat_exemption_reason_text,
        v_row.vat_exemption_reason_text,
        ''
      )
    ),
    ''
  );

  perform set_config('stockwise.sales_invoice_issue_prepare_bypass', 'on', true);

  update public.sales_invoices si
     set fiscal_series_code = coalesce(v_fiscal_series_code, si.fiscal_series_code),
         fiscal_year = coalesce(v_fiscal_year, si.fiscal_year),
         fiscal_sequence_number = coalesce(v_fiscal_sequence_number, si.fiscal_sequence_number),
         seller_legal_name_snapshot = coalesce(v_seller_legal_name, si.seller_legal_name_snapshot),
         seller_trade_name_snapshot = coalesce(v_seller_trade_name, si.seller_trade_name_snapshot),
         seller_nuit_snapshot = coalesce(v_seller_nuit, si.seller_nuit_snapshot),
         seller_address_line1_snapshot = coalesce(v_seller_address_line1, si.seller_address_line1_snapshot),
         seller_address_line2_snapshot = coalesce(v_seller_address_line2, si.seller_address_line2_snapshot),
         seller_city_snapshot = coalesce(v_seller_city, si.seller_city_snapshot),
         seller_state_snapshot = coalesce(v_seller_state, si.seller_state_snapshot),
         seller_postal_code_snapshot = coalesce(v_seller_postal_code, si.seller_postal_code_snapshot),
         seller_country_code_snapshot = coalesce(v_seller_country_code, si.seller_country_code_snapshot),
         buyer_legal_name_snapshot = coalesce(v_buyer_legal_name, si.buyer_legal_name_snapshot),
         buyer_nuit_snapshot = coalesce(v_buyer_nuit, si.buyer_nuit_snapshot),
         buyer_address_line1_snapshot = coalesce(v_buyer_address_line1, si.buyer_address_line1_snapshot),
         buyer_address_line2_snapshot = coalesce(v_buyer_address_line2, si.buyer_address_line2_snapshot),
         buyer_country_code_snapshot = coalesce(v_buyer_country_code, si.buyer_country_code_snapshot),
         document_language_code_snapshot = coalesce(v_document_language_code, si.document_language_code_snapshot),
         computer_processed_phrase_snapshot = coalesce(v_computer_phrase, si.computer_processed_phrase_snapshot),
         vat_exemption_reason_text = coalesce(v_vat_exemption_reason_text, si.vat_exemption_reason_text),
         subtotal_mzn = case
           when coalesce(si.fx_to_base, 0) > 0 then round((coalesce(si.subtotal, 0) * si.fx_to_base)::numeric, 2)
           else si.subtotal_mzn
         end,
         tax_total_mzn = case
           when coalesce(si.fx_to_base, 0) > 0 then round((coalesce(si.tax_total, 0) * si.fx_to_base)::numeric, 2)
           else si.tax_total_mzn
         end,
         total_amount_mzn = case
           when coalesce(si.fx_to_base, 0) > 0 then round((coalesce(si.total_amount, 0) * si.fx_to_base)::numeric, 2)
           else si.total_amount_mzn
         end
   where si.id = p_invoice_id
  returning si.* into v_row;

  return v_row;
end;
$_$;


ALTER FUNCTION "public"."prepare_sales_invoice_for_issue_mz"("p_invoice_id" "uuid", "p_vat_exemption_reason_text" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prepare_sales_invoice_for_issue_mz"("p_invoice_id" "uuid", "p_vat_exemption_reason_text" "text") IS 'Backfills issue-time legal snapshots, exemption wording, and base totals for a draft sales invoice through a narrow, controlled path before issue.';



CREATE OR REPLACE FUNCTION "public"."process_daily_digests"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  r RECORD;
  v_settings jsonb;
  v_tz text;
  v_local_now timestamp;
  v_target time;
  v_last date;
  v_channels jsonb;
  v_recipients jsonb;
  v_should_run boolean;
BEGIN
  FOR r IN
    SELECT company_id, data
    FROM public.company_settings
    WHERE COALESCE((data #>> '{notifications,dailyDigest}'),'false')::boolean = true
  LOOP
    v_settings := r.data;
    v_tz := COALESCE(v_settings #>> '{notifications,timezone}', 'Africa/Maputo');
    v_local_now := (now() AT TIME ZONE v_tz);
    v_target := COALESCE((v_settings #>> '{notifications,dailyDigestTime}')::time, '08:00'::time);

    SELECT last_digest_local_date INTO v_last
    FROM public.company_digest_state
    WHERE company_id = r.company_id;

    -- Once per local day, after target time
    v_should_run := (v_local_now::date > COALESCE(v_last, (v_local_now::date - 1)))
                    AND (v_local_now::time >= v_target);

    IF v_should_run THEN
      v_channels := COALESCE(v_settings #> '{notifications,dailyDigestChannels}', '{"email":true,"sms":false,"whatsapp":false}'::jsonb);
      v_recipients := COALESCE(v_settings #> '{notifications,recipients}', '{"emails":[],"phones":[],"whatsapp":[]}'::jsonb);

      INSERT INTO public.digest_queue(company_id, run_for_local_date, timezone, payload)
      VALUES (
        r.company_id,
        v_local_now::date,
        v_tz,
        jsonb_build_object('channels', v_channels, 'recipients', v_recipients)
      );

      INSERT INTO public.company_digest_state(company_id, last_digest_local_date, last_attempt_at, last_status, last_error)
      VALUES (r.company_id, v_local_now::date, now(), 'queued', NULL)
      ON CONFLICT (company_id) DO UPDATE
        SET last_digest_local_date = EXCLUDED.last_digest_local_date,
            last_attempt_at = now(),
            last_status = 'queued',
            last_error = NULL;
    END IF;
  END LOOP;
END
$$;


ALTER FUNCTION "public"."process_daily_digests"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_due_reminder_queue"("p_limit" integer DEFAULT 100) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_processed int := 0;
  rec record;
  v_orders jsonb;
  v_override_emails text[];
  v_bcc text[];
  v_to_emails text[];
  v_lead_days int[];
  v_invoice_base_url text;
BEGIN
  FOR rec IN
    SELECT q.*
    FROM public.due_reminder_queue q
    WHERE q.status = 'pending'
    ORDER BY q.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT COALESCE(p_limit, 100)
  LOOP
    UPDATE public.due_reminder_queue
      SET status = 'processing',
          attempts = attempts + 1,
          next_attempt_at = now() + interval '5 minutes'
      WHERE id = rec.id;

    v_lead_days := ARRAY(SELECT (elem::text)::int FROM jsonb_array_elements_text(rec.payload->'lead_days') elem);
    v_bcc := ARRAY(SELECT elem::text FROM jsonb_array_elements_text(coalesce(rec.payload->'bcc','[]'::jsonb)) elem);
    v_override_emails := ARRAY(SELECT elem::text FROM jsonb_array_elements_text(coalesce(rec.payload->'recipients'->'emails','[]'::jsonb)) elem);
    v_invoice_base_url := coalesce(rec.payload->>'invoice_base_url','https://app.stockwise.app/invoices');

    WITH so AS (
      SELECT s.id, s.code, s.public_id, s.company_id,
             COALESCE(
               s.due_date,
               CASE
                 WHEN coalesce(s.payment_terms,'') ILIKE 'IMMEDIATE%' THEN s.order_date
                 WHEN coalesce(s.payment_terms,'') ~* '^NET\s*(\d+)' THEN s.order_date + ((regexp_match(s.payment_terms, '^NET\s*(\d+)'))[1])::int
                 ELSE s.order_date
               END
             )::date AS effective_due_date,
             s.bill_to_email,
             s.bill_to_name,
             s.total_amount,
             s.currency_code
      FROM public.sales_orders s
      WHERE s.company_id = rec.company_id
        AND s.status <> 'cancelled'
    ),
    due AS (
      SELECT so.*,
             (so.effective_due_date - rec.run_for_local_date)::int AS lead
      FROM so
      WHERE (so.effective_due_date - rec.run_for_local_date)::int = ANY (v_lead_days)
    ),
    emails AS (
      SELECT DISTINCT lower(trim(so.bill_to_email)) AS email
      FROM due so
      WHERE so.bill_to_email IS NOT NULL AND length(trim(so.bill_to_email)) > 3
    ),
    to_list AS (
      SELECT CASE
               WHEN array_length(v_override_emails,1) IS NOT NULL AND array_length(v_override_emails,1) > 0
                 THEN (SELECT array_agg(distinct lower(trim(e))) FROM unnest(v_override_emails) e)
               ELSE (SELECT array_agg(email) FROM emails)
             END AS emails
    ),
    orders_json AS (
      SELECT jsonb_agg(jsonb_build_object(
               'id', d.id,
               'code', d.code,
               'public_id', d.public_id,
               'effective_due_date', d.effective_due_date,
               'lead', (d.effective_due_date - rec.run_for_local_date)::int,
               'amount', d.total_amount,
               'currency', d.currency_code,
               'bill_to_email', d.bill_to_email,
               'bill_to_name', d.bill_to_name,
               'invoice_url', CASE
                                WHEN v_invoice_base_url IS NOT NULL AND (d.code IS NOT NULL OR d.public_id IS NOT NULL)
                                  THEN v_invoice_base_url || '/' || coalesce(d.public_id, d.code)
                                ELSE NULL
                              END
             )) AS orders
      FROM due d
    )
    SELECT (SELECT emails FROM to_list),
           coalesce((SELECT orders FROM orders_json), '[]'::jsonb)
    INTO v_to_emails, v_orders;

    IF v_to_emails IS NULL OR array_length(v_to_emails,1) IS NULL THEN
      UPDATE public.due_reminder_queue
      SET status = 'done',
          processed_at = now(),
          next_attempt_at = NULL,
          payload = jsonb_set(rec.payload, '{meta}', jsonb_build_object('reason','no_recipients','orders', v_orders), true)
      WHERE id = rec.id;
    ELSE
      INSERT INTO public.digest_queue(company_id, run_for_local_date, timezone, payload, status, attempts, created_at)
      VALUES (rec.company_id, rec.run_for_local_date, rec.timezone,
              jsonb_build_object(
                'kind','due_reminder',
                'channels', jsonb_build_object('email', true),
                'recipients', jsonb_build_object('emails', v_to_emails),
                'bcc', v_bcc,
                'orders', v_orders
              ),
              'pending', 0, now())
      ON CONFLICT DO NOTHING;

      UPDATE public.due_reminder_queue
      SET status = 'done',
          processed_at = now(),
          next_attempt_at = NULL,
          payload = jsonb_set(rec.payload, '{meta}', jsonb_build_object('recipient_count', array_length(v_to_emails,1), 'orders_count', jsonb_array_length(v_orders)), true)
      WHERE id = rec.id;
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  PERFORM public.invoke_digest_worker();

  RETURN v_processed;
END
$$;


ALTER FUNCTION "public"."process_due_reminder_queue"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prune_worker_queues"("p_due_days" integer DEFAULT 14, "p_digest_days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_due_deleted integer := 0;
  v_digest_deleted integer := 0;
BEGIN
  DELETE FROM public.due_reminder_queue q
   WHERE q.status IN ('done', 'failed')
     AND COALESCE(q.processed_at, q.created_at) < now() - make_interval(days => GREATEST(1, p_due_days));
  GET DIAGNOSTICS v_due_deleted = ROW_COUNT;

  DELETE FROM public.digest_queue q
   WHERE q.status IN ('done', 'failed')
     AND COALESCE(q.processed_at, q.created_at) < now() - make_interval(days => GREATEST(1, p_digest_days));
  GET DIAGNOSTICS v_digest_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'due_deleted', v_due_deleted,
    'digest_deleted', v_digest_deleted
  );
END;
$$;


ALTER FUNCTION "public"."prune_worker_queues"("p_due_days" integer, "p_digest_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rebuild_stock_levels"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  got_lock boolean;
begin
  -- avoid overlap if it ever runs twice
  got_lock := pg_try_advisory_lock(874231, 1);
  if not got_lock then
    raise notice 'rebuild_stock_levels skipped (another run is active)';
    return;
  end if;

  -- Aggregate movements -> what the qty *should* be per (company, item, warehouse, bin)
  with agg as (
    select
      coalesce(m.company_id, sl.company_id) as company_id,
      coalesce(m.item_id,   sl.item_id)     as item_id,
      coalesce(m.warehouse_id, sl.warehouse_id) as warehouse_id,
      coalesce(m.bin_id,    sl.bin_id)      as bin_id,

      -- movement-based qty
      coalesce(m.qty_from_movements, 0)::numeric as qty_calc,

      -- weighted avg cost from inbound movements (if none, keep old)
      coalesce(nullif(m.wavg_cost_in, 0), sl.avg_cost)::numeric as avg_cost_calc
    from (
      -- movement math
      select
        company_id,
        item_id,
        -- infer warehouse/bin based on which side was used
        coalesce(warehouse_to_id, warehouse_from_id) as warehouse_id,
        coalesce(bin_to_id,       bin_from_id)       as bin_id,

        sum(
          case
            when type in ('receive','transfer') and bin_to_id is not null   then qty_base::numeric
            when type in ('issue','transfer','so_ship') and bin_from_id is not null then -qty_base::numeric
            else 0::numeric
          end
        ) as qty_from_movements,

        -- weighted avg of inbound costs (receipts into this bin)
        case
          when sum(case when type in ('receive','transfer') and bin_to_id is not null then qty_base::numeric else 0 end) > 0
          then
            sum(case
                  when type in ('receive','transfer') and bin_to_id is not null
                  then (unit_cost::numeric * qty_base::numeric)
                  else 0::numeric
                end)
            /
            nullif(sum(case
                         when type in ('receive','transfer') and bin_to_id is not null
                         then qty_base::numeric
                         else 0::numeric
                       end), 0)
          else 0::numeric
        end as wavg_cost_in
      from stock_movements
      -- ignore movements without any bin; stock_levels is bin-based
      where (bin_to_id is not null or bin_from_id is not null)
      group by company_id, item_id, coalesce(warehouse_to_id, warehouse_from_id), coalesce(bin_to_id, bin_from_id)
    ) m
    full outer join stock_levels sl
      on sl.company_id   = m.company_id
     and sl.item_id      = m.item_id
     and sl.warehouse_id = m.warehouse_id
     and sl.bin_id       = m.bin_id
  )

  -- Upsert into stock_levels
  -- Keep allocated_qty as-is (it’s a separate concern), update qty/avg_cost.
  , upsert as (
    insert into stock_levels as sl (id, company_id, item_id, warehouse_id, bin_id, qty, avg_cost, updated_at, allocated_qty)
    select
      coalesce(sl_existing.id, gen_random_uuid()) as id,
      a.company_id,
      a.item_id,
      a.warehouse_id,
      a.bin_id,
      a.qty_calc,
      a.avg_cost_calc,
      now(),
      coalesce(sl_existing.allocated_qty, 0)
    from agg a
    left join stock_levels sl_existing
      on sl_existing.company_id   = a.company_id
     and sl_existing.item_id      = a.item_id
     and sl_existing.warehouse_id = a.warehouse_id
     and sl_existing.bin_id       = a.bin_id
    on conflict (id) do update
      set qty        = excluded.qty,
          avg_cost   = excluded.avg_cost,
          updated_at = excluded.updated_at
    returning 1
  )

  -- (Optional) clean exact-zero rows to keep the table lean.
  delete from stock_levels
   where qty::numeric = 0
     and not exists (
       select 1
       from stock_movements m
       where m.company_id   = stock_levels.company_id
         and m.item_id      = stock_levels.item_id
         and (m.bin_to_id   = stock_levels.bin_id or m.bin_from_id = stock_levels.bin_id)
     );

  perform pg_advisory_unlock(874231, 1);
end;
$$;


ALTER FUNCTION "public"."rebuild_stock_levels"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_so_line_shipped"("p_so_line_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_qty_shipped numeric;
BEGIN
  SELECT COALESCE(SUM(s.qty), 0) INTO v_qty_shipped
  FROM public.sales_shipments s
  WHERE s.so_line_id = p_so_line_id;

  UPDATE public.sales_order_lines sol
  SET shipped_qty = v_qty_shipped,
      is_shipped  = (v_qty_shipped >= sol.qty),
      shipped_at  = CASE WHEN v_qty_shipped >= sol.qty AND sol.shipped_at IS NULL THEN NOW() ELSE sol.shipped_at END
  WHERE sol.id = p_so_line_id;
END;$$;


ALTER FUNCTION "public"."recompute_so_line_shipped"("p_so_line_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_company_access_audit"("p_company_id" "uuid", "p_previous_plan_code" "text", "p_next_plan_code" "text", "p_previous_status" "public"."subscription_status", "p_next_status" "public"."subscription_status", "p_reason" "text", "p_context" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
  insert into public.company_access_audit_log (
    company_id,
    previous_plan_code,
    next_plan_code,
    previous_status,
    next_status,
    actor_user_id,
    actor_email,
    reason,
    context
  )
  values (
    p_company_id,
    p_previous_plan_code,
    p_next_plan_code,
    p_previous_status,
    p_next_status,
    auth.uid(),
    nullif(trim(coalesce((auth.jwt() ->> 'email')::text, '')), ''),
    nullif(trim(coalesce(p_reason, '')), ''),
    coalesce(p_context, '{}'::jsonb)
  );
$$;


ALTER FUNCTION "public"."record_company_access_audit"("p_company_id" "uuid", "p_previous_plan_code" "text", "p_next_plan_code" "text", "p_previous_status" "public"."subscription_status", "p_next_status" "public"."subscription_status", "p_reason" "text", "p_context" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_company_control_action"("p_company_id" "uuid", "p_action_type" "text", "p_reason" "text", "p_context" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
declare
  v_action_id uuid;
begin
  insert into public.company_control_action_log (
    company_id,
    action_type,
    actor_user_id,
    actor_email,
    reason,
    context
  )
  values (
    p_company_id,
    p_action_type,
    auth.uid(),
    nullif(trim(coalesce((auth.jwt() ->> 'email')::text, '')), ''),
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'No reason recorded'),
    coalesce(p_context, '{}'::jsonb)
  )
  returning id into v_action_id;

  return v_action_id;
end;
$$;


ALTER FUNCTION "public"."record_company_control_action"("p_company_id" "uuid", "p_action_type" "text", "p_reason" "text", "p_context" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fiscal_document_artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "document_kind" "text" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "artifact_type" "text" NOT NULL,
    "storage_bucket" "text",
    "storage_path" "text" NOT NULL,
    "file_name" "text",
    "mime_type" "text",
    "content_sha256" "text",
    "size_bytes" bigint,
    "is_canonical" boolean DEFAULT false NOT NULL,
    "retained_until" "date",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fiscal_document_artifacts_artifact_type_check" CHECK (("artifact_type" = ANY (ARRAY['pdf'::"text", 'xml'::"text", 'imported_source'::"text"]))),
    CONSTRAINT "fiscal_document_artifacts_document_kind_check" CHECK (("document_kind" = ANY (ARRAY['sales_invoice'::"text", 'sales_credit_note'::"text", 'sales_debit_note'::"text"])))
);


ALTER TABLE "public"."fiscal_document_artifacts" OWNER TO "postgres";


COMMENT ON TABLE "public"."fiscal_document_artifacts" IS 'Artifact metadata for archived fiscal files such as PDFs, XML exports, and imported source documents.';



CREATE OR REPLACE FUNCTION "public"."register_fiscal_document_artifact"("p_company_id" "uuid", "p_document_kind" "text", "p_document_id" "uuid", "p_artifact_type" "text", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text" DEFAULT NULL::"text", "p_mime_type" "text" DEFAULT NULL::"text", "p_content_sha256" "text" DEFAULT NULL::"text", "p_size_bytes" bigint DEFAULT NULL::bigint, "p_is_canonical" boolean DEFAULT false, "p_retained_until" "date" DEFAULT NULL::"date") RETURNS "public"."fiscal_document_artifacts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
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


ALTER FUNCTION "public"."register_fiscal_document_artifact"("p_company_id" "uuid", "p_document_kind" "text", "p_document_id" "uuid", "p_artifact_type" "text", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_content_sha256" "text", "p_size_bytes" bigint, "p_is_canonical" boolean, "p_retained_until" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."register_fiscal_document_artifact"("p_company_id" "uuid", "p_document_kind" "text", "p_document_id" "uuid", "p_artifact_type" "text", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_content_sha256" "text", "p_size_bytes" bigint, "p_is_canonical" boolean, "p_retained_until" "date") IS 'Registers a fiscal document artifact without mutating issued finance-document truth and lets retention defaults be derived automatically.';



CREATE OR REPLACE FUNCTION "public"."reinvite_company_member"("p_company" "uuid", "p_email" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'app'
    AS $$
DECLARE
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_token uuid;
  v_actor_role member_role;
  v_target_role member_role;
  v_target_status member_status;
  v_limit record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  SELECT cm.role
    INTO v_actor_role
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND cm.user_id = auth.uid()
    AND cm.status = 'active'
  ORDER BY public.role_rank(cm.role) DESC, cm.created_at ASC
  LIMIT 1;

  IF v_actor_role IS NULL OR public.role_rank(v_actor_role) < public.role_rank('MANAGER'::member_role) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT allowed, hit_count, retry_after_seconds, bucket_started_at
    INTO v_limit
  FROM public.consume_security_rate_limit(
    'reinvite_company_member_actor',
    auth.uid()::text || ':' || p_company::text,
    900,
    20
  );

  IF NOT COALESCE(v_limit.allowed, false) THEN
    RAISE EXCEPTION 'rate limit exceeded'
      USING ERRCODE = 'P0001',
            DETAIL = format('retry_after_seconds=%s', COALESCE(v_limit.retry_after_seconds, 0));
  END IF;

  SELECT allowed, hit_count, retry_after_seconds, bucket_started_at
    INTO v_limit
  FROM public.consume_security_rate_limit(
    'reinvite_company_member_target',
    p_company::text || ':' || v_email,
    1800,
    3
  );

  IF NOT COALESCE(v_limit.allowed, false) THEN
    RAISE EXCEPTION 'rate limit exceeded'
      USING ERRCODE = 'P0001',
            DETAIL = format('retry_after_seconds=%s', COALESCE(v_limit.retry_after_seconds, 0));
  END IF;

  SELECT cm.role, cm.status
    INTO v_target_role, v_target_status
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND lower(cm.email) = v_email
  ORDER BY public.role_rank(cm.role) DESC, cm.created_at ASC
  LIMIT 1;

  IF FOUND THEN
    IF v_target_status = 'active' THEN
      RAISE EXCEPTION 'already_active' USING ERRCODE = '23505';
    END IF;

    IF public.role_rank(v_target_role) > public.role_rank(v_actor_role)
      OR (v_target_role = 'OWNER' AND v_actor_role <> 'OWNER') THEN
      RAISE EXCEPTION 'target_not_allowed' USING ERRCODE = '42501';
    END IF;

    UPDATE public.company_members
       SET status = 'invited',
           invited_by = auth.uid()
     WHERE company_id = p_company
       AND lower(email) = v_email;
  ELSE
    IF (
      (v_actor_role = 'OWNER')
      OR (v_actor_role = 'ADMIN')
      OR (v_actor_role = 'MANAGER')
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = '42501';
    END IF;

    v_target_role := 'VIEWER'::member_role;

    INSERT INTO public.company_members(company_id, email, role, status, invited_by)
    VALUES (p_company, v_email, v_target_role, 'invited', auth.uid());
  END IF;

  INSERT INTO public.company_invites(company_id, email, role)
  VALUES (p_company, v_email, COALESCE(v_target_role, 'VIEWER'::member_role))
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;


ALTER FUNCTION "public"."reinvite_company_member"("p_company" "uuid", "p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_allowed_currency_for_current_company"("p_code" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  v_company_id uuid := public.current_company_id();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or v_company_id is null
       or not public.has_company_role(v_company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  delete from public.company_currencies
  where company_id = v_company_id
    and currency_code = p_code;
end
$$;


ALTER FUNCTION "public"."remove_allowed_currency_for_current_company"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_sales_invoice_approval_mz"("p_invoice_id" "uuid") RETURNS "public"."sales_invoices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row public.sales_invoices%rowtype;
begin
  select si.*
    into v_row
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_row.id is null then
    raise exception 'sales_invoice_not_found';
  end if;

  if not public.finance_documents_can_submit_for_approval(v_row.company_id) then
    raise exception using
      message = 'Sales invoice approval request access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft sales invoices can be submitted for approval.';
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'draft' then
    raise exception using
      message = 'Only editable draft sales invoices can be submitted for approval.';
  end if;

  update public.sales_invoices si
     set approval_status = 'pending_approval',
         approval_requested_at = now(),
         approval_requested_by = auth.uid(),
         approved_at = null,
         approved_by = null
   where si.id = p_invoice_id
  returning si.* into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."request_sales_invoice_approval_mz"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_vendor_bill_approval_mz"("p_bill_id" "uuid") RETURNS "public"."vendor_bills"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row public.vendor_bills%rowtype;
begin
  select vb.*
    into v_row
  from public.vendor_bills vb
  where vb.id = p_bill_id;

  if v_row.id is null then
    raise exception using
      message = 'Vendor bill not found.';
  end if;

  if not public.finance_documents_can_submit_for_approval(v_row.company_id) then
    raise exception using
      message = 'Vendor bill approval request access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft vendor bills can be submitted for approval.';
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'draft' then
    raise exception using
      message = 'Only editable draft vendor bills can be submitted for approval.';
  end if;

  update public.vendor_bills vb
     set approval_status = 'pending_approval',
         approval_requested_at = now(),
         approval_requested_by = auth.uid(),
         approved_at = null,
         approved_by = null
   where vb.id = p_bill_id
  returning vb.* into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."request_vendor_bill_approval_mz"("p_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."requeue_failed_digests"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  update public.digest_queue
  set status = 'pending',
      attempts = attempts + 1,
      next_attempt_at = now() + (interval '2 minutes') * power(2, greatest(attempts,0))  -- 2,4,8,16...
  where status = 'failed'
    and attempts < 5
    and (next_attempt_at is null or next_attempt_at <= now());
end
$$;


ALTER FUNCTION "public"."requeue_failed_digests"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."requeue_stuck_digests"("p_stuck_after" interval DEFAULT '00:15:00'::interval, "p_max_attempts" integer DEFAULT 5) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  WITH moved AS (
    UPDATE public.digest_queue q
       SET attempts = COALESCE(q.attempts, 0) + 1,
           status = CASE
             WHEN COALESCE(q.attempts, 0) + 1 >= p_max_attempts THEN 'failed'
             ELSE 'pending'
           END,
           next_attempt_at = CASE
             WHEN COALESCE(q.attempts, 0) + 1 >= p_max_attempts THEN NULL
             ELSE now() + make_interval(mins => LEAST(60, power(2, LEAST(6, COALESCE(q.attempts, 0) + 1))::int))
           END,
           error = CASE
             WHEN q.error IS NULL OR q.error = '' THEN 'Recovered stale processing job'
             ELSE q.error
           END,
           processing_started_at = NULL
     WHERE q.status = 'processing'
       AND q.processing_started_at IS NOT NULL
       AND q.processing_started_at < now() - p_stuck_after
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM moved;

  RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."requeue_stuck_digests"("p_stuck_after" interval, "p_max_attempts" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."requeue_stuck_due_reminders"("p_stuck_after" interval DEFAULT '00:15:00'::interval, "p_max_attempts" integer DEFAULT 8) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  WITH moved AS (
    UPDATE public.due_reminder_queue q
       SET attempts = COALESCE(q.attempts, 0) + 1,
           status = CASE
             WHEN COALESCE(q.attempts, 0) + 1 >= p_max_attempts
               THEN 'failed'
             ELSE 'pending'
           END,
           next_attempt_at = CASE
             WHEN COALESCE(q.attempts, 0) + 1 >= p_max_attempts THEN NULL
             ELSE now() + make_interval(mins => LEAST(60, power(2, LEAST(6, COALESCE(q.attempts, 0) + 1))::int))
           END,
           processing_started_at = NULL
     WHERE q.status = 'processing'
       AND q.processing_started_at IS NOT NULL
       AND q.processing_started_at < now() - p_stuck_after
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM moved;

  RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."requeue_stuck_due_reminders"("p_stuck_after" interval, "p_max_attempts" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_company_data"("p_company_id" "uuid", "p_clear_masters" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  -- convenience for joins
  wh_ids uuid[];
begin
  -- Collect this company's warehouse ids (if the table exists)
  if to_regclass('public.warehouses') is not null then
    select coalesce(array_agg(id), '{}') into wh_ids
    from public.warehouses where company_id = p_company_id;
  else
    wh_ids := '{}';
  end if;

  -- -----------------------------
  -- SALES / PURCHASE / ACCOUNTING
  -- -----------------------------
  -- Delete SO lines first, then SO headers
  if to_regclass('public.sales_order_lines') is not null
  and to_regclass('public.sales_orders') is not null then
    execute $q$ delete from public.sales_order_lines
      where so_id in (select id from public.sales_orders where company_id = $1) $q$
    using p_company_id;

    execute $q$ delete from public.sales_orders where company_id = $1 $q$
    using p_company_id;
  end if;

  -- Purchase Orders (if present)
  if to_regclass('public.purchase_order_lines') is not null
  and to_regclass('public.purchase_orders') is not null then
    execute $q$ delete from public.purchase_order_lines
      where po_id in (select id from public.purchase_orders where company_id = $1) $q$
    using p_company_id;

    execute $q$ delete from public.purchase_orders where company_id = $1 $q$
    using p_company_id;
  end if;

  -- Invoices/Payments (optional tables; delete if they exist)
  if to_regclass('public.invoice_lines') is not null
  and to_regclass('public.invoices') is not null then
    execute $q$ delete from public.invoice_lines
      where invoice_id in (select id from public.invoices where company_id = $1) $q$
    using p_company_id;

    execute $q$ delete from public.invoices where company_id = $1 $q$
    using p_company_id;
  end if;

  if to_regclass('public.payment_lines') is not null
  and to_regclass('public.payments') is not null then
    execute $q$ delete from public.payment_lines
      where payment_id in (select id from public.payments where company_id = $1) $q$
    using p_company_id;

    execute $q$ delete from public.payments where company_id = $1 $q$
    using p_company_id;
  end if;

  -- -----------------------------
  -- INVENTORY
  -- -----------------------------
  -- Stock movements: delete by company_id if present OR by warehouse participation
  if to_regclass('public.stock_movements') is not null then
    if pg_column_exists('public','stock_movements','company_id') then
      execute 'delete from public.stock_movements where company_id = $1' using p_company_id;
    else
      -- fall back to warehouse-based filter
      execute $q$
        delete from public.stock_movements
        where (warehouse_from_id = any($1) or warehouse_to_id = any($1))
      $q$ using wh_ids;
    end if;
  end if;

  -- Stock levels: by company_id if present, else by warehouse_id
  if to_regclass('public.stock_levels') is not null then
    if pg_column_exists('public','stock_levels','company_id') then
      execute 'delete from public.stock_levels where company_id = $1' using p_company_id;
    else
      execute 'delete from public.stock_levels where warehouse_id = any($1)' using wh_ids;
    end if;
  end if;

  -- Bins (delete children first if any)
  if to_regclass('public.bins') is not null then
    if pg_column_exists('public','bins','company_id') then
      execute 'delete from public.bins where company_id = $1' using p_company_id;
    else
      execute 'delete from public.bins where warehouse_id = any($1)' using wh_ids;
    end if;
  end if;

  -- Finally warehouses
  if to_regclass('public.warehouses') is not null then
    execute 'delete from public.warehouses where company_id = $1' using p_company_id;
  end if;

  -- --------------------------------
  -- OPTIONAL: clear master data too
  -- --------------------------------
  if p_clear_masters then
    if to_regclass('public.items') is not null then
      execute 'delete from public.items where company_id = $1' using p_company_id;
    end if;
    if to_regclass('public.customers') is not null then
      execute 'delete from public.customers where company_id = $1' using p_company_id;
    end if;
    if to_regclass('public.vendors') is not null then
      execute 'delete from public.vendors where company_id = $1' using p_company_id;
    end if;
    -- add other masters here if needed
  end if;
end;
$_$;


ALTER FUNCTION "public"."reset_company_data"("p_company_id" "uuid", "p_clear_masters" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."finance_document_fiscal_series" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "series_code" "text" NOT NULL,
    "fiscal_year" integer NOT NULL,
    "next_number" integer DEFAULT 1 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "valid_from" "date",
    "valid_to" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "finance_document_fiscal_series_document_type_check" CHECK (("document_type" = ANY (ARRAY['sales_invoice'::"text", 'sales_credit_note'::"text", 'sales_debit_note'::"text"]))),
    CONSTRAINT "finance_document_fiscal_series_fiscal_year_check" CHECK ((("fiscal_year" >= 2000) AND ("fiscal_year" <= 9999))),
    CONSTRAINT "finance_document_fiscal_series_next_number_check" CHECK (("next_number" >= 1)),
    CONSTRAINT "finance_document_fiscal_series_series_code_check" CHECK (("series_code" ~ '^[A-Z0-9]{2,10}$'::"text")),
    CONSTRAINT "finance_document_fiscal_series_valid_range_check" CHECK ((("valid_from" IS NULL) OR ("valid_to" IS NULL) OR ("valid_from" <= "valid_to")))
);


ALTER TABLE "public"."finance_document_fiscal_series" OWNER TO "postgres";


COMMENT ON TABLE "public"."finance_document_fiscal_series" IS 'Company-scoped legal fiscal series and sequence allocation rows for Mozambique sales invoices and corrective notes.';



CREATE OR REPLACE FUNCTION "public"."resolve_fiscal_series"("p_company_id" "uuid", "p_document_type" "text", "p_document_date" "date") RETURNS "public"."finance_document_fiscal_series"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row public.finance_document_fiscal_series%rowtype;
  v_settings public.company_fiscal_settings%rowtype;
  v_count integer;
  v_fiscal_year integer;
  v_expected_series_code text;
begin
  if p_company_id is null then
    raise exception 'finance_document_company_required';
  end if;

  if not public.finance_documents_can_read(p_company_id) then
    raise exception 'finance_document_company_access_denied';
  end if;

  if p_document_type not in ('sales_invoice', 'sales_credit_note', 'sales_debit_note') then
    raise exception 'unsupported_fiscal_document_type: %', p_document_type;
  end if;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = p_company_id
    and cfs.jurisdiction_code = 'MZ';

  if v_settings.company_id is null then
    raise exception 'company_fiscal_settings_missing';
  end if;

  v_fiscal_year := extract(year from coalesce(p_document_date, current_date))::integer;

  select count(*)
    into v_count
  from public.finance_document_fiscal_series fdfs
  where fdfs.company_id = p_company_id
    and fdfs.document_type = p_document_type
    and fdfs.fiscal_year = v_fiscal_year
    and fdfs.is_active
    and (fdfs.valid_from is null or coalesce(p_document_date, current_date) >= fdfs.valid_from)
    and (fdfs.valid_to is null or coalesce(p_document_date, current_date) <= fdfs.valid_to);

  if v_count = 0 then
    raise exception 'finance_document_fiscal_series_missing';
  end if;

  if v_count > 1 then
    raise exception 'finance_document_fiscal_series_ambiguous';
  end if;

  select fdfs.*
    into v_row
  from public.finance_document_fiscal_series fdfs
  where fdfs.company_id = p_company_id
    and fdfs.document_type = p_document_type
    and fdfs.fiscal_year = v_fiscal_year
    and fdfs.is_active
    and (fdfs.valid_from is null or coalesce(p_document_date, current_date) >= fdfs.valid_from)
    and (fdfs.valid_to is null or coalesce(p_document_date, current_date) <= fdfs.valid_to)
  limit 1;

  v_expected_series_code := case p_document_type
    when 'sales_invoice' then v_settings.invoice_series_code
    when 'sales_credit_note' then v_settings.credit_note_series_code
    when 'sales_debit_note' then v_settings.debit_note_series_code
    else null
  end;

  if v_expected_series_code is null or v_row.series_code is distinct from v_expected_series_code then
    raise exception 'finance_document_fiscal_series_settings_mismatch';
  end if;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."resolve_fiscal_series"("p_company_id" "uuid", "p_document_type" "text", "p_document_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_fiscal_series"("p_company_id" "uuid", "p_document_type" "text", "p_document_date" "date") IS 'Returns the single active Mozambique fiscal series for the company, document type, and document year or raises a clear exception.';



CREATE OR REPLACE FUNCTION "public"."return_sales_invoice_to_draft_mz"("p_invoice_id" "uuid") RETURNS "public"."sales_invoices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row public.sales_invoices%rowtype;
begin
  select si.*
    into v_row
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_row.id is null then
    raise exception 'sales_invoice_not_found';
  end if;

  if not public.finance_documents_can_approve(v_row.company_id) then
    raise exception using
      message = 'Sales invoice approval reset access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft sales invoices can be returned to editable draft.';
  end if;

  if coalesce(v_row.approval_status, 'draft') not in ('pending_approval', 'approved') then
    raise exception using
      message = 'Only pending-approval or approved sales invoices can be returned to draft.';
  end if;

  update public.sales_invoices si
     set approval_status = 'draft',
         approval_requested_at = null,
         approval_requested_by = null,
         approved_at = null,
         approved_by = null
   where si.id = p_invoice_id
  returning si.* into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."return_sales_invoice_to_draft_mz"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."return_vendor_bill_to_draft_mz"("p_bill_id" "uuid") RETURNS "public"."vendor_bills"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row public.vendor_bills%rowtype;
begin
  select vb.*
    into v_row
  from public.vendor_bills vb
  where vb.id = p_bill_id;

  if v_row.id is null then
    raise exception using
      message = 'Vendor bill not found.';
  end if;

  if not public.finance_documents_can_approve(v_row.company_id) then
    raise exception using
      message = 'Vendor bill approval reset access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft vendor bills can be returned to editable draft.';
  end if;

  if coalesce(v_row.approval_status, 'draft') not in ('pending_approval', 'approved') then
    raise exception using
      message = 'Only pending-approval or approved vendor bills can be returned to draft.';
  end if;

  update public.vendor_bills vb
     set approval_status = 'draft',
         approval_requested_at = null,
         approval_requested_by = null,
         approved_at = null,
         approved_by = null
   where vb.id = p_bill_id
  returning vb.* into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."return_vendor_bill_to_draft_mz"("p_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."role_rank"("r" "public"."member_role") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE r
    WHEN 'VIEWER'   THEN 0
    WHEN 'OPERATOR' THEN 10
    WHEN 'MANAGER'  THEN 20
    WHEN 'ADMIN'    THEN 30
    WHEN 'OWNER'    THEN 40
  END
$$;


ALTER FUNCTION "public"."role_rank"("r" "public"."member_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sales_credit_note_assign_reference"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_reference record;
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'sales_credit_note_internal_reference_immutable';
  end if;

  if new.source_origin not in ('native', 'imported') then
    raise exception 'sales_credit_note_source_origin_invalid';
  end if;

  new.moz_document_code := 'NC';

  if new.source_origin = 'imported' then
    if nullif(btrim(coalesce(new.internal_reference, '')), '') is null then
      raise exception 'imported_sales_credit_note_reference_required';
    end if;
    new.internal_reference := btrim(new.internal_reference);
    if new.fiscal_year is null then
      new.fiscal_year := extract(year from coalesce(new.credit_note_date, current_date))::integer;
    end if;
  elsif new.internal_reference is null or btrim(new.internal_reference) = '' then
    select *
      into v_reference
    from public.next_fiscal_document_reference(
      new.company_id,
      'sales_credit_note',
      coalesce(new.credit_note_date, current_date),
      new.source_origin,
      null
    );

    new.internal_reference := v_reference.internal_reference;
    new.fiscal_series_code := v_reference.fiscal_series_code;
    new.fiscal_year := v_reference.fiscal_year;
    new.fiscal_sequence_number := v_reference.fiscal_sequence_number;
  end if;

  if new.document_workflow_status = 'issued' then
    if new.issued_at is null then
      new.issued_at := now();
    end if;
    if new.issued_by is null then
      new.issued_by := auth.uid();
    end if;
  end if;

  if new.document_workflow_status = 'voided' then
    if new.voided_at is null then
      new.voided_at := now();
    end if;
    if new.voided_by is null then
      new.voided_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_credit_note_assign_reference"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sales_credit_note_hardening_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_company_id uuid;
begin
  if tg_op = 'INSERT' then
    v_company_id := new.company_id;
  elsif tg_op = 'UPDATE' then
    v_company_id := coalesce(new.company_id, old.company_id);
  else
    v_company_id := old.company_id;
  end if;

  if not public.finance_documents_can_issue_adjustment(v_company_id) then
    raise exception using
      message = 'Sales credit note access denied.';
  end if;

  if tg_op = 'UPDATE' and new.original_sales_invoice_id is distinct from old.original_sales_invoice_id and exists (
    select 1
    from public.sales_credit_note_lines scnl
    where scnl.sales_credit_note_id = old.id
      and scnl.sales_invoice_line_id is not null
  ) then
    raise exception using
      message = 'Credit notes cannot change the original sales invoice after source-linked lines exist.';
  end if;

  if tg_op = 'INSERT' and new.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Sales credit notes must be created in draft status.';
  end if;

  if tg_op = 'UPDATE' and new.document_workflow_status is distinct from old.document_workflow_status then
    if old.document_workflow_status = 'draft' and new.document_workflow_status in ('issued', 'voided') then
      null;
    elsif new.document_workflow_status = old.document_workflow_status then
      null;
    else
      raise exception using
        message = 'Credit note workflow only allows draft to issued or draft to voided transitions.';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.document_workflow_status in ('issued', 'voided')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception using
      message = 'Issued or voided credit notes are immutable.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_credit_note_hardening_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sales_credit_note_line_rollup"("p_note_id" "uuid") RETURNS TABLE("line_count" integer, "exempt_line_count" integer, "subtotal" numeric, "tax_total" numeric, "total_amount" numeric)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select
    count(*)::integer as line_count,
    count(*) filter (
      where coalesce(scnl.line_total, 0) > 0
        and coalesce(scnl.tax_rate, 0) <= 0
    )::integer as exempt_line_count,
    coalesce(sum(coalesce(scnl.line_total, 0)), 0)::numeric as subtotal,
    coalesce(sum(coalesce(scnl.tax_amount, 0)), 0)::numeric as tax_total,
    coalesce(sum(coalesce(scnl.line_total, 0) + coalesce(scnl.tax_amount, 0)), 0)::numeric as total_amount
  from public.sales_credit_note_lines scnl
  where scnl.sales_credit_note_id = p_note_id;
$$;


ALTER FUNCTION "public"."sales_credit_note_line_rollup"("p_note_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sales_credit_note_snapshot_fiscal_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_invoice public.sales_invoices%rowtype;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select si.*
    into v_invoice
  from public.sales_invoices si
  where si.id = new.original_sales_invoice_id;

  if v_invoice.id is null then
    raise exception 'sales_note_original_invoice_missing';
  end if;

  new.customer_id := coalesce(new.customer_id, v_invoice.customer_id);
  new.currency_code := coalesce(new.currency_code, v_invoice.currency_code);
  new.fx_to_base := coalesce(new.fx_to_base, v_invoice.fx_to_base, 1);
  new.seller_legal_name_snapshot := coalesce(new.seller_legal_name_snapshot, v_invoice.seller_legal_name_snapshot);
  new.seller_trade_name_snapshot := coalesce(new.seller_trade_name_snapshot, v_invoice.seller_trade_name_snapshot);
  new.seller_nuit_snapshot := coalesce(new.seller_nuit_snapshot, v_invoice.seller_nuit_snapshot);
  new.seller_address_line1_snapshot := coalesce(new.seller_address_line1_snapshot, v_invoice.seller_address_line1_snapshot);
  new.seller_address_line2_snapshot := coalesce(new.seller_address_line2_snapshot, v_invoice.seller_address_line2_snapshot);
  new.seller_city_snapshot := coalesce(new.seller_city_snapshot, v_invoice.seller_city_snapshot);
  new.seller_state_snapshot := coalesce(new.seller_state_snapshot, v_invoice.seller_state_snapshot);
  new.seller_postal_code_snapshot := coalesce(new.seller_postal_code_snapshot, v_invoice.seller_postal_code_snapshot);
  new.seller_country_code_snapshot := coalesce(new.seller_country_code_snapshot, v_invoice.seller_country_code_snapshot);
  new.buyer_legal_name_snapshot := coalesce(new.buyer_legal_name_snapshot, v_invoice.buyer_legal_name_snapshot);
  new.buyer_nuit_snapshot := coalesce(new.buyer_nuit_snapshot, v_invoice.buyer_nuit_snapshot);
  new.buyer_address_line1_snapshot := coalesce(new.buyer_address_line1_snapshot, v_invoice.buyer_address_line1_snapshot);
  new.buyer_address_line2_snapshot := coalesce(new.buyer_address_line2_snapshot, v_invoice.buyer_address_line2_snapshot);
  new.buyer_city_snapshot := coalesce(new.buyer_city_snapshot, v_invoice.buyer_city_snapshot);
  new.buyer_state_snapshot := coalesce(new.buyer_state_snapshot, v_invoice.buyer_state_snapshot);
  new.buyer_postal_code_snapshot := coalesce(new.buyer_postal_code_snapshot, v_invoice.buyer_postal_code_snapshot);
  new.buyer_country_code_snapshot := coalesce(new.buyer_country_code_snapshot, v_invoice.buyer_country_code_snapshot);
  new.document_language_code_snapshot := coalesce(new.document_language_code_snapshot, v_invoice.document_language_code_snapshot);
  new.computer_processed_phrase_snapshot := coalesce(new.computer_processed_phrase_snapshot, v_invoice.computer_processed_phrase_snapshot);
  new.compliance_rule_version_snapshot := coalesce(new.compliance_rule_version_snapshot, v_invoice.compliance_rule_version_snapshot);
  new.vat_exemption_reason_text := coalesce(
    nullif(btrim(coalesce(new.vat_exemption_reason_text, '')), ''),
    nullif(btrim(coalesce(v_invoice.vat_exemption_reason_text, '')), ''),
    null
  );

  update public.sales_credit_note_lines scnl
     set product_code_snapshot = coalesce(
           scnl.product_code_snapshot,
           src.invoice_product_code_snapshot,
           src.item_sku,
           src.item_id_text
         ),
         unit_of_measure_snapshot = coalesce(
           scnl.unit_of_measure_snapshot,
           src.invoice_unit_of_measure_snapshot,
           src.item_base_uom_id_text
         ),
         tax_category_code = coalesce(
           scnl.tax_category_code,
           src.invoice_tax_category_code,
           case when coalesce(scnl.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
    from (
      select
        scnl2.id as sales_credit_note_line_id,
        sil.product_code_snapshot as invoice_product_code_snapshot,
        sil.unit_of_measure_snapshot as invoice_unit_of_measure_snapshot,
        sil.tax_category_code as invoice_tax_category_code,
        nullif(i.sku, '') as item_sku,
        scnl2.item_id::text as item_id_text,
        nullif(i.base_uom_id::text, '') as item_base_uom_id_text
      from public.sales_credit_note_lines scnl2
      left join public.sales_invoice_lines sil
        on sil.id is not distinct from scnl2.sales_invoice_line_id
      left join public.items i
        on i.id is not distinct from scnl2.item_id
      where scnl2.sales_credit_note_id = new.id
    ) src
   where scnl.id = src.sales_credit_note_line_id;

  update public.sales_credit_note_lines scnl
     set product_code_snapshot = coalesce(scnl.product_code_snapshot, scnl.item_id::text, 'ITEM'),
         unit_of_measure_snapshot = coalesce(scnl.unit_of_measure_snapshot, 'UN'),
         tax_category_code = coalesce(
           scnl.tax_category_code,
           case when coalesce(scnl.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
   where scnl.sales_credit_note_id = new.id
     and (scnl.product_code_snapshot is null
       or scnl.unit_of_measure_snapshot is null
       or scnl.tax_category_code is null);

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_credit_note_snapshot_fiscal_fields"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_credit_note_snapshot_fiscal_fields"() IS 'Fixes the partial-credit migration regression so credit-note issue snapshots do not reference target-table aliases illegally inside FROM-clause joins.';



CREATE OR REPLACE FUNCTION "public"."sales_credit_note_validate_issue_mz"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_rollup record;
  v_invoice public.sales_invoices%rowtype;
  v_series public.finance_document_fiscal_series%rowtype;
  v_invalid_source_line_count integer;
  v_line_violation_count integer;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select si.*
    into v_invoice
  from public.sales_invoices si
  where si.id = new.original_sales_invoice_id;

  if v_invoice.id is null then
    raise exception using
      message = 'Credit notes require an original issued sales invoice.';
  end if;

  if v_invoice.document_workflow_status <> 'issued' then
    raise exception using
      message = 'Credit notes can only be issued against an issued sales invoice.';
  end if;

  if v_invoice.company_id <> new.company_id then
    raise exception using
      message = 'Credit note company must match the original sales invoice company.';
  end if;

  if coalesce(new.customer_id, v_invoice.customer_id) is distinct from v_invoice.customer_id then
    raise exception using
      message = 'Credit note customer must match the original sales invoice customer.';
  end if;

  new.vat_exemption_reason_text := nullif(btrim(coalesce(new.vat_exemption_reason_text, '')), '');

  if nullif(btrim(coalesce(new.correction_reason_text, '')), '') is null then
    raise exception using
      message = 'Credit notes require a correction reason.';
  end if;

  if new.credit_note_date is null then
    raise exception using
      message = 'Credit notes require a note date before issue.';
  end if;

  if new.credit_note_date < v_invoice.invoice_date then
    raise exception using
      message = 'Credit note date cannot be earlier than the original sales invoice date.';
  end if;

  if new.currency_code is distinct from v_invoice.currency_code then
    raise exception using
      message = 'Credit note currency must match the original sales invoice currency.';
  end if;

  if coalesce(new.fx_to_base, 0) <= 0 then
    raise exception using
      message = 'Credit notes require a positive FX rate.';
  end if;

  if new.source_origin = 'native'
     and (
       new.fiscal_series_code is null
       or new.fiscal_year is null
       or new.fiscal_sequence_number is null
     ) then
    raise exception using
      message = 'Credit notes require fiscal series, year, and sequence before issue.';
  end if;

  if new.source_origin = 'native' then
    select *
      into v_series
    from public.resolve_fiscal_series(new.company_id, 'sales_credit_note', new.credit_note_date);

    if v_series.series_code is distinct from new.fiscal_series_code
       or v_series.fiscal_year is distinct from new.fiscal_year then
      raise exception using
        message = 'Credit note fiscal series metadata does not match the active company series.';
    end if;
  end if;

  if nullif(btrim(coalesce(new.seller_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.seller_nuit_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_nuit_snapshot, '')), '') is null then
    raise exception using
      message = 'Credit notes require seller and buyer fiscal snapshots before issue.';
  end if;

  if nullif(btrim(coalesce(new.document_language_code_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.computer_processed_phrase_snapshot, '')), '') is null then
    raise exception using
      message = 'Credit notes require document language and computer-processing wording before issue.';
  end if;

  select *
    into v_rollup
  from public.sales_credit_note_line_rollup(new.id);

  if coalesce(v_rollup.line_count, 0) <= 0 then
    raise exception using
      message = 'Credit notes require at least one line before issue.';
  end if;

  new.subtotal := round(coalesce(v_rollup.subtotal, 0), 2);
  new.tax_total := round(coalesce(v_rollup.tax_total, 0), 2);
  new.total_amount := round(coalesce(v_rollup.total_amount, 0), 2);
  new.subtotal_mzn := round(new.subtotal * coalesce(new.fx_to_base, 1), 2);
  new.tax_total_mzn := round(new.tax_total * coalesce(new.fx_to_base, 1), 2);
  new.total_amount_mzn := round(new.total_amount * coalesce(new.fx_to_base, 1), 2);

  if coalesce(new.subtotal, 0) < 0
     or coalesce(new.tax_total, 0) < 0
     or coalesce(new.total_amount, 0) < 0
     or coalesce(new.subtotal_mzn, 0) < 0
     or coalesce(new.tax_total_mzn, 0) < 0
     or coalesce(new.total_amount_mzn, 0) < 0 then
    raise exception using
      message = 'Credit notes require non-negative totals.';
  end if;

  select count(*)
    into v_invalid_source_line_count
  from public.sales_credit_note_lines scnl
  join public.sales_invoice_lines sil
    on sil.id = scnl.sales_invoice_line_id
  where scnl.sales_credit_note_id = new.id
    and sil.sales_invoice_id is distinct from new.original_sales_invoice_id;

  if coalesce(v_invalid_source_line_count, 0) > 0 then
    raise exception using
      message = 'Credit notes cannot issue with source-linked lines from a different original sales invoice.';
  end if;

  with current_lines as (
    select
      scnl.sales_invoice_line_id,
      coalesce(sum(coalesce(scnl.qty, 0)), 0)::numeric as qty,
      coalesce(sum(coalesce(scnl.line_total, 0)), 0)::numeric as line_total,
      coalesce(sum(coalesce(scnl.tax_amount, 0)), 0)::numeric as tax_amount,
      max(coalesce(scnl.tax_rate, 0))::numeric as tax_rate,
      count(distinct coalesce(scnl.tax_rate, 0))::integer as tax_rate_variant_count
    from public.sales_credit_note_lines scnl
    where scnl.sales_credit_note_id = new.id
    group by scnl.sales_invoice_line_id
  ),
  issued_rollup as (
    select
      scnl.sales_invoice_line_id,
      coalesce(sum(coalesce(scnl.qty, 0)), 0)::numeric as credited_qty,
      coalesce(sum(coalesce(scnl.line_total, 0)), 0)::numeric as credited_line_total,
      coalesce(sum(coalesce(scnl.tax_amount, 0)), 0)::numeric as credited_tax_amount
    from public.sales_credit_note_lines scnl
    join public.sales_credit_notes scn
      on scn.id = scnl.sales_credit_note_id
    where scn.company_id = new.company_id
      and scn.original_sales_invoice_id = new.original_sales_invoice_id
      and scn.document_workflow_status = 'issued'
      and scn.id <> new.id
      and scnl.sales_invoice_line_id is not null
    group by scnl.sales_invoice_line_id
  )
  select count(*)
    into v_line_violation_count
  from current_lines cl
  left join public.sales_invoice_lines sil
    on sil.id = cl.sales_invoice_line_id
  left join issued_rollup ir
    on ir.sales_invoice_line_id = cl.sales_invoice_line_id
  where cl.sales_invoice_line_id is null
     or sil.id is null
     or (coalesce(cl.line_total, 0) <= 0 and coalesce(cl.tax_amount, 0) <= 0)
     or coalesce(cl.tax_rate_variant_count, 0) > 1
     or (coalesce(cl.qty, 0) > 0 and coalesce(sil.qty, 0) <= 0)
     or coalesce(cl.qty, 0) + coalesce(ir.credited_qty, 0) - coalesce(sil.qty, 0) > 0.005
     or coalesce(cl.line_total, 0) + coalesce(ir.credited_line_total, 0) - coalesce(sil.line_total, 0) > 0.005
     or coalesce(cl.tax_amount, 0) + coalesce(ir.credited_tax_amount, 0) - coalesce(sil.tax_amount, 0) > 0.005
     or coalesce(cl.tax_rate, 0) is distinct from coalesce(sil.tax_rate, 0);

  if coalesce(v_line_violation_count, 0) > 0 then
    raise exception using
      message = 'Credit note lines exceed the remaining quantity, taxable value, or tax still available on the original invoice.';
  end if;

  if coalesce(v_rollup.exempt_line_count, 0) > 0
     and new.vat_exemption_reason_text is null then
    raise exception using
      message = 'Credit notes with VAT-exempt lines require a VAT exemption reason before issue.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_credit_note_validate_issue_mz"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_credit_note_validate_issue_mz"() IS 'Validates Mozambique issue-time requirements for sales credit notes, including original invoice linkage and fiscal snapshots.';



CREATE OR REPLACE FUNCTION "public"."sales_debit_note_assign_reference"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_reference record;
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'sales_debit_note_internal_reference_immutable';
  end if;

  if new.source_origin not in ('native', 'imported') then
    raise exception 'sales_debit_note_source_origin_invalid';
  end if;

  new.moz_document_code := 'ND';

  if new.source_origin = 'imported' then
    if nullif(btrim(coalesce(new.internal_reference, '')), '') is null then
      raise exception 'imported_sales_debit_note_reference_required';
    end if;
    new.internal_reference := btrim(new.internal_reference);
    if new.fiscal_year is null then
      new.fiscal_year := extract(year from coalesce(new.debit_note_date, current_date))::integer;
    end if;
  elsif new.internal_reference is null or btrim(new.internal_reference) = '' then
    select *
      into v_reference
    from public.next_fiscal_document_reference(
      new.company_id,
      'sales_debit_note',
      coalesce(new.debit_note_date, current_date),
      new.source_origin,
      null
    );

    new.internal_reference := v_reference.internal_reference;
    new.fiscal_series_code := v_reference.fiscal_series_code;
    new.fiscal_year := v_reference.fiscal_year;
    new.fiscal_sequence_number := v_reference.fiscal_sequence_number;
  end if;

  if new.document_workflow_status = 'issued' then
    if new.issued_at is null then
      new.issued_at := now();
    end if;
    if new.issued_by is null then
      new.issued_by := auth.uid();
    end if;
  end if;

  if new.document_workflow_status = 'voided' then
    if new.voided_at is null then
      new.voided_at := now();
    end if;
    if new.voided_by is null then
      new.voided_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_debit_note_assign_reference"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sales_debit_note_hardening_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_company_id uuid;
begin
  if tg_op = 'INSERT' then
    v_company_id := new.company_id;
  elsif tg_op = 'UPDATE' then
    v_company_id := coalesce(new.company_id, old.company_id);
  else
    v_company_id := old.company_id;
  end if;

  if not public.finance_documents_can_issue_adjustment(v_company_id) then
    raise exception using
      message = 'Sales debit note access denied.';
  end if;

  if tg_op = 'UPDATE' and new.original_sales_invoice_id is distinct from old.original_sales_invoice_id and exists (
    select 1
    from public.sales_debit_note_lines sdnl
    where sdnl.sales_debit_note_id = old.id
      and sdnl.sales_invoice_line_id is not null
  ) then
    raise exception using
      message = 'Debit notes cannot change the original sales invoice after source-linked lines exist.';
  end if;

  if tg_op = 'INSERT' and new.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Sales debit notes must be created in draft status.';
  end if;

  if tg_op = 'UPDATE' and new.document_workflow_status is distinct from old.document_workflow_status then
    if old.document_workflow_status = 'draft' and new.document_workflow_status in ('issued', 'voided') then
      null;
    elsif new.document_workflow_status = old.document_workflow_status then
      null;
    else
      raise exception using
        message = 'Debit note workflow only allows draft to issued or draft to voided transitions.';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.document_workflow_status in ('issued', 'voided')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception using
      message = 'Issued or voided debit notes are immutable.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_debit_note_hardening_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sales_debit_note_snapshot_fiscal_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_invoice public.sales_invoices%rowtype;
  v_rollup record;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select si.*
    into v_invoice
  from public.sales_invoices si
  where si.id = new.original_sales_invoice_id;

  if v_invoice.id is null then
    raise exception 'sales_note_original_invoice_missing';
  end if;

  new.customer_id := coalesce(new.customer_id, v_invoice.customer_id);
  new.currency_code := coalesce(new.currency_code, v_invoice.currency_code);
  new.fx_to_base := coalesce(new.fx_to_base, v_invoice.fx_to_base, 1);
  new.seller_legal_name_snapshot := coalesce(new.seller_legal_name_snapshot, v_invoice.seller_legal_name_snapshot);
  new.seller_trade_name_snapshot := coalesce(new.seller_trade_name_snapshot, v_invoice.seller_trade_name_snapshot);
  new.seller_nuit_snapshot := coalesce(new.seller_nuit_snapshot, v_invoice.seller_nuit_snapshot);
  new.seller_address_line1_snapshot := coalesce(new.seller_address_line1_snapshot, v_invoice.seller_address_line1_snapshot);
  new.seller_address_line2_snapshot := coalesce(new.seller_address_line2_snapshot, v_invoice.seller_address_line2_snapshot);
  new.seller_city_snapshot := coalesce(new.seller_city_snapshot, v_invoice.seller_city_snapshot);
  new.seller_state_snapshot := coalesce(new.seller_state_snapshot, v_invoice.seller_state_snapshot);
  new.seller_postal_code_snapshot := coalesce(new.seller_postal_code_snapshot, v_invoice.seller_postal_code_snapshot);
  new.seller_country_code_snapshot := coalesce(new.seller_country_code_snapshot, v_invoice.seller_country_code_snapshot);
  new.buyer_legal_name_snapshot := coalesce(new.buyer_legal_name_snapshot, v_invoice.buyer_legal_name_snapshot);
  new.buyer_nuit_snapshot := coalesce(new.buyer_nuit_snapshot, v_invoice.buyer_nuit_snapshot);
  new.buyer_address_line1_snapshot := coalesce(new.buyer_address_line1_snapshot, v_invoice.buyer_address_line1_snapshot);
  new.buyer_address_line2_snapshot := coalesce(new.buyer_address_line2_snapshot, v_invoice.buyer_address_line2_snapshot);
  new.buyer_city_snapshot := coalesce(new.buyer_city_snapshot, v_invoice.buyer_city_snapshot);
  new.buyer_state_snapshot := coalesce(new.buyer_state_snapshot, v_invoice.buyer_state_snapshot);
  new.buyer_postal_code_snapshot := coalesce(new.buyer_postal_code_snapshot, v_invoice.buyer_postal_code_snapshot);
  new.buyer_country_code_snapshot := coalesce(new.buyer_country_code_snapshot, v_invoice.buyer_country_code_snapshot);
  new.document_language_code_snapshot := coalesce(new.document_language_code_snapshot, v_invoice.document_language_code_snapshot);
  new.computer_processed_phrase_snapshot := coalesce(new.computer_processed_phrase_snapshot, v_invoice.computer_processed_phrase_snapshot);
  new.compliance_rule_version_snapshot := coalesce(new.compliance_rule_version_snapshot, v_invoice.compliance_rule_version_snapshot);

  update public.sales_debit_note_lines sdnl
     set product_code_snapshot = coalesce(
           sdnl.product_code_snapshot,
           src.invoice_product_code_snapshot,
           src.item_sku,
           src.item_id_text
         ),
         unit_of_measure_snapshot = coalesce(
           sdnl.unit_of_measure_snapshot,
           src.invoice_unit_of_measure_snapshot,
           src.item_base_uom_id_text
         ),
         tax_category_code = coalesce(
           sdnl.tax_category_code,
           src.invoice_tax_category_code,
           case when coalesce(sdnl.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
    from (
      select
        sdnl2.id as sales_debit_note_line_id,
        sil.product_code_snapshot as invoice_product_code_snapshot,
        sil.unit_of_measure_snapshot as invoice_unit_of_measure_snapshot,
        sil.tax_category_code as invoice_tax_category_code,
        nullif(i.sku, '') as item_sku,
        sdnl2.item_id::text as item_id_text,
        nullif(i.base_uom_id::text, '') as item_base_uom_id_text
      from public.sales_debit_note_lines sdnl2
      left join public.sales_invoice_lines sil
        on sil.id is not distinct from sdnl2.sales_invoice_line_id
      left join public.items i
        on i.id is not distinct from sdnl2.item_id
      where sdnl2.sales_debit_note_id = new.id
    ) src
   where sdnl.id = src.sales_debit_note_line_id;

  update public.sales_debit_note_lines sdnl
     set product_code_snapshot = coalesce(sdnl.product_code_snapshot, sdnl.item_id::text, 'ITEM'),
         unit_of_measure_snapshot = coalesce(sdnl.unit_of_measure_snapshot, 'UN'),
         tax_category_code = coalesce(
           sdnl.tax_category_code,
           case when coalesce(sdnl.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
   where sdnl.sales_debit_note_id = new.id
     and (sdnl.product_code_snapshot is null
       or sdnl.unit_of_measure_snapshot is null
       or sdnl.tax_category_code is null);

  select
    count(*)::integer as line_count,
    coalesce(sum(coalesce(sdnl.line_total, 0)), 0)::numeric as subtotal,
    coalesce(sum(coalesce(sdnl.tax_amount, 0)), 0)::numeric as tax_total,
    coalesce(sum(coalesce(sdnl.line_total, 0) + coalesce(sdnl.tax_amount, 0)), 0)::numeric as total_amount
    into v_rollup
  from public.sales_debit_note_lines sdnl
  where sdnl.sales_debit_note_id = new.id;

  if coalesce(v_rollup.line_count, 0) <= 0 then
    raise exception using
      message = 'Debit notes require at least one line before issue.';
  end if;

  new.subtotal := round(coalesce(v_rollup.subtotal, 0), 2);
  new.tax_total := round(coalesce(v_rollup.tax_total, 0), 2);
  new.total_amount := round(coalesce(v_rollup.total_amount, 0), 2);
  new.subtotal_mzn := round(new.subtotal * coalesce(new.fx_to_base, 1), 2);
  new.tax_total_mzn := round(new.tax_total * coalesce(new.fx_to_base, 1), 2);
  new.total_amount_mzn := round(new.total_amount * coalesce(new.fx_to_base, 1), 2);

  if coalesce(new.total_amount, 0) <= 0 then
    raise exception using
      message = 'Debit notes require a positive total before issue.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_debit_note_snapshot_fiscal_fields"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_debit_note_snapshot_fiscal_fields"() IS 'Patches line snapshot updates for debit note issue so target-table aliases are not referenced illegally inside FROM-clause joins.';



CREATE OR REPLACE FUNCTION "public"."sales_debit_note_validate_issue_mz"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_line_count integer;
  v_invoice public.sales_invoices%rowtype;
  v_series public.finance_document_fiscal_series%rowtype;
  v_invalid_source_line_count integer;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select si.*
    into v_invoice
  from public.sales_invoices si
  where si.id = new.original_sales_invoice_id;

  if v_invoice.id is null then
    raise exception using
      message = 'Debit notes require an original issued sales invoice.';
  end if;

  if v_invoice.document_workflow_status <> 'issued' then
    raise exception using
      message = 'Debit notes can only be issued against an issued sales invoice.';
  end if;

  if v_invoice.company_id <> new.company_id then
    raise exception using
      message = 'Debit note company must match the original sales invoice company.';
  end if;

  if coalesce(new.customer_id, v_invoice.customer_id) is distinct from v_invoice.customer_id then
    raise exception using
      message = 'Debit note customer must match the original sales invoice customer.';
  end if;

  if nullif(btrim(coalesce(new.correction_reason_text, '')), '') is null then
    raise exception using
      message = 'Debit notes require a correction reason.';
  end if;

  if new.debit_note_date is null then
    raise exception using
      message = 'Debit notes require a note date before issue.';
  end if;

  if new.debit_note_date < v_invoice.invoice_date then
    raise exception using
      message = 'Debit note date cannot be earlier than the original sales invoice date.';
  end if;

  if new.due_date is null or new.due_date < new.debit_note_date then
    raise exception using
      message = 'Debit notes require a due date on or after the debit note date.';
  end if;

  if new.currency_code is distinct from v_invoice.currency_code then
    raise exception using
      message = 'Debit note currency must match the original sales invoice currency.';
  end if;

  if coalesce(new.fx_to_base, 0) <= 0 then
    raise exception using
      message = 'Debit notes require a positive FX rate.';
  end if;

  if new.source_origin = 'native'
     and (
       new.fiscal_series_code is null
       or new.fiscal_year is null
       or new.fiscal_sequence_number is null
     ) then
    raise exception using
      message = 'Debit notes require fiscal series, year, and sequence before issue.';
  end if;

  if new.source_origin = 'native' then
    select *
      into v_series
    from public.resolve_fiscal_series(new.company_id, 'sales_debit_note', new.debit_note_date);

    if v_series.series_code is distinct from new.fiscal_series_code
       or v_series.fiscal_year is distinct from new.fiscal_year then
      raise exception using
        message = 'Debit note fiscal series metadata does not match the active company series.';
    end if;
  end if;

  if nullif(btrim(coalesce(new.seller_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.seller_nuit_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_nuit_snapshot, '')), '') is null then
    raise exception using
      message = 'Debit notes require seller and buyer fiscal snapshots before issue.';
  end if;

  if nullif(btrim(coalesce(new.document_language_code_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.computer_processed_phrase_snapshot, '')), '') is null then
    raise exception using
      message = 'Debit notes require document language and computer-processing wording before issue.';
  end if;

  if coalesce(new.subtotal, 0) < 0
     or coalesce(new.tax_total, 0) < 0
     or coalesce(new.total_amount, 0) < 0
     or coalesce(new.subtotal_mzn, 0) < 0
     or coalesce(new.tax_total_mzn, 0) < 0
     or coalesce(new.total_amount_mzn, 0) < 0 then
    raise exception using
      message = 'Debit notes require non-negative totals.';
  end if;

  select count(*)
    into v_line_count
  from public.sales_debit_note_lines sdnl
  where sdnl.sales_debit_note_id = new.id;

  if coalesce(v_line_count, 0) <= 0 then
    raise exception using
      message = 'Debit notes require at least one line before issue.';
  end if;

  select count(*)
    into v_invalid_source_line_count
  from public.sales_debit_note_lines sdnl
  join public.sales_invoice_lines sil
    on sil.id = sdnl.sales_invoice_line_id
  where sdnl.sales_debit_note_id = new.id
    and sil.sales_invoice_id is distinct from new.original_sales_invoice_id;

  if coalesce(v_invalid_source_line_count, 0) > 0 then
    raise exception using
      message = 'Debit notes cannot issue with source-linked lines from a different original sales invoice.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_debit_note_validate_issue_mz"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_debit_note_validate_issue_mz"() IS 'Validates Mozambique issue-time requirements for sales debit notes, including original invoice linkage and fiscal snapshots.';



CREATE OR REPLACE FUNCTION "public"."sales_invoice_assign_reference"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_reference record;
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'sales_invoice_internal_reference_immutable';
  end if;

  if new.source_origin not in ('native', 'imported') then
    raise exception 'sales_invoice_source_origin_invalid';
  end if;

  new.moz_document_code := 'INV';

  if new.source_origin = 'imported' then
    if nullif(btrim(coalesce(new.internal_reference, '')), '') is null then
      raise exception 'imported_sales_invoice_reference_required';
    end if;
    new.internal_reference := btrim(new.internal_reference);
    if new.fiscal_year is null then
      new.fiscal_year := extract(year from coalesce(new.invoice_date, current_date))::integer;
    end if;
  elsif new.internal_reference is null or btrim(new.internal_reference) = '' then
    select *
      into v_reference
    from public.next_fiscal_document_reference(
      new.company_id,
      'sales_invoice',
      coalesce(new.invoice_date, current_date),
      new.source_origin,
      null
    );

    new.internal_reference := v_reference.internal_reference;
    new.fiscal_series_code := v_reference.fiscal_series_code;
    new.fiscal_year := v_reference.fiscal_year;
    new.fiscal_sequence_number := v_reference.fiscal_sequence_number;
  end if;

  if new.document_workflow_status = 'issued' then
    if new.due_date is null then
      raise exception 'sales_invoice_due_date_required_for_issue';
    end if;
    if new.issued_at is null then
      new.issued_at := now();
    end if;
    if new.issued_by is null then
      new.issued_by := auth.uid();
    end if;
  end if;

  if new.document_workflow_status = 'voided' then
    if new.voided_at is null then
      new.voided_at := now();
    end if;
    if new.voided_by is null then
      new.voided_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_invoice_assign_reference"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_invoice_assign_reference"() IS 'Assigns the legal visible invoice reference for Mozambique sales invoices without making business logic depend on parsing that text.';



CREATE OR REPLACE FUNCTION "public"."sales_invoice_hardening_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_company_id uuid;
begin
  if tg_op = 'INSERT' then
    v_company_id := new.company_id;
  elsif tg_op = 'UPDATE' then
    v_company_id := coalesce(new.company_id, old.company_id);
  else
    v_company_id := old.company_id;
  end if;

  if tg_op = 'INSERT' then
    if not public.finance_documents_can_prepare_draft(v_company_id) then
      raise exception using
        message = 'Sales invoice draft creation access denied.';
    end if;

    new.document_workflow_status := coalesce(new.document_workflow_status, 'draft');
    new.approval_status := coalesce(nullif(btrim(coalesce(new.approval_status, '')), ''), 'draft');

    if new.document_workflow_status <> 'draft' then
      raise exception using
        message = 'Sales invoices must start in draft status.';
    end if;

    if new.approval_status <> 'draft' then
      raise exception using
        message = 'Sales invoices must start with draft approval status.';
    end if;

    new.approval_requested_at := null;
    new.approval_requested_by := null;
    new.approved_at := null;
    new.approved_by := null;
    return new;
  end if;

  new.approval_status := coalesce(nullif(btrim(coalesce(new.approval_status, '')), ''), old.approval_status, 'draft');

  if current_setting('stockwise.sales_invoice_issue_prepare_bypass', true) = 'on' then
    if old.document_workflow_status <> 'draft' then
      raise exception using
        message = 'Only draft sales invoices can be prepared for issue.';
    end if;

    if new.document_workflow_status is distinct from old.document_workflow_status
       or new.approval_status is distinct from old.approval_status then
      raise exception using
        message = 'Sales invoice issue preparation cannot change approval or workflow status.';
    end if;

    if (to_jsonb(new) - array[
      'updated_at',
      'fiscal_series_code',
      'fiscal_year',
      'fiscal_sequence_number',
      'seller_legal_name_snapshot',
      'seller_trade_name_snapshot',
      'seller_nuit_snapshot',
      'seller_address_line1_snapshot',
      'seller_address_line2_snapshot',
      'seller_city_snapshot',
      'seller_state_snapshot',
      'seller_postal_code_snapshot',
      'seller_country_code_snapshot',
      'buyer_legal_name_snapshot',
      'buyer_nuit_snapshot',
      'buyer_address_line1_snapshot',
      'buyer_address_line2_snapshot',
      'buyer_country_code_snapshot',
      'document_language_code_snapshot',
      'computer_processed_phrase_snapshot',
      'vat_exemption_reason_text',
      'subtotal_mzn',
      'tax_total_mzn',
      'total_amount_mzn'
    ]) is distinct from
      (to_jsonb(old) - array[
        'updated_at',
        'fiscal_series_code',
        'fiscal_year',
        'fiscal_sequence_number',
        'seller_legal_name_snapshot',
        'seller_trade_name_snapshot',
        'seller_nuit_snapshot',
        'seller_address_line1_snapshot',
        'seller_address_line2_snapshot',
        'seller_city_snapshot',
        'seller_state_snapshot',
        'seller_postal_code_snapshot',
        'seller_country_code_snapshot',
        'buyer_legal_name_snapshot',
        'buyer_nuit_snapshot',
        'buyer_address_line1_snapshot',
        'buyer_address_line2_snapshot',
        'buyer_country_code_snapshot',
        'document_language_code_snapshot',
        'computer_processed_phrase_snapshot',
        'vat_exemption_reason_text',
        'subtotal_mzn',
        'tax_total_mzn',
        'total_amount_mzn'
      ]) then
      raise exception using
        message = 'Sales invoice issue preparation may only update legal snapshot fields.';
    end if;

    return new;
  end if;

  if new.approval_status is distinct from old.approval_status then
    if old.document_workflow_status <> 'draft' then
      raise exception using
        message = 'Sales invoice approval state cannot change once the document is issued or voided.';
    end if;

    case old.approval_status
      when 'draft' then
        if new.approval_status <> 'pending_approval' then
          raise exception using
            message = 'Sales invoices can only move from draft to pending approval.';
        end if;
        if not public.finance_documents_can_submit_for_approval(v_company_id) then
          raise exception using
            message = 'Sales invoice approval request access denied.';
        end if;
        new.approval_requested_at := coalesce(new.approval_requested_at, now());
        new.approval_requested_by := coalesce(new.approval_requested_by, auth.uid());
        new.approved_at := null;
        new.approved_by := null;
      when 'pending_approval' then
        if new.approval_status = 'approved' then
          if not public.finance_documents_can_approve(v_company_id) then
            raise exception using
              message = 'Sales invoice approval access denied.';
          end if;
          new.approval_requested_at := coalesce(old.approval_requested_at, new.approval_requested_at, now());
          new.approval_requested_by := coalesce(old.approval_requested_by, new.approval_requested_by, auth.uid());
          new.approved_at := coalesce(new.approved_at, now());
          new.approved_by := coalesce(new.approved_by, auth.uid());
        elsif new.approval_status = 'draft' then
          if not public.finance_documents_can_approve(v_company_id) then
            raise exception using
              message = 'Sales invoice approval reset access denied.';
          end if;
          new.approval_requested_at := null;
          new.approval_requested_by := null;
          new.approved_at := null;
          new.approved_by := null;
        else
          raise exception using
            message = 'Sales invoices can only move from pending approval to approved or back to draft.';
        end if;
      when 'approved' then
        if new.approval_status <> 'draft' then
          raise exception using
            message = 'Approved sales invoices can only be returned to draft before issue.';
        end if;
        if not public.finance_documents_can_approve(v_company_id) then
          raise exception using
            message = 'Sales invoice approval reset access denied.';
        end if;
        new.approval_requested_at := null;
        new.approval_requested_by := null;
        new.approved_at := null;
        new.approved_by := null;
      else
        raise exception using
          message = format('Sales invoice approval state %s is not recognized.', old.approval_status);
    end case;

    if new.document_workflow_status = old.document_workflow_status
       and (to_jsonb(new) - array['updated_at', 'approval_status', 'approval_requested_at', 'approval_requested_by', 'approved_at', 'approved_by'])
         is distinct from
           (to_jsonb(old) - array['updated_at', 'approval_status', 'approval_requested_at', 'approval_requested_by', 'approved_at', 'approved_by']) then
      raise exception using
        message = 'Sales invoice approval transitions cannot edit draft content. Save draft changes before approval routing.';
    end if;
  elsif old.document_workflow_status = 'draft' then
    if old.approval_status = 'draft' then
      if new.document_workflow_status = old.document_workflow_status
         and not public.finance_documents_can_prepare_draft(v_company_id) then
        raise exception using
          message = 'Sales invoice draft edit access denied.';
      end if;
    elsif new.document_workflow_status = old.document_workflow_status
       and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception using
        message = 'Sales invoices are locked once they are pending approval or approved. Return the document to draft before editing it.';
    end if;
  elsif old.document_workflow_status in ('issued', 'voided')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception using
      message = 'Issued or voided sales invoices are immutable.';
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status = 'issued' then
          if old.approval_status <> 'approved' then
            raise exception using
              message = 'Sales invoices must be approved before issue.';
          end if;
          if not public.finance_documents_can_issue_legal(v_company_id) then
            raise exception 'sales_invoice_issue_access_denied';
          end if;
        elsif new.document_workflow_status = 'voided' then
          if not public.finance_documents_can_void(v_company_id) then
            raise exception using
              message = 'Sales invoice void access denied.';
          end if;
        else
          raise exception using
            message = format(
              'Sales invoice status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'issued' then
        raise exception using
          message = format(
            'Sales invoice status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      when 'voided' then
        raise exception using
          message = format(
            'Sales invoice status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      else
        raise exception using
          message = format(
            'Sales invoice status transition %s -> %s is not recognized.',
            old.document_workflow_status,
            new.document_workflow_status
          );
    end case;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_invoice_hardening_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_invoice_hardening_guard"() IS 'Hardens sales invoice workflow transitions and core-field immutability after issue or void.';



CREATE OR REPLACE FUNCTION "public"."sales_invoice_issue_readiness_mz"("p_invoice_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row public.sales_invoices%rowtype;
  v_company public.companies%rowtype;
  v_customer public.customers%rowtype;
  v_order public.sales_orders%rowtype;
  v_settings public.company_fiscal_settings%rowtype;
  v_series public.finance_document_fiscal_series%rowtype;
  v_line_count integer := 0;
  v_exempt_line_count integer := 0;
  v_blockers text[] := array[]::text[];
  v_seller_legal_name text;
  v_seller_nuit text;
  v_seller_address_line1 text;
  v_buyer_legal_name text;
  v_buyer_nuit text;
  v_buyer_address_line1 text;
  v_document_language_code text;
  v_computer_phrase text;
begin
  select si.*
    into v_row
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_row.id is null then
    raise exception 'sales_invoice_not_found';
  end if;

  if not public.finance_documents_can_read(v_row.company_id) then
    raise exception 'finance_document_company_access_denied';
  end if;

  select c.*
    into v_company
  from public.companies c
  where c.id = v_row.company_id;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = v_row.company_id
    and cfs.jurisdiction_code = 'MZ';

  if v_row.customer_id is not null then
    select cu.*
      into v_customer
    from public.customers cu
    where cu.company_id = v_row.company_id
      and cu.id = v_row.customer_id;
  end if;

  if v_row.sales_order_id is not null then
    select so.*
      into v_order
    from public.sales_orders so
    where so.company_id = v_row.company_id
      and so.id = v_row.sales_order_id;
  end if;

  v_seller_legal_name := nullif(
    btrim(
      coalesce(
        v_row.seller_legal_name_snapshot,
        v_company.legal_name,
        v_company.trade_name,
        v_company.name,
        ''
      )
    ),
    ''
  );
  v_seller_nuit := nullif(btrim(coalesce(v_row.seller_nuit_snapshot, v_company.tax_id, '')), '');
  v_seller_address_line1 := nullif(btrim(coalesce(v_row.seller_address_line1_snapshot, v_company.address_line1, '')), '');

  v_buyer_legal_name := nullif(
    btrim(
      coalesce(
        v_row.buyer_legal_name_snapshot,
        v_order.bill_to_name,
        v_customer.name,
        ''
      )
    ),
    ''
  );
  v_buyer_nuit := nullif(
    btrim(
      coalesce(
        v_row.buyer_nuit_snapshot,
        v_order.bill_to_tax_id,
        v_customer.tax_id,
        ''
      )
    ),
    ''
  );
  v_buyer_address_line1 := nullif(
    btrim(
      coalesce(
        v_row.buyer_address_line1_snapshot,
        v_order.bill_to_billing_address,
        v_customer.billing_address,
        ''
      )
    ),
    ''
  );

  v_document_language_code := nullif(
    btrim(
      coalesce(
        v_row.document_language_code_snapshot,
        v_settings.document_language_code,
        ''
      )
    ),
    ''
  );
  v_computer_phrase := nullif(
    btrim(
      coalesce(
        v_row.computer_processed_phrase_snapshot,
        v_settings.computer_processed_phrase_text,
        ''
      )
    ),
    ''
  );

  if v_row.document_workflow_status <> 'draft' then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_not_draft');
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'approved' then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_approved_status');
  end if;

  if v_settings.company_id is null then
    v_blockers := array_append(v_blockers, 'company_fiscal_settings_missing');
  end if;

  if v_row.invoice_date is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_invoice_date');
  end if;

  if v_row.due_date is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_due_date');
  elsif v_row.invoice_date is not null and v_row.due_date < v_row.invoice_date then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_invalid_due_date');
  end if;

  if coalesce(v_row.fx_to_base, 0) <= 0 then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_invalid_fx');
  end if;

  if v_row.source_origin = 'native'
     and (
       v_row.fiscal_series_code is null
       or v_row.fiscal_year is null
       or v_row.fiscal_sequence_number is null
     ) then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_missing_fiscal_identity');
  end if;

  if v_row.source_origin = 'native' and v_row.invoice_date is not null and v_settings.company_id is not null then
    begin
      select *
        into v_series
      from public.resolve_fiscal_series(v_row.company_id, 'sales_invoice', v_row.invoice_date);

      if v_row.fiscal_series_code is distinct from v_series.series_code
         or v_row.fiscal_year is distinct from v_series.fiscal_year then
        v_blockers := array_append(v_blockers, 'sales_invoice_issue_series_mismatch');
      end if;
    exception
      when others then
        v_blockers := array_append(v_blockers, sqlerrm);
    end;
  end if;

  if v_seller_legal_name is null or v_seller_nuit is null or v_seller_address_line1 is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_seller_snapshot');
  end if;

  if v_buyer_legal_name is null or v_buyer_nuit is null or v_buyer_address_line1 is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_buyer_snapshot');
  end if;

  if v_document_language_code is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_document_language');
  end if;

  if v_computer_phrase is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_computer_phrase');
  end if;

  if coalesce(v_row.subtotal, 0) < 0
     or coalesce(v_row.tax_total, 0) < 0
     or coalesce(v_row.total_amount, 0) < 0
     or coalesce(v_row.subtotal_mzn, 0) < 0
     or coalesce(v_row.tax_total_mzn, 0) < 0
     or coalesce(v_row.total_amount_mzn, 0) < 0 then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_invalid_totals');
  end if;

  select count(*),
         count(*) filter (
           where coalesce(sil.line_total, 0) > 0
             and coalesce(sil.tax_rate, 0) <= 0
         )
    into v_line_count, v_exempt_line_count
  from public.sales_invoice_lines sil
  where sil.sales_invoice_id = v_row.id;

  if v_line_count < 1 then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_lines');
  end if;

  if coalesce(v_exempt_line_count, 0) > 0
     and nullif(btrim(coalesce(v_row.vat_exemption_reason_text, '')), '') is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_vat_exemption_reason');
  end if;

  return jsonb_build_object(
    'can_issue',
    coalesce(array_length(v_blockers, 1), 0) = 0,
    'blockers',
    coalesce(to_jsonb(v_blockers), '[]'::jsonb),
    'document_workflow_status',
    v_row.document_workflow_status,
    'approval_status',
    coalesce(v_row.approval_status, 'draft')
  );
end;
$$;


ALTER FUNCTION "public"."sales_invoice_issue_readiness_mz"("p_invoice_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_invoice_issue_readiness_mz"("p_invoice_id" "uuid") IS 'Returns Mozambique issue-time readiness for one sales invoice using the same finance/legal requirements the UI should surface before calling the issue RPC.';



CREATE OR REPLACE FUNCTION "public"."sales_invoice_line_hardening_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  if new.qty = 0 and (new.line_total <> 0 or new.tax_amount <> 0) then
    raise exception using
      message = 'Sales invoice lines with zero quantity must also have zero tax and zero line total.';
  end if;

  if new.line_total = 0 and new.qty > 0 and new.unit_price > 0 then
    raise exception using
      message = 'Sales invoice lines with quantity and unit price above zero cannot have a zero line total.';
  end if;

  if new.line_total < new.tax_amount then
    raise exception using
      message = 'Sales invoice line tax cannot exceed the stored line total.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_invoice_line_hardening_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_invoice_line_hardening_guard"() IS 'Applies minimal sales invoice line consistency checks without enforcing exact pricing arithmetic.';



CREATE OR REPLACE FUNCTION "public"."sales_invoice_lines_parent_issue_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_invoice_id uuid;
  v_status text;
begin
  if public.finance_documents_internal_transition_bypass() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_invoice_id := case when tg_op = 'DELETE' then old.sales_invoice_id else new.sales_invoice_id end;

  select si.document_workflow_status
    into v_status
  from public.sales_invoices si
  where si.id = v_invoice_id;

  if coalesce(v_status, '') in ('issued', 'voided') then
    raise exception 'sales_invoice_lines_parent_locked';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


ALTER FUNCTION "public"."sales_invoice_lines_parent_issue_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_invoice_lines_parent_issue_guard"() IS 'Prevents insert, update, or delete on invoice lines after the parent sales invoice is issued or voided.';



CREATE OR REPLACE FUNCTION "public"."sales_invoice_snapshot_fiscal_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_company public.companies%rowtype;
  v_customer record;
  v_order record;
  v_settings public.company_fiscal_settings%rowtype;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select c.*
    into v_company
  from public.companies c
  where c.id = new.company_id;

  if v_company.id is null then
    raise exception 'sales_invoice_company_not_found';
  end if;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = new.company_id;

  if v_settings.company_id is null then
    raise exception 'company_fiscal_settings_missing';
  end if;

  if new.customer_id is not null then
    select
      c.name,
      c.tax_id,
      c.billing_address,
      c.shipping_address
      into v_customer
    from public.customers c
    where c.id = new.customer_id;
  end if;

  if new.sales_order_id is not null then
    select
      so.bill_to_name,
      so.bill_to_tax_id,
      so.bill_to_billing_address,
      so.bill_to_shipping_address
      into v_order
    from public.sales_orders so
    where so.id = new.sales_order_id;
  end if;

  new.seller_legal_name_snapshot := coalesce(
    nullif(new.seller_legal_name_snapshot, ''),
    nullif(v_company.legal_name, ''),
    nullif(v_company.trade_name, ''),
    nullif(v_company.name, '')
  );
  new.seller_trade_name_snapshot := coalesce(
    nullif(new.seller_trade_name_snapshot, ''),
    nullif(v_company.trade_name, ''),
    nullif(v_company.name, '')
  );
  new.seller_nuit_snapshot := coalesce(
    nullif(new.seller_nuit_snapshot, ''),
    nullif(v_company.tax_id, '')
  );
  new.seller_address_line1_snapshot := coalesce(
    nullif(new.seller_address_line1_snapshot, ''),
    nullif(v_company.address_line1, '')
  );
  new.seller_address_line2_snapshot := coalesce(
    nullif(new.seller_address_line2_snapshot, ''),
    nullif(v_company.address_line2, '')
  );
  new.seller_city_snapshot := coalesce(
    nullif(new.seller_city_snapshot, ''),
    nullif(v_company.city, '')
  );
  new.seller_state_snapshot := coalesce(
    nullif(new.seller_state_snapshot, ''),
    nullif(v_company.state, '')
  );
  new.seller_postal_code_snapshot := coalesce(
    nullif(new.seller_postal_code_snapshot, ''),
    nullif(v_company.postal_code, '')
  );
  new.seller_country_code_snapshot := coalesce(
    nullif(new.seller_country_code_snapshot, ''),
    nullif(v_company.country_code, '')
  );

  new.buyer_legal_name_snapshot := coalesce(
    nullif(new.buyer_legal_name_snapshot, ''),
    nullif(v_order.bill_to_name, ''),
    nullif(v_customer.name, '')
  );
  new.buyer_nuit_snapshot := coalesce(
    nullif(new.buyer_nuit_snapshot, ''),
    nullif(v_order.bill_to_tax_id, ''),
    nullif(v_customer.tax_id, '')
  );
  new.buyer_address_line1_snapshot := coalesce(
    nullif(new.buyer_address_line1_snapshot, ''),
    nullif(v_order.bill_to_billing_address, ''),
    nullif(v_customer.billing_address, '')
  );
  new.buyer_address_line2_snapshot := coalesce(
    nullif(new.buyer_address_line2_snapshot, ''),
    nullif(v_order.bill_to_shipping_address, ''),
    nullif(v_customer.shipping_address, '')
  );
  new.buyer_country_code_snapshot := coalesce(
    nullif(new.buyer_country_code_snapshot, ''),
    nullif(v_company.country_code, '')
  );
  new.document_language_code_snapshot := coalesce(
    nullif(new.document_language_code_snapshot, ''),
    v_settings.document_language_code
  );
  new.computer_processed_phrase_snapshot := coalesce(
    nullif(new.computer_processed_phrase_snapshot, ''),
    v_settings.computer_processed_phrase_text
  );
  new.compliance_rule_version_snapshot := coalesce(
    nullif(new.compliance_rule_version_snapshot, ''),
    v_settings.compliance_rule_version
  );
  new.subtotal_mzn := round(coalesce(new.subtotal, 0) * coalesce(new.fx_to_base, 1), 2);
  new.tax_total_mzn := round(coalesce(new.tax_total, 0) * coalesce(new.fx_to_base, 1), 2);
  new.total_amount_mzn := round(coalesce(new.total_amount, 0) * coalesce(new.fx_to_base, 1), 2);

  update public.sales_invoice_lines sil
     set product_code_snapshot = coalesce(
           sil.product_code_snapshot,
           src.item_sku,
           src.item_id_text
         ),
         unit_of_measure_snapshot = coalesce(
           sil.unit_of_measure_snapshot,
           src.sales_order_line_uom_id_text,
           src.item_base_uom_id_text
         ),
         tax_category_code = coalesce(
           sil.tax_category_code,
           case when coalesce(sil.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
    from (
      select
        sil2.id as sales_invoice_line_id,
        nullif(i.sku, '') as item_sku,
        sil2.item_id::text as item_id_text,
        nullif(sol.uom_id::text, '') as sales_order_line_uom_id_text,
        nullif(i.base_uom_id::text, '') as item_base_uom_id_text
      from public.sales_invoice_lines sil2
      left join public.items i
        on i.id is not distinct from sil2.item_id
      left join public.sales_order_lines sol
        on sol.id is not distinct from sil2.sales_order_line_id
      where sil2.sales_invoice_id = new.id
    ) src
   where sil.id = src.sales_invoice_line_id;

  update public.sales_invoice_lines sil
     set product_code_snapshot = coalesce(sil.product_code_snapshot, sil.item_id::text, 'ITEM'),
         unit_of_measure_snapshot = coalesce(sil.unit_of_measure_snapshot, 'UN'),
         tax_category_code = coalesce(
           sil.tax_category_code,
           case when coalesce(sil.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
   where sil.sales_invoice_id = new.id
     and (sil.product_code_snapshot is null
       or sil.unit_of_measure_snapshot is null
       or sil.tax_category_code is null);

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_invoice_snapshot_fiscal_fields"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_invoice_snapshot_fiscal_fields"() IS 'Patches line snapshot updates for invoice issue so target-table aliases are not referenced illegally inside FROM-clause joins.';



CREATE OR REPLACE FUNCTION "public"."sales_invoice_transfer_settlement_anchor"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  if new.document_workflow_status = 'issued'
     and coalesce(old.document_workflow_status, '') <> 'issued' then
    perform public.transfer_sales_order_settlement_anchor(new.id);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_invoice_transfer_settlement_anchor"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_invoice_transfer_settlement_anchor"() IS 'After an invoice is issued, transfers any order-linked settlement records onto the invoice anchor.';



CREATE OR REPLACE FUNCTION "public"."sales_invoice_validate_issue_mz"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_line_count integer;
  v_exempt_line_count integer;
  v_settings public.company_fiscal_settings%rowtype;
  v_series public.finance_document_fiscal_series%rowtype;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = new.company_id
    and cfs.jurisdiction_code = 'MZ';

  if v_settings.company_id is null then
    raise exception 'company_fiscal_settings_missing';
  end if;

  new.vat_exemption_reason_text := nullif(btrim(coalesce(new.vat_exemption_reason_text, '')), '');

  if new.invoice_date is null then
    raise exception 'sales_invoice_issue_requires_invoice_date';
  end if;

  if new.due_date is null then
    raise exception 'sales_invoice_issue_requires_due_date';
  end if;

  if new.due_date < new.invoice_date then
    raise exception 'sales_invoice_issue_invalid_due_date';
  end if;

  if coalesce(new.fx_to_base, 0) <= 0 then
    raise exception 'sales_invoice_issue_invalid_fx';
  end if;

  if new.source_origin = 'native'
     and (
       new.fiscal_series_code is null
       or new.fiscal_year is null
       or new.fiscal_sequence_number is null
     ) then
    raise exception 'sales_invoice_issue_missing_fiscal_identity';
  end if;

  if new.source_origin = 'native' then
    select *
      into v_series
    from public.resolve_fiscal_series(new.company_id, 'sales_invoice', new.invoice_date);

    if v_series.series_code is distinct from new.fiscal_series_code
       or v_series.fiscal_year is distinct from new.fiscal_year then
      raise exception 'sales_invoice_issue_series_mismatch';
    end if;
  end if;

  if nullif(btrim(coalesce(new.seller_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.seller_nuit_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.seller_address_line1_snapshot, '')), '') is null then
    raise exception 'sales_invoice_issue_requires_seller_snapshot';
  end if;

  if nullif(btrim(coalesce(new.buyer_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_nuit_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_address_line1_snapshot, '')), '') is null then
    raise exception 'sales_invoice_issue_requires_buyer_snapshot';
  end if;

  if nullif(btrim(coalesce(new.document_language_code_snapshot, '')), '') is null then
    raise exception 'sales_invoice_issue_requires_document_language';
  end if;

  if nullif(btrim(coalesce(new.computer_processed_phrase_snapshot, '')), '') is null then
    raise exception 'sales_invoice_issue_requires_computer_phrase';
  end if;

  if coalesce(new.subtotal, 0) < 0
     or coalesce(new.tax_total, 0) < 0
     or coalesce(new.total_amount, 0) < 0
     or coalesce(new.subtotal_mzn, 0) < 0
     or coalesce(new.tax_total_mzn, 0) < 0
     or coalesce(new.total_amount_mzn, 0) < 0 then
    raise exception 'sales_invoice_issue_invalid_totals';
  end if;

  select count(*),
         count(*) filter (
           where coalesce(sil.line_total, 0) > 0
             and coalesce(sil.tax_rate, 0) <= 0
         )
    into v_line_count, v_exempt_line_count
  from public.sales_invoice_lines sil
  where sil.sales_invoice_id = new.id;

  if v_line_count < 1 then
    raise exception 'sales_invoice_issue_requires_lines';
  end if;

  if coalesce(v_exempt_line_count, 0) > 0
     and new.vat_exemption_reason_text is null then
    raise exception 'sales_invoice_issue_requires_vat_exemption_reason';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_invoice_validate_issue_mz"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_invoice_validate_issue_mz"() IS 'Validates Mozambique issue-time requirements for sales invoices before the document can transition into issued status.';



CREATE OR REPLACE FUNCTION "public"."sales_note_line_hardening_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  if coalesce(new.line_total, 0) = 0
     and coalesce(new.qty, 0) > 0
     and coalesce(new.unit_price, 0) > 0 then
    raise exception using
      message = 'Sales note lines with quantity and unit price above zero cannot have a zero line total.';
  end if;

  if coalesce(new.line_total, 0) < coalesce(new.tax_amount, 0) then
    raise exception using
      message = 'Sales note line tax cannot exceed the stored line total.';
  end if;

  if coalesce(new.qty, 0) = 0
     and coalesce(new.line_total, 0) > 0
     and coalesce(new.unit_price, 0) <= 0 then
    raise exception using
      message = 'Sales note lines with a value-only adjustment must keep a positive unit price.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_note_line_hardening_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sales_note_lines_parent_issue_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_note_id uuid;
  v_status text;
begin
  if public.finance_documents_internal_transition_bypass() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'sales_credit_note_lines' then
    if tg_op = 'DELETE' then
      v_note_id := old.sales_credit_note_id;
    else
      v_note_id := new.sales_credit_note_id;
    end if;

    select scn.document_workflow_status
      into v_status
    from public.sales_credit_notes scn
    where scn.id = v_note_id;
  elsif tg_table_name = 'sales_debit_note_lines' then
    if tg_op = 'DELETE' then
      v_note_id := old.sales_debit_note_id;
    else
      v_note_id := new.sales_debit_note_id;
    end if;

    select sdn.document_workflow_status
      into v_status
    from public.sales_debit_notes sdn
    where sdn.id = v_note_id;
  else
    raise exception using
      message = format('sales_note_lines_parent_issue_guard does not support table %s.', tg_table_name);
  end if;

  if v_status in ('issued', 'voided') then
    raise exception using
      message = 'Issued or voided sales notes cannot change line items.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_note_lines_parent_issue_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sales_note_lines_parent_issue_guard"() IS 'Blocks insert, update, and delete on sales credit/debit note lines once the parent note is issued or voided.';



CREATE OR REPLACE FUNCTION "public"."seed_default_payment_terms"("p_company_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_company_id is null then
    raise exception 'company_id_required';
  end if;

  insert into public.payment_terms (company_id, code, name, net_days, description)
  values
    (p_company_id, 'DUE_ON_RECEIPT', 'Due on Receipt', 0, 'Payment is due immediately on receipt.'),
    (p_company_id, 'NET7', 'Net 7', 7, 'Payment due seven days from the order or invoice date.'),
    (p_company_id, 'NET15', 'Net 15', 15, 'Payment due fifteen days from the order or invoice date.'),
    (p_company_id, 'NET30', 'Net 30', 30, 'Payment due thirty days from the order or invoice date.'),
    (p_company_id, 'NET60', 'Net 60', 60, 'Payment due sixty days from the order or invoice date.'),
    (p_company_id, 'COD', 'Cash on Delivery', 0, 'Payment due when goods or services are delivered.')
  on conflict (company_id, code) do nothing;
end;
$$;


ALTER FUNCTION "public"."seed_default_payment_terms"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_active_company"("p_company" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.company_members m
    WHERE m.company_id = p_company
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not an active member of this company' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_active_company AS uac (user_id, company_id, updated_at)
  VALUES (auth.uid(), p_company, now())
  ON CONFLICT (user_id) DO UPDATE
    SET company_id = EXCLUDED.company_id,
        updated_at = now();

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."set_active_company"("p_company" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_base_currency_for_current_company"("p_code" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  v_company_id uuid := public.current_company_id();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or v_company_id is null
       or not public.has_company_role(v_company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  perform 1 from public.currencies where code = p_code;
  if not found then
    raise exception 'Unknown currency code: %', p_code using errcode = '22023';
  end if;

  insert into public.company_settings (company_id, base_currency_code, updated_at, updated_by)
  values (v_company_id, p_code, now(), auth.uid())
  on conflict (company_id) do update
    set base_currency_code = excluded.base_currency_code,
        updated_at = now(),
        updated_by = auth.uid();
end
$$;


ALTER FUNCTION "public"."set_base_currency_for_current_company"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_company_id_from_session"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
begin
  if new.company_id is null then
    new.company_id := current_company_id();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_company_id_from_session"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_so_order_no"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_company_id uuid;
  v_prefix     text;
  v_next       bigint;
BEGIN
  -- already set? leave it alone
  IF NEW.order_no IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- ensure we have a company_id even if another trigger hasn't run yet
  v_company_id := COALESCE(NEW.company_id, current_company_id());

  -- derive 3-letter alpha prefix from company name
  SELECT UPPER(SUBSTRING(regexp_replace(c.name, '[^A-Za-z]', '', 'g') FROM 1 FOR 3))
    INTO v_prefix
  FROM public.companies c
  WHERE c.id = v_company_id;

  IF v_prefix IS NULL OR length(v_prefix) < 3 THEN
    v_prefix := 'XXX';
  END IF;

  -- atomically bump per-company SO counter
  WITH upsert AS (
    INSERT INTO public.order_counters(company_id, type, last_value)
    VALUES (v_company_id, 'SO', 1)
    ON CONFLICT (type, company_id)
    DO UPDATE SET last_value = public.order_counters.last_value + 1
    RETURNING last_value
  )
  SELECT last_value INTO v_next FROM upsert;

  NEW.company_id := v_company_id; -- just to be safe
  NEW.order_no   := format('%s-SO%09d', v_prefix, v_next);
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."set_so_order_no"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  new.updated_at := now();
  return new;
end
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at_ts"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
begin
  new.updated_at := now();
  return new;
end
$$;


ALTER FUNCTION "public"."set_updated_at_ts"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text",
    "customer_id" "uuid" NOT NULL,
    "order_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "currency_code" character(3) NOT NULL,
    "status" "public"."so_status" DEFAULT 'draft'::"public"."so_status" NOT NULL,
    "subtotal" numeric(18,4) DEFAULT 0 NOT NULL,
    "tax_total" numeric(18,4) DEFAULT 0 NOT NULL,
    "total" numeric(18,4) DEFAULT 0 NOT NULL,
    "billing_address" "text",
    "shipping_address" "text",
    "notes" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expected_ship_date" "date",
    "fx_to_base" numeric(18,6) DEFAULT 1 NOT NULL,
    "customer" "text",
    "public_id" "text" GENERATED ALWAYS AS (('SO-'::"text" || "left"(("id")::"text", 8))) STORED,
    "shipped_at" timestamp with time zone,
    "payment_terms" "text",
    "bill_to_name" "text",
    "bill_to_email" "text",
    "bill_to_phone" "text",
    "bill_to_tax_id" "text",
    "bill_to_billing_address" "text",
    "bill_to_shipping_address" "text",
    "total_amount" numeric,
    "company_id" "uuid",
    "order_no" "text",
    "payment_terms_id" "uuid",
    "due_date" "date",
    "reference_no" "text",
    "delivery_terms" "text",
    "internal_notes" "text",
    "prepared_by" "text",
    "approved_by" "text",
    "confirmed_by" "text",
    CONSTRAINT "sales_orders_order_no_check" CHECK ((("order_no" IS NULL) OR ("order_no" ~ '^[A-Z]{3}-SO[0-9]{9}$'::"text"))),
    CONSTRAINT "so_order_no_format_chk" CHECK ((("order_no" IS NULL) OR ("order_no" ~ '^[A-Z]{3}-SO[0-9]{9}$'::"text")))
);

ALTER TABLE ONLY "public"."sales_orders" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_orders" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."so_balance_due_base"("p_row" "public"."sales_orders") RETURNS numeric
    LANGUAGE "sql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT
    (
      COALESCE(p_row.total_amount,0)::numeric * COALESCE(p_row.fx_to_base,1)::numeric
      -
      COALESCE((
        SELECT SUM(ct.amount_base)
        FROM public.cash_transactions ct
        WHERE ct.company_id = p_row.company_id
          AND ct.ref_type   = 'SO'
          AND ct.ref_id     = p_row.id
          AND ct.type       = 'sale_receipt'
      ), 0)::numeric
    )
$$;


ALTER FUNCTION "public"."so_balance_due_base"("p_row" "public"."sales_orders") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."so_is_awaiting_now"("p_row" "public"."sales_orders") RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT
    (p_row.status::text = 'shipped')
    AND (
      COALESCE(p_row.total_amount,0)::numeric * COALESCE(p_row.fx_to_base,1)::numeric
      -
      COALESCE((
        SELECT SUM(ct.amount_base)
        FROM public.cash_transactions ct
        WHERE ct.company_id = p_row.company_id
          AND ct.ref_type   = 'SO'
          AND ct.ref_id     = p_row.id
          AND ct.type       = 'sale_receipt'
      ), 0)::numeric
    ) > 0
$$;


ALTER FUNCTION "public"."so_is_awaiting_now"("p_row" "public"."sales_orders") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."so_line_set_company_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
BEGIN
  SELECT company_id INTO NEW.company_id
  FROM public.sales_orders
  WHERE id = NEW.so_id;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."so_line_set_company_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."so_maybe_mark_shipped"("p_so_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_status public.so_status;
BEGIN
  IF p_so_id IS NULL THEN RETURN; END IF;
  SELECT status INTO v_status FROM public.sales_orders WHERE id = p_so_id;
  IF v_status NOT IN ('submitted','confirmed','allocated') THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.sales_order_lines l WHERE l.so_id = p_so_id)
     AND NOT EXISTS (SELECT 1 FROM public.sales_order_lines l WHERE l.so_id = p_so_id AND COALESCE(l.is_shipped,false)=false) THEN
    UPDATE public.sales_orders
       SET status='shipped', shipped_at=COALESCE(shipped_at, now()), updated_at=now()
     WHERE id=p_so_id;
  END IF;
END;$$;


ALTER FUNCTION "public"."so_maybe_mark_shipped"("p_so_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."so_set_company_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.company_id is null then
    new.company_id := public.current_company_id();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."so_set_company_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."so_set_company_id_and_number"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  -- Normalize currency code to 3-letter upper if provided
  if NEW.currency_code is not null then
    NEW.currency_code := upper(substring(NEW.currency_code from 1 for 3));
  end if;

  -- Require company_id to be set (your generic tg_set_company_id() should run first)
  if NEW.company_id is null then
    -- If you prefer to silently skip, replace with: return NEW;
    raise exception 'company_id must be set before generating order_no';
  end if;

  -- Auto-number if missing
  if NEW.order_no is null then
    NEW.order_no := public.next_so_order_no(NEW.company_id);
  end if;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."so_set_company_id_and_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."so_set_due_date"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_net integer;
BEGIN
  -- If caller explicitly set due_date, respect it
  IF NEW.due_date IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_terms_id IS NOT NULL THEN
    SELECT net_days INTO v_net
      FROM public.payment_terms
     WHERE id = NEW.payment_terms_id
       AND company_id = NEW.company_id;

    IF v_net IS NOT NULL THEN
      NEW.due_date := (NEW.order_date + make_interval(days => v_net));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."so_set_due_date"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."so_sync_status_after_lines"("p_so" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_total   int;
  v_shipped int;
  v_cur     public.so_status;
BEGIN
  SELECT COUNT(*),
         SUM(CASE WHEN COALESCE(shipped_qty,0) >= COALESCE(qty,0) OR is_shipped IS TRUE THEN 1 ELSE 0 END)
    INTO v_total, v_shipped
  FROM public.sales_order_lines
  WHERE so_id = p_so;

  SELECT status INTO v_cur FROM public.sales_orders WHERE id = p_so FOR UPDATE;

  IF v_total > 0 AND v_shipped = v_total AND v_cur NOT IN ('cancelled','closed') THEN
    UPDATE public.sales_orders
       SET status     = 'shipped',
           shipped_at = COALESCE(shipped_at, NOW()),
           updated_at = NOW()
     WHERE id = p_so;
  END IF;
END;
$$;


ALTER FUNCTION "public"."so_sync_status_after_lines"("p_so" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sol_recalc_shipped"("p_so_line_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_so_id uuid;
  v_qty numeric;
  v_shipped numeric;
  v_now timestamp with time zone := now();
begin
  select so_id, qty
    into v_so_id, v_qty
  from public.sales_order_lines
  where id = p_so_line_id;

  if v_so_id is null then
    return;
  end if;

  select coalesce(sum(s.qty), 0)
    into v_shipped
  from public.sales_shipments s
  where s.so_line_id = p_so_line_id;

  update public.sales_order_lines l
     set shipped_qty = v_shipped,
         is_shipped = (v_shipped >= coalesce(v_qty, 0)),
         shipped_at = case
           when v_shipped >= coalesce(v_qty, 0) then coalesce(l.shipped_at, v_now)
           else l.shipped_at
         end
   where l.id = p_so_line_id;

  perform public.so_maybe_mark_shipped(v_so_id);
end;
$$;


ALTER FUNCTION "public"."sol_recalc_shipped"("p_so_line_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stock_movements_sync_levels"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  old_in_qty  numeric := 0;
  old_out_qty numeric := 0;
  new_in_qty  numeric := 0;
  new_out_qty numeric := 0;
  delta_in    numeric;
  delta_out   numeric;
BEGIN
  -- Old values (for UPDATE/DELETE)
  IF TG_OP <> 'INSERT' THEN
    old_in_qty  := CASE WHEN OLD.warehouse_to_id   IS NOT NULL
                        THEN COALESCE(OLD.qty_base, OLD.qty, 0)::numeric ELSE 0 END;
    old_out_qty := CASE WHEN OLD.warehouse_from_id IS NOT NULL
                        THEN COALESCE(OLD.qty_base, OLD.qty, 0)::numeric ELSE 0 END;
  END IF;

  -- New values (for INSERT/UPDATE)
  IF TG_OP <> 'DELETE' THEN
    NEW.qty_base := COALESCE(NEW.qty_base, NEW.qty, 0); -- normalize
    new_in_qty  := CASE WHEN NEW.warehouse_to_id   IS NOT NULL THEN NEW.qty_base::numeric ELSE 0 END;
    new_out_qty := CASE WHEN NEW.warehouse_from_id IS NOT NULL THEN NEW.qty_base::numeric ELSE 0 END;
  END IF;

  -- deltas to apply
  delta_in  := new_in_qty  - old_in_qty;   -- + increases dest stock; - decreases
  delta_out := new_out_qty - old_out_qty;  -- + increases source *consumption*; we subtract from stock

  -- Apply to destination (in)
  IF TG_OP <> 'DELETE' AND NEW.warehouse_to_id IS NOT NULL THEN
    PERFORM public._upsert_level(NEW.company_id, NEW.item_id, NEW.warehouse_to_id, NEW.bin_to_id,  delta_in);
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.warehouse_to_id IS NOT NULL AND (NEW.warehouse_to_id IS DISTINCT FROM OLD.warehouse_to_id OR NEW.bin_to_id IS DISTINCT FROM OLD.bin_to_id) THEN
    -- movement relocated: remove old dest qty
    PERFORM public._upsert_level(OLD.company_id, OLD.item_id, OLD.warehouse_to_id, OLD.bin_to_id, -old_in_qty);
  END IF;

  -- Apply to source (out) as negative
  IF TG_OP <> 'DELETE' AND NEW.warehouse_from_id IS NOT NULL THEN
    PERFORM public._upsert_level(NEW.company_id, NEW.item_id, NEW.warehouse_from_id, NEW.bin_from_id, -delta_out);
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.warehouse_from_id IS NOT NULL AND (NEW.warehouse_from_id IS DISTINCT FROM OLD.warehouse_from_id OR NEW.bin_from_id IS DISTINCT FROM OLD.bin_from_id) THEN
    -- movement relocated: put back old source qty
    PERFORM public._upsert_level(OLD.company_id, OLD.item_id, OLD.warehouse_from_id, OLD.bin_from_id, +old_out_qty);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."stock_movements_sync_levels"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."strip_nonalpha"("s" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select coalesce(regexp_replace(upper(coalesce(s,'')), '[^A-Z]', '', 'g'), '')
$$;


ALTER FUNCTION "public"."strip_nonalpha"("s" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_saft_moz_export_run"("p_export_id" "uuid", "p_submission_reference" "text" DEFAULT NULL::"text") RETURNS "public"."saft_moz_exports"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_export public.saft_moz_exports;
begin
  select sme.*
    into v_export
  from public.saft_moz_exports sme
  where sme.id = p_export_id;

  if v_export.id is null then
    raise exception using
      message = 'SAF-T export run not found.';
  end if;

  if not public.finance_documents_can_write(v_export.company_id) then
    raise exception using
      message = 'SAF-T export submit access denied.';
  end if;

  if v_export.status <> 'generated' then
    raise exception using
      message = format('SAF-T export can only transition from generated to submitted, not %s.', coalesce(v_export.status, '<null>'));
  end if;

  update public.saft_moz_exports sme
     set status = 'submitted',
         submitted_by = auth.uid(),
         submitted_at = now(),
         submission_reference = nullif(btrim(coalesce(p_submission_reference, '')), '')
   where sme.id = p_export_id
  returning sme.* into v_export;

  perform public.append_finance_document_event(
    v_export.company_id,
    'saft_moz_export',
    v_export.id,
    'saft_export_submitted',
    'generated',
    v_export.status,
    jsonb_build_object(
      'submission_reference', v_export.submission_reference
    )
  );

  return v_export;
end;
$$;


ALTER FUNCTION "public"."submit_saft_moz_export_run"("p_export_id" "uuid", "p_submission_reference" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_company_purge_queue"("p_company_id" "uuid", "p_scheduled_for" timestamp with time zone, "p_reason" "text", "p_created_by" "uuid" DEFAULT "auth"."uid"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    SET "row_security" TO 'off'
    AS $$
begin
  if p_scheduled_for is null then
    update public.company_purge_queue
       set status = 'cancelled',
           reason = coalesce(nullif(trim(p_reason), ''), reason),
           updated_at = timezone('utc', now())
     where company_id = p_company_id
       and status in ('scheduled', 'processing');
    return;
  end if;

  insert into public.company_purge_queue (
    company_id,
    scheduled_for,
    status,
    reason,
    created_by
  )
  values (
    p_company_id,
    p_scheduled_for,
    'scheduled',
    coalesce(nullif(trim(p_reason), ''), 'Scheduled operational trial-data purge'),
    p_created_by
  )
  on conflict (company_id) do update
     set scheduled_for = excluded.scheduled_for,
         status = 'scheduled',
         reason = excluded.reason,
         completed_at = null,
         updated_at = timezone('utc', now());
end;
$$;


ALTER FUNCTION "public"."sync_company_purge_queue"("p_company_id" "uuid", "p_scheduled_for" timestamp with time zone, "p_reason" "text", "p_created_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_customer_payment_terms_text"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE v text;
BEGIN
  IF NEW.payment_terms_id IS NOT NULL THEN
     SELECT code INTO v FROM public.payment_terms WHERE id = NEW.payment_terms_id;
     NEW.payment_terms := v;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."sync_customer_payment_terms_text"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_invites_for_me"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_claim_email text := lower(nullif(current_setting('request.jwt.claim.email', true), ''));
  v_uid uuid := auth.uid();
  v_count integer := 0;
begin
  if v_uid is null or v_claim_email is null then
    return 0;
  end if;

  update public.company_members m
     set user_id = v_uid,
         status  = case when m.status = 'disabled' then 'disabled' else 'active' end
   where m.user_id is distinct from v_uid
     and lower(m.email) = lower(v_claim_email);

  get diagnostics v_count = row_count;

  update public.company_invites i
     set accepted_at = coalesce(accepted_at, now())
   where lower(i.email) = lower(v_claim_email)
     and i.accepted_at is null
     and now() < i.expires_at;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."sync_invites_for_me"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_payment_terms_customers"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if new.payment_terms_id is not null and (new.payment_terms is null or new.payment_terms='') then
    select code into new.payment_terms from public.payment_terms where id=new.payment_terms_id;
  elsif new.payment_terms_id is null and new.payment_terms is not null then
    select pt.id into new.payment_terms_id
    from public.payment_terms pt
    where pt.company_id=new.company_id and upper(pt.code)=upper(new.payment_terms)
    limit 1;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_payment_terms_customers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_payment_terms_sales_orders"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if new.payment_terms_id is not null and (new.payment_terms is null or new.payment_terms='') then
    select code into new.payment_terms from public.payment_terms where id=new.payment_terms_id;
  elsif new.payment_terms_id is null and new.payment_terms is not null then
    select pt.id into new.payment_terms_id
    from public.payment_terms pt
    where pt.company_id=new.company_id and upper(pt.code)=upper(new.payment_terms)
    limit 1;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_payment_terms_sales_orders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_profiles_user_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
begin
  if new.user_id is null then
    new.user_id := new.id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_profiles_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_bins_company_fill"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
begin
  if new.company_id is null then
    select w.company_id into new.company_id
    from public.warehouses w
    where w.id = new."warehouseId";
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."tg_bins_company_fill"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_bins_set_company"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  wid  uuid;
  wcid uuid;
  r    jsonb;
begin
  r := to_jsonb(NEW);

  -- Try snake_case, then all-lower, then camelCase
  wid :=
    coalesce(
      (r->>'warehouse_id')::uuid,
      (r->>'warehouseid')::uuid,
      (r->>'warehouseId')::uuid
    );

  -- On UPDATE, if NEW didn't have a warehouse field (rare), fall back to OLD
  if wid is null and TG_OP = 'UPDATE' then
    r := to_jsonb(OLD);
    wid :=
      coalesce(
        (r->>'warehouse_id')::uuid,
        (r->>'warehouseid')::uuid,
        (r->>'warehouseId')::uuid
      );
  end if;

  if NEW.company_id is null and wid is not null then
    select w.company_id into wcid
    from public.warehouses w
    where w.id = wid;

    NEW.company_id := wcid;
  end if;

  return NEW;
end
$$;


ALTER FUNCTION "public"."tg_bins_set_company"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_call_worker_after_enqueue"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if new.status = 'pending' then
    perform public.invoke_digest_worker();
  end if;
  return new;
end
$$;


ALTER FUNCTION "public"."tg_call_worker_after_enqueue"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_companies_autolink"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  owner_email text;
begin
  if new.owner_user_id is null then
    new.owner_user_id := auth.uid();
  end if;

  select u.email into owner_email from auth.users u where u.id = new.owner_user_id;

  insert into public.company_members(company_id, user_id, email, role, status, invited_by)
  values (new.id, new.owner_user_id, owner_email, 'OWNER'::member_role, 'active'::member_status, new.owner_user_id)
  on conflict (company_id, email) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."tg_companies_autolink"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_movements_company_fill"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
      declare cid uuid;
      begin
        if new.company_id is null then
          select i.company_id into cid from public.items i where i.id = new.item_id;
          if cid is null and new.to_warehouse_id is not null then
            select w.company_id into cid from public.warehouses w where w.id = new.to_warehouse_id;
          end if;
          if cid is null and new.from_warehouse_id is not null then
            select w.company_id into cid from public.warehouses w where w.id = new.from_warehouse_id;
          end if;
          new.company_id := cid;
        end if;
        return new;
      end;
      $$;


ALTER FUNCTION "public"."tg_movements_company_fill"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_notify_member_activated"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  -- Fire on INSERT as active, or UPDATE from non-active -> active
  if (tg_op = 'INSERT' and new.status = 'active')
     or (tg_op = 'UPDATE' and coalesce(old.status, 'invited') <> 'active' and new.status = 'active')
  then
    -- Insert a broadcast notification to everyone in the company (user_id = null)
    insert into public.notifications
      (id, company_id, user_id, level, title, body, url, icon, created_at)
    values
      (
        gen_random_uuid(),
        new.company_id,
        null,                            -- broadcast to the whole company
        'info',
        'New member joined',
        format('%s joined the company.', coalesce(public.display_name_for_user(new.user_id), new.email)),
        '/users',
        'user-plus',
        now()
      );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."tg_notify_member_activated"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_po_awaiting_notify"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  was_awaiting boolean := FALSE;
  now_awaiting boolean := FALSE;
  bal numeric;
  title text;
  body  text;
  url   text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    now_awaiting := public.po_is_awaiting_now(NEW);
  ELSE
    was_awaiting := public.po_is_awaiting_now(OLD);
    now_awaiting := public.po_is_awaiting_now(NEW);
  END IF;

  IF now_awaiting AND NOT was_awaiting THEN
    bal := public.po_balance_due_base(NEW);
    title := 'Awaiting approval: Purchase Order';
    body  := format('PO %s • Due %s',
                    COALESCE(NEW.order_no, left(NEW.id::text,8)),
                    COALESCE(bal,0));
    url   := '/cash/approvals';  -- or '/purchase-orders/'||NEW.id
    PERFORM public.emit_cash_approval_notif(NEW.company_id, title, body, url, 'warning');
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."tg_po_awaiting_notify"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_po_status_notify"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_old text := coalesce(old.status::text, '');
  v_new text := coalesce(new.status::text, '');
begin
  -- Only act when status actually changes
  if tg_op = 'UPDATE' and v_new is distinct from v_old then
    -- Approved → notify approver/company (example)
    if lower(btrim(v_new)) = 'approved' then
      insert into public.notifications(company_id, user_id, level, title, body, url, icon, meta)
      values (
        new.company_id, null, 'info',
        'PO approved',
        'PO ' || coalesce(new.order_no, new.id::text) || ' was approved.',
        '/orders/purchase/' || new.id::text,
        'check-circle',
        jsonb_build_object('po_id', new.id, 'status', v_new, 'actor', auth.uid())
      );
    end if;

    -- Closed → notify company
    if lower(btrim(v_new)) = 'closed' then
      insert into public.notifications(company_id, user_id, level, title, body, url, icon, meta)
      values (
        new.company_id, null, 'info',
        'PO closed',
        'All items received for ' || coalesce(new.order_no, new.id::text) || '.',
        '/orders/purchase/' || new.id::text,
        'package-check',
        jsonb_build_object('po_id', new.id, 'status', v_new, 'actor', auth.uid())
      );
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."tg_po_status_notify"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_pol_company_fill"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  v_company uuid;
begin
  if new.po_id is not null then
    select company_id into v_company from public.purchase_orders where id = new.po_id;
  end if;
  new.company_id := coalesce(new.company_id, v_company, current_company_id());
  return new;
end
$$;


ALTER FUNCTION "public"."tg_pol_company_fill"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_purchase_orders_company_fill"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
begin
  if new.company_id is null then
    new.company_id := current_company_id();
  end if;
  return new;
end
$$;


ALTER FUNCTION "public"."tg_purchase_orders_company_fill"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_sales_shipments_company_fill"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
declare
  cid uuid;
begin
  if new.company_id is null and new.so_id is not null then
    select so.company_id into cid from public.sales_orders so where so.id = new.so_id;
  end if;
  if new.company_id is null and cid is null and new.movement_id is not null then
    select sm.company_id into cid from public.stock_movements sm where sm.id = new.movement_id;
  end if;
  if new.company_id is null then
    new.company_id := cid;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."tg_sales_shipments_company_fill"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_sales_shipments_recalc_line"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM public.sol_recalc_shipped(COALESCE(NEW.so_line_id, OLD.so_line_id));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;$$;


ALTER FUNCTION "public"."tg_sales_shipments_recalc_line"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_sales_shipments_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    IF NEW.so_line_id IS NOT NULL THEN
      PERFORM public.recompute_so_line_shipped(NEW.so_line_id);
    END IF;
    IF NEW.so_id IS NOT NULL THEN
      PERFORM public.force_so_status_if_fully_shipped(NEW.so_id);
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.so_line_id IS NOT NULL THEN
      PERFORM public.recompute_so_line_shipped(OLD.so_line_id);
    END IF;
    IF OLD.so_id IS NOT NULL THEN
      PERFORM public.force_so_status_if_fully_shipped(OLD.so_id);
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;$$;


ALTER FUNCTION "public"."tg_sales_shipments_sync"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_set_company_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.company_id is null then
    new.company_id := public.current_company_id();
  end if;
  return new;
end$$;


ALTER FUNCTION "public"."tg_set_company_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;


ALTER FUNCTION "public"."tg_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_so_awaiting_notify"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  was_awaiting boolean := FALSE;
  now_awaiting boolean := FALSE;
  bal numeric;
  title text;
  body  text;
  url   text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    now_awaiting := public.so_is_awaiting_now(NEW);
  ELSE
    was_awaiting := public.so_is_awaiting_now(OLD);
    now_awaiting := public.so_is_awaiting_now(NEW);
  END IF;

  IF now_awaiting AND NOT was_awaiting THEN
    bal := public.so_balance_due_base(NEW);
    title := 'Awaiting approval: Sales Order';
    body  := format('SO %s • Due %s',
                    COALESCE(NEW.order_no, left(NEW.id::text,8)),
                    COALESCE(bal,0));
    url   := '/cash/approvals';  -- or '/sales-orders/'||NEW.id
    PERFORM public.emit_cash_approval_notif(NEW.company_id, title, body, url, 'warning');
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."tg_so_awaiting_notify"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_sol_status_on_edit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM public.so_maybe_mark_shipped(NEW.so_id);
  RETURN NEW;
END;$$;


ALTER FUNCTION "public"."tg_sol_status_on_edit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_solines_status_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    IF NEW.so_id IS NOT NULL THEN
      PERFORM public.force_so_status_if_fully_shipped(NEW.so_id);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;$$;


ALTER FUNCTION "public"."tg_solines_status_sync"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_stock_levels_company_fill"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
begin
  if new.company_id is null then
    select i.company_id into new.company_id from public.items i where i.id = new.item_id;
  end if;
  if new.company_id is null and new.warehouse_id is not null then
    select w.company_id into new.company_id from public.warehouses w where w.id = new.warehouse_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."tg_stock_levels_company_fill"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_stock_movements_company_fill"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
declare
  cid uuid;
begin
  if new.company_id is null then
    select i.company_id into cid from public.items i where i.id = new.item_id;
    if cid is null and new.warehouse_to_id is not null then
      select w.company_id into cid from public.warehouses w where w.id = new.warehouse_to_id;
    end if;
    if cid is null and new.warehouse_from_id is not null then
      select w.company_id into cid from public.warehouses w where w.id = new.warehouse_from_id;
    end if;
    new.company_id := cid;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."tg_stock_movements_company_fill"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_purchase_order_settlement_anchor"("p_vendor_bill_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_bill record;
begin
  select
    vb.id,
    vb.company_id,
    vb.purchase_order_id,
    vb.document_workflow_status
  into v_bill
  from public.vendor_bills vb
  where vb.id = p_vendor_bill_id;

  if v_bill.id is null
     or v_bill.purchase_order_id is null
     or v_bill.document_workflow_status <> 'posted' then
    return;
  end if;

  update public.cash_transactions ct
     set ref_type = 'VB',
         ref_id = v_bill.id
   where ct.company_id = v_bill.company_id
     and ct.type = 'purchase_payment'
     and ct.ref_type = 'PO'
     and ct.ref_id = v_bill.purchase_order_id;

  update public.bank_transactions bt
     set ref_type = 'VB',
         ref_id = v_bill.id
   where bt.ref_type = 'PO'
     and bt.ref_id = v_bill.purchase_order_id;
end;
$$;


ALTER FUNCTION "public"."transfer_purchase_order_settlement_anchor"("p_vendor_bill_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."transfer_purchase_order_settlement_anchor"("p_vendor_bill_id" "uuid") IS 'Reassigns legacy PO-linked cash and bank settlements onto the posted vendor bill so the bill becomes the canonical settlement anchor.';



CREATE OR REPLACE FUNCTION "public"."transfer_sales_order_settlement_anchor"("p_invoice_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_invoice record;
begin
  select
    si.id,
    si.company_id,
    si.sales_order_id,
    si.document_workflow_status
  into v_invoice
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_invoice.id is null
     or v_invoice.sales_order_id is null
     or v_invoice.document_workflow_status <> 'issued' then
    return;
  end if;

  update public.cash_transactions ct
     set ref_type = 'SI',
         ref_id = v_invoice.id
   where ct.company_id = v_invoice.company_id
     and ct.type = 'sale_receipt'
     and ct.ref_type = 'SO'
     and ct.ref_id = v_invoice.sales_order_id;

  update public.bank_transactions bt
     set ref_type = 'SI',
         ref_id = v_invoice.id
   where bt.ref_type = 'SO'
     and bt.ref_id = v_invoice.sales_order_id;
end;
$$;


ALTER FUNCTION "public"."transfer_sales_order_settlement_anchor"("p_invoice_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."transfer_sales_order_settlement_anchor"("p_invoice_id" "uuid") IS 'Reassigns legacy SO-linked cash and bank settlements onto the issued sales invoice so the invoice becomes the canonical settlement anchor.';



CREATE OR REPLACE FUNCTION "public"."trg_pol_calc_total"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
begin
  new.discount_pct := coalesce(new.discount_pct, 0);
  new.line_total   := coalesce(new.qty,0) * coalesce(new.unit_price,0) * (1 - new.discount_pct/100.0);
  return new;
end$$;


ALTER FUNCTION "public"."trg_pol_calc_total"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_sales_orders_set_due_date"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := public.compute_due_date(NEW.order_date, NEW.payment_terms_id);
  END IF;
  RETURN NEW;
END$$;


ALTER FUNCTION "public"."trg_sales_orders_set_due_date"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_sales_shipments_sync_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.so_id IS NOT NULL THEN
    PERFORM public.so_sync_status_after_lines(NEW.so_id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_sales_shipments_sync_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_so_lines_sync_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM public.so_sync_status_after_lines(NEW.so_id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_so_lines_sync_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_sol_calc_total"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
begin
  new.discount_pct := coalesce(new.discount_pct, 0);
  new.line_total   := coalesce(new.qty,0) * coalesce(new.unit_price,0) * (1 - new.discount_pct/100.0);
  return new;
end$$;


ALTER FUNCTION "public"."trg_sol_calc_total"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_stock_movements_apply"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.type = 'receive' THEN
      PERFORM apply_stock_delta(NEW.warehouse_to_id,   NEW.bin_to_id,   NEW.item_id, +NEW.qty_base, NEW.unit_cost);
    ELSIF NEW.type = 'issue' THEN
      PERFORM apply_stock_delta(NEW.warehouse_from_id, NEW.bin_from_id, NEW.item_id, -NEW.qty_base, NEW.unit_cost);
    ELSIF NEW.type = 'transfer' THEN
      PERFORM apply_stock_delta(NEW.warehouse_from_id, NEW.bin_from_id, NEW.item_id, -NEW.qty_base, NEW.unit_cost);
      PERFORM apply_stock_delta(NEW.warehouse_to_id,   NEW.bin_to_id,   NEW.item_id, +NEW.qty_base, NEW.unit_cost);
    ELSIF NEW.type = 'adjust' THEN
      -- adjust uses delta (+/-) in the destination bin
      PERFORM apply_stock_delta(NEW.warehouse_to_id,   NEW.bin_to_id,   NEW.item_id,  NEW.qty_base, NEW.unit_cost);
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- reverse OLD
    IF OLD.type = 'receive' THEN
      PERFORM apply_stock_delta(OLD.warehouse_to_id,   OLD.bin_to_id,   OLD.item_id, -OLD.qty_base, OLD.unit_cost);
    ELSIF OLD.type = 'issue' THEN
      PERFORM apply_stock_delta(OLD.warehouse_from_id, OLD.bin_from_id, OLD.item_id, +OLD.qty_base, OLD.unit_cost);
    ELSIF OLD.type = 'transfer' THEN
      PERFORM apply_stock_delta(OLD.warehouse_from_id, OLD.bin_from_id, OLD.item_id, +OLD.qty_base, OLD.unit_cost);
      PERFORM apply_stock_delta(OLD.warehouse_to_id,   OLD.bin_to_id,   OLD.item_id, -OLD.qty_base, OLD.unit_cost);
    ELSIF OLD.type = 'adjust' THEN
      PERFORM apply_stock_delta(OLD.warehouse_to_id,   OLD.bin_to_id,   OLD.item_id, -OLD.qty_base, OLD.unit_cost);
    END IF;

    -- apply NEW
    IF NEW.type = 'receive' THEN
      PERFORM apply_stock_delta(NEW.warehouse_to_id,   NEW.bin_to_id,   NEW.item_id, +NEW.qty_base, NEW.unit_cost);
    ELSIF NEW.type = 'issue' THEN
      PERFORM apply_stock_delta(NEW.warehouse_from_id, NEW.bin_from_id, NEW.item_id, -NEW.qty_base, NEW.unit_cost);
    ELSIF NEW.type = 'transfer' THEN
      PERFORM apply_stock_delta(NEW.warehouse_from_id, NEW.bin_from_id, NEW.item_id, -NEW.qty_base, NEW.unit_cost);
      PERFORM apply_stock_delta(NEW.warehouse_to_id,   NEW.bin_to_id,   NEW.item_id, +NEW.qty_base, NEW.unit_cost);
    ELSIF NEW.type = 'adjust' THEN
      PERFORM apply_stock_delta(NEW.warehouse_to_id,   NEW.bin_to_id,   NEW.item_id,  NEW.qty_base, NEW.unit_cost);
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.type = 'receive' THEN
      PERFORM apply_stock_delta(OLD.warehouse_to_id,   OLD.bin_to_id,   OLD.item_id, -OLD.qty_base, OLD.unit_cost);
    ELSIF OLD.type = 'issue' THEN
      PERFORM apply_stock_delta(OLD.warehouse_from_id, OLD.bin_from_id, OLD.item_id, +OLD.qty_base, OLD.unit_cost);
    ELSIF OLD.type = 'transfer' THEN
      PERFORM apply_stock_delta(OLD.warehouse_from_id, OLD.bin_from_id, OLD.item_id, +OLD.qty_base, OLD.unit_cost);
      PERFORM apply_stock_delta(OLD.warehouse_to_id,   OLD.bin_to_id,   OLD.item_id, -OLD.qty_base, OLD.unit_cost);
    ELSIF OLD.type = 'adjust' THEN
      PERFORM apply_stock_delta(OLD.warehouse_to_id,   OLD.bin_to_id,   OLD.item_id, -OLD.qty_base, OLD.unit_cost);
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_stock_movements_apply"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_set_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;


ALTER FUNCTION "public"."trigger_set_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_uuid"("p_value" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;

  RETURN p_value::uuid;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."try_uuid"("p_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_company_settings"("p_company_id" "uuid", "p_patch" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  v_current jsonb;
  v_merged jsonb;
  v_defaults jsonb := public.company_settings_defaults();
begin
  if not public.finance_documents_is_system_context() then
    if auth.uid() is null
       or p_company_id is distinct from public.current_company_id()
       or not public.has_company_role(p_company_id, array['OWNER','ADMIN','MANAGER']::public.member_role[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    if coalesce(p_patch ? 'dueReminders', false)
       and not public.finance_documents_can_manage_due_reminders(p_company_id) then
      raise exception 'due_reminder_settings_access_denied' using errcode = '42501';
    end if;
  end if;

  select data into v_current
  from public.company_settings
  where company_id = p_company_id
  for update;

  v_merged := public.jsonb_deep_merge(v_defaults, public.jsonb_deep_merge(coalesce(v_current, '{}'::jsonb), coalesce(p_patch, '{}'::jsonb)));
  v_merged := jsonb_set(v_merged, '{notifications,recipients,emails}', coalesce((v_merged #> '{notifications,recipients,emails}'), '[]'::jsonb), true);
  v_merged := jsonb_set(v_merged, '{notifications,recipients,phones}', coalesce((v_merged #> '{notifications,recipients,phones}'), '[]'::jsonb), true);
  v_merged := jsonb_set(v_merged, '{notifications,recipients,whatsapp}', coalesce((v_merged #> '{notifications,recipients,whatsapp}'), '[]'::jsonb), true);

  if (v_merged #>> '{notifications,dailyDigestTime}') is null then
    v_merged := jsonb_set(v_merged, '{notifications,dailyDigestTime}', to_jsonb('08:00'), true);
  end if;
  if (v_merged #>> '{notifications,timezone}') is null then
    v_merged := jsonb_set(v_merged, '{notifications,timezone}', to_jsonb('Africa/Maputo'), true);
  end if;

  insert into public.company_settings(company_id, data, updated_at)
  values (p_company_id, v_merged, now())
  on conflict (company_id) do update
    set data = excluded.data, updated_at = now()
  returning data into v_merged;

  return v_merged;
end
$$;


ALTER FUNCTION "public"."update_company_settings"("p_company_id" "uuid", "p_patch" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_moving_average"("p_company_id" "uuid", "p_item_id" "text", "p_recv_qty" numeric, "p_unit_cost" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_new_avg numeric;
begin
  if p_recv_qty <= 0 then
    raise exception 'Received qty must be > 0';
  end if;

  select qty_on_hand, avg_cost
    into v_old_qty, v_old_avg
  from item_moving_average
  where company_id = p_company_id and item_id = p_item_id
  for update;

  if not found then
    insert into item_moving_average(company_id, item_id, avg_cost, qty_on_hand)
    values (p_company_id, p_item_id, p_unit_cost, p_recv_qty)
    on conflict (company_id, item_id) do update
      set avg_cost    = excluded.avg_cost,
          qty_on_hand = excluded.qty_on_hand;
    return;
  end if;

  v_new_qty := v_old_qty + p_recv_qty;
  v_new_avg := ((v_old_qty * v_old_avg) + (p_recv_qty * p_unit_cost)) / nullif(v_new_qty, 0);

  update item_moving_average
  set avg_cost    = coalesce(v_new_avg, p_unit_cost),
      qty_on_hand = v_new_qty
  where company_id = p_company_id and item_id = p_item_id;
end;
$$;


ALTER FUNCTION "public"."update_moving_average"("p_company_id" "uuid", "p_item_id" "text", "p_recv_qty" numeric, "p_unit_cost" numeric) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_books" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "beginning_balance_base" numeric DEFAULT 0 NOT NULL,
    "beginning_as_of" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cash_books" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_cash_book"("p_company" "uuid", "p_amount" numeric, "p_as_of" "date") RETURNS "public"."cash_books"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  rec public.cash_books;
begin
  insert into public.cash_books (company_id, beginning_balance_base, beginning_as_of)
  values (p_company, p_amount, p_as_of)
  on conflict (company_id) do update
    set beginning_balance_base = excluded.beginning_balance_base,
        beginning_as_of        = excluded.beginning_as_of
  returning * into rec;

  return rec;
end;
$$;


ALTER FUNCTION "public"."upsert_cash_book"("p_company" "uuid", "p_amount" numeric, "p_as_of" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_whatsapp_credentials"("p_company_id" "uuid", "p_phone_number_id" "text", "p_access_token" "text", "p_waba_id" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  uid uuid := auth.uid();
  role text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Require OWNER or ADMIN in company_members
  SELECT cm.role INTO role
  FROM public.company_members cm
  WHERE cm.company_id = p_company_id AND cm.user_id = uid AND cm.status = 'active'
  LIMIT 1;

  IF role IS NULL OR role NOT IN ('OWNER','ADMIN') THEN
    RAISE EXCEPTION 'permission denied: admin required';
  END IF;

  INSERT INTO public.whatsapp_credentials(company_id, phone_number_id, access_token, waba_id)
  VALUES (p_company_id, p_phone_number_id, p_access_token, p_waba_id)
  ON CONFLICT (company_id) DO UPDATE
    SET phone_number_id = EXCLUDED.phone_number_id,
        access_token = EXCLUDED.access_token,
        waba_id = EXCLUDED.waba_id,
        updated_at = now();
END;
$$;


ALTER FUNCTION "public"."upsert_whatsapp_credentials"("p_company_id" "uuid", "p_phone_number_id" "text", "p_access_token" "text", "p_waba_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_bill_assign_reference"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'vendor_bill_internal_reference_immutable';
  end if;

  if new.internal_reference is null or btrim(new.internal_reference) = '' then
    new.internal_reference := public.next_finance_document_reference(new.company_id, 'vendor_bill');
  end if;

  if new.document_workflow_status = 'posted' then
    if new.due_date is null then
      raise exception 'vendor_bill_due_date_required_for_post';
    end if;
    if new.posted_at is null then
      new.posted_at := now();
    end if;
    if new.posted_by is null then
      new.posted_by := auth.uid();
    end if;
  end if;

  if new.document_workflow_status = 'voided' then
    if new.voided_at is null then
      new.voided_at := now();
    end if;
    if new.voided_by is null then
      new.voided_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_bill_assign_reference"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_bill_hardening_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_company_id uuid;
begin
  if tg_op = 'INSERT' then
    v_company_id := new.company_id;
  elsif tg_op = 'UPDATE' then
    v_company_id := coalesce(new.company_id, old.company_id);
  else
    v_company_id := old.company_id;
  end if;

  if tg_op = 'INSERT' then
    if not public.finance_documents_can_prepare_draft(v_company_id) then
      raise exception using
        message = 'Vendor bill draft creation access denied.';
    end if;

    new.document_workflow_status := coalesce(new.document_workflow_status, 'draft');
    new.approval_status := coalesce(nullif(btrim(coalesce(new.approval_status, '')), ''), 'draft');

    if new.document_workflow_status <> 'draft' then
      raise exception using
        message = 'Vendor bills must start in draft status.';
    end if;

    if new.approval_status <> 'draft' then
      raise exception using
        message = 'Vendor bills must start with draft approval status.';
    end if;

    new.posted_at := null;
    new.posted_by := null;
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
    new.approval_requested_at := null;
    new.approval_requested_by := null;
    new.approved_at := null;
    new.approved_by := null;
    return new;
  end if;

  new.approval_status := coalesce(nullif(btrim(coalesce(new.approval_status, '')), ''), old.approval_status, 'draft');

  if new.document_workflow_status is distinct from old.document_workflow_status
     and new.approval_status is distinct from old.approval_status then
    raise exception using
      message = 'Vendor bill approval and legal workflow transitions must be performed separately.';
  end if;

  if new.approval_status is distinct from old.approval_status then
    if old.document_workflow_status <> 'draft' then
      raise exception using
        message = 'Vendor bill approval state cannot change once the document is posted or voided.';
    end if;

    case old.approval_status
      when 'draft' then
        if new.approval_status <> 'pending_approval' then
          raise exception using
            message = 'Vendor bills can only move from draft to pending approval.';
        end if;
        if not public.finance_documents_can_submit_for_approval(v_company_id) then
          raise exception using
            message = 'Vendor bill approval request access denied.';
        end if;
        new.approval_requested_at := coalesce(new.approval_requested_at, now());
        new.approval_requested_by := coalesce(new.approval_requested_by, auth.uid());
        new.approved_at := null;
        new.approved_by := null;
      when 'pending_approval' then
        if new.approval_status = 'approved' then
          if not public.finance_documents_can_approve(v_company_id) then
            raise exception using
              message = 'Vendor bill approval access denied.';
          end if;
          new.approval_requested_at := coalesce(old.approval_requested_at, new.approval_requested_at, now());
          new.approval_requested_by := coalesce(old.approval_requested_by, new.approval_requested_by, auth.uid());
          new.approved_at := coalesce(new.approved_at, now());
          new.approved_by := coalesce(new.approved_by, auth.uid());
        elsif new.approval_status = 'draft' then
          if not public.finance_documents_can_approve(v_company_id) then
            raise exception using
              message = 'Vendor bill approval reset access denied.';
          end if;
          new.approval_requested_at := null;
          new.approval_requested_by := null;
          new.approved_at := null;
          new.approved_by := null;
        else
          raise exception using
            message = 'Vendor bills can only move from pending approval to approved or back to draft.';
        end if;
      when 'approved' then
        if new.approval_status <> 'draft' then
          raise exception using
            message = 'Approved vendor bills can only be returned to draft before posting.';
        end if;
        if not public.finance_documents_can_approve(v_company_id) then
          raise exception using
            message = 'Vendor bill approval reset access denied.';
        end if;
        new.approval_requested_at := null;
        new.approval_requested_by := null;
        new.approved_at := null;
        new.approved_by := null;
      else
        raise exception using
          message = format('Vendor bill approval state %s is not recognized.', old.approval_status);
    end case;

    if new.document_workflow_status = old.document_workflow_status
       and (to_jsonb(new) - array['updated_at', 'supplier_invoice_reference_normalized', 'approval_status', 'approval_requested_at', 'approval_requested_by', 'approved_at', 'approved_by'])
         is distinct from
           (to_jsonb(old) - array['updated_at', 'supplier_invoice_reference_normalized', 'approval_status', 'approval_requested_at', 'approval_requested_by', 'approved_at', 'approved_by']) then
      raise exception using
        message = 'Vendor bill approval transitions cannot edit draft content. Save draft changes before approval routing.';
    end if;
  elsif old.document_workflow_status = 'draft' then
    if old.approval_status = 'draft' then
      if new.document_workflow_status = old.document_workflow_status
         and not public.finance_documents_can_prepare_draft(v_company_id) then
        raise exception using
          message = 'Vendor bill draft edit access denied.';
      end if;
    elsif new.document_workflow_status = old.document_workflow_status
       and (to_jsonb(new) - array['updated_at', 'supplier_invoice_reference_normalized'])
         is distinct from
           (to_jsonb(old) - array['updated_at', 'supplier_invoice_reference_normalized']) then
      raise exception using
        message = 'Vendor bills are locked once they are pending approval or approved. Return the document to draft before editing it.';
    end if;
  elsif old.document_workflow_status = 'posted'
     and new.document_workflow_status = old.document_workflow_status
     and (to_jsonb(new) - array['updated_at', 'supplier_invoice_reference_normalized'])
       is distinct from
         (to_jsonb(old) - array['updated_at', 'supplier_invoice_reference_normalized']) then
    raise exception using
      message = 'Posted vendor bills are immutable.';
  elsif old.document_workflow_status = 'voided'
     and (to_jsonb(new) - array['updated_at', 'supplier_invoice_reference_normalized'])
       is distinct from
         (to_jsonb(old) - array['updated_at', 'supplier_invoice_reference_normalized']) then
    raise exception using
      message = 'Voided vendor bills are immutable.';
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status = 'posted' then
          if old.approval_status <> 'approved' then
            raise exception using
              message = 'Vendor bills must be approved before posting.';
          end if;
          if not public.finance_documents_can_issue_legal(v_company_id) then
            raise exception using
              message = 'Vendor bill post access denied.';
          end if;
        elsif new.document_workflow_status = 'voided' then
          if not public.finance_documents_can_void(v_company_id) then
            raise exception using
              message = 'Vendor bill void access denied.';
          end if;
        else
          raise exception using
            message = format(
              'Vendor bill status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'posted' then
        if new.document_workflow_status <> 'voided' then
          raise exception using
            message = format(
              'Vendor bill status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
        if not public.finance_documents_can_void(v_company_id) then
          raise exception using
            message = 'Vendor bill void access denied.';
        end if;
        if (to_jsonb(new) - array['updated_at', 'supplier_invoice_reference_normalized', 'document_workflow_status', 'voided_at', 'voided_by', 'void_reason'])
             is distinct from
           (to_jsonb(old) - array['updated_at', 'supplier_invoice_reference_normalized', 'document_workflow_status', 'voided_at', 'voided_by', 'void_reason']) then
          raise exception using
            message = 'Posted vendor bills can only change workflow and void metadata during a void transition.';
        end if;
      when 'voided' then
        raise exception using
          message = format(
            'Vendor bill status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      else
        raise exception using
          message = format(
            'Vendor bill status transition %s -> %s is not recognized.',
            old.document_workflow_status,
            new.document_workflow_status
          );
    end case;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_bill_hardening_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."vendor_bill_hardening_guard"() IS 'Hardens vendor bill workflow transitions and core-field immutability after posting or void.';



CREATE OR REPLACE FUNCTION "public"."vendor_bill_line_hardening_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  if new.qty = 0 and (new.line_total <> 0 or new.tax_amount <> 0) then
    raise exception using
      message = 'Vendor bill lines with zero quantity must also have zero tax and zero line total.';
  end if;

  if new.line_total = 0 and new.qty > 0 and new.unit_cost > 0 then
    raise exception using
      message = 'Vendor bill lines with quantity and unit cost above zero cannot have a zero line total.';
  end if;

  if new.line_total < new.tax_amount then
    raise exception using
      message = 'Vendor bill line tax cannot exceed the stored line total.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_bill_line_hardening_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."vendor_bill_line_hardening_guard"() IS 'Applies minimal vendor bill line consistency checks without enforcing exact cost arithmetic.';



CREATE OR REPLACE FUNCTION "public"."vendor_bill_lines_parent_post_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_bill_id uuid;
  v_status text;
begin
  if public.finance_documents_internal_transition_bypass() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_bill_id := case when tg_op = 'DELETE' then old.vendor_bill_id else new.vendor_bill_id end;

  select vb.document_workflow_status
    into v_status
  from public.vendor_bills vb
  where vb.id = v_bill_id;

  if coalesce(v_status, '') in ('posted', 'voided') then
    raise exception using
      message = 'vendor_bill_lines_parent_locked';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


ALTER FUNCTION "public"."vendor_bill_lines_parent_post_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."vendor_bill_lines_parent_post_guard"() IS 'Prevents insert, update, or delete on vendor bill lines after the parent vendor bill is posted or voided.';



CREATE OR REPLACE FUNCTION "public"."vendor_bill_transfer_settlement_anchor"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  if new.document_workflow_status = 'posted'
     and coalesce(old.document_workflow_status, '') <> 'posted' then
    perform public.transfer_purchase_order_settlement_anchor(new.id);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_bill_transfer_settlement_anchor"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."vendor_bill_transfer_settlement_anchor"() IS 'After a vendor bill is posted, transfers any order-linked settlement records onto the vendor bill anchor.';



CREATE OR REPLACE FUNCTION "public"."vendor_credit_note_assign_reference"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'vendor_credit_note_internal_reference_immutable';
  end if;

  if new.internal_reference is null or btrim(new.internal_reference) = '' then
    new.internal_reference := public.next_finance_document_reference(new.company_id, 'vendor_credit_note');
  end if;

  if new.document_workflow_status = 'posted' then
    if new.posted_at is null then
      new.posted_at := now();
    end if;
    if new.posted_by is null then
      new.posted_by := auth.uid();
    end if;
  end if;

  if new.document_workflow_status = 'voided' then
    if new.voided_at is null then
      new.voided_at := now();
    end if;
    if new.voided_by is null then
      new.voided_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_credit_note_assign_reference"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_credit_note_hardening_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_company_id uuid;
begin
  if tg_op = 'INSERT' then
    v_company_id := new.company_id;
  elsif tg_op = 'UPDATE' then
    v_company_id := coalesce(new.company_id, old.company_id);
  else
    v_company_id := old.company_id;
  end if;

  if not public.finance_documents_can_post_adjustment(v_company_id) then
    raise exception using
      message = 'Supplier credit note access denied.';
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.document_workflow_status, 'draft') <> 'draft' then
      raise exception using
        message = 'Supplier credit notes must start in draft status.';
    end if;
    return new;
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status not in ('posted', 'voided') then
          raise exception using
            message = format(
              'Supplier credit note status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'posted' then
        if new.document_workflow_status <> 'voided' then
          raise exception using
            message = format(
              'Supplier credit note status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'voided' then
        raise exception using
          message = format(
            'Supplier credit note status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      else
        raise exception using
          message = format(
            'Supplier credit note status transition %s -> %s is not recognized.',
            old.document_workflow_status,
            new.document_workflow_status
          );
    end case;
  end if;

  if tg_op = 'UPDATE'
     and old.document_workflow_status in ('posted', 'voided')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception using
      message = 'Posted or voided supplier credit notes are immutable.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_credit_note_hardening_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_credit_note_validate_post"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_bill public.vendor_bills%rowtype;
  v_rollup record;
  v_over_credit boolean;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'posted'
     or coalesce(old.document_workflow_status, 'draft') = 'posted' then
    return new;
  end if;

  select vb.*
    into v_bill
  from public.vendor_bills vb
  where vb.id = new.original_vendor_bill_id;

  if v_bill.id is null then
    raise exception using
      message = 'Vendor credit notes require an original vendor bill.';
  end if;

  if v_bill.document_workflow_status <> 'posted' then
    raise exception using
      message = 'Supplier credit notes can only be posted against a posted vendor bill.';
  end if;

  select
    count(*)::integer as line_count,
    coalesce(sum(coalesce(vcnl.line_total, 0)), 0)::numeric as subtotal,
    coalesce(sum(coalesce(vcnl.tax_amount, 0)), 0)::numeric as tax_total,
    coalesce(sum(coalesce(vcnl.line_total, 0) + coalesce(vcnl.tax_amount, 0)), 0)::numeric as total_amount
    into v_rollup
  from public.vendor_credit_note_lines vcnl
  where vcnl.vendor_credit_note_id = new.id;

  if coalesce(v_rollup.line_count, 0) <= 0 then
    raise exception using
      message = 'Supplier credit notes require at least one line before posting.';
  end if;

  select exists (
    with existing_credit_rollup as (
      select
        vcnl_existing.vendor_bill_line_id,
        coalesce(sum(coalesce(vcnl_existing.qty, 0)), 0)::numeric as credited_qty,
        coalesce(sum(coalesce(vcnl_existing.line_total, 0)), 0)::numeric as credited_line_total,
        coalesce(sum(coalesce(vcnl_existing.tax_amount, 0)), 0)::numeric as credited_tax_amount
      from public.vendor_credit_note_lines vcnl_existing
      join public.vendor_credit_notes vcn_existing
        on vcn_existing.id = vcnl_existing.vendor_credit_note_id
      where vcn_existing.original_vendor_bill_id = new.original_vendor_bill_id
        and vcn_existing.document_workflow_status = 'posted'
        and vcn_existing.id <> new.id
        and vcnl_existing.vendor_bill_line_id is not null
      group by vcnl_existing.vendor_bill_line_id
    )
    select 1
    from public.vendor_credit_note_lines vcnl_current
    join public.vendor_bill_lines vbl
      on vbl.id = vcnl_current.vendor_bill_line_id
    left join existing_credit_rollup ecr
      on ecr.vendor_bill_line_id = vcnl_current.vendor_bill_line_id
    where vcnl_current.vendor_credit_note_id = new.id
      and (
        coalesce(vcnl_current.qty, 0) > greatest(coalesce(vbl.qty, 0) - coalesce(ecr.credited_qty, 0), 0) + 0.0001
        or coalesce(vcnl_current.line_total, 0) > greatest(coalesce(vbl.line_total, 0) - coalesce(ecr.credited_line_total, 0), 0) + 0.005
        or coalesce(vcnl_current.tax_amount, 0) > greatest(coalesce(vbl.tax_amount, 0) - coalesce(ecr.credited_tax_amount, 0), 0) + 0.005
      )
  ) into v_over_credit;

  if coalesce(v_over_credit, false) then
    raise exception using
      message = 'Supplier credit note lines exceed the remaining quantity, taxable value, or tax still available on the original vendor bill.';
  end if;

  new.supplier_id := coalesce(new.supplier_id, v_bill.supplier_id);
  new.currency_code := coalesce(new.currency_code, v_bill.currency_code);
  new.fx_to_base := coalesce(new.fx_to_base, v_bill.fx_to_base, 1);
  new.subtotal := round(coalesce(v_rollup.subtotal, 0), 2);
  new.tax_total := round(coalesce(v_rollup.tax_total, 0), 2);
  new.total_amount := round(coalesce(v_rollup.total_amount, 0), 2);
  new.subtotal_base := round(new.subtotal * coalesce(new.fx_to_base, 1), 2);
  new.tax_total_base := round(new.tax_total * coalesce(new.fx_to_base, 1), 2);
  new.total_amount_base := round(new.total_amount * coalesce(new.fx_to_base, 1), 2);

  if coalesce(new.total_amount, 0) <= 0 then
    raise exception using
      message = 'Supplier credit notes require a positive total before posting.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_credit_note_validate_post"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_debit_note_assign_reference"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'vendor_debit_note_internal_reference_immutable';
  end if;

  if new.internal_reference is null or btrim(new.internal_reference) = '' then
    new.internal_reference := public.next_finance_document_reference(new.company_id, 'vendor_debit_note');
  end if;

  if new.document_workflow_status = 'posted' then
    if new.posted_at is null then
      new.posted_at := now();
    end if;
    if new.posted_by is null then
      new.posted_by := auth.uid();
    end if;
  end if;

  if new.document_workflow_status = 'voided' then
    if new.voided_at is null then
      new.voided_at := now();
    end if;
    if new.voided_by is null then
      new.voided_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_debit_note_assign_reference"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_debit_note_hardening_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_company_id uuid;
begin
  if tg_op = 'INSERT' then
    v_company_id := new.company_id;
  elsif tg_op = 'UPDATE' then
    v_company_id := coalesce(new.company_id, old.company_id);
  else
    v_company_id := old.company_id;
  end if;

  if not public.finance_documents_can_post_adjustment(v_company_id) then
    raise exception using
      message = 'Supplier debit note access denied.';
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.document_workflow_status, 'draft') <> 'draft' then
      raise exception using
        message = 'Supplier debit notes must start in draft status.';
    end if;
    return new;
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status not in ('posted', 'voided') then
          raise exception using
            message = format(
              'Supplier debit note status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'posted' then
        if new.document_workflow_status <> 'voided' then
          raise exception using
            message = format(
              'Supplier debit note status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'voided' then
        raise exception using
          message = format(
            'Supplier debit note status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      else
        raise exception using
          message = format(
            'Supplier debit note status transition %s -> %s is not recognized.',
            old.document_workflow_status,
            new.document_workflow_status
          );
    end case;
  end if;

  if tg_op = 'UPDATE'
     and old.document_workflow_status in ('posted', 'voided')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception using
      message = 'Posted or voided supplier debit notes are immutable.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_debit_note_hardening_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_debit_note_validate_post"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_bill public.vendor_bills%rowtype;
  v_rollup record;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'posted'
     or coalesce(old.document_workflow_status, 'draft') = 'posted' then
    return new;
  end if;

  select vb.*
    into v_bill
  from public.vendor_bills vb
  where vb.id = new.original_vendor_bill_id;

  if v_bill.id is null then
    raise exception using
      message = 'Vendor debit notes require an original vendor bill.';
  end if;

  if v_bill.document_workflow_status <> 'posted' then
    raise exception using
      message = 'Supplier debit notes can only be posted against a posted vendor bill.';
  end if;

  select
    count(*)::integer as line_count,
    coalesce(sum(coalesce(vdnl.line_total, 0)), 0)::numeric as subtotal,
    coalesce(sum(coalesce(vdnl.tax_amount, 0)), 0)::numeric as tax_total,
    coalesce(sum(coalesce(vdnl.line_total, 0) + coalesce(vdnl.tax_amount, 0)), 0)::numeric as total_amount
    into v_rollup
  from public.vendor_debit_note_lines vdnl
  where vdnl.vendor_debit_note_id = new.id;

  if coalesce(v_rollup.line_count, 0) <= 0 then
    raise exception using
      message = 'Supplier debit notes require at least one line before posting.';
  end if;

  new.supplier_id := coalesce(new.supplier_id, v_bill.supplier_id);
  new.currency_code := coalesce(new.currency_code, v_bill.currency_code);
  new.fx_to_base := coalesce(new.fx_to_base, v_bill.fx_to_base, 1);
  new.subtotal := round(coalesce(v_rollup.subtotal, 0), 2);
  new.tax_total := round(coalesce(v_rollup.tax_total, 0), 2);
  new.total_amount := round(coalesce(v_rollup.total_amount, 0), 2);
  new.subtotal_base := round(new.subtotal * coalesce(new.fx_to_base, 1), 2);
  new.tax_total_base := round(new.tax_total * coalesce(new.fx_to_base, 1), 2);
  new.total_amount_base := round(new.total_amount * coalesce(new.fx_to_base, 1), 2);

  if coalesce(new.total_amount, 0) <= 0 then
    raise exception using
      message = 'Supplier debit notes require a positive total before posting.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_debit_note_validate_post"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_note_line_company_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_parent_company_id uuid;
  v_original_bill_id uuid;
  v_vendor_bill_id uuid;
begin
  if tg_table_name = 'vendor_credit_note_lines' then
    select vcn.company_id, vcn.original_vendor_bill_id
      into v_parent_company_id, v_original_bill_id
    from public.vendor_credit_notes vcn
    where vcn.id = new.vendor_credit_note_id;
  elsif tg_table_name = 'vendor_debit_note_lines' then
    select vdn.company_id, vdn.original_vendor_bill_id
      into v_parent_company_id, v_original_bill_id
    from public.vendor_debit_notes vdn
    where vdn.id = new.vendor_debit_note_id;
  else
    raise exception using
      message = format('vendor_note_line_company_guard does not support table %s.', tg_table_name);
  end if;

  if v_parent_company_id is null then
    raise exception 'finance_document_parent_not_found';
  end if;

  if new.vendor_bill_line_id is not null then
    select vbl.vendor_bill_id
      into v_vendor_bill_id
    from public.vendor_bill_lines vbl
    where vbl.id = new.vendor_bill_line_id;

    if v_vendor_bill_id is null then
      raise exception using
        message = 'Vendor adjustment lines must reference an existing vendor bill line.';
    end if;

    if v_vendor_bill_id is distinct from v_original_bill_id then
      raise exception using
        message = 'Vendor adjustment lines must reference lines from the original vendor bill.';
    end if;
  end if;

  new.company_id := v_parent_company_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_note_line_company_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_note_line_hardening_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  if coalesce(new.line_total, 0) = 0
     and coalesce(new.qty, 0) > 0
     and coalesce(new.unit_cost, 0) > 0 then
    raise exception using
      message = 'Vendor adjustment lines with quantity and unit cost above zero cannot have a zero line total.';
  end if;

  if coalesce(new.line_total, 0) < coalesce(new.tax_amount, 0) then
    raise exception using
      message = 'Vendor adjustment line tax cannot exceed the stored line total.';
  end if;

  if coalesce(new.qty, 0) = 0
     and coalesce(new.line_total, 0) > 0
     and coalesce(new.unit_cost, 0) <= 0 then
    raise exception using
      message = 'Vendor adjustment lines with a value-only adjustment must keep a positive unit cost.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_note_line_hardening_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_note_lines_parent_status_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_note_id uuid;
  v_status text;
begin
  if public.finance_documents_internal_transition_bypass() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'vendor_credit_note_lines' then
    if tg_op = 'DELETE' then
      v_note_id := old.vendor_credit_note_id;
    else
      v_note_id := new.vendor_credit_note_id;
    end if;

    select vcn.document_workflow_status
      into v_status
    from public.vendor_credit_notes vcn
    where vcn.id = v_note_id;
  elsif tg_table_name = 'vendor_debit_note_lines' then
    if tg_op = 'DELETE' then
      v_note_id := old.vendor_debit_note_id;
    else
      v_note_id := new.vendor_debit_note_id;
    end if;

    select vdn.document_workflow_status
      into v_status
    from public.vendor_debit_notes vdn
    where vdn.id = v_note_id;
  else
    raise exception using
      message = format('vendor_note_lines_parent_status_guard does not support table %s.', tg_table_name);
  end if;

  if v_status in ('posted', 'voided') then
    raise exception using
      message = 'Posted or voided supplier adjustment notes cannot change line items.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."vendor_note_lines_parent_status_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."void_vendor_bill_mz"("p_bill_id" "uuid") RETURNS "public"."vendor_bills"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_row public.vendor_bills%rowtype;
  v_state public.v_vendor_bill_state%rowtype;
begin
  select vb.*
    into v_row
  from public.vendor_bills vb
  where vb.id = p_bill_id;

  if v_row.id is null then
    raise exception using
      message = 'Vendor bill not found.';
  end if;

  if not public.finance_documents_can_void(v_row.company_id) then
    raise exception using
      message = 'Vendor bill void access denied.';
  end if;

  if v_row.document_workflow_status = 'voided' then
    return v_row;
  end if;

  if v_row.document_workflow_status = 'posted' then
    select *
      into v_state
    from public.v_vendor_bill_state
    where id = v_row.id;

    if v_state.id is null then
      raise exception using
        message = 'Vendor bill state view is required before a posted bill can be voided.';
    end if;

    if coalesce(v_state.settled_base, 0) > 0.005 then
      raise exception using
        message = 'Posted vendor bills with settlements cannot be voided.';
    end if;

    if coalesce(v_state.credit_note_count, 0) > 0 or coalesce(v_state.debit_note_count, 0) > 0 then
      raise exception using
        message = 'Posted vendor bills with supplier credit or debit notes cannot be voided.';
    end if;
  elsif v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft or posted vendor bills can be voided.';
  end if;

  update public.vendor_bills vb
     set document_workflow_status = 'voided'
   where vb.id = p_bill_id
  returning vb.* into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."void_vendor_bill_mz"("p_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."warehouses_set_updatedat"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
begin
  new."updatedAt" = now();
  return new;
end$$;


ALTER FUNCTION "public"."warehouses_set_updatedat"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."warehouses_touch_updated"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'public', 'pg_temp'
    AS $$
declare
  is_gen_updatedAt text;
  is_gen_updated_at text;
begin
  select is_generated into is_gen_updatedAt
  from information_schema.columns
  where table_schema='public' and table_name='warehouses' and column_name='updatedAt';

  select is_generated into is_gen_updated_at
  from information_schema.columns
  where table_schema='public' and table_name='warehouses' and column_name='updated_at';

  if coalesce(is_gen_updatedAt, 'NEVER') = 'NEVER' then
    NEW."updatedAt" := now();
  elsif coalesce(is_gen_updated_at, 'NEVER') = 'NEVER' then
    NEW.updated_at := now();
  end if;

  return NEW;
end
$$;


ALTER FUNCTION "public"."warehouses_touch_updated"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_command_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "dry_run" boolean NOT NULL,
    "request" "jsonb" NOT NULL,
    "status" "text" NOT NULL,
    "result" "jsonb",
    "intent" "text",
    CONSTRAINT "ai_command_log_status_check" CHECK (("status" = ANY (ARRAY['accepted'::"text", 'applied'::"text", 'skipped'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."ai_command_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ai_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_ops_allowlist" (
    "id" bigint NOT NULL,
    "verb" "text" NOT NULL,
    "table_pattern" "text" NOT NULL,
    "is_allowed" boolean DEFAULT true NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_ops_allowlist" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ai_ops_allowlist_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ai_ops_allowlist_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ai_ops_allowlist_id_seq" OWNED BY "public"."ai_ops_allowlist"."id";



CREATE OR REPLACE VIEW "public"."ai_ops_commands" AS
 SELECT "l"."id",
    "l"."ts",
    "l"."actor",
    "l"."intent",
    "l"."dry_run",
    "l"."status" AS "envelope_status",
    ("l"."request" ->> 'idempotency_key'::"text") AS "idempotency_key",
    ("pc"."value" ->> 'label'::"text") AS "label",
    ("pc"."value" ->> 'sql'::"text") AS "sql",
    ("pc"."value" ->> 'message'::"text") AS "message",
    COALESCE((("pc"."value" ->> 'ok'::"text"))::boolean, false) AS "ok",
    (("pc"."value" ->> 'index'::"text"))::integer AS "command_index",
    (("pc"."value" ->> 'started_at'::"text"))::timestamp with time zone AS "started_at",
    (("pc"."value" ->> 'ended_at'::"text"))::timestamp with time zone AS "ended_at"
   FROM ("public"."ai_command_log" "l"
     LEFT JOIN LATERAL "jsonb_array_elements"(COALESCE(("l"."result" -> 'per_command'::"text"), '[]'::"jsonb")) "pc"("value") ON (true))
  ORDER BY "l"."ts" DESC, (("pc"."value" ->> 'index'::"text"))::integer;


ALTER VIEW "public"."ai_ops_commands" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ai_ops_commands_with_class" AS
 SELECT "c"."id",
    "c"."ts",
    "c"."actor",
    "c"."intent",
    "c"."dry_run",
    "c"."envelope_status",
    "c"."idempotency_key",
    "c"."label",
    "c"."sql",
    "c"."message",
    "c"."ok",
    "c"."command_index",
    "c"."started_at",
    "c"."ended_at",
    "cls"."verb",
    "cls"."target_table"
   FROM ("public"."ai_ops_commands" "c"
     LEFT JOIN LATERAL "public"."ai_sql_classify"("c"."sql") "cls"("verb", "target_table") ON (true));


ALTER VIEW "public"."ai_ops_commands_with_class" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ai_ops_recent" AS
 SELECT "id",
    "ts",
    "actor",
    "intent",
    "dry_run",
    "status",
    ("request" ->> 'idempotency_key'::"text") AS "idempotency_key",
    "jsonb_array_length"(COALESCE(("result" -> 'per_command'::"text"), '[]'::"jsonb")) AS "command_count"
   FROM "public"."ai_command_log"
  ORDER BY "ts" DESC;


ALTER VIEW "public"."ai_ops_recent" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_probe" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


ALTER TABLE "public"."ai_probe" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_schema_cache" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schema_name" "text" DEFAULT 'public'::"text" NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_schema_cache" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ai_schema_latest" AS
 SELECT ("snapshot" ->> 'schema'::"text") AS "schema_name",
    ("snapshot" ->> 'generated_at'::"text") AS "generated_at",
    "snapshot"
   FROM "public"."ai_schema_cache"
  ORDER BY "ts" DESC
 LIMIT 1;


ALTER VIEW "public"."ai_schema_latest" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_tmp_probe" (
    "id" integer
);


ALTER TABLE "public"."ai_tmp_probe" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_secrets" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL
);


ALTER TABLE "public"."app_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "id" "text" DEFAULT 'app'::"text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "bank_name" "text",
    "account_number" "text",
    "currency_code" "text",
    "tax_number" "text",
    "swift" "text",
    "nib" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bank_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_statements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bank_id" "uuid" NOT NULL,
    "statement_date" "date" NOT NULL,
    "closing_balance_base" numeric NOT NULL,
    "file_path" "text",
    "reconciled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bank_statements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bank_id" "uuid" NOT NULL,
    "happened_at" "date" NOT NULL,
    "memo" "text",
    "amount_base" numeric NOT NULL,
    "reconciled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ref_type" "text",
    "ref_id" "uuid"
);


ALTER TABLE "public"."bank_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bins" (
    "id" "text" NOT NULL,
    "warehouseId" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "createdAt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone GENERATED ALWAYS AS ("createdAt") STORED,
    "company_id" "uuid"
);

ALTER TABLE ONLY "public"."bins" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."bins" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."bins_v" WITH ("security_invoker"='on') AS
 SELECT "id",
    "code",
    "name",
    "warehouseId" AS "warehouse_id"
   FROM "public"."bins" "b";


ALTER VIEW "public"."bins_v" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bom_components" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bom_id" "uuid" NOT NULL,
    "component_item_id" "uuid" NOT NULL,
    "qty_per" numeric NOT NULL,
    "scrap_pct" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bom_components_qty_per_check" CHECK (("qty_per" > (0)::numeric)),
    CONSTRAINT "bom_components_scrap_pct_check" CHECK ((("scrap_pct" >= (0)::numeric) AND ("scrap_pct" <= (1)::numeric)))
);


ALTER TABLE "public"."bom_components" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."boms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" DEFAULT "public"."current_company_id"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "version" "text" DEFAULT 'v1'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assembly_time_per_unit_minutes" numeric,
    "setup_time_per_batch_minutes" numeric,
    CONSTRAINT "boms_assembly_time_per_unit_minutes_check" CHECK ((("assembly_time_per_unit_minutes" IS NULL) OR ("assembly_time_per_unit_minutes" > (0)::numeric))),
    CONSTRAINT "boms_setup_time_per_batch_minutes_check" CHECK ((("setup_time_per_batch_minutes" IS NULL) OR ("setup_time_per_batch_minutes" >= (0)::numeric)))
);


ALTER TABLE "public"."boms" OWNER TO "postgres";


COMMENT ON COLUMN "public"."boms"."assembly_time_per_unit_minutes" IS 'Normalized planning time per finished unit, stored in minutes for lightweight assembly planning.';



COMMENT ON COLUMN "public"."boms"."setup_time_per_batch_minutes" IS 'Optional setup/planning time per build batch, stored in minutes for lightweight assembly planning.';



CREATE TABLE IF NOT EXISTS "public"."builds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" DEFAULT "public"."current_company_id"() NOT NULL,
    "bom_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "qty" numeric NOT NULL,
    "warehouse_from_id" "uuid",
    "bin_from_id" "text",
    "warehouse_to_id" "uuid",
    "bin_to_id" "text",
    "cost_total" numeric DEFAULT 0 NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "builds_qty_check" CHECK (("qty" > (0)::numeric))
);


ALTER TABLE "public"."builds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "happened_at" "date" NOT NULL,
    "type" "text" NOT NULL,
    "ref_type" "text",
    "ref_id" "uuid",
    "memo" "text",
    "amount_base" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_ref" "text",
    CONSTRAINT "cash_transactions_ref_type_check" CHECK (("ref_type" = ANY (ARRAY['SO'::"text", 'PO'::"text", 'SI'::"text", 'VB'::"text", 'ADJ'::"text"]))),
    CONSTRAINT "cash_transactions_type_check" CHECK (("type" = ANY (ARRAY['sale_receipt'::"text", 'purchase_payment'::"text", 'adjustment'::"text"])))
);


ALTER TABLE "public"."cash_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_user_id" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "legal_name" "text",
    "trade_name" "text",
    "tax_id" "text",
    "registration_no" "text",
    "phone" "text",
    "email" "text",
    "website" "text",
    "address_line1" "text",
    "address_line2" "text",
    "city" "text",
    "state" "text",
    "postal_code" "text",
    "country_code" "text",
    "print_footer_note" "text",
    "logo_path" "text",
    "preferred_lang" "text",
    "email_subject_prefix" "text",
    CONSTRAINT "companies_preferred_lang_check" CHECK (("preferred_lang" = ANY (ARRAY['en'::"text", 'pt'::"text"])))
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


COMMENT ON COLUMN "public"."companies"."email_subject_prefix" IS 'Optional short prefix/brand to use in outbound email subjects (e.g., ''Munchythief, Lda''). Falls back to trade_name, legal_name, name.';



CREATE TABLE IF NOT EXISTS "public"."company_access_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "previous_plan_code" "text",
    "next_plan_code" "text",
    "previous_status" "public"."subscription_status",
    "next_status" "public"."subscription_status" NOT NULL,
    "actor_user_id" "uuid",
    "actor_email" "text",
    "reason" "text",
    "context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."company_access_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_control_action_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "actor_user_id" "uuid",
    "actor_email" "text",
    "reason" "text" NOT NULL,
    "context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "company_control_action_log_action_type_check" CHECK (("action_type" = ANY (ARRAY['operational_reset'::"text", 'access_email_expiry_warning_sent'::"text", 'access_email_purge_warning_sent'::"text", 'access_email_activation_confirmation_sent'::"text"])))
);


ALTER TABLE "public"."company_control_action_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_currencies" (
    "company_id" "uuid" DEFAULT "public"."current_company_id"() NOT NULL,
    "currency_code" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."company_currencies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."currencies" (
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "symbol" "text",
    "decimals" smallint DEFAULT 2 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."currencies" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."company_currencies_view" WITH ("security_invoker"='on') AS
 SELECT "c"."code",
    "c"."name",
    "c"."symbol",
    "c"."decimals"
   FROM ("public"."company_currencies" "cc"
     JOIN "public"."currencies" "c" ON (("c"."code" = "cc"."currency_code")))
  WHERE ("cc"."company_id" = "public"."current_company_id"());


ALTER VIEW "public"."company_currencies_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_digest_state" (
    "company_id" "uuid" NOT NULL,
    "last_digest_local_date" "date",
    "last_attempt_at" timestamp with time zone,
    "last_status" "text",
    "last_error" "text"
);


ALTER TABLE "public"."company_digest_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "email" "extensions"."citext" NOT NULL,
    "role" "public"."member_role" NOT NULL,
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '14 days'::interval) NOT NULL,
    "accepted_at" timestamp with time zone
);


ALTER TABLE "public"."company_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_members" (
    "company_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "email" "text" NOT NULL,
    "role" "public"."member_role" DEFAULT 'VIEWER'::"public"."member_role" NOT NULL,
    "status" "public"."member_status" DEFAULT 'active'::"public"."member_status" NOT NULL,
    "invited_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."company_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid",
    "name" "text",
    "default_org_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role" "text" DEFAULT 'staff'::"text" NOT NULL,
    "email" "extensions"."citext",
    "full_name" "text",
    "avatar_url" "text",
    "email_confirmed_at" timestamp with time zone,
    "last_sign_in_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_role_chk" CHECK (("role" = ANY (ARRAY['admin'::"text", 'staff'::"text", 'auditor'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."company_members_with_auth" WITH ("security_invoker"='true') AS
 SELECT "cm"."company_id",
    "cm"."user_id",
    "cm"."role",
    "cm"."status",
    "cm"."invited_by",
    "cm"."created_at",
    COALESCE(("p"."email")::character varying(255), ("cm"."email")::character varying(255)) AS "email",
    "p"."email_confirmed_at",
    "p"."last_sign_in_at"
   FROM ("public"."company_members" "cm"
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "cm"."user_id")));


ALTER VIEW "public"."company_members_with_auth" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_purge_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "scheduled_for" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "target_scope" "jsonb" DEFAULT "jsonb_build_object"('operational_data', true, 'identity_credentials', false) NOT NULL,
    "reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "company_purge_queue_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'processing'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."company_purge_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_settings" (
    "company_id" "uuid" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "base_currency_code" "text"
);


ALTER TABLE "public"."company_settings" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."company_settings_view" WITH ("security_invoker"='on') AS
 SELECT "company_id",
    "base_currency_code"
   FROM "public"."company_settings"
  WHERE ("company_id" = "public"."current_company_id"());


ALTER VIEW "public"."company_settings_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_subscription_state" (
    "company_id" "uuid" NOT NULL,
    "plan_code" "text" NOT NULL,
    "subscription_status" "public"."subscription_status" NOT NULL,
    "trial_started_at" timestamp with time zone,
    "trial_expires_at" timestamp with time zone,
    "paid_until" timestamp with time zone,
    "access_granted_by" "uuid",
    "access_granted_at" timestamp with time zone,
    "grant_reason" "text",
    "access_revoked_by" "uuid",
    "access_revoked_at" timestamp with time zone,
    "revoke_reason" "text",
    "purge_scheduled_at" timestamp with time zone,
    "purge_completed_at" timestamp with time zone,
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "company_subscription_state_check" CHECK ((("subscription_status" <> 'trial'::"public"."subscription_status") OR (("trial_started_at" IS NOT NULL) AND ("trial_expires_at" IS NOT NULL) AND ("trial_expires_at" > "trial_started_at"))))
);


ALTER TABLE "public"."company_subscription_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "tax_id" "text",
    "billing_address" "text",
    "shipping_address" "text",
    "currency_code" "text",
    "payment_terms" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "is_cash" boolean DEFAULT false NOT NULL,
    "whatsapp_msisdn" "text",
    "whatsapp_opt_in_at" timestamp with time zone,
    "whatsapp_opt_in_source" "text",
    "payment_terms_id" "uuid",
    CONSTRAINT "customers_code_check" CHECK ((("char_length"("code") >= 1) AND ("char_length"("code") <= 50))),
    CONSTRAINT "customers_whatsapp_msisdn_ck" CHECK ((("whatsapp_msisdn" IS NULL) OR ("whatsapp_msisdn" ~ '^\+[1-9][0-9]{7,14}$'::"text")))
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sku" "text",
    "name" "text" NOT NULL,
    "uom" "text" DEFAULT 'each'::"text",
    "reorder_point" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "base_uom_id" "text",
    "unit_price" numeric,
    "min_stock" numeric,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "primary_role" "text" DEFAULT 'general'::"text" NOT NULL,
    "track_inventory" boolean DEFAULT true NOT NULL,
    "can_buy" boolean DEFAULT true NOT NULL,
    "can_sell" boolean DEFAULT true NOT NULL,
    "is_assembled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "items_primary_role_check" CHECK (("primary_role" = ANY (ARRAY['general'::"text", 'resale'::"text", 'raw_material'::"text", 'finished_good'::"text", 'assembled_product'::"text", 'service'::"text"])))
);

ALTER TABLE ONLY "public"."items" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "uom_id" "text",
    "qty" numeric,
    "qty_base" numeric,
    "unit_cost" numeric,
    "total_value" numeric,
    "warehouse_from_id" "uuid",
    "warehouse_to_id" "uuid",
    "bin_from_id" "text",
    "bin_to_id" "text",
    "notes" "text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ref_type" "text",
    "ref_id" "text",
    "ref_line_id" "uuid",
    "company_id" "uuid" DEFAULT "public"."current_company_id"(),
    "supplier_id" "uuid",
    "warehouse_id" "uuid",
    CONSTRAINT "stock_movements_type_check" CHECK (("type" = ANY (ARRAY['receive'::"text", 'issue'::"text", 'transfer'::"text", 'adjust'::"text"])))
);

ALTER TABLE ONLY "public"."stock_movements" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_movements" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."customer_movements_view" WITH ("security_invoker"='true') AS
 SELECT "sm"."id",
    "sm"."created_at",
    "c"."id" AS "customer_id",
    "c"."code" AS "customer_code",
    "c"."name" AS "customer_name",
    "sm"."ref_type",
    "so"."order_no" AS "ref_no",
    "sm"."item_id",
    "i"."name" AS "item_name",
    "i"."sku" AS "item_sku",
    "sm"."qty_base",
    "sm"."total_value",
    "sm"."notes",
    "c"."company_id"
   FROM ((("public"."stock_movements" "sm"
     JOIN "public"."sales_orders" "so" ON ((("so"."id" = ("sm"."ref_id")::"uuid") AND ("sm"."ref_type" = 'SO'::"text"))))
     JOIN "public"."customers" "c" ON (("c"."id" = "so"."customer_id")))
     JOIN "public"."items" "i" ON (("i"."id" = "sm"."item_id")));


ALTER VIEW "public"."customer_movements_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."digest_events" (
    "id" bigint NOT NULL,
    "job_id" bigint,
    "company_id" "uuid",
    "event" "text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."digest_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."digest_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."digest_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."digest_events_id_seq" OWNED BY "public"."digest_events"."id";



CREATE TABLE IF NOT EXISTS "public"."digest_queue" (
    "id" bigint NOT NULL,
    "company_id" "uuid" NOT NULL,
    "run_for_local_date" "date" NOT NULL,
    "timezone" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "error" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone,
    "processing_started_at" timestamp with time zone
);


ALTER TABLE "public"."digest_queue" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."digest_queue_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."digest_queue_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."digest_queue_id_seq" OWNED BY "public"."digest_queue"."id";



CREATE TABLE IF NOT EXISTS "public"."document_number_counters" (
    "company_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "next_number" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "document_number_counters_document_type_check" CHECK (("document_type" = ANY (ARRAY['sales_invoice'::"text", 'vendor_bill'::"text", 'vendor_credit_note'::"text", 'vendor_debit_note'::"text"]))),
    CONSTRAINT "document_number_counters_next_number_check" CHECK (("next_number" >= 1))
);


ALTER TABLE "public"."document_number_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."due_reminder_queue" (
    "id" bigint NOT NULL,
    "company_id" "uuid" NOT NULL,
    "run_for_local_date" "date" NOT NULL,
    "timezone" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processing_started_at" timestamp with time zone,
    CONSTRAINT "due_reminder_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'done'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."due_reminder_queue" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."due_reminder_queue_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."due_reminder_queue_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."due_reminder_queue_id_seq" OWNED BY "public"."due_reminder_queue"."id";



CREATE TABLE IF NOT EXISTS "public"."finance_document_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "document_kind" "text" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "from_status" "text",
    "to_status" "text",
    "actor_user_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "finance_document_events_document_kind_check" CHECK (("document_kind" = ANY (ARRAY['sales_invoice'::"text", 'sales_credit_note'::"text", 'sales_debit_note'::"text", 'vendor_bill'::"text", 'vendor_credit_note'::"text", 'vendor_debit_note'::"text", 'saft_moz_export'::"text"])))
);


ALTER TABLE "public"."finance_document_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."finance_document_events" IS 'Append-only audit journal for finance document lifecycle actions relevant to Mozambique compliance.';



CREATE TABLE IF NOT EXISTS "public"."fx_rates" (
    "id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "from_code" "text" NOT NULL,
    "to_code" "text" NOT NULL,
    "rate" numeric(20,6) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fromCode" "text" GENERATED ALWAYS AS ("from_code") STORED,
    "toCode" "text" GENERATED ALWAYS AS ("to_code") STORED,
    "company_id" "uuid" DEFAULT "public"."current_company_id"(),
    CONSTRAINT "fx_rates_rate_check" CHECK (("rate" > (0)::numeric))
);


ALTER TABLE "public"."fx_rates" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."fx_rates_view" WITH ("security_invoker"='on') AS
 SELECT "id",
    "company_id",
    "date",
    "from_code",
    "to_code",
    "rate",
    "from_code" AS "fromCode",
    "to_code" AS "toCode"
   FROM "public"."fx_rates"
  WHERE ("company_id" = "public"."current_company_id"());


ALTER VIEW "public"."fx_rates_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "item_id" "text" NOT NULL,
    "uom_id" "text",
    "warehouse_id" "text",
    "bin_id" "text",
    "qty_signed" numeric NOT NULL,
    "unit_cost" numeric DEFAULT 0 NOT NULL,
    "total_cost" numeric DEFAULT 0 NOT NULL,
    "movement_type" "text" NOT NULL,
    "ref_table" "text",
    "ref_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_movement_type" CHECK (("movement_type" = ANY (ARRAY['PURCHASE_RECEIPT'::"text", 'PRODUCTION_CONSUMPTION'::"text", 'PRODUCTION_OUTPUT'::"text", 'SALES_ISSUE'::"text", 'TRANSFER_OUT'::"text", 'TRANSFER_IN'::"text", 'ADJUSTMENT'::"text"]))),
    CONSTRAINT "chk_qty_nonzero" CHECK (("qty_signed" <> (0)::numeric))
);

ALTER TABLE ONLY "public"."inventory_movements" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."item_moving_average" (
    "company_id" "uuid" NOT NULL,
    "item_id" "text" NOT NULL,
    "avg_cost" numeric DEFAULT 0 NOT NULL,
    "qty_on_hand" numeric DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."item_moving_average" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."item_moving_average" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."item_on_hand_by_bin" AS
 SELECT "company_id",
    "item_id",
    "warehouse_id",
    "bin_id",
    "sum"("qty_signed") AS "qty"
   FROM "public"."inventory_movements"
  GROUP BY "company_id", "item_id", "warehouse_id", "bin_id";


ALTER VIEW "public"."item_on_hand_by_bin" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."item_on_hand_by_wh" AS
 SELECT "company_id",
    "item_id",
    "warehouse_id",
    "sum"("qty") AS "qty"
   FROM "public"."item_on_hand_by_bin"
  GROUP BY "company_id", "item_id", "warehouse_id";


ALTER VIEW "public"."item_on_hand_by_wh" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_levels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "item_id" "uuid" NOT NULL,
    "warehouse_id" "uuid",
    "qty" numeric DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "bin_id" "text",
    "avg_cost" numeric,
    "allocated_qty" numeric,
    "company_id" "uuid"
);

ALTER TABLE ONLY "public"."stock_levels" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_levels" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."items_view" WITH ("security_invoker"='true') AS
 WITH "stock_totals" AS (
         SELECT "sl"."company_id",
            "sl"."item_id",
            COALESCE("sum"(COALESCE("sl"."qty", (0)::numeric)), (0)::numeric) AS "on_hand_qty",
            COALESCE("sum"((COALESCE("sl"."qty", (0)::numeric) - COALESCE("sl"."allocated_qty", (0)::numeric))), (0)::numeric) AS "available_qty"
           FROM "public"."stock_levels" "sl"
          GROUP BY "sl"."company_id", "sl"."item_id"
        ), "item_usage" AS (
         SELECT "i_1"."id",
            (EXISTS ( SELECT 1
                   FROM "public"."boms" "b"
                  WHERE (("b"."product_id" = "i_1"."id") AND (COALESCE("b"."is_active", false) = true)))) AS "has_active_bom",
            (EXISTS ( SELECT 1
                   FROM "public"."bom_components" "bc"
                  WHERE ("bc"."component_item_id" = "i_1"."id"))) AS "used_as_component"
           FROM "public"."items" "i_1"
        )
 SELECT "i"."id",
    "i"."sku",
    "i"."name",
    "i"."base_uom_id" AS "baseUomId",
    "i"."unit_price" AS "unitPrice",
    "i"."min_stock" AS "minStock",
    "i"."created_at" AS "createdAt",
    "i"."updated_at" AS "updatedAt",
    "i"."primary_role" AS "primaryRole",
    "i"."track_inventory" AS "trackInventory",
    "i"."can_buy" AS "canBuy",
    "i"."can_sell" AS "canSell",
    "i"."is_assembled" AS "isAssembled",
    COALESCE("stock"."on_hand_qty", (0)::numeric) AS "onHandQty",
    COALESCE("stock"."available_qty", (0)::numeric) AS "availableQty",
    "usage"."has_active_bom" AS "hasActiveBom",
    "usage"."used_as_component" AS "usedAsComponent"
   FROM (("public"."items" "i"
     LEFT JOIN "stock_totals" "stock" ON ((("stock"."company_id" = "i"."company_id") AND ("stock"."item_id" = "i"."id"))))
     LEFT JOIN "item_usage" "usage" ON (("usage"."id" = "i"."id")))
  WHERE ("i"."company_id" = "public"."current_company_id"());


ALTER VIEW "public"."items_view" OWNER TO "postgres";


COMMENT ON VIEW "public"."items_view" IS 'Operational item profile read model for Phase 3B. Combines stock-facing identity, lightweight classification flags, and live stock totals for safer item setup and assembly planning UX.';



CREATE TABLE IF NOT EXISTS "public"."sales_shipments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "movement_id" "uuid" NOT NULL,
    "so_id" "uuid",
    "so_line_id" "uuid",
    "item_id" "uuid" NOT NULL,
    "qty" numeric NOT NULL,
    "qty_base" numeric NOT NULL,
    "unit_price" numeric NOT NULL,
    "discount_pct" numeric DEFAULT 0 NOT NULL,
    "revenue_amount" numeric NOT NULL,
    "currency_code" "text" NOT NULL,
    "fx_to_base" numeric DEFAULT 1 NOT NULL,
    "revenue_base_amount" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid" DEFAULT "public"."current_company_id"()
);

ALTER TABLE ONLY "public"."sales_shipments" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_shipments" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."kpi_revenue_cogs_daily" WITH ("security_invoker"='on') AS
 SELECT "date_trunc"('day'::"text", "sm"."created_at") AS "day",
    "sum"(
        CASE
            WHEN (("sm"."type" = 'issue'::"text") AND ("upper"(COALESCE("sm"."ref_type", ''::"text")) = 'SO'::"text")) THEN "sm"."total_value"
            ELSE (0)::numeric
        END) AS "cogs_base",
    "sum"(COALESCE("ss"."revenue_base_amount", (0)::numeric)) AS "revenue_base"
   FROM ("public"."stock_movements" "sm"
     LEFT JOIN "public"."sales_shipments" "ss" ON (("ss"."movement_id" = "sm"."id")))
  WHERE ("sm"."company_id" = "public"."current_company_id"())
  GROUP BY ("date_trunc"('day'::"text", "sm"."created_at"))
  ORDER BY ("date_trunc"('day'::"text", "sm"."created_at")) DESC;


ALTER VIEW "public"."kpi_revenue_cogs_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."landed_cost_run_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "purchase_order_id" "uuid" NOT NULL,
    "po_line_id" "uuid",
    "item_id" "uuid" NOT NULL,
    "item_label" "text",
    "warehouse_id" "uuid",
    "bin_id" "text",
    "stock_level_id" "uuid",
    "stock_movement_id" "uuid",
    "received_qty_base" numeric DEFAULT 0 NOT NULL,
    "impacted_qty_base" numeric DEFAULT 0 NOT NULL,
    "on_hand_qty_base" numeric DEFAULT 0 NOT NULL,
    "allocated_extra" numeric DEFAULT 0 NOT NULL,
    "applied_revaluation" numeric DEFAULT 0 NOT NULL,
    "unapplied_value" numeric DEFAULT 0 NOT NULL,
    "previous_avg_cost" numeric DEFAULT 0 NOT NULL,
    "new_avg_cost" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."landed_cost_run_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."landed_cost_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "purchase_order_id" "uuid" NOT NULL,
    "supplier_id" "uuid",
    "applied_by" "uuid",
    "currency_code" "text" NOT NULL,
    "fx_to_base" numeric DEFAULT 1 NOT NULL,
    "allocation_method" "text" NOT NULL,
    "total_extra_cost" numeric DEFAULT 0 NOT NULL,
    "total_applied_value" numeric DEFAULT 0 NOT NULL,
    "total_unapplied_value" numeric DEFAULT 0 NOT NULL,
    "notes" "text",
    "charges" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "landed_cost_runs_allocation_method_check" CHECK (("allocation_method" = ANY (ARRAY['quantity'::"text", 'value'::"text", 'equal'::"text"])))
);


ALTER TABLE "public"."landed_cost_runs" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."low_stock_alerts" AS
 SELECT "i"."id" AS "item_id",
    "i"."sku",
    "i"."name",
    COALESCE("sum"("sl"."qty"), (0)::numeric) AS "qty_on_hand",
    "i"."reorder_point"
   FROM ("public"."items" "i"
     LEFT JOIN "public"."stock_levels" "sl" ON (("sl"."item_id" = "i"."id")))
  GROUP BY "i"."id", "i"."sku", "i"."name", "i"."reorder_point"
 HAVING (COALESCE("sum"("sl"."qty"), (0)::numeric) < ("i"."reorder_point")::numeric);


ALTER VIEW "public"."low_stock_alerts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "item_id" "uuid" NOT NULL,
    "from_warehouse_id" "uuid",
    "to_warehouse_id" "uuid",
    "qty" numeric NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "company_id" "uuid",
    "from_bin_id" "text",
    "to_bin_id" "text",
    CONSTRAINT "movements_has_location" CHECK ((("from_warehouse_id" IS NOT NULL) OR ("to_warehouse_id" IS NOT NULL) OR (("from_bin_id" IS NOT NULL) OR ("to_bin_id" IS NOT NULL)))),
    CONSTRAINT "movements_qty_positive" CHECK (("qty" > (0)::numeric))
);

ALTER TABLE ONLY "public"."movements" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "level" "text" DEFAULT 'info'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "url" "text",
    "icon" "text",
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."number_sequences" (
    "key" "text" NOT NULL,
    "prefix" "text" NOT NULL,
    "next_number" integer NOT NULL,
    "reset_yearly" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."number_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_counters" (
    "company_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "last_value" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "order_counters_type_check" CHECK (("type" = ANY (ARRAY['PO'::"text", 'SO'::"text"])))
);


ALTER TABLE "public"."order_counters" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."org_members" AS
 SELECT "user_id",
    "company_id",
    "lower"(("role")::"text") AS "role"
   FROM "public"."company_members"
  WHERE ("user_id" IS NOT NULL);


ALTER VIEW "public"."org_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_terms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "net_days" integer NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_terms_net_days_check" CHECK (("net_days" >= 0))
);


ALTER TABLE "public"."payment_terms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plan_catalog" (
    "code" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "monthly_price_mzn" numeric(12,2),
    "six_month_price_mzn" numeric(12,2),
    "annual_price_mzn" numeric(12,2),
    "onboarding_fee_mzn" numeric(12,2),
    "starting_price_mzn" numeric(12,2),
    "trial_days" integer DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "is_public" boolean DEFAULT true NOT NULL,
    "manual_activation_only" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "plan_catalog_trial_days_check" CHECK ((("trial_days" >= 0) AND ("trial_days" <= 365)))
);


ALTER TABLE "public"."plan_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_admins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "email" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "granted_by" "uuid",
    "granted_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."platform_admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_order_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "po_id" "uuid" NOT NULL,
    "line_no" integer NOT NULL,
    "item_id" "uuid" NOT NULL,
    "uom_id" "text" NOT NULL,
    "qty" numeric(18,4) NOT NULL,
    "unit_price" numeric(18,4) DEFAULT 0 NOT NULL,
    "line_total" numeric(18,4) DEFAULT 0 NOT NULL,
    "expected_date" "date",
    "notes" "text",
    "discount_pct" numeric(6,3) DEFAULT 0,
    "company_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text",
    CONSTRAINT "purchase_order_lines_discount_pct_check" CHECK ((("discount_pct" >= (0)::numeric) AND ("discount_pct" <= (100)::numeric))),
    CONSTRAINT "purchase_order_lines_qty_check" CHECK (("qty" > (0)::numeric))
);

ALTER TABLE ONLY "public"."purchase_order_lines" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_order_lines" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."reporting_cash_sales" WITH ("security_invoker"='on') AS
 SELECT "s"."id",
    COALESCE("so"."customer_id", "cash_cust"."id") AS "customer_id",
    COALESCE("so"."customer_id", "cash_cust"."id") AS "customerId",
    'finalized'::"text" AS "status",
    "s"."currency_code",
    "s"."currency_code" AS "currencyCode",
    "s"."created_at",
    "s"."created_at" AS "createdAt",
    COALESCE("s"."revenue_base_amount", ("s"."revenue_amount" * NULLIF("s"."fx_to_base", (0)::numeric)), "s"."revenue_amount", (0)::numeric) AS "total_amount",
    COALESCE("s"."revenue_base_amount", ("s"."revenue_amount" * NULLIF("s"."fx_to_base", (0)::numeric)), "s"."revenue_amount", (0)::numeric) AS "total",
    NULL::numeric AS "grand_total",
    NULL::numeric AS "net_total",
    NULL::numeric AS "grandTotal",
    NULL::numeric AS "netTotal"
   FROM (((("public"."sales_shipments" "s"
     LEFT JOIN "public"."sales_orders" "so" ON (("so"."id" = "s"."so_id")))
     LEFT JOIN "public"."stock_movements" "sm" ON (("sm"."id" = "s"."movement_id")))
     LEFT JOIN "public"."items" "i" ON (("i"."id" = "s"."item_id")))
     LEFT JOIN LATERAL ( SELECT "c"."id"
           FROM "public"."customers" "c"
          WHERE (("c"."company_id" = "i"."company_id") AND ("c"."is_cash" = true))
         LIMIT 1) "cash_cust" ON (true))
  WHERE (("s"."company_id" = "public"."current_company_id"()) AND (("s"."so_id" IS NULL) OR (EXISTS ( SELECT 1
           FROM ("public"."sales_orders" "so2"
             JOIN "public"."customers" "c" ON (("c"."id" = "so2"."customer_id")))
          WHERE (("so2"."id" = "s"."so_id") AND ("c"."is_cash" = true)))) OR (COALESCE("sm"."ref_type", ''::"text") = ANY (ARRAY['POS'::"text", 'CASH'::"text", 'WALKIN'::"text"]))));


ALTER VIEW "public"."reporting_cash_sales" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."reporting_sales_orders" WITH ("security_invoker"='true') AS
 SELECT "id",
    "company_id",
    "company_id" AS "companyId",
    "customer_id",
    "customer_id" AS "customerId",
    "status",
    "currency_code",
    "currency_code" AS "currencyCode",
    COALESCE("created_at", (("order_date")::timestamp without time zone)::timestamp with time zone) AS "created_at",
    COALESCE("created_at", (("order_date")::timestamp without time zone)::timestamp with time zone) AS "createdAt",
    COALESCE("total_amount", "total", ("subtotal" + "tax_total"), (0)::numeric) AS "total_amount",
    COALESCE("total_amount", "total", ("subtotal" + "tax_total"), (0)::numeric) AS "total",
    NULL::numeric AS "grand_total",
    NULL::numeric AS "net_total",
    NULL::numeric AS "grandTotal",
    NULL::numeric AS "netTotal"
   FROM "public"."sales_orders" "so"
  WHERE ("company_id" = "public"."current_company_id"());


ALTER VIEW "public"."reporting_sales_orders" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."revenue_events" AS
 SELECT "item_id",
    "qty_base",
    "revenue_base_amount",
    "created_at",
    "company_id"
   FROM "public"."sales_shipments";


ALTER VIEW "public"."revenue_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_credit_note_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "sales_credit_note_id" "uuid" NOT NULL,
    "sales_invoice_line_id" "uuid",
    "item_id" "uuid",
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "qty" numeric DEFAULT 0 NOT NULL,
    "unit_price" numeric DEFAULT 0 NOT NULL,
    "tax_rate" numeric,
    "tax_amount" numeric DEFAULT 0 NOT NULL,
    "line_total" numeric DEFAULT 0 NOT NULL,
    "product_code_snapshot" "text",
    "unit_of_measure_snapshot" "text",
    "tax_category_code" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_credit_note_lines_nonnegative_fields" CHECK ((("qty" >= (0)::numeric) AND ("unit_price" >= (0)::numeric) AND (("tax_rate" IS NULL) OR ("tax_rate" >= (0)::numeric)) AND ("tax_amount" >= (0)::numeric) AND ("line_total" >= (0)::numeric)))
);


ALTER TABLE "public"."sales_credit_note_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_debit_note_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "sales_debit_note_id" "uuid" NOT NULL,
    "sales_invoice_line_id" "uuid",
    "item_id" "uuid",
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "qty" numeric DEFAULT 0 NOT NULL,
    "unit_price" numeric DEFAULT 0 NOT NULL,
    "tax_rate" numeric,
    "tax_amount" numeric DEFAULT 0 NOT NULL,
    "line_total" numeric DEFAULT 0 NOT NULL,
    "product_code_snapshot" "text",
    "unit_of_measure_snapshot" "text",
    "tax_category_code" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_debit_note_lines_nonnegative_fields" CHECK ((("qty" >= (0)::numeric) AND ("unit_price" >= (0)::numeric) AND (("tax_rate" IS NULL) OR ("tax_rate" >= (0)::numeric)) AND ("tax_amount" >= (0)::numeric) AND ("line_total" >= (0)::numeric)))
);


ALTER TABLE "public"."sales_debit_note_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_invoice_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "sales_invoice_id" "uuid" NOT NULL,
    "sales_order_line_id" "uuid",
    "item_id" "uuid",
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "qty" numeric DEFAULT 0 NOT NULL,
    "unit_price" numeric DEFAULT 0 NOT NULL,
    "tax_rate" numeric,
    "tax_amount" numeric DEFAULT 0 NOT NULL,
    "line_total" numeric DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_code_snapshot" "text",
    "unit_of_measure_snapshot" "text",
    "tax_category_code" "text",
    CONSTRAINT "sales_invoice_lines_nonnegative_fields" CHECK ((("qty" >= (0)::numeric) AND ("unit_price" >= (0)::numeric) AND (("tax_rate" IS NULL) OR ("tax_rate" >= (0)::numeric)) AND ("tax_amount" >= (0)::numeric) AND ("line_total" >= (0)::numeric)))
);


ALTER TABLE "public"."sales_invoice_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_order_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "so_id" "uuid" NOT NULL,
    "line_no" integer NOT NULL,
    "item_id" "uuid" NOT NULL,
    "uom_id" "text" NOT NULL,
    "qty" numeric(18,4) NOT NULL,
    "unit_price" numeric(18,4) DEFAULT 0 NOT NULL,
    "line_total" numeric(18,4) DEFAULT 0 NOT NULL,
    "promised_date" "date",
    "notes" "text",
    "discount_pct" numeric(6,3) DEFAULT 0,
    "shipped_qty" numeric DEFAULT 0 NOT NULL,
    "is_shipped" boolean DEFAULT false NOT NULL,
    "shipped_at" timestamp with time zone,
    "company_id" "uuid" NOT NULL,
    "description" "text",
    CONSTRAINT "sales_order_lines_discount_pct_check" CHECK ((("discount_pct" >= (0)::numeric) AND ("discount_pct" <= (100)::numeric))),
    CONSTRAINT "sales_order_lines_qty_check" CHECK (("qty" > (0)::numeric))
);

ALTER TABLE ONLY "public"."sales_order_lines" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_order_lines" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."sales_order_ship_progress" AS
 SELECT "so"."id" AS "so_id",
    "so"."status",
    "sum"("sol"."qty") AS "ordered_qty",
    "sum"(COALESCE("sol"."shipped_qty", (0)::numeric)) AS "shipped_qty",
    "bool_and"((COALESCE("sol"."shipped_qty", (0)::numeric) >= "sol"."qty")) AS "fully_shipped"
   FROM ("public"."sales_orders" "so"
     JOIN "public"."sales_order_lines" "sol" ON (("sol"."so_id" = "so"."id")))
  GROUP BY "so"."id", "so"."status";


ALTER VIEW "public"."sales_order_ship_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settings" (
    "id" "text" NOT NULL,
    "base_currency_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "baseCurrencyCode" "text" GENERATED ALWAYS AS ("base_currency_code") STORED,
    "orders_source" "text",
    "cash_sales_source" "text",
    "pos_source" "text"
);


ALTER TABLE "public"."settings" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."stock_levels_v" AS
 SELECT "gen_random_uuid"() AS "id",
    "wh"."item_id",
    "wh"."warehouse_id",
    "wh"."qty",
    "ma"."avg_cost"
   FROM ("public"."item_on_hand_by_wh" "wh"
     LEFT JOIN "public"."item_moving_average" "ma" ON ((("ma"."company_id" = "wh"."company_id") AND ("ma"."item_id" = "wh"."item_id"))));


ALTER VIEW "public"."stock_levels_v" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "extensions"."citext" NOT NULL,
    "name" "text" NOT NULL,
    "contact_name" "text",
    "email" "text",
    "phone" "text",
    "tax_id" "text",
    "currency_code" "text",
    "payment_terms" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid",
    "payment_terms_id" "uuid",
    CONSTRAINT "suppliers_code_not_blank" CHECK (("btrim"(("code")::"text") <> ''::"text"))
);

ALTER TABLE ONLY "public"."suppliers" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."supplier_movements_view" WITH ("security_invoker"='true') AS
 WITH "base" AS (
         SELECT "sm"."id",
            "sm"."created_at",
            "sm"."company_id",
            "po"."supplier_id",
            "s"."code" AS "supplier_code",
            "s"."name" AS "supplier_name",
            'PO'::"text" AS "ref_type",
            COALESCE("po"."order_no", "po"."code", "po"."public_id", ('PO-'::"text" || "left"(("po"."id")::"text", 8))) AS "ref_no",
            "sm"."item_id",
            "i"."name" AS "item_name",
            "i"."sku" AS "item_sku",
            "sm"."qty_base",
            "sm"."total_value",
            "sm"."notes"
           FROM (((("public"."stock_movements" "sm"
             JOIN "public"."purchase_order_lines" "pol" ON (("pol"."id" = "sm"."ref_line_id")))
             JOIN "public"."purchase_orders" "po" ON (("po"."id" = "pol"."po_id")))
             JOIN "public"."suppliers" "s" ON (("s"."id" = "po"."supplier_id")))
             LEFT JOIN "public"."items" "i" ON (("i"."id" = "sm"."item_id")))
          WHERE (("sm"."type" = 'receive'::"text") AND ("sm"."ref_type" = 'PO'::"text"))
        UNION ALL
         SELECT "sm"."id",
            "sm"."created_at",
            "sm"."company_id",
            "po"."supplier_id",
            "s"."code" AS "supplier_code",
            "s"."name" AS "supplier_name",
            'PO'::"text" AS "ref_type",
            COALESCE("po"."order_no", "po"."code", "po"."public_id", ('PO-'::"text" || "left"(("po"."id")::"text", 8))) AS "ref_no",
            "sm"."item_id",
            "i"."name" AS "item_name",
            "i"."sku" AS "item_sku",
            "sm"."qty_base",
            "sm"."total_value",
            "sm"."notes"
           FROM ((("public"."stock_movements" "sm"
             JOIN "public"."purchase_orders" "po" ON (((("sm"."ref_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::"text") AND ("po"."id" = ("sm"."ref_id")::"uuid")) OR ("po"."order_no" = "sm"."ref_id") OR ("po"."public_id" = "sm"."ref_id") OR ("po"."code" = "sm"."ref_id"))))
             JOIN "public"."suppliers" "s" ON (("s"."id" = "po"."supplier_id")))
             LEFT JOIN "public"."items" "i" ON (("i"."id" = "sm"."item_id")))
          WHERE (("sm"."type" = 'receive'::"text") AND ("sm"."ref_type" = 'PO'::"text") AND ("sm"."ref_line_id" IS NULL))
        )
 SELECT "id",
    "created_at",
    "company_id",
    "supplier_id",
    "supplier_code",
    "supplier_name",
    "ref_type",
    "ref_no",
    "item_id",
    "item_name",
    "item_sku",
    "qty_base",
    "total_value",
    "notes"
   FROM "base"
  ORDER BY "created_at" DESC;


ALTER VIEW "public"."supplier_movements_view" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."suppliers_view" WITH ("security_invoker"='true') AS
 SELECT "id",
    "company_id",
    "code",
    "name",
    "contact_name" AS "contactName",
    "email",
    "phone",
    "tax_id" AS "taxId",
    "currency_code" AS "currencyId",
    "payment_terms_id" AS "paymentTermsId",
    "is_active" AS "isActive",
    "notes",
    "created_at" AS "createdAt",
    "updated_at" AS "updatedAt"
   FROM "public"."suppliers" "s";


ALTER VIEW "public"."suppliers_view" OWNER TO "postgres";


COMMENT ON VIEW "public"."suppliers_view" IS 'UI projection for suppliers page v2 (uuid payment_terms_id).';



CREATE TABLE IF NOT EXISTS "public"."uoms" (
    "id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "family" "text" NOT NULL,
    CONSTRAINT "uoms_family_chk" CHECK (("family" = ANY (ARRAY['mass'::"text", 'volume'::"text", 'length'::"text", 'count'::"text", 'time'::"text", 'area'::"text"])))
);


ALTER TABLE "public"."uoms" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."uom" WITH ("security_invoker"='on') AS
 SELECT "id",
    "code",
    "name"
   FROM "public"."uoms";


ALTER VIEW "public"."uom" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."uom_conversions" (
    "id" bigint NOT NULL,
    "from_uom_id" "text" NOT NULL,
    "to_uom_id" "text" NOT NULL,
    "factor" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid",
    CONSTRAINT "uom_conv_no_self" CHECK (("from_uom_id" <> "to_uom_id")),
    CONSTRAINT "uom_conversions_factor_check" CHECK (("factor" > (0)::numeric)),
    CONSTRAINT "uom_conversions_factor_positive" CHECK (("factor" > (0)::numeric))
);


ALTER TABLE "public"."uom_conversions" OWNER TO "postgres";


ALTER TABLE "public"."uom_conversions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."uom_conversions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_active_company" (
    "user_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_active_company" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "user_id" "uuid" NOT NULL,
    "active_company_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_po_cash_status" AS
 SELECT "id",
    "order_no",
    "status",
    "company_id",
    COALESCE("total", (0)::numeric) AS "total_amount_ccy",
    COALESCE("fx_to_base", (1)::numeric) AS "fx_to_base",
    (COALESCE("total", (0)::numeric) * COALESCE("fx_to_base", (1)::numeric)) AS "total_amount_base",
    COALESCE(( SELECT "sum"("ct"."amount_base") AS "sum"
           FROM "public"."cash_transactions" "ct"
          WHERE (("ct"."company_id" = "po"."company_id") AND ("ct"."ref_type" = 'PO'::"text") AND ("ct"."ref_id" = "po"."id") AND ("ct"."type" = 'purchase_payment'::"text"))), (0)::numeric) AS "cash_paid_base",
    ((COALESCE("total", (0)::numeric) * COALESCE("fx_to_base", (1)::numeric)) - COALESCE(( SELECT "sum"("ct"."amount_base") AS "sum"
           FROM "public"."cash_transactions" "ct"
          WHERE (("ct"."company_id" = "po"."company_id") AND ("ct"."ref_type" = 'PO'::"text") AND ("ct"."ref_id" = "po"."id") AND ("ct"."type" = 'purchase_payment'::"text"))), (0)::numeric)) AS "balance_due_base",
    ( SELECT "max"("sm"."created_at") AS "max"
           FROM "public"."stock_movements" "sm"
          WHERE (("sm"."ref_type" = 'PO'::"text") AND ("sm"."ref_id" = ("po"."id")::"text"))) AS "last_receive_activity_at"
   FROM "public"."purchase_orders" "po";


ALTER VIEW "public"."v_po_cash_status" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_so_cash_status" AS
 SELECT "id",
    "order_no",
    "status",
    "company_id",
    COALESCE("total_amount", (0)::numeric) AS "total_amount_ccy",
    COALESCE("fx_to_base", (1)::numeric) AS "fx_to_base",
    (COALESCE("total_amount", (0)::numeric) * COALESCE("fx_to_base", (1)::numeric)) AS "total_amount_base",
    COALESCE(( SELECT "sum"("ct"."amount_base") AS "sum"
           FROM "public"."cash_transactions" "ct"
          WHERE (("ct"."company_id" = "so"."company_id") AND ("ct"."ref_type" = 'SO'::"text") AND ("ct"."ref_id" = "so"."id") AND ("ct"."type" = 'sale_receipt'::"text"))), (0)::numeric) AS "cash_received_base",
    ((COALESCE("total_amount", (0)::numeric) * COALESCE("fx_to_base", (1)::numeric)) - COALESCE(( SELECT "sum"("ct"."amount_base") AS "sum"
           FROM "public"."cash_transactions" "ct"
          WHERE (("ct"."company_id" = "so"."company_id") AND ("ct"."ref_type" = 'SO'::"text") AND ("ct"."ref_id" = "so"."id") AND ("ct"."type" = 'sale_receipt'::"text"))), (0)::numeric)) AS "balance_due_base",
    ( SELECT "max"("sm"."created_at") AS "max"
           FROM "public"."stock_movements" "sm"
          WHERE (("sm"."ref_type" = 'SO'::"text") AND ("sm"."ref_id" = ("so"."id")::"text"))) AS "last_ship_activity_at"
   FROM "public"."sales_orders" "so";


ALTER VIEW "public"."v_so_cash_status" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_cash_approvals_queue" AS
 SELECT 'SO'::"text" AS "ref_type",
    "s"."id" AS "ref_id",
    "s"."order_no",
    "s"."company_id",
    ("s"."status")::"text" AS "status",
    "s"."total_amount_base",
    "s"."cash_received_base" AS "cash_posted_base",
    "s"."balance_due_base" AS "suggested_amount_base",
    "s"."last_ship_activity_at" AS "last_activity_at"
   FROM "public"."v_so_cash_status" "s"
  WHERE (("s"."balance_due_base" > (0)::numeric) AND ("s"."last_ship_activity_at" IS NOT NULL))
UNION ALL
 SELECT 'PO'::"text" AS "ref_type",
    "p"."id" AS "ref_id",
    "p"."order_no",
    "p"."company_id",
    ("p"."status")::"text" AS "status",
    "p"."total_amount_base",
    "p"."cash_paid_base" AS "cash_posted_base",
    "p"."balance_due_base" AS "suggested_amount_base",
    "p"."last_receive_activity_at" AS "last_activity_at"
   FROM "public"."v_po_cash_status" "p"
  WHERE (("p"."balance_due_base" > (0)::numeric) AND ("p"."last_receive_activity_at" IS NOT NULL));


ALTER VIEW "public"."v_cash_approvals_queue" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_due_sales_orders" WITH ("security_invoker"='true') AS
 SELECT "company_id",
    "id" AS "so_id",
    "code",
    "customer_id",
    "due_date",
    "total" AS "total_amount",
    "currency_code",
    ( SELECT COALESCE("sum"(("ct"."amount_base" / NULLIF("so"."fx_to_base", (0)::numeric))), (0)::numeric) AS "coalesce"
           FROM "public"."cash_transactions" "ct"
          WHERE (("ct"."company_id" = "so"."company_id") AND ("ct"."ref_type" = 'SO'::"text") AND ("ct"."ref_id" = "so"."id"))) AS "paid_amount",
    GREATEST(("total" - ( SELECT COALESCE("sum"(("ct"."amount_base" / NULLIF("so"."fx_to_base", (0)::numeric))), (0)::numeric) AS "coalesce"
           FROM "public"."cash_transactions" "ct"
          WHERE (("ct"."company_id" = "so"."company_id") AND ("ct"."ref_type" = 'SO'::"text") AND ("ct"."ref_id" = "so"."id")))), (0)::numeric) AS "balance_due"
   FROM "public"."sales_orders" "so"
  WHERE (("status" <> ALL (ARRAY['cancelled'::"public"."so_status", 'closed'::"public"."so_status"])) AND ("due_date" IS NOT NULL));


ALTER VIEW "public"."v_due_sales_orders" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_sales_invoice_state" WITH ("security_invoker"='true') AS
 WITH "line_rollup" AS (
         SELECT "sil"."sales_invoice_id",
            ("count"(*))::integer AS "line_count"
           FROM "public"."sales_invoice_lines" "sil"
          GROUP BY "sil"."sales_invoice_id"
        ), "cash_rollup" AS (
         SELECT "ct"."company_id",
            "ct"."ref_id" AS "sales_invoice_id",
            COALESCE("sum"("ct"."amount_base"), (0)::numeric) AS "settled_base"
           FROM "public"."cash_transactions" "ct"
          WHERE (("ct"."ref_type" = 'SI'::"text") AND ("ct"."type" = 'sale_receipt'::"text"))
          GROUP BY "ct"."company_id", "ct"."ref_id"
        ), "bank_rollup" AS (
         SELECT "bt"."ref_id" AS "sales_invoice_id",
            COALESCE("sum"("bt"."amount_base"), (0)::numeric) AS "settled_base"
           FROM "public"."bank_transactions" "bt"
          WHERE ("bt"."ref_type" = 'SI'::"text")
          GROUP BY "bt"."ref_id"
        ), "credit_rollup" AS (
         SELECT "scn"."company_id",
            "scn"."original_sales_invoice_id" AS "sales_invoice_id",
            ("count"(*) FILTER (WHERE ("scn"."document_workflow_status" = 'issued'::"text")))::integer AS "credit_note_count",
            COALESCE("sum"((COALESCE("scn"."total_amount", (0)::numeric) * COALESCE("scn"."fx_to_base", (1)::numeric))) FILTER (WHERE ("scn"."document_workflow_status" = 'issued'::"text")), (0)::numeric) AS "credited_total_base"
           FROM "public"."sales_credit_notes" "scn"
          GROUP BY "scn"."company_id", "scn"."original_sales_invoice_id"
        ), "debit_rollup" AS (
         SELECT "sdn"."company_id",
            "sdn"."original_sales_invoice_id" AS "sales_invoice_id",
            ("count"(*) FILTER (WHERE ("sdn"."document_workflow_status" = 'issued'::"text")))::integer AS "debit_note_count",
            COALESCE("sum"((COALESCE("sdn"."total_amount", (0)::numeric) * COALESCE("sdn"."fx_to_base", (1)::numeric))) FILTER (WHERE ("sdn"."document_workflow_status" = 'issued'::"text")), (0)::numeric) AS "debited_total_base"
           FROM "public"."sales_debit_notes" "sdn"
          GROUP BY "sdn"."company_id", "sdn"."original_sales_invoice_id"
        )
 SELECT "si"."id",
    "si"."company_id",
    "si"."sales_order_id",
    "si"."customer_id",
    "si"."internal_reference",
    "si"."invoice_date",
    "si"."due_date",
    COALESCE(NULLIF("c"."name", ''::"text"), NULLIF("so"."bill_to_name", ''::"text"), NULLIF("so"."customer", ''::"text")) AS "counterparty_name",
    "so"."order_no",
    COALESCE("si"."currency_code", 'MZN'::"text") AS "currency_code",
    COALESCE("si"."fx_to_base", (1)::numeric) AS "fx_to_base",
    COALESCE("si"."subtotal", (0)::numeric) AS "subtotal",
    COALESCE("si"."tax_total", (0)::numeric) AS "tax_total",
    COALESCE("si"."total_amount", (0)::numeric) AS "total_amount",
    (COALESCE("si"."total_amount", (0)::numeric) * COALESCE("si"."fx_to_base", (1)::numeric)) AS "total_amount_base",
    "si"."document_workflow_status",
    COALESCE("lr"."line_count", 0) AS "line_count",
    false AS "state_warning",
    'sales_invoice'::"text" AS "financial_anchor",
    COALESCE("cr"."settled_base", (0)::numeric) AS "cash_received_base",
    COALESCE("br"."settled_base", (0)::numeric) AS "bank_received_base",
    (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric)) AS "settled_base",
    COALESCE("cnr"."credit_note_count", 0) AS "credit_note_count",
    COALESCE("cnr"."credited_total_base", (0)::numeric) AS "credited_total_base",
    COALESCE("dnr"."debit_note_count", 0) AS "debit_note_count",
    COALESCE("dnr"."debited_total_base", (0)::numeric) AS "debited_total_base",
    GREATEST((((COALESCE("si"."total_amount", (0)::numeric) * COALESCE("si"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - COALESCE("cnr"."credited_total_base", (0)::numeric)), (0)::numeric) AS "current_legal_total_base",
    GREATEST((GREATEST((((COALESCE("si"."total_amount", (0)::numeric) * COALESCE("si"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - COALESCE("cnr"."credited_total_base", (0)::numeric)), (0)::numeric) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric) AS "outstanding_base",
        CASE
            WHEN (COALESCE("cnr"."credited_total_base", (0)::numeric) >= (((COALESCE("si"."total_amount", (0)::numeric) * COALESCE("si"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - 0.005)) THEN 'fully_credited'::"text"
            WHEN (COALESCE("cnr"."credited_total_base", (0)::numeric) > 0.005) THEN 'partially_credited'::"text"
            ELSE 'not_credited'::"text"
        END AS "credit_status",
        CASE
            WHEN ((COALESCE("cnr"."credited_total_base", (0)::numeric) > 0.005) AND (COALESCE("dnr"."debited_total_base", (0)::numeric) > 0.005)) THEN 'credited_and_debited'::"text"
            WHEN (COALESCE("cnr"."credited_total_base", (0)::numeric) > 0.005) THEN 'credited'::"text"
            WHEN (COALESCE("dnr"."debited_total_base", (0)::numeric) > 0.005) THEN 'debited'::"text"
            ELSE 'none'::"text"
        END AS "adjustment_status",
        CASE
            WHEN (GREATEST((GREATEST((((COALESCE("si"."total_amount", (0)::numeric) * COALESCE("si"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - COALESCE("cnr"."credited_total_base", (0)::numeric)), (0)::numeric) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric) <= 0.005) THEN 'settled'::"text"
            WHEN (("si"."due_date" IS NOT NULL) AND ("si"."due_date" < CURRENT_DATE) AND (GREATEST((GREATEST((((COALESCE("si"."total_amount", (0)::numeric) * COALESCE("si"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - COALESCE("cnr"."credited_total_base", (0)::numeric)), (0)::numeric) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric) > 0.005)) THEN 'overdue'::"text"
            WHEN ((COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric)) > 0.005) THEN 'partially_settled'::"text"
            ELSE 'unsettled'::"text"
        END AS "settlement_status",
        CASE
            WHEN ("si"."document_workflow_status" = 'draft'::"text") THEN 'draft'::"text"
            WHEN ("si"."document_workflow_status" = 'voided'::"text") THEN 'voided'::"text"
            WHEN (COALESCE("cnr"."credited_total_base", (0)::numeric) >= (((COALESCE("si"."total_amount", (0)::numeric) * COALESCE("si"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - 0.005)) THEN 'issued_fully_credited'::"text"
            WHEN (COALESCE("cnr"."credited_total_base", (0)::numeric) > 0.005) THEN 'issued_partially_credited'::"text"
            WHEN (GREATEST((GREATEST((((COALESCE("si"."total_amount", (0)::numeric) * COALESCE("si"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - COALESCE("cnr"."credited_total_base", (0)::numeric)), (0)::numeric) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric) <= 0.005) THEN 'issued_settled'::"text"
            WHEN ((COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric)) > 0.005) THEN 'issued_partially_settled'::"text"
            WHEN (("si"."due_date" IS NOT NULL) AND ("si"."due_date" < CURRENT_DATE)) THEN 'issued_overdue'::"text"
            ELSE 'issued_open'::"text"
        END AS "resolution_status",
    "si"."approval_status",
    "si"."approval_requested_at",
    "si"."approved_at"
   FROM ((((((("public"."sales_invoices" "si"
     LEFT JOIN "public"."customers" "c" ON (("c"."id" = "si"."customer_id")))
     LEFT JOIN "public"."sales_orders" "so" ON (("so"."id" = "si"."sales_order_id")))
     LEFT JOIN "line_rollup" "lr" ON (("lr"."sales_invoice_id" = "si"."id")))
     LEFT JOIN "cash_rollup" "cr" ON ((("cr"."sales_invoice_id" = "si"."id") AND ("cr"."company_id" = "si"."company_id"))))
     LEFT JOIN "bank_rollup" "br" ON (("br"."sales_invoice_id" = "si"."id")))
     LEFT JOIN "credit_rollup" "cnr" ON ((("cnr"."sales_invoice_id" = "si"."id") AND ("cnr"."company_id" = "si"."company_id"))))
     LEFT JOIN "debit_rollup" "dnr" ON ((("dnr"."sales_invoice_id" = "si"."id") AND ("dnr"."company_id" = "si"."company_id"))));


ALTER VIEW "public"."v_sales_invoice_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_bill_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "vendor_bill_id" "uuid" NOT NULL,
    "purchase_order_line_id" "uuid",
    "item_id" "uuid",
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "qty" numeric DEFAULT 0 NOT NULL,
    "unit_cost" numeric DEFAULT 0 NOT NULL,
    "tax_rate" numeric,
    "tax_amount" numeric DEFAULT 0 NOT NULL,
    "line_total" numeric DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vendor_bill_lines_nonnegative_fields" CHECK ((("qty" >= (0)::numeric) AND ("unit_cost" >= (0)::numeric) AND (("tax_rate" IS NULL) OR ("tax_rate" >= (0)::numeric)) AND ("tax_amount" >= (0)::numeric) AND ("line_total" >= (0)::numeric)))
);


ALTER TABLE "public"."vendor_bill_lines" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_vendor_bill_state" WITH ("security_invoker"='true') AS
 WITH "line_rollup" AS (
         SELECT "vbl"."vendor_bill_id",
            ("count"(*))::integer AS "line_count"
           FROM "public"."vendor_bill_lines" "vbl"
          GROUP BY "vbl"."vendor_bill_id"
        ), "duplicate_groups" AS (
         SELECT "vb_1"."company_id",
            "vb_1"."supplier_id",
            "vb_1"."supplier_invoice_reference_normalized"
           FROM "public"."vendor_bills" "vb_1"
          WHERE (("vb_1"."document_workflow_status" <> 'voided'::"text") AND ("vb_1"."supplier_invoice_reference_normalized" IS NOT NULL))
          GROUP BY "vb_1"."company_id", "vb_1"."supplier_id", "vb_1"."supplier_invoice_reference_normalized"
         HAVING ("count"(*) > 1)
        ), "cash_rollup" AS (
         SELECT "ct"."company_id",
            "ct"."ref_id" AS "vendor_bill_id",
            COALESCE("sum"(
                CASE
                    WHEN (COALESCE("ct"."amount_base", (0)::numeric) < (0)::numeric) THEN (- "ct"."amount_base")
                    ELSE (0)::numeric
                END), (0)::numeric) AS "settled_base"
           FROM "public"."cash_transactions" "ct"
          WHERE (("ct"."ref_type" = 'VB'::"text") AND ("ct"."type" = 'purchase_payment'::"text"))
          GROUP BY "ct"."company_id", "ct"."ref_id"
        ), "bank_rollup" AS (
         SELECT "bt"."ref_id" AS "vendor_bill_id",
            COALESCE("sum"(
                CASE
                    WHEN (COALESCE("bt"."amount_base", (0)::numeric) < (0)::numeric) THEN (- "bt"."amount_base")
                    ELSE (0)::numeric
                END), (0)::numeric) AS "settled_base"
           FROM "public"."bank_transactions" "bt"
          WHERE ("bt"."ref_type" = 'VB'::"text")
          GROUP BY "bt"."ref_id"
        ), "credit_rollup" AS (
         SELECT "vcn"."company_id",
            "vcn"."original_vendor_bill_id" AS "vendor_bill_id",
            ("count"(*) FILTER (WHERE ("vcn"."document_workflow_status" = 'posted'::"text")))::integer AS "credit_note_count",
            COALESCE("sum"(COALESCE("vcn"."total_amount_base", (0)::numeric)) FILTER (WHERE ("vcn"."document_workflow_status" = 'posted'::"text")), (0)::numeric) AS "credited_total_base"
           FROM "public"."vendor_credit_notes" "vcn"
          GROUP BY "vcn"."company_id", "vcn"."original_vendor_bill_id"
        ), "debit_rollup" AS (
         SELECT "vdn"."company_id",
            "vdn"."original_vendor_bill_id" AS "vendor_bill_id",
            ("count"(*) FILTER (WHERE ("vdn"."document_workflow_status" = 'posted'::"text")))::integer AS "debit_note_count",
            COALESCE("sum"(COALESCE("vdn"."total_amount_base", (0)::numeric)) FILTER (WHERE ("vdn"."document_workflow_status" = 'posted'::"text")), (0)::numeric) AS "debited_total_base"
           FROM "public"."vendor_debit_notes" "vdn"
          GROUP BY "vdn"."company_id", "vdn"."original_vendor_bill_id"
        )
 SELECT "vb"."id",
    "vb"."company_id",
    "vb"."purchase_order_id",
    "vb"."supplier_id",
    "vb"."internal_reference",
    "vb"."supplier_invoice_reference",
    "vb"."supplier_invoice_reference_normalized",
    COALESCE(NULLIF("vb"."supplier_invoice_reference", ''::"text"), "vb"."internal_reference") AS "primary_reference",
    "vb"."supplier_invoice_date",
    "vb"."bill_date",
    "vb"."due_date",
    COALESCE(NULLIF("s"."name", ''::"text"), NULLIF("po"."supplier_name", ''::"text"), NULLIF("po"."supplier", ''::"text")) AS "counterparty_name",
    "po"."order_no",
    COALESCE("vb"."currency_code", 'MZN'::"text") AS "currency_code",
    COALESCE("vb"."fx_to_base", (1)::numeric) AS "fx_to_base",
    COALESCE("vb"."subtotal", (0)::numeric) AS "subtotal",
    COALESCE("vb"."tax_total", (0)::numeric) AS "tax_total",
    COALESCE("vb"."total_amount", (0)::numeric) AS "total_amount",
    (COALESCE("vb"."total_amount", (0)::numeric) * COALESCE("vb"."fx_to_base", (1)::numeric)) AS "total_amount_base",
    "vb"."document_workflow_status",
    COALESCE("lr"."line_count", 0) AS "line_count",
    ("dg"."company_id" IS NOT NULL) AS "duplicate_supplier_reference_exists",
    'vendor_bill'::"text" AS "financial_anchor",
    COALESCE("cr"."settled_base", (0)::numeric) AS "cash_paid_base",
    COALESCE("br"."settled_base", (0)::numeric) AS "bank_paid_base",
    (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric)) AS "settled_base",
    COALESCE("cnr"."credit_note_count", 0) AS "credit_note_count",
    COALESCE("cnr"."credited_total_base", (0)::numeric) AS "credited_total_base",
    COALESCE("dnr"."debit_note_count", 0) AS "debit_note_count",
    COALESCE("dnr"."debited_total_base", (0)::numeric) AS "debited_total_base",
    GREATEST((((COALESCE("vb"."total_amount", (0)::numeric) * COALESCE("vb"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - COALESCE("cnr"."credited_total_base", (0)::numeric)), (0)::numeric) AS "current_legal_total_base",
    GREATEST((GREATEST((((COALESCE("vb"."total_amount", (0)::numeric) * COALESCE("vb"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - COALESCE("cnr"."credited_total_base", (0)::numeric)), (0)::numeric) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric) AS "outstanding_base",
        CASE
            WHEN (COALESCE("cnr"."credited_total_base", (0)::numeric) >= (((COALESCE("vb"."total_amount", (0)::numeric) * COALESCE("vb"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - 0.005)) THEN 'fully_credited'::"text"
            WHEN (COALESCE("cnr"."credited_total_base", (0)::numeric) > 0.005) THEN 'partially_credited'::"text"
            ELSE 'not_credited'::"text"
        END AS "credit_status",
        CASE
            WHEN ((COALESCE("cnr"."credited_total_base", (0)::numeric) > 0.005) AND (COALESCE("dnr"."debited_total_base", (0)::numeric) > 0.005)) THEN 'credited_and_debited'::"text"
            WHEN (COALESCE("cnr"."credited_total_base", (0)::numeric) > 0.005) THEN 'credited'::"text"
            WHEN (COALESCE("dnr"."debited_total_base", (0)::numeric) > 0.005) THEN 'debited'::"text"
            ELSE 'none'::"text"
        END AS "adjustment_status",
        CASE
            WHEN (GREATEST((GREATEST((((COALESCE("vb"."total_amount", (0)::numeric) * COALESCE("vb"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - COALESCE("cnr"."credited_total_base", (0)::numeric)), (0)::numeric) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric) <= 0.005) THEN 'settled'::"text"
            WHEN (("vb"."due_date" IS NOT NULL) AND ("vb"."due_date" < CURRENT_DATE) AND (GREATEST((GREATEST((((COALESCE("vb"."total_amount", (0)::numeric) * COALESCE("vb"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - COALESCE("cnr"."credited_total_base", (0)::numeric)), (0)::numeric) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric) > 0.005)) THEN 'overdue'::"text"
            WHEN ((COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric)) > 0.005) THEN 'partially_settled'::"text"
            ELSE 'unsettled'::"text"
        END AS "settlement_status",
        CASE
            WHEN ("vb"."document_workflow_status" = 'draft'::"text") THEN 'draft'::"text"
            WHEN ("vb"."document_workflow_status" = 'voided'::"text") THEN 'voided'::"text"
            WHEN (COALESCE("cnr"."credited_total_base", (0)::numeric) >= (((COALESCE("vb"."total_amount", (0)::numeric) * COALESCE("vb"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - 0.005)) THEN 'posted_fully_credited'::"text"
            WHEN (COALESCE("cnr"."credited_total_base", (0)::numeric) > 0.005) THEN 'posted_partially_credited'::"text"
            WHEN (GREATEST((GREATEST((((COALESCE("vb"."total_amount", (0)::numeric) * COALESCE("vb"."fx_to_base", (1)::numeric)) + COALESCE("dnr"."debited_total_base", (0)::numeric)) - COALESCE("cnr"."credited_total_base", (0)::numeric)), (0)::numeric) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric) <= 0.005) THEN 'posted_settled'::"text"
            WHEN ((COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric)) > 0.005) THEN 'posted_partially_settled'::"text"
            WHEN (("vb"."due_date" IS NOT NULL) AND ("vb"."due_date" < CURRENT_DATE)) THEN 'posted_overdue'::"text"
            ELSE 'posted_open'::"text"
        END AS "resolution_status",
    "vb"."approval_status",
    "vb"."approval_requested_at",
    "vb"."approved_at"
   FROM (((((((("public"."vendor_bills" "vb"
     LEFT JOIN "public"."suppliers" "s" ON (("s"."id" = "vb"."supplier_id")))
     LEFT JOIN "public"."purchase_orders" "po" ON (("po"."id" = "vb"."purchase_order_id")))
     LEFT JOIN "line_rollup" "lr" ON (("lr"."vendor_bill_id" = "vb"."id")))
     LEFT JOIN "duplicate_groups" "dg" ON ((("dg"."company_id" = "vb"."company_id") AND (NOT ("dg"."supplier_id" IS DISTINCT FROM "vb"."supplier_id")) AND ("dg"."supplier_invoice_reference_normalized" = "vb"."supplier_invoice_reference_normalized"))))
     LEFT JOIN "cash_rollup" "cr" ON ((("cr"."vendor_bill_id" = "vb"."id") AND ("cr"."company_id" = "vb"."company_id"))))
     LEFT JOIN "bank_rollup" "br" ON (("br"."vendor_bill_id" = "vb"."id")))
     LEFT JOIN "credit_rollup" "cnr" ON ((("cnr"."vendor_bill_id" = "vb"."id") AND ("cnr"."company_id" = "vb"."company_id"))))
     LEFT JOIN "debit_rollup" "dnr" ON ((("dnr"."vendor_bill_id" = "vb"."id") AND ("dnr"."company_id" = "vb"."company_id"))));


ALTER VIEW "public"."v_vendor_bill_state" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_vendor_bill_state" IS 'Finance-document settlement read model for vendor bills. AP payment outflows are stored as negative cash/bank movements and are converted here into positive settled amounts before outstanding liability is calculated.';



CREATE OR REPLACE VIEW "public"."v_finance_reconciliation_review" WITH ("security_invoker"='true') AS
 WITH "anchor_rows" AS (
         SELECT 'AR'::"text" AS "ledger_side",
            'sales_invoice'::"text" AS "anchor_kind",
            "si"."company_id",
            "si"."id" AS "anchor_id",
            "si"."sales_order_id" AS "operational_document_id",
            "si"."internal_reference" AS "anchor_reference",
            "si"."order_no" AS "operational_reference",
            "si"."counterparty_name",
            "si"."invoice_date" AS "document_date",
            "si"."due_date",
            "si"."currency_code",
            COALESCE("si"."total_amount_base", (0)::numeric) AS "original_total_base",
            COALESCE("si"."credited_total_base", (0)::numeric) AS "credited_total_base",
            COALESCE("si"."debited_total_base", (0)::numeric) AS "debited_total_base",
            (COALESCE("si"."debited_total_base", (0)::numeric) - COALESCE("si"."credited_total_base", (0)::numeric)) AS "net_adjustment_base",
            COALESCE("si"."current_legal_total_base", (0)::numeric) AS "current_legal_total_base",
            COALESCE("si"."settled_base", (0)::numeric) AS "settled_base",
            (COALESCE("si"."current_legal_total_base", (0)::numeric) - COALESCE("si"."settled_base", (0)::numeric)) AS "raw_outstanding_base",
            COALESCE("si"."outstanding_base", (0)::numeric) AS "outstanding_base",
            GREATEST((COALESCE("si"."settled_base", (0)::numeric) - COALESCE("si"."current_legal_total_base", (0)::numeric)), (0)::numeric) AS "over_settled_base",
            "si"."document_workflow_status",
            "si"."approval_status",
            "si"."adjustment_status",
            "si"."credit_status",
            "si"."settlement_status",
            "si"."resolution_status",
            false AS "duplicate_reference_flag"
           FROM "public"."v_sales_invoice_state" "si"
          WHERE ("si"."document_workflow_status" = 'issued'::"text")
        UNION ALL
         SELECT 'AP'::"text" AS "ledger_side",
            'vendor_bill'::"text" AS "anchor_kind",
            "vb"."company_id",
            "vb"."id" AS "anchor_id",
            "vb"."purchase_order_id" AS "operational_document_id",
            "vb"."internal_reference" AS "anchor_reference",
            "vb"."order_no" AS "operational_reference",
            "vb"."counterparty_name",
            "vb"."bill_date" AS "document_date",
            "vb"."due_date",
            "vb"."currency_code",
            COALESCE("vb"."total_amount_base", (0)::numeric) AS "original_total_base",
            COALESCE("vb"."credited_total_base", (0)::numeric) AS "credited_total_base",
            COALESCE("vb"."debited_total_base", (0)::numeric) AS "debited_total_base",
            (COALESCE("vb"."debited_total_base", (0)::numeric) - COALESCE("vb"."credited_total_base", (0)::numeric)) AS "net_adjustment_base",
            COALESCE("vb"."current_legal_total_base", (0)::numeric) AS "current_legal_total_base",
            COALESCE("vb"."settled_base", (0)::numeric) AS "settled_base",
            (COALESCE("vb"."current_legal_total_base", (0)::numeric) - COALESCE("vb"."settled_base", (0)::numeric)) AS "raw_outstanding_base",
            COALESCE("vb"."outstanding_base", (0)::numeric) AS "outstanding_base",
            GREATEST((COALESCE("vb"."settled_base", (0)::numeric) - COALESCE("vb"."current_legal_total_base", (0)::numeric)), (0)::numeric) AS "over_settled_base",
            "vb"."document_workflow_status",
            "vb"."approval_status",
            "vb"."adjustment_status",
            "vb"."credit_status",
            "vb"."settlement_status",
            "vb"."resolution_status",
            COALESCE("vb"."duplicate_supplier_reference_exists", false) AS "duplicate_reference_flag"
           FROM "public"."v_vendor_bill_state" "vb"
          WHERE ("vb"."document_workflow_status" = 'posted'::"text")
        ), "annotated" AS (
         SELECT "anchor_rows"."ledger_side",
            "anchor_rows"."anchor_kind",
            "anchor_rows"."company_id",
            "anchor_rows"."anchor_id",
            "anchor_rows"."operational_document_id",
            "anchor_rows"."anchor_reference",
            "anchor_rows"."operational_reference",
            "anchor_rows"."counterparty_name",
            "anchor_rows"."document_date",
            "anchor_rows"."due_date",
            "anchor_rows"."currency_code",
            "anchor_rows"."original_total_base",
            "anchor_rows"."credited_total_base",
            "anchor_rows"."debited_total_base",
            "anchor_rows"."net_adjustment_base",
            "anchor_rows"."current_legal_total_base",
            "anchor_rows"."settled_base",
            "anchor_rows"."raw_outstanding_base",
            "anchor_rows"."outstanding_base",
            "anchor_rows"."over_settled_base",
            "anchor_rows"."document_workflow_status",
            "anchor_rows"."approval_status",
            "anchor_rows"."adjustment_status",
            "anchor_rows"."credit_status",
            "anchor_rows"."settlement_status",
            "anchor_rows"."resolution_status",
            "anchor_rows"."duplicate_reference_flag",
                CASE
                    WHEN (COALESCE("anchor_rows"."outstanding_base", (0)::numeric) <= 0.005) THEN 'resolved'::"text"
                    WHEN ("anchor_rows"."due_date" IS NULL) THEN 'undated'::"text"
                    WHEN ("anchor_rows"."due_date" < CURRENT_DATE) THEN 'overdue'::"text"
                    WHEN ("anchor_rows"."due_date" = CURRENT_DATE) THEN 'due_today'::"text"
                    WHEN ("anchor_rows"."due_date" <= (CURRENT_DATE + 7)) THEN 'due_soon'::"text"
                    ELSE 'current'::"text"
                END AS "due_position",
                CASE
                    WHEN ((COALESCE("anchor_rows"."outstanding_base", (0)::numeric) <= 0.005) OR ("anchor_rows"."due_date" IS NULL) OR ("anchor_rows"."due_date" >= CURRENT_DATE)) THEN 0
                    ELSE (CURRENT_DATE - "anchor_rows"."due_date")
                END AS "days_past_due",
                CASE
                    WHEN ((COALESCE("anchor_rows"."outstanding_base", (0)::numeric) <= 0.005) OR ("anchor_rows"."due_date" IS NULL) OR ("anchor_rows"."due_date" < CURRENT_DATE)) THEN NULL::integer
                    ELSE ("anchor_rows"."due_date" - CURRENT_DATE)
                END AS "days_until_due",
                CASE
                    WHEN (COALESCE("anchor_rows"."outstanding_base", (0)::numeric) <= 0.005) THEN 'resolved'::"text"
                    WHEN ("anchor_rows"."due_date" IS NULL) THEN 'undated'::"text"
                    WHEN ("anchor_rows"."due_date" >= CURRENT_DATE) THEN 'current'::"text"
                    WHEN ((CURRENT_DATE - "anchor_rows"."due_date") <= 30) THEN '1_30'::"text"
                    WHEN ((CURRENT_DATE - "anchor_rows"."due_date") <= 60) THEN '31_60'::"text"
                    WHEN ((CURRENT_DATE - "anchor_rows"."due_date") <= 90) THEN '61_90'::"text"
                    ELSE '91_plus'::"text"
                END AS "aging_bucket",
            "array_remove"(ARRAY[
                CASE
                    WHEN (COALESCE("anchor_rows"."current_legal_total_base", (0)::numeric) < '-0.005'::numeric) THEN 'negative_current_legal'::"text"
                    ELSE NULL::"text"
                END,
                CASE
                    WHEN (COALESCE("anchor_rows"."raw_outstanding_base", (0)::numeric) < '-0.005'::numeric) THEN 'negative_outstanding'::"text"
                    ELSE NULL::"text"
                END,
                CASE
                    WHEN (COALESCE("anchor_rows"."over_settled_base", (0)::numeric) > 0.005) THEN 'over_settled'::"text"
                    ELSE NULL::"text"
                END,
                CASE
                    WHEN ((COALESCE("anchor_rows"."outstanding_base", (0)::numeric) > 0.005) AND ("anchor_rows"."due_date" IS NULL)) THEN 'missing_due_date'::"text"
                    ELSE NULL::"text"
                END,
                CASE
                    WHEN (NULLIF("btrim"(COALESCE("anchor_rows"."counterparty_name", ''::"text")), ''::"text") IS NULL) THEN 'missing_counterparty'::"text"
                    ELSE NULL::"text"
                END,
                CASE
                    WHEN "anchor_rows"."duplicate_reference_flag" THEN 'duplicate_supplier_reference'::"text"
                    ELSE NULL::"text"
                END,
                CASE
                    WHEN ((COALESCE("anchor_rows"."outstanding_base", (0)::numeric) <= 0.005) AND ("anchor_rows"."resolution_status" = ANY (ARRAY['issued_open'::"text", 'issued_overdue'::"text", 'issued_partially_settled'::"text", 'posted_open'::"text", 'posted_overdue'::"text", 'posted_partially_settled'::"text"]))) THEN 'resolved_status_mismatch'::"text"
                    ELSE NULL::"text"
                END,
                CASE
                    WHEN ((COALESCE("anchor_rows"."outstanding_base", (0)::numeric) > 0.005) AND ("anchor_rows"."resolution_status" = ANY (ARRAY['issued_settled'::"text", 'issued_fully_credited'::"text", 'posted_settled'::"text", 'posted_fully_credited'::"text"]))) THEN 'unresolved_status_mismatch'::"text"
                    ELSE NULL::"text"
                END], NULL::"text") AS "exception_codes"
           FROM "anchor_rows"
        )
 SELECT "ledger_side",
    "anchor_kind",
    "company_id",
    "anchor_id",
    "operational_document_id",
    "anchor_reference",
    "operational_reference",
    "counterparty_name",
    "document_date",
    "due_date",
    "currency_code",
    "original_total_base",
    "credited_total_base",
    "debited_total_base",
    "net_adjustment_base",
    "current_legal_total_base",
    "settled_base",
    "raw_outstanding_base",
    "outstanding_base",
    "over_settled_base",
    "document_workflow_status",
    "approval_status",
    "adjustment_status",
    "credit_status",
    "settlement_status",
    "resolution_status",
    "due_position",
    "days_past_due",
    "days_until_due",
    "aging_bucket",
    "exception_codes",
    COALESCE("array_length"("exception_codes", 1), 0) AS "exception_count",
        CASE
            WHEN (COALESCE("array_length"("exception_codes", 1), 0) > 0) THEN 'exception'::"text"
            WHEN ("due_position" = 'overdue'::"text") THEN 'overdue'::"text"
            WHEN ("due_position" = ANY (ARRAY['due_today'::"text", 'due_soon'::"text"])) THEN 'attention'::"text"
            WHEN (COALESCE("outstanding_base", (0)::numeric) > 0.005) THEN 'open'::"text"
            ELSE 'resolved'::"text"
        END AS "review_state",
    ((COALESCE("array_length"("exception_codes", 1), 0) > 0) OR (COALESCE("outstanding_base", (0)::numeric) > 0.005)) AS "needs_review"
   FROM "annotated";


ALTER VIEW "public"."v_finance_reconciliation_review" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_finance_reconciliation_review" IS 'Phase 3A review register for AR/AP reconciliation. Exposes original, adjustment, current legal, settled, outstanding, due, aging, and review-state fields at the active finance anchor.';



CREATE OR REPLACE VIEW "public"."v_purchase_order_state" WITH ("security_invoker"='true') AS
 WITH "receive_rollup" AS (
         SELECT "sm"."ref_id" AS "po_id_text",
            ("count"(*))::integer AS "receive_count"
           FROM "public"."stock_movements" "sm"
          WHERE (("sm"."ref_type" = 'PO'::"text") AND ("sm"."type" = 'receive'::"text"))
          GROUP BY "sm"."ref_id"
        ), "cash_rollup" AS (
         SELECT "ct"."company_id",
            "ct"."ref_id" AS "po_id",
            COALESCE("sum"(("ct"."amount_base" * ('-1'::integer)::numeric)), (0)::numeric) AS "settled_base"
           FROM "public"."cash_transactions" "ct"
          WHERE (("ct"."ref_type" = 'PO'::"text") AND ("ct"."type" = 'purchase_payment'::"text"))
          GROUP BY "ct"."company_id", "ct"."ref_id"
        ), "bank_rollup" AS (
         SELECT "bt"."ref_id" AS "po_id",
            COALESCE("sum"(("bt"."amount_base" * ('-1'::integer)::numeric)), (0)::numeric) AS "settled_base"
           FROM "public"."bank_transactions" "bt"
          WHERE ("bt"."ref_type" = 'PO'::"text")
          GROUP BY "bt"."ref_id"
        ), "bill_rollup" AS (
         SELECT "vb"."purchase_order_id",
            "bool_or"(("vb"."document_workflow_status" = 'draft'::"text")) AS "has_draft_bill",
            "bool_or"(("vb"."document_workflow_status" = 'posted'::"text")) AS "has_posted_bill"
           FROM "public"."vendor_bills" "vb"
          WHERE (("vb"."purchase_order_id" IS NOT NULL) AND ("vb"."document_workflow_status" <> 'voided'::"text"))
          GROUP BY "vb"."purchase_order_id"
        ), "posted_bill_anchor" AS (
         SELECT DISTINCT ON ("vb"."purchase_order_id") "vb"."purchase_order_id",
            "vb"."id" AS "financial_anchor_document_id",
            COALESCE(NULLIF("vb"."supplier_invoice_reference", ''::"text"), "vb"."internal_reference") AS "financial_anchor_reference"
           FROM "public"."vendor_bills" "vb"
          WHERE (("vb"."purchase_order_id" IS NOT NULL) AND ("vb"."document_workflow_status" = 'posted'::"text"))
          ORDER BY "vb"."purchase_order_id", "vb"."posted_at" DESC NULLS LAST, "vb"."created_at" DESC, "vb"."id" DESC
        )
 SELECT "po"."id",
    "po"."company_id",
    "po"."order_no",
    "lower"(("po"."status")::"text") AS "legacy_status",
        CASE
            WHEN ("lower"(("po"."status")::"text") = 'draft'::"text") THEN 'draft'::"text"
            WHEN ("lower"(("po"."status")::"text") = ANY (ARRAY['cancelled'::"text", 'canceled'::"text"])) THEN 'cancelled'::"text"
            ELSE 'approved'::"text"
        END AS "workflow_status",
        CASE
            WHEN ("lower"(("po"."status")::"text") = ANY (ARRAY['cancelled'::"text", 'canceled'::"text"])) THEN 'not_started'::"text"
            WHEN ("lower"(("po"."status")::"text") = 'closed'::"text") THEN 'complete'::"text"
            WHEN ("lower"(("po"."status")::"text") = 'partially_received'::"text") THEN 'partial'::"text"
            WHEN (COALESCE("rr"."receive_count", 0) > 0) THEN 'partial'::"text"
            ELSE 'not_started'::"text"
        END AS "receipt_status",
        CASE
            WHEN COALESCE("brl"."has_posted_bill", false) THEN 'posted'::"text"
            WHEN COALESCE("brl"."has_draft_bill", false) THEN 'draft'::"text"
            ELSE NULL::"text"
        END AS "billing_status",
    COALESCE("po"."order_date", (("po"."created_at" AT TIME ZONE 'utc'::"text"))::"date") AS "order_date",
    COALESCE("po"."due_date", "po"."expected_date") AS "due_date",
    COALESCE(NULLIF("po"."supplier_name", ''::"text"), NULLIF("po"."supplier", ''::"text")) AS "counterparty_name",
    COALESCE("po"."currency_code", 'MZN'::"bpchar") AS "currency_code",
    COALESCE("po"."fx_to_base", (1)::numeric) AS "fx_to_base",
    COALESCE("po"."subtotal", (0)::numeric) AS "subtotal_amount_ccy",
    COALESCE("po"."tax_total", GREATEST((COALESCE("po"."total", (0)::numeric) - COALESCE("po"."subtotal", (0)::numeric)), (0)::numeric)) AS "tax_amount_ccy",
    COALESCE("po"."total", (COALESCE("po"."subtotal", (0)::numeric) + COALESCE("po"."tax_total", (0)::numeric))) AS "total_amount_ccy",
    (COALESCE("po"."total", (COALESCE("po"."subtotal", (0)::numeric) + COALESCE("po"."tax_total", (0)::numeric))) * COALESCE("po"."fx_to_base", (1)::numeric)) AS "total_amount_base",
    COALESCE("cr"."settled_base", (0)::numeric) AS "legacy_cash_settled_base",
    COALESCE("br"."settled_base", (0)::numeric) AS "legacy_bank_settled_base",
    (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric)) AS "legacy_paid_base",
        CASE
            WHEN ("pba"."financial_anchor_document_id" IS NOT NULL) THEN (0)::numeric
            ELSE GREATEST(((COALESCE("po"."total", (COALESCE("po"."subtotal", (0)::numeric) + COALESCE("po"."tax_total", (0)::numeric))) * COALESCE("po"."fx_to_base", (1)::numeric)) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric)
        END AS "legacy_outstanding_base",
        CASE
            WHEN ("pba"."financial_anchor_document_id" IS NOT NULL) THEN 'settled'::"text"
            WHEN (GREATEST(((COALESCE("po"."total", (COALESCE("po"."subtotal", (0)::numeric) + COALESCE("po"."tax_total", (0)::numeric))) * COALESCE("po"."fx_to_base", (1)::numeric)) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric) <= 0.005) THEN 'settled'::"text"
            WHEN ((COALESCE("po"."due_date", "po"."expected_date") IS NOT NULL) AND (COALESCE("po"."due_date", "po"."expected_date") < CURRENT_DATE) AND (GREATEST(((COALESCE("po"."total", (COALESCE("po"."subtotal", (0)::numeric) + COALESCE("po"."tax_total", (0)::numeric))) * COALESCE("po"."fx_to_base", (1)::numeric)) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric) > 0.005)) THEN 'overdue'::"text"
            WHEN ((COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric)) > 0.005) THEN 'partially_settled'::"text"
            ELSE 'unsettled'::"text"
        END AS "settlement_status",
        CASE
            WHEN ("pba"."financial_anchor_document_id" IS NOT NULL) THEN 'vendor_bill'::"text"
            ELSE 'legacy_order_link'::"text"
        END AS "financial_anchor",
    "pba"."financial_anchor_document_id",
    "pba"."financial_anchor_reference"
   FROM ((((("public"."purchase_orders" "po"
     LEFT JOIN "receive_rollup" "rr" ON (("rr"."po_id_text" = ("po"."id")::"text")))
     LEFT JOIN "cash_rollup" "cr" ON ((("cr"."po_id" = "po"."id") AND ("cr"."company_id" = "po"."company_id"))))
     LEFT JOIN "bank_rollup" "br" ON (("br"."po_id" = "po"."id")))
     LEFT JOIN "bill_rollup" "brl" ON (("brl"."purchase_order_id" = "po"."id")))
     LEFT JOIN "posted_bill_anchor" "pba" ON (("pba"."purchase_order_id" = "po"."id")));


ALTER VIEW "public"."v_purchase_order_state" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_purchase_order_state" IS 'Order read model for workflow visibility. Once a posted vendor bill exists, settlement anchoring transfers to the bill and the order no longer carries the primary open balance.';



CREATE OR REPLACE VIEW "public"."v_sales_order_state" WITH ("security_invoker"='true') AS
 WITH "line_rollup" AS (
         SELECT "sol"."so_id",
            COALESCE("sum"(COALESCE("sol"."qty", (0)::numeric)), (0)::numeric) AS "ordered_qty",
            COALESCE("sum"(COALESCE("sol"."shipped_qty", (0)::numeric)), (0)::numeric) AS "shipped_qty"
           FROM "public"."sales_order_lines" "sol"
          GROUP BY "sol"."so_id"
        ), "cash_rollup" AS (
         SELECT "ct"."company_id",
            "ct"."ref_id" AS "so_id",
            COALESCE("sum"("ct"."amount_base"), (0)::numeric) AS "settled_base"
           FROM "public"."cash_transactions" "ct"
          WHERE (("ct"."ref_type" = 'SO'::"text") AND ("ct"."type" = 'sale_receipt'::"text"))
          GROUP BY "ct"."company_id", "ct"."ref_id"
        ), "bank_rollup" AS (
         SELECT "bt"."ref_id" AS "so_id",
            COALESCE("sum"("bt"."amount_base"), (0)::numeric) AS "settled_base"
           FROM "public"."bank_transactions" "bt"
          WHERE ("bt"."ref_type" = 'SO'::"text")
          GROUP BY "bt"."ref_id"
        ), "invoice_rollup" AS (
         SELECT "si"."sales_order_id",
            "bool_or"(("si"."document_workflow_status" = 'draft'::"text")) AS "has_draft_invoice",
            "bool_or"(("si"."document_workflow_status" = 'issued'::"text")) AS "has_issued_invoice"
           FROM "public"."sales_invoices" "si"
          WHERE (("si"."sales_order_id" IS NOT NULL) AND ("si"."document_workflow_status" <> 'voided'::"text"))
          GROUP BY "si"."sales_order_id"
        ), "issued_invoice_anchor" AS (
         SELECT DISTINCT ON ("si"."sales_order_id") "si"."sales_order_id",
            "si"."id" AS "financial_anchor_document_id",
            "si"."internal_reference" AS "financial_anchor_reference"
           FROM "public"."sales_invoices" "si"
          WHERE (("si"."sales_order_id" IS NOT NULL) AND ("si"."document_workflow_status" = 'issued'::"text"))
          ORDER BY "si"."sales_order_id", "si"."issued_at" DESC NULLS LAST, "si"."created_at" DESC, "si"."id" DESC
        )
 SELECT "so"."id",
    "so"."company_id",
    "so"."order_no",
    "lower"(("so"."status")::"text") AS "legacy_status",
        CASE
            WHEN ("lower"(("so"."status")::"text") = 'draft'::"text") THEN 'draft'::"text"
            WHEN ("lower"(("so"."status")::"text") = 'submitted'::"text") THEN 'awaiting_approval'::"text"
            WHEN ("lower"(("so"."status")::"text") = ANY (ARRAY['confirmed'::"text", 'allocated'::"text", 'shipped'::"text", 'closed'::"text"])) THEN 'approved'::"text"
            WHEN ("lower"(("so"."status")::"text") = ANY (ARRAY['cancelled'::"text", 'canceled'::"text"])) THEN 'cancelled'::"text"
            ELSE 'approved'::"text"
        END AS "workflow_status",
        CASE
            WHEN ("lower"(("so"."status")::"text") = ANY (ARRAY['cancelled'::"text", 'canceled'::"text"])) THEN 'not_started'::"text"
            WHEN ("lower"(("so"."status")::"text") = ANY (ARRAY['shipped'::"text", 'closed'::"text"])) THEN 'complete'::"text"
            WHEN (COALESCE("lr"."ordered_qty", (0)::numeric) <= (0)::numeric) THEN 'not_started'::"text"
            WHEN (COALESCE("lr"."shipped_qty", (0)::numeric) <= (0)::numeric) THEN 'not_started'::"text"
            WHEN ((COALESCE("lr"."shipped_qty", (0)::numeric) + 0.000001) < COALESCE("lr"."ordered_qty", (0)::numeric)) THEN 'partial'::"text"
            ELSE 'complete'::"text"
        END AS "fulfilment_status",
        CASE
            WHEN COALESCE("ir"."has_issued_invoice", false) THEN 'issued'::"text"
            WHEN COALESCE("ir"."has_draft_invoice", false) THEN 'draft'::"text"
            ELSE NULL::"text"
        END AS "invoicing_status",
    COALESCE("so"."order_date", (("so"."created_at" AT TIME ZONE 'utc'::"text"))::"date") AS "order_date",
    "so"."due_date",
    COALESCE(NULLIF("so"."bill_to_name", ''::"text"), NULLIF("so"."customer", ''::"text")) AS "counterparty_name",
    COALESCE("so"."currency_code", 'MZN'::"bpchar") AS "currency_code",
    COALESCE("so"."fx_to_base", (1)::numeric) AS "fx_to_base",
    COALESCE("so"."total_amount", (0)::numeric) AS "subtotal_amount_ccy",
    COALESCE("so"."tax_total", (0)::numeric) AS "tax_amount_ccy",
    (COALESCE("so"."total_amount", (0)::numeric) + COALESCE("so"."tax_total", (0)::numeric)) AS "total_amount_ccy",
    ((COALESCE("so"."total_amount", (0)::numeric) + COALESCE("so"."tax_total", (0)::numeric)) * COALESCE("so"."fx_to_base", (1)::numeric)) AS "total_amount_base",
    COALESCE("cr"."settled_base", (0)::numeric) AS "legacy_cash_settled_base",
    COALESCE("br"."settled_base", (0)::numeric) AS "legacy_bank_settled_base",
    (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric)) AS "legacy_settled_base",
        CASE
            WHEN ("iia"."financial_anchor_document_id" IS NOT NULL) THEN (0)::numeric
            ELSE GREATEST((((COALESCE("so"."total_amount", (0)::numeric) + COALESCE("so"."tax_total", (0)::numeric)) * COALESCE("so"."fx_to_base", (1)::numeric)) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric)
        END AS "legacy_outstanding_base",
        CASE
            WHEN ("iia"."financial_anchor_document_id" IS NOT NULL) THEN 'settled'::"text"
            WHEN (GREATEST((((COALESCE("so"."total_amount", (0)::numeric) + COALESCE("so"."tax_total", (0)::numeric)) * COALESCE("so"."fx_to_base", (1)::numeric)) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric) <= 0.005) THEN 'settled'::"text"
            WHEN (("so"."due_date" IS NOT NULL) AND ("so"."due_date" < CURRENT_DATE) AND (GREATEST((((COALESCE("so"."total_amount", (0)::numeric) + COALESCE("so"."tax_total", (0)::numeric)) * COALESCE("so"."fx_to_base", (1)::numeric)) - (COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric))), (0)::numeric) > 0.005)) THEN 'overdue'::"text"
            WHEN ((COALESCE("cr"."settled_base", (0)::numeric) + COALESCE("br"."settled_base", (0)::numeric)) > 0.005) THEN 'partially_settled'::"text"
            ELSE 'unsettled'::"text"
        END AS "settlement_status",
        CASE
            WHEN ("iia"."financial_anchor_document_id" IS NOT NULL) THEN 'sales_invoice'::"text"
            ELSE 'legacy_order_link'::"text"
        END AS "financial_anchor",
    "iia"."financial_anchor_document_id",
    "iia"."financial_anchor_reference"
   FROM ((((("public"."sales_orders" "so"
     LEFT JOIN "line_rollup" "lr" ON (("lr"."so_id" = "so"."id")))
     LEFT JOIN "cash_rollup" "cr" ON ((("cr"."so_id" = "so"."id") AND ("cr"."company_id" = "so"."company_id"))))
     LEFT JOIN "bank_rollup" "br" ON (("br"."so_id" = "so"."id")))
     LEFT JOIN "invoice_rollup" "ir" ON (("ir"."sales_order_id" = "so"."id")))
     LEFT JOIN "issued_invoice_anchor" "iia" ON (("iia"."sales_order_id" = "so"."id")));


ALTER VIEW "public"."v_sales_order_state" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_sales_order_state" IS 'Order read model for workflow visibility. Once an issued sales invoice exists, settlement anchoring transfers to the invoice and the order no longer carries the primary open balance.';



CREATE OR REPLACE VIEW "public"."v_finance_reconciliation_exceptions" WITH ("security_invoker"='true') AS
 WITH "review_flags" AS (
         SELECT "review"."company_id",
            "review"."ledger_side",
            "review"."anchor_kind",
            "review"."anchor_id",
            "review"."operational_document_id",
            "review"."anchor_reference",
            "review"."operational_reference",
            "review"."counterparty_name",
            "review"."document_date",
            "review"."due_date",
            "review"."current_legal_total_base",
            "review"."settled_base",
            "review"."raw_outstanding_base",
            "review"."outstanding_base",
            "code"."exception_code"
           FROM ("public"."v_finance_reconciliation_review" "review"
             JOIN LATERAL "unnest"(COALESCE("review"."exception_codes", ARRAY[]::"text"[])) "code"("exception_code") ON (true))
        ), "approved_sales_invoice_drafts" AS (
         SELECT "si"."company_id",
            'AR'::"text" AS "ledger_side",
            'sales_invoice_draft'::"text" AS "anchor_kind",
            "si"."id" AS "anchor_id",
            "si"."sales_order_id" AS "operational_document_id",
            "si"."internal_reference" AS "anchor_reference",
            "so"."order_no" AS "operational_reference",
            COALESCE(NULLIF("c"."name", ''::"text"), NULLIF("so"."bill_to_name", ''::"text"), NULLIF("so"."customer", ''::"text")) AS "counterparty_name",
            "si"."invoice_date" AS "document_date",
            "si"."due_date",
            "public"."sales_invoice_issue_readiness_mz"("si"."id") AS "readiness"
           FROM (("public"."sales_invoices" "si"
             LEFT JOIN "public"."sales_orders" "so" ON (("so"."id" = "si"."sales_order_id")))
             LEFT JOIN "public"."customers" "c" ON (("c"."id" = "si"."customer_id")))
          WHERE (("si"."document_workflow_status" = 'draft'::"text") AND (COALESCE("si"."approval_status", 'draft'::"text") = 'approved'::"text") AND ("si"."company_id" = "public"."current_company_id"()))
        ), "approved_sales_invoice_blockers" AS (
         SELECT "draft"."company_id",
            "draft"."ledger_side",
            "draft"."anchor_kind",
            "draft"."anchor_id",
            "draft"."operational_document_id",
            "draft"."anchor_reference",
            "draft"."operational_reference",
            "draft"."counterparty_name",
            "draft"."document_date",
            "draft"."due_date",
            NULL::numeric AS "current_legal_total_base",
            NULL::numeric AS "settled_base",
            NULL::numeric AS "raw_outstanding_base",
            NULL::numeric AS "outstanding_base",
            "blocker"."exception_code"
           FROM ("approved_sales_invoice_drafts" "draft"
             JOIN LATERAL "jsonb_array_elements_text"(COALESCE(("draft"."readiness" -> 'blockers'::"text"), '[]'::"jsonb")) "blocker"("exception_code") ON (true))
          WHERE (COALESCE((("draft"."readiness" ->> 'can_issue'::"text"))::boolean, false) = false)
        ), "broken_sales_order_chain" AS (
         SELECT "so"."company_id",
            'AR'::"text" AS "ledger_side",
            'sales_order'::"text" AS "anchor_kind",
            "so"."id" AS "anchor_id",
            "so"."id" AS "operational_document_id",
            "so"."order_no" AS "anchor_reference",
            "so"."order_no" AS "operational_reference",
            "so"."counterparty_name",
            "so"."order_date" AS "document_date",
            "so"."due_date",
            NULL::numeric AS "current_legal_total_base",
            NULL::numeric AS "settled_base",
            NULL::numeric AS "raw_outstanding_base",
            NULL::numeric AS "outstanding_base",
            'missing_finance_anchor'::"text" AS "exception_code"
           FROM "public"."v_sales_order_state" "so"
          WHERE (("so"."financial_anchor" = 'legacy_order_link'::"text") AND ("so"."company_id" = "public"."current_company_id"()) AND (COALESCE("so"."invoicing_status", ''::"text") = 'issued'::"text"))
        ), "broken_purchase_order_chain" AS (
         SELECT "po"."company_id",
            'AP'::"text" AS "ledger_side",
            'purchase_order'::"text" AS "anchor_kind",
            "po"."id" AS "anchor_id",
            "po"."id" AS "operational_document_id",
            "po"."order_no" AS "anchor_reference",
            "po"."order_no" AS "operational_reference",
            "po"."counterparty_name",
            "po"."order_date" AS "document_date",
            "po"."due_date",
            NULL::numeric AS "current_legal_total_base",
            NULL::numeric AS "settled_base",
            NULL::numeric AS "raw_outstanding_base",
            NULL::numeric AS "outstanding_base",
            'missing_finance_anchor'::"text" AS "exception_code"
           FROM "public"."v_purchase_order_state" "po"
          WHERE (("po"."financial_anchor" = 'legacy_order_link'::"text") AND ("po"."company_id" = "public"."current_company_id"()) AND (COALESCE("po"."billing_status", ''::"text") = 'posted'::"text"))
        )
 SELECT "company_id",
    "ledger_side",
    "anchor_kind",
    "anchor_id",
    "operational_document_id",
    "anchor_reference",
    "operational_reference",
    "counterparty_name",
    "document_date",
    "due_date",
    "current_legal_total_base",
    "settled_base",
    "raw_outstanding_base",
    "outstanding_base",
    "exception_code",
        CASE
            WHEN ("exception_code" = ANY (ARRAY['negative_current_legal'::"text", 'negative_outstanding'::"text", 'unresolved_status_mismatch'::"text", 'missing_finance_anchor'::"text", 'company_fiscal_settings_missing'::"text", 'sales_invoice_issue_requires_seller_snapshot'::"text", 'sales_invoice_issue_requires_buyer_snapshot'::"text", 'sales_invoice_issue_requires_document_language'::"text", 'sales_invoice_issue_requires_computer_phrase'::"text", 'sales_invoice_issue_missing_fiscal_identity'::"text", 'sales_invoice_issue_series_mismatch'::"text", 'sales_invoice_issue_invalid_totals'::"text", 'sales_invoice_issue_requires_lines'::"text"])) THEN 'critical'::"text"
            ELSE 'warning'::"text"
        END AS "severity",
        CASE
            WHEN ("exception_code" = ANY (ARRAY['company_fiscal_settings_missing'::"text", 'sales_invoice_issue_requires_seller_snapshot'::"text", 'sales_invoice_issue_requires_buyer_snapshot'::"text", 'sales_invoice_issue_requires_document_language'::"text", 'sales_invoice_issue_requires_computer_phrase'::"text", 'sales_invoice_issue_missing_fiscal_identity'::"text", 'sales_invoice_issue_series_mismatch'::"text", 'sales_invoice_issue_invalid_totals'::"text", 'sales_invoice_issue_requires_lines'::"text", 'sales_invoice_issue_requires_invoice_date'::"text", 'sales_invoice_issue_requires_due_date'::"text", 'sales_invoice_issue_invalid_due_date'::"text", 'sales_invoice_issue_requires_vat_exemption_reason'::"text"])) THEN 'issue_readiness'::"text"
            WHEN ("exception_code" = 'missing_finance_anchor'::"text") THEN 'chain'::"text"
            ELSE 'bridge'::"text"
        END AS "exception_group"
   FROM ( SELECT "review_flags"."company_id",
            "review_flags"."ledger_side",
            "review_flags"."anchor_kind",
            "review_flags"."anchor_id",
            "review_flags"."operational_document_id",
            "review_flags"."anchor_reference",
            "review_flags"."operational_reference",
            "review_flags"."counterparty_name",
            "review_flags"."document_date",
            "review_flags"."due_date",
            "review_flags"."current_legal_total_base",
            "review_flags"."settled_base",
            "review_flags"."raw_outstanding_base",
            "review_flags"."outstanding_base",
            "review_flags"."exception_code"
           FROM "review_flags"
        UNION ALL
         SELECT "approved_sales_invoice_blockers"."company_id",
            "approved_sales_invoice_blockers"."ledger_side",
            "approved_sales_invoice_blockers"."anchor_kind",
            "approved_sales_invoice_blockers"."anchor_id",
            "approved_sales_invoice_blockers"."operational_document_id",
            "approved_sales_invoice_blockers"."anchor_reference",
            "approved_sales_invoice_blockers"."operational_reference",
            "approved_sales_invoice_blockers"."counterparty_name",
            "approved_sales_invoice_blockers"."document_date",
            "approved_sales_invoice_blockers"."due_date",
            "approved_sales_invoice_blockers"."current_legal_total_base",
            "approved_sales_invoice_blockers"."settled_base",
            "approved_sales_invoice_blockers"."raw_outstanding_base",
            "approved_sales_invoice_blockers"."outstanding_base",
            "approved_sales_invoice_blockers"."exception_code"
           FROM "approved_sales_invoice_blockers"
        UNION ALL
         SELECT "broken_sales_order_chain"."company_id",
            "broken_sales_order_chain"."ledger_side",
            "broken_sales_order_chain"."anchor_kind",
            "broken_sales_order_chain"."anchor_id",
            "broken_sales_order_chain"."operational_document_id",
            "broken_sales_order_chain"."anchor_reference",
            "broken_sales_order_chain"."operational_reference",
            "broken_sales_order_chain"."counterparty_name",
            "broken_sales_order_chain"."document_date",
            "broken_sales_order_chain"."due_date",
            "broken_sales_order_chain"."current_legal_total_base",
            "broken_sales_order_chain"."settled_base",
            "broken_sales_order_chain"."raw_outstanding_base",
            "broken_sales_order_chain"."outstanding_base",
            "broken_sales_order_chain"."exception_code"
           FROM "broken_sales_order_chain"
        UNION ALL
         SELECT "broken_purchase_order_chain"."company_id",
            "broken_purchase_order_chain"."ledger_side",
            "broken_purchase_order_chain"."anchor_kind",
            "broken_purchase_order_chain"."anchor_id",
            "broken_purchase_order_chain"."operational_document_id",
            "broken_purchase_order_chain"."anchor_reference",
            "broken_purchase_order_chain"."operational_reference",
            "broken_purchase_order_chain"."counterparty_name",
            "broken_purchase_order_chain"."document_date",
            "broken_purchase_order_chain"."due_date",
            "broken_purchase_order_chain"."current_legal_total_base",
            "broken_purchase_order_chain"."settled_base",
            "broken_purchase_order_chain"."raw_outstanding_base",
            "broken_purchase_order_chain"."outstanding_base",
            "broken_purchase_order_chain"."exception_code"
           FROM "broken_purchase_order_chain") "flagged";


ALTER VIEW "public"."v_finance_reconciliation_exceptions" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_finance_reconciliation_exceptions" IS 'Phase 3A exception queue for reconciliation and close review. Includes bridge anomalies, missing active anchors, and approved-draft Mozambique issue blockers that still prevent legal issue.';



CREATE OR REPLACE VIEW "public"."v_po_line_recv_summary" AS
 SELECT "pol"."id" AS "po_line_id",
    "pol"."po_id",
    "pol"."item_id",
    "sum"(
        CASE
            WHEN (("sm"."type" = 'receive'::"text") AND ("sm"."ref_type" = 'PO'::"text") AND ("sm"."ref_line_id" = "pol"."id")) THEN COALESCE("sm"."qty_base", "sm"."qty", (0)::numeric)
            ELSE (0)::numeric
        END) AS "qty_from_moves"
   FROM ("public"."purchase_order_lines" "pol"
     LEFT JOIN "public"."stock_movements" "sm" ON ((("sm"."ref_type" = 'PO'::"text") AND ("sm"."ref_line_id" = "pol"."id"))))
  GROUP BY "pol"."id", "pol"."po_id", "pol"."item_id";


ALTER VIEW "public"."v_po_line_recv_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_sales_order_totals" WITH ("security_invoker"='on') AS
 SELECT "id",
    "status",
    "currency_code",
    COALESCE("fx_to_base", (1)::numeric) AS "fx_to_base",
    "created_at",
    "updated_at",
    COALESCE("total_amount", ( SELECT COALESCE("sum"("l"."line_total"), (0)::numeric) AS "coalesce"
           FROM "public"."sales_order_lines" "l"
          WHERE ("l"."so_id" = "so"."id"))) AS "total_amount_order_currency",
    (COALESCE("total_amount", ( SELECT COALESCE("sum"("l"."line_total"), (0)::numeric) AS "coalesce"
           FROM "public"."sales_order_lines" "l"
          WHERE ("l"."so_id" = "so"."id"))) * COALESCE("fx_to_base", (1)::numeric)) AS "total_amount_base"
   FROM "public"."sales_orders" "so"
  WHERE ("company_id" = "public"."current_company_id"());


ALTER VIEW "public"."v_sales_order_totals" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_revenue_daily" WITH ("security_invoker"='on') AS
 SELECT (((COALESCE("so"."updated_at", "so"."created_at") AT TIME ZONE 'UTC'::"text") AT TIME ZONE 'Africa/Maputo'::"text"))::"date" AS "day",
    "sum"("t"."total_amount_base") AS "revenue_base"
   FROM ("public"."v_sales_order_totals" "t"
     JOIN "public"."sales_orders" "so" ON (("so"."id" = "t"."id")))
  WHERE (("lower"(("so"."status")::"text") = ANY (ARRAY['shipped'::"text", 'completed'::"text", 'delivered'::"text", 'closed'::"text"])) AND ("so"."company_id" = "public"."current_company_id"()))
  GROUP BY ((((COALESCE("so"."updated_at", "so"."created_at") AT TIME ZONE 'UTC'::"text") AT TIME ZONE 'Africa/Maputo'::"text"))::"date")
  ORDER BY ((((COALESCE("so"."updated_at", "so"."created_at") AT TIME ZONE 'UTC'::"text") AT TIME ZONE 'Africa/Maputo'::"text"))::"date");


ALTER VIEW "public"."v_revenue_daily" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_revenue_summary" WITH ("security_invoker"='true') AS
 WITH "base" AS (
         SELECT (((COALESCE("so"."updated_at", "so"."created_at") AT TIME ZONE 'UTC'::"text") AT TIME ZONE 'Africa/Maputo'::"text"))::"date" AS "d",
            "t"."total_amount_base" AS "rev"
           FROM ("public"."v_sales_order_totals" "t"
             JOIN "public"."sales_orders" "so" ON (("so"."id" = "t"."id")))
          WHERE (("lower"(("so"."status")::"text") = ANY (ARRAY['shipped'::"text", 'closed'::"text"])) AND ("so"."company_id" = "public"."current_company_id"()))
        )
 SELECT COALESCE(( SELECT "sum"("base"."rev") AS "sum"
           FROM "base"
          WHERE ("base"."d" = CURRENT_DATE)), (0)::numeric) AS "today",
    COALESCE(( SELECT "sum"("base"."rev") AS "sum"
           FROM "base"
          WHERE ("date_trunc"('month'::"text", ("base"."d")::timestamp without time zone) = "date_trunc"('month'::"text", (CURRENT_DATE)::timestamp without time zone))), (0)::numeric) AS "mtd",
    COALESCE(( SELECT "sum"("base"."rev") AS "sum"
           FROM "base"
          WHERE ("date_trunc"('year'::"text", ("base"."d")::timestamp without time zone) = "date_trunc"('year'::"text", (CURRENT_DATE)::timestamp without time zone))), (0)::numeric) AS "ytd",
    COALESCE(( SELECT "sum"("base"."rev") AS "sum"
           FROM "base"), (0)::numeric) AS "all_time";


ALTER VIEW "public"."v_revenue_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_saft_moz_master_company" WITH ("security_invoker"='true') AS
 SELECT "c"."id" AS "company_id",
    "cfs"."jurisdiction_code",
    COALESCE(NULLIF("c"."legal_name", ''::"text"), NULLIF("c"."trade_name", ''::"text"), "c"."name") AS "legal_name",
    COALESCE(NULLIF("c"."trade_name", ''::"text"), "c"."name") AS "trade_name",
    "c"."tax_id" AS "nuit",
    "c"."address_line1",
    "c"."address_line2",
    "c"."city",
    "c"."state",
    "c"."postal_code",
    "c"."country_code",
    "cfs"."document_language_code",
    "cfs"."presentation_currency_code",
    "cfs"."compliance_rule_version",
    "cfs"."invoice_series_code",
    "cfs"."credit_note_series_code",
    "cfs"."debit_note_series_code",
    "cfs"."homologation_reference"
   FROM ("public"."companies" "c"
     JOIN "public"."company_fiscal_settings" "cfs" ON (("cfs"."company_id" = "c"."id")))
  WHERE ("cfs"."jurisdiction_code" = 'MZ'::"text");


ALTER VIEW "public"."v_saft_moz_master_company" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_saft_moz_master_customers" WITH ("security_invoker"='true') AS
 WITH "customer_snapshots" AS (
         SELECT "si"."company_id",
            "si"."customer_id",
            COALESCE(("si"."customer_id")::"text", "md5"(((COALESCE("si"."buyer_legal_name_snapshot", ''::"text") || '|'::"text") || COALESCE("si"."buyer_nuit_snapshot", ''::"text")))) AS "customer_key",
            "si"."buyer_legal_name_snapshot" AS "customer_name",
            "si"."buyer_nuit_snapshot" AS "customer_nuit",
            "si"."buyer_address_line1_snapshot" AS "address_line1",
            "si"."buyer_address_line2_snapshot" AS "address_line2",
            "si"."buyer_city_snapshot" AS "city",
            "si"."buyer_state_snapshot" AS "state",
            "si"."buyer_postal_code_snapshot" AS "postal_code",
            "si"."buyer_country_code_snapshot" AS "country_code",
            "si"."invoice_date" AS "document_date",
            ("si"."id")::"text" AS "document_id"
           FROM "public"."sales_invoices" "si"
          WHERE ("si"."document_workflow_status" = 'issued'::"text")
        UNION ALL
         SELECT "scn"."company_id",
            "scn"."customer_id",
            COALESCE(("scn"."customer_id")::"text", "md5"(((COALESCE("scn"."buyer_legal_name_snapshot", ''::"text") || '|'::"text") || COALESCE("scn"."buyer_nuit_snapshot", ''::"text")))) AS "coalesce",
            "scn"."buyer_legal_name_snapshot",
            "scn"."buyer_nuit_snapshot",
            "scn"."buyer_address_line1_snapshot",
            "scn"."buyer_address_line2_snapshot",
            "scn"."buyer_city_snapshot",
            "scn"."buyer_state_snapshot",
            "scn"."buyer_postal_code_snapshot",
            "scn"."buyer_country_code_snapshot",
            "scn"."credit_note_date",
            ("scn"."id")::"text" AS "id"
           FROM "public"."sales_credit_notes" "scn"
          WHERE ("scn"."document_workflow_status" = 'issued'::"text")
        UNION ALL
         SELECT "sdn"."company_id",
            "sdn"."customer_id",
            COALESCE(("sdn"."customer_id")::"text", "md5"(((COALESCE("sdn"."buyer_legal_name_snapshot", ''::"text") || '|'::"text") || COALESCE("sdn"."buyer_nuit_snapshot", ''::"text")))) AS "coalesce",
            "sdn"."buyer_legal_name_snapshot",
            "sdn"."buyer_nuit_snapshot",
            "sdn"."buyer_address_line1_snapshot",
            "sdn"."buyer_address_line2_snapshot",
            "sdn"."buyer_city_snapshot",
            "sdn"."buyer_state_snapshot",
            "sdn"."buyer_postal_code_snapshot",
            "sdn"."buyer_country_code_snapshot",
            "sdn"."debit_note_date",
            ("sdn"."id")::"text" AS "id"
           FROM "public"."sales_debit_notes" "sdn"
          WHERE ("sdn"."document_workflow_status" = 'issued'::"text")
        ), "ranked_customer_snapshots" AS (
         SELECT "cs"."company_id",
            "cs"."customer_id",
            "cs"."customer_key",
            "cs"."customer_name",
            "cs"."customer_nuit",
            "cs"."address_line1",
            "cs"."address_line2",
            "cs"."city",
            "cs"."state",
            "cs"."postal_code",
            "cs"."country_code",
            "cs"."document_date",
            "cs"."document_id",
            "row_number"() OVER (PARTITION BY "cs"."company_id", "cs"."customer_key" ORDER BY "cs"."document_date" DESC, "cs"."document_id" DESC) AS "row_no"
           FROM "customer_snapshots" "cs"
          WHERE (NULLIF("btrim"(COALESCE("cs"."customer_name", ''::"text")), ''::"text") IS NOT NULL)
        )
 SELECT "company_id",
    "customer_id",
    "customer_name",
    "customer_nuit",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "country_code"
   FROM "ranked_customer_snapshots" "rcs"
  WHERE ("row_no" = 1);


ALTER VIEW "public"."v_saft_moz_master_customers" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_saft_moz_master_products" WITH ("security_invoker"='true') AS
 WITH "product_snapshots" AS (
         SELECT "si"."company_id",
            "sil"."product_code_snapshot" AS "product_code",
            "sil"."description",
            "sil"."unit_of_measure_snapshot" AS "unit_of_measure",
            "si"."invoice_date" AS "document_date",
            ("sil"."id")::"text" AS "line_id"
           FROM ("public"."sales_invoice_lines" "sil"
             JOIN "public"."sales_invoices" "si" ON (("si"."id" = "sil"."sales_invoice_id")))
          WHERE ("si"."document_workflow_status" = 'issued'::"text")
        UNION ALL
         SELECT "scn"."company_id",
            "scnl"."product_code_snapshot",
            "scnl"."description",
            "scnl"."unit_of_measure_snapshot",
            "scn"."credit_note_date",
            ("scnl"."id")::"text" AS "id"
           FROM ("public"."sales_credit_note_lines" "scnl"
             JOIN "public"."sales_credit_notes" "scn" ON (("scn"."id" = "scnl"."sales_credit_note_id")))
          WHERE ("scn"."document_workflow_status" = 'issued'::"text")
        UNION ALL
         SELECT "sdn"."company_id",
            "sdnl"."product_code_snapshot",
            "sdnl"."description",
            "sdnl"."unit_of_measure_snapshot",
            "sdn"."debit_note_date",
            ("sdnl"."id")::"text" AS "id"
           FROM ("public"."sales_debit_note_lines" "sdnl"
             JOIN "public"."sales_debit_notes" "sdn" ON (("sdn"."id" = "sdnl"."sales_debit_note_id")))
          WHERE ("sdn"."document_workflow_status" = 'issued'::"text")
        ), "ranked_product_snapshots" AS (
         SELECT "ps"."company_id",
            "ps"."product_code",
            "ps"."description",
            "ps"."unit_of_measure",
            "ps"."document_date",
            "ps"."line_id",
            "row_number"() OVER (PARTITION BY "ps"."company_id", "ps"."product_code" ORDER BY "ps"."document_date" DESC, "ps"."line_id" DESC) AS "row_no"
           FROM "product_snapshots" "ps"
          WHERE (NULLIF("btrim"(COALESCE("ps"."product_code", ''::"text")), ''::"text") IS NOT NULL)
        )
 SELECT "company_id",
    "product_code",
    "description",
    "unit_of_measure"
   FROM "ranked_product_snapshots" "rps"
  WHERE ("row_no" = 1);


ALTER VIEW "public"."v_saft_moz_master_products" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_saft_moz_master_tax_table" WITH ("security_invoker"='true') AS
 SELECT DISTINCT "company_id",
    "tax_category_code",
    "tax_rate"
   FROM ( SELECT "si"."company_id",
            "sil"."tax_category_code",
            "sil"."tax_rate"
           FROM ("public"."sales_invoice_lines" "sil"
             JOIN "public"."sales_invoices" "si" ON (("si"."id" = "sil"."sales_invoice_id")))
          WHERE ("si"."document_workflow_status" = 'issued'::"text")
        UNION ALL
         SELECT "scn"."company_id",
            "scnl"."tax_category_code",
            "scnl"."tax_rate"
           FROM ("public"."sales_credit_note_lines" "scnl"
             JOIN "public"."sales_credit_notes" "scn" ON (("scn"."id" = "scnl"."sales_credit_note_id")))
          WHERE ("scn"."document_workflow_status" = 'issued'::"text")
        UNION ALL
         SELECT "sdn"."company_id",
            "sdnl"."tax_category_code",
            "sdnl"."tax_rate"
           FROM ("public"."sales_debit_note_lines" "sdnl"
             JOIN "public"."sales_debit_notes" "sdn" ON (("sdn"."id" = "sdnl"."sales_debit_note_id")))
          WHERE ("sdn"."document_workflow_status" = 'issued'::"text")) "src"
  WHERE ("tax_category_code" IS NOT NULL);


ALTER VIEW "public"."v_saft_moz_master_tax_table" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_saft_moz_source_documents_sales_credit_note_lines" WITH ("security_invoker"='true') AS
 SELECT "scnl"."id" AS "sales_credit_note_line_id",
    "scnl"."sales_credit_note_id",
    "scn"."company_id",
    "scn"."internal_reference" AS "legal_reference",
    "scnl"."sales_invoice_line_id",
    "scnl"."item_id",
    "scnl"."sort_order",
    "scnl"."description",
    "scnl"."qty",
    "scnl"."unit_price",
    "scnl"."tax_rate",
    "scnl"."tax_amount",
    "scnl"."line_total",
    "scnl"."product_code_snapshot",
    "scnl"."unit_of_measure_snapshot",
    "scnl"."tax_category_code"
   FROM ("public"."sales_credit_note_lines" "scnl"
     JOIN "public"."sales_credit_notes" "scn" ON (("scn"."id" = "scnl"."sales_credit_note_id")))
  WHERE ("scn"."document_workflow_status" = 'issued'::"text");


ALTER VIEW "public"."v_saft_moz_source_documents_sales_credit_note_lines" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_saft_moz_source_documents_sales_credit_notes" WITH ("security_invoker"='true') AS
 SELECT "id" AS "sales_credit_note_id",
    "company_id",
    "original_sales_invoice_id",
    "customer_id",
    "internal_reference" AS "legal_reference",
    "source_origin",
    "moz_document_code",
    "fiscal_series_code",
    "fiscal_year",
    "fiscal_sequence_number",
    "credit_note_date" AS "document_date",
    "due_date",
    "currency_code",
    "fx_to_base",
    "subtotal",
    "tax_total",
    "total_amount",
    "subtotal_mzn",
    "tax_total_mzn",
    "total_amount_mzn",
    "correction_reason_code",
    "correction_reason_text",
    "seller_legal_name_snapshot",
    "seller_trade_name_snapshot",
    "seller_nuit_snapshot",
    "seller_address_line1_snapshot",
    "seller_address_line2_snapshot",
    "seller_city_snapshot",
    "seller_state_snapshot",
    "seller_postal_code_snapshot",
    "seller_country_code_snapshot",
    "buyer_legal_name_snapshot",
    "buyer_nuit_snapshot",
    "buyer_address_line1_snapshot",
    "buyer_address_line2_snapshot",
    "buyer_city_snapshot",
    "buyer_state_snapshot",
    "buyer_postal_code_snapshot",
    "buyer_country_code_snapshot",
    "document_language_code_snapshot",
    "computer_processed_phrase_snapshot",
    "compliance_rule_version_snapshot",
    "issued_at"
   FROM "public"."sales_credit_notes" "scn"
  WHERE ("document_workflow_status" = 'issued'::"text");


ALTER VIEW "public"."v_saft_moz_source_documents_sales_credit_notes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_saft_moz_source_documents_sales_debit_note_lines" WITH ("security_invoker"='true') AS
 SELECT "sdnl"."id" AS "sales_debit_note_line_id",
    "sdnl"."sales_debit_note_id",
    "sdn"."company_id",
    "sdn"."internal_reference" AS "legal_reference",
    "sdnl"."sales_invoice_line_id",
    "sdnl"."item_id",
    "sdnl"."sort_order",
    "sdnl"."description",
    "sdnl"."qty",
    "sdnl"."unit_price",
    "sdnl"."tax_rate",
    "sdnl"."tax_amount",
    "sdnl"."line_total",
    "sdnl"."product_code_snapshot",
    "sdnl"."unit_of_measure_snapshot",
    "sdnl"."tax_category_code"
   FROM ("public"."sales_debit_note_lines" "sdnl"
     JOIN "public"."sales_debit_notes" "sdn" ON (("sdn"."id" = "sdnl"."sales_debit_note_id")))
  WHERE ("sdn"."document_workflow_status" = 'issued'::"text");


ALTER VIEW "public"."v_saft_moz_source_documents_sales_debit_note_lines" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_saft_moz_source_documents_sales_debit_notes" WITH ("security_invoker"='true') AS
 SELECT "id" AS "sales_debit_note_id",
    "company_id",
    "original_sales_invoice_id",
    "customer_id",
    "internal_reference" AS "legal_reference",
    "source_origin",
    "moz_document_code",
    "fiscal_series_code",
    "fiscal_year",
    "fiscal_sequence_number",
    "debit_note_date" AS "document_date",
    "due_date",
    "currency_code",
    "fx_to_base",
    "subtotal",
    "tax_total",
    "total_amount",
    "subtotal_mzn",
    "tax_total_mzn",
    "total_amount_mzn",
    "correction_reason_code",
    "correction_reason_text",
    "seller_legal_name_snapshot",
    "seller_trade_name_snapshot",
    "seller_nuit_snapshot",
    "seller_address_line1_snapshot",
    "seller_address_line2_snapshot",
    "seller_city_snapshot",
    "seller_state_snapshot",
    "seller_postal_code_snapshot",
    "seller_country_code_snapshot",
    "buyer_legal_name_snapshot",
    "buyer_nuit_snapshot",
    "buyer_address_line1_snapshot",
    "buyer_address_line2_snapshot",
    "buyer_city_snapshot",
    "buyer_state_snapshot",
    "buyer_postal_code_snapshot",
    "buyer_country_code_snapshot",
    "document_language_code_snapshot",
    "computer_processed_phrase_snapshot",
    "compliance_rule_version_snapshot",
    "issued_at"
   FROM "public"."sales_debit_notes" "sdn"
  WHERE ("document_workflow_status" = 'issued'::"text");


ALTER VIEW "public"."v_saft_moz_source_documents_sales_debit_notes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_saft_moz_source_documents_sales_invoice_lines" WITH ("security_invoker"='true') AS
 SELECT "sil"."id" AS "sales_invoice_line_id",
    "sil"."sales_invoice_id",
    "si"."company_id",
    "si"."internal_reference" AS "legal_reference",
    "sil"."sales_order_line_id",
    "sil"."item_id",
    "sil"."sort_order",
    "sil"."description",
    "sil"."qty",
    "sil"."unit_price",
    "sil"."tax_rate",
    "sil"."tax_amount",
    "sil"."line_total",
    "sil"."product_code_snapshot",
    "sil"."unit_of_measure_snapshot",
    "sil"."tax_category_code"
   FROM ("public"."sales_invoice_lines" "sil"
     JOIN "public"."sales_invoices" "si" ON (("si"."id" = "sil"."sales_invoice_id")))
  WHERE ("si"."document_workflow_status" = 'issued'::"text");


ALTER VIEW "public"."v_saft_moz_source_documents_sales_invoice_lines" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_saft_moz_source_documents_sales_invoices" WITH ("security_invoker"='true') AS
 SELECT "id" AS "sales_invoice_id",
    "company_id",
    "sales_order_id",
    "customer_id",
    "internal_reference" AS "legal_reference",
    "source_origin",
    "moz_document_code",
    "fiscal_series_code",
    "fiscal_year",
    "fiscal_sequence_number",
    "invoice_date" AS "document_date",
    "due_date",
    "currency_code",
    "fx_to_base",
    "subtotal",
    "tax_total",
    "total_amount",
    "subtotal_mzn",
    "tax_total_mzn",
    "total_amount_mzn",
    "seller_legal_name_snapshot",
    "seller_trade_name_snapshot",
    "seller_nuit_snapshot",
    "seller_address_line1_snapshot",
    "seller_address_line2_snapshot",
    "seller_city_snapshot",
    "seller_state_snapshot",
    "seller_postal_code_snapshot",
    "seller_country_code_snapshot",
    "buyer_legal_name_snapshot",
    "buyer_nuit_snapshot",
    "buyer_address_line1_snapshot",
    "buyer_address_line2_snapshot",
    "buyer_city_snapshot",
    "buyer_state_snapshot",
    "buyer_postal_code_snapshot",
    "buyer_country_code_snapshot",
    "document_language_code_snapshot",
    "computer_processed_phrase_snapshot",
    "compliance_rule_version_snapshot",
    "issued_at"
   FROM "public"."sales_invoices" "si"
  WHERE ("document_workflow_status" = 'issued'::"text");


ALTER VIEW "public"."v_saft_moz_source_documents_sales_invoices" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_saft_moz_source_documents_summary" WITH ("security_invoker"='true') AS
 SELECT "company_id",
    "document_kind",
    "fiscal_year",
    "count"(*) AS "document_count",
    "sum"("total_amount_mzn") AS "total_amount_mzn"
   FROM ( SELECT "si"."company_id",
            'sales_invoice'::"text" AS "document_kind",
            "si"."fiscal_year",
            "si"."total_amount_mzn"
           FROM "public"."sales_invoices" "si"
          WHERE ("si"."document_workflow_status" = 'issued'::"text")
        UNION ALL
         SELECT "scn"."company_id",
            'sales_credit_note'::"text" AS "text",
            "scn"."fiscal_year",
            "scn"."total_amount_mzn"
           FROM "public"."sales_credit_notes" "scn"
          WHERE ("scn"."document_workflow_status" = 'issued'::"text")
        UNION ALL
         SELECT "sdn"."company_id",
            'sales_debit_note'::"text" AS "text",
            "sdn"."fiscal_year",
            "sdn"."total_amount_mzn"
           FROM "public"."sales_debit_notes" "sdn"
          WHERE ("sdn"."document_workflow_status" = 'issued'::"text")) "src"
  GROUP BY "company_id", "document_kind", "fiscal_year";


ALTER VIEW "public"."v_saft_moz_source_documents_summary" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_saft_moz_source_documents_summary" IS 'Extensible summary view for issued sales-side fiscal documents feeding SAF-T generation in Wave 1.';



CREATE OR REPLACE VIEW "public"."v_so_line_ship_summary" AS
 SELECT "sol"."id" AS "so_line_id",
    "sol"."so_id",
    "sol"."item_id",
    "sum"(
        CASE
            WHEN (("sm"."type" = 'issue'::"text") AND ("sm"."ref_type" = 'SO'::"text") AND ("sm"."ref_line_id" = "sol"."id")) THEN COALESCE("sm"."qty_base", "sm"."qty", (0)::numeric)
            ELSE (0)::numeric
        END) AS "qty_from_moves"
   FROM ("public"."sales_order_lines" "sol"
     LEFT JOIN "public"."stock_movements" "sm" ON ((("sm"."ref_type" = 'SO'::"text") AND ("sm"."ref_line_id" = "sol"."id"))))
  GROUP BY "sol"."id", "sol"."so_id", "sol"."item_id";


ALTER VIEW "public"."v_so_line_ship_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_credit_note_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "vendor_credit_note_id" "uuid" NOT NULL,
    "vendor_bill_line_id" "uuid",
    "item_id" "uuid",
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "qty" numeric DEFAULT 0 NOT NULL,
    "unit_cost" numeric DEFAULT 0 NOT NULL,
    "tax_rate" numeric,
    "tax_amount" numeric DEFAULT 0 NOT NULL,
    "line_total" numeric DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vendor_credit_note_lines_nonnegative_fields" CHECK ((("qty" >= (0)::numeric) AND ("unit_cost" >= (0)::numeric) AND (("tax_rate" IS NULL) OR ("tax_rate" >= (0)::numeric)) AND ("tax_amount" >= (0)::numeric) AND ("line_total" >= (0)::numeric)))
);


ALTER TABLE "public"."vendor_credit_note_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_debit_note_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "vendor_debit_note_id" "uuid" NOT NULL,
    "vendor_bill_line_id" "uuid",
    "item_id" "uuid",
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "qty" numeric DEFAULT 0 NOT NULL,
    "unit_cost" numeric DEFAULT 0 NOT NULL,
    "tax_rate" numeric,
    "tax_amount" numeric DEFAULT 0 NOT NULL,
    "line_total" numeric DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vendor_debit_note_lines_nonnegative_fields" CHECK ((("qty" >= (0)::numeric) AND ("unit_cost" >= (0)::numeric) AND (("tax_rate" IS NULL) OR ("tax_rate" >= (0)::numeric)) AND ("tax_amount" >= (0)::numeric) AND ("line_total" >= (0)::numeric)))
);


ALTER TABLE "public"."vendor_debit_note_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."warehouses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "code" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "createdAt" timestamp with time zone GENERATED ALWAYS AS ("created_at") STORED,
    "updatedAt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone GENERATED ALWAYS AS ("updatedAt") STORED,
    "address" "text",
    "company_id" "uuid"
);

ALTER TABLE ONLY "public"."warehouses" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."warehouses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_credentials" (
    "company_id" "uuid" NOT NULL,
    "waba_id" "text",
    "phone_number_id" "text" NOT NULL,
    "access_token" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."whatsapp_credentials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "target_msisdn" "text" NOT NULL,
    "category" "text" NOT NULL,
    "type" "text" NOT NULL,
    "template_name" "text",
    "template_lang" "text",
    "template_components" "jsonb",
    "body_text" "text",
    "related_type" "text",
    "related_id" "uuid",
    "scheduled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "provider_message_id" "text",
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "whatsapp_outbox_category_check" CHECK (("category" = ANY (ARRAY['utility'::"text", 'marketing'::"text"]))),
    CONSTRAINT "whatsapp_outbox_related_type_check" CHECK (("related_type" = ANY (ARRAY['PO'::"text", 'SO'::"text"]))),
    CONSTRAINT "whatsapp_outbox_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'delivered'::"text", 'read'::"text", 'failed'::"text", 'canceled'::"text"]))),
    CONSTRAINT "whatsapp_outbox_target_msisdn_check" CHECK (("target_msisdn" ~ '^\+[1-9][0-9]{7,14}$'::"text")),
    CONSTRAINT "whatsapp_outbox_type_check" CHECK (("type" = ANY (ARRAY['template'::"text", 'text'::"text"])))
);


ALTER TABLE "public"."whatsapp_outbox" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "provider_message_id" "text",
    "event_type" "text" NOT NULL,
    "event" "jsonb" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."whatsapp_webhook_events" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_ops_allowlist" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ai_ops_allowlist_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."digest_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."digest_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."digest_queue" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."digest_queue_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."due_reminder_queue" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."due_reminder_queue_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ai_command_log"
    ADD CONSTRAINT "ai_command_log_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."ai_command_log"
    ADD CONSTRAINT "ai_command_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_notes"
    ADD CONSTRAINT "ai_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_ops_allowlist"
    ADD CONSTRAINT "ai_ops_allowlist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_probe"
    ADD CONSTRAINT "ai_probe_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_schema_cache"
    ADD CONSTRAINT "ai_schema_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_secrets"
    ADD CONSTRAINT "app_secrets_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_accounts"
    ADD CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_statements"
    ADD CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bins"
    ADD CONSTRAINT "bins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bom_components"
    ADD CONSTRAINT "bom_components_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."boms"
    ADD CONSTRAINT "boms_company_id_product_id_version_key" UNIQUE ("company_id", "product_id", "version");



ALTER TABLE ONLY "public"."boms"
    ADD CONSTRAINT "boms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_books"
    ADD CONSTRAINT "cash_books_company_id_key" UNIQUE ("company_id");



ALTER TABLE ONLY "public"."cash_books"
    ADD CONSTRAINT "cash_books_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_transactions"
    ADD CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_access_audit_log"
    ADD CONSTRAINT "company_access_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_control_action_log"
    ADD CONSTRAINT "company_control_action_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_currencies"
    ADD CONSTRAINT "company_currencies_pkey" PRIMARY KEY ("company_id", "currency_code");



ALTER TABLE ONLY "public"."company_digest_state"
    ADD CONSTRAINT "company_digest_state_pkey" PRIMARY KEY ("company_id");



ALTER TABLE ONLY "public"."company_fiscal_settings"
    ADD CONSTRAINT "company_fiscal_settings_pkey" PRIMARY KEY ("company_id");



ALTER TABLE ONLY "public"."company_invites"
    ADD CONSTRAINT "company_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_invites"
    ADD CONSTRAINT "company_invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."company_members"
    ADD CONSTRAINT "company_members_pkey" PRIMARY KEY ("company_id", "email");



ALTER TABLE ONLY "public"."company_purge_queue"
    ADD CONSTRAINT "company_purge_queue_company_id_key" UNIQUE ("company_id");



ALTER TABLE ONLY "public"."company_purge_queue"
    ADD CONSTRAINT "company_purge_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_settings"
    ADD CONSTRAINT "company_settings_pkey" PRIMARY KEY ("company_id");



ALTER TABLE ONLY "public"."company_subscription_state"
    ADD CONSTRAINT "company_subscription_state_pkey" PRIMARY KEY ("company_id");



ALTER TABLE ONLY "public"."currencies"
    ADD CONSTRAINT "currencies_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_company_code_key" UNIQUE ("company_id", "code");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."digest_events"
    ADD CONSTRAINT "digest_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."digest_queue"
    ADD CONSTRAINT "digest_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_number_counters"
    ADD CONSTRAINT "document_number_counters_pkey" PRIMARY KEY ("company_id", "document_type");



ALTER TABLE ONLY "public"."due_reminder_queue"
    ADD CONSTRAINT "due_reminder_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."finance_document_events"
    ADD CONSTRAINT "finance_document_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."finance_document_fiscal_series"
    ADD CONSTRAINT "finance_document_fiscal_series_company_document_series_year_key" UNIQUE ("company_id", "document_type", "series_code", "fiscal_year");



ALTER TABLE ONLY "public"."finance_document_fiscal_series"
    ADD CONSTRAINT "finance_document_fiscal_series_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_document_artifacts"
    ADD CONSTRAINT "fiscal_document_artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fx_rates"
    ADD CONSTRAINT "fx_rates_company_pair_key" UNIQUE ("company_id", "date", "from_code", "to_code");



ALTER TABLE ONLY "public"."fx_rates"
    ADD CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."item_moving_average"
    ADD CONSTRAINT "item_moving_average_pkey" PRIMARY KEY ("company_id", "item_id");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."landed_cost_run_lines"
    ADD CONSTRAINT "landed_cost_run_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."landed_cost_runs"
    ADD CONSTRAINT "landed_cost_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."number_sequences"
    ADD CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."order_counters"
    ADD CONSTRAINT "order_counters_pkey" PRIMARY KEY ("company_id", "type");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_terms"
    ADD CONSTRAINT "payment_terms_company_id_code_key" UNIQUE ("company_id", "code");



ALTER TABLE ONLY "public"."payment_terms"
    ADD CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plan_catalog"
    ADD CONSTRAINT "plan_catalog_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."purchase_order_lines"
    ADD CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_order_lines"
    ADD CONSTRAINT "purchase_order_lines_po_id_line_no_key" UNIQUE ("po_id", "line_no");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."saft_moz_exports"
    ADD CONSTRAINT "saft_moz_exports_period_unique" UNIQUE ("company_id", "period_start", "period_end");



ALTER TABLE ONLY "public"."saft_moz_exports"
    ADD CONSTRAINT "saft_moz_exports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_credit_note_lines"
    ADD CONSTRAINT "sales_credit_note_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_credit_notes"
    ADD CONSTRAINT "sales_credit_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_debit_note_lines"
    ADD CONSTRAINT "sales_debit_note_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_debit_notes"
    ADD CONSTRAINT "sales_debit_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_invoice_lines"
    ADD CONSTRAINT "sales_invoice_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_invoices"
    ADD CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_order_lines"
    ADD CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_order_lines"
    ADD CONSTRAINT "sales_order_lines_so_id_line_no_key" UNIQUE ("so_id", "line_no");



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_id_company_key" UNIQUE ("id", "company_id");



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_shipments"
    ADD CONSTRAINT "sales_shipments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_levels"
    ADD CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_company_code_key" UNIQUE ("company_id", "code");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."uom_conversions"
    ADD CONSTRAINT "uom_conversions_from_uom_id_to_uom_id_key" UNIQUE ("from_uom_id", "to_uom_id");



ALTER TABLE ONLY "public"."uom_conversions"
    ADD CONSTRAINT "uom_conversions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."uom_conversions"
    ADD CONSTRAINT "uom_conversions_unique_company_from_to" UNIQUE ("company_id", "from_uom_id", "to_uom_id");



ALTER TABLE ONLY "public"."uoms"
    ADD CONSTRAINT "uoms_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."uoms"
    ADD CONSTRAINT "uoms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bins"
    ADD CONSTRAINT "uq_bins_warehouse_code" UNIQUE ("warehouseId", "code");



ALTER TABLE ONLY "public"."due_reminder_queue"
    ADD CONSTRAINT "uq_due_reminder_unique" UNIQUE ("company_id", "run_for_local_date", "timezone");



ALTER TABLE ONLY "public"."user_active_company"
    ADD CONSTRAINT "user_active_company_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."vendor_bill_lines"
    ADD CONSTRAINT "vendor_bill_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_bills"
    ADD CONSTRAINT "vendor_bills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_credit_note_lines"
    ADD CONSTRAINT "vendor_credit_note_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_credit_notes"
    ADD CONSTRAINT "vendor_credit_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_debit_note_lines"
    ADD CONSTRAINT "vendor_debit_note_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_debit_notes"
    ADD CONSTRAINT "vendor_debit_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."warehouses"
    ADD CONSTRAINT "warehouses_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."warehouses"
    ADD CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_credentials"
    ADD CONSTRAINT "whatsapp_credentials_pkey" PRIMARY KEY ("company_id");



ALTER TABLE ONLY "public"."whatsapp_outbox"
    ADD CONSTRAINT "whatsapp_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_webhook_events"
    ADD CONSTRAINT "whatsapp_webhook_events_pkey" PRIMARY KEY ("id");



CREATE INDEX "ai_command_log_idem_idx" ON "public"."ai_command_log" USING "btree" ("idempotency_key");



CREATE INDEX "ai_command_log_intent_idx" ON "public"."ai_command_log" USING "gin" ("to_tsvector"('"simple"'::"regconfig", COALESCE("intent", ''::"text")));



CREATE INDEX "ai_command_log_ts_idx" ON "public"."ai_command_log" USING "btree" ("ts" DESC);



CREATE INDEX "ai_ops_allowlist_verb_table_idx" ON "public"."ai_ops_allowlist" USING "btree" ("verb", "table_pattern");



CREATE INDEX "bank_accounts_company_idx" ON "public"."bank_accounts" USING "btree" ("company_id");



CREATE INDEX "bank_stmt_bank_date_idx" ON "public"."bank_statements" USING "btree" ("bank_id", "statement_date", "created_at");



CREATE INDEX "bank_tx_bank_date_idx" ON "public"."bank_transactions" USING "btree" ("bank_id", "happened_at", "created_at");



CREATE UNIQUE INDEX "cash_books_company_uidx" ON "public"."cash_books" USING "btree" ("company_id");



CREATE INDEX "cash_tx_company_date_idx" ON "public"."cash_transactions" USING "btree" ("company_id", "happened_at", "created_at");



CREATE INDEX "cash_tx_ref_idx" ON "public"."cash_transactions" USING "btree" ("company_id", "ref_type", "ref_id", "type");



CREATE INDEX "company_control_action_log_company_created_idx" ON "public"."company_control_action_log" USING "btree" ("company_id", "created_at" DESC);



CREATE UNIQUE INDEX "company_members_company_user_uniq" ON "public"."company_members" USING "btree" ("company_id", "user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "company_members_user_id_idx" ON "public"."company_members" USING "btree" ("user_id");



CREATE UNIQUE INDEX "company_members_user_unique" ON "public"."company_members" USING "btree" ("company_id", "user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "company_settings_gin" ON "public"."company_settings" USING "gin" ("data");



CREATE UNIQUE INDEX "customers_company_code_uk" ON "public"."customers" USING "btree" ("company_id", "code");



CREATE INDEX "customers_company_msisdn_idx" ON "public"."customers" USING "btree" ("company_id", "whatsapp_msisdn") WHERE ("whatsapp_msisdn" IS NOT NULL);



CREATE INDEX "customers_name_idx" ON "public"."customers" USING "btree" ("lower"("name"));



CREATE UNIQUE INDEX "customers_one_cash_per_company" ON "public"."customers" USING "btree" ("company_id") WHERE ("is_cash" IS TRUE);



CREATE INDEX "digest_queue_company_date_idx" ON "public"."digest_queue" USING "btree" ("company_id", "run_for_local_date");



CREATE INDEX "digest_queue_next_attempt_idx" ON "public"."digest_queue" USING "btree" ("status", "next_attempt_at");



CREATE INDEX "digest_queue_status_idx" ON "public"."digest_queue" USING "btree" ("status");



CREATE INDEX "finance_document_events_document_idx" ON "public"."finance_document_events" USING "btree" ("company_id", "document_kind", "document_id", "occurred_at" DESC);



CREATE INDEX "finance_document_fiscal_series_company_lookup_idx" ON "public"."finance_document_fiscal_series" USING "btree" ("company_id", "document_type", "fiscal_year", "is_active");



CREATE UNIQUE INDEX "fiscal_document_artifacts_canonical_key" ON "public"."fiscal_document_artifacts" USING "btree" ("company_id", "document_kind", "document_id", "artifact_type") WHERE "is_canonical";



CREATE INDEX "fiscal_document_artifacts_document_idx" ON "public"."fiscal_document_artifacts" USING "btree" ("company_id", "document_kind", "document_id", "created_at" DESC);



CREATE INDEX "idx_bank_transactions_ref_type_ref_id" ON "public"."bank_transactions" USING "btree" ("ref_type", "ref_id");



CREATE INDEX "idx_bins_company" ON "public"."bins" USING "btree" ("company_id");



CREATE INDEX "idx_bins_warehouse" ON "public"."bins" USING "btree" ("warehouseId");



CREATE INDEX "idx_builds_bin_from_id_fk" ON "public"."builds" USING "btree" ("bin_from_id");



CREATE INDEX "idx_builds_bin_to_id_fk" ON "public"."builds" USING "btree" ("bin_to_id");



CREATE INDEX "idx_builds_created_by_fk" ON "public"."builds" USING "btree" ("created_by");



CREATE INDEX "idx_builds_warehouse_from_id_fk" ON "public"."builds" USING "btree" ("warehouse_from_id");



CREATE INDEX "idx_builds_warehouse_to_id_fk" ON "public"."builds" USING "btree" ("warehouse_to_id");



CREATE INDEX "idx_company_currencies_company" ON "public"."company_currencies" USING "btree" ("company_id");



CREATE INDEX "idx_company_currencies_currency_code_fk" ON "public"."company_currencies" USING "btree" ("currency_code");



CREATE INDEX "idx_company_invites_company_id_fk" ON "public"."company_invites" USING "btree" ("company_id");



CREATE INDEX "idx_company_members_company_role" ON "public"."company_members" USING "btree" ("company_id", "role");



CREATE INDEX "idx_customers_payment_terms_id_fk" ON "public"."customers" USING "btree" ("payment_terms_id");



CREATE INDEX "idx_digest_queue_pending_ready" ON "public"."digest_queue" USING "btree" ("next_attempt_at", "created_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_digest_queue_processing_started" ON "public"."digest_queue" USING "btree" ("processing_started_at") WHERE ("status" = 'processing'::"text");



CREATE INDEX "idx_due_queue_company_status" ON "public"."due_reminder_queue" USING "btree" ("company_id", "status", "created_at");



CREATE INDEX "idx_due_reminder_queue_pending_ready" ON "public"."due_reminder_queue" USING "btree" ("next_attempt_at", "created_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_due_reminder_queue_processing_started" ON "public"."due_reminder_queue" USING "btree" ("processing_started_at") WHERE ("status" = 'processing'::"text");



CREATE INDEX "idx_inv_mv_company_created" ON "public"."inventory_movements" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "idx_inv_mv_item" ON "public"."inventory_movements" USING "btree" ("company_id", "item_id");



CREATE INDEX "idx_inv_mv_loc" ON "public"."inventory_movements" USING "btree" ("company_id", "warehouse_id", "bin_id");



CREATE INDEX "idx_inv_mv_ref" ON "public"."inventory_movements" USING "btree" ("company_id", "ref_table", "ref_id");



CREATE INDEX "idx_landed_cost_run_lines_company_po" ON "public"."landed_cost_run_lines" USING "btree" ("company_id", "purchase_order_id");



CREATE INDEX "idx_landed_cost_run_lines_run_id" ON "public"."landed_cost_run_lines" USING "btree" ("run_id");



CREATE INDEX "idx_landed_cost_runs_company_po_created" ON "public"."landed_cost_runs" USING "btree" ("company_id", "purchase_order_id", "created_at" DESC);



CREATE INDEX "idx_levels_key" ON "public"."stock_levels" USING "btree" ("company_id", "item_id", "warehouse_id", "bin_id");



CREATE INDEX "idx_mov_item_bin_from" ON "public"."stock_movements" USING "btree" ("company_id", "item_id", "bin_from_id");



CREATE INDEX "idx_mov_item_bin_to" ON "public"."stock_movements" USING "btree" ("company_id", "item_id", "bin_to_id");



CREATE INDEX "idx_movements_company" ON "public"."movements" USING "btree" ("company_id");



CREATE INDEX "idx_movements_from_bin_id_from_warehouse_id_fk" ON "public"."movements" USING "btree" ("from_bin_id", "from_warehouse_id");



CREATE INDEX "idx_movements_to_bin_id_to_warehouse_id_fk" ON "public"."movements" USING "btree" ("to_bin_id", "to_warehouse_id");



CREATE INDEX "idx_notifications_company_created" ON "public"."notifications" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "idx_notifications_created" ON "public"."notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notifications_user_created" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_pol_company" ON "public"."purchase_order_lines" USING "btree" ("company_id");



CREATE INDEX "idx_pol_company_item" ON "public"."purchase_order_lines" USING "btree" ("company_id", "item_id");



CREATE INDEX "idx_pol_company_po" ON "public"."purchase_order_lines" USING "btree" ("company_id", "po_id");



CREATE INDEX "idx_profiles_email" ON "public"."profiles" USING "btree" ("email");



CREATE INDEX "idx_purchase_orders_company" ON "public"."purchase_orders" USING "btree" ("company_id");



CREATE INDEX "idx_purchase_orders_company_updated" ON "public"."purchase_orders" USING "btree" ("company_id", "updated_at" DESC);



CREATE INDEX "idx_purchase_orders_payment_terms_id_fk" ON "public"."purchase_orders" USING "btree" ("payment_terms_id");



CREATE INDEX "idx_sales_order_lines_so_id" ON "public"."sales_order_lines" USING "btree" ("so_id");



CREATE INDEX "idx_sales_orders_company_due" ON "public"."sales_orders" USING "btree" ("company_id", "due_date");



CREATE INDEX "idx_sales_orders_payment_terms_id_fk" ON "public"."sales_orders" USING "btree" ("payment_terms_id");



CREATE INDEX "idx_sales_shipments_company" ON "public"."sales_shipments" USING "btree" ("company_id");



CREATE INDEX "idx_sales_shipments_so_id" ON "public"."sales_shipments" USING "btree" ("so_id");



CREATE INDEX "idx_sol_is_shipped" ON "public"."sales_order_lines" USING "btree" ("is_shipped");



CREATE INDEX "idx_sol_shipped_qty" ON "public"."sales_order_lines" USING "btree" ("shipped_qty");



CREATE INDEX "idx_sol_soid_isshipped" ON "public"."sales_order_lines" USING "btree" ("so_id", "is_shipped");



CREATE INDEX "idx_stock_levels_bin_id_fk" ON "public"."stock_levels" USING "btree" ("bin_id");



CREATE INDEX "idx_stock_levels_company" ON "public"."stock_levels" USING "btree" ("company_id");



CREATE INDEX "idx_stock_levels_wh_bin_item" ON "public"."stock_levels" USING "btree" ("warehouse_id", "bin_id", "item_id");



CREATE INDEX "idx_stock_movements_company" ON "public"."stock_movements" USING "btree" ("company_id");



CREATE INDEX "idx_stock_movements_item_time" ON "public"."stock_movements" USING "btree" ("item_id", "created_at" DESC);



CREATE INDEX "idx_stock_movements_ref" ON "public"."stock_movements" USING "btree" ("ref_type", "ref_id");



CREATE INDEX "idx_stock_movements_supplier_created" ON "public"."stock_movements" USING "btree" ("supplier_id", "created_at");



CREATE INDEX "idx_stock_movements_type_created" ON "public"."stock_movements" USING "btree" ("type", "created_at");



CREATE INDEX "idx_suppliers_payment_terms_id_fk" ON "public"."suppliers" USING "btree" ("payment_terms_id");



CREATE INDEX "idx_user_active_company_company_id_fk" ON "public"."user_active_company" USING "btree" ("company_id");



CREATE INDEX "idx_user_profiles_active_company_id_fk" ON "public"."user_profiles" USING "btree" ("active_company_id");



CREATE INDEX "idx_warehouses_company" ON "public"."warehouses" USING "btree" ("company_id");



CREATE INDEX "idx_wh_createdat" ON "public"."warehouses" USING "btree" ("createdAt");



CREATE INDEX "items_company_id_idx" ON "public"."items" USING "btree" ("company_id");



CREATE UNIQUE INDEX "items_company_sku_ci_key" ON "public"."items" USING "btree" ("company_id", "lower"("sku"));



CREATE UNIQUE INDEX "items_company_sku_ci_unique" ON "public"."items" USING "btree" ("company_id", "lower"("sku"));



CREATE UNIQUE INDEX "items_company_sku_uidx" ON "public"."items" USING "btree" ("company_id", "sku");



CREATE INDEX "ix_ai_notes_id" ON "public"."ai_notes" USING "btree" ("id");



CREATE INDEX "ix_ai_probe_id" ON "public"."ai_probe" USING "btree" ("id");



CREATE INDEX "ix_app_settings_updated_by_fk" ON "public"."app_settings" USING "btree" ("updated_by");



CREATE INDEX "ix_bins_company_id_fk" ON "public"."bins" USING "btree" ("company_id");



CREATE INDEX "ix_bins_warehouseId_fk" ON "public"."bins" USING "btree" ("warehouseId");



CREATE INDEX "ix_bom_components_bom" ON "public"."bom_components" USING "btree" ("bom_id");



CREATE INDEX "ix_bom_components_item" ON "public"."bom_components" USING "btree" ("component_item_id");



CREATE INDEX "ix_boms_active" ON "public"."boms" USING "btree" ("is_active");



CREATE INDEX "ix_boms_company_id" ON "public"."boms" USING "btree" ("company_id");



CREATE INDEX "ix_boms_product_id" ON "public"."boms" USING "btree" ("product_id");



CREATE INDEX "ix_builds_bom_id" ON "public"."builds" USING "btree" ("bom_id");



CREATE INDEX "ix_builds_company_id" ON "public"."builds" USING "btree" ("company_id");



CREATE INDEX "ix_builds_product_id" ON "public"."builds" USING "btree" ("product_id");



CREATE INDEX "ix_companies_owner_user_id_fk" ON "public"."companies" USING "btree" ("owner_user_id");



CREATE INDEX "ix_company_currencies_company_id_fk" ON "public"."company_currencies" USING "btree" ("company_id");



CREATE INDEX "ix_company_members_company_id_fk" ON "public"."company_members" USING "btree" ("company_id");



CREATE INDEX "ix_company_members_email_status" ON "public"."company_members" USING "btree" ("email", "status");



CREATE INDEX "ix_company_members_invited_by_fk" ON "public"."company_members" USING "btree" ("invited_by");



CREATE INDEX "ix_company_members_user_status_created" ON "public"."company_members" USING "btree" ("user_id", "status", "created_at");



CREATE INDEX "ix_company_settings_base_currency_code_fk" ON "public"."company_settings" USING "btree" ("base_currency_code");



CREATE INDEX "ix_company_settings_company_id_fk" ON "public"."company_settings" USING "btree" ("company_id");



CREATE INDEX "ix_company_settings_updated_by_fk" ON "public"."company_settings" USING "btree" ("updated_by");



CREATE INDEX "ix_customers_company_id_fk" ON "public"."customers" USING "btree" ("company_id");



CREATE INDEX "ix_customers_currency_code_fk" ON "public"."customers" USING "btree" ("currency_code");



CREATE INDEX "ix_fx_rates_company_id_fk" ON "public"."fx_rates" USING "btree" ("company_id");



CREATE INDEX "ix_fx_rates_from_code_fk" ON "public"."fx_rates" USING "btree" ("from_code");



CREATE INDEX "ix_fx_rates_to_code_fk" ON "public"."fx_rates" USING "btree" ("to_code");



CREATE INDEX "ix_items_base_uom_id_fk" ON "public"."items" USING "btree" ("base_uom_id");



CREATE INDEX "ix_items_company_id_fk" ON "public"."items" USING "btree" ("company_id");



CREATE INDEX "ix_movements_company_id_fk" ON "public"."movements" USING "btree" ("company_id");



CREATE INDEX "ix_movements_from_bin" ON "public"."movements" USING "btree" ("from_bin_id");



CREATE INDEX "ix_movements_from_warehouse_id_fk" ON "public"."movements" USING "btree" ("from_warehouse_id");



CREATE INDEX "ix_movements_item_id_fk" ON "public"."movements" USING "btree" ("item_id");



CREATE INDEX "ix_movements_to_bin" ON "public"."movements" USING "btree" ("to_bin_id");



CREATE INDEX "ix_movements_to_warehouse_id_fk" ON "public"."movements" USING "btree" ("to_warehouse_id");



CREATE INDEX "ix_order_counters_company_id_fk" ON "public"."order_counters" USING "btree" ("company_id");



CREATE INDEX "ix_profiles_default_org_id_fk" ON "public"."profiles" USING "btree" ("default_org_id");



CREATE INDEX "ix_purchase_order_lines_company" ON "public"."purchase_order_lines" USING "btree" ("po_id");



CREATE INDEX "ix_purchase_order_lines_item_id_fk" ON "public"."purchase_order_lines" USING "btree" ("item_id");



CREATE INDEX "ix_purchase_order_lines_po_id_fk" ON "public"."purchase_order_lines" USING "btree" ("po_id");



CREATE INDEX "ix_purchase_order_lines_po_id_item" ON "public"."purchase_order_lines" USING "btree" ("po_id", "item_id");



CREATE INDEX "ix_purchase_order_lines_uom_id_fk" ON "public"."purchase_order_lines" USING "btree" ("uom_id");



CREATE INDEX "ix_purchase_orders_company_id_fk" ON "public"."purchase_orders" USING "btree" ("company_id");



CREATE INDEX "ix_purchase_orders_company_status_created" ON "public"."purchase_orders" USING "btree" ("company_id", "status", "created_at");



CREATE INDEX "ix_purchase_orders_currency_code_fk" ON "public"."purchase_orders" USING "btree" ("currency_code");



CREATE INDEX "ix_purchase_orders_supplier_id_fk" ON "public"."purchase_orders" USING "btree" ("supplier_id");



CREATE INDEX "ix_sales_order_lines_item_id_fk" ON "public"."sales_order_lines" USING "btree" ("item_id");



CREATE INDEX "ix_sales_order_lines_so_id_fk" ON "public"."sales_order_lines" USING "btree" ("so_id");



CREATE INDEX "ix_sales_order_lines_so_id_item" ON "public"."sales_order_lines" USING "btree" ("so_id", "item_id");



CREATE INDEX "ix_sales_order_lines_uom_id_fk" ON "public"."sales_order_lines" USING "btree" ("uom_id");



CREATE INDEX "ix_sales_orders_company_id_fk" ON "public"."sales_orders" USING "btree" ("company_id");



CREATE INDEX "ix_sales_orders_company_status_created" ON "public"."sales_orders" USING "btree" ("company_id", "status", "created_at");



CREATE INDEX "ix_sales_orders_currency_code_fk" ON "public"."sales_orders" USING "btree" ("currency_code");



CREATE INDEX "ix_sales_orders_customer_id_fk" ON "public"."sales_orders" USING "btree" ("customer_id");



CREATE INDEX "ix_sales_shipments_company_id_fk" ON "public"."sales_shipments" USING "btree" ("company_id");



CREATE INDEX "ix_sales_shipments_item_id_fk" ON "public"."sales_shipments" USING "btree" ("item_id");



CREATE INDEX "ix_sales_shipments_movement_id_fk" ON "public"."sales_shipments" USING "btree" ("movement_id");



CREATE INDEX "ix_sales_shipments_so_line_id_fk" ON "public"."sales_shipments" USING "btree" ("so_line_id");



CREATE INDEX "ix_settings_base_currency_code_fk" ON "public"."settings" USING "btree" ("base_currency_code");



CREATE INDEX "ix_shipments_company_so" ON "public"."sales_shipments" USING "btree" ("company_id", "so_id");



CREATE INDEX "ix_shipments_item" ON "public"."sales_shipments" USING "btree" ("item_id");



CREATE INDEX "ix_shipments_movement" ON "public"."sales_shipments" USING "btree" ("movement_id");



CREATE INDEX "ix_shipments_so" ON "public"."sales_shipments" USING "btree" ("so_id");



CREATE INDEX "ix_sol_company_id" ON "public"."sales_order_lines" USING "btree" ("company_id");



CREATE INDEX "ix_sol_item" ON "public"."sales_order_lines" USING "btree" ("item_id");



CREATE INDEX "ix_sol_so_company" ON "public"."sales_order_lines" USING "btree" ("so_id", "company_id");



CREATE INDEX "ix_stock_levels_company_id_fk" ON "public"."stock_levels" USING "btree" ("company_id");



CREATE INDEX "ix_stock_levels_item" ON "public"."stock_levels" USING "btree" ("item_id");



CREATE INDEX "ix_stock_levels_warehouse_id_fk" ON "public"."stock_levels" USING "btree" ("warehouse_id");



CREATE INDEX "ix_stock_levels_wh_bin_item" ON "public"."stock_levels" USING "btree" ("warehouse_id", "bin_id", "item_id");



CREATE INDEX "ix_stock_levels_wh_item" ON "public"."stock_levels" USING "btree" ("warehouse_id", "item_id");



CREATE INDEX "ix_stock_movements_bin_from_id_fk" ON "public"."stock_movements" USING "btree" ("bin_from_id");



CREATE INDEX "ix_stock_movements_bin_to_id_fk" ON "public"."stock_movements" USING "btree" ("bin_to_id");



CREATE INDEX "ix_stock_movements_company_created" ON "public"."stock_movements" USING "btree" ("company_id", "created_at");



CREATE INDEX "ix_stock_movements_item_id_fk" ON "public"."stock_movements" USING "btree" ("item_id");



CREATE INDEX "ix_stock_movements_uom_id_fk" ON "public"."stock_movements" USING "btree" ("uom_id");



CREATE INDEX "ix_stock_movements_warehouse_from_id_fk" ON "public"."stock_movements" USING "btree" ("warehouse_from_id");



CREATE INDEX "ix_stock_movements_warehouse_to_id_fk" ON "public"."stock_movements" USING "btree" ("warehouse_to_id");



CREATE INDEX "ix_suppliers_company" ON "public"."suppliers" USING "btree" ("company_id");



CREATE INDEX "ix_suppliers_company_id_fk" ON "public"."suppliers" USING "btree" ("company_id");



CREATE INDEX "ix_suppliers_currency_code_fk" ON "public"."suppliers" USING "btree" ("currency_code");



CREATE INDEX "ix_uom_conv_to" ON "public"."uom_conversions" USING "btree" ("to_uom_id");



CREATE INDEX "ix_uom_conversions_from_uom_id_fk" ON "public"."uom_conversions" USING "btree" ("from_uom_id");



CREATE INDEX "ix_warehouses_company_id_fk" ON "public"."warehouses" USING "btree" ("company_id");



CREATE INDEX "payment_terms_company_code_idx" ON "public"."payment_terms" USING "btree" ("company_id", "code");



CREATE INDEX "po_company_id_idx" ON "public"."purchase_orders" USING "btree" ("company_id");



CREATE UNIQUE INDEX "po_order_no_uniq" ON "public"."purchase_orders" USING "btree" ("company_id", "order_no") WHERE ("order_no" IS NOT NULL);



CREATE INDEX "saft_moz_exports_company_status_idx" ON "public"."saft_moz_exports" USING "btree" ("company_id", "status", "period_start" DESC);



CREATE INDEX "sales_credit_note_lines_note_idx" ON "public"."sales_credit_note_lines" USING "btree" ("sales_credit_note_id", "sort_order", "created_at");



CREATE UNIQUE INDEX "sales_credit_notes_company_internal_reference_key" ON "public"."sales_credit_notes" USING "btree" ("company_id", "internal_reference");



CREATE UNIQUE INDEX "sales_credit_notes_company_native_sequence_key" ON "public"."sales_credit_notes" USING "btree" ("company_id", "moz_document_code", "fiscal_series_code", "fiscal_year", "fiscal_sequence_number") WHERE ("source_origin" = 'native'::"text");



CREATE INDEX "sales_credit_notes_original_invoice_idx" ON "public"."sales_credit_notes" USING "btree" ("company_id", "original_sales_invoice_id");



CREATE INDEX "sales_debit_note_lines_note_idx" ON "public"."sales_debit_note_lines" USING "btree" ("sales_debit_note_id", "sort_order", "created_at");



CREATE UNIQUE INDEX "sales_debit_notes_company_internal_reference_key" ON "public"."sales_debit_notes" USING "btree" ("company_id", "internal_reference");



CREATE UNIQUE INDEX "sales_debit_notes_company_native_sequence_key" ON "public"."sales_debit_notes" USING "btree" ("company_id", "moz_document_code", "fiscal_series_code", "fiscal_year", "fiscal_sequence_number") WHERE ("source_origin" = 'native'::"text");



CREATE INDEX "sales_debit_notes_original_invoice_idx" ON "public"."sales_debit_notes" USING "btree" ("company_id", "original_sales_invoice_id");



CREATE INDEX "sales_invoice_lines_company_idx" ON "public"."sales_invoice_lines" USING "btree" ("company_id");



CREATE INDEX "sales_invoice_lines_invoice_idx" ON "public"."sales_invoice_lines" USING "btree" ("sales_invoice_id", "sort_order", "created_at");



CREATE INDEX "sales_invoices_company_due_idx" ON "public"."sales_invoices" USING "btree" ("company_id", "due_date");



CREATE INDEX "sales_invoices_company_fiscal_lookup_idx" ON "public"."sales_invoices" USING "btree" ("company_id", "fiscal_year", "fiscal_series_code", "fiscal_sequence_number");



CREATE UNIQUE INDEX "sales_invoices_company_internal_reference_key" ON "public"."sales_invoices" USING "btree" ("company_id", "internal_reference");



CREATE UNIQUE INDEX "sales_invoices_company_native_sequence_key" ON "public"."sales_invoices" USING "btree" ("company_id", "moz_document_code", "fiscal_series_code", "fiscal_year", "fiscal_sequence_number") WHERE ("source_origin" = 'native'::"text");



CREATE INDEX "sales_invoices_company_order_idx" ON "public"."sales_invoices" USING "btree" ("company_id", "sales_order_id");



CREATE INDEX "sales_orders_company_due_idx" ON "public"."sales_orders" USING "btree" ("company_id", "due_date");



CREATE UNIQUE INDEX "sales_shipments_movement_id_key" ON "public"."sales_shipments" USING "btree" ("movement_id");



CREATE INDEX "so_company_id_idx" ON "public"."sales_orders" USING "btree" ("company_id");



CREATE UNIQUE INDEX "so_order_no_uniq" ON "public"."sales_orders" USING "btree" ("company_id", "order_no") WHERE ("order_no" IS NOT NULL);



CREATE INDEX "sol_shipped_at_idx" ON "public"."sales_order_lines" USING "btree" ("shipped_at");



CREATE INDEX "sol_so_id_idx" ON "public"."sales_order_lines" USING "btree" ("so_id");



CREATE UNIQUE INDEX "stock_levels_item_wh_bin_uniq" ON "public"."stock_levels" USING "btree" ("item_id", "warehouse_id", "bin_id");



CREATE INDEX "stock_movements_company_created_idx" ON "public"."stock_movements" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "suppliers_company_name_idx" ON "public"."suppliers" USING "btree" ("company_id", "name");



CREATE UNIQUE INDEX "uniq_items_company_sku_ci" ON "public"."items" USING "btree" ("company_id", "lower"("sku"));



CREATE INDEX "uom_conversions_company_lookup_idx" ON "public"."uom_conversions" USING "btree" ("company_id", "from_uom_id", "to_uom_id");



CREATE UNIQUE INDEX "uom_conversions_uniq_company_from_to" ON "public"."uom_conversions" USING "btree" ("company_id", "from_uom_id", "to_uom_id") WHERE ("company_id" IS NOT NULL);



CREATE UNIQUE INDEX "uom_conversions_uniq_global_from_to" ON "public"."uom_conversions" USING "btree" ("from_uom_id", "to_uom_id") WHERE ("company_id" IS NULL);



CREATE UNIQUE INDEX "uq_bins_id_warehouse" ON "public"."bins" USING "btree" ("id", "warehouseId");



CREATE UNIQUE INDEX "uq_company_members_company_email" ON "public"."company_members" USING "btree" ("company_id", "email");



CREATE UNIQUE INDEX "uq_due_reminder_queue_company_day" ON "public"."due_reminder_queue" USING "btree" ("company_id", "run_for_local_date");



CREATE UNIQUE INDEX "uq_stock_levels_triplet" ON "public"."stock_levels" USING "btree" ("warehouse_id", "item_id", "bin_id") WHERE ("bin_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_stock_levels_wh_item_nullbin" ON "public"."stock_levels" USING "btree" ("warehouse_id", "item_id") WHERE ("bin_id" IS NULL);



CREATE UNIQUE INDEX "uq_uoms_code_upper" ON "public"."uoms" USING "btree" ("upper"("code"));



CREATE UNIQUE INDEX "ux_company_members_company_email" ON "public"."company_members" USING "btree" ("company_id", "lower"("email"));



CREATE UNIQUE INDEX "ux_sales_orders_company_order_no" ON "public"."sales_orders" USING "btree" ("company_id", "order_no");



CREATE UNIQUE INDEX "ux_sales_shipments_so_line_movement" ON "public"."sales_shipments" USING "btree" ("so_line_id", "movement_id");



CREATE INDEX "vendor_bill_lines_bill_idx" ON "public"."vendor_bill_lines" USING "btree" ("vendor_bill_id", "sort_order", "created_at");



CREATE INDEX "vendor_bill_lines_company_idx" ON "public"."vendor_bill_lines" USING "btree" ("company_id");



CREATE INDEX "vendor_bills_company_due_idx" ON "public"."vendor_bills" USING "btree" ("company_id", "due_date");



CREATE UNIQUE INDEX "vendor_bills_company_internal_reference_key" ON "public"."vendor_bills" USING "btree" ("company_id", "internal_reference");



CREATE INDEX "vendor_bills_company_po_idx" ON "public"."vendor_bills" USING "btree" ("company_id", "purchase_order_id");



CREATE INDEX "vendor_bills_company_supplier_reference_idx" ON "public"."vendor_bills" USING "btree" ("company_id", "supplier_id", "supplier_invoice_reference_normalized") WHERE ("supplier_invoice_reference_normalized" IS NOT NULL);



CREATE UNIQUE INDEX "vendor_bills_posted_supplier_reference_key" ON "public"."vendor_bills" USING "btree" ("company_id", "supplier_id", "supplier_invoice_reference_normalized") WHERE (("document_workflow_status" = 'posted'::"text") AND ("supplier_invoice_reference_normalized" IS NOT NULL));



CREATE INDEX "vendor_credit_note_lines_note_idx" ON "public"."vendor_credit_note_lines" USING "btree" ("vendor_credit_note_id", "sort_order", "created_at");



CREATE UNIQUE INDEX "vendor_credit_notes_company_internal_reference_key" ON "public"."vendor_credit_notes" USING "btree" ("company_id", "internal_reference");



CREATE INDEX "vendor_credit_notes_original_bill_idx" ON "public"."vendor_credit_notes" USING "btree" ("company_id", "original_vendor_bill_id");



CREATE INDEX "vendor_debit_note_lines_note_idx" ON "public"."vendor_debit_note_lines" USING "btree" ("vendor_debit_note_id", "sort_order", "created_at");



CREATE UNIQUE INDEX "vendor_debit_notes_company_internal_reference_key" ON "public"."vendor_debit_notes" USING "btree" ("company_id", "internal_reference");



CREATE INDEX "vendor_debit_notes_original_bill_idx" ON "public"."vendor_debit_notes" USING "btree" ("company_id", "original_vendor_bill_id");



CREATE INDEX "whatsapp_outbox_company_status_sched_idx" ON "public"."whatsapp_outbox" USING "btree" ("company_id", "status", "scheduled_at");



CREATE INDEX "whatsapp_webhook_events_company_msgid_idx" ON "public"."whatsapp_webhook_events" USING "btree" ("company_id", "provider_message_id");



CREATE OR REPLACE TRIGGER "_call_worker_after_enqueue" AFTER INSERT ON "public"."digest_queue" FOR EACH ROW EXECUTE FUNCTION "public"."tg_call_worker_after_enqueue"();



CREATE OR REPLACE TRIGGER "ai_10_fiscal_document_artifact_event_journal" AFTER INSERT ON "public"."fiscal_document_artifacts" FOR EACH ROW EXECUTE FUNCTION "public"."fiscal_document_artifact_event_journal"();



CREATE OR REPLACE TRIGGER "ai_10_sales_credit_note_event_journal" AFTER INSERT ON "public"."sales_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_header_event_journal"();



CREATE OR REPLACE TRIGGER "ai_10_sales_debit_note_event_journal" AFTER INSERT ON "public"."sales_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_header_event_journal"();



CREATE OR REPLACE TRIGGER "ai_10_sales_invoice_event_journal" AFTER INSERT ON "public"."sales_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_header_event_journal"();



CREATE OR REPLACE TRIGGER "ai_10_vendor_bill_event_journal" AFTER INSERT ON "public"."vendor_bills" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_header_event_journal"();



CREATE OR REPLACE TRIGGER "ai_10_vendor_credit_note_event_journal" AFTER INSERT ON "public"."vendor_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_header_event_journal"();



CREATE OR REPLACE TRIGGER "ai_10_vendor_debit_note_event_journal" AFTER INSERT ON "public"."vendor_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_header_event_journal"();



CREATE OR REPLACE TRIGGER "ai_20_sales_credit_note_parent_event_journal" AFTER INSERT ON "public"."sales_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_parent_adjustment_event_journal"();



CREATE OR REPLACE TRIGGER "ai_20_sales_debit_note_parent_event_journal" AFTER INSERT ON "public"."sales_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_parent_adjustment_event_journal"();



CREATE OR REPLACE TRIGGER "ai_20_vendor_credit_note_parent_event_journal" AFTER INSERT ON "public"."vendor_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_parent_adjustment_event_journal"();



CREATE OR REPLACE TRIGGER "ai_20_vendor_debit_note_parent_event_journal" AFTER INSERT ON "public"."vendor_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_parent_adjustment_event_journal"();



CREATE OR REPLACE TRIGGER "ai_30_bank_transactions_finance_event_journal" AFTER INSERT ON "public"."bank_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_settlement_event_journal"();



CREATE OR REPLACE TRIGGER "ai_30_cash_transactions_finance_event_journal" AFTER INSERT ON "public"."cash_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_settlement_event_journal"();



CREATE OR REPLACE TRIGGER "au_10_sales_credit_note_event_journal" AFTER UPDATE ON "public"."sales_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_header_event_journal"();



CREATE OR REPLACE TRIGGER "au_10_sales_debit_note_event_journal" AFTER UPDATE ON "public"."sales_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_header_event_journal"();



CREATE OR REPLACE TRIGGER "au_10_sales_invoice_event_journal" AFTER UPDATE ON "public"."sales_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_header_event_journal"();



CREATE OR REPLACE TRIGGER "au_10_vendor_bill_event_journal" AFTER UPDATE ON "public"."vendor_bills" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_header_event_journal"();



CREATE OR REPLACE TRIGGER "au_10_vendor_credit_note_event_journal" AFTER UPDATE ON "public"."vendor_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_header_event_journal"();



CREATE OR REPLACE TRIGGER "au_10_vendor_debit_note_event_journal" AFTER UPDATE ON "public"."vendor_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_header_event_journal"();



CREATE OR REPLACE TRIGGER "au_20_sales_credit_note_parent_event_journal" AFTER UPDATE ON "public"."sales_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_parent_adjustment_event_journal"();



CREATE OR REPLACE TRIGGER "au_20_sales_debit_note_parent_event_journal" AFTER UPDATE ON "public"."sales_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_parent_adjustment_event_journal"();



CREATE OR REPLACE TRIGGER "au_20_vendor_credit_note_parent_event_journal" AFTER UPDATE ON "public"."vendor_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_parent_adjustment_event_journal"();



CREATE OR REPLACE TRIGGER "au_20_vendor_debit_note_parent_event_journal" AFTER UPDATE ON "public"."vendor_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_parent_adjustment_event_journal"();



CREATE OR REPLACE TRIGGER "au_95_sales_invoice_transfer_settlement_anchor" AFTER UPDATE OF "document_workflow_status" ON "public"."sales_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."sales_invoice_transfer_settlement_anchor"();



CREATE OR REPLACE TRIGGER "au_95_vendor_bill_transfer_settlement_anchor" AFTER UPDATE OF "document_workflow_status" ON "public"."vendor_bills" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_bill_transfer_settlement_anchor"();



CREATE OR REPLACE TRIGGER "bd_30_sales_credit_note_lines_parent_issue_guard" BEFORE DELETE ON "public"."sales_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."sales_note_lines_parent_issue_guard"();



CREATE OR REPLACE TRIGGER "bd_30_sales_debit_note_lines_parent_issue_guard" BEFORE DELETE ON "public"."sales_debit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."sales_note_lines_parent_issue_guard"();



CREATE OR REPLACE TRIGGER "bd_30_sales_invoice_lines_parent_issue_guard" BEFORE DELETE ON "public"."sales_invoice_lines" FOR EACH ROW EXECUTE FUNCTION "public"."sales_invoice_lines_parent_issue_guard"();



CREATE OR REPLACE TRIGGER "bd_30_vendor_bill_lines_parent_post_guard" BEFORE DELETE ON "public"."vendor_bill_lines" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_bill_lines_parent_post_guard"();



CREATE OR REPLACE TRIGGER "bd_30_vendor_credit_note_lines_parent_status_guard" BEFORE DELETE ON "public"."vendor_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_note_lines_parent_status_guard"();



CREATE OR REPLACE TRIGGER "bd_30_vendor_debit_note_lines_parent_status_guard" BEFORE DELETE ON "public"."vendor_debit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_note_lines_parent_status_guard"();



CREATE OR REPLACE TRIGGER "bi_10_fiscal_document_artifact_defaults" BEFORE INSERT ON "public"."fiscal_document_artifacts" FOR EACH ROW EXECUTE FUNCTION "public"."fiscal_document_artifact_defaults"();



CREATE OR REPLACE TRIGGER "bi_bins_set_company" BEFORE INSERT OR UPDATE ON "public"."bins" FOR EACH ROW EXECUTE FUNCTION "public"."tg_bins_set_company"();



CREATE OR REPLACE TRIGGER "bi_set_company_id_customers" BEFORE INSERT ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_company_id"();



CREATE OR REPLACE TRIGGER "bi_set_company_id_items" BEFORE INSERT ON "public"."items" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_company_id"();



CREATE OR REPLACE TRIGGER "bi_set_company_id_purchase_orders" BEFORE INSERT ON "public"."purchase_orders" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_company_id"();

ALTER TABLE "public"."purchase_orders" DISABLE TRIGGER "bi_set_company_id_purchase_orders";



CREATE OR REPLACE TRIGGER "bi_set_company_id_sales_orders" BEFORE INSERT ON "public"."sales_orders" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_company_id"();



CREATE OR REPLACE TRIGGER "bi_set_company_id_suppliers" BEFORE INSERT ON "public"."suppliers" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_company_id"();



CREATE OR REPLACE TRIGGER "bi_set_company_id_warehouses" BEFORE INSERT ON "public"."warehouses" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_company_id"();



CREATE OR REPLACE TRIGGER "biu_10_sales_credit_note_assign_reference" BEFORE INSERT OR UPDATE ON "public"."sales_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."sales_credit_note_assign_reference"();



CREATE OR REPLACE TRIGGER "biu_10_sales_credit_note_lines_company_guard" BEFORE INSERT OR UPDATE ON "public"."sales_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_note_line_company_guard"();



CREATE OR REPLACE TRIGGER "biu_10_sales_debit_note_assign_reference" BEFORE INSERT OR UPDATE ON "public"."sales_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."sales_debit_note_assign_reference"();



CREATE OR REPLACE TRIGGER "biu_10_sales_debit_note_lines_company_guard" BEFORE INSERT OR UPDATE ON "public"."sales_debit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_note_line_company_guard"();



CREATE OR REPLACE TRIGGER "biu_10_sales_invoice_assign_reference" BEFORE INSERT OR UPDATE ON "public"."sales_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."sales_invoice_assign_reference"();



CREATE OR REPLACE TRIGGER "biu_10_sales_invoice_lines_company_guard" BEFORE INSERT OR UPDATE ON "public"."sales_invoice_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_line_company_guard"();



CREATE OR REPLACE TRIGGER "biu_10_vendor_credit_note_assign_reference" BEFORE INSERT OR UPDATE ON "public"."vendor_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_credit_note_assign_reference"();



CREATE OR REPLACE TRIGGER "biu_10_vendor_credit_note_lines_company_guard" BEFORE INSERT OR UPDATE ON "public"."vendor_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_note_line_company_guard"();



CREATE OR REPLACE TRIGGER "biu_10_vendor_debit_note_assign_reference" BEFORE INSERT OR UPDATE ON "public"."vendor_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_debit_note_assign_reference"();



CREATE OR REPLACE TRIGGER "biu_10_vendor_debit_note_lines_company_guard" BEFORE INSERT OR UPDATE ON "public"."vendor_debit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_note_line_company_guard"();



CREATE OR REPLACE TRIGGER "biu_20_sales_credit_note_lines_hardening" BEFORE INSERT OR UPDATE ON "public"."sales_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."sales_note_line_hardening_guard"();



CREATE OR REPLACE TRIGGER "biu_20_sales_credit_note_snapshot_fiscal_fields" BEFORE UPDATE ON "public"."sales_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."sales_credit_note_snapshot_fiscal_fields"();



CREATE OR REPLACE TRIGGER "biu_20_sales_debit_note_lines_hardening" BEFORE INSERT OR UPDATE ON "public"."sales_debit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."sales_note_line_hardening_guard"();



CREATE OR REPLACE TRIGGER "biu_20_sales_debit_note_snapshot_fiscal_fields" BEFORE UPDATE ON "public"."sales_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."sales_debit_note_snapshot_fiscal_fields"();



CREATE OR REPLACE TRIGGER "biu_20_sales_invoice_lines_hardening" BEFORE INSERT OR UPDATE ON "public"."sales_invoice_lines" FOR EACH ROW EXECUTE FUNCTION "public"."sales_invoice_line_hardening_guard"();



CREATE OR REPLACE TRIGGER "biu_20_sales_invoice_snapshot_fiscal_fields" BEFORE UPDATE ON "public"."sales_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."sales_invoice_snapshot_fiscal_fields"();



CREATE OR REPLACE TRIGGER "biu_20_vendor_credit_note_lines_hardening" BEFORE INSERT OR UPDATE ON "public"."vendor_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_note_line_hardening_guard"();



CREATE OR REPLACE TRIGGER "biu_20_vendor_debit_note_lines_hardening" BEFORE INSERT OR UPDATE ON "public"."vendor_debit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_note_line_hardening_guard"();



CREATE OR REPLACE TRIGGER "biu_30_sales_credit_note_lines_parent_issue_guard" BEFORE INSERT OR UPDATE ON "public"."sales_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."sales_note_lines_parent_issue_guard"();



CREATE OR REPLACE TRIGGER "biu_30_sales_credit_note_validate_issue_mz" BEFORE UPDATE ON "public"."sales_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."sales_credit_note_validate_issue_mz"();



CREATE OR REPLACE TRIGGER "biu_30_sales_debit_note_lines_parent_issue_guard" BEFORE INSERT OR UPDATE ON "public"."sales_debit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."sales_note_lines_parent_issue_guard"();



CREATE OR REPLACE TRIGGER "biu_30_sales_debit_note_validate_issue_mz" BEFORE UPDATE ON "public"."sales_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."sales_debit_note_validate_issue_mz"();



CREATE OR REPLACE TRIGGER "biu_30_sales_invoice_lines_parent_issue_guard" BEFORE INSERT OR UPDATE ON "public"."sales_invoice_lines" FOR EACH ROW EXECUTE FUNCTION "public"."sales_invoice_lines_parent_issue_guard"();



CREATE OR REPLACE TRIGGER "biu_30_sales_invoice_validate_issue_mz" BEFORE UPDATE OF "document_workflow_status" ON "public"."sales_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."sales_invoice_validate_issue_mz"();



CREATE OR REPLACE TRIGGER "biu_30_vendor_bill_lines_parent_post_guard" BEFORE INSERT OR UPDATE ON "public"."vendor_bill_lines" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_bill_lines_parent_post_guard"();



CREATE OR REPLACE TRIGGER "biu_30_vendor_credit_note_lines_parent_status_guard" BEFORE INSERT OR UPDATE ON "public"."vendor_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_note_lines_parent_status_guard"();



CREATE OR REPLACE TRIGGER "biu_30_vendor_credit_note_validate_post" BEFORE UPDATE ON "public"."vendor_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_credit_note_validate_post"();



CREATE OR REPLACE TRIGGER "biu_30_vendor_debit_note_lines_parent_status_guard" BEFORE INSERT OR UPDATE ON "public"."vendor_debit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_note_lines_parent_status_guard"();



CREATE OR REPLACE TRIGGER "biu_30_vendor_debit_note_validate_post" BEFORE UPDATE ON "public"."vendor_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_debit_note_validate_post"();



CREATE OR REPLACE TRIGGER "biu_40_finance_document_bank_settlement_guard" BEFORE INSERT OR UPDATE ON "public"."bank_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_settlement_guard"();



CREATE OR REPLACE TRIGGER "biu_40_finance_document_cash_settlement_guard" BEFORE INSERT OR UPDATE ON "public"."cash_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_settlement_guard"();



CREATE OR REPLACE TRIGGER "biu_40_finance_document_company_settings_guard" BEFORE INSERT OR UPDATE ON "public"."company_settings" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_company_settings_guard"();



CREATE OR REPLACE TRIGGER "biu_40_sales_credit_note_hardening" BEFORE INSERT OR UPDATE ON "public"."sales_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."sales_credit_note_hardening_guard"();



CREATE OR REPLACE TRIGGER "biu_40_sales_debit_note_hardening" BEFORE INSERT OR UPDATE ON "public"."sales_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."sales_debit_note_hardening_guard"();



CREATE OR REPLACE TRIGGER "biu_40_sales_invoice_hardening" BEFORE INSERT OR UPDATE ON "public"."sales_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."sales_invoice_hardening_guard"();



CREATE OR REPLACE TRIGGER "biu_40_vendor_credit_note_hardening" BEFORE INSERT OR UPDATE ON "public"."vendor_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_credit_note_hardening_guard"();



CREATE OR REPLACE TRIGGER "biu_40_vendor_debit_note_hardening" BEFORE INSERT OR UPDATE ON "public"."vendor_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_debit_note_hardening_guard"();



CREATE OR REPLACE TRIGGER "biud_40_sales_credit_note_line_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."sales_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_adjustment_line_guard"();



CREATE OR REPLACE TRIGGER "biud_40_sales_debit_note_line_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."sales_debit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_adjustment_line_guard"();



CREATE OR REPLACE TRIGGER "biud_40_sales_invoice_line_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."sales_invoice_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_base_line_guard"();



CREATE OR REPLACE TRIGGER "biud_40_vendor_bill_line_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."vendor_bill_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_base_line_guard"();



CREATE OR REPLACE TRIGGER "biud_40_vendor_credit_note_line_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."vendor_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_adjustment_line_guard"();



CREATE OR REPLACE TRIGGER "biud_40_vendor_debit_note_line_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."vendor_debit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_adjustment_line_guard"();



CREATE OR REPLACE TRIGGER "bu_90_company_fiscal_settings_touch_updated_at" BEFORE UPDATE ON "public"."company_fiscal_settings" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "bu_90_finance_document_fiscal_series_touch_updated_at" BEFORE UPDATE ON "public"."finance_document_fiscal_series" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "bu_90_sales_credit_note_lines_touch_updated_at" BEFORE UPDATE ON "public"."sales_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "bu_90_sales_credit_note_touch_updated_at" BEFORE UPDATE ON "public"."sales_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "bu_90_sales_debit_note_lines_touch_updated_at" BEFORE UPDATE ON "public"."sales_debit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "bu_90_sales_debit_note_touch_updated_at" BEFORE UPDATE ON "public"."sales_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "bu_90_sales_invoice_lines_touch_updated_at" BEFORE UPDATE ON "public"."sales_invoice_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "bu_90_sales_invoice_touch_updated_at" BEFORE UPDATE ON "public"."sales_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "bu_90_vendor_credit_note_lines_touch_updated_at" BEFORE UPDATE ON "public"."vendor_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "bu_90_vendor_credit_note_touch_updated_at" BEFORE UPDATE ON "public"."vendor_credit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "bu_90_vendor_debit_note_lines_touch_updated_at" BEFORE UPDATE ON "public"."vendor_debit_note_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "bu_90_vendor_debit_note_touch_updated_at" BEFORE UPDATE ON "public"."vendor_debit_notes" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "bu_company_purge_queue_touch_updated_at" BEFORE UPDATE ON "public"."company_purge_queue" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at_column"();



CREATE OR REPLACE TRIGGER "bu_company_subscription_state_touch_updated_at" BEFORE UPDATE ON "public"."company_subscription_state" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at_column"();



CREATE OR REPLACE TRIGGER "bu_plan_catalog_touch_updated_at" BEFORE UPDATE ON "public"."plan_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at_column"();



CREATE OR REPLACE TRIGGER "bu_platform_admins_touch_updated_at" BEFORE UPDATE ON "public"."platform_admins" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at_column"();



CREATE OR REPLACE TRIGGER "cash_book_audit" AFTER INSERT OR UPDATE OF "beginning_balance_base", "beginning_as_of" ON "public"."cash_books" FOR EACH ROW EXECUTE FUNCTION "public"."cash_book_audit_trg"();



CREATE OR REPLACE TRIGGER "company_currencies_set_defaults" BEFORE INSERT ON "public"."company_currencies" FOR EACH ROW EXECUTE FUNCTION "public"."company_currencies_bi_set_defaults"();



CREATE OR REPLACE TRIGGER "fx_rates_set_defaults" BEFORE INSERT ON "public"."fx_rates" FOR EACH ROW EXECUTE FUNCTION "public"."fx_rates_bi_set_defaults"();



CREATE OR REPLACE TRIGGER "items_set_updated_at" BEFORE UPDATE ON "public"."items" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_set_timestamp"();



CREATE OR REPLACE TRIGGER "po_awaiting_notify_trg" AFTER INSERT OR UPDATE OF "status", "total", "fx_to_base" ON "public"."purchase_orders" FOR EACH ROW EXECUTE FUNCTION "public"."tg_po_awaiting_notify"();



CREATE OR REPLACE TRIGGER "sales_shipments_sync_status_tg" AFTER INSERT ON "public"."sales_shipments" FOR EACH ROW EXECUTE FUNCTION "public"."trg_sales_shipments_sync_status"();



CREATE OR REPLACE TRIGGER "set_updated_at_whatsapp_credentials" BEFORE UPDATE ON "public"."whatsapp_credentials" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_updated_at"();



CREATE OR REPLACE TRIGGER "so_awaiting_notify_trg" AFTER INSERT OR UPDATE OF "status", "total_amount", "fx_to_base" ON "public"."sales_orders" FOR EACH ROW EXECUTE FUNCTION "public"."tg_so_awaiting_notify"();



CREATE OR REPLACE TRIGGER "so_lines_sync_status_tg" AFTER INSERT OR UPDATE OF "shipped_qty", "is_shipped" ON "public"."sales_order_lines" FOR EACH ROW EXECUTE FUNCTION "public"."trg_so_lines_sync_status"();



CREATE OR REPLACE TRIGGER "stock_movements_apply_tg" AFTER INSERT ON "public"."stock_movements" FOR EACH ROW EXECUTE FUNCTION "public"."trg_stock_movements_apply"();



CREATE OR REPLACE TRIGGER "t_pol_calc_total_insupd" BEFORE INSERT OR UPDATE ON "public"."purchase_order_lines" FOR EACH ROW EXECUTE FUNCTION "public"."trg_pol_calc_total"();



CREATE OR REPLACE TRIGGER "t_sol_calc_total_insupd" BEFORE INSERT OR UPDATE ON "public"."sales_order_lines" FOR EACH ROW EXECUTE FUNCTION "public"."trg_sol_calc_total"();



CREATE OR REPLACE TRIGGER "tr_bins_company_fill" BEFORE INSERT OR UPDATE ON "public"."bins" FOR EACH ROW EXECUTE FUNCTION "public"."tg_bins_company_fill"();



CREATE OR REPLACE TRIGGER "tr_companies_autolink" AFTER INSERT ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "public"."tg_companies_autolink"();



CREATE OR REPLACE TRIGGER "tr_movements_company_fill" BEFORE INSERT OR UPDATE ON "public"."movements" FOR EACH ROW EXECUTE FUNCTION "public"."tg_movements_company_fill"();



CREATE OR REPLACE TRIGGER "tr_po_status_notify" AFTER UPDATE OF "status" ON "public"."purchase_orders" FOR EACH ROW WHEN (("old"."status" IS DISTINCT FROM "new"."status")) EXECUTE FUNCTION "public"."tg_po_status_notify"();



CREATE OR REPLACE TRIGGER "tr_pol_company_fill" BEFORE INSERT OR UPDATE ON "public"."purchase_order_lines" FOR EACH ROW EXECUTE FUNCTION "public"."tg_pol_company_fill"();



CREATE OR REPLACE TRIGGER "tr_pol_updated_at" BEFORE UPDATE ON "public"."purchase_order_lines" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "tr_purchase_orders_company_fill" BEFORE INSERT OR UPDATE ON "public"."purchase_orders" FOR EACH ROW EXECUTE FUNCTION "public"."tg_purchase_orders_company_fill"();



CREATE OR REPLACE TRIGGER "tr_purchase_orders_updated_at" BEFORE UPDATE ON "public"."purchase_orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "tr_sales_shipments_company_fill" BEFORE INSERT OR UPDATE ON "public"."sales_shipments" FOR EACH ROW EXECUTE FUNCTION "public"."tg_sales_shipments_company_fill"();



CREATE OR REPLACE TRIGGER "tr_stock_levels_company_fill" BEFORE INSERT OR UPDATE ON "public"."stock_levels" FOR EACH ROW EXECUTE FUNCTION "public"."tg_stock_levels_company_fill"();



CREATE OR REPLACE TRIGGER "tr_stock_movements_company_fill" BEFORE INSERT OR UPDATE ON "public"."stock_movements" FOR EACH ROW EXECUTE FUNCTION "public"."tg_stock_movements_company_fill"();



CREATE OR REPLACE TRIGGER "trg_app_settings_updated_at" BEFORE INSERT OR UPDATE ON "public"."app_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at_ts"();



CREATE OR REPLACE TRIGGER "trg_block_delete_last_owner" BEFORE DELETE ON "public"."company_members" FOR EACH ROW EXECUTE FUNCTION "public"."block_delete_last_owner"();



CREATE OR REPLACE TRIGGER "trg_company_member_activated" AFTER INSERT OR UPDATE OF "status" ON "public"."company_members" FOR EACH ROW EXECUTE FUNCTION "public"."tg_notify_member_activated"();



CREATE OR REPLACE TRIGGER "trg_currencies_updated_at" BEFORE UPDATE ON "public"."currencies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_customers_set_company" BEFORE INSERT ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."customers_set_company_id"();



CREATE OR REPLACE TRIGGER "trg_customers_set_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_fx_rates_updated_at" BEFORE UPDATE ON "public"."fx_rates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_items_apply_company" BEFORE INSERT ON "public"."items" FOR EACH ROW EXECUTE FUNCTION "public"."apply_company_id"();



CREATE OR REPLACE TRIGGER "trg_items_set_company" BEFORE INSERT ON "public"."items" FOR EACH ROW EXECUTE FUNCTION "public"."set_company_id_from_session"();



CREATE OR REPLACE TRIGGER "trg_items_updated_at" BEFORE UPDATE ON "public"."items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_notifications_only_read_at" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."only_read_at_changes"();



CREATE OR REPLACE TRIGGER "trg_notify_member_activated" AFTER UPDATE ON "public"."company_members" FOR EACH ROW EXECUTE FUNCTION "public"."_notify_on_member_activated"();



CREATE OR REPLACE TRIGGER "trg_po_set_company" BEFORE INSERT ON "public"."purchase_orders" FOR EACH ROW EXECUTE FUNCTION "public"."po_set_company_id_and_number"();



CREATE OR REPLACE TRIGGER "trg_po_status_notify" AFTER UPDATE OF "status" ON "public"."purchase_orders" FOR EACH ROW EXECUTE FUNCTION "public"."tg_po_status_notify"();



CREATE OR REPLACE TRIGGER "trg_po_updated_at" BEFORE UPDATE ON "public"."purchase_orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sales_orders_set_due_date" BEFORE INSERT OR UPDATE OF "order_date", "payment_terms_id" ON "public"."sales_orders" FOR EACH ROW EXECUTE FUNCTION "public"."trg_sales_orders_set_due_date"();



CREATE OR REPLACE TRIGGER "trg_sales_shipments_recalc_line_del" AFTER DELETE ON "public"."sales_shipments" FOR EACH ROW EXECUTE FUNCTION "public"."tg_sales_shipments_recalc_line"();



CREATE OR REPLACE TRIGGER "trg_sales_shipments_recalc_line_ins" AFTER INSERT ON "public"."sales_shipments" FOR EACH ROW EXECUTE FUNCTION "public"."tg_sales_shipments_recalc_line"();



CREATE OR REPLACE TRIGGER "trg_sales_shipments_recalc_line_upd" AFTER UPDATE ON "public"."sales_shipments" FOR EACH ROW EXECUTE FUNCTION "public"."tg_sales_shipments_recalc_line"();



CREATE OR REPLACE TRIGGER "trg_sales_shipments_sync" AFTER INSERT OR DELETE OR UPDATE ON "public"."sales_shipments" FOR EACH ROW EXECUTE FUNCTION "public"."tg_sales_shipments_sync"();



CREATE OR REPLACE TRIGGER "trg_settings_updated_at" BEFORE UPDATE ON "public"."settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_so_line_set_company" BEFORE INSERT OR UPDATE OF "so_id" ON "public"."sales_order_lines" FOR EACH ROW EXECUTE FUNCTION "public"."so_line_set_company_id"();



CREATE OR REPLACE TRIGGER "trg_so_set_company" BEFORE INSERT ON "public"."sales_orders" FOR EACH ROW EXECUTE FUNCTION "public"."so_set_company_id_and_number"();



CREATE OR REPLACE TRIGGER "trg_so_set_due_date_ins" BEFORE INSERT ON "public"."sales_orders" FOR EACH ROW EXECUTE FUNCTION "public"."so_set_due_date"();



CREATE OR REPLACE TRIGGER "trg_so_set_due_date_upd" BEFORE UPDATE OF "payment_terms_id", "order_date" ON "public"."sales_orders" FOR EACH ROW WHEN (("new"."due_date" IS NULL)) EXECUTE FUNCTION "public"."so_set_due_date"();



CREATE OR REPLACE TRIGGER "trg_so_updated_at" BEFORE UPDATE ON "public"."sales_orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sol_recompute_is_shipped" BEFORE INSERT OR UPDATE OF "qty", "shipped_qty" ON "public"."sales_order_lines" FOR EACH ROW EXECUTE FUNCTION "public"."_sol_recompute_is_shipped"();



CREATE OR REPLACE TRIGGER "trg_sol_status_on_edit" AFTER UPDATE OF "is_shipped", "shipped_qty" ON "public"."sales_order_lines" FOR EACH ROW EXECUTE FUNCTION "public"."tg_sol_status_on_edit"();



CREATE OR REPLACE TRIGGER "trg_solines_status_sync" AFTER UPDATE OF "shipped_qty", "is_shipped" ON "public"."sales_order_lines" FOR EACH ROW EXECUTE FUNCTION "public"."tg_solines_status_sync"();



CREATE OR REPLACE TRIGGER "trg_stock_movements_issue_so" AFTER INSERT ON "public"."stock_movements" FOR EACH ROW EXECUTE FUNCTION "public"."fn_record_revenue_on_issue_so"();



CREATE OR REPLACE TRIGGER "trg_suppliers_set_company" BEFORE INSERT ON "public"."suppliers" FOR EACH ROW EXECUTE FUNCTION "public"."set_company_id_from_session"();



CREATE OR REPLACE TRIGGER "trg_suppliers_updated" BEFORE UPDATE ON "public"."suppliers" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sync_customer_terms_text" BEFORE INSERT OR UPDATE OF "payment_terms_id" ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."sync_customer_payment_terms_text"();



CREATE OR REPLACE TRIGGER "trg_sync_payment_terms_customers" BEFORE INSERT OR UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."sync_payment_terms_customers"();



CREATE OR REPLACE TRIGGER "trg_sync_payment_terms_sales_orders" BEFORE INSERT OR UPDATE ON "public"."sales_orders" FOR EACH ROW EXECUTE FUNCTION "public"."sync_payment_terms_sales_orders"();



CREATE OR REPLACE TRIGGER "trg_sync_profiles_user_id" BEFORE INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."sync_profiles_user_id"();



CREATE OR REPLACE TRIGGER "trg_uom_conv_family" BEFORE INSERT OR UPDATE ON "public"."uom_conversions" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_same_family"();



CREATE OR REPLACE TRIGGER "trg_warehouses_set_updatedat" BEFORE UPDATE ON "public"."warehouses" FOR EACH ROW EXECUTE FUNCTION "public"."warehouses_set_updatedat"();



CREATE OR REPLACE TRIGGER "trg_warehouses_touch_updated" BEFORE UPDATE ON "public"."warehouses" FOR EACH ROW EXECUTE FUNCTION "public"."warehouses_touch_updated"();



CREATE OR REPLACE TRIGGER "user_profiles_set_updated_at" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "vendor_bill_lines_company_guard" BEFORE INSERT OR UPDATE ON "public"."vendor_bill_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_document_line_company_guard"();



CREATE OR REPLACE TRIGGER "vendor_bill_lines_hardening" BEFORE INSERT OR UPDATE ON "public"."vendor_bill_lines" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_bill_line_hardening_guard"();



CREATE OR REPLACE TRIGGER "vendor_bill_lines_touch_updated_at" BEFORE UPDATE ON "public"."vendor_bill_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "vendor_bills_assign_reference" BEFORE INSERT OR UPDATE ON "public"."vendor_bills" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_bill_assign_reference"();



CREATE OR REPLACE TRIGGER "vendor_bills_hardening" BEFORE INSERT OR UPDATE ON "public"."vendor_bills" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_bill_hardening_guard"();



CREATE OR REPLACE TRIGGER "vendor_bills_touch_updated_at" BEFORE UPDATE ON "public"."vendor_bills" FOR EACH ROW EXECUTE FUNCTION "public"."finance_documents_touch_updated_at"();



CREATE OR REPLACE TRIGGER "enforce_bucket_name_length_trigger" BEFORE INSERT OR UPDATE OF "name" ON "storage"."buckets" FOR EACH ROW EXECUTE FUNCTION "storage"."enforce_bucket_name_length"();



CREATE OR REPLACE TRIGGER "protect_buckets_delete" BEFORE DELETE ON "storage"."buckets" FOR EACH STATEMENT EXECUTE FUNCTION "storage"."protect_delete"();



CREATE OR REPLACE TRIGGER "protect_objects_delete" BEFORE DELETE ON "storage"."objects" FOR EACH STATEMENT EXECUTE FUNCTION "storage"."protect_delete"();



CREATE OR REPLACE TRIGGER "update_objects_updated_at" BEFORE UPDATE ON "storage"."objects" FOR EACH ROW EXECUTE FUNCTION "storage"."update_updated_at_column"();



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bank_accounts"
    ADD CONSTRAINT "bank_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_statements"
    ADD CONSTRAINT "bank_statements_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "public"."bank_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "public"."bank_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bins"
    ADD CONSTRAINT "bins_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."bins"
    ADD CONSTRAINT "bins_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bom_components"
    ADD CONSTRAINT "bom_components_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bom_components"
    ADD CONSTRAINT "bom_components_component_item_id_fkey" FOREIGN KEY ("component_item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."boms"
    ADD CONSTRAINT "boms_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."boms"
    ADD CONSTRAINT "boms_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_bin_from_id_fkey" FOREIGN KEY ("bin_from_id") REFERENCES "public"."bins"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_bin_to_id_fkey" FOREIGN KEY ("bin_to_id") REFERENCES "public"."bins"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_warehouse_from_id_fkey" FOREIGN KEY ("warehouse_from_id") REFERENCES "public"."warehouses"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_warehouse_to_id_fkey" FOREIGN KEY ("warehouse_to_id") REFERENCES "public"."warehouses"("id");



ALTER TABLE ONLY "public"."cash_books"
    ADD CONSTRAINT "cash_books_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_transactions"
    ADD CONSTRAINT "cash_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."company_access_audit_log"
    ADD CONSTRAINT "company_access_audit_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_access_audit_log"
    ADD CONSTRAINT "company_access_audit_log_next_plan_code_fkey" FOREIGN KEY ("next_plan_code") REFERENCES "public"."plan_catalog"("code");



ALTER TABLE ONLY "public"."company_access_audit_log"
    ADD CONSTRAINT "company_access_audit_log_previous_plan_code_fkey" FOREIGN KEY ("previous_plan_code") REFERENCES "public"."plan_catalog"("code");



ALTER TABLE ONLY "public"."company_control_action_log"
    ADD CONSTRAINT "company_control_action_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."company_control_action_log"
    ADD CONSTRAINT "company_control_action_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_currencies"
    ADD CONSTRAINT "company_currencies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_currencies"
    ADD CONSTRAINT "company_currencies_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."company_fiscal_settings"
    ADD CONSTRAINT "company_fiscal_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_invites"
    ADD CONSTRAINT "company_invites_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_members"
    ADD CONSTRAINT "company_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_members"
    ADD CONSTRAINT "company_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."company_members"
    ADD CONSTRAINT "company_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."company_purge_queue"
    ADD CONSTRAINT "company_purge_queue_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_settings"
    ADD CONSTRAINT "company_settings_base_currency_code_fkey" FOREIGN KEY ("base_currency_code") REFERENCES "public"."currencies"("code") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."company_settings"
    ADD CONSTRAINT "company_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_settings"
    ADD CONSTRAINT "company_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."company_subscription_state"
    ADD CONSTRAINT "company_subscription_state_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_subscription_state"
    ADD CONSTRAINT "company_subscription_state_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "public"."plan_catalog"("code");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_payment_terms_id_fkey" FOREIGN KEY ("payment_terms_id") REFERENCES "public"."payment_terms"("id");



ALTER TABLE ONLY "public"."document_number_counters"
    ADD CONSTRAINT "document_number_counters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."finance_document_events"
    ADD CONSTRAINT "finance_document_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."finance_document_events"
    ADD CONSTRAINT "finance_document_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."finance_document_fiscal_series"
    ADD CONSTRAINT "finance_document_fiscal_series_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fiscal_document_artifacts"
    ADD CONSTRAINT "fiscal_document_artifacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fiscal_document_artifacts"
    ADD CONSTRAINT "fiscal_document_artifacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "fk_customers_payment_terms" FOREIGN KEY ("payment_terms_id") REFERENCES "public"."payment_terms"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."due_reminder_queue"
    ADD CONSTRAINT "fk_due_queue_company" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "fk_sales_orders_payment_terms" FOREIGN KEY ("payment_terms_id") REFERENCES "public"."payment_terms"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_order_lines"
    ADD CONSTRAINT "fk_sol_so_same_company" FOREIGN KEY ("so_id", "company_id") REFERENCES "public"."sales_orders"("id", "company_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fx_rates"
    ADD CONSTRAINT "fx_rates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."fx_rates"
    ADD CONSTRAINT "fx_rates_from_code_fkey" FOREIGN KEY ("from_code") REFERENCES "public"."currencies"("code") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fx_rates"
    ADD CONSTRAINT "fx_rates_to_code_fkey" FOREIGN KEY ("to_code") REFERENCES "public"."currencies"("code") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_base_uom_id_fkey" FOREIGN KEY ("base_uom_id") REFERENCES "public"."uoms"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."landed_cost_run_lines"
    ADD CONSTRAINT "landed_cost_run_lines_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "public"."bins"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."landed_cost_run_lines"
    ADD CONSTRAINT "landed_cost_run_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."landed_cost_run_lines"
    ADD CONSTRAINT "landed_cost_run_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."landed_cost_run_lines"
    ADD CONSTRAINT "landed_cost_run_lines_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."landed_cost_run_lines"
    ADD CONSTRAINT "landed_cost_run_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."landed_cost_run_lines"
    ADD CONSTRAINT "landed_cost_run_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."landed_cost_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."landed_cost_run_lines"
    ADD CONSTRAINT "landed_cost_run_lines_stock_level_id_fkey" FOREIGN KEY ("stock_level_id") REFERENCES "public"."stock_levels"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."landed_cost_run_lines"
    ADD CONSTRAINT "landed_cost_run_lines_stock_movement_id_fkey" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."landed_cost_run_lines"
    ADD CONSTRAINT "landed_cost_run_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."landed_cost_runs"
    ADD CONSTRAINT "landed_cost_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."landed_cost_runs"
    ADD CONSTRAINT "landed_cost_runs_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."landed_cost_runs"
    ADD CONSTRAINT "landed_cost_runs_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_from_bin_fk" FOREIGN KEY ("from_bin_id") REFERENCES "public"."bins"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_from_bin_matches_wh_fk" FOREIGN KEY ("from_bin_id", "from_warehouse_id") REFERENCES "public"."bins"("id", "warehouseId") ON DELETE SET NULL DEFERRABLE;



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_to_bin_fk" FOREIGN KEY ("to_bin_id") REFERENCES "public"."bins"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_to_bin_matches_wh_fk" FOREIGN KEY ("to_bin_id", "to_warehouse_id") REFERENCES "public"."bins"("id", "warehouseId") ON DELETE SET NULL DEFERRABLE;



ALTER TABLE ONLY "public"."movements"
    ADD CONSTRAINT "movements_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_counters"
    ADD CONSTRAINT "order_counters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_terms"
    ADD CONSTRAINT "payment_terms_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_default_org_id_fkey" FOREIGN KEY ("default_org_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."purchase_order_lines"
    ADD CONSTRAINT "purchase_order_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."purchase_order_lines"
    ADD CONSTRAINT "purchase_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_order_lines"
    ADD CONSTRAINT "purchase_order_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_order_lines"
    ADD CONSTRAINT "purchase_order_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_payment_terms_id_fkey" FOREIGN KEY ("payment_terms_id") REFERENCES "public"."payment_terms"("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."saft_moz_exports"
    ADD CONSTRAINT "saft_moz_exports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saft_moz_exports"
    ADD CONSTRAINT "saft_moz_exports_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."saft_moz_exports"
    ADD CONSTRAINT "saft_moz_exports_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."saft_moz_exports"
    ADD CONSTRAINT "saft_moz_exports_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_credit_note_lines"
    ADD CONSTRAINT "sales_credit_note_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_credit_note_lines"
    ADD CONSTRAINT "sales_credit_note_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_credit_note_lines"
    ADD CONSTRAINT "sales_credit_note_lines_sales_credit_note_id_fkey" FOREIGN KEY ("sales_credit_note_id") REFERENCES "public"."sales_credit_notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_credit_note_lines"
    ADD CONSTRAINT "sales_credit_note_lines_sales_invoice_line_id_fkey" FOREIGN KEY ("sales_invoice_line_id") REFERENCES "public"."sales_invoice_lines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_credit_notes"
    ADD CONSTRAINT "sales_credit_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_credit_notes"
    ADD CONSTRAINT "sales_credit_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_credit_notes"
    ADD CONSTRAINT "sales_credit_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_credit_notes"
    ADD CONSTRAINT "sales_credit_notes_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_credit_notes"
    ADD CONSTRAINT "sales_credit_notes_original_sales_invoice_id_fkey" FOREIGN KEY ("original_sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sales_credit_notes"
    ADD CONSTRAINT "sales_credit_notes_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_debit_note_lines"
    ADD CONSTRAINT "sales_debit_note_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_debit_note_lines"
    ADD CONSTRAINT "sales_debit_note_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_debit_note_lines"
    ADD CONSTRAINT "sales_debit_note_lines_sales_debit_note_id_fkey" FOREIGN KEY ("sales_debit_note_id") REFERENCES "public"."sales_debit_notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_debit_note_lines"
    ADD CONSTRAINT "sales_debit_note_lines_sales_invoice_line_id_fkey" FOREIGN KEY ("sales_invoice_line_id") REFERENCES "public"."sales_invoice_lines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_debit_notes"
    ADD CONSTRAINT "sales_debit_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_debit_notes"
    ADD CONSTRAINT "sales_debit_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_debit_notes"
    ADD CONSTRAINT "sales_debit_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_debit_notes"
    ADD CONSTRAINT "sales_debit_notes_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_debit_notes"
    ADD CONSTRAINT "sales_debit_notes_original_sales_invoice_id_fkey" FOREIGN KEY ("original_sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sales_debit_notes"
    ADD CONSTRAINT "sales_debit_notes_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_invoice_lines"
    ADD CONSTRAINT "sales_invoice_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_invoice_lines"
    ADD CONSTRAINT "sales_invoice_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_invoice_lines"
    ADD CONSTRAINT "sales_invoice_lines_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_invoice_lines"
    ADD CONSTRAINT "sales_invoice_lines_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_invoices"
    ADD CONSTRAINT "sales_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_invoices"
    ADD CONSTRAINT "sales_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_invoices"
    ADD CONSTRAINT "sales_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_invoices"
    ADD CONSTRAINT "sales_invoices_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_invoices"
    ADD CONSTRAINT "sales_invoices_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_invoices"
    ADD CONSTRAINT "sales_invoices_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_order_lines"
    ADD CONSTRAINT "sales_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sales_order_lines"
    ADD CONSTRAINT "sales_order_lines_so_id_fkey" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_order_lines"
    ADD CONSTRAINT "sales_order_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_payment_terms_id_fkey" FOREIGN KEY ("payment_terms_id") REFERENCES "public"."payment_terms"("id");



ALTER TABLE ONLY "public"."sales_shipments"
    ADD CONSTRAINT "sales_shipments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."sales_shipments"
    ADD CONSTRAINT "sales_shipments_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."sales_shipments"
    ADD CONSTRAINT "sales_shipments_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_shipments"
    ADD CONSTRAINT "sales_shipments_so_id_fkey" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id");



ALTER TABLE ONLY "public"."sales_shipments"
    ADD CONSTRAINT "sales_shipments_so_line_id_fkey" FOREIGN KEY ("so_line_id") REFERENCES "public"."sales_order_lines"("id");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_base_currency_code_fkey" FOREIGN KEY ("base_currency_code") REFERENCES "public"."currencies"("code") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_levels"
    ADD CONSTRAINT "stock_levels_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "public"."bins"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stock_levels"
    ADD CONSTRAINT "stock_levels_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."stock_levels"
    ADD CONSTRAINT "stock_levels_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_levels"
    ADD CONSTRAINT "stock_levels_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_bin_from_id_fkey" FOREIGN KEY ("bin_from_id") REFERENCES "public"."bins"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_bin_to_id_fkey" FOREIGN KEY ("bin_to_id") REFERENCES "public"."bins"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_warehouse_from_id_fkey" FOREIGN KEY ("warehouse_from_id") REFERENCES "public"."warehouses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_warehouse_to_id_fkey" FOREIGN KEY ("warehouse_to_id") REFERENCES "public"."warehouses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_payment_terms_id_fkey" FOREIGN KEY ("payment_terms_id") REFERENCES "public"."payment_terms"("id");



ALTER TABLE ONLY "public"."uom_conversions"
    ADD CONSTRAINT "uom_conversions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."uom_conversions"
    ADD CONSTRAINT "uom_conversions_from_uom_id_fkey" FOREIGN KEY ("from_uom_id") REFERENCES "public"."uoms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."uom_conversions"
    ADD CONSTRAINT "uom_conversions_to_uom_id_fkey" FOREIGN KEY ("to_uom_id") REFERENCES "public"."uoms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_active_company"
    ADD CONSTRAINT "user_active_company_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_active_company"
    ADD CONSTRAINT "user_active_company_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_active_company_id_fkey" FOREIGN KEY ("active_company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_bill_lines"
    ADD CONSTRAINT "vendor_bill_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_bill_lines"
    ADD CONSTRAINT "vendor_bill_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_bill_lines"
    ADD CONSTRAINT "vendor_bill_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_bill_lines"
    ADD CONSTRAINT "vendor_bill_lines_vendor_bill_id_fkey" FOREIGN KEY ("vendor_bill_id") REFERENCES "public"."vendor_bills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_bills"
    ADD CONSTRAINT "vendor_bills_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_bills"
    ADD CONSTRAINT "vendor_bills_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_bills"
    ADD CONSTRAINT "vendor_bills_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_bills"
    ADD CONSTRAINT "vendor_bills_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_bills"
    ADD CONSTRAINT "vendor_bills_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_bills"
    ADD CONSTRAINT "vendor_bills_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_credit_note_lines"
    ADD CONSTRAINT "vendor_credit_note_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_credit_note_lines"
    ADD CONSTRAINT "vendor_credit_note_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_credit_note_lines"
    ADD CONSTRAINT "vendor_credit_note_lines_vendor_bill_line_id_fkey" FOREIGN KEY ("vendor_bill_line_id") REFERENCES "public"."vendor_bill_lines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_credit_note_lines"
    ADD CONSTRAINT "vendor_credit_note_lines_vendor_credit_note_id_fkey" FOREIGN KEY ("vendor_credit_note_id") REFERENCES "public"."vendor_credit_notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_credit_notes"
    ADD CONSTRAINT "vendor_credit_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_credit_notes"
    ADD CONSTRAINT "vendor_credit_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_credit_notes"
    ADD CONSTRAINT "vendor_credit_notes_original_vendor_bill_id_fkey" FOREIGN KEY ("original_vendor_bill_id") REFERENCES "public"."vendor_bills"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vendor_credit_notes"
    ADD CONSTRAINT "vendor_credit_notes_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_credit_notes"
    ADD CONSTRAINT "vendor_credit_notes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_credit_notes"
    ADD CONSTRAINT "vendor_credit_notes_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_debit_note_lines"
    ADD CONSTRAINT "vendor_debit_note_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_debit_note_lines"
    ADD CONSTRAINT "vendor_debit_note_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_debit_note_lines"
    ADD CONSTRAINT "vendor_debit_note_lines_vendor_bill_line_id_fkey" FOREIGN KEY ("vendor_bill_line_id") REFERENCES "public"."vendor_bill_lines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_debit_note_lines"
    ADD CONSTRAINT "vendor_debit_note_lines_vendor_debit_note_id_fkey" FOREIGN KEY ("vendor_debit_note_id") REFERENCES "public"."vendor_debit_notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_debit_notes"
    ADD CONSTRAINT "vendor_debit_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_debit_notes"
    ADD CONSTRAINT "vendor_debit_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_debit_notes"
    ADD CONSTRAINT "vendor_debit_notes_original_vendor_bill_id_fkey" FOREIGN KEY ("original_vendor_bill_id") REFERENCES "public"."vendor_bills"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vendor_debit_notes"
    ADD CONSTRAINT "vendor_debit_notes_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_debit_notes"
    ADD CONSTRAINT "vendor_debit_notes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_debit_notes"
    ADD CONSTRAINT "vendor_debit_notes_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warehouses"
    ADD CONSTRAINT "warehouses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."whatsapp_credentials"
    ADD CONSTRAINT "whatsapp_credentials_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_outbox"
    ADD CONSTRAINT "whatsapp_outbox_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."whatsapp_webhook_events"
    ADD CONSTRAINT "whatsapp_webhook_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



CREATE POLICY "_delete_delete" ON "public"."order_counters" FOR DELETE USING ((EXISTS ( SELECT 1
  WHERE "public"."is_member_of_company"("order_counters"."company_id"))));



CREATE POLICY "_insert_insert" ON "public"."order_counters" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
  WHERE "public"."is_member_of_company"("order_counters"."company_id"))));



CREATE POLICY "_select_select" ON "public"."order_counters" FOR SELECT USING ((EXISTS ( SELECT 1
  WHERE "public"."is_member_of_company"("order_counters"."company_id"))));



CREATE POLICY "_update_update" ON "public"."order_counters" FOR UPDATE USING ((EXISTS ( SELECT 1
  WHERE "public"."is_member_of_company"("order_counters"."company_id")))) WITH CHECK ((EXISTS ( SELECT 1
  WHERE "public"."is_member_of_company"("order_counters"."company_id"))));



ALTER TABLE "public"."ai_command_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_ops_allowlist" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_probe" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_schema_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_tmp_probe" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_secrets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_secrets_service_only" ON "public"."app_secrets" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_settings_insert_app" ON "public"."app_settings" FOR INSERT TO "authenticated", "anon" WITH CHECK (("id" = 'app'::"text"));



ALTER TABLE "public"."bank_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bank_accounts_delete_manager_plus" ON "public"."bank_accounts" FOR DELETE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



CREATE POLICY "bank_accounts_insert_manager_plus" ON "public"."bank_accounts" FOR INSERT TO "authenticated" WITH CHECK (((COALESCE("company_id", "public"."current_company_id"()) = "public"."current_company_id"()) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



CREATE POLICY "bank_accounts_select_active_company" ON "public"."bank_accounts" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "bank_accounts_update_manager_plus" ON "public"."bank_accounts" FOR UPDATE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"]))) WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



ALTER TABLE "public"."bank_statements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bank_statements_delete_active_company" ON "public"."bank_statements" FOR DELETE TO "authenticated" USING ((("reconciled" = false) AND (EXISTS ( SELECT 1
   FROM "public"."bank_accounts" "ba"
  WHERE (("ba"."id" = "bank_statements"."bank_id") AND ("ba"."company_id" = "public"."current_company_id"())))) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role", 'VIEWER'::"public"."member_role"])));



CREATE POLICY "bank_statements_insert_active_company" ON "public"."bank_statements" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."bank_accounts" "ba"
  WHERE (("ba"."id" = "bank_statements"."bank_id") AND ("ba"."company_id" = "public"."current_company_id"())))) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role", 'VIEWER'::"public"."member_role"])));



CREATE POLICY "bank_statements_select_active_company" ON "public"."bank_statements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bank_accounts" "ba"
  WHERE (("ba"."id" = "bank_statements"."bank_id") AND ("ba"."company_id" = "public"."current_company_id"())))));



CREATE POLICY "bank_statements_update_active_company" ON "public"."bank_statements" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."bank_accounts" "ba"
  WHERE (("ba"."id" = "bank_statements"."bank_id") AND ("ba"."company_id" = "public"."current_company_id"())))) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role", 'VIEWER'::"public"."member_role"]))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."bank_accounts" "ba"
  WHERE (("ba"."id" = "bank_statements"."bank_id") AND ("ba"."company_id" = "public"."current_company_id"())))) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role", 'VIEWER'::"public"."member_role"])));



ALTER TABLE "public"."bank_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bank_transactions_insert_active_company" ON "public"."bank_transactions" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."bank_accounts" "ba"
  WHERE (("ba"."id" = "bank_transactions"."bank_id") AND ("ba"."company_id" = "public"."current_company_id"())))) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role", 'VIEWER'::"public"."member_role"])));



CREATE POLICY "bank_transactions_select_active_company" ON "public"."bank_transactions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bank_accounts" "ba"
  WHERE (("ba"."id" = "bank_transactions"."bank_id") AND ("ba"."company_id" = "public"."current_company_id"())))));



CREATE POLICY "bank_transactions_update_active_company" ON "public"."bank_transactions" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."bank_accounts" "ba"
  WHERE (("ba"."id" = "bank_transactions"."bank_id") AND ("ba"."company_id" = "public"."current_company_id"())))) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role", 'VIEWER'::"public"."member_role"]))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."bank_accounts" "ba"
  WHERE (("ba"."id" = "bank_transactions"."bank_id") AND ("ba"."company_id" = "public"."current_company_id"())))) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role", 'VIEWER'::"public"."member_role"])));



ALTER TABLE "public"."bins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bins_delete_manager_plus_scoped" ON "public"."bins" FOR DELETE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



CREATE POLICY "bins_insert_operator_plus_scoped" ON "public"."bins" FOR INSERT TO "authenticated" WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]) AND (EXISTS ( SELECT 1
   FROM "public"."warehouses" "w"
  WHERE (("w"."id" = "bins"."warehouseId") AND ("w"."company_id" = "public"."current_company_id"()))))));



CREATE POLICY "bins_select_active_company" ON "public"."bins" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "bins_update_operator_plus_scoped" ON "public"."bins" FOR UPDATE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))) WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]) AND (EXISTS ( SELECT 1
   FROM "public"."warehouses" "w"
  WHERE (("w"."id" = "bins"."warehouseId") AND ("w"."company_id" = "public"."current_company_id"()))))));



ALTER TABLE "public"."bom_components" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bomc_all" ON "public"."bom_components" USING ((EXISTS ( SELECT 1
   FROM "public"."boms" "b"
  WHERE (("b"."id" = "bom_components"."bom_id") AND ("b"."company_id" = ANY ("public"."current_user_company_ids"())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."boms" "b"
  WHERE (("b"."id" = "bom_components"."bom_id") AND ("b"."company_id" = ANY ("public"."current_user_company_ids"()))))));



CREATE POLICY "bomc_iud" ON "public"."bom_components" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."boms" "b"
  WHERE (("b"."id" = "bom_components"."bom_id") AND "public"."is_company_member"("auth"."uid"(), "b"."company_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."boms" "b"
  WHERE (("b"."id" = "bom_components"."bom_id") AND "public"."is_company_member"("auth"."uid"(), "b"."company_id")))));



CREATE POLICY "bomc_sel" ON "public"."bom_components" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."boms" "b"
  WHERE (("b"."id" = "bom_components"."bom_id") AND "public"."is_company_member"("auth"."uid"(), "b"."company_id")))));



ALTER TABLE "public"."boms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "boms_crud" ON "public"."boms" USING (("company_id" = ANY ("public"."current_user_company_ids"()))) WITH CHECK (("company_id" = ANY ("public"."current_user_company_ids"())));



CREATE POLICY "boms_iud" ON "public"."boms" TO "authenticated" USING ("public"."is_company_member"("auth"."uid"(), "company_id")) WITH CHECK ("public"."is_company_member"("auth"."uid"(), "company_id"));



CREATE POLICY "boms_sel" ON "public"."boms" FOR SELECT TO "authenticated" USING ("public"."is_company_member"("auth"."uid"(), "company_id"));



CREATE POLICY "boms_select" ON "public"."boms" FOR SELECT USING (("company_id" = ANY ("public"."current_user_company_ids"())));



ALTER TABLE "public"."builds" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "builds_del" ON "public"."builds" FOR DELETE TO "authenticated" USING ("public"."is_company_member"("auth"."uid"(), "company_id"));



CREATE POLICY "builds_ins" ON "public"."builds" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_company_member"("auth"."uid"(), "company_id"));



CREATE POLICY "builds_sel" ON "public"."builds" FOR SELECT TO "authenticated" USING ("public"."is_company_member"("auth"."uid"(), "company_id"));



CREATE POLICY "builds_upd" ON "public"."builds" FOR UPDATE TO "authenticated" USING ("public"."is_company_member"("auth"."uid"(), "company_id")) WITH CHECK ("public"."is_company_member"("auth"."uid"(), "company_id"));



ALTER TABLE "public"."cash_books" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cash_books_insert_manager_plus" ON "public"."cash_books" FOR INSERT TO "authenticated" WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



CREATE POLICY "cash_books_select_active_company" ON "public"."cash_books" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "cash_books_update_manager_plus" ON "public"."cash_books" FOR UPDATE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"]))) WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



ALTER TABLE "public"."cash_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cash_transactions_insert_active_company" ON "public"."cash_transactions" FOR INSERT TO "authenticated" WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role", 'VIEWER'::"public"."member_role"])));



CREATE POLICY "cash_transactions_select_active_company" ON "public"."cash_transactions" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "cm_delete_mgr_plus" ON "public"."company_members" FOR DELETE TO "authenticated" USING ((("company_id" = ANY ("public"."current_user_company_ids"())) AND ("public"."role_rank"("public"."actor_role_for"("company_id")) >= "public"."role_rank"('MANAGER'::"public"."member_role")) AND ("public"."role_rank"("role") <= "public"."role_rank"("public"."actor_role_for"("company_id"))) AND ("user_id" IS DISTINCT FROM "auth"."uid"())));



CREATE POLICY "cm_insert_mgr_plus" ON "public"."company_members" FOR INSERT TO "authenticated" WITH CHECK ((("company_id" = ANY ("public"."current_user_company_ids"())) AND ("public"."role_rank"("public"."actor_role_for"("company_id")) >= "public"."role_rank"('MANAGER'::"public"."member_role")) AND ("public"."role_rank"("role") <= "public"."role_rank"("public"."actor_role_for"("company_id"))) AND (("role" <> 'OWNER'::"public"."member_role") OR ("public"."actor_role_for"("company_id") = 'OWNER'::"public"."member_role"))));



CREATE POLICY "cm_select_mgr_plus" ON "public"."company_members" FOR SELECT TO "authenticated" USING ((("company_id" = ANY ("public"."current_user_company_ids"())) AND ("public"."role_rank"("public"."actor_role_for"("company_id")) >= "public"."role_rank"('MANAGER'::"public"."member_role"))));



CREATE POLICY "cm_update_mgr_plus" ON "public"."company_members" FOR UPDATE TO "authenticated" USING ((("company_id" = ANY ("public"."current_user_company_ids"())) AND ("public"."role_rank"("public"."actor_role_for"("company_id")) >= "public"."role_rank"('MANAGER'::"public"."member_role")) AND ("public"."role_rank"("role") <= "public"."role_rank"("public"."actor_role_for"("company_id"))))) WITH CHECK ((("public"."role_rank"("public"."actor_role_for"("company_id")) >= "public"."role_rank"('MANAGER'::"public"."member_role")) AND ("public"."role_rank"("role") <= "public"."role_rank"("public"."actor_role_for"("company_id"))) AND (("role" <> 'OWNER'::"public"."member_role") OR ("public"."actor_role_for"("company_id") = 'OWNER'::"public"."member_role"))));



ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "companies.insert.own" ON "public"."companies" FOR INSERT TO "authenticated" WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "companies_by_membership" ON "public"."companies" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "companies"."id") AND (("cm"."user_id" = "auth"."uid"()) OR ("cm"."email" = "auth"."email"())) AND ("cm"."status" = ANY (ARRAY['active'::"public"."member_status", 'invited'::"public"."member_status"]))))));



CREATE POLICY "companies_member_select" ON "public"."companies" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "companies"."id") AND (("m"."user_id" = "auth"."uid"()) OR (("m"."email" IS NOT NULL) AND ("lower"("m"."email") = "lower"(COALESCE(("auth"."jwt"() ->> 'email'::"text"), ''::"text"))))) AND ("m"."status" = ANY (ARRAY['active'::"public"."member_status", 'invited'::"public"."member_status"]))))));



CREATE POLICY "companies_select_if_member" ON "public"."companies" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "companies"."id") AND (("m"."user_id" = "auth"."uid"()) OR ("lower"("m"."email") = "lower"(COALESCE("auth"."email"(), ''::"text")))) AND ("m"."status" = ANY (ARRAY['active'::"public"."member_status", 'invited'::"public"."member_status"]))))));



CREATE POLICY "companies_update_manager_plus_scoped" ON "public"."companies" FOR UPDATE TO "authenticated" USING ((("id" = "public"."current_company_id"()) AND "public"."has_company_role"("id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"]))) WITH CHECK ((("id" = "public"."current_company_id"()) AND "public"."has_company_role"("id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



ALTER TABLE "public"."company_access_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_control_action_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_currencies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_currencies_delete_operator_plus" ON "public"."company_currencies" FOR DELETE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



CREATE POLICY "company_currencies_insert_operator_plus" ON "public"."company_currencies" FOR INSERT TO "authenticated" WITH CHECK (((COALESCE("company_id", "public"."current_company_id"()) = "public"."current_company_id"()) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



CREATE POLICY "company_currencies_select_active_company" ON "public"."company_currencies" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "company_currencies_update_operator_plus" ON "public"."company_currencies" FOR UPDATE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))) WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



ALTER TABLE "public"."company_digest_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_digest_state_service_only" ON "public"."company_digest_state" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."company_fiscal_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_fiscal_settings_select" ON "public"."company_fiscal_settings" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "company_fiscal_settings_write" ON "public"."company_fiscal_settings" TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."company_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_members_select_self" ON "public"."company_members" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "company_members_self_select" ON "public"."company_members" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("email" = "auth"."email"())));



ALTER TABLE "public"."company_purge_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_settings_delete_manager_plus" ON "public"."company_settings" FOR DELETE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



CREATE POLICY "company_settings_insert_manager_plus" ON "public"."company_settings" FOR INSERT TO "authenticated" WITH CHECK (((COALESCE("company_id", "public"."current_company_id"()) = "public"."current_company_id"()) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



CREATE POLICY "company_settings_select_active_company" ON "public"."company_settings" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "company_settings_update_manager_plus" ON "public"."company_settings" FOR UPDATE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"]))) WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



ALTER TABLE "public"."company_subscription_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."currencies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "currencies_select_all" ON "public"."currencies" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "currencies_write_all" ON "public"."currencies" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers_delete_manager_plus_scoped" ON "public"."customers" FOR DELETE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



CREATE POLICY "customers_insert_operator_plus_scoped" ON "public"."customers" FOR INSERT TO "authenticated" WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



CREATE POLICY "customers_select" ON "public"."customers" FOR SELECT USING (("company_id" = ANY ("public"."current_user_company_ids"())));



CREATE POLICY "customers_update_operator_plus_scoped" ON "public"."customers" FOR UPDATE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))) WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



ALTER TABLE "public"."digest_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "digest_events_service_only" ON "public"."digest_events" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."digest_queue" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "digest_queue_service_only" ON "public"."digest_queue" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."document_number_counters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "document_number_counters_select" ON "public"."document_number_counters" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "document_number_counters_write" ON "public"."document_number_counters" TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "due_queue_insert_own_company" ON "public"."due_reminder_queue" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "due_reminder_queue"."company_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."status" = 'active'::"public"."member_status") AND ("cm"."role" = ANY (ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))))));



CREATE POLICY "due_queue_select_own_company" ON "public"."due_reminder_queue" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "due_reminder_queue"."company_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."status" = 'active'::"public"."member_status")))));



CREATE POLICY "due_queue_update_own_company" ON "public"."due_reminder_queue" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "due_reminder_queue"."company_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."status" = 'active'::"public"."member_status") AND ("cm"."role" = ANY (ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "due_reminder_queue"."company_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."status" = 'active'::"public"."member_status") AND ("cm"."role" = ANY (ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"]))))));



ALTER TABLE "public"."due_reminder_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."finance_document_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "finance_document_events_insert" ON "public"."finance_document_events" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "finance_document_events_select" ON "public"."finance_document_events" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



ALTER TABLE "public"."finance_document_fiscal_series" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "finance_document_fiscal_series_select" ON "public"."finance_document_fiscal_series" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "finance_document_fiscal_series_write" ON "public"."finance_document_fiscal_series" TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."fiscal_document_artifacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fiscal_document_artifacts_select" ON "public"."fiscal_document_artifacts" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



ALTER TABLE "public"."fx_rates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fx_rates_delete_operator_plus" ON "public"."fx_rates" FOR DELETE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



CREATE POLICY "fx_rates_insert_operator_plus" ON "public"."fx_rates" FOR INSERT TO "authenticated" WITH CHECK (((COALESCE("company_id", "public"."current_company_id"()) = "public"."current_company_id"()) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



CREATE POLICY "fx_rates_select_active_company" ON "public"."fx_rates" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "fx_rates_update_operator_plus" ON "public"."fx_rates" FOR UPDATE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))) WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



ALTER TABLE "public"."inventory_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inventory_movements_select_active_company" ON "public"."inventory_movements" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "invites_insert" ON "public"."company_invites" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_invite_admins"("company_id"));



CREATE POLICY "invites_select" ON "public"."company_invites" FOR SELECT TO "authenticated" USING ("public"."can_invite_admins"("company_id"));



CREATE POLICY "invites_update" ON "public"."company_invites" FOR UPDATE TO "authenticated" USING ("public"."can_invite_admins"("company_id")) WITH CHECK ("public"."can_invite_admins"("company_id"));



ALTER TABLE "public"."item_moving_average" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "item_moving_average_select_active_company" ON "public"."item_moving_average" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "items_crud" ON "public"."items" USING (("company_id" = ANY ("public"."current_user_company_ids"()))) WITH CHECK (("company_id" = ANY ("public"."current_user_company_ids"())));



CREATE POLICY "items_delete" ON "public"."items" FOR DELETE USING ((EXISTS ( SELECT 1
  WHERE (("items"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("items"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])))));



CREATE POLICY "items_insert" ON "public"."items" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
  WHERE "public"."has_company_role"(COALESCE("items"."company_id", "public"."current_company_id"()), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))));



CREATE POLICY "items_select" ON "public"."items" FOR SELECT USING (("company_id" = ANY ("public"."current_user_company_ids"())));



CREATE POLICY "items_select_active_company" ON "public"."items" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "items_update" ON "public"."items" FOR UPDATE USING (("company_id" = "public"."current_company_id"())) WITH CHECK (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."landed_cost_run_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "landed_cost_run_lines_insert_member" ON "public"."landed_cost_run_lines" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
  WHERE ((COALESCE("landed_cost_run_lines"."company_id", "public"."current_company_id"()) = "public"."current_company_id"()) AND "public"."has_company_role"(COALESCE("landed_cost_run_lines"."company_id", "public"."current_company_id"()), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])))));



CREATE POLICY "landed_cost_run_lines_select_active_company" ON "public"."landed_cost_run_lines" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."landed_cost_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "landed_cost_runs_insert_member" ON "public"."landed_cost_runs" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
  WHERE ((COALESCE("landed_cost_runs"."company_id", "public"."current_company_id"()) = "public"."current_company_id"()) AND "public"."has_company_role"(COALESCE("landed_cost_runs"."company_id", "public"."current_company_id"()), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])))));



CREATE POLICY "landed_cost_runs_select_active_company" ON "public"."landed_cost_runs" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "landed_cost_runs_update_member" ON "public"."landed_cost_runs" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
  WHERE (("landed_cost_runs"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("landed_cost_runs"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))))) WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "merged_delete" ON "public"."movements" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM ("public"."items" "i"
     JOIN "public"."company_members" "m" ON (("m"."company_id" = "i"."company_id")))
  WHERE (("i"."id" = "movements"."item_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"public"."member_status")))) OR (EXISTS ( SELECT 1
  WHERE (("movements"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("movements"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"]))))));



CREATE POLICY "merged_delete" ON "public"."purchase_order_lines" FOR DELETE USING (((EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."purchase_orders" "po"
          WHERE (("po"."id" = "purchase_order_lines"."po_id") AND ("po"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("po"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])))))) OR (EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."purchase_orders" "po"
          WHERE (("po"."id" = "purchase_order_lines"."po_id") AND "public"."has_company_role"("po"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"]))))))));



CREATE POLICY "merged_delete" ON "public"."sales_order_lines" FOR DELETE USING (((EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."sales_orders" "so"
          WHERE (("so"."id" = "sales_order_lines"."so_id") AND ("so"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("so"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])))))) OR (EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."sales_orders" "so"
          WHERE (("so"."id" = "sales_order_lines"."so_id") AND "public"."has_company_role"("so"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"]))))))));



CREATE POLICY "merged_delete" ON "public"."sales_shipments" FOR DELETE USING (((EXISTS ( SELECT 1
  WHERE (("sales_shipments"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("sales_shipments"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])))) OR (EXISTS ( SELECT 1
  WHERE "public"."has_company_role"("sales_shipments"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])))));



CREATE POLICY "merged_delete" ON "public"."stock_levels" FOR DELETE USING (((EXISTS ( SELECT 1
  WHERE "public"."is_member_of_company"("stock_levels"."company_id"))) OR (EXISTS ( SELECT 1
  WHERE (("stock_levels"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("stock_levels"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"]))))));



CREATE POLICY "merged_insert" ON "public"."movements" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM ("public"."items" "i"
     JOIN "public"."company_members" "m" ON (("m"."company_id" = "i"."company_id")))
  WHERE (("i"."id" = "movements"."item_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"public"."member_status")))) OR (EXISTS ( SELECT 1
  WHERE ((COALESCE("movements"."company_id", "public"."current_company_id"()) = "public"."current_company_id"()) AND "public"."has_company_role"(COALESCE("movements"."company_id", "public"."current_company_id"()), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))))));



CREATE POLICY "merged_insert" ON "public"."purchase_order_lines" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."purchase_orders" "po"
          WHERE (("po"."id" = "purchase_order_lines"."po_id") AND ("po"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("po"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])))))) OR (EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."purchase_orders" "po"
          WHERE (("po"."id" = "purchase_order_lines"."po_id") AND "public"."has_company_role"("po"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))))))));



CREATE POLICY "merged_insert" ON "public"."sales_order_lines" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."sales_orders" "so"
  WHERE (("so"."id" = "sales_order_lines"."so_id") AND ("so"."company_id" = "public"."current_company_id"())))) OR (EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."sales_orders" "so"
          WHERE (("so"."id" = "sales_order_lines"."so_id") AND ("so"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("so"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])))))) OR (EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."sales_orders" "so"
          WHERE (("so"."id" = "sales_order_lines"."so_id") AND "public"."has_company_role"("so"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))))))));



CREATE POLICY "merged_insert" ON "public"."sales_shipments" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
  WHERE "public"."has_company_role"(COALESCE("sales_shipments"."company_id", "public"."current_company_id"()), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))) OR (EXISTS ( SELECT 1
  WHERE ((COALESCE("sales_shipments"."company_id", "public"."current_company_id"()) = "public"."current_company_id"()) AND "public"."has_company_role"(COALESCE("sales_shipments"."company_id", "public"."current_company_id"()), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))))));



CREATE POLICY "merged_insert" ON "public"."stock_levels" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
  WHERE "public"."is_member_of_company"("stock_levels"."company_id"))) OR (EXISTS ( SELECT 1
  WHERE ((COALESCE("stock_levels"."company_id", "public"."current_company_id"()) = "public"."current_company_id"()) AND "public"."has_company_role"(COALESCE("stock_levels"."company_id", "public"."current_company_id"()), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))))));



CREATE POLICY "merged_select" ON "public"."app_settings" FOR SELECT USING ((true OR true OR ("auth"."role"() = 'authenticated'::"text")));



CREATE POLICY "merged_select" ON "public"."companies" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "companies"."id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"public"."member_status")))) OR (("owner_user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "companies"."id") AND (("m"."user_id" = "auth"."uid"()) OR ("m"."email" = (("current_setting"('request.jwt.claims'::"text", true))::"jsonb" ->> 'email'::"text"))))))) OR (EXISTS ( SELECT 1
  WHERE ("public"."is_member_of_company"("companies"."id") OR ("companies"."owner_user_id" = "auth"."uid"())))) OR "public"."is_company_member"("auth"."uid"(), "id")));



CREATE POLICY "merged_update" ON "public"."app_settings" FOR UPDATE USING ((("id" = 'app'::"text") OR ("id" = 'app'::"text") OR ("auth"."role"() = 'authenticated'::"text"))) WITH CHECK ((("id" = 'app'::"text") OR ("id" = 'app'::"text")));



CREATE POLICY "merged_update" ON "public"."companies" FOR UPDATE USING ((("owner_user_id" = "auth"."uid"()) OR "public"."is_company_member"("auth"."uid"(), "id", ARRAY['OWNER'::"text"]))) WITH CHECK ((("owner_user_id" = "auth"."uid"()) OR "public"."is_company_member"("auth"."uid"(), "id", ARRAY['OWNER'::"text"])));



CREATE POLICY "merged_update" ON "public"."movements" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM ("public"."items" "i"
     JOIN "public"."company_members" "m" ON (("m"."company_id" = "i"."company_id")))
  WHERE (("i"."id" = "movements"."item_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"public"."member_status")))) OR ("company_id" = "public"."current_company_id"()))) WITH CHECK (((EXISTS ( SELECT 1
   FROM ("public"."items" "i"
     JOIN "public"."company_members" "m" ON (("m"."company_id" = "i"."company_id")))
  WHERE (("i"."id" = "movements"."item_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"public"."member_status")))) OR ("company_id" = "public"."current_company_id"())));



CREATE POLICY "merged_update" ON "public"."purchase_order_lines" FOR UPDATE USING (((EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."purchase_orders" "po"
          WHERE (("po"."id" = "purchase_order_lines"."po_id") AND ("po"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("po"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])))))) OR (EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."purchase_orders" "po"
          WHERE (("po"."id" = "purchase_order_lines"."po_id") AND "public"."has_company_role"("po"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."purchase_orders" "po"
  WHERE (("po"."id" = "purchase_order_lines"."po_id") AND ("po"."company_id" = "public"."current_company_id"())))) OR (EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."purchase_orders" "po"
          WHERE (("po"."id" = "purchase_order_lines"."po_id") AND "public"."has_company_role"("po"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))))))));



CREATE POLICY "merged_update" ON "public"."sales_order_lines" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."sales_orders" "so"
  WHERE (("so"."id" = "sales_order_lines"."so_id") AND ("so"."company_id" = "public"."current_company_id"())))) OR (EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."sales_orders" "so"
          WHERE (("so"."id" = "sales_order_lines"."so_id") AND ("so"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("so"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])))))) OR (EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."sales_orders" "so"
          WHERE (("so"."id" = "sales_order_lines"."so_id") AND "public"."has_company_role"("so"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."sales_orders" "so"
  WHERE (("so"."id" = "sales_order_lines"."so_id") AND ("so"."company_id" = "public"."current_company_id"())))) OR (EXISTS ( SELECT 1
   FROM "public"."sales_orders" "so"
  WHERE (("so"."id" = "sales_order_lines"."so_id") AND ("so"."company_id" = "public"."current_company_id"())))) OR (EXISTS ( SELECT 1
  WHERE (EXISTS ( SELECT 1
           FROM "public"."sales_orders" "so"
          WHERE (("so"."id" = "sales_order_lines"."so_id") AND "public"."has_company_role"("so"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))))))));



CREATE POLICY "merged_update" ON "public"."sales_shipments" FOR UPDATE USING ((("company_id" = "public"."current_company_id"()) OR (EXISTS ( SELECT 1
  WHERE "public"."has_company_role"("sales_shipments"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))))) WITH CHECK ((("company_id" = "public"."current_company_id"()) OR (EXISTS ( SELECT 1
  WHERE "public"."has_company_role"("sales_shipments"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])))));



CREATE POLICY "merged_update" ON "public"."stock_levels" FOR UPDATE USING ((("company_id" = "public"."current_company_id"()) OR (EXISTS ( SELECT 1
  WHERE "public"."is_member_of_company"("stock_levels"."company_id"))))) WITH CHECK ((("company_id" = "public"."current_company_id"()) OR (EXISTS ( SELECT 1
  WHERE "public"."is_member_of_company"("stock_levels"."company_id")))));



ALTER TABLE "public"."movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "movements_select_active_company" ON "public"."movements" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_insert_operator_plus_scoped" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]) AND (("user_id" IS NULL) OR ("user_id" = "auth"."uid"()))));



CREATE POLICY "notifications_mark_read_active_company" ON "public"."notifications" FOR UPDATE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND (("user_id" = "auth"."uid"()) OR ("user_id" IS NULL)))) WITH CHECK ((("company_id" = "public"."current_company_id"()) AND (("user_id" = "auth"."uid"()) OR ("user_id" IS NULL))));



CREATE POLICY "notifications_select_active_company" ON "public"."notifications" FOR SELECT TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND (("user_id" = "auth"."uid"()) OR ("user_id" IS NULL))));



ALTER TABLE "public"."number_sequences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "number_sequences_service_only" ON "public"."number_sequences" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."order_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orgs_read_all" ON "public"."organizations" FOR SELECT USING (true);



ALTER TABLE "public"."payment_terms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment_terms_delete_manager_plus_scoped" ON "public"."payment_terms" FOR DELETE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



CREATE POLICY "payment_terms_insert_manager_plus_scoped" ON "public"."payment_terms" FOR INSERT TO "authenticated" WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



CREATE POLICY "payment_terms_select_scoped" ON "public"."payment_terms" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "payment_terms_update_manager_plus_scoped" ON "public"."payment_terms" FOR UPDATE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"]))) WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



ALTER TABLE "public"."plan_catalog" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_admins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platform_admins_self_status" ON "public"."platform_admins" FOR SELECT TO "authenticated" USING (("is_active" AND (("user_id" = "auth"."uid"()) OR ("lower"("email") = "lower"(COALESCE(("auth"."jwt"() ->> 'email'::"text"), ''::"text"))))));



CREATE POLICY "po_delete" ON "public"."purchase_orders" FOR DELETE USING ((EXISTS ( SELECT 1
  WHERE (("purchase_orders"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("purchase_orders"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])))));



CREATE POLICY "po_insert" ON "public"."purchase_orders" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
  WHERE "public"."has_company_role"(COALESCE("purchase_orders"."company_id", "public"."current_company_id"()), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))));



CREATE POLICY "po_select_active_company" ON "public"."purchase_orders" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "po_update" ON "public"."purchase_orders" FOR UPDATE USING ((EXISTS ( SELECT 1
  WHERE (("purchase_orders"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("purchase_orders"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))))) WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "pol_select_active_company" ON "public"."purchase_order_lines" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."purchase_orders" "po"
  WHERE (("po"."id" = "purchase_order_lines"."po_id") AND ("po"."company_id" = "public"."current_company_id"())))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT USING ((("id" = "auth"."uid"()) OR ("user_id" = "auth"."uid"())));



CREATE POLICY "profiles_select_same_company" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."company_members" "me"
     JOIN "public"."company_members" "them" ON ((("them"."company_id" = "me"."company_id") AND ("them"."user_id" = "profiles"."id") AND ("them"."status" = 'active'::"public"."member_status"))))
  WHERE (("me"."user_id" = "auth"."uid"()) AND ("me"."status" = 'active'::"public"."member_status") AND ("public"."role_rank"("public"."actor_role_for"("me"."company_id")) >= "public"."role_rank"('MANAGER'::"public"."member_role"))))));



CREATE POLICY "profiles_select_self" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles_self_rw" ON "public"."profiles" USING ((("auth"."uid"() = "id") OR ("auth"."uid"() = "user_id"))) WITH CHECK ((("auth"."uid"() = "id") OR ("auth"."uid"() = "user_id")));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE USING ((("id" = "auth"."uid"()) OR ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."purchase_order_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saft_moz_exports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "saft_moz_exports_select" ON "public"."saft_moz_exports" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



ALTER TABLE "public"."sales_credit_note_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_credit_note_lines_insert" ON "public"."sales_credit_note_lines" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "sales_credit_note_lines_select" ON "public"."sales_credit_note_lines" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "sales_credit_note_lines_update" ON "public"."sales_credit_note_lines" FOR UPDATE TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."sales_credit_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_credit_notes_insert" ON "public"."sales_credit_notes" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "sales_credit_notes_select" ON "public"."sales_credit_notes" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "sales_credit_notes_update" ON "public"."sales_credit_notes" FOR UPDATE TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."sales_debit_note_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_debit_note_lines_insert" ON "public"."sales_debit_note_lines" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "sales_debit_note_lines_select" ON "public"."sales_debit_note_lines" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "sales_debit_note_lines_update" ON "public"."sales_debit_note_lines" FOR UPDATE TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."sales_debit_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_debit_notes_insert" ON "public"."sales_debit_notes" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "sales_debit_notes_select" ON "public"."sales_debit_notes" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "sales_debit_notes_update" ON "public"."sales_debit_notes" FOR UPDATE TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."sales_invoice_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_invoice_lines_insert" ON "public"."sales_invoice_lines" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "sales_invoice_lines_select" ON "public"."sales_invoice_lines" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "sales_invoice_lines_update" ON "public"."sales_invoice_lines" FOR UPDATE TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."sales_invoices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_invoices_insert" ON "public"."sales_invoices" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "sales_invoices_select" ON "public"."sales_invoices" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "sales_invoices_update" ON "public"."sales_invoices" FOR UPDATE TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."sales_order_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_shipments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_shipments_select_by_membership" ON "public"."sales_shipments" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "select_by_membership" ON "public"."companies" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "companies"."id") AND (("cm"."user_id" = "auth"."uid"()) OR (("cm"."email" IS NOT NULL) AND ("cm"."email" = ("auth"."jwt"() ->> 'email'::"text")))) AND ("cm"."status" = ANY (ARRAY['active'::"public"."member_status", 'invited'::"public"."member_status"]))))));



CREATE POLICY "select_by_membership" ON "public"."order_counters" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "order_counters"."company_id") AND (("cm"."user_id" = "auth"."uid"()) OR (("cm"."email" IS NOT NULL) AND ("cm"."email" = ("auth"."jwt"() ->> 'email'::"text")))) AND ("cm"."status" = ANY (ARRAY['active'::"public"."member_status", 'invited'::"public"."member_status"]))))));



CREATE POLICY "select_own" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "settings_select_all" ON "public"."settings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "settings_write_all" ON "public"."settings" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "sl_cud_member" ON "public"."stock_levels" TO "authenticated" USING ((EXISTS ( SELECT 1
  WHERE ((EXISTS ( SELECT 1
           FROM "public"."items" "i"
          WHERE (("i"."id" = "stock_levels"."item_id") AND "public"."is_member_of_company"("i"."company_id")))) AND (("stock_levels"."warehouse_id" IS NULL) OR (EXISTS ( SELECT 1
           FROM "public"."warehouses" "w"
          WHERE (("w"."id" = "stock_levels"."warehouse_id") AND (EXISTS ( SELECT 1
                   FROM "public"."items" "i"
                  WHERE (("i"."id" = "stock_levels"."item_id") AND ("w"."company_id" = "i"."company_id")))))))))))) WITH CHECK ((EXISTS ( SELECT 1
  WHERE ((EXISTS ( SELECT 1
           FROM "public"."items" "i"
          WHERE (("i"."id" = "stock_levels"."item_id") AND "public"."is_member_of_company"("i"."company_id")))) AND (("stock_levels"."warehouse_id" IS NULL) OR (EXISTS ( SELECT 1
           FROM "public"."warehouses" "w"
          WHERE (("w"."id" = "stock_levels"."warehouse_id") AND (EXISTS ( SELECT 1
                   FROM "public"."items" "i"
                  WHERE (("i"."id" = "stock_levels"."item_id") AND ("w"."company_id" = "i"."company_id"))))))))))));



CREATE POLICY "sm_cud_member" ON "public"."stock_movements" TO "authenticated" USING ((EXISTS ( SELECT 1
  WHERE ((EXISTS ( SELECT 1
           FROM "public"."items" "i"
          WHERE (("i"."id" = "stock_movements"."item_id") AND "public"."is_member_of_company"("i"."company_id")))) AND (("stock_movements"."warehouse_from_id" IS NULL) OR (EXISTS ( SELECT 1
           FROM "public"."warehouses" "wf"
          WHERE (("wf"."id" = "stock_movements"."warehouse_from_id") AND (EXISTS ( SELECT 1
                   FROM "public"."items" "i"
                  WHERE (("i"."id" = "stock_movements"."item_id") AND ("wf"."company_id" = "i"."company_id")))))))) AND (("stock_movements"."warehouse_to_id" IS NULL) OR (EXISTS ( SELECT 1
           FROM "public"."warehouses" "wt"
          WHERE (("wt"."id" = "stock_movements"."warehouse_to_id") AND (EXISTS ( SELECT 1
                   FROM "public"."items" "i"
                  WHERE (("i"."id" = "stock_movements"."item_id") AND ("wt"."company_id" = "i"."company_id")))))))))))) WITH CHECK ((EXISTS ( SELECT 1
  WHERE ((EXISTS ( SELECT 1
           FROM "public"."items" "i"
          WHERE (("i"."id" = "stock_movements"."item_id") AND "public"."is_member_of_company"("i"."company_id")))) AND (("stock_movements"."warehouse_from_id" IS NULL) OR (EXISTS ( SELECT 1
           FROM "public"."warehouses" "wf"
          WHERE (("wf"."id" = "stock_movements"."warehouse_from_id") AND (EXISTS ( SELECT 1
                   FROM "public"."items" "i"
                  WHERE (("i"."id" = "stock_movements"."item_id") AND ("wf"."company_id" = "i"."company_id")))))))) AND (("stock_movements"."warehouse_to_id" IS NULL) OR (EXISTS ( SELECT 1
           FROM "public"."warehouses" "wt"
          WHERE (("wt"."id" = "stock_movements"."warehouse_to_id") AND (EXISTS ( SELECT 1
                   FROM "public"."items" "i"
                  WHERE (("i"."id" = "stock_movements"."item_id") AND ("wt"."company_id" = "i"."company_id"))))))))))));



CREATE POLICY "so_delete" ON "public"."sales_orders" FOR DELETE USING ((EXISTS ( SELECT 1
  WHERE (("sales_orders"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("sales_orders"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])))));



CREATE POLICY "so_insert" ON "public"."sales_orders" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
  WHERE "public"."has_company_role"(COALESCE("sales_orders"."company_id", "public"."current_company_id"()), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))));



CREATE POLICY "so_select_active_company" ON "public"."sales_orders" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "so_update" ON "public"."sales_orders" FOR UPDATE USING ((EXISTS ( SELECT 1
  WHERE (("sales_orders"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("sales_orders"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))))) WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "sol_delete" ON "public"."sales_order_lines" FOR DELETE USING (("company_id" = (("auth"."jwt"() ->> 'company_id'::"text"))::"uuid"));



CREATE POLICY "sol_insert" ON "public"."sales_order_lines" FOR INSERT WITH CHECK (("company_id" = (("auth"."jwt"() ->> 'company_id'::"text"))::"uuid"));



CREATE POLICY "sol_select" ON "public"."sales_order_lines" FOR SELECT USING (("company_id" = (("auth"."jwt"() ->> 'company_id'::"text"))::"uuid"));



CREATE POLICY "sol_select_active_company" ON "public"."sales_order_lines" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sales_orders" "so"
  WHERE (("so"."id" = "sales_order_lines"."so_id") AND ("so"."company_id" = "public"."current_company_id"())))));



CREATE POLICY "sol_update" ON "public"."sales_order_lines" FOR UPDATE USING (("company_id" = (("auth"."jwt"() ->> 'company_id'::"text"))::"uuid")) WITH CHECK (("company_id" = (("auth"."jwt"() ->> 'company_id'::"text"))::"uuid"));



ALTER TABLE "public"."stock_levels" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_levels_select_active_company" ON "public"."stock_levels" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_movements_select_by_membership" ON "public"."stock_movements" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "suppliers_delete" ON "public"."suppliers" FOR DELETE USING ((EXISTS ( SELECT 1
  WHERE (("suppliers"."company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("suppliers"."company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])))));



CREATE POLICY "suppliers_insert" ON "public"."suppliers" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
  WHERE "public"."has_company_role"(COALESCE("suppliers"."company_id", "public"."current_company_id"()), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))));



CREATE POLICY "suppliers_select" ON "public"."suppliers" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "suppliers_update" ON "public"."suppliers" FOR UPDATE USING (("company_id" = "public"."current_company_id"())) WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "svc_customers_select" ON "public"."customers" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "svc_due_queue_select" ON "public"."due_reminder_queue" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "svc_due_queue_update" ON "public"."due_reminder_queue" FOR UPDATE TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "svc_payment_terms_select" ON "public"."payment_terms" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "svc_sales_orders_select" ON "public"."sales_orders" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "uac_delete_self" ON "public"."user_active_company" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "uac_select_self" ON "public"."user_active_company" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "uac_update_self" ON "public"."user_active_company" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "uac_upsert_self" ON "public"."user_active_company" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."uom_conversions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "uom_conversions_delete_operator_plus" ON "public"."uom_conversions" FOR DELETE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



CREATE POLICY "uom_conversions_insert_operator_plus" ON "public"."uom_conversions" FOR INSERT TO "authenticated" WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



CREATE POLICY "uom_conversions_select_scoped" ON "public"."uom_conversions" FOR SELECT TO "authenticated" USING ((("company_id" IS NULL) OR ("company_id" = "public"."current_company_id"())));



CREATE POLICY "uom_conversions_update_operator_plus" ON "public"."uom_conversions" FOR UPDATE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))) WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



ALTER TABLE "public"."uoms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "uoms_delete_manager_plus_or_platform_admin" ON "public"."uoms" FOR DELETE TO "authenticated" USING (("public"."is_platform_admin"() OR (("public"."current_company_id"() IS NOT NULL) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"]))));



CREATE POLICY "uoms_insert_operator_plus_scoped" ON "public"."uoms" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_platform_admin"() OR (("public"."current_company_id"() IS NOT NULL) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))));



CREATE POLICY "uoms_select_enabled_membership_or_platform_admin" ON "public"."uoms" FOR SELECT TO "authenticated" USING (("public"."is_platform_admin"() OR (COALESCE("array_length"("public"."current_user_company_ids"(), 1), 0) > 0)));



CREATE POLICY "uoms_update_operator_plus_scoped" ON "public"."uoms" FOR UPDATE TO "authenticated" USING (("public"."is_platform_admin"() OR (("public"."current_company_id"() IS NOT NULL) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])))) WITH CHECK (("public"."is_platform_admin"() OR (("public"."current_company_id"() IS NOT NULL) AND "public"."has_company_role"("public"."current_company_id"(), ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))));



ALTER TABLE "public"."user_active_company" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_active_company_select_self" ON "public"."user_active_company" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_bill_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendor_bill_lines_insert" ON "public"."vendor_bill_lines" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "vendor_bill_lines_select" ON "public"."vendor_bill_lines" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "vendor_bill_lines_update" ON "public"."vendor_bill_lines" FOR UPDATE TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."vendor_bills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendor_bills_insert" ON "public"."vendor_bills" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "vendor_bills_select" ON "public"."vendor_bills" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "vendor_bills_update" ON "public"."vendor_bills" FOR UPDATE TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."vendor_credit_note_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendor_credit_note_lines_insert" ON "public"."vendor_credit_note_lines" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "vendor_credit_note_lines_select" ON "public"."vendor_credit_note_lines" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "vendor_credit_note_lines_update" ON "public"."vendor_credit_note_lines" FOR UPDATE TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."vendor_credit_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendor_credit_notes_insert" ON "public"."vendor_credit_notes" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "vendor_credit_notes_select" ON "public"."vendor_credit_notes" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "vendor_credit_notes_update" ON "public"."vendor_credit_notes" FOR UPDATE TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."vendor_debit_note_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendor_debit_note_lines_insert" ON "public"."vendor_debit_note_lines" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "vendor_debit_note_lines_select" ON "public"."vendor_debit_note_lines" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "vendor_debit_note_lines_update" ON "public"."vendor_debit_note_lines" FOR UPDATE TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."vendor_debit_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendor_debit_notes_insert" ON "public"."vendor_debit_notes" FOR INSERT TO "authenticated" WITH CHECK ("public"."finance_documents_can_write"("company_id"));



CREATE POLICY "vendor_debit_notes_select" ON "public"."vendor_debit_notes" FOR SELECT TO "authenticated" USING ("public"."finance_documents_can_read"("company_id"));



CREATE POLICY "vendor_debit_notes_update" ON "public"."vendor_debit_notes" FOR UPDATE TO "authenticated" USING ("public"."finance_documents_can_write"("company_id")) WITH CHECK ("public"."finance_documents_can_write"("company_id"));



ALTER TABLE "public"."warehouses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "warehouses_delete_manager_plus_scoped" ON "public"."warehouses" FOR DELETE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role"])));



CREATE POLICY "warehouses_insert_operator_plus_scoped" ON "public"."warehouses" FOR INSERT TO "authenticated" WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



CREATE POLICY "warehouses_select_active_company" ON "public"."warehouses" FOR SELECT TO "authenticated" USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "warehouses_update_operator_plus_scoped" ON "public"."warehouses" FOR UPDATE TO "authenticated" USING ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"]))) WITH CHECK ((("company_id" = "public"."current_company_id"()) AND "public"."has_company_role"("company_id", ARRAY['OWNER'::"public"."member_role", 'ADMIN'::"public"."member_role", 'MANAGER'::"public"."member_role", 'OPERATOR'::"public"."member_role"])));



CREATE POLICY "wh_select" ON "public"."warehouses" FOR SELECT USING (("company_id" = ANY ("public"."current_user_company_ids"())));



ALTER TABLE "public"."whatsapp_credentials" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_credentials_deny_all" ON "public"."whatsapp_credentials" USING (false) WITH CHECK (false);



ALTER TABLE "public"."whatsapp_outbox" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_outbox_insert" ON "public"."whatsapp_outbox" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "whatsapp_outbox_select" ON "public"."whatsapp_outbox" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "whatsapp_outbox_update" ON "public"."whatsapp_outbox" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."whatsapp_webhook_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_webhook_events_insert" ON "public"."whatsapp_webhook_events" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "whatsapp_webhook_events_select" ON "public"."whatsapp_webhook_events" FOR SELECT USING (("company_id" = "public"."current_company_id"()));


REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TYPE "public"."subscription_status" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."accept_invite_with_token"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_invite_with_token"("p_token" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."accept_my_invite"("p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_my_invite"("p_company_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."active_company_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."active_company_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."active_company_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."add_allowed_currency_for_current_company"("p_code" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."ai_exec_one"("p_sql" "text", "p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_exec_one"("p_sql" "text", "p_dry_run" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."append_finance_document_event"("p_company_id" "uuid", "p_document_kind" "text", "p_document_id" "uuid", "p_event_type" "text", "p_from_status" "text", "p_to_status" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."append_finance_document_event"("p_company_id" "uuid", "p_document_kind" "text", "p_document_id" "uuid", "p_event_type" "text", "p_from_status" "text", "p_to_status" "text", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_finance_document_event"("p_company_id" "uuid", "p_document_kind" "text", "p_document_id" "uuid", "p_event_type" "text", "p_from_status" "text", "p_to_status" "text", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_landed_cost_run"("p_company_id" "uuid", "p_purchase_order_id" "uuid", "p_supplier_id" "uuid", "p_applied_by" "uuid", "p_currency_code" "text", "p_fx_to_base" numeric, "p_allocation_method" "text", "p_total_extra_cost" numeric, "p_notes" "text", "p_charges" "jsonb", "p_lines" "jsonb") TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sales_invoices" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."sales_invoices" TO "authenticated";



GRANT ALL ON FUNCTION "public"."approve_sales_invoice_mz"("p_invoice_id" "uuid") TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vendor_bills" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."vendor_bills" TO "authenticated";



GRANT ALL ON FUNCTION "public"."approve_vendor_bill_mz"("p_bill_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."auth_company_ids"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auth_company_ids"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."bank_account_balances"("p_company" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."bank_book_balance"("p_bank" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."bootstrap_owner"("p_company_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."build_daily_digest_payload"("p_company_id" "uuid", "p_local_day" "date", "p_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_daily_digest_payload"("p_company_id" "uuid", "p_local_day" "date", "p_timezone" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."build_due_reminder_batch"("p_company_id" "uuid", "p_local_day" "date", "p_timezone" "text", "p_lead_days" integer[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_due_reminder_batch"("p_company_id" "uuid", "p_local_day" "date", "p_timezone" "text", "p_lead_days" integer[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."build_from_bom"("p_bom_id" "uuid", "p_qty" numeric, "p_warehouse_from" "uuid", "p_bin_from" "text", "p_warehouse_to" "uuid", "p_bin_to" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_from_bom"("p_bom_id" "uuid", "p_qty" numeric, "p_warehouse_from" "uuid", "p_bin_from" "text", "p_warehouse_to" "uuid", "p_bin_to" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."can_manage_company_storage_prefix"("p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_company_storage_prefix"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_company_storage_prefix"("p_company_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cash_get_book"("p_company" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cash_get_book"("p_company" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cash_ledger"("p_company" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cash_ledger"("p_company" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cash_ledger"("p_company" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cash_summary"("p_company" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cash_summary"("p_company" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cash_summary"("p_company" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."company_access_effective_status"("p_company_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."company_access_is_enabled"("p_company_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."consume_security_rate_limit"("p_scope" "text", "p_subject" "text", "p_window_seconds" integer, "p_max_hits" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_security_rate_limit"("p_scope" "text", "p_subject" "text", "p_window_seconds" integer, "p_max_hits" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_company_and_bootstrap"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_company_and_bootstrap"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_company_and_bootstrap"("p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_operator_sale_issue"("p_company_id" "uuid", "p_bin_from_id" "text", "p_customer_id" "uuid", "p_order_date" "date", "p_currency_code" "text", "p_fx_to_base" numeric, "p_reference_no" "text", "p_notes" "text", "p_lines" "jsonb") TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."saft_moz_exports" TO "service_role";
GRANT SELECT ON TABLE "public"."saft_moz_exports" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_saft_moz_export_run"("p_company_id" "uuid", "p_period_start" "date", "p_period_end" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_saft_moz_export_run"("p_company_id" "uuid", "p_period_start" "date", "p_period_end" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_vendor_bill_draft_from_purchase_order"("p_company_id" "uuid", "p_purchase_order_id" "uuid", "p_supplier_invoice_reference" "text", "p_supplier_invoice_date" "date", "p_bill_date" "date", "p_due_date" "date", "p_currency_code" "text", "p_fx_to_base" numeric, "p_lines" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_company_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_company_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_company_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."debug_my_company"("p_company" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."debug_my_company"("p_company" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_due_reminder"("p_company_id" "uuid", "p_local_day" "date", "p_timezone" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_due_reminder"("p_company_id" "uuid", "p_local_day" "date", "p_timezone" "text", "p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_due_reminder_for_company"("p_company_id" "uuid", "p_local_day" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_due_reminder_for_company"("p_company_id" "uuid", "p_local_day" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_due_reminder_for_company"("p_company_id" "uuid", "p_local_day" "date", "p_force" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_due_reminder_for_company"("p_company_id" "uuid", "p_local_day" "date", "p_force" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_due_reminders_for_all_companies"("p_local_day" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_due_reminders_for_all_companies"("p_local_day" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_due_reminders_for_all_companies"("p_local_day" "date", "p_force" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_due_reminders_for_all_companies"("p_local_day" "date", "p_force" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_cash_customer"("p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_cash_customer"("p_company_id" "uuid") TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_fiscal_settings" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."company_fiscal_settings" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."ensure_mz_company_fiscal_configuration"("p_company_id" "uuid", "p_document_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_mz_company_fiscal_configuration"("p_company_id" "uuid", "p_document_date" "date") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."ensure_stock_row"("p_item_id" "uuid", "p_warehouse_id" "uuid", "p_bin_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_stock_row"("p_item_id" "uuid", "p_warehouse_id" "uuid", "p_bin_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_saft_moz_export_run"("p_export_id" "uuid", "p_error_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_saft_moz_export_run"("p_export_id" "uuid", "p_error_message" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."finalize_saft_moz_export_run"("p_export_id" "uuid", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_sha256" "text", "p_size_bytes" bigint, "p_source_document_count" integer, "p_source_total_mzn" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_saft_moz_export_run"("p_export_id" "uuid", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_sha256" "text", "p_size_bytes" bigint, "p_source_document_count" integer, "p_source_total_mzn" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."finance_document_company_prefix"("p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finance_document_company_prefix"("p_company_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."finance_document_settlement_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finance_document_settlement_guard"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."finance_documents_can_read"("p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finance_documents_can_read"("p_company_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."finance_documents_can_write"("p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finance_documents_can_write"("p_company_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_record_revenue_on_issue_so"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_record_revenue_on_issue_so"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_record_revenue_on_issue_so"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_cash_approvals_queue_raw"("p_company" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_cash_approvals_queue_raw"("p_company" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_cash_book"("p_company" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_cash_book"("p_company" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_company_whatsapp_creds"("p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_company_whatsapp_creds"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_company_access_state"("p_company_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_payment_terms"("p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_payment_terms"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_payment_terms"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_platform_admin_status"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_schema_snapshot"("p_schema" "text") TO "ai_reader";



GRANT ALL ON FUNCTION "public"."import_opening_stock_batch"("p_company_id" "uuid", "p_rows" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."import_opening_stock_batch"("p_company_id" "uuid", "p_rows" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."invite_company_member"("p_company" "uuid", "p_email" "text", "p_role" "public"."member_role") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."invite_company_member"("p_company" "uuid", "p_email" "text", "p_role" "public"."member_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."invite_company_member"("p_company" "uuid", "p_email" "text", "p_role" "public"."member_role") TO "service_role";



REVOKE ALL ON FUNCTION "public"."invoke_digest_worker"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."invoke_digest_worker"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."invoke_due_reminder_worker"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."invoke_due_reminder_worker"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_active_member"("p_company" "uuid", "p_user" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_company_member"("target_company" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_company_member"("target_company" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_company_member"("target_company" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_company_member"("p_user" "uuid", "p_company" "uuid", "p_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_company_member"("p_user" "uuid", "p_company" "uuid", "p_roles" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_company_member"("p_user" "uuid", "p_company" "uuid", "p_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_company_member"("p_user" "uuid", "p_company" "uuid", "p_roles" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_manager_plus"("p_company" "uuid", "p_user" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_me_or_my_email"("p_company" "uuid", "p_email" "text", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_me_or_my_email"("p_company" "uuid", "p_email" "text", "p_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_member"("p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_member"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member_of_company"("cid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of_company"("cid" "uuid") TO "anon";



GRANT ALL ON FUNCTION "public"."is_platform_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_privileged_member"("p_company" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_privileged_member"("p_company" "uuid") TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sales_credit_notes" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."sales_credit_notes" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."issue_sales_credit_note_mz"("p_note_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."issue_sales_credit_note_mz"("p_note_id" "uuid") TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sales_debit_notes" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."sales_debit_notes" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."issue_sales_debit_note_mz"("p_note_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."issue_sales_debit_note_mz"("p_note_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."issue_sales_invoice_mz"("p_invoice_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."issue_sales_invoice_mz"("p_invoice_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."kick_due_reminder_worker"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kick_due_reminder_worker"() TO "service_role";



GRANT ALL ON FUNCTION "public"."link_invites_to_user"("p_user_id" "uuid", "p_email" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."link_membership_for_me"("p_company" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."member_has_company_access"("p_company_id" "uuid", "p_include_invited" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."my_company_and_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_company_and_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."next_finance_document_reference"("p_company_id" "uuid", "p_document_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_finance_document_reference"("p_company_id" "uuid", "p_document_type" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."next_fiscal_document_reference"("p_company_id" "uuid", "p_document_type" "text", "p_document_date" "date", "p_source_origin" "text", "p_explicit_reference" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_fiscal_document_reference"("p_company_id" "uuid", "p_document_type" "text", "p_document_date" "date", "p_source_origin" "text", "p_explicit_reference" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."parse_due_reminder_lead_days"("p_settings" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."parse_due_reminder_lead_days"("p_settings" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."parse_due_reminder_send_at"("p_settings" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."parse_due_reminder_send_at"("p_settings" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."platform_admin_get_company_detail"("p_company_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."platform_admin_list_company_access"("p_search" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."platform_admin_list_company_access_events"("p_company_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."platform_admin_list_company_control_actions"("p_company_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."platform_admin_record_company_access_email"("p_company_id" "uuid", "p_template_key" "text", "p_recipient_email" "text", "p_recipient_source" "text", "p_subject" "text", "p_reason" "text", "p_context" "jsonb") TO "authenticated";



GRANT ALL ON FUNCTION "public"."platform_admin_reset_company_operational_data"("p_company_id" "uuid", "p_confirmation" "text", "p_reason" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."platform_admin_resolve_company_notification_recipient"("p_company_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."platform_admin_set_company_access"("p_company_id" "uuid", "p_plan_code" "text", "p_status" "public"."subscription_status", "p_paid_until" timestamp with time zone, "p_trial_expires_at" timestamp with time zone, "p_purge_scheduled_at" timestamp with time zone, "p_reason" "text") TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."purchase_orders" TO "authenticated";



GRANT ALL ON FUNCTION "public"."po_trim_and_close"("p_company_id" "uuid", "p_po_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."post_vendor_bill_mz"("p_bill_id" "uuid") TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vendor_credit_notes" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."vendor_credit_notes" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."post_vendor_credit_note"("p_note_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."post_vendor_credit_note"("p_note_id" "uuid") TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vendor_debit_notes" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."vendor_debit_notes" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."post_vendor_debit_note"("p_note_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."post_vendor_debit_note"("p_note_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."prepare_sales_invoice_for_issue_mz"("p_invoice_id" "uuid", "p_vat_exemption_reason_text" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_sales_invoice_for_issue_mz"("p_invoice_id" "uuid", "p_vat_exemption_reason_text" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."process_daily_digests"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_daily_digests"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prune_worker_queues"("p_due_days" integer, "p_digest_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prune_worker_queues"("p_due_days" integer, "p_digest_days" integer) TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."fiscal_document_artifacts" TO "service_role";
GRANT SELECT ON TABLE "public"."fiscal_document_artifacts" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."register_fiscal_document_artifact"("p_company_id" "uuid", "p_document_kind" "text", "p_document_id" "uuid", "p_artifact_type" "text", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_content_sha256" "text", "p_size_bytes" bigint, "p_is_canonical" boolean, "p_retained_until" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_fiscal_document_artifact"("p_company_id" "uuid", "p_document_kind" "text", "p_document_id" "uuid", "p_artifact_type" "text", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_content_sha256" "text", "p_size_bytes" bigint, "p_is_canonical" boolean, "p_retained_until" "date") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reinvite_company_member"("p_company" "uuid", "p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reinvite_company_member"("p_company" "uuid", "p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reinvite_company_member"("p_company" "uuid", "p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."remove_allowed_currency_for_current_company"("p_code" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."request_sales_invoice_approval_mz"("p_invoice_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."request_vendor_bill_approval_mz"("p_bill_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."requeue_failed_digests"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."requeue_failed_digests"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."requeue_stuck_digests"("p_stuck_after" interval, "p_max_attempts" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."requeue_stuck_digests"("p_stuck_after" interval, "p_max_attempts" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."requeue_stuck_due_reminders"("p_stuck_after" interval, "p_max_attempts" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."requeue_stuck_due_reminders"("p_stuck_after" interval, "p_max_attempts" integer) TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."finance_document_fiscal_series" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."finance_document_fiscal_series" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."resolve_fiscal_series"("p_company_id" "uuid", "p_document_type" "text", "p_document_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_fiscal_series"("p_company_id" "uuid", "p_document_type" "text", "p_document_date" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."return_sales_invoice_to_draft_mz"("p_invoice_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."return_vendor_bill_to_draft_mz"("p_bill_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sales_invoice_issue_readiness_mz"("p_invoice_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sales_invoice_issue_readiness_mz"("p_invoice_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_active_company"("p_company" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_active_company"("p_company" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_active_company"("p_company" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_base_currency_for_current_company"("p_code" "text") TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sales_orders" TO "authenticated";
GRANT SELECT ON TABLE "public"."sales_orders" TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_saft_moz_export_run"("p_export_id" "uuid", "p_submission_reference" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_saft_moz_export_run"("p_export_id" "uuid", "p_submission_reference" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_invites_for_me"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_invites_for_me"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_invites_for_me"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."try_uuid"("p_value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."try_uuid"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."try_uuid"("p_value" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_company_settings"("p_company_id" "uuid", "p_patch" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_company_settings"("p_company_id" "uuid", "p_patch" "jsonb") TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."cash_books" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."cash_books" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."upsert_cash_book"("p_company" "uuid", "p_amount" numeric, "p_as_of" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_cash_book"("p_company" "uuid", "p_amount" numeric, "p_as_of" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."upsert_whatsapp_credentials"("p_company_id" "uuid", "p_phone_number_id" "text", "p_access_token" "text", "p_waba_id" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."void_vendor_bill_mz"("p_bill_id" "uuid") TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."ai_command_log" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."ai_notes" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."ai_ops_allowlist" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."ai_ops_commands" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."ai_ops_commands_with_class" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."ai_ops_recent" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."ai_probe" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."ai_schema_cache" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."ai_schema_latest" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."ai_tmp_probe" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."app_secrets" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."app_settings" TO "anon";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."app_settings" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."bank_accounts" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."bank_accounts" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."bank_statements" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."bank_statements" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."bank_transactions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."bank_transactions" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."bins" TO "authenticated";
GRANT SELECT ON TABLE "public"."bins" TO "anon";



GRANT SELECT ON TABLE "public"."bins_v" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."bom_components" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."boms" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."builds" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."cash_transactions" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."cash_transactions" TO "authenticated";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."companies" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."companies" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_access_audit_log" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_control_action_log" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_currencies" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."currencies" TO "authenticated";
GRANT SELECT ON TABLE "public"."currencies" TO "anon";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_currencies_view" TO "service_role";
GRANT SELECT ON TABLE "public"."company_currencies_view" TO "anon";
GRANT SELECT ON TABLE "public"."company_currencies_view" TO "authenticated";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."company_digest_state" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_invites" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_members" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_members" TO "service_role";



GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_members_with_auth" TO "service_role";
GRANT SELECT ON TABLE "public"."company_members_with_auth" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_purge_queue" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."company_settings" TO "authenticated";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."company_settings" TO "service_role";



GRANT SELECT ON TABLE "public"."company_settings_view" TO "anon";
GRANT SELECT ON TABLE "public"."company_settings_view" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_subscription_state" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."customers" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."customers" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."items" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."items" TO "anon";
GRANT SELECT ON TABLE "public"."items" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."stock_movements" TO "authenticated";
GRANT SELECT ON TABLE "public"."stock_movements" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."customer_movements_view" TO "service_role";
GRANT SELECT ON TABLE "public"."customer_movements_view" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."digest_events" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."digest_queue" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."document_number_counters" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."document_number_counters" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."due_reminder_queue" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."finance_document_events" TO "service_role";
GRANT SELECT ON TABLE "public"."finance_document_events" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."fx_rates" TO "authenticated";



GRANT SELECT ON TABLE "public"."fx_rates_view" TO "authenticated";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."stock_levels" TO "authenticated";
GRANT SELECT ON TABLE "public"."stock_levels" TO "anon";



GRANT SELECT ON TABLE "public"."items_view" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sales_shipments" TO "authenticated";
GRANT SELECT ON TABLE "public"."sales_shipments" TO "service_role";



GRANT SELECT ON TABLE "public"."kpi_revenue_cogs_daily" TO "anon";
GRANT SELECT ON TABLE "public"."kpi_revenue_cogs_daily" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."landed_cost_run_lines" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."landed_cost_run_lines" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."landed_cost_runs" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."landed_cost_runs" TO "authenticated";



GRANT SELECT ON TABLE "public"."movements" TO "authenticated";
GRANT SELECT ON TABLE "public"."movements" TO "anon";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."notifications" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."notifications" TO "authenticated";



GRANT SELECT ON TABLE "public"."order_counters" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."org_members" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."payment_terms" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."payment_terms" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."payment_terms" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."plan_catalog" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."platform_admins" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."purchase_order_lines" TO "authenticated";



GRANT SELECT ON TABLE "public"."reporting_cash_sales" TO "authenticated";
GRANT SELECT ON TABLE "public"."reporting_cash_sales" TO "anon";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."reporting_sales_orders" TO "service_role";
GRANT SELECT ON TABLE "public"."reporting_sales_orders" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sales_credit_note_lines" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."sales_credit_note_lines" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sales_debit_note_lines" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."sales_debit_note_lines" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sales_invoice_lines" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."sales_invoice_lines" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sales_order_lines" TO "authenticated";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."sales_order_lines" TO "anon";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sales_order_ship_progress" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."settings" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."suppliers" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."supplier_movements_view" TO "service_role";
GRANT SELECT ON TABLE "public"."supplier_movements_view" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."suppliers_view" TO "service_role";
GRANT SELECT ON TABLE "public"."suppliers_view" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."uoms" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."uoms" TO "authenticated";
GRANT SELECT ON TABLE "public"."uoms" TO "service_role";



GRANT SELECT ON TABLE "public"."uom" TO "anon";
GRANT SELECT ON TABLE "public"."uom" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."uom_conversions" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "public"."uom_conversions_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_active_company" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_profiles" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_po_cash_status" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_so_cash_status" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_cash_approvals_queue" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_due_sales_orders" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_sales_invoice_state" TO "service_role";
GRANT SELECT ON TABLE "public"."v_sales_invoice_state" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vendor_bill_lines" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."vendor_bill_lines" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_vendor_bill_state" TO "service_role";
GRANT SELECT ON TABLE "public"."v_vendor_bill_state" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_finance_reconciliation_review" TO "service_role";
GRANT SELECT ON TABLE "public"."v_finance_reconciliation_review" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_purchase_order_state" TO "service_role";
GRANT SELECT ON TABLE "public"."v_purchase_order_state" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_sales_order_state" TO "service_role";
GRANT SELECT ON TABLE "public"."v_sales_order_state" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_finance_reconciliation_exceptions" TO "service_role";
GRANT SELECT ON TABLE "public"."v_finance_reconciliation_exceptions" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_po_line_recv_summary" TO "service_role";



GRANT SELECT ON TABLE "public"."v_sales_order_totals" TO "anon";
GRANT SELECT ON TABLE "public"."v_sales_order_totals" TO "authenticated";



GRANT SELECT ON TABLE "public"."v_revenue_daily" TO "anon";
GRANT SELECT ON TABLE "public"."v_revenue_daily" TO "authenticated";



GRANT SELECT ON TABLE "public"."v_revenue_summary" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_saft_moz_master_company" TO "service_role";
GRANT SELECT ON TABLE "public"."v_saft_moz_master_company" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_saft_moz_master_customers" TO "service_role";
GRANT SELECT ON TABLE "public"."v_saft_moz_master_customers" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_saft_moz_master_products" TO "service_role";
GRANT SELECT ON TABLE "public"."v_saft_moz_master_products" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_saft_moz_master_tax_table" TO "service_role";
GRANT SELECT ON TABLE "public"."v_saft_moz_master_tax_table" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_saft_moz_source_documents_sales_credit_note_lines" TO "service_role";
GRANT SELECT ON TABLE "public"."v_saft_moz_source_documents_sales_credit_note_lines" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_saft_moz_source_documents_sales_credit_notes" TO "service_role";
GRANT SELECT ON TABLE "public"."v_saft_moz_source_documents_sales_credit_notes" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_saft_moz_source_documents_sales_debit_note_lines" TO "service_role";
GRANT SELECT ON TABLE "public"."v_saft_moz_source_documents_sales_debit_note_lines" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_saft_moz_source_documents_sales_debit_notes" TO "service_role";
GRANT SELECT ON TABLE "public"."v_saft_moz_source_documents_sales_debit_notes" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_saft_moz_source_documents_sales_invoice_lines" TO "service_role";
GRANT SELECT ON TABLE "public"."v_saft_moz_source_documents_sales_invoice_lines" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_saft_moz_source_documents_sales_invoices" TO "service_role";
GRANT SELECT ON TABLE "public"."v_saft_moz_source_documents_sales_invoices" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_saft_moz_source_documents_summary" TO "service_role";
GRANT SELECT ON TABLE "public"."v_saft_moz_source_documents_summary" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_so_line_ship_summary" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vendor_credit_note_lines" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."vendor_credit_note_lines" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vendor_debit_note_lines" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."vendor_debit_note_lines" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."warehouses" TO "authenticated";
GRANT SELECT ON TABLE "public"."warehouses" TO "anon";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."whatsapp_credentials" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."whatsapp_outbox" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."whatsapp_webhook_events" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "service_role";
