import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || ''
const fixturePath = process.env.E2E_FIXTURE_PATH || ''

if (!supabaseUrl || !anonKey || !serviceRoleKey || !fixturePath) {
  throw new Error('Missing isolated E2E Supabase configuration or E2E_FIXTURE_PATH')
}

const target = new URL(supabaseUrl)
if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) {
  throw new Error(`E2E fixture creation is local-only; rejected target ${target.hostname}`)
}

const nonce = randomUUID().slice(0, 8)
const email = `browser.owner.${nonce}@stockwise.local`
const password = `Sw!Browser${nonce}Aa11`
const companyName = `Browser QA ${nonce}`

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const anon = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const createdUser = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { name: 'Browser QA Owner' },
})
if (createdUser.error) throw createdUser.error

const signIn = await anon.auth.signInWithPassword({ email, password })
if (signIn.error || !signIn.data.session) throw signIn.error || new Error('Browser fixture sign-in did not create a session')

const bootstrap = await anon.rpc('create_company_and_bootstrap', { p_name: companyName })
if (bootstrap.error) throw bootstrap.error
const bootstrapRow = Array.isArray(bootstrap.data) ? bootstrap.data[0] : bootstrap.data
const companyId = bootstrapRow?.out_company_id
if (!companyId) throw new Error('Browser fixture bootstrap did not return a company id')

const active = await anon.rpc('set_active_company', { p_company: companyId })
if (active.error) throw active.error

await writeFile(fixturePath, JSON.stringify({ email, password, companyId, companyName }), 'utf8')
console.log(`Created local-only browser fixture for ${companyName}`)
