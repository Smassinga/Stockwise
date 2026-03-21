-- 1) CASH: make ref_id optional and add a free-text user reference
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cash_transactions' AND column_name = 'ref_id'
  ) THEN
    -- drop NOT NULL if present
    BEGIN
      ALTER TABLE public.cash_transactions ALTER COLUMN ref_id DROP NOT NULL;
    EXCEPTION WHEN others THEN
      -- ignore if already nullable or constraint doesn't exist
    END;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cash_transactions' AND column_name='user_ref'
  ) THEN
    ALTER TABLE public.cash_transactions ADD COLUMN user_ref text NULL;
  END IF;
END $$;

-- 2) ITEMS: case-insensitive unique SKU per company
-- Drop any existing simple unique index on sku to avoid conflicts
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='items_sku_key') THEN
    EXECUTE 'DROP INDEX public.items_sku_key';
  END IF;
EXCEPTION WHEN undefined_object THEN
  -- ignore
END $$;

-- Create/ensure a CI unique index using lower(sku) per company_id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='items_company_sku_ci_key') THEN
    CREATE UNIQUE INDEX items_company_sku_ci_key ON public.items (company_id, lower(sku));
  END IF;
END $$;

-- 3) SALES ORDERS: recompute shipped progress and force status to shipped when fully shipped
-- Helper function to recompute a single SO line's shipped figures from sales_shipments
CREATE OR REPLACE FUNCTION public.recompute_so_line_shipped(p_so_line_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_qty_shipped numeric;
BEGIN
  SELECT COALESCE(SUM(s.qty), 0) INTO v_qty_shipped
  FROM public.sales_shipments s
  WHERE s.so_line_id = p_so_line_id;

  UPDATE public.sales_order_lines sol
  SET shipped_qty = v_qty_shipped,
      is_shipped  = (v_qty_shipped >= sol.qty),
      shipped_at  = CASE WHEN v_qty_shipped >= sol.qty AND sol.shipped_at IS NULL THEN NOW() ELSE sol.shipped_at END
  WHERE sol.id = p_so_line_id;
END;$$;

-- Function to force SO status to shipped when all lines are shipped
CREATE OR REPLACE FUNCTION public.force_so_status_if_fully_shipped(p_so_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_all_shipped boolean;
BEGIN
  SELECT bool_and(COALESCE(sol.shipped_qty,0) >= sol.qty) INTO v_all_shipped
  FROM public.sales_order_lines sol
  WHERE sol.so_id = p_so_id;

  IF v_all_shipped THEN
    UPDATE public.sales_orders so
    SET status = 'shipped'
    WHERE so.id = p_so_id AND so.status IN ('confirmed','allocated');
  END IF;
END;$$;

-- Trigger function on sales_shipments to keep lines + header in sync
CREATE OR REPLACE FUNCTION public.tg_sales_shipments_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    IF NEW.so_line_id IS NOT NULL THEN
      PERFORM public.recompute_so_line_shipped(NEW.so_line_id);
    END IF;
    IF NEW.so_id IS NOT NULL THEN
      PERFORM public.force_so_status_if_fully_shipped(NEW.so_id);
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.so_line_id IS NOT NULL THEN
      PERFORM public.recompute_so_line_shipped(OLD.so_line_id);
    END IF;
    IF OLD.so_id IS NOT NULL THEN
      PERFORM public.force_so_status_if_fully_shipped(OLD.so_id);
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;$$;

DO $$ BEGIN
  -- Create trigger if missing
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sales_shipments_sync'
  ) THEN
    CREATE TRIGGER trg_sales_shipments_sync
    AFTER INSERT OR UPDATE OR DELETE ON public.sales_shipments
    FOR EACH ROW EXECUTE FUNCTION public.tg_sales_shipments_sync();
  END IF;
END $$;

-- Also add a safety trigger on sales_order_lines updates that change shipped_qty to re-check header
CREATE OR REPLACE FUNCTION public.tg_solines_status_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    IF NEW.so_id IS NOT NULL THEN
      PERFORM public.force_so_status_if_fully_shipped(NEW.so_id);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_solines_status_sync') THEN
    CREATE TRIGGER trg_solines_status_sync
    AFTER UPDATE OF shipped_qty, is_shipped ON public.sales_order_lines
    FOR EACH ROW EXECUTE FUNCTION public.tg_solines_status_sync();
  END IF;
END $$;

-- 4) Ensure a uniqueness guard on sales_shipments by movement_id to allow idempotency from the app
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='sales_shipments_movement_id_key') THEN
    CREATE UNIQUE INDEX sales_shipments_movement_id_key ON public.sales_shipments (movement_id);
  END IF;
END $$;

-- 5) Optional: helpful view to aggregate shipped vs ordered amounts per SO (used for reporting)
CREATE OR REPLACE VIEW public.sales_order_ship_progress AS
SELECT
  so.id AS so_id,
  so.status,
  SUM(sol.qty) AS ordered_qty,
  SUM(COALESCE(sol.shipped_qty,0)) AS shipped_qty,
  bool_and(COALESCE(sol.shipped_qty,0) >= sol.qty) AS fully_shipped
FROM public.sales_orders so
JOIN public.sales_order_lines sol ON sol.so_id = so.id
GROUP BY so.id, so.status;
;
