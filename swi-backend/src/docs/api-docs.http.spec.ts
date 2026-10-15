// Prova pela porta, com o SwaggerModule de verdade (sem mock): a UI responde em
// GET /docs e o documento em GET /docs-json, nos caminhos que o README publica.
// Módulo mínimo, sem banco: o que está em jogo é a montagem das rotas.
import { Controller, Get, INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { setupApiDocs } from './api-docs'

@Controller('ping')
class PingController {
  @Get() ping() { return { ok: true } }
}

describe('rotas da documentação', () => {
  let app: INestApplication

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [PingController] }).compile()
    app = mod.createNestApplication({ logger: false })
    setupApiDocs(app, { apiDocs: true })
    await app.init()
  })

  afterAll(async () => { await app.close() })

  it('GET /docs-json devolve o documento OpenAPI', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).toEqual(expect.objectContaining({ openapi: expect.stringMatching(/^3\./), paths: expect.any(Object) }))
    expect(res.body.paths['/ping']).toBeDefined()
  })

  it('GET /docs devolve a UI do Swagger', async () => {
    const res = await request(app.getHttpServer()).get('/docs').expect(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toContain('swagger-ui')
  })

  it('com API_DOCS desligada, as duas rotas não existem', async () => {
    const mod = await Test.createTestingModule({ controllers: [PingController] }).compile()
    const off = mod.createNestApplication({ logger: false })
    setupApiDocs(off, { apiDocs: false })
    await off.init()
    try {
      await request(off.getHttpServer()).get('/docs-json').expect(404)
      await request(off.getHttpServer()).get('/docs').expect(404)
    } finally {
      await off.close()
    }
  })
})
