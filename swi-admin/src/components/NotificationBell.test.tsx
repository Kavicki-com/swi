import { vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import type { NotificationDto } from '@/services/api/notifications'
import type { NotificationsView } from '@/services/notifications/NotificationsProvider'
import { initialNotifications } from '@/services/notifications/notificationList'
import { whenLabel } from '@/lib/whenLabel'

const h = vi.hoisted(() => ({
  view: null as unknown,
  navigate: vi.fn(),
  notices: {
    support: 'granted',
    enabled: true,
    declined: false,
    request: vi.fn(),
    disable: vi.fn(),
  },
}))
vi.mock('@/hooks/useBrowserNotices', () => ({ useBrowserNotices: () => h.notices }))
vi.mock('@/services/notifications/NotificationsProvider', () => ({
  useNotifications: () => h.view,
}))
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}))

import { isBellOpen } from '@/services/notifications/bellPanel'
import { NotificationBell } from './NotificationBell'

const n = (id: string, over: Partial<NotificationDto> = {}): NotificationDto => ({
  id,
  title: `Batimento alto: ${id}`,
  body: '130 bpm, acima do limite de 120 bpm.',
  domain: 'health',
  targetId: null,
  read: false,
  createdAt: '2026-10-05T12:00:00.000Z',
  ...over,
})

function viewWith(over: Partial<NotificationsView> & { items?: NotificationDto[] } = {}) {
  const items = over.items ?? []
  const view: NotificationsView = {
    state: { ...initialNotifications(), status: 'ready', items, ...over.state },
    unread: items.filter((i) => !i.read).length,
    refresh: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    ...over,
  }
  h.view = view
  return view
}

const bell = () => screen.getByTestId('notification-bell')

beforeEach(() => {
  h.navigate.mockReset()
  h.notices = {
    support: 'granted',
    enabled: true,
    declined: false,
    request: vi.fn(),
    disable: vi.fn(),
  }
})

afterEach(() => clearSession())

