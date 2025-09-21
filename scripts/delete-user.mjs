// scripts/delete-user.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const uid = process.argv[2];

if (!url || !key || !uid) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/delete-user.mjs <user-uuid>');
  process.exit(1);
}

const supabase = createClient(url, key);

// try a HARD delete (bypass soft-delete) and print any server message
const { error } = await supabase.auth.admin.deleteUser(uid, { shouldSoftDelete: false });

if (error) {
  console.error('Delete failed:', JSON.stringify(error, null, 2));
  process.exit(1);
}

console.log('Deleted user:', uid);
