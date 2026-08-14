import { vi } from 'vitest'

// vi.mock é hoistado pro topo do arquivo; os mocks têm que existir antes dele —
// por isso vi.hoisted (padrão do repo, ver Login.test.tsx / TasksList.test.tsx).
const { onMock, closeMock, ioMock } = vi.hoisted(() => {
  const onMock = vi.fn()
  const closeMock = vi.fn()
  return { onMock, closeMock, ioMock: vi.fn(() => ({ on: onMock, close: closeMock })) }
})
vi.mock('socket.io-client', () => ({ io: ioMock }))

import { subscribeMessages } from './chatSocket'

afterEach(() => {
  onMock.mockClear()
  closeMock.mockClear()
  ioMock.mockClear()
  window.localStorage.clear()
})

it('conecta com auth.token vindo do readToken e transports websocket, assina message com o cb, cleanup fecha', () => {
  window.localStorage.setItem('swi.admin.token', 'jwt-123')
  const cb = vi.fn()
  const stop = subscribeMessages(cb)
  const opts = (
    ioMock.mock.calls[0] as unknown as [
      string,
      { transports: string[]; auth: { token: string | null } },
    ]
  )[1]
  // polling primeiro: atras de tunel com pagina interstitial, o handshake WS
  // puro morre. Polling e XHR e carrega o header que fura a interstitial, e o
  // upgrade pra WS acontece depois.
  expect(opts.transports).toEqual(['polling', 'websocket'])
  // Prova que o token sai do readToken() (localStorage), não de um literal.
  expect(opts.auth.token).toBe('jwt-123')
  const onCall = onMock.mock.calls[0] as unknown as [string, (m: unknown) => void]
  expect(onCall[0]).toBe('message')
  // Trava que o cb do caller é o próprio handler — não um wrapper vazio.
  expect(onCall[1]).toBe(cb)
  stop()
  expect(closeMock).toHaveBeenCalled()
})
