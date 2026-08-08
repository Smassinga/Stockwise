import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('account creation keeps phone in Profile instead of signup', async () => {
  const auth = await read('src/pages/Auth.tsx')
  assert.doesNotMatch(auth, /id="phone"/)
  assert.match(auth, /register\(name, email, formData\.password\)/)
})

test('onboarding uses named steps and supported next actions without fake percentages', async () => {
  const onboarding = await read('src/pages/Onboarding.tsx')
  assert.doesNotMatch(onboarding, /progressValue|<Progress/)
  assert.match(onboarding, /Account confirmed/)
  assert.match(onboarding, /\/items\?view=create/)
  assert.match(onboarding, /\/setup\/import\?dataset=opening_stock/)
  assert.match(onboarding, /\/settings\?view=setup/)
})

test('Profile exposes one truthful secure email-link password action', async () => {
  const profile = await read('src/pages/Profile.tsx')
  assert.doesNotMatch(profile, /currentPassword|newPassword|confirmPassword|resetPasswordForEmail/)
  assert.match(profile, /requestPasswordReset\(user\.email\)/)
  assert.match(profile, /useOrg\(\)/)
})

test('public auth shell stays free of decorative feature-card treatment', async () => {
  const shell = await read('src/components/auth/PublicAuthShell.tsx')
  assert.doesNotMatch(shell, /bg-gradient|highlights|hover:-translate|shadow-xl/)
  assert.match(shell, /<main/)
})

test('obvious auth, onboarding and Profile subheaders are not rendered', async () => {
  const [auth, onboarding, profile] = await Promise.all([
    read('src/pages/Auth.tsx'),
    read('src/pages/Onboarding.tsx'),
    read('src/pages/Profile.tsx'),
  ])
  assert.doesNotMatch(auth, /Secure account access|Acesso seguro à conta|Use your account email and password/)
  assert.doesNotMatch(onboarding, /Company workspace setup|Configuração do workspace da empresa/)
  assert.doesNotMatch(profile, /Keep your identity and contact details accurate|Mantenha a identidade e os contactos corretos/)
  assert.doesNotMatch(profile, /These controls affect how StockWise is displayed|Estes controlos alteram a forma/)
})
