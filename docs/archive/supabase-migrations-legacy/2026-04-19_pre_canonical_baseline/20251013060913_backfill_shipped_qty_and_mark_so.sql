-- Backfill shipped quantities for lines
WITH agg AS (
  SELECT so_line_id, COALESCE(SUM(qty),0) AS shipped
  FROM public.sales_shipments
  GROUP BY so_line_id
)
UPDATE public.sales_order_lines l
SET shipped_qty = COALESCE(a.shipped,0),
    is_shipped = (COALESCE(a.shipped,0) >= COALESCE(l.qty,0)),
    shipped_at = CASE WHEN (COALESCE(a.shipped,0) >= COALESCE(l.qty,0)) THEN COALESCE(l.shipped_at, now()) ELSE l.shipped_at END
FROM agg a
WHERE l.id = a.so_line_id;

-- Mark eligible orders as shipped
UPDATE public.sales_orders so
SET status='shipped', shipped_at = COALESCE(shipped_at, now())
WHERE so.status IN ('submitted','confirmed','allocated')
AND EXISTS (SELECT 1 FROM public.sales_order_lines l WHERE l.so_id = so.id)
AND NOT EXISTS (SELECT 1 FROM public.sales_order_lines l WHERE l.so_id = so.id AND COALESCE(l.is_shipped,false)=false);;
