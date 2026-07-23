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
})

it('conecta com auth.token e transports websocket, assina message, cleanup fecha', () => {
  const cb = vi.fn()
  const stop = subscribeMessages(cb)
  const opts = (ioMock.mock.calls[0] as unknown as [string, any])[1]
  expect(opts.transports).toEqual(['websocket'])
  expect('token' in opts.auth).toBe(true)
  expect((onMock.mock.calls[0] as unknown as [string, unknown])[0]).toBe('message')
  stop()
  expect(closeMock).toHaveBeenCalled()
})
