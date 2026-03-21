GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON TABLE public.sales_orders TO service_role;
-- also grant SELECT on payment_terms since the RPC references it
DO $$ BEGIN IF to_regclass('public.payment_terms') IS NOT NULL THEN EXECUTE 'GRANT SELECT ON TABLE public.payment_terms TO service_role'; END IF; END $$;;
