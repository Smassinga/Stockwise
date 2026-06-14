-- A2.4a.1: add a backend idempotency wrapper for normal web Point of Sale.
-- This intentionally leaves the legacy POS RPCs executable for compatibility
-- while the frontend and packaged clients move to post_operator_sale.

CREATE OR REPLACE FUNCTION public.post_operator_sale(
  p_company_id uuid,
  p_bin_from_id text,
  p_customer_id uuid DEFAULT NULL,
  p_order_date date DEFAULT CURRENT_DATE,
  p_currency_code text DEFAULT 'MZN',
  p_fx_to_base numeric DEFAULT 1,
  p_reference_no text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_lines jsonb DEFAULT '[]'::jsonb,
  p_settlement_method text DEFAULT 'cash',
  p_bank_account_id uuid DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS TABLE(
  sales_order_id uuid,
  order_no text,
  customer_id uuid,
  customer_name text,
  line_count integer,
  total_amount numeric,
  settlement_method text,
  settlement_id uuid,
  settled_amount_base numeric,
  bank_account_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_active_company_id uuid := public.current_company_id();
  v_member_role public.member_role;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_method text := lower(COALESCE(NULLIF(btrim(p_settlement_method), ''), 'cash'));
  v_order_date date := COALESCE(p_order_date, CURRENT_DATE);
  v_currency_code text := upper(COALESCE(NULLIF(btrim(p_currency_code), ''), 'MZN'));
  v_fx_to_base numeric := CASE WHEN COALESCE(p_fx_to_base, 0) > 0 THEN p_fx_to_base ELSE 1 END;
  v_reference_no text := NULLIF(btrim(p_reference_no), '');
  v_notes text := NULLIF(btrim(p_notes), '');
  v_hash_lines jsonb;
  v_payload_hash text;
  v_request public.posting_requests%ROWTYPE;
  v_sale record;
  v_result_payload jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_active_company_id IS NULL THEN
    RAISE EXCEPTION 'Select a company before posting the sale.' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Select a company before posting the sale.' USING ERRCODE = 'P0001';
  END IF;

  IF v_active_company_id <> p_company_id THEN
    RAISE EXCEPTION 'Switch into the target company before posting the sale.' USING ERRCODE = '42501';
  END IF;

  IF v_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023';
  END IF;

  SELECT cm.role
    INTO v_member_role
  FROM public.company_members cm
  WHERE cm.company_id = p_company_id
    AND cm.user_id = v_user
    AND cm.status = 'active'::public.member_status
  LIMIT 1;

  IF v_member_role IS NULL THEN
    RAISE EXCEPTION 'You do not have access to post Point of Sale sales in this company.' USING ERRCODE = '42501';
  END IF;

  IF v_member_role NOT IN (
    'OWNER'::public.member_role,
    'ADMIN'::public.member_role,
    'MANAGER'::public.member_role,
    'OPERATOR'::public.member_role
  ) THEN
    RAISE EXCEPTION 'Only operators and above can post sales from Point of Sale.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'line_no', line_no,
          'item_id', NULLIF(btrim(line_data ->> 'item_id'), ''),
          'qty',
            regexp_replace(
              regexp_replace(COALESCE(NULLIF(btrim(line_data ->> 'qty'), '')::numeric, 0)::text, '(\.\d*?)0+$', '\1'),
              '\.$',
              ''
            ),
          'unit_price',
            CASE
              WHEN NULLIF(btrim(line_data ->> 'unit_price'), '') IS NULL THEN NULL
              ELSE regexp_replace(
                regexp_replace((NULLIF(btrim(line_data ->> 'unit_price'), '')::numeric)::text, '(\.\d*?)0+$', '\1'),
                '\.$',
                ''
              )
            END
        )
        ORDER BY line_no
      ),
      '[]'::jsonb
    )
      INTO v_hash_lines
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS lines(line_data, line_no);
  ELSE
    v_hash_lines := COALESCE(p_lines, 'null'::jsonb);
  END IF;

  v_payload_hash := md5(jsonb_build_object(
    'company_id', v_active_company_id,
    'pos_company_id', p_company_id,
    'bin_from_id', p_bin_from_id,
    'customer_id', p_customer_id,
    'order_date', v_order_date,
    'currency_code', v_currency_code,
    'fx_to_base',
      regexp_replace(
        regexp_replace(v_fx_to_base::text, '(\.\d*?)0+$', '\1'),
        '\.$',
        ''
      ),
    'reference_no', v_reference_no,
    'notes', v_notes,
    'lines', v_hash_lines,
    'settlement_method', v_method,
    'bank_account_id', CASE WHEN v_method = 'bank' THEN p_bank_account_id ELSE NULL END
  )::text);

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
        v_active_company_id,
        'operator.sale',
        v_request_key,
        v_payload_hash,
        'in_progress',
        v_user,
        now() + interval '180 days'
      )
      RETURNING * INTO v_request;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      SELECT *
        INTO v_request
      FROM public.posting_requests pr
      WHERE pr.company_id = v_active_company_id
        AND pr.operation_type = 'operator.sale'
        AND pr.request_key = v_request_key
      FOR UPDATE;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      IF v_request.payload_hash IS DISTINCT FROM v_payload_hash THEN
        RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023';
      END IF;

      IF v_request.status = 'succeeded' THEN
        IF v_request.result_payload IS NULL OR v_request.result_ref_id IS NULL THEN
          RAISE EXCEPTION 'idempotency_result_missing' USING ERRCODE = 'P0001';
        END IF;

        sales_order_id := (v_request.result_payload ->> 'sales_order_id')::uuid;
        order_no := v_request.result_payload ->> 'order_no';
        customer_id := (v_request.result_payload ->> 'customer_id')::uuid;
        customer_name := v_request.result_payload ->> 'customer_name';
        line_count := COALESCE((v_request.result_payload ->> 'line_count')::integer, 0);
        total_amount := COALESCE((v_request.result_payload ->> 'total_amount')::numeric, 0);
        settlement_method := v_request.result_payload ->> 'settlement_method';
        settlement_id := NULLIF(v_request.result_payload ->> 'settlement_id', '')::uuid;
        settled_amount_base := NULLIF(v_request.result_payload ->> 'settled_amount_base', '')::numeric;
        bank_account_id := NULLIF(v_request.result_payload ->> 'bank_account_id', '')::uuid;
        RETURN NEXT;
        RETURN;
      ELSIF v_request.status = 'in_progress' THEN
        RAISE EXCEPTION 'request_in_progress' USING ERRCODE = '55P03';
      ELSE
        RAISE EXCEPTION 'idempotency_request_failed_use_new_key' USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;

  SELECT *
    INTO v_sale
  FROM public.create_operator_sale_issue_with_settlement(
    p_company_id,
    p_bin_from_id,
    p_customer_id,
    v_order_date,
    v_currency_code,
    v_fx_to_base,
    v_reference_no,
    v_notes,
    p_lines,
    v_method,
    CASE WHEN v_method = 'bank' THEN p_bank_account_id ELSE NULL END
  );

  IF v_sale.sales_order_id IS NULL THEN
    RAISE EXCEPTION 'Could not create the POS sale before recording idempotency result.' USING ERRCODE = 'P0001';
  END IF;

  v_result_payload := jsonb_build_object(
    'sales_order_id', v_sale.sales_order_id,
    'order_no', v_sale.order_no,
    'customer_id', v_sale.customer_id,
    'customer_name', v_sale.customer_name,
    'line_count', v_sale.line_count,
    'total_amount', v_sale.total_amount,
    'settlement_method', v_sale.settlement_method,
    'settlement_id', v_sale.settlement_id,
    'settled_amount_base', v_sale.settled_amount_base,
    'bank_account_id', v_sale.bank_account_id
  );

  UPDATE public.posting_requests
     SET status = 'succeeded',
         result_ref_type = 'SO',
         result_ref_id = v_sale.sales_order_id::text,
         result_payload = v_result_payload,
         error_code = NULL,
         error_message = NULL
   WHERE id = v_request.id;

  sales_order_id := v_sale.sales_order_id;
  order_no := v_sale.order_no;
  customer_id := v_sale.customer_id;
  customer_name := v_sale.customer_name;
  line_count := v_sale.line_count;
  total_amount := v_sale.total_amount;
  settlement_method := v_sale.settlement_method;
  settlement_id := v_sale.settlement_id;
  settled_amount_base := v_sale.settled_amount_base;
  bank_account_id := v_sale.bank_account_id;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.post_operator_sale(uuid, text, uuid, date, text, numeric, text, text, jsonb, text, uuid, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.post_operator_sale(uuid, text, uuid, date, text, numeric, text, text, jsonb, text, uuid, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.post_operator_sale(uuid, text, uuid, date, text, numeric, text, text, jsonb, text, uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.post_operator_sale(uuid, text, uuid, date, text, numeric, text, text, jsonb, text, uuid, text)
  IS 'Idempotent compatibility wrapper for normal web Point of Sale posting. Uses posting_requests with operation_type operator.sale and delegates business posting to create_operator_sale_issue_with_settlement.';
