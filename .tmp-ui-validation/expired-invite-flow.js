async (page) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('http://127.0.0.1:4173/login')
  await page.locator('#email').fill('uimoj5spvy.expired.50e8910c@stockwise.local')
  await page.locator('#password').fill('Sw!50e8910cAa11')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/onboarding', { timeout: 20000 })
  await page.goto('http://127.0.0.1:4173/accept-invite?token=61b7b699-b75b-441a-a32e-0a0501a7793a')
  await page.getByText('This invitation is no longer available.').waitFor({ timeout: 15000 })
  const bodyText = await page.locator('body').innerText()
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/12-expired-invite-desktop.png', fullPage: true })
  return {
    url: page.url(),
    invalidTitleVisible: bodyText.includes('This invitation is no longer available.'),
    retryVisible: bodyText.includes('Retry invitation'),
    wrongAccountVisible: bodyText.includes('This invite belongs to another email address.'),
  }
}
