async (page) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('http://127.0.0.1:4173/login')
  await page.locator('#email').fill('uimoj5spvy.createchoice.ce3c366e@stockwise.local')
  await page.locator('#password').fill('Sw!ce3c366eAa11')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/onboarding', { timeout: 20000 })
  const initialUrl = page.url()
  await page.goto('http://127.0.0.1:4173/dashboard')
  await page.waitForURL('**/onboarding', { timeout: 20000 })
  await page.getByText('Choose how you want to start').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: 'Join invited company' }).click()
  await page.getByText('Pending invitations', { exact: true }).waitFor({ timeout: 10000 })
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/06-create-choice-mobile-join.png', fullPage: true })
  await page.getByRole('button', { name: 'Create new company' }).click()
  await page.getByText('Create a company').waitFor({ timeout: 10000 })
  const createText = await page.locator('body').innerText()
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/07-create-choice-mobile-create.png', fullPage: true })
  await page.locator('#companyName').fill('UI Create Choice Co')
  await page.getByRole('button', { name: 'Create company' }).click()
  await page.getByText('Your workspace is ready').waitFor({ timeout: 20000 })
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/08-create-choice-mobile-ready.png', fullPage: true })
  await page.getByRole('button', { name: 'Continue to dashboard' }).click()
  await page.waitForURL('**/dashboard', { timeout: 20000 })
  const beforeKeys = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((key) => key.startsWith('sw:lastCompanyId')).map((key) => [key, localStorage.getItem(key)])))
  await page.evaluate((ownerCompanyId) => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sw:lastCompanyId')) {
        localStorage.setItem(key, ownerCompanyId)
      }
    }
  }, 'a70d2664-8f90-4c44-bdeb-fab051f92f3f')
  await page.reload()
  await page.waitForURL('**/dashboard', { timeout: 20000 })
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/09-create-choice-mobile-dashboard-reload.png', fullPage: true })
  const afterKeys = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((key) => key.startsWith('sw:lastCompanyId')).map((key) => [key, localStorage.getItem(key)])))
  return {
    initialUrl,
    redirectedFromDashboard: page.url().includes('/dashboard'),
    createGuidanceVisible: createText.includes('Complete the full profile later'),
    createHintVisible: createText.includes('Settings covers legal identity, address, contacts, logo, bank details, tax details, and other advanced company setup.'),
    beforeKeys,
    afterKeys,
  }
}
