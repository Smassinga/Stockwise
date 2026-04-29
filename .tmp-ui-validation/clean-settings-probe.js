async (page) => {
  await page.waitForTimeout(1500)
  return {
    body: (await page.locator('body').innerText()).slice(0, 1200),
    legalName: await page.getByRole('textbox').nth(2).inputValue(),
    taxId: await page.getByRole('textbox').nth(4).inputValue(),
    address1: await page.getByRole('textbox').nth(8).inputValue(),
    city: await page.getByRole('textbox').nth(10).inputValue(),
  }
}
