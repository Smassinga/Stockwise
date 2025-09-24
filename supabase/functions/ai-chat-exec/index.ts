// supabase/functions/ai-chat-exec/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const AI_OPS_SECRET     = Deno.env.get('AI_OPS_SECRET')!

// ---- crypto helpers ----
function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ^ b[i])
  return diff === 0
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function checkInboundHmac(req: Request): Promise<boolean> {
  const provided = (req.headers.get('x-ai-signature') ?? '').trim().toLowerCase()
  if (!provided) return false
  const body = await req.clone().text()
  const hex = await hmacHex(AI_OPS_SECRET, body)
  const enc = new TextEncoder()
  return safeEqual(enc.encode(provided), enc.encode(hex))
}

// ---- types the chat client may send ----
type ChatExecPayload =
  | { sql: string; label?: string; intent?: string; actor?: string; dry_run?: boolean; idempotency_key?: string }
  | { sql: string[]; labels?: (string | undefined)[]; intent?: string; actor?: string; dry_run?: boolean; idempotency_key?: string }
  | { commands: { sql: string; label?: string }[]; intent?: string; actor?: string; dry_run?: boolean; idempotency_key?: string }

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    if (!(await checkInboundHmac(req))) return new Response('Forbidden', { status: 403 })

    const input = await req.json() as ChatExecPayload

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
    const sig  = await hmacHex(AI_OPS_SECRET, body)

    // Call the centralized executor (your existing function)
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-ops`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ai-signature': sig,
        // These are harmless when ai-ops has verify_jwt=false; if you enable it later,
        // swap Authorization to a real user access token.
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body
    })

    const text = await res.text()
    const out = (() => { try { return JSON.parse(text) } catch { return { raw: text } } })()

    return new Response(JSON.stringify({ ok: res.ok, status: res.status, envelope, exec: out }), {
      headers: { 'Content-Type': 'application/json' }, status: res.ok ? 200 : 500
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      headers: { 'Content-Type': 'application/json' }, status: 500
    })
  }
})
