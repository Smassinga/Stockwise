-- Allow authenticated users to SELECT their own membership rows.
-- Required because our payment_terms RLS policies check membership via queries to company_members.
DO $$ BEGIN
  BEGIN
    CREATE POLICY company_members_select_self ON public.company_members
      FOR SELECT
      USING (user_id = auth.uid());
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;;
