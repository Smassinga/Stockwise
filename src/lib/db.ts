// Temporary compatibility path for legacy imports.
// New code must import the shared Supabase client directly from './supabase'.
// The former generic CRUD facade was intentionally removed because arbitrary
// table writes bypass the typed, domain-specific access patterns used by StockWise.
export { supabase } from './supabase'
