// supabase/functions/schema-snapshot/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Environment (set these in Project Settings → Functions → Environment variables)
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AI_OPS_SECRET = Deno.env.get('AI_OPS_SECRET')!  // shared HMAC secret

const supa = createClient(SUPABASE_URL, SERVICE_KEY)

// Constant-time compare for Uint8Array (Edge-safe; no Node APIs)
function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

async function validSig(req: Request) {
  const providedRaw = (req.headers.get('x-ai-signature') ?? '').trim().toLowerCase()
  const body = await req.clone().text()
  const enc = new TextEncoder()

  // HMAC-SHA256(body, AI_OPS_SECRET) → hex (lowercase)
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(AI_OPS_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')

  // Constant-time comparison on bytes
  return safeEqual(enc.encode(providedRaw), enc.encode(hex))
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    // HMAC gate (second factor in addition to Supabase function auth)
    if (!(await validSig(req))) {
      return new Response('Forbidden', { status: 403 })
    }

    const { schema = 'public', persist = false } = await req.json()

    // RPC returns JSONB with catalog metadata only
    const { data, error } = await supa.rpc('get_schema_snapshot', { p_schema: schema })
    if (error) {
      return new Response(JSON.stringify({ ok: false, error }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (persist) {
      const { error: insErr } = await supa.from('ai_schema_cache').insert({
        schema_name: schema,
        snapshot: data
      })
      if (insErr) {
        return new Response(JSON.stringify({ ok: false, error: insErr }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    return new Response(JSON.stringify({ ok: true, snapshot: data }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
