import { ArgumentsHost, Controller, Get, INestApplication, Logger, NotFoundException } from '@nestjs/common'
import { APP_FILTER, type HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { Prisma } from '@prisma/client'
import request from 'supertest'
import { UnhandledErrorFilter } from './unhandled-error.filter'

const SEGREDO = 'allergies: "amendoim"'

const setup = () => {
  const reply = jest.fn()
  const adapter = { reply, isHeadersSent: () => false, end: jest.fn() }
  const filter = new UnhandledErrorFilter()
  // O Nest injeta o adaptador por propriedade quando o filtro entra como
  // APP_FILTER; aqui ele entra à mão.
  ;(filter as unknown as { httpAdapterHost: HttpAdapterHost }).httpAdapterHost = {
    httpAdapter: adapter,
  } as unknown as HttpAdapterHost
  const response = {}
  const host = {
    getArgByIndex: (index: number) => (index === 1 ? response : undefined),
    getType: () => 'http',
  } as unknown as ArgumentsHost
  return { filter, host, reply, response }
}

describe('UnhandledErrorFilter', () => {
  let error: jest.SpyInstance
  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  const logged = () => JSON.stringify(error.mock.calls)

  it('erro do Prisma responde 500 e registra só tipo e código', () => {
    const { filter, host, reply, response } = setup()
    const exception = new Prisma.PrismaClientKnownRequestError(`Invalid invocation { ${SEGREDO} }`, {
      code: 'P2003',
      clientVersion: 'teste',
    })

    filter.catch(exception, host)

    expect(reply).toHaveBeenCalledWith(response, { statusCode: 500, message: 'Internal server error' }, 500)
    expect(logged()).toContain('PrismaClientKnownRequestError P2003')
    expect(logged()).not.toContain('amendoim')
  })

  it('erro de validação do Prisma não leva os argumentos para o log', () => {
    const { filter, host } = setup()
    filter.catch(new Prisma.PrismaClientValidationError(`Argument: { ${SEGREDO} }`, { clientVersion: 'teste' }), host)
    expect(logged()).toContain('PrismaClientValidationError')
    expect(logged()).not.toContain('amendoim')
  })

  // Fora do Prisma a mensagem fica: é o que permite investigar um 500.
  it('erro comum segue com a mensagem no log e 500 na resposta', () => {
    const { filter, host, reply, response } = setup()
    filter.catch(new Error('bucket indisponível'), host)
    expect(reply).toHaveBeenCalledWith(response, { statusCode: 500, message: 'Internal server error' }, 500)
    expect(logged()).toContain('bucket indisponível')
  })

  it('exceção HTTP responde como antes e não vira erro no log', () => {
    const { filter, host, reply, response } = setup()
    filter.catch(new NotFoundException('Usuário não encontrado'), host)
    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 404, message: 'Usuário não encontrado', error: 'Not Found' },
      404,
    )
    expect(error).not.toHaveBeenCalled()
  })
})

@Controller('falha')
class FalhaController {
  @Get('prisma')
  prisma(): never {
    throw new Prisma.PrismaClientValidationError(`Argument: { ${SEGREDO} }`, { clientVersion: 'teste' })
  }

  @Get('http')
  http(): never {
    throw new NotFoundException('Usuário não encontrado')
  }
}

// Prova de fiação. Os casos acima entregam o adaptador HTTP à mão; aqui o
// filtro entra como APP_FILTER, do jeito que o AppModule registra, e o Nest é
// quem injeta. Um registro errado passaria nos casos acima e falharia aqui.
describe('UnhandledErrorFilter registrado como APP_FILTER', () => {
  let app: INestApplication
  let error: jest.SpyInstance

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [FalhaController],
      providers: [{ provide: APP_FILTER, useClass: UnhandledErrorFilter }],
    }).compile()
    app = mod.createNestApplication()
    await app.init()
  })
  afterAll(async () => {
    await app.close()
  })
  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('erro do Prisma numa rota responde 500 sem os argumentos, no corpo e no log', async () => {
    const r = await request(app.getHttpServer()).get('/falha/prisma').expect(500)
    expect(r.body).toEqual({ statusCode: 500, message: 'Internal server error' })
    const logged = JSON.stringify(error.mock.calls)
    expect(logged).toContain('PrismaClientValidationError')
    expect(logged).not.toContain('amendoim')
  })

  it('exceção HTTP numa rota responde como antes', async () => {
    const r = await request(app.getHttpServer()).get('/falha/http').expect(404)
    expect(r.body).toEqual({ statusCode: 404, message: 'Usuário não encontrado', error: 'Not Found' })
    expect(error).not.toHaveBeenCalled()
  })
})
