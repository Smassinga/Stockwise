-- UX-9C: authoritative, company-scoped owner performance cockpit read model.

CREATE OR REPLACE FUNCTION public.get_owner_dashboard(
  p_company_id uuid,
  p_start_date date,
  p_end_date date,
  p_compare_start_date date,
  p_compare_end_date date,
  p_warehouse_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_result jsonb;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NULL
     OR p_company_id IS DISTINCT FROM public.current_company_id()
     OR NOT public.member_has_company_access(p_company_id, false) THEN
    RAISE EXCEPTION 'Company access denied' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date
     OR p_compare_start_date IS NULL OR p_compare_end_date IS NULL
     OR p_compare_start_date > p_compare_end_date THEN
    RAISE EXCEPTION 'Invalid dashboard period' USING ERRCODE = '22007';
  END IF;
  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = p_warehouse_id AND w.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Warehouse access denied' USING ERRCODE = '42501';
  END IF;

  WITH
  order_facts AS (
    SELECT
      so.id,
      so.customer_id,
      lower(so.status::text) AS status,
      so.order_date,
      so.pos_tax_mode_snapshot IS NOT NULL AS is_pos,
      COALESCE(so.total_amount, so.total, 0) * COALESCE(so.fx_to_base, 1) AS sales_base,
      COALESCE(MAX(ss.created_at), so.shipped_at) AS completed_at,
      COALESCE(SUM(
        CASE WHEN ss.id IS NOT NULL
          AND (p_warehouse_id IS NULL OR sm.warehouse_from_id = p_warehouse_id)
        THEN ABS(COALESCE(sm.total_value, sm.unit_cost * ss.qty_base)) END
      ), 0) AS known_cogs,
      COUNT(ss.id) FILTER (
        WHERE p_warehouse_id IS NULL OR sm.warehouse_from_id = p_warehouse_id
      ) AS shipment_count,
      COUNT(ss.id) FILTER (
        WHERE (p_warehouse_id IS NULL OR sm.warehouse_from_id = p_warehouse_id)
          AND COALESCE(sm.total_value, sm.unit_cost * ss.qty_base) IS NULL
      ) AS missing_cost_count,
      BOOL_OR(p_warehouse_id IS NULL OR sm.warehouse_from_id = p_warehouse_id) AS in_warehouse
    FROM public.sales_orders so
    LEFT JOIN public.sales_shipments ss
      ON ss.so_id = so.id AND ss.company_id = so.company_id
    LEFT JOIN public.stock_movements sm
      ON sm.id = ss.movement_id AND sm.company_id = so.company_id
    WHERE so.company_id = p_company_id
    GROUP BY so.id
  ),
  classified AS (
    SELECT *,
      (status IN ('shipped', 'closed') AND completed_at IS NOT NULL
        AND (p_warehouse_id IS NULL OR COALESCE(in_warehouse, false))) AS completed,
      completed_at::date BETWEEN p_start_date AND p_end_date AS in_current,
      completed_at::date BETWEEN p_compare_start_date AND p_compare_end_date AS in_previous,
      order_date BETWEEN p_start_date AND p_end_date AS created_current,
      order_date BETWEEN p_compare_start_date AND p_compare_end_date AS created_previous
    FROM order_facts
  ),
  period_summary AS (
    SELECT
      COALESCE(SUM(sales_base) FILTER (WHERE completed AND in_current), 0) AS sales,
      COUNT(*) FILTER (WHERE completed AND in_current) AS transactions,
      COUNT(*) FILTER (WHERE completed AND in_current AND is_pos) AS pos_transactions,
      COALESCE(SUM(known_cogs) FILTER (WHERE completed AND in_current), 0) AS known_cogs,
      COALESCE(SUM(missing_cost_count) FILTER (WHERE completed AND in_current), 0) AS missing_cost_count,
      COUNT(*) FILTER (WHERE created_current AND status IN ('submitted','confirmed','allocated','shipped','closed')) AS eligible,
      COUNT(*) FILTER (WHERE created_current AND status IN ('shipped','closed')) AS eligible_completed,
      COALESCE(SUM(sales_base) FILTER (WHERE completed AND in_previous), 0) AS previous_sales,
      COUNT(*) FILTER (WHERE completed AND in_previous) AS previous_transactions,
      COUNT(*) FILTER (WHERE created_previous AND status IN ('submitted','confirmed','allocated','shipped','closed')) AS previous_eligible,
      COUNT(*) FILTER (WHERE created_previous AND status IN ('shipped','closed')) AS previous_eligible_completed,
      COUNT(*) FILTER (WHERE status = 'submitted') AS open_submitted,
      COUNT(*) FILTER (WHERE status = 'confirmed') AS open_confirmed,
      COUNT(*) FILTER (WHERE status = 'allocated') AS open_allocated
    FROM classified
  ),
  stock_by_item AS (
    SELECT
      i.id, i.name, i.sku, i.base_uom_id, i.min_stock,
      COALESCE(SUM(sl.qty) FILTER (WHERE p_warehouse_id IS NULL OR sl.warehouse_id = p_warehouse_id), 0) AS qty,
      COALESCE(SUM(sl.qty * sl.avg_cost) FILTER (WHERE p_warehouse_id IS NULL OR sl.warehouse_id = p_warehouse_id), 0) AS value,
      COUNT(*) FILTER (
        WHERE (p_warehouse_id IS NULL OR sl.warehouse_id = p_warehouse_id)
          AND sl.qty <> 0 AND sl.avg_cost IS NULL
      ) AS missing_cost
    FROM public.items i
    LEFT JOIN public.stock_levels sl
      ON sl.item_id = i.id AND sl.company_id = i.company_id
    WHERE i.company_id = p_company_id AND i.track_inventory
    GROUP BY i.id
  ),
  inventory_summary AS (
    SELECT
      COALESCE(SUM(value), 0) AS value,
      COALESCE(SUM(missing_cost), 0) AS missing_cost_count,
      COUNT(*) FILTER (WHERE min_stock IS NOT NULL AND qty <= 0) AS out_of_stock,
      COUNT(*) FILTER (WHERE min_stock IS NOT NULL AND qty > 0 AND qty <= min_stock) AS low_stock,
      COUNT(*) FILTER (WHERE min_stock IS NULL) AS missing_minimum
    FROM stock_by_item
  ),
  product_facts AS (
    SELECT
      sol.item_id,
      i.name,
      i.sku,
      i.base_uom_id,
      SUM(ss.revenue_base_amount) AS revenue,
      SUM(ss.qty_base) AS quantity,
      COALESCE(SUM(ABS(COALESCE(sm.total_value, sm.unit_cost * ss.qty_base))), 0) AS known_cogs,
      COUNT(*) FILTER (WHERE COALESCE(sm.total_value, sm.unit_cost * ss.qty_base) IS NULL) AS missing_cost_count
    FROM classified c
    JOIN public.sales_order_lines sol ON sol.so_id = c.id AND sol.company_id = p_company_id
    JOIN public.items i ON i.id = sol.item_id AND i.company_id = p_company_id
    JOIN public.sales_shipments ss ON ss.so_line_id = sol.id AND ss.company_id = p_company_id
    JOIN public.stock_movements sm ON sm.id = ss.movement_id AND sm.company_id = p_company_id
    WHERE c.completed AND c.in_current
      AND (p_warehouse_id IS NULL OR sm.warehouse_from_id = p_warehouse_id)
    GROUP BY sol.item_id, i.name, i.sku, i.base_uom_id
  ),
  named_activity AS (
    SELECT
      c.customer_id,
      cu.name,
      SUM(c.sales_base) FILTER (WHERE c.in_current) AS current_sales,
      BOOL_OR(c.in_current) AS bought_current,
      BOOL_OR(c.completed_at::date < p_start_date) AS bought_before
    FROM classified c
    JOIN public.customers cu
      ON cu.id = c.customer_id AND cu.company_id = p_company_id AND NOT cu.is_cash
    WHERE c.completed
    GROUP BY c.customer_id, cu.name
  ),
  daily AS (
    SELECT
      c.completed_at::date AS day,
      SUM(c.sales_base) AS sales,
      SUM(c.known_cogs) AS known_cogs,
      SUM(c.missing_cost_count) AS missing_cost_count
    FROM classified c
    WHERE c.completed AND c.in_current
    GROUP BY c.completed_at::date
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'sales', ps.sales,
      'transactions', ps.transactions,
      'posTransactions', ps.pos_transactions,
      'knownCogs', ps.known_cogs,
      'missingCostCount', ps.missing_cost_count,
      'grossProfit', CASE WHEN ps.missing_cost_count = 0 THEN ps.sales - ps.known_cogs END,
      'grossMargin', CASE WHEN ps.missing_cost_count = 0 AND ps.sales <> 0
        THEN (ps.sales - ps.known_cogs) / ps.sales * 100 END,
      'completionRate', CASE WHEN ps.eligible > 0 THEN ps.eligible_completed::numeric / ps.eligible * 100 END,
      'eligible', ps.eligible,
      'eligibleCompleted', ps.eligible_completed,
      'previousSales', ps.previous_sales,
      'previousTransactions', ps.previous_transactions,
      'previousCompletionRate', CASE WHEN ps.previous_eligible > 0
        THEN ps.previous_eligible_completed::numeric / ps.previous_eligible * 100 END,
      'openOrders', ps.open_submitted + ps.open_confirmed + ps.open_allocated,
      'openSubmitted', ps.open_submitted,
      'openConfirmed', ps.open_confirmed,
      'openAllocated', ps.open_allocated
    ),
    'inventory', (SELECT to_jsonb(x) FROM inventory_summary x),
    'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'itemId', item_id, 'name', name, 'sku', sku, 'baseUom', base_uom_id,
      'revenue', revenue, 'quantity', quantity, 'knownCogs', known_cogs,
      'grossProfit', CASE WHEN missing_cost_count = 0 THEN revenue - known_cogs END,
      'missingCostCount', missing_cost_count
    )) FROM product_facts), '[]'::jsonb),
    'customers', jsonb_build_object(
      'active', (SELECT COUNT(*) FROM named_activity WHERE bought_current),
      'new', (SELECT COUNT(*) FROM named_activity WHERE bought_current AND NOT bought_before),
      'repeat', (SELECT COUNT(*) FROM named_activity WHERE bought_current AND bought_before),
      'top', (SELECT jsonb_build_object('id', customer_id, 'name', name, 'sales', current_sales)
        FROM named_activity WHERE bought_current ORDER BY current_sales DESC NULLS LAST LIMIT 1)
    ),
    'trend', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'date', day, 'sales', sales, 'knownCogs', known_cogs,
      'grossProfit', CASE WHEN missing_cost_count = 0 THEN sales - known_cogs END,
      'missingCostCount', missing_cost_count
    ) ORDER BY day) FROM daily), '[]'::jsonb)
  )
  INTO v_result
  FROM period_summary ps;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_owner_dashboard(uuid, date, date, date, date, uuid) IS
  'Read-only operational owner cockpit. Distinct Sales Orders prevent POS duplication; unsupported costs remain unavailable.';

REVOKE ALL ON FUNCTION public.get_owner_dashboard(uuid, date, date, date, date, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_dashboard(uuid, date, date, date, date, uuid)
  TO authenticated;
