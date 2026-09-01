import fs from 'node:fs'

const pagePath = 'src/pages/Settings.tsx'
const componentPath = 'src/features/settings/SettingsCompanyProfileSection.tsx'
let source = fs.readFileSync(pagePath, 'utf8')

const componentImport = 'import { SettingsCompanyProfileSection } from "../features/settings/SettingsCompanyProfileSection";\n'
const importAnchor = 'import { NotificationPreferences } from "../components/notifications/NotificationPreferences";\n'
if (!source.includes(componentImport)) {
  if (!source.includes(importAnchor)) throw new Error('Settings import anchor not found')
  source = source.replace(importAnchor, `${importAnchor}${componentImport}`)
}

const start = '      {/* ===================== Company Profile (companies) ===================== */}'
const next = '      <div id="settings-commercial-tax"'
const startIndex = source.indexOf(start)
const nextIndex = source.indexOf(next, startIndex)
if (startIndex < 0 || nextIndex < 0 || nextIndex <= startIndex) {
  throw new Error('Settings company-profile boundaries not found')
}
const block = source.slice(startIndex, nextIndex)
if (!block.includes('id="settings-company-profile"') || !block.includes('<LogoUploader')) {
  throw new Error('Settings company-profile block did not match expected content')
}

const component = `import { Building } from 'lucide-react'\nimport LogoUploader from '../../components/settings/LogoUploader'\nimport { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'\nimport { Input } from '../../components/ui/input'\nimport { Label } from '../../components/ui/label'\nimport { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../components/ui/select'\n\ntype Translate = (key: string, vars?: Record<string, string | number>) => string\ntype TranslateFallback = (key: string, fallback: string, vars?: Record<string, string | number>) => string\n\ntype CompanyProfileShape = {\n  legal_name: string | null\n  trade_name: string | null\n  email_subject_prefix: string | null\n  tax_id: string | null\n  registration_no: string | null\n  phone: string | null\n  email: string | null\n  website: string | null\n  address_line1: string | null\n  address_line2: string | null\n  city: string | null\n  state: string | null\n  postal_code: string | null\n  country_code: string | null\n  print_footer_note: string | null\n  logo_path: string | null\n  preferred_lang: 'en' | 'pt' | null\n}\n\ntype SettingsCompanyProfileSectionProps = {\n  activeSection: string | null\n  t: Translate\n  tt: TranslateFallback\n  profile: CompanyProfileShape | null\n  setProfileField: (key: keyof CompanyProfileShape, value: unknown) => void\n  canEditOps: boolean\n  data: { documents: { brand: { logoUrl: string } } }\n  setField: (path: string, value: unknown) => void\n  pathFromPublicUrl: (url: string | null | undefined) => string | null\n  companyId: string | null | undefined\n}\n\nexport function SettingsCompanyProfileSection({\n  activeSection,\n  t,\n  tt,\n  profile,\n  setProfileField,\n  canEditOps,\n  data,\n  setField,\n  pathFromPublicUrl,\n  companyId,\n}: SettingsCompanyProfileSectionProps) {\n  return (\n    <>\n${block}\n    </>\n  )\n}\n`

fs.mkdirSync('src/features/settings', { recursive: true })
fs.writeFileSync(componentPath, component)

const replacement = `      <SettingsCompanyProfileSection\n        activeSection={activeSection}\n        t={t}\n        tt={tt}\n        profile={profile}\n        setProfileField={setProfileField}\n        canEditOps={canEditOps}\n        data={data}\n        setField={setField}\n        pathFromPublicUrl={pathFromPublicUrl}\n        companyId={companyId}\n      />\n\n`
source = `${source.slice(0, startIndex)}${replacement}${source.slice(nextIndex)}`
source = source.replace('  SelectGroup,\n  SelectLabel,\n', '')
source = source.replace('  Building,\n', '')

fs.writeFileSync(pagePath, source)
console.log('Extracted Settings company profile section')
