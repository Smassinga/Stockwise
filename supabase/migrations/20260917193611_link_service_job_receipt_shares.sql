-- Link actual customer collections to Service Job revenue-share costs and optional payouts.
-- The customer receipt remains the full AR settlement. The collaborator share is a separate
-- job cost and, when paid, a separate cash/bank outflow with an auditable link between them.

CREATE TABLE public.service_job_receipt_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE RESTRICT,
  receipt_channel text NOT NULL CHECK (receipt_channel IN ('cash','bank')),
  receipt_cash_transaction_id uuid REFERENCES public.cash_transactions(id) ON DELETE RESTRICT,
  receipt_bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE RESTRICT,
  receipt_amount_base numeric(18,2) NOT NULL CHECK (receipt_amount_base > 0),
  share_percent numeric(7,4) NOT NULL CHECK (share_percent > 0 AND share_percent <= 100),
  share_amount_base numeric(18,2) NOT NULL CHECK (share_amount_base > 0),
  direct_cost_id uuid NOT NULL REFERENCES public.service_job_direct_costs(id) ON DELETE RESTRICT,
  description_snapshot text NOT NULL CHECK (length(btrim(description_snapshot)) > 0),
  payout_channel text CHECK (payout_channel IN ('cash','bank')),
  payout_cash_transaction_id uuid REFERENCES public.cash_transactions(id) ON DELETE RESTRICT,
  payout_bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE RESTRICT,
  payout_bank_id uuid REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  paid_at date,
  request_key text NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_job_receipt_shares_request_unique UNIQUE (company_id, request_key),
  CONSTRAINT service_job_receipt_shares_direct_cost_unique UNIQUE (direct_cost_id),
  CONSTRAINT service_job_receipt_shares_receipt_shape CHECK (
    (receipt_channel='cash' AND receipt_cash_transaction_id IS NOT NULL AND receipt_bank_transaction_id IS NULL)
    OR (receipt_channel='bank' AND receipt_bank_transaction_id IS NOT NULL AND receipt_cash_transaction_id IS NULL)
  ),
  CONSTRAINT service_job_receipt_shares_payout_shape CHECK (
    (payout_channel IS NULL AND payout_cash_transaction_id IS NULL AND payout_bank_transaction_id IS NULL AND payout_bank_id IS NULL AND paid_at IS NULL)
    OR (payout_channel='cash' AND payout_cash_transaction_id IS NOT NULL AND payout_bank_transaction_id IS NULL AND payout_bank_id IS NULL AND paid_at IS NOT NULL)
    OR (payout_channel='bank' AND payout_bank_transaction_id IS NOT NULL AND payout_cash_transaction_id IS NULL AND payout_bank_id IS NOT NULL AND paid_at IS NOT NULL)
  )
);

CREATE INDEX service_job_receipt_shares_job_idx
  ON public.service_job_receipt_shares(company_id, service_job_id, created_at DESC);
CREATE INDEX service_job_receipt_shares_cash_receipt_idx
  ON public.service_job_receipt_shares(receipt_cash_transaction_id)
  WHERE receipt_cash_transaction_id IS NOT NULL;
CREATE INDEX service_job_receipt_shares_bank_receipt_idx
  ON public.service_job_receipt_shares(receipt_bank_transaction_id)
  WHERE receipt_bank_transaction_id IS NOT NULL;
CREATE INDEX service_job_receipt_shares_cash_payout_idx
  ON public.service_job_receipt_shares(payout_cash_transaction_id)
  WHERE payout_cash_transaction_id IS NOT NULL;
CREATE INDEX service_job_receipt_shares_bank_payout_idx
  ON public.service_job_receipt_shares(payout_bank_transaction_id)
  WHERE payout_bank_transaction_id IS NOT NULL;
CREATE INDEX service_job_receipt_shares_payout_bank_idx
  ON public.service_job_receipt_shares(payout_bank_id)
  WHERE payout_bank_id IS NOT NULL;

ALTER TABLE public.service_job_receipt_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_job_receipt_shares FORCE ROW LEVEL SECURITY;

CREATE POLICY service_job_receipt_shares_select
  ON public.service_job_receipt_shares
  FOR SELECT TO authenticated
  USING (
    company_id = (SELECT public.current_company_id())
    AND public.member_has_company_access(company_id, false)
  );

