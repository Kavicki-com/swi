// O painel e o aplicativo podem estar lendo de backends diferentes: o stack
// local que o pacote sobe e a API pública. Quando isso acontece, um não mostra
// o dado do outro, e a leitura natural de quem está olhando é que o sistema
// quebrou. O selo existe para que a pergunta "de onde vem este dado" tenha
// resposta na própria tela.
import { vi } from 'vitest'
import { screen } from '@testing-library/react'
import { ApiTargetBadge } from './ApiTargetBadge'
import { renderPage } from '@/test-utils/renderPage'

const h = vi.hoisted(() => ({ url: 'http://localhost:3000' }))
vi.mock('@/services/api/apiConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/apiConfig')>()
  return { ...actual, getApiUrl: () => h.url }
})

describe('ApiTargetBadge', () => {
  it('diz que o ambiente é local quando a API roda na própria máquina', async () => {
    h.url = 'http://localhost:3000'
    await renderPage(<ApiTargetBadge />, { route: '/' })
    expect(screen.getByText('Ambiente local')).toBeTruthy()
  })

  it('nomeia o host quando a API é a pública, que é o que distingue os ambientes', async () => {
    h.url = 'https://api.kavicki.com'
    await renderPage(<ApiTargetBadge />, { route: '/' })
    expect(screen.getByText('api.kavicki.com')).toBeTruthy()
  })

  it('descreve o alvo para leitor de tela, e não só visualmente', async () => {
    h.url = 'https://api.kavicki.com'
    await renderPage(<ApiTargetBadge />, { route: '/' })
    expect(screen.getByLabelText(/api\.kavicki\.com/)).toBeTruthy()
  })
})
