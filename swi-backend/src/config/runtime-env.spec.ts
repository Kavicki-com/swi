import {
  LIVE_DEFAULT_ICE_SERVERS,
  parseAlertsIncludeDemo,
  parseLiveIceServers,
  parseRuntimeEnv,
  RETENTION_DEFAULT_BATCH,
} from './runtime-env'

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

// Homologação roda com NODE_ENV=production, então a flag não pode depender do
// NODE_ENV: só o valor '1' liga, e qualquer outra coisa deixa desligado.
describe('parseRuntimeEnv: alertas de demonstração na fila', () => {
  it('desligado por padrão, inclusive em produção', () => {
    expect(parseRuntimeEnv(validProd()).telemetryAlertsIncludeDemo).toBe(false)
    expect(parseAlertsIncludeDemo({})).toBe(false)
  })

  it("só '1' liga, mesmo com NODE_ENV=production", () => {
    expect(parseRuntimeEnv(validProd({ TELEMETRY_ALERTS_INCLUDE_DEMO: '1' })).telemetryAlertsIncludeDemo).toBe(true)
    expect(parseAlertsIncludeDemo({ TELEMETRY_ALERTS_INCLUDE_DEMO: 'true' })).toBe(false)
    expect(parseAlertsIncludeDemo({ TELEMETRY_ALERTS_INCLUDE_DEMO: '0' })).toBe(false)
  })
})

describe('parseRuntimeEnv: retenção da telemetria', () => {
  it('sem variável, retém trinta dias e apaga em lotes de alguns milhares', () => {
    const env = parseRuntimeEnv(validProd())

    expect(env.telemetryRetention.windowMs).toBe(30 * 24 * 60 * 60 * 1000)
    expect(env.telemetryRetention.batchSize).toBe(RETENTION_DEFAULT_BATCH)
  })

  it('recusa janela abaixo de 48 horas, sem corrigir em silêncio', () => {
    // O piso é o mesmo prazo em que um dia fecha: reter menos que isso
    // apagaria Leitura que ainda pode receber evento atrasado, e o Resumo
    // daquele dia nasceria de série incompleta. Corrigir para o piso em
    // silêncio esconderia a configuração errada até alguém procurar o dado.
    expect(() => parseRuntimeEnv(validProd({ TELEMETRY_RETENTION_DAYS: '1' }))).toThrow(
      /TELEMETRY_RETENTION_DAYS/,
    )
    expect(() => parseRuntimeEnv(validProd({ TELEMETRY_RETENTION_DAYS: '0' }))).toThrow(
      /TELEMETRY_RETENTION_DAYS/,
    )
  })

  it('aceita exatamente 48 horas, que é o piso e não um valor proibido', () => {
    expect(
      parseRuntimeEnv(validProd({ TELEMETRY_RETENTION_DAYS: '2' })).telemetryRetention.windowMs,
    ).toBe(2 * 24 * 60 * 60 * 1000)
  })

  it('recusa janela e lote que não sejam inteiros positivos', () => {
    expect(() => parseRuntimeEnv(validProd({ TELEMETRY_RETENTION_DAYS: 'trinta' }))).toThrow(
      /TELEMETRY_RETENTION_DAYS/,
    )
    expect(() => parseRuntimeEnv(validProd({ TELEMETRY_RETENTION_DAYS: '30.5' }))).toThrow(
      /TELEMETRY_RETENTION_DAYS/,
    )
    expect(() => parseRuntimeEnv(validProd({ TELEMETRY_RETENTION_BATCH_SIZE: '0' }))).toThrow(
      /TELEMETRY_RETENTION_BATCH_SIZE/,
    )
  })

  it('a janela vale em desenvolvimento também, e não só em produção', () => {
    // Retenção apaga dado igual nos dois ambientes; um piso que só valesse em
    // produção deixaria a máquina de quem desenvolve apagar o que ainda não
    // foi resumido.
    expect(() => parseRuntimeEnv({ TELEMETRY_RETENTION_DAYS: '1' })).toThrow(
      /TELEMETRY_RETENTION_DAYS/,
    )
  })
})

