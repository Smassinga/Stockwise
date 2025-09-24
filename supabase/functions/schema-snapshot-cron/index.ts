// supabase/functions/schema-snapshot-cron/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY  = Deno.env.get('SUPABASE_ANON_KEY')! // fine even if snapshot has verify_jwt=false
const AI_OPS_SECRET      = Deno.env.get('AI_OPS_SECRET')!

// small helper: HMAC-SHA256 -> hex
async function hmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// nice-to-have parser
function tryJson(s: string) {
  try { return JSON.parse(s) } catch { return s }
}

Deno.serve(async (req) => {
  try {
    // optional overrides via querystring: ?schema=public&persist=true
    const url = new URL(req.url)
    const schema  = url.searchParams.get('schema')  ?? 'public'
    const persist = (url.searchParams.get('persist') ?? 'true').toLowerCase() !== 'false'

    const payload = JSON.stringify({ schema, persist })
    const sig     = await hmacHex(AI_OPS_SECRET, payload)

    // If schema-snapshot.verify_jwt=false this Authorization/apikey is harmless.
    // If you later switch it to true, this still works for external invokes
    // (you’d replace ANON with a real user access token for Authorization).
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-ai-signature': sig,
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/schema-snapshot`, {
      method: 'POST',
      headers,
      body: payload,
    })

    const text = await res.text()
    return new Response(
      JSON.stringify({ ok: res.ok, status: res.status, body: tryJson(text) }),
      { headers: { 'Content-Type': 'application/json' }, status: res.ok ? 200 : 500 }
    )
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      headers: { 'Content-Type': 'application/json' }, status: 500
    })
  }
})
