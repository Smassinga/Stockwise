import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = async path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const functionSource = await read('supabase/functions/email-template-lab/index.ts')
const platformControl = await read('src/pages/PlatformControl.tsx')
const config = await read('supabase/config.toml')

test('QA email template lab is fail-closed on the Edge Function', () => {
  assert.match(functionSource, /Deno\.env\.get\("EMAIL_TEMPLATE_LAB_ENABLED"\)/)
  assert.match(functionSource, /if \(!EMAIL_TEMPLATE_LAB_ENABLED\) return json\(\{ error: "qa_lab_disabled" \}, 404\)/)

  const killSwitch = functionSource.indexOf('if (!EMAIL_TEMPLATE_LAB_ENABLED)')
  const authentication = functionSource.indexOf('const token = req.headers.get("authorization")')
  assert.ok(killSwitch >= 0 && authentication >= 0 && killSwitch < authentication)

  assert.match(functionSource, /EMAIL_QA_ALLOWED_RECIPIENTS/)
  assert.match(functionSource, /allowedRecipients\.has\(recipient\)/)
  assert.match(functionSource, /platform_admin_required/)
})

test('Platform Control renders the QA lab only behind an explicit build flag', () => {
  assert.match(platformControl, /const emailTemplateLabEnabled = import\.meta\.env\.VITE_ENABLE_EMAIL_TEMPLATE_LAB === 'true'/)
  assert.match(platformControl, /platformView === 'portfolio' && !portfolioError && emailTemplateLabEnabled/)
})

test('email-template-lab remains JWT-verified when deployed', () => {
  assert.match(
    config,
    /\[functions\.email-template-lab\][\s\S]*?enabled = true[\s\S]*?verify_jwt = true[\s\S]*?entrypoint = "\.\/functions\/email-template-lab\/index\.ts"/,
  )
})
