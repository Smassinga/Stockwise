import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

async function fixture() {
  const path = process.env.E2E_FIXTURE_PATH
  if (!path) throw new Error('E2E_FIXTURE_PATH is required')
  return JSON.parse(await readFile(path, 'utf8')) as {
    email: string
    password: string
    companyId: string
    companyName: string
  }
}

test('authenticated owner reaches responsive Dashboard and Items', async ({ page }) => {
  const qa = await fixture()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(qa.email)
  await page.getByRole('textbox', { name: /password|palavra-passe/i }).fill(qa.password)
  await page.getByRole('button', { name: /sign in|iniciar sessão/i }).click()

  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { level: 1, name: /dashboard/i })).toBeVisible()
  await expect(page.getByText(qa.companyName, { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('region', { name: /dashboard scope|âmbito do painel|escopo do painel/i })).toBeVisible()
  await expect(page.getByText(/start with operating records|needs attention|comece pelos registos operacionais|atenção necessária/i).first()).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { level: 1, name: /dashboard/i })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  await page.goto('/items')
  await expect(page).toHaveURL(/\/items(?:\?|$)/)
  await expect(page.getByRole('heading', { level: 1, name: /items|itens/i })).toBeVisible()

  expect(pageErrors, `Unexpected browser page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
