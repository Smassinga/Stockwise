// supabase/functions/schema-snapshot/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  authErrorResponse,
  parseJsonObject,
  verifySignedRequest,
} from '../_shared/internalAuth.ts'

// Environment (set these in Project Settings → Functions → Environment variables)
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AI_OPS_SECRET = Deno.env.get('AI_OPS_SECRET')!  // shared HMAC secret
const ALLOWED_SCHEMAS = (Deno.env.get('AI_SNAPSHOT_SCHEMA') ?? 'public')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)

const supa = createClient(SUPABASE_URL, SERVICE_KEY)

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const { rawBody } = await verifySignedRequest(req, AI_OPS_SECRET, {
      maxAgeSeconds: 300,
      maxBodyBytes: 16 * 1024,
    })
    const body = parseJsonObject(rawBody)

    const schema = String(body.schema ?? ALLOWED_SCHEMAS[0] ?? 'public').trim().toLowerCase()
    const persist = body.persist === true
    if (!ALLOWED_SCHEMAS.includes(schema)) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_schema' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // RPC returns JSONB with catalog metadata only
    const { data, error } = await supa.rpc('get_schema_snapshot', { p_schema: schema })
    if (error) {
      console.error('[schema-snapshot] rpc failed', error)
      return new Response(JSON.stringify({ ok: false, error: 'snapshot_failed' }), {
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
        console.error('[schema-snapshot] persist failed', insErr)
        return new Response(JSON.stringify({ ok: false, error: 'persist_failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    return new Response(JSON.stringify({ ok: true, snapshot: data }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    console.error('[schema-snapshot] request failed', e)
    return authErrorResponse(e)
  }
})
