async (page) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('http://127.0.0.1:4173/login')
  await page.locator('#email').fill('uimoj5spvy.owner.0c0e0717@stockwise.local')
  await page.locator('#password').fill('Sw!0c0e0717Aa11')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 20000 })
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/10-owner-dashboard-desktop.png', fullPage: true })
  return {
    url: page.url(),
    dashboardVisible: (await page.locator('body').innerText()).includes('Dashboard'),
    onboardingVisible: (await page.locator('body').innerText()).includes('Choose how you want to start'),
  }
}
