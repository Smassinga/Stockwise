async (page) => {
  const fillByLabel = async (label, value) => {
    const input = page.getByText(label, { exact: true }).locator('xpath=..').getByRole('textbox')
    await input.fill(value)
  }

  await fillByLabel('Tax ID', '400123456')
  await fillByLabel('Address1', 'Avenida de Teste 100')
  await fillByLabel('City', 'Maputo')
  await page.getByRole('button', { name: 'Save company' }).click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/03c-clean-settings-corrected-desktop.png', fullPage: true })
  const bodyText = await page.locator('body').innerText()
  return {
    taxId: await page.getByText('Tax ID', { exact: true }).locator('xpath=..').getByRole('textbox').inputValue(),
    address1: await page.getByText('Address1', { exact: true }).locator('xpath=..').getByRole('textbox').inputValue(),
    city: await page.getByText('City', { exact: true }).locator('xpath=..').getByRole('textbox').inputValue(),
    bodyHasSavedToast: bodyText.includes('Company profile saved'),
    bodyHasProfileName: bodyText.includes('UI Clean Legal, Lda'),
  }
}
