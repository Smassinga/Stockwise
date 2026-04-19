-- 1) Make SKU unique per company (drop global, add composite case-insensitive)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relname='items' AND c.conname='items_sku_key') THEN
    ALTER TABLE public.items DROP CONSTRAINT items_sku_key;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='uniq_items_company_sku_ci') THEN
    CREATE UNIQUE INDEX uniq_items_company_sku_ci ON public.items (company_id, lower(sku));
  END IF;
END $$;

-- 2) Function: mark SO shipped when all lines shipped
CREATE OR REPLACE FUNCTION public.so_maybe_mark_shipped(p_so_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_so_id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.sales_order_lines l WHERE l.so_id = p_so_id)
     AND NOT EXISTS (SELECT 1 FROM public.sales_order_lines l WHERE l.so_id = p_so_id AND COALESCE(l.is_shipped,false)=false) THEN
    UPDATE public.sales_orders
       SET status='shipped', shipped_at=COALESCE(shipped_at, now()), updated_at=now()
     WHERE id=p_so_id AND status <> 'shipped';
  END IF;
END;$$;

-- 3) Recalc a single SO line's shipped values from sales_shipments
CREATE OR REPLACE FUNCTION public.sol_recalc_shipped(p_so_line_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_so_id uuid; v_qty numeric; v_shipped numeric; v_now timestamp with time zone := now();
BEGIN
  SELECT so_id, qty INTO v_so_id, v_qty FROM public.sales_order_lines WHERE id=p_so_line_id;
  IF v_so_id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(s.qty),0) INTO v_shipped FROM public.sales_shipments s WHERE s.so_line_id = p_so_line_id;
  UPDATE public.sales_order_lines l
     SET shipped_qty = v_shipped,
         is_shipped = (v_shipped >= COALESCE(v_qty,0)),
         shipped_at = CASE WHEN (v_shipped >= COALESCE(v_qty,0)) THEN COALESCE(l.shipped_at, v_now) ELSE l.shipped_at END,
         updated_at = v_now
   WHERE l.id = p_so_line_id;
  PERFORM public.so_maybe_mark_shipped(v_so_id);
END;$$;

-- 4) Triggers on sales_shipments to keep lines in sync
CREATE OR REPLACE FUNCTION public.tg_sales_shipments_recalc_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sol_recalc_shipped(COALESCE(NEW.so_line_id, OLD.so_line_id));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_sales_shipments_recalc_line_ins ON public.sales_shipments;
CREATE TRIGGER trg_sales_shipments_recalc_line_ins
AFTER INSERT ON public.sales_shipments
FOR EACH ROW EXECUTE FUNCTION public.tg_sales_shipments_recalc_line();

DROP TRIGGER IF EXISTS trg_sales_shipments_recalc_line_upd ON public.sales_shipments;
CREATE TRIGGER trg_sales_shipments_recalc_line_upd
AFTER UPDATE ON public.sales_shipments
FOR EACH ROW EXECUTE FUNCTION public.tg_sales_shipments_recalc_line();

DROP TRIGGER IF EXISTS trg_sales_shipments_recalc_line_del ON public.sales_shipments;
CREATE TRIGGER trg_sales_shipments_recalc_line_del
AFTER DELETE ON public.sales_shipments
FOR EACH ROW EXECUTE FUNCTION public.tg_sales_shipments_recalc_line();

-- 5) Trigger on SOL direct edits to propagate to SO status
CREATE OR REPLACE FUNCTION public.tg_sol_status_on_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.so_maybe_mark_shipped(NEW.so_id);
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_sol_status_on_edit ON public.sales_order_lines;
CREATE TRIGGER trg_sol_status_on_edit
AFTER UPDATE OF is_shipped, shipped_qty ON public.sales_order_lines
FOR EACH ROW EXECUTE FUNCTION public.tg_sol_status_on_edit();
;
