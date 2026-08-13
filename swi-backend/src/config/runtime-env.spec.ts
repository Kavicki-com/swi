import { parseRuntimeEnv } from './runtime-env'

// Ambiente de produção mínimo e válido. Cada teste sobrescreve só a chave que
// está sendo exercitada, para que a falha aponte a variável e não o setup.
function validProd(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://swi:senha@db.interno:5432/swi',
    JWT_SECRET: 'a'.repeat(32),
    CORS_ORIGINS: 'https://painel.exemplo.com',
    ADMIN_APP_URL: 'https://painel.exemplo.com',
    MAIL_FROM: 'nao-responda@exemplo.com',
    REPORT_TO_EMAIL: 'moderacao@exemplo.com',
    ...overrides,
  }
}

describe('parseRuntimeEnv', () => {
  it('recusa produção sem variáveis obrigatórias', () => {
    expect(() => parseRuntimeEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/)
  })

  it('recusa segredo JWT fraco em produção', () => {
    expect(() => parseRuntimeEnv(validProd({ JWT_SECRET: 'curto' }))).toThrow(/JWT_SECRET/)
  })

  it('recusa localhost e wildcard no CORS de produção', () => {
    expect(() => parseRuntimeEnv(validProd({ CORS_ORIGINS: '*' }))).toThrow(/CORS_ORIGINS/)
    expect(() => parseRuntimeEnv(validProd({ CORS_ORIGINS: 'http://localhost:5173' }))).toThrow(/CORS_ORIGINS/)
    expect(() => parseRuntimeEnv(validProd({ CORS_ORIGINS: '' }))).toThrow(/CORS_ORIGINS/)
  })

  it('exige destino de moderação e remetente em produção', () => {
    expect(() => parseRuntimeEnv(validProd({ REPORT_TO_EMAIL: undefined }))).toThrow(/REPORT_TO_EMAIL/)
    expect(() => parseRuntimeEnv(validProd({ MAIL_FROM: undefined }))).toThrow(/MAIL_FROM/)
  })

  it('aceita um ambiente de produção completo', () => {
    const env = parseRuntimeEnv(validProd())
    expect(env.nodeEnv).toBe('production')
    expect(env.corsOrigins).toEqual(['https://painel.exemplo.com'])
    expect(env.port).toBe(3000)
  })

  it('permite defaults locais apenas em development e test', () => {
    expect(parseRuntimeEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-only' }).nodeEnv).toBe('test')
    expect(parseRuntimeEnv({ NODE_ENV: 'development' }).corsOrigins).toEqual(['http://localhost:5173'])
  })

  it('recusa NODE_ENV desconhecido em vez de tratar como produção', () => {
    expect(() => parseRuntimeEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/)
  })

  it('recusa PORT não numérica', () => {
    expect(() => parseRuntimeEnv(validProd({ PORT: 'oitenta' }))).toThrow(/PORT/)
    expect(parseRuntimeEnv(validProd({ PORT: '8080' })).port).toBe(8080)
  })

  it('recusa par de credenciais S3 incompleto e aceita a ausência das duas', () => {
    expect(() => parseRuntimeEnv(validProd({ MINIO_ACCESS_KEY: 'chave' }))).toThrow(/MINIO_SECRET_KEY/)
    expect(() => parseRuntimeEnv(validProd({ MINIO_SECRET_KEY: 'segredo' }))).toThrow(/MINIO_ACCESS_KEY/)
    expect(parseRuntimeEnv(validProd()).minio.accessKey).toBeUndefined()
  })

  it('nunca inclui o valor da variável na mensagem de erro', () => {
    const segredo = 'senha-real-que-nao-pode-vazar'
    expect(() => parseRuntimeEnv(validProd({ JWT_SECRET: segredo }))).toThrow(/JWT_SECRET/)
    try {
      parseRuntimeEnv(validProd({ JWT_SECRET: segredo }))
    } catch (erro) {
      expect((erro as Error).message).not.toContain(segredo)
    }
  })

  it('devolve uma configuração congelada', () => {
    const env = parseRuntimeEnv(validProd())
    expect(Object.isFrozen(env)).toBe(true)
  })
})
