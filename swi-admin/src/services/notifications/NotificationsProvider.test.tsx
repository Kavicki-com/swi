import { vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { NotificationDto } from '@/services/api/notifications'
import { simulateReconnect } from '@/test-utils/simulateReconnect'

const h = vi.hoisted(() => ({
  list: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  unsubscribe: vi.fn(),
  push: null as ((n: unknown) => void) | null,
}))
vi.mock('@/services/api/notifications', () => ({
  notificationsApi: { list: h.list, markRead: h.markRead, markAllRead: h.markAllRead },
}))
vi.mock('./notificationsSocket', () => ({
  subscribeNotifications: (cb: (n: unknown) => void) => {
    h.push = cb
    return h.unsubscribe
  },
}))

import { NotificationsProvider, useNotifications } from './NotificationsProvider'

const n = (id: string, over: Partial<NotificationDto> = {}): NotificationDto => ({
  id,
  title: `Batimento alto: ${id}`,
  body: '',
  domain: 'health',
  targetId: null,
  read: false,
  createdAt: '2026-10-05T12:00:00.000Z',
  ...over,
})

function Probe() {
  const view = useNotifications()
  if (!view) return <span>sem provider</span>
  return (
    <span>
      {view.state.status}:{view.unread}
    </span>
  )
}

const flush = () => act(async () => {})

beforeEach(() => {
  h.list.mockReset().mockResolvedValue({ data: [n('a'), n('b')], error: null })
  h.markRead.mockReset().mockResolvedValue({ data: null, error: null })
  h.markAllRead.mockReset().mockResolvedValue({ data: null, error: null })
  h.unsubscribe.mockReset()
  h.push = null
})

describe('NotificationsProvider', () => {
  it('lê ao montar e conta as não lidas', async () => {
    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    )
    await flush()
    expect(screen.getByText('ready:2')).toBeTruthy()
  })

  it('notificação nova pelo socket entra na conta', async () => {
    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    )
    await flush()
    act(() => h.push!(n('c', { createdAt: '2026-10-05T12:01:00.000Z' })))
    expect(screen.getByText('ready:3')).toBeTruthy()
  })

  it('relê quando a conexão volta', async () => {
    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    )
    await flush()
    expect(h.list).toHaveBeenCalledTimes(1)
    await act(async () => simulateReconnect())
    expect(h.list).toHaveBeenCalledTimes(2)
  })

  it('relê quando a aba volta a ficar visível', async () => {
    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    )
    await flush()
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(h.list).toHaveBeenCalledTimes(2)
  })

  it('desmontado, solta o socket', async () => {
    const { unmount } = render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    )
    await flush()
    unmount()
    expect(h.unsubscribe).toHaveBeenCalled()
  })

  it('fora do provider, o hook devolve null', () => {
    render(<Probe />)
    expect(screen.getByText('sem provider')).toBeTruthy()
  })
})
