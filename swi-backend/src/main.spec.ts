// Prova de fiação do bootstrap: sem isto, `applyCors` poderia existir, ser
// testada e NUNCA ser chamada pelo main real, e o browser continuaria bloqueado.
// NestFactory é mockado pra não subir app nem abrir porta.
const listen = jest.fn()
const set = jest.fn()
const fakeApp = { listen, enableCors: jest.fn(), set }

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

// setupApiDocs é o outro alvo: sem esta prova, o Swagger poderia existir, ter
// spec própria e nunca ser montado pelo main real.
jest.mock('./docs/api-docs', () => ({ setupApiDocs: jest.fn() }))

import { applyCors } from './cors'
import { setupApiDocs } from './docs/api-docs'

describe('bootstrap', () => {
  it('habilita CORS no app antes de escutar', async () => {
    await import('./main')
    await new Promise(setImmediate) // deixa o bootstrap() flutuante terminar

    expect(applyCors).toHaveBeenCalledWith(fakeApp)
    expect(listen).toHaveBeenCalled()
    expect((applyCors as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(listen.mock.invocationCallOrder[0])
  })

  it('monta a documentação da API com o ambiente validado, antes de escutar', () => {
    expect(setupApiDocs).toHaveBeenCalledWith(fakeApp, expect.objectContaining({ apiDocs: expect.any(Boolean) }))
    expect((setupApiDocs as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(listen.mock.invocationCallOrder[0])
  })

  it('confia só no proxy local para achar o IP do cliente, antes de escutar', () => {
    // 'loopback' e não `true`: com `true` qualquer cliente forjaria o próprio
    // IP mandando X-Forwarded-For, e o limite de requisições e a trilha de
    // auditoria passariam a acreditar nele.
    expect(set).toHaveBeenCalledWith('trust proxy', 'loopback')
    expect(set.mock.invocationCallOrder[0]).toBeLessThan(listen.mock.invocationCallOrder[0])
  })
})
