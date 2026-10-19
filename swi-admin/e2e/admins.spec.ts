import { expect, test } from '@playwright/test'
import { entrarNoPainel } from './session'

// A tela de Administradores é a única que carrega com o esqueleto animado do
// design system. Parar essa animação passa pelo Animated do react-native-web,
// que chama `global.cancelAnimationFrame`, e `global` não existe no navegador.
// Em 2026-10-19 a tela abriu preta em produção por isso, e nenhum teste cobria
// a rota: os testes de componente rodam no jsdom, onde o Vitest define
// `global`, então o erro só aparece no artefato que o cliente abre. Este spec
// roda contra o BUILD servido pelo preview, que é onde ele se reproduz.

test('a lista de administradores sai do esqueleto e mostra os dados sem erro', async ({ page }) => {
  const erros: string[] = []
  page.on('pageerror', (erro) => erros.push(erro.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text())
  })

  await entrarNoPainel(page)
  await page.goto('/admins')

  // O título com a contagem só existe com a lista carregada, ou seja, depois
  // que o esqueleto saiu da tela e a animação dele foi parada.
  await expect(page.getByText(/Você tem \(\d+\) administrador/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('admins-page')).toBeVisible()

  expect(erros, `erros: ${erros.join(' | ')}`).toEqual([])
})
