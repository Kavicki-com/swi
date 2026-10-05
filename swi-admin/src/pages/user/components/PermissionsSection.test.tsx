import { vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import type { BrowserNoticesView } from '@/hooks/useBrowserNotices'

const h = vi.hoisted(() => ({ view: null as unknown }))
vi.mock('@/hooks/useBrowserNotices', () => ({ useBrowserNotices: () => h.view }))

import { PermissionsSection } from './PermissionsSection'

const withNotices = (over: Partial<BrowserNoticesView>) => {
  const view: BrowserNoticesView = {
    support: 'default',
    enabled: false,
    declined: false,
    request: vi.fn(async () => 'granted' as const),
    disable: vi.fn(),
    ...over,
  }
  h.view = view
  return view
}

// O react-native-web daqui não emite aria-checked: o estado do toggle aparece
// pelo que o clique faz (desligado pede a permissão, ligado desliga).
const toggle = () => screen.getByRole('switch', { name: 'Notificações' })

afterEach(() => clearSession())

describe('PermissionsSection: Notificações', () => {
  it('desligado, ligar pede a permissão ao navegador', async () => {
    const view = withNotices({ support: 'default', enabled: false })
    await renderPage(<PermissionsSection />)
    fireEvent.click(toggle())
    expect(view.request).toHaveBeenCalledTimes(1)
  })

  it('ligado, desligar guarda a escolha', async () => {
    const view = withNotices({ support: 'granted', enabled: true })
    await renderPage(<PermissionsSection />)
    fireEvent.click(toggle())
    expect(view.disable).toHaveBeenCalledTimes(1)
  })

  it('bloqueado no navegador, explica onde liberar e não deixa ligar', async () => {
    const view = withNotices({ support: 'denied' })
    await renderPage(<PermissionsSection />)
    expect(
      screen.getByText(
        'O navegador está bloqueando os avisos do SWI. Libere nas configurações do navegador.',
      ),
    ).toBeTruthy()
    expect(toggle().getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(toggle())
    expect(view.request).not.toHaveBeenCalled()
  })

  it('navegador sem suporte avisa e não deixa ligar', async () => {
    withNotices({ support: 'unsupported' })
    await renderPage(<PermissionsSection />)
    expect(screen.getByText('Este navegador não mostra avisos do SWI.')).toBeTruthy()
    expect(toggle().getAttribute('aria-disabled')).toBe('true')
  })

  it('as outras três permissões seguem na seção', async () => {
    withNotices({})
    await renderPage(<PermissionsSection />)
    expect(screen.getByText('Localização')).toBeTruthy()
    expect(screen.getByText('Acessar pastas e arquivos')).toBeTruthy()
    expect(screen.getByText('Ligações telefônicas')).toBeTruthy()
  })
})
