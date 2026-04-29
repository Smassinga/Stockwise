async (page) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('http://127.0.0.1:4173/login')
  await page.locator('#email').fill('uimoj5spvy.freshinvite.59878965@stockwise.local')
  await page.locator('#password').fill('Sw!59878965Aa11')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/onboarding', { timeout: 20000 })
  await page.getByText('Choose how you want to start').waitFor({ timeout: 10000 })
  await page.getByText('uimoj5spvy Owner Company').waitFor({ timeout: 10000 })
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/04-invite-choice-desktop.png', fullPage: true })
  const beforeText = await page.locator('body').innerText()
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await page.getByText('Invitation accepted. Entering').waitFor({ timeout: 10000 })
  await page.waitForURL('**/dashboard', { timeout: 20000 })
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/05-invite-accepted-dashboard-desktop.png', fullPage: true })
  return {
    url: page.url(),
    choiceVisible: beforeText.includes('Choose how you want to start'),
    progressVisible: beforeText.includes('Onboarding progress'),
    joinCardVisible: beforeText.includes('Join invited company'),
    createCardVisible: beforeText.includes('Create new company'),
    companyVisible: beforeText.includes('uimoj5spvy Owner Company'),
    roleVisible: beforeText.includes('Manager'),
    expiryVisible: beforeText.includes('Expires on'),
    dashboardVisible: (await page.locator('body').innerText()).includes('Dashboard'),
    storageKeys: await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((key) => key.startsWith('sw:lastCompanyId')).map((key) => [key, localStorage.getItem(key)]))),
  }
}
