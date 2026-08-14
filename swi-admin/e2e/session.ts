import { expect, type Page } from '@playwright/test'

// Entrada compartilhada pelas suítes de navegador do painel.
//
// As credenciais e os nomes vêm do seed de E2E (scripts/e2e/seed-e2e.mjs), que
// existe só nesta stack descartável. Nenhum dado real de cliente entra aqui.
// Ficam num arquivo só de propósito: espalhados por spec, o dia em que o seed
// mudar deixa metade das suítes vermelhas por um motivo que não é o que elas
// afirmam.
//
// Não é um spec: o `testMatch` padrão do Playwright só coleta `*.spec.ts` e
// `*.test.ts`, então este arquivo é importado, nunca executado como suíte.

export const ADMIN = { email: 'admin-e2e@teste.local', password: 'e2e-admin-pass' }

/** Nome do trabalhador do seed, usado como alvo de tarefa e de conversa. */
export const WORKER_NOME = 'Worker E2E'

export const entrar = async (page: Page, credenciais = ADMIN) => {
  await page.goto('/login')
  await page.getByLabel('Login', { exact: true }).fill(credenciais.email)
  await page.getByLabel('Senha', { exact: true }).fill(credenciais.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

/**
 * Entra e espera o painel abrir.
 *
 * Sair do /login já é a prova de que o backend aceitou: o guard só libera com
 * sessão. O prazo é generoso porque a primeira chamada sobe o pool do Prisma
 * no servidor.
 */
export const entrarNoPainel = async (page: Page) => {
  await entrar(page)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}