REVOKE ALL ON public.service_job_receipt_shares FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.service_job_receipt_shares TO authenticated;
GRANT ALL ON public.service_job_receipt_shares TO service_role;

CREATE OR REPLACE VIEW public.v_service_job_receipt_candidates
WITH (security_invoker = true)
AS
SELECT
  sj.company_id,
  sj.id AS service_job_id,
  'cash'::text AS receipt_channel,
  ct.id AS receipt_transaction_id,
  ct.happened_at AS received_on,
  round(ct.amount_base, 2)::numeric(18,2) AS receipt_amount_base,
  ct.ref_type AS anchor_type,
  COALESCE(si.internal_reference, so.order_no, ct.ref_type || ':' || ct.ref_id::text) AS anchor_reference,
  ct.memo
FROM public.service_jobs sj
JOIN public.sales_orders so
  ON so.id = sj.sales_order_id
 AND so.company_id = sj.company_id
JOIN public.cash_transactions ct
  ON ct.company_id = sj.company_id
 AND ct.type = 'sale_receipt'
 AND ct.amount_base > 0
LEFT JOIN public.sales_invoices si
  ON ct.ref_type = 'SI'
 AND si.id = ct.ref_id
 AND si.company_id = sj.company_id
WHERE
  (ct.ref_type = 'SO' AND ct.ref_id = sj.sales_order_id)
  OR (ct.ref_type = 'SI' AND si.sales_order_id = sj.sales_order_id)
UNION ALL
SELECT
  sj.company_id,
  sj.id AS service_job_id,
  'bank'::text AS receipt_channel,
  bt.id AS receipt_transaction_id,
  bt.happened_at AS received_on,
  round(bt.amount_base, 2)::numeric(18,2) AS receipt_amount_base,
  bt.ref_type AS anchor_type,
  COALESCE(si.internal_reference, so.order_no, bt.ref_type || ':' || bt.ref_id::text) AS anchor_reference,
  bt.memo
FROM public.service_jobs sj
JOIN public.sales_orders so
  ON so.id = sj.sales_order_id
 AND so.company_id = sj.company_id
JOIN public.bank_accounts ba
  ON ba.company_id = sj.company_id
JOIN public.bank_transactions bt
  ON bt.bank_id = ba.id
 AND bt.amount_base > 0
LEFT JOIN public.sales_invoices si
  ON bt.ref_type = 'SI'
 AND si.id = bt.ref_id
 AND si.company_id = sj.company_id
WHERE
  (bt.ref_type = 'SO' AND bt.ref_id = sj.sales_order_id)
  OR (bt.ref_type = 'SI' AND si.sales_order_id = sj.sales_order_id);

REVOKE ALL ON public.v_service_job_receipt_candidates FROM PUBLIC, anon;
GRANT SELECT ON public.v_service_job_receipt_candidates TO authenticated;

COMMENT ON VIEW public.v_service_job_receipt_candidates IS
  'Actual positive SO/SI cash and bank receipts eligible to anchor a Service Job collection-share cost.';

