// Prova de fiação do bootstrap: sem isto, `applyCors` poderia existir, ser
// testada e NUNCA ser chamada pelo main real, e o browser continuaria bloqueado.
// NestFactory é mockado pra não subir app nem abrir porta.
const listen = jest.fn()
const fakeApp = { listen, enableCors: jest.fn() }

jest.mock('@nestjs/core', () => ({ NestFactory: { create: async () => fakeApp } }))
// O AppModule é dublê porque mockar só o NestFactory não cortava o custo: o
// `import { AppModule }` do main é avaliado de qualquer jeito e arrastava o
// grafo inteiro (todo controller, service, gateway e o cliente do Prisma) para
// dentro do corpo do caso, que é o trecho cronometrado pelo timeout de 5 s. Sob
// o run paralelo isso estourava. Este caso afirma ordem de chamada, não boot.
jest.mock('./app.module', () => ({ AppModule: class AppModuleDouble {} }))
// applyCors é o alvo da asserção. corsOrigins e wsCorsOptions ficam porque o
// mock substitui o módulo inteiro, e o main resolve o import por ele.
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
