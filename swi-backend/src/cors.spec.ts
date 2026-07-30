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