CREATE OR REPLACE FUNCTION public.pay_service_job_receipt_share(
  p_company_id uuid,
  p_share_id uuid,
  p_payout_channel text,
  p_bank_id uuid DEFAULT NULL,
  p_paid_on date DEFAULT current_date,
  p_memo text DEFAULT NULL,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_share public.service_job_receipt_shares%ROWTYPE;
  v_hash text;
  v_req public.posting_requests%ROWTYPE;
  v_ledger jsonb;
  v_transaction_id uuid;
  v_result jsonb;
  v_memo text;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id, false);

  IF p_payout_channel NOT IN ('cash','bank') OR p_paid_on IS NULL
     OR NULLIF(btrim(COALESCE(p_request_key,'')), '') IS NULL THEN
    RAISE EXCEPTION 'service_job_receipt_share_payout_invalid' USING ERRCODE='22023';
  END IF;
  IF p_payout_channel='bank' AND p_bank_id IS NULL THEN
    RAISE EXCEPTION 'service_job_receipt_share_bank_required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_share
  FROM public.service_job_receipt_shares
  WHERE id=p_share_id AND company_id=p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_job_receipt_share_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_share.payout_channel IS NOT NULL THEN
    RAISE EXCEPTION 'service_job_receipt_share_already_paid' USING ERRCODE='P0001';
  END IF;

  v_memo := COALESCE(NULLIF(btrim(p_memo),''), 'Service Job revenue-share payout: ' || v_share.description_snapshot);
  v_hash := md5(jsonb_build_object(
    'shareId',p_share_id,
    'channel',p_payout_channel,
    'bankId',p_bank_id,
    'paidOn',p_paid_on,
    'amount',v_share.share_amount_base,
    'memo',v_memo
  )::text);
  v_req := public.stockwise_claim_posting_request(
    p_company_id,'service.job.receipt.share.pay',p_request_key,v_hash
  );
  IF v_req.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE='22023';
  END IF;
  IF v_req.status='succeeded' THEN
    RETURN v_req.result_payload || jsonb_build_object('replayed',true);
  END IF;

  IF p_payout_channel='cash' THEN
    v_ledger := public.post_cash_adjustment(
      p_company_id,p_paid_on,-v_share.share_amount_base,v_memo,p_request_key || ':ledger'
    );
  ELSE
    v_ledger := public.post_bank_ledger_transaction(
      p_company_id,p_bank_id,p_paid_on,-v_share.share_amount_base,v_memo,p_request_key || ':ledger'
    );
  END IF;

  v_transaction_id := (v_ledger->>'transaction_id')::uuid;

  UPDATE public.service_job_receipt_shares
  SET payout_channel=p_payout_channel,
      payout_cash_transaction_id=CASE WHEN p_payout_channel='cash' THEN v_transaction_id ELSE NULL END,
      payout_bank_transaction_id=CASE WHEN p_payout_channel='bank' THEN v_transaction_id ELSE NULL END,
      payout_bank_id=CASE WHEN p_payout_channel='bank' THEN p_bank_id ELSE NULL END,
      paid_at=p_paid_on
  WHERE id=v_share.id;

  PERFORM public.service_job_write_event(
    p_company_id,v_share.service_job_id,'receipt_share_paid',NULL,NULL,NULL,
    jsonb_build_object(
      'receiptShareId',v_share.id,
      'directCostId',v_share.direct_cost_id,
      'payoutChannel',p_payout_channel,
      'payoutTransactionId',v_transaction_id,
      'amountBase',v_share.share_amount_base
    )
  );

  v_result := jsonb_build_object(
    'receiptShareId',v_share.id,
    'directCostId',v_share.direct_cost_id,
    'shareAmountBase',v_share.share_amount_base,
    'payoutChannel',p_payout_channel,
    'payoutTransactionId',v_transaction_id,
    'paidOn',p_paid_on,
    'replayed',false
  );

  UPDATE public.posting_requests
  SET status='succeeded',
      result_ref_type='SERVICE_JOB_RECEIPT_SHARE_PAYOUT',
      result_ref_id=v_share.id::text,
      result_payload=v_result,
      error_code=NULL,
      error_message=NULL,
      updated_at=now()
  WHERE id=v_req.id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_service_job_receipt_share(
  p_company_id uuid,
  p_service_job_id uuid,
  p_receipt_channel text,
  p_receipt_transaction_id uuid,
  p_share_percent numeric,
  p_description text DEFAULT NULL,
  p_existing_direct_cost_id uuid DEFAULT NULL,
  p_payout_channel text DEFAULT NULL,
  p_payout_bank_id uuid DEFAULT NULL,
  p_paid_on date DEFAULT current_date,
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.service_jobs%ROWTYPE;
  v_receipt record;
  v_cost public.service_job_direct_costs%ROWTYPE;
  v_direct_cost_id uuid;
  v_share_id uuid;
  v_share_amount numeric(18,2);
  v_existing_share_total numeric;
  v_description text;
  v_base_currency text;
  v_hash text;
  v_req public.posting_requests%ROWTYPE;
  v_pay_result jsonb;
  v_result jsonb;
BEGIN
  PERFORM public.service_job_assert_role(p_company_id, false);

  IF p_receipt_channel NOT IN ('cash','bank')
     OR p_receipt_transaction_id IS NULL
     OR p_share_percent IS NULL OR p_share_percent <= 0 OR p_share_percent > 100
     OR NULLIF(btrim(COALESCE(p_request_key,'')), '') IS NULL THEN
    RAISE EXCEPTION 'service_job_receipt_share_invalid' USING ERRCODE='22023';
  END IF;
  IF p_payout_channel IS NOT NULL AND p_payout_channel NOT IN ('cash','bank') THEN
    RAISE EXCEPTION 'service_job_receipt_share_payout_invalid' USING ERRCODE='22023';
  END IF;
  IF p_payout_channel='bank' AND p_payout_bank_id IS NULL THEN
    RAISE EXCEPTION 'service_job_receipt_share_bank_required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_job
  FROM public.service_jobs
  WHERE id=p_service_job_id AND company_id=p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_job_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_job.costing_status <> 'open' OR v_job.execution_status='cancelled' THEN
    RAISE EXCEPTION 'service_job_receipt_share_costing_closed' USING ERRCODE='P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stockwise:service-job-receipt-share:' || p_receipt_channel || ':' || p_receipt_transaction_id::text,0)
  );

  SELECT * INTO v_receipt
  FROM public.v_service_job_receipt_candidates
  WHERE company_id=p_company_id
    AND service_job_id=p_service_job_id
    AND receipt_channel=p_receipt_channel
    AND receipt_transaction_id=p_receipt_transaction_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_job_receipt_not_eligible' USING ERRCODE='P0001';
  END IF;

  v_share_amount := round((v_receipt.receipt_amount_base * p_share_percent / 100.0)::numeric,2);
  IF v_share_amount <= 0 THEN
    RAISE EXCEPTION 'service_job_receipt_share_amount_invalid' USING ERRCODE='22023';
  END IF;

  SELECT COALESCE(sum(s.share_amount_base),0)
  INTO v_existing_share_total
  FROM public.service_job_receipt_shares s
  WHERE s.receipt_channel=p_receipt_channel
    AND (
      (p_receipt_channel='cash' AND s.receipt_cash_transaction_id=p_receipt_transaction_id)
      OR (p_receipt_channel='bank' AND s.receipt_bank_transaction_id=p_receipt_transaction_id)
    );
  IF v_existing_share_total + v_share_amount > v_receipt.receipt_amount_base + 0.005 THEN
    RAISE EXCEPTION 'service_job_receipt_share_exceeds_receipt' USING ERRCODE='P0001';
  END IF;

  v_description := COALESCE(
    NULLIF(btrim(p_description),''),
    'Revenue share on collection ' || COALESCE(v_receipt.anchor_reference,'')
  );

  v_hash := md5(jsonb_build_object(
    'jobId',p_service_job_id,
    'receiptChannel',p_receipt_channel,
    'receiptTransactionId',p_receipt_transaction_id,
    'receiptAmount',v_receipt.receipt_amount_base,
    'sharePercent',p_share_percent,
    'shareAmount',v_share_amount,
    'description',v_description,
    'existingDirectCostId',p_existing_direct_cost_id,
    'payoutChannel',p_payout_channel,
    'payoutBankId',p_payout_bank_id,
    'paidOn',p_paid_on
  )::text);
  v_req := public.stockwise_claim_posting_request(
    p_company_id,'service.job.receipt.share.record',p_request_key,v_hash
  );
  IF v_req.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE='22023';
  END IF;
  IF v_req.status='succeeded' THEN
    RETURN v_req.result_payload || jsonb_build_object('replayed',true);
  END IF;

  IF p_existing_direct_cost_id IS NOT NULL THEN
    SELECT * INTO v_cost
    FROM public.service_job_direct_costs dc
    WHERE dc.id=p_existing_direct_cost_id
      AND dc.company_id=p_company_id
      AND dc.service_job_id=p_service_job_id
      AND dc.category='subcontractor'
      AND dc.reverses_id IS NULL
      AND dc.reversed_by_id IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'service_job_receipt_share_cost_not_eligible' USING ERRCODE='P0001';
    END IF;
    IF abs(v_cost.base_amount-v_share_amount) > 0.005 THEN
      RAISE EXCEPTION 'service_job_receipt_share_cost_amount_mismatch' USING ERRCODE='P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.service_job_receipt_shares WHERE direct_cost_id=v_cost.id) THEN
      RAISE EXCEPTION 'service_job_receipt_share_cost_already_linked' USING ERRCODE='P0001';
    END IF;
    v_direct_cost_id := v_cost.id;
    v_description := v_cost.description;
  ELSE
    SELECT COALESCE(cs.base_currency_code,'MZN')
    INTO v_base_currency
    FROM public.company_settings cs
    WHERE cs.company_id=p_company_id;
    v_base_currency := COALESCE(v_base_currency,'MZN');

    v_direct_cost_id := public.add_service_job_direct_cost(
      p_company_id,p_service_job_id,'subcontractor',v_description,
      v_base_currency,v_share_amount,1,p_paid_on,
      'receipt-share:' || p_receipt_channel || ':' || p_receipt_transaction_id::text,
      NULL,NULL
    );
  END IF;

  INSERT INTO public.service_job_receipt_shares(
    company_id,service_job_id,receipt_channel,
    receipt_cash_transaction_id,receipt_bank_transaction_id,
    receipt_amount_base,share_percent,share_amount_base,direct_cost_id,
    description_snapshot,request_key,created_by
  ) VALUES (
    p_company_id,p_service_job_id,p_receipt_channel,
    CASE WHEN p_receipt_channel='cash' THEN p_receipt_transaction_id ELSE NULL END,
    CASE WHEN p_receipt_channel='bank' THEN p_receipt_transaction_id ELSE NULL END,
    v_receipt.receipt_amount_base,p_share_percent,v_share_amount,v_direct_cost_id,
    v_description,btrim(p_request_key),auth.uid()
  ) RETURNING id INTO v_share_id;

  PERFORM public.service_job_write_event(
    p_company_id,p_service_job_id,'receipt_share_linked',NULL,NULL,NULL,
    jsonb_build_object(
      'receiptShareId',v_share_id,
      'receiptChannel',p_receipt_channel,
      'receiptTransactionId',p_receipt_transaction_id,
      'receiptAmountBase',v_receipt.receipt_amount_base,
      'sharePercent',p_share_percent,
      'shareAmountBase',v_share_amount,
      'directCostId',v_direct_cost_id
    )
  );

  IF p_payout_channel IS NOT NULL THEN
    v_pay_result := public.pay_service_job_receipt_share(
      p_company_id,v_share_id,p_payout_channel,p_payout_bank_id,p_paid_on,
      'Revenue-share payout: ' || v_description,p_request_key || ':payout'
    );
  END IF;

  SELECT jsonb_build_object(
    'receiptShareId',s.id,
    'directCostId',s.direct_cost_id,
    'receiptAmountBase',s.receipt_amount_base,
    'sharePercent',s.share_percent,
    'shareAmountBase',s.share_amount_base,
    'payoutChannel',s.payout_channel,
    'payoutTransactionId',COALESCE(s.payout_cash_transaction_id,s.payout_bank_transaction_id),
    'paidOn',s.paid_at,
    'replayed',false
  ) INTO v_result
  FROM public.service_job_receipt_shares s
  WHERE s.id=v_share_id;

  UPDATE public.posting_requests
  SET status='succeeded',
      result_ref_type='SERVICE_JOB_RECEIPT_SHARE',
      result_ref_id=v_share_id::text,
      result_payload=v_result,
      error_code=NULL,
      error_message=NULL,
      updated_at=now()
  WHERE id=v_req.id;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.pay_service_job_receipt_share(uuid,uuid,text,uuid,date,text,text) OWNER TO postgres;
ALTER FUNCTION public.record_service_job_receipt_share(uuid,uuid,text,uuid,numeric,text,uuid,text,uuid,date,text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.pay_service_job_receipt_share(uuid,uuid,text,uuid,date,text,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_service_job_receipt_share(uuid,uuid,text,uuid,numeric,text,uuid,text,uuid,date,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_service_job_receipt_share(uuid,uuid,text,uuid,date,text,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_service_job_receipt_share(uuid,uuid,text,uuid,numeric,text,uuid,text,uuid,date,text)
  TO authenticated;

COMMENT ON TABLE public.service_job_receipt_shares IS
  'Audit link between an actual customer collection, its Service Job revenue-share direct cost, and an optional cash/bank payout.';
COMMENT ON FUNCTION public.record_service_job_receipt_share(uuid,uuid,text,uuid,numeric,text,uuid,text,uuid,date,text) IS
  'Optionally creates or links a subcontractor direct cost to an actual SO/SI receipt and can pay that linked cost without netting the customer receipt.';
COMMENT ON FUNCTION public.pay_service_job_receipt_share(uuid,uuid,text,uuid,date,text,text) IS
  'Pays an existing linked collection-share cost through the governed cash/bank ledger without creating another job cost.';
