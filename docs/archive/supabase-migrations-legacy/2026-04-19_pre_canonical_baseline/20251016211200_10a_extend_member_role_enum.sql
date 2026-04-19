-- Extend existing enum type member_role with required values
DO $$
BEGIN
  -- Add in increasing privilege order; IF NOT EXISTS works on PG 13+ for enums via catch block
  BEGIN ALTER TYPE member_role ADD VALUE 'VIEWER'; EXCEPTION WHEN duplicate_object THEN END;
  BEGIN ALTER TYPE member_role ADD VALUE 'OPERATOR'; EXCEPTION WHEN duplicate_object THEN END;
  BEGIN ALTER TYPE member_role ADD VALUE 'ADMIN'; EXCEPTION WHEN duplicate_object THEN END;
  -- OWNER and MANAGER presumed to exist; if not, add them
  BEGIN ALTER TYPE member_role ADD VALUE 'MANAGER'; EXCEPTION WHEN duplicate_object THEN END;
  BEGIN ALTER TYPE member_role ADD VALUE 'OWNER'; EXCEPTION WHEN duplicate_object THEN END;
END$$;

-- Helpful index if missing
CREATE INDEX IF NOT EXISTS idx_company_members_company_role
  ON public.company_members (company_id, role);;
