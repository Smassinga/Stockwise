-- Governed settlement and ledger posting.
--
-- Settlement rows remain append-only records in the existing cash and bank
-- ledgers. This migration does not alter legal documents, stock, costs, or
-- settlement-anchor transfer semantics; it makes the maintained write paths
-- idempotent and database-authoritative.

CREATE OR REPLACE FUNCTION public.stockwise_require_settlement_company(
  p_company_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_required' USING ERRCODE = '22023';
  END IF;

  IF NOT public.company_access_is_enabled(p_company_id) THEN
    RAISE EXCEPTION 'company_access_disabled' USING ERRCODE = '42501';
  END IF;

  IF public.current_company_id() IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'cross_company_access_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT public.finance_documents_can_manage_settlement(p_company_id) THEN
    RAISE EXCEPTION 'insufficient_company_role' USING ERRCODE = '42501';
  END IF;

  RETURN v_user;
END;
$$;

-- Base-currency settlement and ledger amounts follow the existing StockWise
-- finance contract: legal totals, issued documents, and UI entry are all
-- normalized to two decimal places. Keep this exact numeric rule centralized
-- so eligibility and persisted amounts cannot drift apart.
CREATE OR REPLACE FUNCTION public.stockwise_normalize_settlement_amount(
  p_amount numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
  SELECT CASE
    WHEN p_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    ELSE round(COALESCE(p_amount, 0), 2)
  END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_settlement_anchor(
  p_company_id uuid,
  p_ref_type text,
  p_ref_id uuid
) RETURNS TABLE(
  anchor_type text,
  anchor_id uuid,
  settlement_direction text,
  outstanding_base numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_ref_type text := upper(NULLIF(btrim(COALESCE(p_ref_type, '')), ''));
  v_company_id uuid;
  v_workflow_status text;
  v_finance_document_id uuid;
BEGIN
  IF v_ref_type NOT IN ('SO', 'PO', 'SI', 'VB') OR p_ref_id IS NULL THEN
    RAISE EXCEPTION 'settlement_anchor_required' USING ERRCODE = '22023';
  END IF;

  CASE v_ref_type
    WHEN 'SO' THEN
      SELECT so.company_id
        INTO v_company_id
      FROM public.sales_orders so
      WHERE so.id = p_ref_id
        AND so.company_id = p_company_id
      FOR UPDATE;

      IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.sales_orders so WHERE so.id = p_ref_id) THEN
          RAISE EXCEPTION 'cross_company_anchor_denied' USING ERRCODE = '42501';
        END IF;
        RAISE EXCEPTION 'settlement_anchor_not_found' USING ERRCODE = 'P0001';
      END IF;

      PERFORM pg_advisory_xact_lock(
        hashtextextended('stockwise:settlement:SO:' || p_ref_id::text, 0)
      );

      SELECT si.id
        INTO v_finance_document_id
      FROM public.sales_invoices si
      WHERE si.company_id = p_company_id
        AND si.sales_order_id = p_ref_id
        AND si.document_workflow_status = 'issued'
      ORDER BY si.issued_at DESC NULLS LAST, si.created_at DESC, si.id DESC
      LIMIT 1
      FOR UPDATE;

      IF v_finance_document_id IS NOT NULL THEN
        RAISE EXCEPTION 'finance_document_became_active_anchor'
          USING ERRCODE = 'P0001', DETAIL = 'SI:' || v_finance_document_id::text;
      END IF;

      SELECT sos.workflow_status, COALESCE(sos.legacy_outstanding_base, 0)
        INTO v_workflow_status, outstanding_base
      FROM public.v_sales_order_state sos
      WHERE sos.id = p_ref_id;

      IF v_workflow_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'settlement_anchor_not_ready' USING ERRCODE = 'P0001';
      END IF;

      anchor_type := 'SO';
      anchor_id := p_ref_id;
      settlement_direction := 'receive';
      outstanding_base := public.stockwise_normalize_settlement_amount(
        GREATEST(COALESCE(outstanding_base, 0), 0)
      );
      RETURN NEXT;

    WHEN 'PO' THEN
      SELECT po.company_id
        INTO v_company_id
      FROM public.purchase_orders po
      WHERE po.id = p_ref_id
        AND po.company_id = p_company_id
      FOR UPDATE;

      IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = p_ref_id) THEN
          RAISE EXCEPTION 'cross_company_anchor_denied' USING ERRCODE = '42501';
        END IF;
        RAISE EXCEPTION 'settlement_anchor_not_found' USING ERRCODE = 'P0001';
      END IF;

      PERFORM pg_advisory_xact_lock(
        hashtextextended('stockwise:settlement:PO:' || p_ref_id::text, 0)
      );

      SELECT vb.id
        INTO v_finance_document_id
      FROM public.vendor_bills vb
      WHERE vb.company_id = p_company_id
        AND vb.purchase_order_id = p_ref_id
        AND vb.document_workflow_status = 'posted'
      ORDER BY vb.posted_at DESC NULLS LAST, vb.created_at DESC, vb.id DESC
      LIMIT 1
      FOR UPDATE;

      IF v_finance_document_id IS NOT NULL THEN
        RAISE EXCEPTION 'finance_document_became_active_anchor'
          USING ERRCODE = 'P0001', DETAIL = 'VB:' || v_finance_document_id::text;
      END IF;

      SELECT pos.workflow_status, COALESCE(pos.legacy_outstanding_base, 0)
        INTO v_workflow_status, outstanding_base
      FROM public.v_purchase_order_state pos
      WHERE pos.id = p_ref_id;

      IF v_workflow_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'settlement_anchor_not_ready' USING ERRCODE = 'P0001';
      END IF;

      anchor_type := 'PO';
      anchor_id := p_ref_id;
      settlement_direction := 'pay';
      outstanding_base := public.stockwise_normalize_settlement_amount(
        GREATEST(COALESCE(outstanding_base, 0), 0)
      );
      RETURN NEXT;

    WHEN 'SI' THEN
      SELECT si.company_id, si.document_workflow_status
        INTO v_company_id, v_workflow_status
      FROM public.sales_invoices si
      WHERE si.id = p_ref_id
        AND si.company_id = p_company_id
      FOR UPDATE;

      IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.sales_invoices si WHERE si.id = p_ref_id) THEN
          RAISE EXCEPTION 'cross_company_anchor_denied' USING ERRCODE = '42501';
        END IF;
        RAISE EXCEPTION 'settlement_anchor_not_found' USING ERRCODE = 'P0001';
      END IF;
      IF v_workflow_status IS DISTINCT FROM 'issued' THEN
        RAISE EXCEPTION 'settlement_anchor_not_ready' USING ERRCODE = 'P0001';
      END IF;

      PERFORM pg_advisory_xact_lock(
        hashtextextended('stockwise:settlement:SI:' || p_ref_id::text, 0)
      );

      SELECT COALESCE(vis.outstanding_base, 0)
        INTO outstanding_base
      FROM public.v_sales_invoice_state vis
      WHERE vis.id = p_ref_id;

      anchor_type := 'SI';
      anchor_id := p_ref_id;
      settlement_direction := 'receive';
      outstanding_base := public.stockwise_normalize_settlement_amount(
        GREATEST(COALESCE(outstanding_base, 0), 0)
      );
      RETURN NEXT;

    WHEN 'VB' THEN
      SELECT vb.company_id, vb.document_workflow_status
        INTO v_company_id, v_workflow_status
      FROM public.vendor_bills vb
      WHERE vb.id = p_ref_id
        AND vb.company_id = p_company_id
      FOR UPDATE;

      IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.vendor_bills vb WHERE vb.id = p_ref_id) THEN
          RAISE EXCEPTION 'cross_company_anchor_denied' USING ERRCODE = '42501';
        END IF;
        RAISE EXCEPTION 'settlement_anchor_not_found' USING ERRCODE = 'P0001';
      END IF;
      IF v_workflow_status IS DISTINCT FROM 'posted' THEN
        RAISE EXCEPTION 'settlement_anchor_not_ready' USING ERRCODE = 'P0001';
      END IF;

      PERFORM pg_advisory_xact_lock(
        hashtextextended('stockwise:settlement:VB:' || p_ref_id::text, 0)
      );

      SELECT COALESCE(vbs.outstanding_base, 0)
        INTO outstanding_base
      FROM public.v_vendor_bill_state vbs
      WHERE vbs.id = p_ref_id;

      anchor_type := 'VB';
      anchor_id := p_ref_id;
      settlement_direction := 'pay';
      outstanding_base := public.stockwise_normalize_settlement_amount(
        GREATEST(COALESCE(outstanding_base, 0), 0)
      );
      RETURN NEXT;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_governed_ledger_transaction(
  p_operation_type text,
  p_channel text,
  p_company_id uuid,
  p_bank_id uuid,
  p_ref_type text,
  p_ref_id uuid,
  p_happened_at date,
  p_amount_base numeric,
  p_memo text,
  p_request_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_operation_type text := NULLIF(btrim(COALESCE(p_operation_type, '')), '');
  v_channel text := lower(NULLIF(btrim(COALESCE(p_channel, '')), ''));
  v_ref_type text := upper(NULLIF(btrim(COALESCE(p_ref_type, '')), ''));
  v_memo text := NULLIF(btrim(COALESCE(p_memo, '')), '');
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_amount numeric := public.stockwise_normalize_settlement_amount(p_amount_base);
  v_amount_token text;
  v_payload jsonb;
  v_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_claimed_new boolean := false;
  v_anchor record;
  v_bank_company_id uuid;
  v_signed_amount numeric;
  v_cash_type text;
  v_transaction_id uuid;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_settlement_company(p_company_id);

  IF v_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023';
  END IF;
  IF p_happened_at IS NULL THEN
    RAISE EXCEPTION 'settlement_date_required' USING ERRCODE = '22023';
  END IF;
  IF v_operation_type NOT IN ('settlement.cash.post', 'settlement.bank.post', 'cash.adjustment.post', 'bank.ledger.post') THEN
    RAISE EXCEPTION 'settlement_operation_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_channel NOT IN ('cash', 'bank') THEN
    RAISE EXCEPTION 'settlement_channel_invalid' USING ERRCODE = '22023';
  END IF;

  IF v_operation_type IN ('settlement.cash.post', 'settlement.bank.post') THEN
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'settlement_amount_must_be_positive' USING ERRCODE = '22023';
    END IF;
    IF v_ref_type NOT IN ('SO', 'PO', 'SI', 'VB') OR p_ref_id IS NULL THEN
      RAISE EXCEPTION 'settlement_anchor_required' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_amount IS NULL OR v_amount = 0 THEN
      RAISE EXCEPTION 'ledger_amount_must_be_nonzero' USING ERRCODE = '22023';
    END IF;
    IF (v_operation_type = 'cash.adjustment.post' AND (v_channel <> 'cash' OR v_ref_type IS NOT NULL OR p_ref_id IS NOT NULL OR p_bank_id IS NOT NULL))
       OR (v_operation_type = 'bank.ledger.post' AND (v_channel <> 'bank' OR v_ref_type IS NOT NULL OR p_ref_id IS NOT NULL OR p_bank_id IS NULL)) THEN
      RAISE EXCEPTION 'ledger_posting_payload_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_amount_token := v_amount::text;
  v_payload := jsonb_build_object(
    'amount_base', v_amount_token,
    'bank_id', COALESCE(p_bank_id::text, ''),
    'channel', v_channel,
    'company_id', p_company_id::text,
    'happened_at', p_happened_at::text,
    'memo', COALESCE(v_memo, ''),
    'operation_type', v_operation_type,
    'ref_id', COALESCE(p_ref_id::text, ''),
    'ref_type', COALESCE(v_ref_type, '')
  );
  v_hash := encode(extensions.digest(convert_to(v_payload::text, 'utf8'), 'sha256'), 'hex');
  LOOP
    BEGIN
      INSERT INTO public.posting_requests (
        company_id,
        operation_type,
        request_key,
        payload_hash,
        status,
        created_by,
        expires_at
      ) VALUES (
        p_company_id,
        v_operation_type,
        v_request_key,
        v_hash,
        'in_progress',
        v_user,
        now() + interval '180 days'
      )
      RETURNING * INTO v_request;
      v_claimed_new := true;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      SELECT *
        INTO v_request
      FROM public.posting_requests pr
      WHERE pr.company_id = p_company_id
        AND pr.operation_type = v_operation_type
        AND pr.request_key = v_request_key
      FOR UPDATE;

      EXIT WHEN FOUND;
    END;
  END LOOP;

  IF v_request.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_request.status = 'succeeded' THEN
    IF v_request.result_payload IS NULL THEN
      RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_request.result_payload || jsonb_build_object('replayed', true);
  ELSIF v_request.status = 'in_progress' AND NOT v_claimed_new THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  IF v_channel = 'bank' THEN
    SELECT ba.company_id
      INTO v_bank_company_id
    FROM public.bank_accounts ba
    WHERE ba.id = p_bank_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'bank_account_not_found' USING ERRCODE = 'P0001';
    END IF;
    IF v_bank_company_id IS DISTINCT FROM p_company_id THEN
      RAISE EXCEPTION 'cross_company_bank_account_denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_operation_type IN ('settlement.cash.post', 'settlement.bank.post') THEN
    SELECT *
      INTO v_anchor
    FROM public.resolve_settlement_anchor(p_company_id, v_ref_type, p_ref_id);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'settlement_anchor_not_found' USING ERRCODE = 'P0001';
    END IF;
    IF v_anchor.outstanding_base <= 0 THEN
      RAISE EXCEPTION 'settlement_already_resolved' USING ERRCODE = 'P0001';
    END IF;
    IF v_amount > v_anchor.outstanding_base THEN
      RAISE EXCEPTION 'settlement_amount_exceeds_outstanding' USING ERRCODE = 'P0001';
    END IF;

    v_signed_amount := CASE WHEN v_anchor.settlement_direction = 'receive' THEN v_amount ELSE -v_amount END;
    v_cash_type := CASE WHEN v_anchor.settlement_direction = 'receive' THEN 'sale_receipt' ELSE 'purchase_payment' END;

    IF v_channel = 'cash' THEN
      INSERT INTO public.cash_transactions (
        company_id, happened_at, type, ref_type, ref_id, memo, amount_base, user_ref
      ) VALUES (
        p_company_id, p_happened_at, v_cash_type, v_anchor.anchor_type, v_anchor.anchor_id,
        v_memo, v_signed_amount, v_user::text
      )
      RETURNING id INTO v_transaction_id;
    ELSE
      INSERT INTO public.bank_transactions (
        bank_id, happened_at, memo, amount_base, reconciled, ref_type, ref_id
      ) VALUES (
        p_bank_id, p_happened_at, v_memo, v_signed_amount, false, v_anchor.anchor_type, v_anchor.anchor_id
      )
      RETURNING id INTO v_transaction_id;
    END IF;

    v_result := jsonb_build_object(
      'anchor_id', v_anchor.anchor_id,
      'anchor_type', v_anchor.anchor_type,
      'amount_base', v_amount,
      'channel', v_channel,
      'operation_type', v_operation_type,
      'posting_request_id', v_request.id,
      'replayed', false,
      'signed_amount_base', v_signed_amount,
      'transaction_id', v_transaction_id
    );
  ELSIF v_operation_type = 'cash.adjustment.post' THEN
    INSERT INTO public.cash_transactions (
      company_id, happened_at, type, ref_type, ref_id, memo, amount_base, user_ref
    ) VALUES (
      p_company_id, p_happened_at, 'adjustment', 'ADJ', NULL, v_memo, v_amount, v_user::text
    )
    RETURNING id INTO v_transaction_id;

    v_result := jsonb_build_object(
      'amount_base', v_amount,
      'channel', 'cash',
      'operation_type', v_operation_type,
      'posting_request_id', v_request.id,
      'replayed', false,
      'signed_amount_base', v_amount,
      'transaction_id', v_transaction_id
    );
  ELSE
    INSERT INTO public.bank_transactions (
      bank_id, happened_at, memo, amount_base, reconciled, ref_type, ref_id
    ) VALUES (
      p_bank_id, p_happened_at, v_memo, v_amount, false, NULL, NULL
    )
    RETURNING id INTO v_transaction_id;

    v_result := jsonb_build_object(
      'amount_base', v_amount,
      'bank_id', p_bank_id,
      'channel', 'bank',
      'operation_type', v_operation_type,
      'posting_request_id', v_request.id,
      'replayed', false,
      'signed_amount_base', v_amount,
      'transaction_id', v_transaction_id
    );
  END IF;

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = CASE WHEN v_channel = 'cash' THEN 'CASH_TRANSACTION' ELSE 'BANK_TRANSACTION' END,
         result_ref_id = v_transaction_id::text,
         result_payload = v_result,
         error_code = NULL,
         error_message = NULL,
         updated_at = now()
   WHERE id = v_request.id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_cash_settlement(
  p_company_id uuid,
  p_ref_type text,
  p_ref_id uuid,
  p_happened_at date,
  p_amount_base numeric,
  p_memo text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  RETURN public.post_governed_ledger_transaction(
    'settlement.cash.post', 'cash', p_company_id, NULL, p_ref_type, p_ref_id,
    p_happened_at, p_amount_base, p_memo, p_request_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_bank_settlement(
  p_company_id uuid,
  p_bank_id uuid,
  p_ref_type text,
  p_ref_id uuid,
  p_happened_at date,
  p_amount_base numeric,
  p_memo text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  RETURN public.post_governed_ledger_transaction(
    'settlement.bank.post', 'bank', p_company_id, p_bank_id, p_ref_type, p_ref_id,
    p_happened_at, p_amount_base, p_memo, p_request_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_cash_adjustment(
  p_company_id uuid,
  p_happened_at date,
  p_amount_base numeric,
  p_memo text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  RETURN public.post_governed_ledger_transaction(
    'cash.adjustment.post', 'cash', p_company_id, NULL, NULL, NULL,
    p_happened_at, p_amount_base, p_memo, p_request_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_bank_ledger_transaction(
  p_company_id uuid,
  p_bank_id uuid,
  p_happened_at date,
  p_amount_base numeric,
  p_memo text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  RETURN public.post_governed_ledger_transaction(
    'bank.ledger.post', 'bank', p_company_id, p_bank_id, NULL, NULL,
    p_happened_at, p_amount_base, p_memo, p_request_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_bank_ledger_import(
  p_company_id uuid,
  p_bank_id uuid,
  p_rows jsonb,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_operation_type CONSTANT text := 'bank.ledger.import';
  v_user uuid;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_bank_company_id uuid;
  v_bank_currency text;
  v_row_count integer;
  v_request_size integer;
  v_input_row jsonb;
  v_normalized_rows jsonb := '[]'::jsonb;
  v_identity_rows jsonb;
  v_payload jsonb;
  v_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_claimed_new boolean := false;
  v_row_index integer := 0;
  v_row_number integer;
  v_date_text text;
  v_amount_text text;
  v_happened_at date;
  v_amount numeric;
  v_memo text;
  v_external_reference text;
  v_ref_type text;
  v_ref_id uuid;
  v_direction text;
  v_currency text;
  v_error_code text;
  v_error_field text;
  v_anchor record;
  v_anchor_type text;
  v_anchor_id uuid;
  v_anchor_direction text;
  v_anchor_outstanding numeric;
  v_signed_amount numeric;
  v_transaction_id uuid;
  v_transaction_ids jsonb := '[]'::jsonb;
  v_anchor_results jsonb := '[]'::jsonb;
  v_row_results jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  v_user := public.stockwise_require_settlement_company(p_company_id);

  IF v_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023';
  END IF;
  IF p_bank_id IS NULL THEN
    RAISE EXCEPTION 'bank_account_required' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'bank_import_rows_required' USING ERRCODE = '22023';
  END IF;

  v_row_count := jsonb_array_length(p_rows);
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'bank_import_empty' USING ERRCODE = '22023';
  END IF;
  IF v_row_count > 500 THEN
    RAISE EXCEPTION 'bank_import_row_limit_exceeded' USING ERRCODE = '22023';
  END IF;

  v_request_size := octet_length(p_rows::text);
  IF v_request_size > 524288 THEN
    RAISE EXCEPTION 'bank_import_request_too_large' USING ERRCODE = '22023';
  END IF;

  SELECT ba.company_id,
         upper(NULLIF(btrim(COALESCE(ba.currency_code, '')), ''))
    INTO v_bank_company_id, v_bank_currency
  FROM public.bank_accounts ba
  WHERE ba.id = p_bank_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_account_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_bank_company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'cross_company_bank_account_denied' USING ERRCODE = '42501';
  END IF;

  FOR v_input_row IN
    SELECT value
    FROM jsonb_array_elements(p_rows)
  LOOP
    v_row_index := v_row_index + 1;
    v_row_number := v_row_index;
    v_error_field := 'row';

    BEGIN
      IF jsonb_typeof(v_input_row) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'bank_import_row_invalid';
      END IF;

      IF COALESCE(v_input_row ->> 'row_number', '') ~ '^[1-9][0-9]{0,6}$' THEN
        v_row_number := (v_input_row ->> 'row_number')::integer;
      END IF;

      v_error_field := 'happened_at';
      v_date_text := NULLIF(btrim(COALESCE(v_input_row ->> 'happened_at', '')), '');
      IF v_date_text IS NULL THEN
        RAISE EXCEPTION 'bank_import_date_required';
      END IF;
      BEGIN
        v_happened_at := v_date_text::date;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'bank_import_date_invalid';
      END;

      v_error_field := 'amount_base';
      v_amount_text := NULLIF(btrim(COALESCE(v_input_row ->> 'amount_base', '')), '');
      IF v_amount_text IS NULL THEN
        RAISE EXCEPTION 'bank_import_amount_required';
      END IF;
      BEGIN
        v_amount := public.stockwise_normalize_settlement_amount(v_amount_text::numeric);
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'bank_import_amount_invalid';
      END;

      v_ref_type := upper(NULLIF(btrim(COALESCE(v_input_row ->> 'ref_type', '')), ''));
      v_ref_id := NULL;
      v_direction := lower(NULLIF(btrim(COALESCE(v_input_row ->> 'direction', '')), ''));

      IF v_ref_type IS NULL AND NULLIF(btrim(COALESCE(v_input_row ->> 'ref_id', '')), '') IS NULL THEN
        IF v_amount IS NULL OR v_amount = 0 THEN
          RAISE EXCEPTION 'ledger_amount_must_be_nonzero';
        END IF;
        IF v_direction IS NULL THEN
          v_direction := 'ledger';
        END IF;
        IF v_direction <> 'ledger' THEN
          RAISE EXCEPTION 'bank_import_direction_invalid';
        END IF;
      ELSE
        v_error_field := 'ref_type';
        IF v_ref_type NOT IN ('SO', 'PO', 'SI', 'VB')
           OR NULLIF(btrim(COALESCE(v_input_row ->> 'ref_id', '')), '') IS NULL THEN
          RAISE EXCEPTION 'settlement_anchor_required';
        END IF;

        v_error_field := 'ref_id';
        BEGIN
          v_ref_id := (v_input_row ->> 'ref_id')::uuid;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'bank_import_reference_invalid';
        END;

        IF v_amount IS NULL OR v_amount <= 0 THEN
          RAISE EXCEPTION 'settlement_amount_must_be_positive';
        END IF;

        IF v_direction IS NULL THEN
          v_direction := CASE WHEN v_ref_type IN ('SO', 'SI') THEN 'receive' ELSE 'pay' END;
        END IF;
        IF v_direction NOT IN ('receive', 'pay') THEN
          RAISE EXCEPTION 'bank_import_direction_invalid';
        END IF;
      END IF;

      v_error_field := 'currency_code';
      v_currency := upper(NULLIF(btrim(COALESCE(v_input_row ->> 'currency_code', '')), ''));
      IF v_currency IS NOT NULL AND v_bank_currency IS NOT NULL AND v_currency <> v_bank_currency THEN
        RAISE EXCEPTION 'bank_import_currency_mismatch';
      END IF;
      v_currency := COALESCE(v_currency, v_bank_currency, '');

      v_memo := NULLIF(btrim(COALESCE(
        v_input_row ->> 'memo',
        v_input_row ->> 'description',
        ''
      )), '');
      v_external_reference := NULLIF(btrim(COALESCE(v_input_row ->> 'external_reference', '')), '');
      IF v_external_reference IS NOT NULL THEN
        v_memo := concat_ws(' | ', v_memo, 'External reference: ' || v_external_reference);
      END IF;

      v_normalized_rows := v_normalized_rows || jsonb_build_array(jsonb_build_object(
        'amount_base', v_amount::text,
        'currency_code', v_currency,
        'direction', v_direction,
        'external_reference', COALESCE(v_external_reference, ''),
        'happened_at', v_happened_at::text,
        'memo', COALESCE(v_memo, ''),
        'ref_id', COALESCE(v_ref_id::text, ''),
        'ref_type', COALESCE(v_ref_type, ''),
        'source_row', v_row_number
      ));
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_code = MESSAGE_TEXT;
      IF v_error_code NOT IN (
        'bank_import_row_invalid',
        'bank_import_date_required',
        'bank_import_date_invalid',
        'bank_import_amount_required',
        'bank_import_amount_invalid',
        'ledger_amount_must_be_nonzero',
        'bank_import_direction_invalid',
        'settlement_anchor_required',
        'bank_import_reference_invalid',
        'settlement_amount_must_be_positive',
        'bank_import_currency_mismatch'
      ) THEN
        v_error_code := 'bank_import_row_invalid';
      END IF;
      RAISE EXCEPTION 'bank_import_row_failed:%', v_error_code
        USING ERRCODE = '22023',
              DETAIL = jsonb_build_object(
                'code', v_error_code,
                'field', v_error_field,
                'row_number', v_row_number
              )::text;
    END;
  END LOOP;

  SELECT COALESCE(jsonb_agg(row_value - 'source_row' ORDER BY (row_value - 'source_row')::text), '[]'::jsonb)
    INTO v_identity_rows
  FROM jsonb_array_elements(v_normalized_rows) AS rows(row_value);

  v_payload := jsonb_build_object(
    'bank_id', p_bank_id::text,
    'company_id', p_company_id::text,
    'operation_type', v_operation_type,
    'rows', v_identity_rows
  );
  v_hash := encode(extensions.digest(convert_to(v_payload::text, 'utf8'), 'sha256'), 'hex');

  LOOP
    BEGIN
      INSERT INTO public.posting_requests (
        company_id,
        operation_type,
        request_key,
        payload_hash,
        status,
        created_by,
        expires_at
      ) VALUES (
        p_company_id,
        v_operation_type,
        v_request_key,
        v_hash,
        'in_progress',
        v_user,
        now() + interval '180 days'
      )
      RETURNING * INTO v_request;
      v_claimed_new := true;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      SELECT *
        INTO v_request
      FROM public.posting_requests pr
      WHERE pr.company_id = p_company_id
        AND pr.operation_type = v_operation_type
        AND pr.request_key = v_request_key
      FOR UPDATE;

      EXIT WHEN FOUND;
    END;
  END LOOP;

  IF v_request.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_request.status = 'succeeded' THEN
    IF v_request.result_payload IS NULL THEN
      RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_request.result_payload || jsonb_build_object('replayed', true);
  ELSIF v_request.status = 'in_progress' AND NOT v_claimed_new THEN
    RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
  ELSIF v_request.status = 'failed' THEN
    RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
  END IF;

  FOR v_input_row IN
    SELECT row_value
    FROM jsonb_array_elements(v_normalized_rows) AS rows(row_value)
    ORDER BY
      COALESCE(row_value ->> 'ref_type', ''),
      COALESCE(row_value ->> 'ref_id', ''),
      (row_value - 'source_row')::text,
      (row_value ->> 'source_row')::integer
  LOOP
    v_row_number := (v_input_row ->> 'source_row')::integer;
    v_happened_at := (v_input_row ->> 'happened_at')::date;
    v_amount := (v_input_row ->> 'amount_base')::numeric;
    v_memo := NULLIF(v_input_row ->> 'memo', '');
    v_ref_type := NULLIF(v_input_row ->> 'ref_type', '');
    v_ref_id := NULLIF(v_input_row ->> 'ref_id', '')::uuid;
    v_direction := v_input_row ->> 'direction';
    v_anchor_type := NULL;
    v_anchor_id := NULL;
    v_anchor_direction := NULL;
    v_anchor_outstanding := NULL;

    BEGIN
      IF v_ref_type IS NULL THEN
        v_signed_amount := v_amount;
      ELSE
        SELECT *
          INTO v_anchor
        FROM public.resolve_settlement_anchor(p_company_id, v_ref_type, v_ref_id);

        IF NOT FOUND THEN
          RAISE EXCEPTION 'settlement_anchor_not_found';
        END IF;
        v_anchor_type := v_anchor.anchor_type;
        v_anchor_id := v_anchor.anchor_id;
        v_anchor_direction := v_anchor.settlement_direction;
        v_anchor_outstanding := v_anchor.outstanding_base;

        IF v_direction IS DISTINCT FROM v_anchor_direction THEN
          RAISE EXCEPTION 'bank_import_direction_mismatch';
        END IF;
        IF v_anchor_outstanding <= 0 THEN
          RAISE EXCEPTION 'settlement_already_resolved';
        END IF;
        IF v_amount > v_anchor_outstanding THEN
          RAISE EXCEPTION 'settlement_amount_exceeds_outstanding';
        END IF;

        v_signed_amount := CASE
          WHEN v_anchor_direction = 'receive' THEN v_amount
          ELSE -v_amount
        END;
      END IF;

      INSERT INTO public.bank_transactions (
        bank_id, happened_at, memo, amount_base, reconciled, ref_type, ref_id
      ) VALUES (
        p_bank_id,
        v_happened_at,
        v_memo,
        v_signed_amount,
        false,
        v_anchor_type,
        v_anchor_id
      )
      RETURNING id INTO v_transaction_id;

      v_transaction_ids := v_transaction_ids || jsonb_build_array(v_transaction_id);
      v_row_results := v_row_results || jsonb_build_array(jsonb_build_object(
        'amount_base', v_amount,
        'row_number', v_row_number,
        'signed_amount_base', v_signed_amount,
        'transaction_id', v_transaction_id
      ));

      IF v_ref_type IS NOT NULL THEN
        v_anchor_results := v_anchor_results || jsonb_build_array(jsonb_build_object(
          'amount_base', v_amount,
          'anchor_id', v_anchor_id,
          'anchor_type', v_anchor_type,
          'direction', v_anchor_direction,
          'row_number', v_row_number,
          'transaction_id', v_transaction_id
        ));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_code = MESSAGE_TEXT;
      IF v_error_code NOT IN (
        'settlement_anchor_not_found',
        'settlement_anchor_not_ready',
        'finance_document_became_active_anchor',
        'cross_company_anchor_denied',
        'settlement_already_resolved',
        'settlement_amount_exceeds_outstanding',
        'bank_import_direction_mismatch'
      ) THEN
        v_error_code := 'bank_import_row_invalid';
      END IF;
      RAISE EXCEPTION 'bank_import_row_failed:%', v_error_code
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'code', v_error_code,
                'field', 'row',
                'row_number', v_row_number
              )::text;
    END;
  END LOOP;

  v_result := jsonb_build_object(
    'anchors', v_anchor_results,
    'bank_id', p_bank_id,
    'import_fingerprint', v_hash,
    'operation_type', v_operation_type,
    'posting_request_id', v_request.id,
    'replayed', false,
    'request_key', v_request_key,
    'row_count', v_row_count,
    'rows', v_row_results,
    'transaction_ids', v_transaction_ids
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'BANK_LEDGER_IMPORT',
         result_ref_id = v_request.id::text,
         result_payload = v_result,
         error_code = NULL,
         error_message = NULL,
         updated_at = now()
   WHERE id = v_request.id;

  RETURN v_result;
END;
$$;

-- Serialize anchor transition with governed settlement posting. Existing
-- trigger entry points remain intact, but normal clients cannot call them.
CREATE OR REPLACE FUNCTION public.transfer_sales_order_settlement_anchor(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_invoice record;
BEGIN
  SELECT si.id, si.company_id, si.sales_order_id, si.document_workflow_status
    INTO v_invoice
  FROM public.sales_invoices si
  WHERE si.id = p_invoice_id
  FOR UPDATE;

  IF v_invoice.id IS NULL
     OR v_invoice.sales_order_id IS NULL
     OR v_invoice.document_workflow_status <> 'issued' THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('stockwise:settlement:SO:' || v_invoice.sales_order_id::text, 0)
  );

  UPDATE public.cash_transactions ct
     SET ref_type = 'SI', ref_id = v_invoice.id
   WHERE ct.company_id = v_invoice.company_id
     AND ct.type = 'sale_receipt'
     AND ct.ref_type = 'SO'
     AND ct.ref_id = v_invoice.sales_order_id;

  UPDATE public.bank_transactions bt
     SET ref_type = 'SI', ref_id = v_invoice.id
   WHERE bt.ref_type = 'SO'
     AND bt.ref_id = v_invoice.sales_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_purchase_order_settlement_anchor(p_vendor_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_bill record;
BEGIN
  SELECT vb.id, vb.company_id, vb.purchase_order_id, vb.document_workflow_status
    INTO v_bill
  FROM public.vendor_bills vb
  WHERE vb.id = p_vendor_bill_id
  FOR UPDATE;

  IF v_bill.id IS NULL
     OR v_bill.purchase_order_id IS NULL
     OR v_bill.document_workflow_status <> 'posted' THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('stockwise:settlement:PO:' || v_bill.purchase_order_id::text, 0)
  );

  UPDATE public.cash_transactions ct
     SET ref_type = 'VB', ref_id = v_bill.id
   WHERE ct.company_id = v_bill.company_id
     AND ct.type = 'purchase_payment'
     AND ct.ref_type = 'PO'
     AND ct.ref_id = v_bill.purchase_order_id;

  UPDATE public.bank_transactions bt
     SET ref_type = 'VB', ref_id = v_bill.id
   WHERE bt.ref_type = 'PO'
     AND bt.ref_id = v_bill.purchase_order_id;
END;
$$;

ALTER FUNCTION public.stockwise_require_settlement_company(uuid) OWNER TO postgres;
ALTER FUNCTION public.stockwise_normalize_settlement_amount(numeric) OWNER TO postgres;
ALTER FUNCTION public.resolve_settlement_anchor(uuid, text, uuid) OWNER TO postgres;
ALTER FUNCTION public.post_governed_ledger_transaction(text, text, uuid, uuid, text, uuid, date, numeric, text, text) OWNER TO postgres;
ALTER FUNCTION public.post_cash_settlement(uuid, text, uuid, date, numeric, text, text) OWNER TO postgres;
ALTER FUNCTION public.post_bank_settlement(uuid, uuid, text, uuid, date, numeric, text, text) OWNER TO postgres;
ALTER FUNCTION public.post_cash_adjustment(uuid, date, numeric, text, text) OWNER TO postgres;
ALTER FUNCTION public.post_bank_ledger_transaction(uuid, uuid, date, numeric, text, text) OWNER TO postgres;
ALTER FUNCTION public.post_bank_ledger_import(uuid, uuid, jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.transfer_sales_order_settlement_anchor(uuid) OWNER TO postgres;
ALTER FUNCTION public.transfer_purchase_order_settlement_anchor(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.stockwise_require_settlement_company(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stockwise_normalize_settlement_amount(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_settlement_anchor(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_governed_ledger_transaction(text, text, uuid, uuid, text, uuid, date, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_sales_order_settlement_anchor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_purchase_order_settlement_anchor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_invoice_transfer_settlement_anchor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendor_bill_transfer_settlement_anchor() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.post_cash_settlement(uuid, text, uuid, date, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_bank_settlement(uuid, uuid, text, uuid, date, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_cash_adjustment(uuid, date, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_bank_ledger_transaction(uuid, uuid, date, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_bank_ledger_import(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_cash_settlement(uuid, text, uuid, date, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_bank_settlement(uuid, uuid, text, uuid, date, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_cash_adjustment(uuid, date, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_bank_ledger_transaction(uuid, uuid, date, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_bank_ledger_import(uuid, uuid, jsonb, text) TO authenticated;

-- The public APIs above are now the maintained posting surface. Existing
-- SELECT and reconciliation UPDATE behavior is deliberately left unchanged.
REVOKE INSERT ON TABLE public.cash_transactions FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON TABLE public.bank_transactions FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.post_cash_settlement(uuid, text, uuid, date, numeric, text, text)
  IS 'Idempotent cash settlement posting against the current SO, PO, SI, or VB anchor.';
COMMENT ON FUNCTION public.post_bank_settlement(uuid, uuid, text, uuid, date, numeric, text, text)
  IS 'Idempotent bank settlement posting against the current SO, PO, SI, or VB anchor.';
COMMENT ON FUNCTION public.post_cash_adjustment(uuid, date, numeric, text, text)
  IS 'Idempotent governed cash-ledger adjustment posting.';
COMMENT ON FUNCTION public.post_bank_ledger_transaction(uuid, uuid, date, numeric, text, text)
  IS 'Idempotent governed unlinked bank-ledger posting for maintained manual entry.';
COMMENT ON FUNCTION public.post_bank_ledger_import(uuid, uuid, jsonb, text)
  IS 'Atomic, batch-idempotent governed bank-ledger import with optional current settlement anchors.';
