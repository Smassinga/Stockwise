async (page) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('http://127.0.0.1:4173/accept-invite?token=84040ed9-fa28-4696-805d-f2922d9000f8')
  await page.getByText('This invite belongs to another email address.').waitFor({ timeout: 15000 })
  const bodyText = await page.locator('body').innerText()
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/13-wrong-account-invite-desktop.png', fullPage: true })
  return {
    url: page.url(),
    wrongAccountVisible: bodyText.includes('This invite belongs to another email address.'),
    switchAccountVisible: bodyText.includes('Use a different account'),
    invalidVisible: bodyText.includes('This invitation is no longer available.'),
  }
}
