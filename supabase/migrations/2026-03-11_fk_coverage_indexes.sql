BEGIN;

CREATE INDEX IF NOT EXISTS idx_builds_bin_from_id_fk ON public.builds (bin_from_id);
CREATE INDEX IF NOT EXISTS idx_builds_bin_to_id_fk ON public.builds (bin_to_id);
CREATE INDEX IF NOT EXISTS idx_builds_created_by_fk ON public.builds (created_by);
CREATE INDEX IF NOT EXISTS idx_builds_warehouse_from_id_fk ON public.builds (warehouse_from_id);
CREATE INDEX IF NOT EXISTS idx_builds_warehouse_to_id_fk ON public.builds (warehouse_to_id);

CREATE INDEX IF NOT EXISTS idx_company_currencies_currency_code_fk ON public.company_currencies (currency_code);
CREATE INDEX IF NOT EXISTS idx_company_invites_company_id_fk ON public.company_invites (company_id);

CREATE INDEX IF NOT EXISTS idx_customers_payment_terms_id_fk ON public.customers (payment_terms_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_payment_terms_id_fk ON public.purchase_orders (payment_terms_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_payment_terms_id_fk ON public.sales_orders (payment_terms_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_payment_terms_id_fk ON public.suppliers (payment_terms_id);

CREATE INDEX IF NOT EXISTS idx_movements_from_bin_id_from_warehouse_id_fk ON public.movements (from_bin_id, from_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_movements_to_bin_id_to_warehouse_id_fk ON public.movements (to_bin_id, to_warehouse_id);

CREATE INDEX IF NOT EXISTS idx_stock_levels_bin_id_fk ON public.stock_levels (bin_id);
CREATE INDEX IF NOT EXISTS idx_user_active_company_company_id_fk ON public.user_active_company (company_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_active_company_id_fk ON public.user_profiles (active_company_id);

COMMIT;
