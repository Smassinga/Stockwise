import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // Fail fast in dev so we don't chase ghosts.
  // eslint-disable-next-line no-console
  console.error('Missing Supabase envs', { url, hasKey: Boolean(anon) });
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'stockwise.auth', // stable key so the session survives reloads
  },
});
