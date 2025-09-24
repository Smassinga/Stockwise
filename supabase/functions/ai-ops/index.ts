// supabase/functions/ai-ops/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ENV (Dashboard → Project Settings → Functions → Environment variables)
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AI_OPS_SECRET = Deno.env.get('AI_OPS_SECRET')!

const supa = createClient(SUPABASE_URL, SERVICE_KEY)

// Edge-safe constant-time compare
function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ^ b[i])
  return diff === 0
}

async function validSig(req: Request) {
  const provided = (req.headers.get('x-ai-signature') ?? '').trim().toLowerCase()
  const body = await req.clone().text()
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(AI_OPS_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
  return safeEqual(enc.encode(provided), enc.encode(hex))
}

type SqlCommand = {
  kind?: 'sql'
  label?: string
  sql: string
}

type Envelope = {
  idempotency_key: string
  dry_run?: boolean
  actor?: string               // defaults to 'chatgpt'
  commands: SqlCommand[]
  intent?: string              // free-form human intent (stored in audit)
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    if (!(await validSig(req))) {
      return new Response('Forbidden', { status: 403 })
    }

    const env: Envelope = await req.json()
    const dryRun = !!env.dry_run
    const actor = env.actor?.slice(0, 64) || 'chatgpt'
    const idem  = (env.idempotency_key || '').trim()
    const intent = (env.intent || '').slice(0, 500)

    if (!idem || !Array.isArray(env.commands) || env.commands.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_envelope' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // 1) Idempotency replay check
    const { data: prior, error: priorErr } = await supa
      .from('ai_command_log')
      .select('id, ts, status, dry_run, intent, result')
      .eq('idempotency_key', idem)
      .limit(1)
      .maybeSingle()

    if (priorErr) {
      return new Response(JSON.stringify({ ok: false, error: priorErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (prior) {
      return new Response(JSON.stringify({
        ok: true,
        status: 'skipped',
        reason: 'idempotency_replay',
        prior
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    // 2) Execute commands via RPC public.ai_exec_one
    const perResults: any[] = []
    let allOk = true

    for (const [i, cmd] of env.commands.entries()) {
      const sql = (cmd.sql ?? '').toString()
      if (!sql.trim()) {
        perResults.push({ ok: false, error: 'empty_sql', index: i })
        allOk = false
        continue
      }
      const { data, error } = await supa.rpc('ai_exec_one', { p_sql: sql, p_dry_run: dryRun })
      if (error) {
        perResults.push({ ok: false, error: 'rpc_error', message: error.message, sql, index: i })
        allOk = false
      } else {
        const ok = !!(data as any)?.ok
        perResults.push({ index: i, label: cmd.label, ...(data as any) })
        if (!ok) allOk = false
      }
      if (!dryRun && !allOk) break
    }

    const status = allOk ? (dryRun ? 'accepted' : 'applied') : 'failed'

    // 3) Persist audit row (now storing intent)
    const audit = {
      actor,
      idempotency_key: idem,
      dry_run: dryRun,
      intent,
      request: env as any,
      status,
      result: { per_command: perResults, all_ok: allOk }
    }

    const { data: inserted, error: insErr } = await supa
      .from('ai_command_log')
      .insert(audit)
      .select('id, ts, status, dry_run, intent, result')
      .single()

    if (insErr) {
      return new Response(JSON.stringify({ ok: false, error: insErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ ok: true, status, log: inserted }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
