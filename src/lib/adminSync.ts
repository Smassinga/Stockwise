import { supabase } from './supabase'
import { withTimeout } from './withTimeout'

const ADMIN_SYNC_TTL_MS = 15 * 60 * 1000

function keyFor(userId: string) {
  return `sw:lastAdminUserSync:${userId}`
}

export async function runAdminUserSyncIfNeeded(userId: string) {
  if (typeof window === 'undefined') return

  const key = keyFor(userId)
  const lastRun = Number(window.localStorage.getItem(key) ?? 0)
  if (Number.isFinite(lastRun) && Date.now() - lastRun < ADMIN_SYNC_TTL_MS) {
    return
  }

  await withTimeout(
    supabase.functions.invoke('admin-users/sync', { body: {} }),
    5000,
    'admin user sync'
  )

  window.localStorage.setItem(key, String(Date.now()))
}
