import { screen } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { GlobalNotices, NOTICES_TOP } from './GlobalNotices'

vi.mock('./ConnectionNotice', () => ({
  ConnectionNotice: () => <div data-testid="connection-mark" />,
}))
vi.mock('./UrgentAlertNotice', () => ({
  UrgentAlertNotice: () => <div data-testid="urgent-mark" />,
}))

afterEach(() => clearSession())

describe('GlobalNotices', () => {
  it('empilha o aviso de conexão em cima do de alerta, fixos no topo', async () => {
    await renderPage(<GlobalNotices />)
    const column = screen.getByTestId('global-notices')
    expect(column.style.position).toBe('fixed')
    const marks = [...column.querySelectorAll('[data-testid$="-mark"]')].map((el) =>
      el.getAttribute('data-testid'),
    )
    expect(marks).toEqual(['connection-mark', 'urgent-mark'])
  })

  // Abaixo do cabeçalho: o aviso de alerta é largo e, no alto da tela, cobriria
  // o sino e o avatar.
  it('fica abaixo do cabeçalho, para não cobrir o sino', async () => {
    await renderPage(<GlobalNotices />)
    expect(screen.getByTestId('global-notices').style.top).toBe(`${NOTICES_TOP}px`)
    expect(NOTICES_TOP).toBeGreaterThanOrEqual(96)
  })

  // A coluna cobre o topo da tela: só o aviso de alerta, que tem botões,
  // recebe clique; o resto passa para a tela de baixo.
  it('só o aviso de alerta recebe clique', async () => {
    await renderPage(<GlobalNotices />)
    expect(screen.getByTestId('global-notices').style.pointerEvents).toBe('none')
    expect(screen.getByTestId('urgent-mark').parentElement!.style.pointerEvents).toBe('auto')
  })
})
