from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"guard failed: expected text not found in {path}: {old[:100]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"guard failed: expected exactly one match in {path}, found {text.count(old)}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


ui_path = "src/components/platform/EmailTemplateLab.tsx"
replace_once(
    ui_path,
    "import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'\n\n",
    "import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'\n\nconst emailTemplateLabEnabled = import.meta.env.VITE_ENABLE_EMAIL_TEMPLATE_LAB === 'true'\n\n",
)
replace_once(
    ui_path,
    "  useEffect(() => { void load().catch(() => undefined) }, [])\n",
    "  useEffect(() => {\n    if (!emailTemplateLabEnabled) return\n    void load().catch(() => undefined)\n  }, [])\n",
)
replace_once(
    ui_path,
    "  const isReminder = templateKey.startsWith('due_reminder_')\n",
    "  if (!emailTemplateLabEnabled) return null\n\n  const isReminder = templateKey.startsWith('due_reminder_')\n",
)

edge_path = "supabase/functions/email-template-lab/index.ts"
replace_once(
    edge_path,
    'const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";\n',
    'const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";\nconst EMAIL_TEMPLATE_LAB_ENABLED = Deno.env.get("EMAIL_TEMPLATE_LAB_ENABLED") === "true";\n',
)
replace_once(
    edge_path,
    '  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);\n',
    '  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);\n  if (!EMAIL_TEMPLATE_LAB_ENABLED) return json({ error: "qa_lab_disabled" }, 404);\n',
)

test_path = "tests/ops-1/comms-3.test.mjs"
replace_once(
    test_path,
    "test('security controls cover company communication settings and private stages', () => {\n",
    "test('Template Lab is fail-closed unless QA flags are explicitly enabled', () => {\n  assert.match(lab, /EMAIL_TEMPLATE_LAB_ENABLED = Deno\\.env\\.get\\(\"EMAIL_TEMPLATE_LAB_ENABLED\"\\) === \"true\"/)\n  assert.match(lab, /qa_lab_disabled/)\n  assert.match(labUi, /VITE_ENABLE_EMAIL_TEMPLATE_LAB/)\n  assert.match(labUi, /if \\(!emailTemplateLabEnabled\\) return/)\n  assert.match(labUi, /if \\(!emailTemplateLabEnabled\\) return null/)\n})\n\ntest('security controls cover company communication settings and private stages', () => {\n",
)

doc_path = Path("docs/platform-admin-runbook.md")
doc = doc_path.read_text(encoding="utf-8")
section = """

## Email Template Lab QA Isolation

The Email Template Lab is a QA-only operator surface. It must fail closed in normal production operation.

Two independent flags are required before the lab is usable:

- frontend build: `VITE_ENABLE_EMAIL_TEMPLATE_LAB=true`
- Edge Function environment: `EMAIL_TEMPLATE_LAB_ENABLED=true`

If either flag is absent or any value other than the literal string `true`, the lab is unavailable. The frontend renders nothing and makes no lab function calls when its flag is disabled. The `email-template-lab` Edge Function returns `qa_lab_disabled` before authentication or template work when its flag is disabled.

These flags are additional controls, not replacements for the existing security boundary. When explicitly enabled for an authorised QA window, the function still requires an authenticated platform admin and send mode still accepts only recipients listed in `EMAIL_QA_ALLOWED_RECIPIENTS`.

Production posture:

- leave both enable flags unset or false by default
- never commit QA recipient addresses or secrets to the repository
- enable the lab only for a controlled QA window
- keep `verify_jwt = true` for the Edge Function
- after QA, disable the enable flags again

Supabase Edge Function variables are read from the hosted function environment through `Deno.env.get(...)`; changing a hosted secret does not require committing it to source control.
"""
if "## Email Template Lab QA Isolation" in doc:
    raise SystemExit("guard failed: governance section already exists")
doc_path.write_text(doc.rstrip() + section + "\n", encoding="utf-8")

# Final static guards: these fail the branch workflow if a future/current baseline does not
# produce the intended fail-closed boundary.
ui = Path(ui_path).read_text(encoding="utf-8")
edge = Path(edge_path).read_text(encoding="utf-8")
checks = {
    "frontend flag": "VITE_ENABLE_EMAIL_TEMPLATE_LAB" in ui,
    "frontend load guard": "if (!emailTemplateLabEnabled) return" in ui,
    "frontend render guard": "if (!emailTemplateLabEnabled) return null" in ui,
    "server flag": 'Deno.env.get("EMAIL_TEMPLATE_LAB_ENABLED") === "true"' in edge,
    "server disabled response": 'qa_lab_disabled' in edge,
    "recipient allowlist retained": 'EMAIL_QA_ALLOWED_RECIPIENTS' in edge,
    "platform admin retained": 'is_platform_admin' in edge,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit(f"governance guard failed: {failed}")

print("email-template-lab governance changes staged successfully")
