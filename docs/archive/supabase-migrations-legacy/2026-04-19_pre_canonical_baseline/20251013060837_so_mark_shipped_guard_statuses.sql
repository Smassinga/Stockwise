CREATE OR REPLACE FUNCTION public.so_maybe_mark_shipped(p_so_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_status public.so_status;
BEGIN
  IF p_so_id IS NULL THEN RETURN; END IF;
  SELECT status INTO v_status FROM public.sales_orders WHERE id = p_so_id;
  IF v_status NOT IN ('submitted','confirmed','allocated') THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.sales_order_lines l WHERE l.so_id = p_so_id)
     AND NOT EXISTS (SELECT 1 FROM public.sales_order_lines l WHERE l.so_id = p_so_id AND COALESCE(l.is_shipped,false)=false) THEN
    UPDATE public.sales_orders
       SET status='shipped', shipped_at=COALESCE(shipped_at, now()), updated_at=now()
     WHERE id=p_so_id;
  END IF;
END;$$;;
