async (page) => {
  await page.getByText('Company profile saved').waitFor({ timeout: 10000 })
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/03b-clean-settings-saved-desktop.png', fullPage: true })
  return {
    toastVisible: await page.getByText('Company profile saved').isVisible(),
    legalName: await page.getByRole('textbox').nth(2).inputValue(),
    address1: await page.getByRole('textbox').nth(8).inputValue(),
    city: await page.getByRole('textbox').nth(10).inputValue(),
  }
}
