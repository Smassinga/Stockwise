import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

function parseArgs(argv) {
  const args = { email: '', note: '' }

  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i]
    if (current === '--note') {
      args.note = argv[i + 1] || ''
      i += 1
      continue
    }
    if (!args.email) args.email = current
  }

  return args
}

async function findUserIdByEmail(adminClient, email) {
  let page = 1
  const lowerEmail = email.toLowerCase()

  for (;;) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error

    const match = (data?.users || []).find((user) => String(user.email || '').toLowerCase() === lowerEmail)
    if (match) return match.id

    if (!data?.users?.length || data.users.length < 200) return null
    page += 1
  }
}

const { email, note } = parseArgs(process.argv)
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY

if (!url || !serviceRoleKey || !email) {
  console.error('Usage: node --env-file=.env scripts/bootstrap-platform-admin.mjs <email> [--note "optional note"]')
  process.exit(1)
}

const adminClient = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const normalizedEmail = email.trim().toLowerCase()
const userId = await findUserIdByEmail(adminClient, normalizedEmail)

const { error } = await adminClient
  .from('platform_admins')
  .upsert(
    {
      email: normalizedEmail,
      user_id: userId,
      is_active: true,
      note: note.trim() || null,
      granted_at: new Date().toISOString(),
    },
    { onConflict: 'email' },
  )

if (error) {
  console.error('Failed to upsert platform admin:', JSON.stringify(error, null, 2))
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      email: normalizedEmail,
      userId,
      status: 'active',
      note: note.trim() || null,
    },
    null,
    2,
  ),
)