describe('parseRuntimeEnv: trilha de posições', () => {
  it('sem variável, retém trinta dias de posições', () => {
    const env = parseRuntimeEnv(validProd())
    expect(env.positionRetention.windowMs).toBe(30 * 24 * 60 * 60 * 1000)
    expect(env.positionRetention.batchSize).toBe(RETENTION_DEFAULT_BATCH)
  })

  it('aceita a janela a partir de um dia e recusa abaixo disso, sem corrigir em silêncio', () => {
    expect(parseRuntimeEnv(validProd({ POSITION_RETENTION_DAYS: '1' })).positionRetention.windowMs).toBe(
      24 * 60 * 60 * 1000,
    )
    expect(() => parseRuntimeEnv(validProd({ POSITION_RETENTION_DAYS: '0' }))).toThrow(/POSITION_RETENTION_DAYS/)
    expect(() => parseRuntimeEnv(validProd({ POSITION_RETENTION_DAYS: 'trinta' }))).toThrow(
      /POSITION_RETENTION_DAYS/,
    )
  })

  it('posição simulada no calor só com a variável exatamente em 1, e nunca por NODE_ENV', () => {
    expect(parseRuntimeEnv(validProd()).positionsHeatIncludeSim).toBe(false)
    expect(parseRuntimeEnv({ NODE_ENV: 'development' }).positionsHeatIncludeSim).toBe(false)
    expect(parseRuntimeEnv(validProd({ POSITIONS_HEAT_INCLUDE_SIM: 'true' })).positionsHeatIncludeSim).toBe(false)
    expect(parseRuntimeEnv(validProd({ POSITIONS_HEAT_INCLUDE_SIM: '1' })).positionsHeatIncludeSim).toBe(true)
  })
})

// Servidores que o navegador e o celular usam para achar o caminho da conexão
// direta da transmissão ao vivo. O TURN entra depois só por esta variável, com
// credencial, então a mensagem de erro nunca pode ecoar o valor.
describe('parseRuntimeEnv: servidores de conexão da transmissão ao vivo', () => {
  it('sem variável, usa o STUN público padrão', () => {
    expect(parseRuntimeEnv(validProd()).liveIceServers).toEqual(LIVE_DEFAULT_ICE_SERVERS)
    expect(parseLiveIceServers({}, [])).toEqual([{ urls: 'stun:stun.l.google.com:19302' }])
    expect(parseLiveIceServers({ LIVE_ICE_SERVERS: '' }, [])).toEqual(LIVE_DEFAULT_ICE_SERVERS)
  })

  it('aceita STUN e TURN com credencial, em url única ou lista', () => {
    const raw = JSON.stringify([
      { urls: 'stun:stun.exemplo.com:3478' },
      { urls: ['turn:turn.exemplo.com:3478?transport=udp', 'turns:turn.exemplo.com:5349'], username: 'swi', credential: 'segredo' },
    ])
    expect(parseRuntimeEnv(validProd({ LIVE_ICE_SERVERS: raw })).liveIceServers).toEqual(JSON.parse(raw))
  })

  it('lista vazia vale: só conexão na mesma rede', () => {
    expect(parseLiveIceServers({ LIVE_ICE_SERVERS: '[]' }, [])).toEqual([])
  })

  it.each([
    ['JSON quebrado', '[{urls:'],
    ['objeto em vez de lista', '{"urls":"stun:a.com"}'],
    ['sem urls', '[{"username":"x"}]'],
    ['esquema que não é stun nem turn', '[{"urls":"https://a.com"}]'],
    ['credencial que não é texto', '[{"urls":"turn:a.com","username":"x","credential":1}]'],
    // O navegador recusa o RTCPeerConnection inteiro com TURN sem credencial:
    // melhor o processo não subir do que todo painel quebrar ao assistir.
    ['TURN sem usuário e senha', '[{"urls":"turn:a.com"}]'],
    ['TURN no meio da lista sem senha', '[{"urls":["stun:a.com","turns:b.com"],"username":"x"}]'],
  ])('recusa %s com mensagem fixa, sem ecoar o valor', (_caso, raw) => {
    const problems: string[] = []
    expect(parseLiveIceServers({ LIVE_ICE_SERVERS: raw }, problems)).toEqual(LIVE_DEFAULT_ICE_SERVERS)
    expect(problems).toEqual([
      'LIVE_ICE_SERVERS precisa ser uma lista JSON de servidores com urls stun: ou turn:, e TURN com username e credential',
    ])
    expect(() => parseRuntimeEnv(validProd({ LIVE_ICE_SERVERS: raw }))).toThrow(/LIVE_ICE_SERVERS/)
  })

  it('não ecoa a credencial do TURN quando a lista é recusada', () => {
    const raw = '[{"urls":"turn:a.com","username":"swi","credential":"senha-do-turn"},{"urls":"ftp:b.com"}]'
    try {
      parseRuntimeEnv(validProd({ LIVE_ICE_SERVERS: raw }))
      throw new Error('deveria recusar')
    } catch (erro) {
      expect((erro as Error).message).toMatch(/LIVE_ICE_SERVERS/)
      expect((erro as Error).message).not.toContain('senha-do-turn')
    }
  })
})

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
