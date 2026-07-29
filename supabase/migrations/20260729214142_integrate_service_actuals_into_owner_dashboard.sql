-- SVC-1: preserve the UX-9C contract while adding service execution revenue
-- and withholding service COGS until actual costing is finalised.

ALTER FUNCTION public.get_owner_dashboard(uuid,date,date,date,date,uuid)
  RENAME TO get_owner_dashboard_goods;

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
  v_result jsonb;
  v_summary jsonb;
  v_goods_sales numeric;
  v_goods_cogs numeric;
  v_goods_missing integer;
  v_service_sales numeric;
  v_service_previous_sales numeric;
  v_service_cogs numeric;
  v_service_missing integer;
  v_service_transactions integer;
  v_service_previous_transactions integer;
  v_embedded_service_sales numeric;
  v_embedded_previous_service_sales numeric;
  v_sales numeric;
  v_cogs numeric;
  v_missing integer;
  v_transactions integer;
  v_previous_sales numeric;
  v_previous_transactions integer;
  v_service_products jsonb;
  v_trend jsonb;
BEGIN
  -- The renamed UX-9C implementation retains all authentication, company,
  -- warehouse, period, inventory, customer and order-state validation.
  v_result := public.get_owner_dashboard_goods(
    p_company_id,p_start_date,p_end_date,p_compare_start_date,p_compare_end_date,p_warehouse_id
  );
  v_summary := v_result->'summary';

  WITH service_facts AS (
    SELECT
      sj.id,
      sj.sales_order_id,
      sj.actual_completion::date AS completed_on,
      sj.costing_status,
      sj.total_actual_cost,
      sum(sol.line_total * COALESCE(so.fx_to_base,1)) AS revenue
    FROM public.service_jobs sj
    JOIN public.service_job_lines sjl
      ON sjl.service_job_id=sj.id AND sjl.company_id=sj.company_id AND sjl.active_link
    JOIN public.sales_order_lines sol
      ON sol.id=sjl.sales_order_line_id AND sol.company_id=sj.company_id
    JOIN public.sales_orders so
      ON so.id=sj.sales_order_id AND so.company_id=sj.company_id
    WHERE sj.company_id=p_company_id AND sj.execution_status='completed'
    GROUP BY sj.id
  )
  SELECT
    COALESCE(sum(revenue) FILTER (WHERE completed_on BETWEEN p_start_date AND p_end_date),0),
    COALESCE(sum(revenue) FILTER (WHERE completed_on BETWEEN p_compare_start_date AND p_compare_end_date),0),
    COALESCE(sum(total_actual_cost) FILTER (
      WHERE completed_on BETWEEN p_start_date AND p_end_date AND costing_status='finalised'
    ),0),
    count(*) FILTER (
      WHERE completed_on BETWEEN p_start_date AND p_end_date AND costing_status='open'
    )::integer,
    count(*) FILTER (WHERE completed_on BETWEEN p_start_date AND p_end_date)::integer,
    count(*) FILTER (WHERE completed_on BETWEEN p_compare_start_date AND p_compare_end_date)::integer
  INTO v_service_sales,v_service_previous_sales,v_service_cogs,v_service_missing,
    v_service_transactions,v_service_previous_transactions
  FROM service_facts;

  -- UX-9C treated a shipped mixed order's whole commercial total as product
  -- revenue. Remove its service-line share on the shipment completion date;
  -- that share is now recognised only by completed Service Job evidence.
  WITH shipped_orders AS (
    SELECT so.id,COALESCE(max(ss.created_at),so.shipped_at)::date AS completed_on
    FROM public.sales_orders so
    LEFT JOIN public.sales_shipments ss ON ss.so_id=so.id AND ss.company_id=so.company_id
    WHERE so.company_id=p_company_id AND lower(so.status::text) IN ('shipped','closed')
    GROUP BY so.id
  ),
  embedded AS (
    SELECT sh.completed_on,sum(sol.line_total*COALESCE(so.fx_to_base,1)) AS revenue
    FROM shipped_orders sh
    JOIN public.sales_orders so ON so.id=sh.id
    JOIN public.sales_order_lines sol ON sol.so_id=so.id AND sol.company_id=so.company_id
    JOIN public.items i ON i.id=sol.item_id AND i.company_id=so.company_id
    WHERE i.primary_role='service' AND sh.completed_on IS NOT NULL
    GROUP BY sh.completed_on
  )
  SELECT
    COALESCE(sum(revenue) FILTER (WHERE completed_on BETWEEN p_start_date AND p_end_date),0),
    COALESCE(sum(revenue) FILTER (WHERE completed_on BETWEEN p_compare_start_date AND p_compare_end_date),0)
  INTO v_embedded_service_sales,v_embedded_previous_service_sales
  FROM embedded;

  v_goods_sales := COALESCE((v_summary->>'sales')::numeric,0);
  v_goods_cogs := COALESCE((v_summary->>'knownCogs')::numeric,0);
  v_goods_missing := COALESCE((v_summary->>'missingCostCount')::integer,0);
  v_sales := v_goods_sales-v_embedded_service_sales+v_service_sales;
  v_cogs := v_goods_cogs+v_service_cogs;
  v_missing := v_goods_missing+v_service_missing;
  v_transactions := COALESCE((v_summary->>'transactions')::integer,0)+v_service_transactions;
  v_previous_sales := COALESCE((v_summary->>'previousSales')::numeric,0)
    -v_embedded_previous_service_sales+v_service_previous_sales;
  v_previous_transactions := COALESCE((v_summary->>'previousTransactions')::integer,0)
    +v_service_previous_transactions;

  v_summary := v_summary || jsonb_build_object(
    'sales',v_sales,
    'transactions',v_transactions,
    'knownCogs',v_cogs,
    'missingCostCount',v_missing,
    'grossProfit',CASE WHEN v_missing=0 THEN v_sales-v_cogs END,
    'grossMargin',CASE WHEN v_missing=0 AND v_sales<>0 THEN (v_sales-v_cogs)/v_sales*100 END,
    'previousSales',v_previous_sales,
    'previousTransactions',v_previous_transactions,
    'serviceSales',v_service_sales,
    'serviceActualCogs',v_service_cogs,
    'serviceOpenCostingCount',v_service_missing
  );

  WITH service_products AS (
    SELECT
      i.id item_id,i.name,i.sku,i.base_uom_id,
      sum(sol.line_total*COALESCE(so.fx_to_base,1)) revenue,
      sum(sjl.commercial_quantity) quantity,
      sum(sj.total_actual_cost/NULLIF((SELECT count(*) FROM public.service_job_lines x
        WHERE x.service_job_id=sj.id AND x.active_link),0)) FILTER (WHERE sj.costing_status='finalised') known_cogs,
      count(*) FILTER (WHERE sj.costing_status='open') missing_cost_count
    FROM public.service_jobs sj
    JOIN public.service_job_lines sjl ON sjl.service_job_id=sj.id AND sjl.active_link
    JOIN public.sales_order_lines sol ON sol.id=sjl.sales_order_line_id
    JOIN public.sales_orders so ON so.id=sj.sales_order_id
    JOIN public.items i ON i.id=sjl.service_item_id
    WHERE sj.company_id=p_company_id AND sj.execution_status='completed'
      AND sj.actual_completion::date BETWEEN p_start_date AND p_end_date
    GROUP BY i.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'itemId',item_id,'name',name,'sku',sku,'baseUom',base_uom_id,
    'revenue',revenue,'quantity',quantity,'knownCogs',COALESCE(known_cogs,0),
    'grossProfit',CASE WHEN missing_cost_count=0 THEN revenue-COALESCE(known_cogs,0) END,
    'missingCostCount',missing_cost_count
  )),'[]'::jsonb) INTO v_service_products FROM service_products;

  WITH days AS (
    SELECT value->>'date' AS activity_date,
      COALESCE((value->>'sales')::numeric,0) AS goods_sales,
      COALESCE((value->>'knownCogs')::numeric,0) AS goods_cogs,
      COALESCE((value->>'missingCostCount')::integer,0) AS goods_missing
    FROM jsonb_array_elements(v_result->'trend')
  ),
  embedded AS (
    SELECT COALESCE(max(ss.created_at),so.shipped_at)::date::text AS activity_date,
      sum(sol.line_total*COALESCE(so.fx_to_base,1)) revenue
    FROM public.sales_orders so
    LEFT JOIN public.sales_shipments ss ON ss.so_id=so.id AND ss.company_id=so.company_id
    JOIN public.sales_order_lines sol ON sol.so_id=so.id AND sol.company_id=so.company_id
    JOIN public.items i ON i.id=sol.item_id AND i.company_id=so.company_id
    WHERE so.company_id=p_company_id AND lower(so.status::text) IN ('shipped','closed')
      AND i.primary_role='service'
    GROUP BY so.id,so.shipped_at
  ),
  service AS (
    SELECT sj.actual_completion::date::text AS activity_date,
      sum(sol.line_total*COALESCE(so.fx_to_base,1)) revenue,
      sum(sj.total_actual_cost/NULLIF((SELECT count(*) FROM public.service_job_lines x
        WHERE x.service_job_id=sj.id AND x.active_link),0))
        FILTER (WHERE sj.costing_status='finalised') cogs,
      count(DISTINCT sj.id) FILTER (WHERE sj.costing_status='open')::integer missing
    FROM public.service_jobs sj
    JOIN public.service_job_lines sjl ON sjl.service_job_id=sj.id AND sjl.active_link
    JOIN public.sales_order_lines sol ON sol.id=sjl.sales_order_line_id
    JOIN public.sales_orders so ON so.id=sj.sales_order_id
    WHERE sj.company_id=p_company_id AND sj.execution_status='completed'
      AND sj.actual_completion::date BETWEEN p_start_date AND p_end_date
    GROUP BY sj.actual_completion::date
  ),
  all_days AS (
    SELECT activity_date FROM days UNION SELECT activity_date FROM embedded UNION SELECT activity_date FROM service
  ),
  combined AS (
    SELECT ad.activity_date,
      COALESCE(d.goods_sales,0)-COALESCE(e.revenue,0)+COALESCE(s.revenue,0) sales,
      COALESCE(d.goods_cogs,0)+COALESCE(s.cogs,0) cogs,
      COALESCE(d.goods_missing,0)+COALESCE(s.missing,0) missing
    FROM all_days ad LEFT JOIN days d USING(activity_date) LEFT JOIN embedded e USING(activity_date) LEFT JOIN service s USING(activity_date)
    WHERE ad.activity_date::date BETWEEN p_start_date AND p_end_date
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date',activity_date,'sales',sales,'knownCogs',cogs,
    'grossProfit',CASE WHEN missing=0 THEN sales-cogs END,'missingCostCount',missing
  ) ORDER BY activity_date),'[]'::jsonb) INTO v_trend FROM combined;

  RETURN v_result || jsonb_build_object(
    'summary',v_summary,
    'products',COALESCE(v_result->'products','[]'::jsonb)||v_service_products,
    'trend',v_trend
  );
END;
$$;

COMMENT ON FUNCTION public.get_owner_dashboard(uuid,date,date,date,date,uuid) IS
  'SVC-1 additive owner cockpit: service revenue follows execution completion and service COGS requires finalised actual costing.';
REVOKE ALL ON FUNCTION public.get_owner_dashboard(uuid,date,date,date,date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_owner_dashboard(uuid,date,date,date,date,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_owner_dashboard_goods(uuid,date,date,date,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_owner_dashboard_goods(uuid,date,date,date,date,uuid) TO service_role;
