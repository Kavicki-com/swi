// Prova de fiação do bootstrap: sem isto, `applyCors` poderia existir, ser
// testada e NUNCA ser chamada pelo main real — o browser continuaria bloqueado.
// NestFactory é mockado pra não subir app nem abrir porta.
const listen = jest.fn()
const fakeApp = { listen, enableCors: jest.fn() }

jest.mock('@nestjs/core', () => ({ NestFactory: { create: async () => fakeApp } }))
// corsOrigins também é consumido no decorator do RealtimeGateway (avaliado no
// import do grafo do app) — o mock precisa expô-lo como função de verdade.
jest.mock('./cors', () => ({
  applyCors: jest.fn(),
  corsOrigins: jest.fn(() => ['http://localhost:5173']),
  wsCorsOptions: jest.fn(() => ({ origin: ['http://localhost:5173'] })),
}))

import { applyCors } from './cors'

describe('bootstrap', () => {
  it('habilita CORS no app antes de escutar', async () => {
    await import('./main')
    await new Promise(setImmediate) // deixa o bootstrap() flutuante terminar

    expect(applyCors).toHaveBeenCalledWith(fakeApp)
    expect(listen).toHaveBeenCalled()
    expect((applyCors as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(listen.mock.invocationCallOrder[0])
  })
})
