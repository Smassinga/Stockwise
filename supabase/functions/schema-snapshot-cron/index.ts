// supabase/functions/schema-snapshot-cron/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  authErrorResponse,
  buildSignedJsonHeaders,
  verifySignedRequest,
} from '../_shared/internalAuth.ts'

const SUPABASE_URL = Deno.env.get('SB_URL') ?? Deno.env.get('SUPABASE_URL') ?? ''
const AI_OPS_SECRET = Deno.env.get('AI_OPS_SECRET') ?? ''
const SNAPSHOT_SCHEMA = (Deno.env.get('AI_SNAPSHOT_SCHEMA') ?? 'public').split(',').map((value) => value.trim()).find(Boolean) ?? 'public'

if (!SUPABASE_URL || !AI_OPS_SECRET) {
  throw new Error('Missing SB_URL/AI_OPS_SECRET (or SUPABASE_URL fallback)')
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 405,
      })
    }
    await verifySignedRequest(req, AI_OPS_SECRET, {
      maxAgeSeconds: 300,
      maxBodyBytes: 4 * 1024,
    })

    const schema = SNAPSHOT_SCHEMA
    const persist = true

    const payload = JSON.stringify({ schema, persist })
    const headers = await buildSignedJsonHeaders(AI_OPS_SECRET, payload)

    const res = await fetch(`${SUPABASE_URL}/functions/v1/schema-snapshot`, {
      method: 'POST',
      headers,
      body: payload,
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('[schema-snapshot-cron] upstream failed', res.status, text)
    }
    return new Response(
      JSON.stringify({ ok: res.ok, status: res.status, schema, persisted: res.ok }),
      { headers: { 'Content-Type': 'application/json' }, status: res.ok ? 200 : res.status }
    )
  } catch (e) {
    console.error('[schema-snapshot-cron] request failed', e)
    return authErrorResponse(e)
  }
})
