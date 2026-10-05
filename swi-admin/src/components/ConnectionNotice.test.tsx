import { screen } from '@testing-library/react'
import { renderPage } from '@/test-utils/renderPage'
import { ConnectionNotice } from './ConnectionNotice'

const h = vi.hoisted(() => ({ lost: false }))
vi.mock('@/hooks/useConnectionLost', () => ({ useConnectionLost: () => h.lost }))

describe('ConnectionNotice', () => {
  it('com a conexão de pé não mostra nada', async () => {
    h.lost = false
    await renderPage(<ConnectionNotice />, { route: '/' })
    expect(screen.queryByTestId('connection-notice')).toBeNull()
  })

  it('sem conexão avisa que os dados podem estar desatualizados', async () => {
    h.lost = true
    await renderPage(<ConnectionNotice />, { route: '/' })
    expect(screen.getByTestId('connection-notice')).toBeTruthy()
    expect(screen.getByText('Sem conexão com o servidor.')).toBeTruthy()
    expect(
      screen.getByText('Os dados na tela podem estar desatualizados. Tentando reconectar.'),
    ).toBeTruthy()
  })

  it('o aviso fica enquanto durar a queda: não tem botão de fechar', async () => {
    h.lost = true
    await renderPage(<ConnectionNotice />, { route: '/' })
    expect(screen.queryByRole('button', { name: 'Fechar' })).toBeNull()
  })
})
