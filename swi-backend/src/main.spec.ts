// Prova de fiação do bootstrap: sem isto, `applyCors` poderia existir, ser
// testada e NUNCA ser chamada pelo main real — o browser continuaria bloqueado.
// NestFactory é mockado pra não subir app nem abrir porta.
const listen = jest.fn()
const fakeApp = { listen, enableCors: jest.fn() }

jest.mock('@nestjs/core', () => ({ NestFactory: { create: async () => fakeApp } }))
jest.mock('./cors', () => ({ applyCors: jest.fn() }))

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
