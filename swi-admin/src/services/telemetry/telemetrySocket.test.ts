import { vi } from 'vitest'

// vi.mock é hoistado; os dublês precisam existir antes dele (padrão do repo).
// Cada io() devolve um socket próprio, para o teste distinguir conexões.
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

import {
  CONDITION_CHANGED_EVENT,
  SNAPSHOT_UPDATED_EVENT,
  subscribeTelemetryEvents,
} from './telemetrySocket'
import { CONNECTION_GRACE_MS, connectionStatus } from '../realtime/connectionStatus'

const SNAPSHOT = { workerId: 'w1', monitoringSessionId: 's', eventId: 'e', revision: 'r' }
const CONDITION = {
  workerId: 'w1',
  conditionId: 'c1',
  kind: 'HEART_RATE_HIGH',
  change: 'OPENED',
  at: 'x',
}

const subscriber = () => ({ onSnapshot: vi.fn(), onCondition: vi.fn() })

afterEach(() => {
  ioMock.mockClear()
  sockets.length = 0
  window.localStorage.clear()
})

it('abre a conexão com o token da sessão e o transporte dos outros sockets do painel', () => {
  window.localStorage.setItem('swi.admin.token', 'jwt-123')
  const stop = subscribeTelemetryEvents(subscriber())
  const opts = (
    ioMock.mock.calls[0] as unknown as [
      string,
      { transports: string[]; auth: { token: string | null } },
    ]
  )[1]
  // Polling primeiro atravessa túnel com página intermediária; o upgrade para
  // WS vem depois.
  expect(opts.transports).toEqual(['polling', 'websocket'])
  expect(opts.auth.token).toBe('jwt-123')
  expect(SNAPSHOT_UPDATED_EVENT).toBe('telemetry.snapshot.updated')
  expect(CONDITION_CHANGED_EVENT).toBe('telemetry.condition.changed')
  stop()
})

it('dois assinantes dividem uma conexão e os dois recebem os avisos', () => {
  const a = subscriber()
  const b = subscriber()
  const stopA = subscribeTelemetryEvents(a)
  const stopB = subscribeTelemetryEvents(b)

  expect(ioMock).toHaveBeenCalledTimes(1)
  sockets[0]!.emit(SNAPSHOT_UPDATED_EVENT, SNAPSHOT)
  sockets[0]!.emit(CONDITION_CHANGED_EVENT, CONDITION)
  expect(a.onSnapshot).toHaveBeenCalledWith(SNAPSHOT)
  expect(b.onSnapshot).toHaveBeenCalledWith(SNAPSHOT)
  expect(a.onCondition).toHaveBeenCalledWith(CONDITION)
  expect(b.onCondition).toHaveBeenCalledWith(CONDITION)

  stopA()
  stopB()
})

it('quem sai para de receber, e a conexão segue aberta para quem fica', () => {
  const a = subscriber()
  const b = subscriber()
  const stopA = subscribeTelemetryEvents(a)
  const stopB = subscribeTelemetryEvents(b)

  stopA()
  expect(sockets[0]!.close).not.toHaveBeenCalled()
  sockets[0]!.emit(SNAPSHOT_UPDATED_EVENT, SNAPSHOT)
  expect(a.onSnapshot).not.toHaveBeenCalled()
  expect(b.onSnapshot).toHaveBeenCalledWith(SNAPSHOT)

  stopB()
})

it('o último a sair fecha a conexão, e sair de novo não fecha duas vezes', () => {
  const stopA = subscribeTelemetryEvents(subscriber())
  const stopB = subscribeTelemetryEvents(subscriber())
  stopA()
  stopB()
  expect(sockets[0]!.close).toHaveBeenCalledTimes(1)
  stopB()
  stopA()
  expect(sockets[0]!.close).toHaveBeenCalledTimes(1)
})

it('assinar depois do fechamento abre uma conexão nova', () => {
  subscribeTelemetryEvents(subscriber())()
  const c = subscriber()
  const stopC = subscribeTelemetryEvents(c)

  expect(ioMock).toHaveBeenCalledTimes(2)
  sockets[1]!.emit(SNAPSHOT_UPDATED_EVENT, SNAPSHOT)
  expect(c.onSnapshot).toHaveBeenCalledWith(SNAPSHOT)
  stopC()
})

it('a conexão compartilhada entra no estado de conexão do painel e sai quando o último assinante fecha', () => {
  vi.useFakeTimers()
  try {
    const stopA = subscribeTelemetryEvents(subscriber())
    const stopB = subscribeTelemetryEvents(subscriber())
    sockets[0]!.emit('disconnect', 'transport close')
    vi.advanceTimersByTime(CONNECTION_GRACE_MS)
    expect(connectionStatus.isLost()).toBe(true)

    stopA()
    expect(connectionStatus.isLost()).toBe(true)
    stopB()
    expect(connectionStatus.isLost()).toBe(false)
    expect(sockets[0]!.handlers.get('disconnect')?.size ?? 0).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
