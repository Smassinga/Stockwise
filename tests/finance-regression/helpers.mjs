import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export function env(name, fallback = null) {
  const value = process.env[name] ?? fallback
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function createAdminClient() {
  const url = env('VITE_SUPABASE_URL', process.env.SUPABASE_URL)
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY', process.env.SERVICE_ROLE_KEY)
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createAnonClient() {
  const url = env('VITE_SUPABASE_URL', process.env.SUPABASE_URL)
  const anonKey = env('VITE_SUPABASE_ANON_KEY', process.env.SUPABASE_ANON_KEY)
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function createTempUser(adminClient, prefix, label) {
  const nonce = randomUUID().slice(0, 8)
  const email = `${prefix}.${label}.${nonce}@stockwise.local`
  const password = `Sw!${nonce}Aa11`
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `${prefix}-${label}` },
  })
  if (error) throw error
  return {
    email,
    password,
    userId: data.user.id,
  }
}

export async function signIn(email, password) {
  const client = createAnonClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  assert.ok(data.session?.access_token, 'Expected a session after sign-in')
  return client
}

export async function setActiveCompany(client, companyId) {
  const { data, error } = await client.rpc('set_active_company', { p_company: companyId })
  if (error) throw error
  return data
}

export async function expectError(resultPromise, messagePart) {
  let caught = null
  try {
    await resultPromise
  } catch (error) {
    caught = error
  }
  assert.ok(caught, `Expected an error containing "${messagePart}"`)
  if (messagePart) {
    assert.match(String(caught?.message || caught), new RegExp(messagePart, 'i'))
  }
  return caught
}

export async function expectPostgrestError(operationPromise, messagePart) {
  const result = await operationPromise
  assert.ok(result?.error, `Expected a PostgREST error containing "${messagePart}"`)
  if (messagePart) {
    assert.match(String(result.error.message || result.error), new RegExp(messagePart, 'i'))
  }
  return result.error
}

export function round2(value) {
  return Math.round(Number(value) * 100) / 100
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export function plusDaysIso(days) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export async function deleteAuthUser(adminClient, userId) {
  if (!userId) return
  const { error } = await adminClient.auth.admin.deleteUser(userId, true)
  if (error) {
    console.warn('[finance-regression] failed to delete auth user', userId, error.message)
  }
}

export function unwrapRpcSingle(data) {
  if (Array.isArray(data)) return data[0] ?? null
  if (data && typeof data === 'object') return data
  return null
}
