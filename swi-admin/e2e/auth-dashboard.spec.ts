import { expect, test, type Page } from '@playwright/test'

// Fluxo de entrada do painel contra backend e banco de TESTE reais. O que este
// arquivo cobre é justamente o que os 89 testes de componente não alcançam: a
// sessão de verdade, a requisição de verdade e a navegação de verdade.
//
// As credenciais vêm do seed de E2E (scripts/e2e/seed-e2e.mjs), que existe só
// nesta stack descartável. Nenhum dado real de cliente entra aqui.

const ADMIN = { email: 'admin-e2e@teste.local', password: 'e2e-admin-pass' }

const entrar = async (page: Page, credenciais = ADMIN) => {
  await page.goto('/login')
  await page.getByLabel('Login', { exact: true }).fill(credenciais.email)
  await page.getByLabel('Senha', { exact: true }).fill(credenciais.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

test('a raiz protegida manda pro login quem não tem sessão', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('login com as credenciais certas abre o painel', async ({ page }) => {
  await entrar(page)

  // Sair do /login já é a prova de que o backend aceitou: o guard só libera
  // com sessão. O timeout é generoso porque a primeira chamada sobe o pool do
  // Prisma no servidor.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
})

test('senha errada não cria sessão e mantém a pessoa no login', async ({ page }) => {
  await entrar(page, { ...ADMIN, password: 'senha-que-nao-e-a-dele' })

  await expect(page).toHaveURL(/\/login/)

  // O guard é prova mais forte que a mensagem na tela: sem sessão, tentar a
  // raiz volta pro login. Uma tela que só escondesse o erro passaria no
  // primeiro assert e falharia neste.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('a sessão sobrevive ao refresh', async ({ page }) => {
  await entrar(page)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

  await page.reload()

  // Sessão que só vive em memória devolveria a pessoa ao login aqui, e o painel
  // ficaria inutilizável a cada F5.
  await expect(page).not.toHaveURL(/\/login/)
})

test('o painel carrega sem erro de console nem resposta 5xx', async ({ page }) => {
  const erros: string[] = []
  const falhas: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text())
  })
  page.on('response', (res) => {
    // 401 antes do login é esperado; o que não pode é o servidor quebrar.
    if (res.status() >= 500) falhas.push(`${res.status()} ${res.url()}`)
  })

  await entrar(page)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')

  expect(falhas, `respostas 5xx: ${falhas.join(', ')}`).toEqual([])
  expect(erros, `erros de console: ${erros.join(' | ')}`).toEqual([])
})
