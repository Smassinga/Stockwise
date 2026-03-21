const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.URL, process.env.KEY, { auth: { persistSession: false } });
(async () => {
  const { data, error } = await supabase.from("company_digest_state").select('*').order('company_id', { ascending: true });
  if (error) throw error;
  console.log(JSON.stringify(data, null, 2));
})();
