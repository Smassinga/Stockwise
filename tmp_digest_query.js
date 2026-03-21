const { createClient } = require("@supabase/supabase-js");
const url = process.env.URL;
const key = process.env.KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });
(async () => {
  const { data, error } = await supabase.from('digest_queue').select('*').order('id', { ascending: true });
  if (error) throw error;
  console.log(JSON.stringify(data, null, 2));
})();
