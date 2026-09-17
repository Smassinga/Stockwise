-- Keep order-stage settlement exposure aligned with the governed settlement RPC.
-- Draft, submitted/awaiting-approval, and cancelled sales orders are not
-- receivable anchors. Draft and cancelled purchase orders are not payable anchors.
-- The document-stage anchors (issued SI / posted VB) remain unchanged.

DO $$
DECLARE
  v_definition text;
  v_before text;
  v_after text;
BEGIN
  SELECT pg_get_viewdef('public.v_sales_order_state'::regclass, true)
    INTO v_definition;

  v_before := E'WHEN iia.financial_anchor_document_id IS NOT NULL THEN 0::numeric\n            ELSE GREATEST(';
  v_after := E'WHEN iia.financial_anchor_document_id IS NOT NULL THEN 0::numeric\n            WHEN lower(so.status::text) = ANY (ARRAY[''draft''::text, ''submitted''::text, ''cancelled''::text, ''canceled''::text]) THEN 0::numeric\n            ELSE GREATEST(';

  IF strpos(v_definition, v_before) = 0 THEN
    RAISE EXCEPTION 'v_sales_order_state outstanding anchor clause not found';
  END IF;

  v_definition := replace(v_definition, v_before, v_after);
  EXECUTE 'CREATE OR REPLACE VIEW public.v_sales_order_state WITH (security_invoker = true) AS ' || v_definition;

  SELECT pg_get_viewdef('public.v_purchase_order_state'::regclass, true)
    INTO v_definition;

  v_before := E'WHEN pba.financial_anchor_document_id IS NOT NULL THEN 0::numeric\n            ELSE GREATEST(';
  v_after := E'WHEN pba.financial_anchor_document_id IS NOT NULL THEN 0::numeric\n            WHEN lower(po.status::text) = ANY (ARRAY[''draft''::text, ''cancelled''::text, ''canceled''::text]) THEN 0::numeric\n            ELSE GREATEST(';

  IF strpos(v_definition, v_before) = 0 THEN
    RAISE EXCEPTION 'v_purchase_order_state outstanding anchor clause not found';
  END IF;

  v_definition := replace(v_definition, v_before, v_after);
  EXECUTE 'CREATE OR REPLACE VIEW public.v_purchase_order_state WITH (security_invoker = true) AS ' || v_definition;
END
$$;

COMMENT ON VIEW public.v_sales_order_state IS
  'Canonical sales-order state. Order-stage settlement exposure is zero until the order is approved; issued invoices remain the canonical document anchor.';
COMMENT ON VIEW public.v_purchase_order_state IS
  'Canonical purchase-order state. Order-stage settlement exposure is zero until the order is approved; posted vendor bills remain the canonical document anchor.';