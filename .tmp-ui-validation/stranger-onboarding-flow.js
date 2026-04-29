async (page) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('http://127.0.0.1:4173/login')
  await page.locator('#email').fill('uimoj5spvy.stranger.680e9c83@stockwise.local')
  await page.locator('#password').fill('Sw!680e9c83Aa11')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/onboarding', { timeout: 20000 })
  await page.getByText('Create your first company').waitFor({ timeout: 10000 })
  const bodyText = await page.locator('body').innerText()
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/11-stranger-onboarding-desktop.png', fullPage: true })
  return {
    url: page.url(),
    noInvitesTitle: bodyText.includes('Create your first company'),
    choiceTitleVisible: bodyText.includes('Choose how you want to start'),
    inviteCompanyVisible: bodyText.includes('uimoj5spvy Owner Company'),
  }
}
