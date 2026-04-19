-- Ensure runtime roles have table privileges; RLS still enforces row access
GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_terms TO anon, authenticated;
GRANT SELECT ON TABLE public.company_members TO anon, authenticated;
GRANT SELECT ON TABLE public.user_active_company TO anon, authenticated;

-- For views used by UI if any later depend on them, blanket grant
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='v_due_sales_orders') THEN
    GRANT SELECT ON TABLE public.v_due_sales_orders TO anon, authenticated;
  END IF;
END $$;;
