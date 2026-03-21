-- Function: auto-calc due_date from order_date + payment_terms.net_days if payment_terms_id present
CREATE OR REPLACE FUNCTION public.so_set_due_date()
RETURNS trigger AS $$
DECLARE
  v_net integer;
BEGIN
  -- If caller explicitly set due_date, respect it
  IF NEW.due_date IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_terms_id IS NOT NULL THEN
    SELECT net_days INTO v_net
      FROM public.payment_terms
     WHERE id = NEW.payment_terms_id
       AND company_id = NEW.company_id;

    IF v_net IS NOT NULL THEN
      NEW.due_date := (NEW.order_date + make_interval(days => v_net));
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_so_set_due_date_ins ON public.sales_orders;
CREATE TRIGGER trg_so_set_due_date_ins
BEFORE INSERT ON public.sales_orders
FOR EACH ROW
EXECUTE FUNCTION public.so_set_due_date();

DROP TRIGGER IF EXISTS trg_so_set_due_date_upd ON public.sales_orders;
CREATE TRIGGER trg_so_set_due_date_upd
BEFORE UPDATE OF payment_terms_id, order_date ON public.sales_orders
FOR EACH ROW
WHEN (NEW.due_date IS NULL)
EXECUTE FUNCTION public.so_set_due_date();;
