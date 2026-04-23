CREATE OR REPLACE FUNCTION "public"."emit_finance_document_signal_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_reference text;
  v_title text;
  v_body text;
  v_url text;
  v_level text := 'info';
  v_meta jsonb;
begin
  if new.company_id is null then
    return new;
  end if;

  case new.document_kind
    when 'sales_invoice' then
      v_reference := coalesce(
        nullif(new.payload ->> 'internal_reference', ''),
        nullif(new.payload ->> 'primary_reference', ''),
        left(new.document_id::text, 8)
      );

      case new.event_type
        when 'approval_requested' then
          v_title := 'Approval requested: Sales invoice';
          v_body := format('Sales invoice %s is waiting for approval.', v_reference);
          v_level := 'warning';
        when 'issued' then
          v_title := 'Sales invoice issued';
          v_body := format('Sales invoice %s was issued.', v_reference);
        else
          return new;
      end case;

      v_url := format('/sales-invoices/%s', new.document_id);

    when 'vendor_bill' then
      v_reference := coalesce(
        nullif(new.payload ->> 'primary_reference', ''),
        nullif(new.payload ->> 'internal_reference', ''),
        left(new.document_id::text, 8)
      );

      case new.event_type
        when 'approval_requested' then
          v_title := 'Approval requested: Vendor bill';
          v_body := format('Vendor bill %s is waiting for approval.', v_reference);
          v_level := 'warning';
        when 'posted' then
          v_title := 'Vendor bill posted';
          v_body := format('Vendor bill %s was posted to accounts payable.', v_reference);
        else
          return new;
      end case;

      v_url := format('/vendor-bills/%s', new.document_id);

    else
      return new;
  end case;

  v_meta := jsonb_build_object(
    'source', 'finance_document_event',
    'finance_document_event_id', new.id,
    'document_kind', new.document_kind,
    'document_id', new.document_id,
    'event_type', new.event_type
  );

  if not exists (
    select 1
    from public.notifications n
    where n.company_id = new.company_id
      and coalesce(n.meta ->> 'finance_document_event_id', '') = new.id::text
  ) then
    insert into public.notifications (
      id,
      company_id,
      user_id,
      level,
      title,
      body,
      url,
      icon,
      meta,
      created_at
    )
    values (
      gen_random_uuid(),
      new.company_id,
      null,
      v_level,
      v_title,
      v_body,
      v_url,
      'file-text',
      v_meta,
      now()
    );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."emit_finance_document_signal_notification"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."emit_finance_document_signal_notification"() IS 'Promotes high-signal finance document lifecycle events into the company notification feed without duplicating low-value draft edits.';


DROP TRIGGER IF EXISTS "ai_35_finance_document_signal_notify" ON "public"."finance_document_events";


CREATE OR REPLACE TRIGGER "ai_35_finance_document_signal_notify" AFTER INSERT ON "public"."finance_document_events" FOR EACH ROW EXECUTE FUNCTION "public"."emit_finance_document_signal_notification"();
