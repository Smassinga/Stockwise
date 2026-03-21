// supabase/functions/ai-chat-exec/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  authErrorResponse,
  buildSignedJsonHeaders,
  parseJsonObject,
  verifySignedRequest,
} from '../_shared/internalAuth.ts'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const AI_OPS_SECRET     = Deno.env.get('AI_OPS_SECRET')!

// ---- types the chat client may send ----
type ChatExecPayload =
  | { sql: string; label?: string; intent?: string; actor?: string; dry_run?: boolean; idempotency_key?: string }
  | { sql: string[]; labels?: (string | undefined)[]; intent?: string; actor?: string; dry_run?: boolean; idempotency_key?: string }
  | { commands: { sql: string; label?: string }[]; intent?: string; actor?: string; dry_run?: boolean; idempotency_key?: string }

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const { rawBody } = await verifySignedRequest(req, AI_OPS_SECRET, {
      maxAgeSeconds: 300,
      maxBodyBytes: 128 * 1024,
    })

    const input = parseJsonObject(rawBody) as ChatExecPayload

    // Normalize into the ai-ops envelope
    let commands: { sql: string; label?: string }[] = []

    if ('commands' in input && Array.isArray(input.commands)) {
      commands = input.commands
    } else if ('sql' in input && Array.isArray((input as any).sql)) {
      const arr = (input as any).sql as string[]
      const labels = (input as any).labels as (string | undefined)[] | undefined
      commands = arr.map((sql, i) => ({ sql, label: labels?.[i] }))
    } else if ('sql' in input && typeof (input as any).sql === 'string') {
      commands = [{ sql: (input as any).sql, label: (input as any).label }]
    }

    if (!commands.length || commands.some(c => !c.sql || !c.sql.trim())) {
      return new Response(JSON.stringify({ ok: false, error: 'no_sql_commands' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }

    const envelope = {
      idempotency_key: (input as any).idempotency_key || crypto.randomUUID(),
      dry_run: !!(input as any).dry_run,
      actor: (input as any).actor || 'chatgpt',
      intent: (input as any).intent,
      commands
    }

    const body = JSON.stringify(envelope)
    const headers = await buildSignedJsonHeaders(AI_OPS_SECRET, body)

    // Call the centralized executor (your existing function)
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-ops`, {
      method: 'POST',
      headers,
      body
    })

    const text = await res.text()
    const out = (() => { try { return JSON.parse(text) } catch { return { raw: text } } })()

    return new Response(JSON.stringify({ ok: res.ok, status: res.status, envelope, exec: out }), {
      headers: { 'Content-Type': 'application/json' }, status: res.ok ? 200 : res.status
    })
  } catch (e) {
    console.error('[ai-chat-exec] request failed', e)
    return authErrorResponse(e)
  }
})
