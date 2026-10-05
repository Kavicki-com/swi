import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants'
import { socketServerOptions } from './socket-options'

// Os casos que carregam os gateways de novo compilam o grafo deles dentro do
// teste; com cobertura ligada isso passa do prazo padrão.
const LOAD_TIMEOUT_MS = 15_000

describe('socketServerOptions', () => {
  it('sem a variável, não mexe no servidor de socket', () => {
    expect(socketServerOptions({})).toEqual({})
  })

  it('com a variável, o ping do servidor passa a usar o intervalo pedido', () => {
    expect(socketServerOptions({ SOCKET_PING_INTERVAL_MS: '2000' })).toEqual({ pingInterval: 2000 })
  })

  // O boot já recusa o valor inválido; aqui ele só não vira opção.
  it('valor inválido não vira opção', () => {
    expect(socketServerOptions({ SOCKET_PING_INTERVAL_MS: 'abc' })).toEqual({})
  })
})

// O Nest cria UM servidor socket.io para os gateways sem namespace e usa as
// opções do primeiro que registrar. Os dois precisam pedir o mesmo intervalo,
// lido quando o módulo carrega.
describe('gateways com SOCKET_PING_INTERVAL_MS', () => {
  const original = process.env.SOCKET_PING_INTERVAL_MS

  afterEach(() => {
    if (original === undefined) delete process.env.SOCKET_PING_INTERVAL_MS
    else process.env.SOCKET_PING_INTERVAL_MS = original
    jest.resetModules()
  })

  // Os gateways leem a variável ao carregar: cada caso carrega os dois de novo.
  const loadOptions = async (): Promise<Array<{ pingInterval?: number }>> => {
    jest.resetModules()
    const { RealtimeGateway } = await import('./realtime.gateway')
    const { LiveGateway } = await import('../live/live.gateway')
    return [RealtimeGateway, LiveGateway].map((gateway) => Reflect.getMetadata(GATEWAY_OPTIONS, gateway))
  }

  it('os dois gateways sobem com o intervalo configurado', async () => {
    process.env.SOCKET_PING_INTERVAL_MS = '2000'
    const [realtime, live] = await loadOptions()
    expect(realtime.pingInterval).toBe(2000)
    expect(live.pingInterval).toBe(2000)
  }, LOAD_TIMEOUT_MS)

  it('sem a variável, nenhum dos dois define o intervalo', async () => {
    delete process.env.SOCKET_PING_INTERVAL_MS
    const [realtime, live] = await loadOptions()
    expect(realtime).not.toHaveProperty('pingInterval')
    expect(live).not.toHaveProperty('pingInterval')
  }, LOAD_TIMEOUT_MS)
})

// Prova de ponta a ponta: o servidor socket.io de verdade anuncia ao cliente,
// na abertura da conexão, o intervalo que veio do ambiente.
describe('servidor socket.io com SOCKET_PING_INTERVAL_MS', () => {
  const original = process.env.SOCKET_PING_INTERVAL_MS

  afterEach(() => {
    if (original === undefined) delete process.env.SOCKET_PING_INTERVAL_MS
    else process.env.SOCKET_PING_INTERVAL_MS = original
    jest.resetModules()
  })

  const announcedPingInterval = async (): Promise<number> => {
    jest.resetModules()
    const { Test } = await import('@nestjs/testing')
    const { JwtService } = await import('@nestjs/jwt')
    const { PrismaService } = await import('../prisma/prisma.service')
    const { RealtimeGateway } = await import('./realtime.gateway')
    const moduleRef = await Test.createTestingModule({
      providers: [RealtimeGateway, { provide: JwtService, useValue: {} }, { provide: PrismaService, useValue: {} }],
    }).compile()
    const app = moduleRef.createNestApplication()
    await app.listen(0, '127.0.0.1')
    try {
      const { port } = app.getHttpServer().address() as { port: number }
      const response = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, {
        signal: AbortSignal.timeout(5_000),
      })
      // O pacote de abertura do engine.io é "0" seguido do JSON da sessão.
      return (JSON.parse((await response.text()).slice(1)) as { pingInterval: number }).pingInterval
    } finally {
      await app.close()
    }
  }

  it('anuncia o intervalo configurado', async () => {
    process.env.SOCKET_PING_INTERVAL_MS = '2000'
    await expect(announcedPingInterval()).resolves.toBe(2000)
  }, LOAD_TIMEOUT_MS)

  it('sem a variável, anuncia o padrão da biblioteca', async () => {
    delete process.env.SOCKET_PING_INTERVAL_MS
    await expect(announcedPingInterval()).resolves.toBe(25000)
  }, LOAD_TIMEOUT_MS)
})
