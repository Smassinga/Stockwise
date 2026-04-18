begin;

create or replace function public.platform_admin_reset_company_operational_data(
  p_company_id uuid,
  p_confirmation text,
  p_reason text
)
returns table (
  company_id uuid,
  performed_at timestamptz,
  deleted_summary jsonb,
  preserved_scope jsonb
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to 'off'
as $function$
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
$function$;

grant execute on function public.platform_admin_reset_company_operational_data(uuid, text, text) to authenticated;

commit;
