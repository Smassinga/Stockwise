async (page) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('http://127.0.0.1:4173/accept-invite?token=b6166b0c-a8c0-4c1c-89ef-1b224f433455')
  await page.getByRole('button', { name: 'Go to sign-in' }).waitFor({ timeout: 15000 })
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/14-callback-needs-auth-desktop.png', fullPage: true })
  const beforeText = await page.locator('body').innerText()
  await page.goto('http://127.0.0.1:4173/auth/callback#access_token=eyJhbGciOiJIUzI1NiIsImtpZCI6InB5dUNZaXZoYUNEOEZpdHMiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL29nemh3b3FxdW1rdXFoYnZ1enpwLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI3YWI0ZGZkOC1jMmUyLTQwMmYtODc3Mi0xZTMwMDM4MDRiMzAiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzc3NDE4MDIyLCJpYXQiOjE3Nzc0MTQ0MjIsImVtYWlsIjoidWltb2o1c3B2eS5jYWxsYmFjay5hNzU5NDJmYUBzdG9ja3dpc2UubG9jYWwiLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoidWltb2o1c3B2eS1jYWxsYmFjayJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6InBhc3N3b3JkIiwidGltZXN0YW1wIjoxNzc3NDE0NDIyfV0sInNlc3Npb25faWQiOiIyNmQzMTc1NC0yM2I5LTQ4NjYtYmI5Ni1mYTQ3OGVlYjNkNzgiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.wddEL_Y--jfQ0_uC6eXjagxZQNY1pgLd1W97rFiCUCE&refresh_token=hxloniibn7zd')
  await page.waitForURL('**/dashboard', { timeout: 20000 })
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: 'C:/Dev/Stockwise/output/playwright/15-callback-dashboard-desktop.png', fullPage: true })
  return {
    beforeNeedsAuth: beforeText.includes('Sign in or create an account with the invited email address to continue.'),
    url: page.url(),
    dashboardVisible: (await page.locator('body').innerText()).includes('Dashboard'),
    storageKeys: await page.evaluate(() => ({
      local: Object.fromEntries(Object.keys(localStorage).filter((key) => key.startsWith('sw:lastCompanyId')).map((key) => [key, localStorage.getItem(key)])),
      inviteToken: sessionStorage.getItem('sw:inviteToken'),
    })),
  }
}
