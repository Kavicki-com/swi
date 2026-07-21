import { Logger } from '@nestjs/common'
import { applyCors, corsOrigins } from './cors'

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
