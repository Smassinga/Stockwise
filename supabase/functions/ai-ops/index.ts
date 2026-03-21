// supabase/functions/ai-ops/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  authErrorResponse,
  parseJsonObject,
  verifySignedRequest,
} from '../_shared/internalAuth.ts'

// ENV (Dashboard → Project Settings → Functions → Environment variables)
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AI_OPS_SECRET = Deno.env.get('AI_OPS_SECRET')!
const MAX_COMMANDS = 20
const MAX_SQL_CHARS = 20000
const MAX_TOTAL_SQL_CHARS = 100000

const supa = createClient(SUPABASE_URL, SERVICE_KEY)

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
    const { rawBody } = await verifySignedRequest(req, AI_OPS_SECRET, {
      maxAgeSeconds: 300,
      maxBodyBytes: 128 * 1024,
    })

    const env = parseJsonObject(rawBody) as Envelope
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
    if (env.commands.length > MAX_COMMANDS) {
      return new Response(JSON.stringify({ ok: false, error: 'too_many_commands' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const totalSqlChars = env.commands.reduce((sum, cmd) => sum + String(cmd.sql ?? '').length, 0)
    if (totalSqlChars > MAX_TOTAL_SQL_CHARS || env.commands.some((cmd) => String(cmd.sql ?? '').length > MAX_SQL_CHARS)) {
      return new Response(JSON.stringify({ ok: false, error: 'command_too_large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
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
    if (!(e instanceof Error)) {
      console.error('[ai-ops] unexpected error', e)
      return authErrorResponse(e)
    }
    console.error('[ai-ops] request failed', e)
    return authErrorResponse(e)
  }
})
