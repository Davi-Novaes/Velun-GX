import { expect, test } from '@playwright/test'
import { closeBrowsers, person } from './support'

test.afterEach(closeBrowsers)

test('cadastro, persistência da conta, login e logout com API e PostgreSQL reais', async ({ baseURL }) => {
  const user = await person('Conta', 'chromium', baseURL!)
  const username = `teste_${Date.now()}`
  const password = 'senha-de-teste-segura-2026'
  await user.page.goto('/register')
  await user.page.getByLabel('Nome de usuário').fill(username)
  await user.page.getByLabel('Senha', { exact: true }).fill(password)
  await user.page.getByLabel('Confirmar senha').fill(password)
  await user.page.getByRole('button', { name: 'Criar conta' }).click()
  await expect(user.page.locator('.user-panel')).toContainText(username)
  await user.page.goto('/account')
  await user.page.reload()
  await expect(user.page.locator('.account-identity')).toContainText(username)
  const state = await user.context.storageState()
  expect(state.cookies.some((c) => c.name === 'ss_account' && c.httpOnly && c.expires > Date.now() / 1000)).toBe(true)
  const second = await person('Nova sessão', 'chromium', baseURL!)
  await second.context.addCookies(state.cookies)
  await second.page.goto('/account')
  await expect(second.page.getByText('Conta conectada')).toBeVisible()
  await second.page.getByRole('button', { name: 'Sair da conta' }).click()
  await expect(second.page.getByRole('heading', { name: 'Entrar na conta' })).toBeVisible()
  await user.page.reload()
  await expect(user.page.getByRole('heading', { name: 'Entrar na conta' })).toBeVisible()
  await user.page.screenshot({ path: 'ui-account-desktop.png' })
  await user.page.setViewportSize({ width: 390, height: 844 })
  await user.page.screenshot({ path: 'ui-account-mobile.png', fullPage: true })
  await user.page.getByLabel('Nome de usuário').fill(username)
  await user.page.getByLabel('Senha', { exact: true }).fill(password)
  await user.page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(user.page.locator('.user-panel')).toContainText(username)
  await user.page.goto('/account')
  // Nova conta não substitui o cookie de convidado da transmissão legada.
  await user.page.getByRole('link', { name: 'Abrir salas de transmissão' }).click()
  await user.page.getByRole('button', { name: 'Criar sala' }).click()
  await expect(user.page.getByLabel('Link da sala')).toBeVisible()
})
