import { Logger } from '@nestjs/common'
import { applyCors, corsOrigins, wsCorsOptions } from './cors'

describe('corsOrigins', () => {
  it('sem CORS_ORIGINS: libera só o dev server do swi-admin', () => {
    expect(corsOrigins({})).toEqual(['http://localhost:5173'])
  })

  it('lista CSV vira array, com trim dos espaços', () => {
    expect(corsOrigins({ CORS_ORIGINS: 'https://a.com, https://b.com ' })).toEqual(['https://a.com', 'https://b.com'])
  })

  it('entradas vazias são descartadas (vírgula sobrando não vira origin "")', () => {
    expect(corsOrigins({ CORS_ORIGINS: 'https://a.com,,  ,' })).toEqual(['https://a.com'])
  })

  it('CORS_ORIGINS setado vazio NÃO cai no default — lista vazia fecha o CORS', () => {
    expect(corsOrigins({ CORS_ORIGINS: '' })).toEqual([])
  })
})

describe('applyCors', () => {
  const envAntes = process.env.CORS_ORIGINS
  afterEach(() => {
    if (envAntes === undefined) delete process.env.CORS_ORIGINS
    else process.env.CORS_ORIGINS = envAntes
    jest.restoreAllMocks()
  })

  it('loga as origins carregadas (torna "o painel não conecta" auditável no boot)', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation()
    process.env.CORS_ORIGINS = 'https://a.example, https://b.example'
    applyCors({ enableCors: jest.fn() } as any)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('https://a.example, https://b.example'))
  })

  it('sem CORS_ORIGINS, o log mostra o default que foi aplicado', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation()
    delete process.env.CORS_ORIGINS
    applyCors({ enableCors: jest.fn() } as any)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('http://localhost:5173'))
  })
})

// Hospedagem Cloudez: o nginx do host injeta `Access-Control-Allow-Origin: *`
// em toda resposta (conf do root, inalteravel). Se a API emitir o proprio
// ACAO, o navegador ve DOIS valores e bloqueia ("multiple values"). No modo
// proxy a API delega o ACAO e responde so o resto do preflight.
describe('applyCors — modo proxy (CORS_PROXY_SETS_ORIGIN=1)', () => {
  const OLD = process.env.CORS_PROXY_SETS_ORIGIN
  afterEach(() => {
    if (OLD === undefined) delete process.env.CORS_PROXY_SETS_ORIGIN
    else process.env.CORS_PROXY_SETS_ORIGIN = OLD
  })

  const fakeRes = () => {
    const headers: Record<string, string> = {}
    return {
      headers,
      statusCode: 200,
      ended: false,
      setHeader(k: string, v: string) { headers[k] = v },
      end() { (this as any).ended = true },
    }
  }

  it('nao registra o enableCors (que emitiria ACAO duplicado)', () => {
    process.env.CORS_PROXY_SETS_ORIGIN = '1'
    const app = { enableCors: jest.fn(), use: jest.fn() }
    applyCors(app as any)
    expect(app.enableCors).not.toHaveBeenCalled()
    expect(app.use).toHaveBeenCalledTimes(1)
  })

  it('preflight OPTIONS: 204 com metodos e headers, SEM allow-origin', () => {
    process.env.CORS_PROXY_SETS_ORIGIN = '1'
    const app = { enableCors: jest.fn(), use: jest.fn() }
    applyCors(app as any)
    const middleware = app.use.mock.calls[0][0]
    const res = fakeRes()
    const next = jest.fn()
    middleware({ method: 'OPTIONS' }, res, next)
    expect(res.statusCode).toBe(204)
    expect((res as any).ended).toBe(true)
    expect(next).not.toHaveBeenCalled()
    expect(res.headers['Access-Control-Allow-Headers']).toContain('Authorization')
    expect('Access-Control-Allow-Origin' in res.headers).toBe(false)
  })

  // Producao, 31/07/2026: editar mensagem no painel morria com erro de CORS
  // enquanto excluir passava. O preflight respondia 204, mas a lista de metodos
  // era "GET,POST,PUT,DELETE,OPTIONS" — sem PATCH. O navegador bloqueava a
  // requisicao real antes de sair da maquina, e o servidor nao registrava nada.
  // Local nao pegava porque o outro ramo usa o enableCors do Nest, cujo default
  // ja inclui PATCH.
  //
  // O teste nao trava a string: cobra que cada verbo que a API expoe esteja na
  // lista, para a proxima rota nova falhar aqui e nao em producao.
  it('libera todo verbo que a API expoe, inclusive PATCH', () => {
    process.env.CORS_PROXY_SETS_ORIGIN = '1'
    const app = { enableCors: jest.fn(), use: jest.fn() }
    applyCors(app as any)
    const middleware = app.use.mock.calls[0][0]
    const res = fakeRes()
    middleware({ method: 'OPTIONS' }, res, jest.fn())

    const permitidos = (res.headers['Access-Control-Allow-Methods'] ?? '')
      .split(',')
      .map((m) => m.trim())
    for (const verbo of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']) {
      expect(permitidos).toContain(verbo)
    }
  })

  it('requisicao normal segue adiante, tambem sem allow-origin', () => {
    process.env.CORS_PROXY_SETS_ORIGIN = '1'
    const app = { enableCors: jest.fn(), use: jest.fn() }
    applyCors(app as any)
    const middleware = app.use.mock.calls[0][0]
    const res = fakeRes()
    const next = jest.fn()
    middleware({ method: 'GET' }, res, next)
    expect(next).toHaveBeenCalled()
    expect('Access-Control-Allow-Origin' in res.headers).toBe(false)
  })
})

