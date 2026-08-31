from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


edge_path = Path('supabase/functions/email-template-lab/index.ts')
edge = edge_path.read_text(encoding='utf-8')
if 'EMAIL_TEMPLATE_LAB_ENABLED' in edge:
    raise SystemExit('Edge Function already contains EMAIL_TEMPLATE_LAB_ENABLED')
edge = replace_once(
    edge,
    'const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";\n',
    'const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";\n'
    'const EMAIL_TEMPLATE_LAB_ENABLED = (Deno.env.get("EMAIL_TEMPLATE_LAB_ENABLED") || "").trim().toLowerCase() === "true";\n',
    'Edge Function environment gate insertion',
)
edge = replace_once(
    edge,
    '  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });\n  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);\n',
    '  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });\n'
    '  if (!EMAIL_TEMPLATE_LAB_ENABLED) return json({ error: "qa_lab_disabled" }, 404);\n'
    '  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);\n',
    'Edge Function fail-closed request gate',
)
if edge.index('if (!EMAIL_TEMPLATE_LAB_ENABLED)') > edge.index('const token = req.headers.get("authorization")'):
    raise SystemExit('Edge Function gate must run before authentication/body processing')
for marker in ['EMAIL_QA_ALLOWED_RECIPIENTS', 'allowedRecipients.has(recipient)', 'platform_admin_required']:
    if marker not in edge:
        raise SystemExit(f'Edge Function safety marker missing after edit: {marker}')
edge_path.write_text(edge, encoding='utf-8')

platform_path = Path('src/pages/PlatformControl.tsx')
platform = platform_path.read_text(encoding='utf-8')
if 'VITE_ENABLE_EMAIL_TEMPLATE_LAB' in platform:
    raise SystemExit('Platform Control already contains VITE_ENABLE_EMAIL_TEMPLATE_LAB')
platform = replace_once(
    platform,
    "const companySections: PlatformCompanySection[] = ['overview', 'access', 'communications', 'audit', 'danger']\n",
    "const companySections: PlatformCompanySection[] = ['overview', 'access', 'communications', 'audit', 'danger']\n"
    "const emailTemplateLabEnabled = import.meta.env.VITE_ENABLE_EMAIL_TEMPLATE_LAB === 'true'\n",
    'Platform Control frontend gate declaration',
)
platform = replace_once(
    platform,
    "          {platformView === 'portfolio' && !portfolioError ? <EmailTemplateLab language={lang} /> : null}\n",
    "          {platformView === 'portfolio' && !portfolioError && emailTemplateLabEnabled ? <EmailTemplateLab language={lang} /> : null}\n",
    'Platform Control QA lab render gate',
)
platform_path.write_text(platform, encoding='utf-8')

runbook_path = Path('docs/platform-admin-runbook.md')
runbook = runbook_path.read_text(encoding='utf-8')
heading = '## QA Email Template Lab Isolation'
if heading in runbook:
    raise SystemExit('Runbook already contains QA Email Template Lab Isolation section')
section = '''\n\n## QA Email Template Lab Isolation\n\nThe Email Template Lab is a QA-only diagnostic surface. It is fail-closed by default and is not part of normal production Platform Control.\n\nTwo independent controls are required to expose it:\n\n- Edge Function: `EMAIL_TEMPLATE_LAB_ENABLED=true`\n- frontend build: `VITE_ENABLE_EMAIL_TEMPLATE_LAB=true`\n\nIf either value is absent or anything other than the literal string `true`, the lab is unavailable. The Edge Function is the authoritative boundary: when disabled it returns `qa_lab_disabled` before authentication, request parsing, template listing, preview generation, recent-dispatch reads, or sending logic.\n\nEnabling the lab does not bypass its existing controls. A caller must still be an authenticated platform admin, and test sends remain restricted to `EMAIL_QA_ALLOWED_RECIPIENTS`.\n\nOperating rule:\n\n- keep both enable flags unset for normal production\n- prefer local or isolated QA environments when using the lab\n- if a controlled hosted QA window is explicitly required, enable both flags only for that window and disable them again immediately after validation\n- never treat the frontend flag as a security control; backend enforcement remains mandatory\n\nSupabase Edge Function environment variables are managed through the hosted function secrets/environment configuration. The frontend flag is a Vite build-time variable and must therefore be set only on the intended QA build/environment.\n'''
runbook_path.write_text(runbook.rstrip() + section + '\n', encoding='utf-8')

print('QA email lab isolation changes applied successfully')
