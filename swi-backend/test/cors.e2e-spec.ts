import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { applyCors } from '../src/cors'

describe('CORS (e2e)', () => {
  let app: INestApplication
  const envAntes = process.env.CORS_ORIGINS

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    // Atribuição direta, NÃO `??=` como o setup-e2e.ts faz com os MINIO_*: lá
    // qualquer valor serve, aqui as asserções dependem desta lista exata, e
    // herdar o .env faria o teste mentir. Restaurado no afterAll porque
    // maxWorkers=1 compartilha o process.env com os specs seguintes.
    process.env.CORS_ORIGINS = 'http://localhost:5173'
    // MESMA função que o main.ts chama (src/main.spec.ts prova a chamada), então
    // o que passa aqui é o CORS que a API real serve.
    applyCors(app)
    await app.init()
  })

  afterAll(async () => {
    if (envAntes === undefined) delete process.env.CORS_ORIGINS
    else process.env.CORS_ORIGINS = envAntes
    await app.close()
  })

  it('responde preflight do origin permitido', async () => {
    const res = await request(app.getHttpServer())
      .options('/work-orders')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('não devolve allow-origin pra origin não listada', async () => {
    const res = await request(app.getHttpServer())
      .options('/work-orders')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'GET')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('GET real do origin permitido carrega o allow-origin (não só o preflight)', async () => {
    const res = await request(app.getHttpServer()).get('/work-orders').set('Origin', 'http://localhost:5173')
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })
})
