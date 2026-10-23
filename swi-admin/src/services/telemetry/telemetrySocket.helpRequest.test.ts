// O aviso help-request.changed chega pela mesma conexão compartilhada dos
// avisos de telemetria. Quem não pede o aviso não recebe nada dele.
import { vi } from 'vitest'

const { sockets, ioMock } = vi.hoisted(() => {
  type FakeSocket = {
    handlers: Map<string, Set<(ev: unknown) => void>>
    on: (event: string, h: (ev: unknown) => void) => void
    off: (event: string, h: (ev: unknown) => void) => void
    close: ReturnType<typeof vi.fn>
    emit: (event: string, ev: unknown) => void
  }
  const sockets: FakeSocket[] = []
  const ioMock = vi.fn(() => {
    const handlers = new Map<string, Set<(ev: unknown) => void>>()
    const socket: FakeSocket = {
      handlers,
      on: (event, h) => {
        if (!handlers.has(event)) handlers.set(event, new Set())
        handlers.get(event)!.add(h)
      },
      off: (event, h) => {
        handlers.get(event)?.delete(h)
      },
      close: vi.fn(),
      emit: (event, ev) => {
        for (const h of handlers.get(event) ?? []) h(ev)
      },
    }
    sockets.push(socket)
    return socket
  })
  return { sockets, ioMock }
})
vi.mock('socket.io-client', () => ({ io: ioMock }))

import { HELP_REQUEST_CHANGED_EVENT, subscribeTelemetryEvents } from './telemetrySocket'

const HELP = { workerId: 'w1', helpRequestId: 'a1', status: 'ATTENDED', at: 'x' }

afterEach(() => {
  ioMock.mockClear()
  sockets.length = 0
})

it('entrega o aviso do pedido de ajuda a quem pediu e para depois de sair', () => {
  const onHelpRequest = vi.fn()
  const stop = subscribeTelemetryEvents({
    onSnapshot: vi.fn(),
    onCondition: vi.fn(),
    onHelpRequest,
  })
  expect(HELP_REQUEST_CHANGED_EVENT).toBe('help-request.changed')

  sockets[0]!.emit(HELP_REQUEST_CHANGED_EVENT, HELP)
  expect(onHelpRequest).toHaveBeenCalledWith(HELP)

  stop()
  expect(sockets[0]!.handlers.get(HELP_REQUEST_CHANGED_EVENT)?.size ?? 0).toBe(0)
})

it('quem não pede o aviso do pedido de ajuda não fica escutando', () => {
  const stop = subscribeTelemetryEvents({ onSnapshot: vi.fn(), onCondition: vi.fn() })
  expect(sockets[0]!.handlers.get(HELP_REQUEST_CHANGED_EVENT)?.size ?? 0).toBe(0)
  stop()
})
