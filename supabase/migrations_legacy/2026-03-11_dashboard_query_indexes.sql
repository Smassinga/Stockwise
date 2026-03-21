BEGIN;

CREATE INDEX IF NOT EXISTS idx_stock_levels_company_warehouse_item
  ON public.stock_levels (company_id, warehouse_id, item_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_company_created_at_desc
  ON public.stock_movements (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_orders_company_updated_at_desc
  ON public.sales_orders (company_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_orders_company_created_at_desc
  ON public.sales_orders (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_order_lines_company_so_item
  ON public.sales_order_lines (company_id, so_id, item_id);

CREATE INDEX IF NOT EXISTS idx_sales_shipments_company_created_at_desc
  ON public.sales_shipments (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_shipments_company_movement_id
  ON public.sales_shipments (company_id, movement_id);

CREATE INDEX IF NOT EXISTS idx_company_members_user_status_created_at
  ON public.company_members (user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_company_members_email_status_created_at
  ON public.company_members (email, status, created_at)
  WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_company_created_at_desc
  ON public.notifications (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_company_user_created_at_desc
  ON public.notifications (company_id, user_id, created_at DESC);

COMMIT;
