import { Building } from 'lucide-react'
import LogoUploader from '../../components/settings/LogoUploader'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../components/ui/select'

type Translate = (key: string, vars?: Record<string, string | number>) => string
type TranslateFallback = (key: string, fallback: string, vars?: Record<string, string | number>) => string

type CompanyProfileShape = {
  legal_name: string | null
  trade_name: string | null
  email_subject_prefix: string | null
  tax_id: string | null
  registration_no: string | null
  phone: string | null
  email: string | null
  website: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country_code: string | null
  print_footer_note: string | null
  logo_path: string | null
  preferred_lang: 'en' | 'pt' | null
}

type SettingsCompanyProfileSectionProps = {
  activeSection: string | null
  t: Translate
  tt: TranslateFallback
  profile: CompanyProfileShape | null
  setProfileField: (key: keyof CompanyProfileShape, value: unknown) => void
  canEditOps: boolean
  data: { documents: { brand: { logoUrl: string } } }
  setField: (path: string, value: unknown) => void
  pathFromPublicUrl: (url: string | null | undefined) => string | null
  companyId: string | null | undefined
}

export function SettingsCompanyProfileSection({
  activeSection,
  t,
  tt,
  profile,
  setProfileField,
  canEditOps,
  data,
  setField,
  pathFromPublicUrl,
  companyId,
}: SettingsCompanyProfileSectionProps) {
  return (
    <>
      {/* ===================== Company Profile (companies) ===================== */}
      <Card id="settings-company-profile" tabIndex={-1} className={activeSection === "company-profile" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="w-5 h-5" />{" "}
            {t("settings.companyProfile.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.tradeName")}</Label>
              <Input
                value={profile?.trade_name ?? ""}
                onChange={(e) => setProfileField("trade_name", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.legalName")}</Label>
              <Input
                value={profile?.legal_name ?? ""}
                onChange={(e) => setProfileField("legal_name", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.emailSubjectPrefix")}</Label>
              <Input
                value={profile?.email_subject_prefix ?? ""}
                onChange={(e) => setProfileField("email_subject_prefix", e.target.value)}
                disabled={!canEditOps}
                placeholder={t("settings.companyProfile.emailSubjectPrefix.placeholder")}
              />
              <div className="hidden text-xs text-muted-foreground sm:block">
                {t("settings.companyProfile.emailSubjectPrefix.helper")}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.taxId")}</Label>
              <Input
                value={profile?.tax_id ?? ""}
                onChange={(e) => setProfileField("tax_id", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.registrationNo")}</Label>
              <Input
                value={profile?.registration_no ?? ""}
                onChange={(e) =>
                  setProfileField("registration_no", e.target.value)
                }
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.phone")}</Label>
              <Input
                value={profile?.phone ?? ""}
                onChange={(e) => setProfileField("phone", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("orders.email")}</Label>
              <Input
                value={profile?.email ?? ""}
                onChange={(e) => setProfileField("email", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.website")}</Label>
              <Input
                value={profile?.website ?? ""}
                onChange={(e) => setProfileField("website", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>{t("settings.companyProfile.printFooter")}</Label>
              <Input
                value={profile?.print_footer_note ?? ""}
                onChange={(e) =>
                  setProfileField("print_footer_note", e.target.value)
                }
                disabled={!canEditOps}
                placeholder={t(
                  "settings.companyProfile.printFooter.placeholder",
                )}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2 md:col-span-3">
              <Label>{t("settings.companyProfile.address1")}</Label>
              <Input
                value={profile?.address_line1 ?? ""}
                onChange={(e) =>
                  setProfileField("address_line1", e.target.value)
                }
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label>{t("settings.companyProfile.address2")}</Label>
              <Input
                value={profile?.address_line2 ?? ""}
                onChange={(e) =>
                  setProfileField("address_line2", e.target.value)
                }
                disabled={!canEditOps}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.city")}</Label>
              <Input
                value={profile?.city ?? ""}
                onChange={(e) => setProfileField("city", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.state")}</Label>
              <Input
                value={profile?.state ?? ""}
                onChange={(e) => setProfileField("state", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.postal")}</Label>
              <Input
                value={profile?.postal_code ?? ""}
                onChange={(e) => setProfileField("postal_code", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.country")}</Label>
              <Select
                value={profile?.country_code ?? ""}
                onValueChange={(value) =>
                  setProfileField("country_code", value)
                }
                disabled={!canEditOps}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("settings.companyProfile.country.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{tt("settings.companyProfile.country.common", "Common countries")}</SelectLabel>
                    <SelectItem value="MZ">Mozambique (MZ)</SelectItem>
                    <SelectItem value="PT">Portugal (PT)</SelectItem>
                    <SelectItem value="BR">Brazil (BR)</SelectItem>
                    <SelectItem value="AO">Angola (AO)</SelectItem>
                    <SelectItem value="CV">Cape Verde (CV)</SelectItem>
                    <SelectItem value="GW">Guinea-Bissau (GW)</SelectItem>
                    <SelectItem value="ST">São Tomé and Príncipe (ST)</SelectItem>
                    <SelectItem value="TL">Timor-Leste (TL)</SelectItem>
                    <SelectItem value="US">United States (US)</SelectItem>
                    <SelectItem value="GB">United Kingdom (GB)</SelectItem>
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>{tt("settings.companyProfile.country.other", "Other countries")}</SelectLabel>
                    <SelectItem value="AF">Afghanistan (AF)</SelectItem>
                    <SelectItem value="AL">Albania (AL)</SelectItem>
                    <SelectItem value="DZ">Algeria (DZ)</SelectItem>
                    <SelectItem value="AD">Andorra (AD)</SelectItem>
                    <SelectItem value="AR">Argentina (AR)</SelectItem>
                    <SelectItem value="AM">Armenia (AM)</SelectItem>
                    <SelectItem value="AU">Australia (AU)</SelectItem>
                    <SelectItem value="AT">Austria (AT)</SelectItem>
                    <SelectItem value="AZ">Azerbaijan (AZ)</SelectItem>
                    <SelectItem value="BS">Bahamas (BS)</SelectItem>
                    <SelectItem value="BH">Bahrain (BH)</SelectItem>
                    <SelectItem value="BD">Bangladesh (BD)</SelectItem>
                    <SelectItem value="BB">Barbados (BB)</SelectItem>
                    <SelectItem value="BY">Belarus (BY)</SelectItem>
                    <SelectItem value="BE">Belgium (BE)</SelectItem>
                    <SelectItem value="BZ">Belize (BZ)</SelectItem>
                    <SelectItem value="BJ">Benin (BJ)</SelectItem>
                    <SelectItem value="BT">Bhutan (BT)</SelectItem>
                    <SelectItem value="BO">Bolivia (BO)</SelectItem>
                    <SelectItem value="BA">Bosnia and Herzegovina (BA)</SelectItem>
                    <SelectItem value="BW">Botswana (BW)</SelectItem>
                    <SelectItem value="BN">Brunei (BN)</SelectItem>
                    <SelectItem value="BG">Bulgaria (BG)</SelectItem>
                    <SelectItem value="BF">Burkina Faso (BF)</SelectItem>
                    <SelectItem value="BI">Burundi (BI)</SelectItem>
                    <SelectItem value="KH">Cambodia (KH)</SelectItem>
                    <SelectItem value="CM">Cameroon (CM)</SelectItem>
                    <SelectItem value="CA">Canada (CA)</SelectItem>
                    <SelectItem value="CF">Central African Republic (CF)</SelectItem>
                    <SelectItem value="TD">Chad (TD)</SelectItem>
                    <SelectItem value="CL">Chile (CL)</SelectItem>
                    <SelectItem value="CN">China (CN)</SelectItem>
                    <SelectItem value="CO">Colombia (CO)</SelectItem>
                    <SelectItem value="KM">Comoros (KM)</SelectItem>
                    <SelectItem value="CG">Congo (CG)</SelectItem>
                    <SelectItem value="CD">Congo, Democratic Republic (CD)</SelectItem>
                    <SelectItem value="CR">Costa Rica (CR)</SelectItem>
                    <SelectItem value="CI">Côte d'Ivoire (CI)</SelectItem>
                    <SelectItem value="HR">Croatia (HR)</SelectItem>
                    <SelectItem value="CU">Cuba (CU)</SelectItem>
                    <SelectItem value="CY">Cyprus (CY)</SelectItem>
                    <SelectItem value="CZ">Czech Republic (CZ)</SelectItem>
                    <SelectItem value="DK">Denmark (DK)</SelectItem>
                    <SelectItem value="DJ">Djibouti (DJ)</SelectItem>
                    <SelectItem value="DM">Dominica (DM)</SelectItem>
                    <SelectItem value="DO">Dominican Republic (DO)</SelectItem>
                    <SelectItem value="EC">Ecuador (EC)</SelectItem>
                    <SelectItem value="EG">Egypt (EG)</SelectItem>
                    <SelectItem value="SV">El Salvador (SV)</SelectItem>
                    <SelectItem value="GQ">Equatorial Guinea (GQ)</SelectItem>
                    <SelectItem value="ER">Eritrea (ER)</SelectItem>
                    <SelectItem value="EE">Estonia (EE)</SelectItem>
                    <SelectItem value="SZ">Eswatini (SZ)</SelectItem>
                    <SelectItem value="ET">Ethiopia (ET)</SelectItem>
                    <SelectItem value="FJ">Fiji (FJ)</SelectItem>
                    <SelectItem value="FI">Finland (FI)</SelectItem>
                    <SelectItem value="FR">France (FR)</SelectItem>
                    <SelectItem value="GA">Gabon (GA)</SelectItem>
                    <SelectItem value="GM">Gambia (GM)</SelectItem>
                    <SelectItem value="GE">Georgia (GE)</SelectItem>
                    <SelectItem value="DE">Germany (DE)</SelectItem>
                    <SelectItem value="GH">Ghana (GH)</SelectItem>
                    <SelectItem value="GR">Greece (GR)</SelectItem>
                    <SelectItem value="GD">Grenada (GD)</SelectItem>
                    <SelectItem value="GT">Guatemala (GT)</SelectItem>
                    <SelectItem value="GN">Guinea (GN)</SelectItem>
                    <SelectItem value="GY">Guyana (GY)</SelectItem>
                    <SelectItem value="HT">Haiti (HT)</SelectItem>
                    <SelectItem value="HN">Honduras (HN)</SelectItem>
                    <SelectItem value="HU">Hungary (HU)</SelectItem>
                    <SelectItem value="IS">Iceland (IS)</SelectItem>
                    <SelectItem value="IN">India (IN)</SelectItem>
                    <SelectItem value="ID">Indonesia (ID)</SelectItem>
                    <SelectItem value="IR">Iran (IR)</SelectItem>
                    <SelectItem value="IQ">Iraq (IQ)</SelectItem>
                    <SelectItem value="IE">Ireland (IE)</SelectItem>
                    <SelectItem value="IL">Israel (IL)</SelectItem>
                    <SelectItem value="IT">Italy (IT)</SelectItem>
                    <SelectItem value="JM">Jamaica (JM)</SelectItem>
                    <SelectItem value="JP">Japan (JP)</SelectItem>
                    <SelectItem value="JO">Jordan (JO)</SelectItem>
                    <SelectItem value="KZ">Kazakhstan (KZ)</SelectItem>
                    <SelectItem value="KE">Kenya (KE)</SelectItem>
                    <SelectItem value="KI">Kiribati (KI)</SelectItem>
                    <SelectItem value="KP">Korea, North (KP)</SelectItem>
                    <SelectItem value="KR">Korea, South (KR)</SelectItem>
                    <SelectItem value="KW">Kuwait (KW)</SelectItem>
                    <SelectItem value="KG">Kyrgyzstan (KG)</SelectItem>
                    <SelectItem value="LA">Laos (LA)</SelectItem>
                    <SelectItem value="LV">Latvia (LV)</SelectItem>
                    <SelectItem value="LB">Lebanon (LB)</SelectItem>
                    <SelectItem value="LS">Lesotho (LS)</SelectItem>
                    <SelectItem value="LR">Liberia (LR)</SelectItem>
                    <SelectItem value="LY">Libya (LY)</SelectItem>
                    <SelectItem value="LI">Liechtenstein (LI)</SelectItem>
                    <SelectItem value="LT">Lithuania (LT)</SelectItem>
                    <SelectItem value="LU">Luxembourg (LU)</SelectItem>
                    <SelectItem value="MG">Madagascar (MG)</SelectItem>
                    <SelectItem value="MW">Malawi (MW)</SelectItem>
                    <SelectItem value="MY">Malaysia (MY)</SelectItem>
                    <SelectItem value="MV">Maldives (MV)</SelectItem>
                    <SelectItem value="ML">Mali (ML)</SelectItem>
                    <SelectItem value="MT">Malta (MT)</SelectItem>
                    <SelectItem value="MH">Marshall Islands (MH)</SelectItem>
                    <SelectItem value="MR">Mauritania (MR)</SelectItem>
                    <SelectItem value="MU">Mauritius (MU)</SelectItem>
                    <SelectItem value="MX">Mexico (MX)</SelectItem>
                    <SelectItem value="FM">Micronesia (FM)</SelectItem>
                    <SelectItem value="MD">Moldova (MD)</SelectItem>
                    <SelectItem value="MC">Monaco (MC)</SelectItem>
                    <SelectItem value="MN">Mongolia (MN)</SelectItem>
                    <SelectItem value="ME">Montenegro (ME)</SelectItem>
                    <SelectItem value="MA">Morocco (MA)</SelectItem>
                    <SelectItem value="MZ">Mozambique (MZ)</SelectItem>
                    <SelectItem value="MM">Myanmar (MM)</SelectItem>
                    <SelectItem value="NA">Namibia (NA)</SelectItem>
                    <SelectItem value="NR">Nauru (NR)</SelectItem>
                    <SelectItem value="NP">Nepal (NP)</SelectItem>
                    <SelectItem value="NL">Netherlands (NL)</SelectItem>
                    <SelectItem value="NZ">New Zealand (NZ)</SelectItem>
                    <SelectItem value="NI">Nicaragua (NI)</SelectItem>
                    <SelectItem value="NE">Niger (NE)</SelectItem>
                    <SelectItem value="NG">Nigeria (NG)</SelectItem>
                    <SelectItem value="MK">North Macedonia (MK)</SelectItem>
                    <SelectItem value="NO">Norway (NO)</SelectItem>
                    <SelectItem value="OM">Oman (OM)</SelectItem>
                    <SelectItem value="PK">Pakistan (PK)</SelectItem>
                    <SelectItem value="PW">Palau (PW)</SelectItem>
                    <SelectItem value="PA">Panama (PA)</SelectItem>
                    <SelectItem value="PG">Papua New Guinea (PG)</SelectItem>
                    <SelectItem value="PY">Paraguay (PY)</SelectItem>
                    <SelectItem value="PE">Peru (PE)</SelectItem>
                    <SelectItem value="PH">Philippines (PH)</SelectItem>
                    <SelectItem value="PL">Poland (PL)</SelectItem>
                    <SelectItem value="pt">{tt("settings.language.pt", "Portuguese")}</SelectItem>
                    <SelectItem value="QA">Qatar (QA)</SelectItem>
                    <SelectItem value="RO">Romania (RO)</SelectItem>
                    <SelectItem value="RU">Russia (RU)</SelectItem>
                    <SelectItem value="RW">Rwanda (RW)</SelectItem>
                    <SelectItem value="KN">Saint Kitts and Nevis (KN)</SelectItem>
                    <SelectItem value="LC">Saint Lucia (LC)</SelectItem>
                    <SelectItem value="VC">Saint Vincent and the Grenadines (VC)</SelectItem>
                    <SelectItem value="WS">Samoa (WS)</SelectItem>
                    <SelectItem value="SM">San Marino (SM)</SelectItem>
                    <SelectItem value="ST">Sao Tome and Principe (ST)</SelectItem>
                    <SelectItem value="SA">Saudi Arabia (SA)</SelectItem>
                    <SelectItem value="SN">Senegal (SN)</SelectItem>
                    <SelectItem value="RS">Serbia (RS)</SelectItem>
                    <SelectItem value="SC">Seychelles (SC)</SelectItem>
                    <SelectItem value="SL">Sierra Leone (SL)</SelectItem>
                    <SelectItem value="SG">Singapore (SG)</SelectItem>
                    <SelectItem value="SK">Slovakia (SK)</SelectItem>
                    <SelectItem value="SI">Slovenia (SI)</SelectItem>
                    <SelectItem value="SB">Solomon Islands (SB)</SelectItem>
                    <SelectItem value="SO">Somalia (SO)</SelectItem>
                    <SelectItem value="ZA">South Africa (ZA)</SelectItem>
                    <SelectItem value="SS">South Sudan (SS)</SelectItem>
                    <SelectItem value="ES">Spain (ES)</SelectItem>
                    <SelectItem value="LK">Sri Lanka (LK)</SelectItem>
                    <SelectItem value="SD">Sudan (SD)</SelectItem>
                    <SelectItem value="SR">Suriname (SR)</SelectItem>
                    <SelectItem value="SE">Sweden (SE)</SelectItem>
                    <SelectItem value="CH">Switzerland (CH)</SelectItem>
                    <SelectItem value="SY">Syria (SY)</SelectItem>
                    <SelectItem value="TJ">Tajikistan (TJ)</SelectItem>
                    <SelectItem value="TZ">Tanzania (TZ)</SelectItem>
                    <SelectItem value="TH">Thailand (TH)</SelectItem>
                    <SelectItem value="TG">Togo (TG)</SelectItem>
                    <SelectItem value="TO">Tonga (TO)</SelectItem>
                    <SelectItem value="TT">Trinidad and Tobago (TT)</SelectItem>
                    <SelectItem value="TN">Tunisia (TN)</SelectItem>
                    <SelectItem value="TR">Turkey (TR)</SelectItem>
                    <SelectItem value="TM">Turkmenistan (TM)</SelectItem>
                    <SelectItem value="TV">Tuvalu (TV)</SelectItem>
                    <SelectItem value="UG">Uganda (UG)</SelectItem>
                    <SelectItem value="UA">Ukraine (UA)</SelectItem>
                    <SelectItem value="AE">United Arab Emirates (AE)</SelectItem>
                    <SelectItem value="GB">United Kingdom (GB)</SelectItem>
                    <SelectItem value="US">United States (US)</SelectItem>
                    <SelectItem value="UY">Uruguay (UY)</SelectItem>
                    <SelectItem value="UZ">Uzbekistan (UZ)</SelectItem>
                    <SelectItem value="VU">Vanuatu (VU)</SelectItem>
                    <SelectItem value="VA">Vatican City (VA)</SelectItem>
                    <SelectItem value="VE">Venezuela (VE)</SelectItem>
                    <SelectItem value="VN">Vietnam (VN)</SelectItem>
                    <SelectItem value="YE">Yemen (YE)</SelectItem>
                    <SelectItem value="ZM">Zambia (ZM)</SelectItem>
                    <SelectItem value="ZW">Zimbabwe (ZW)</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Preferred Language Selector */}
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2 md:col-span-4">
              <Label>{t("settings.companyProfile.preferredLang")}</Label>
              <Select
                value={profile?.preferred_lang ?? "auto"}
                onValueChange={(v) => setProfileField("preferred_lang", v === "auto" ? null : v as "en" | "pt")}
                disabled={!canEditOps}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("settings.companyProfile.preferredLang.auto")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t("settings.companyProfile.preferredLang.auto")}</SelectItem>
                  <SelectItem value="en">{tt("settings.language.en", "English")}</SelectItem>
                  <SelectItem value="pt">{tt("settings.language.pt", "Portuguese")}</SelectItem>
                </SelectContent>
              </Select>
              <div className="hidden text-xs text-muted-foreground sm:block">
                {t("settings.companyProfile.preferredLang.helper")}
              </div>
            </div>
          </div>

          {/* Logo (write settings.brand.logoUrl for immediate prints; also try to store logo_path) */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.logo")}</Label>
              <LogoUploader
                value={data.documents.brand.logoUrl}
                onChange={(url) => {
                  setField("documents.brand.logoUrl", url);
                  const p = pathFromPublicUrl(url);
                  if (p) setProfileField("logo_path", p);
                }}
                companyId={companyId}
                disabled={!canEditOps}
              />
              <div className="hidden text-xs text-muted-foreground sm:block">
                {t("settings.companyProfile.logo.helper")}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">
                {t("settings.companyProfile.logoPath")}
              </Label>
              <Input
                value={profile?.logo_path ?? ""}
                onChange={(e) => setProfileField("logo_path", e.target.value)}
                disabled={!canEditOps}
                placeholder={t("settings.companyProfile.logoPath.placeholder")}
              />
              <div className="hidden text-[11px] text-muted-foreground sm:block">
                {t("settings.companyProfile.logoPath.helper")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>


    </>
  )
}
