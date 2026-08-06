// Ordem do boot: a configuração precisa ser validada ANTES de o Nest criar a
// aplicação. Se a validação viesse depois, uma produção mal configurada já
// teria aberto conexão de banco e porta antes de falhar, e o erro chegaria
// misturado com ruído de inicialização.
const listen = jest.fn()
const create = jest.fn(async () => ({ listen, enableCors: jest.fn() }))
// Generics em vez de um parâmetro nomeado que ninguém usa: o tipo do argumento
// é o que permite inspecionar `mock.calls[0][0]` mais abaixo.
const parseRuntimeEnv = jest.fn<
  { port: number; listenSocket: string | undefined; nodeEnv: 'test' },
  [NodeJS.ProcessEnv]
>(() => ({ port: 3000, listenSocket: undefined, nodeEnv: 'test' }))

jest.mock('@nestjs/core', () => ({ NestFactory: { create } }))
jest.mock('./cors', () => ({
  applyCors: jest.fn(),
  corsOrigins: jest.fn(() => ['http://localhost:5173']),
  wsCorsOptions: jest.fn(() => ({ origin: ['http://localhost:5173'] })),
}))
jest.mock('./config/runtime-env', () => ({ parseRuntimeEnv }))

describe('bootstrap: contrato de ambiente', () => {
  it('valida o ambiente antes de criar a aplicação', async () => {
    await import('./main')
    await new Promise(setImmediate)

    // Identidade, e não `toHaveBeenCalledWith(process.env)`: a segunda forma
    // despeja o ambiente inteiro (incluindo segredos locais) no log de falha.
    expect(parseRuntimeEnv).toHaveBeenCalledTimes(1)
    expect(parseRuntimeEnv.mock.calls[0][0]).toBe(process.env)
    expect(parseRuntimeEnv.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0])
  })

  it('escuta na porta que veio da configuração validada, não de process.env cru', async () => {
    await import('./main')
    await new Promise(setImmediate)

    expect(listen).toHaveBeenCalledWith(3000)
  })
})