// O socket.io tambem emite ACAO proprio no handshake — no modo proxy o
// gateway precisa NAO configurar cors (o * do nginx cobre o polling, que e
// simple request e nem faz preflight).
describe('wsCorsOptions', () => {
  it('modo normal: origins do corsOrigins', () => {
    expect(wsCorsOptions({ CORS_ORIGINS: 'https://a.com' })).toEqual({ origin: ['https://a.com'] })
  })
  it('modo proxy: undefined (socket.io nao emite ACAO)', () => {
    expect(wsCorsOptions({ CORS_PROXY_SETS_ORIGIN: '1' })).toBeUndefined()
  })
})

// Produção: o `add_header` do nginx SEM a flag `always` só carimba o
// Access-Control-Allow-Origin numa lista fixa de status. Todo erro da API
// volta sem o header, o navegador rejeita o fetch, e o painel não lê nem o
// status nem a mensagem: 'E-mail já cadastrado' e 'data inválida' morrem
// antes da tela. Preencher o COMPLEMENTO dessa lista devolve o erro legível
// sem duplicar o header em status nenhum, porque os conjuntos são disjuntos.
describe('applyCors: preenchimento do allow-origin nas respostas de erro', () => {
  const OLD_PROXY = process.env.CORS_PROXY_SETS_ORIGIN
  const OLD_ERROS = process.env.CORS_PROXY_SETS_ORIGIN_ON_ERRORS
  afterEach(() => {
    if (OLD_PROXY === undefined) delete process.env.CORS_PROXY_SETS_ORIGIN
    else process.env.CORS_PROXY_SETS_ORIGIN = OLD_PROXY
    if (OLD_ERROS === undefined) delete process.env.CORS_PROXY_SETS_ORIGIN_ON_ERRORS
    else process.env.CORS_PROXY_SETS_ORIGIN_ON_ERRORS = OLD_ERROS
  })

  // Espelha o ServerResponse: o writeHead é o ponto por onde o status vira
  // definitivo, e é lá que o header precisa (ou não) ter sido posto.
  const fakeRes = () => {
    const headers: Record<string, string> = {}
    return {
      headers,
      statusCode: 200,
      ended: false,
      setHeader(k: string, v: string) { headers[k] = v },
      end() { (this as any).ended = true },
      writeHead(status: number) { (this as any).statusCode = status; return this },
    }
  }

  const montar = () => {
    const app = { enableCors: jest.fn(), use: jest.fn() }
    applyCors(app as any)
    const middleware = app.use.mock.calls[0][0]
    const res = fakeRes()
    middleware({ method: 'GET' }, res, jest.fn())
    return res
  }

  const despachar = (status: number) => {
    const res = montar()
    ;(res as any).writeHead(status)
    return res
  }

  it('status de erro ganha o header que o nginx não carimba', () => {
    process.env.CORS_PROXY_SETS_ORIGIN = '1'
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 502]) {
      expect(despachar(status).headers['Access-Control-Allow-Origin']).toBe('*')
    }
  })

  it('status coberto pelo nginx NÃO ganha o header (dois valores bloqueiam tudo)', () => {
    process.env.CORS_PROXY_SETS_ORIGIN = '1'
    for (const status of [200, 201, 204, 206, 301, 302, 303, 304, 307, 308]) {
      expect('Access-Control-Allow-Origin' in despachar(status).headers).toBe(false)
    }
  })

  // 202, 203, 205 e 207 são 2xx e mesmo assim ficam FORA da lista do
  // add_header. Tratar '2xx' como sinônimo de 'coberto' deixaria esses mudos.
  it('2xx fora da lista do nginx também é preenchido', () => {
    process.env.CORS_PROXY_SETS_ORIGIN = '1'
    for (const status of [202, 203, 205, 207]) {
      expect(despachar(status).headers['Access-Control-Allow-Origin']).toBe('*')
    }
  })

  // Preflight responde 204, que está na lista do nginx: preencher aqui
  // duplicaria o header justamente na resposta que decide se a requisição
  // real chega a sair da máquina.
  it('preflight segue sem allow-origin (204 está coberto)', () => {
    process.env.CORS_PROXY_SETS_ORIGIN = '1'
    const app = { enableCors: jest.fn(), use: jest.fn() }
    applyCors(app as any)
    const middleware = app.use.mock.calls[0][0]
    const res = fakeRes()
    middleware({ method: 'OPTIONS' }, res, jest.fn())
    ;(res as any).writeHead(res.statusCode)
    expect(res.statusCode).toBe(204)
    expect('Access-Control-Allow-Origin' in res.headers).toBe(false)
  })

  // Se a hospedagem passar a carimbar em erro também (o `always`), os dois se
  // somam e o navegador bloqueia por 'multiple values', voltando ao estado de
  // hoje. A env desliga o preenchimento sem exigir deploy de código.
  it('a env desliga o preenchimento quando o proxy passar a cobrir os erros', () => {
    process.env.CORS_PROXY_SETS_ORIGIN = '1'
    process.env.CORS_PROXY_SETS_ORIGIN_ON_ERRORS = '1'
    expect('Access-Control-Allow-Origin' in despachar(500).headers).toBe(false)
  })

  it('devolve o que o writeHead original devolvia (encadeamento não pode quebrar)', () => {
    process.env.CORS_PROXY_SETS_ORIGIN = '1'
    const res = montar()
    expect((res as any).writeHead(500)).toBe(res)
  })

  // Fora do modo proxy quem emite o header é o enableCors do Nest, que roda
  // como middleware e por isso já alcança as respostas de erro. Embrulhar ali
  // duplicaria.
  it('fora do modo proxy nada é embrulhado', () => {
    delete process.env.CORS_PROXY_SETS_ORIGIN
    const app = { enableCors: jest.fn(), use: jest.fn() }
    applyCors(app as any)
    expect(app.use).not.toHaveBeenCalled()
    expect(app.enableCors).toHaveBeenCalled()
  })
})
