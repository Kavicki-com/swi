import { vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import type { BrowserNoticesView } from '@/hooks/useBrowserNotices'

const h = vi.hoisted(() => ({ view: null as unknown }))
vi.mock('@/hooks/useBrowserNotices', () => ({ useBrowserNotices: () => h.view }))

import { authApi } from '@/services/auth'
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

beforeEach(() => {
  vi.spyOn(authApi, 'me').mockResolvedValue({ data: { role: 'ADMIN', permissions: [] }, error: null })
})
afterEach(() => {
  clearSession()
  vi.restoreAllMocks()
})

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
})

// O nível e o que ele permite vêm do backend (GET /auth/me), não de uma cópia
// da matriz no painel.
describe('PermissionsSection: nível de acesso', () => {
  it('mostra o nível e as permissões que o backend devolve', async () => {
    withNotices({})
    vi.spyOn(authApi, 'me').mockResolvedValue({
      data: { role: 'SUPERVISOR', permissions: ['monitoring.read', 'alerts.operate'] },
      error: null,
    })
    await renderPage(<PermissionsSection />)

    expect(await screen.findByText('Nível: Supervisor')).toBeTruthy()
    expect(screen.getByText('Acompanhar o monitoramento e a transmissão ao vivo')).toBeTruthy()
    expect(screen.getByText('Tratar alertas e pedir pausa')).toBeTruthy()
  })

  it('falha ao ler avisa, sem lista inventada', async () => {
    withNotices({})
    vi.spyOn(authApi, 'me').mockResolvedValue({ data: null, error: { message: 'x' } })
    await renderPage(<PermissionsSection />)

    expect(await screen.findByText('Não foi possível carregar suas permissões.')).toBeTruthy()
    expect(screen.queryByText(/^Nível:/)).toBeNull()
  })

  // Os três toggles não salvavam em lugar nenhum e o perfil não tem onde
  // guardá-los; na entrega não fica estado fictício.
  it('não tem mais os toggles de Localização, Arquivos e Ligações', async () => {
    withNotices({})
    await renderPage(<PermissionsSection />)

    expect(screen.queryByText('Localização')).toBeNull()
    expect(screen.queryByText('Acessar pastas e arquivos')).toBeNull()
    expect(screen.queryByText('Ligações telefônicas')).toBeNull()
    expect(screen.getAllByRole('switch')).toHaveLength(1)
  })
})