describe('NotificationBell', () => {
  it('sem provider não aparece', async () => {
    h.view = null
    await renderPage(<NotificationBell />)
    expect(screen.queryByTestId('notification-bell')).toBeNull()
  })

  it('sem não lidas, o botão diz só Notificações e não tem contador', async () => {
    viewWith({ items: [n('a', { read: true })] })
    await renderPage(<NotificationBell />)
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeTruthy()
    expect(screen.queryByText('1')).toBeNull()
  })

  it('com não lidas, mostra o número e diz quantas no rótulo', async () => {
    viewWith({ items: [n('a'), n('b'), n('c')] })
    await renderPage(<NotificationBell />)
    expect(screen.getByRole('button', { name: 'Notificações, 3 não lidas' })).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('uma não lida, no singular', async () => {
    viewWith({ items: [n('a')] })
    await renderPage(<NotificationBell />)
    expect(screen.getByRole('button', { name: 'Notificações, 1 não lida' })).toBeTruthy()
  })

  it('acima de 9, o contador mostra +9, como o menu do painel', async () => {
    viewWith({ items: Array.from({ length: 12 }, (_, i) => n(`x${i}`)) })
    await renderPage(<NotificationBell />)
    expect(screen.getByText('+9')).toBeTruthy()
  })

  it('abrir relê e mostra título, texto e hora de cada notificação', async () => {
    const view = viewWith({ items: [n('a')] })
    await renderPage(<NotificationBell />)
    fireEvent.click(bell())
    expect(view.refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Notificações')).toBeTruthy()
    expect(screen.getByText('Batimento alto: a')).toBeTruthy()
    expect(screen.getByText('130 bpm, acima do limite de 120 bpm.')).toBeTruthy()
    expect(screen.getByText(whenLabel('2026-10-05T12:00:00.000Z', Date.now())!)).toBeTruthy()
  })

  it('não lida se anuncia como não lida', async () => {
    viewWith({ items: [n('a'), n('b', { read: true })] })
    await renderPage(<NotificationBell />)
    fireEvent.click(bell())
    expect(screen.getByRole('button', { name: 'Batimento alto: a (não lida)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Batimento alto: b' })).toBeTruthy()
  })

  it('clicar numa de saúde marca como lida, fecha e leva ao monitoramento', async () => {
    const view = viewWith({ items: [n('a')] })
    await renderPage(<NotificationBell />)
    fireEvent.click(bell())
    fireEvent.click(screen.getByRole('button', { name: 'Batimento alto: a (não lida)' }))
    expect(view.markRead).toHaveBeenCalledWith('a')
    expect(h.navigate).toHaveBeenCalledWith('/monitoring/alerts')
    expect(screen.queryByText('Batimento alto: a')).toBeNull()
  })

  it('clicar numa de outro domínio só marca como lida', async () => {
    const view = viewWith({ items: [n('j', { domain: 'journey', title: 'Pausa' })] })
    await renderPage(<NotificationBell />)
    fireEvent.click(bell())
    fireEvent.click(screen.getByRole('button', { name: 'Pausa (não lida)' }))
    expect(view.markRead).toHaveBeenCalledWith('j')
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('marcar todas como lidas aparece só com não lidas', async () => {
    const view = viewWith({ items: [n('a')] })
    await renderPage(<NotificationBell />)
    fireEvent.click(bell())
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todas as notificações como lidas' }))
    expect(view.markAllRead).toHaveBeenCalledTimes(1)
  })

  it('sem não lidas, não oferece marcar todas', async () => {
    viewWith({ items: [n('a', { read: true })] })
    await renderPage(<NotificationBell />)
    fireEvent.click(bell())
    expect(screen.queryByText('Marcar todas como lidas')).toBeNull()
  })

  it('lista vazia diz que não há notificação', async () => {
    viewWith({ items: [] })
    await renderPage(<NotificationBell />)
    fireEvent.click(bell())
    expect(screen.getByText('Nenhuma notificação.')).toBeTruthy()
  })

  it('falha na leitura avisa e deixa tentar de novo', async () => {
    const view = viewWith({ state: { ...initialNotifications(), status: 'failed' } })
    await renderPage(<NotificationBell />)
    fireEvent.click(bell())
    expect(screen.getByText('Não foi possível carregar as notificações.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(view.refresh).toHaveBeenCalledTimes(2)
  })

  it('enquanto o navegador não respondeu, oferece ligar os avisos dele', async () => {
    viewWith({ items: [] })
    h.notices = { ...h.notices, support: 'default', enabled: false }
    await renderPage(<NotificationBell />)
    fireEvent.click(bell())
    expect(
      screen.getByText(
        'Receba um aviso do navegador quando chegar um alerta urgente com o SWI em segundo plano.',
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ativar avisos' }))
    expect(h.notices.request).toHaveBeenCalledTimes(1)
  })

  it('com os avisos já decididos, recusados ou sem suporte, não oferece', async () => {
    viewWith({ items: [] })
    for (const notices of [
      { support: 'granted', declined: false },
      { support: 'default', declined: true },
      { support: 'denied', declined: true },
      { support: 'unsupported', declined: false },
    ]) {
      h.notices = { ...h.notices, ...notices }
      const { unmount } = await renderPage(<NotificationBell />)
      fireEvent.click(bell())
      expect(screen.queryByRole('button', { name: 'Ativar avisos' })).toBeNull()
      unmount()
    }
  })

  it('avisa quando a lista abre e quando fecha, inclusive ao sair da tela', async () => {
    viewWith({ items: [n('a')] })
    const { unmount } = await renderPage(<NotificationBell />)
    expect(isBellOpen()).toBe(false)
    fireEvent.click(bell())
    expect(isBellOpen()).toBe(true)
    fireEvent.click(bell())
    expect(isBellOpen()).toBe(false)
    fireEvent.click(bell())
    unmount()
    expect(isBellOpen()).toBe(false)
  })

  it('clicar no sino de novo fecha a lista', async () => {
    viewWith({ items: [n('a')] })
    await renderPage(<NotificationBell />)
    fireEvent.click(bell())
    fireEvent.click(bell())
    expect(screen.queryByText('Batimento alto: a')).toBeNull()
  })
})
