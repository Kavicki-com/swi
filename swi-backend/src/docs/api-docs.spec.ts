// Prova da configuração do Swagger, no padrão do main.spec: o SwaggerModule é
// o alvo das asserções de fiação (ligado/desligado), e o documento em si é
// gerado de verdade sobre um módulo mínimo, porque é nele que mora o que o
// contrato exige: esquema de autenticação e rotas protegidas marcadas.
import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ApiBearerAuth, ApiTags, SwaggerModule } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import type { RuntimeEnv } from '../config/runtime-env'
import { API_DOCS_JSON_PATH, API_DOCS_PATH, BEARER_SCHEME, buildOpenApiDocument, prepareOfflineEnv, serializeOpenApi, setupApiDocs } from './api-docs'

jest.mock('@nestjs/swagger', () => {
  const actual = jest.requireActual<typeof import('@nestjs/swagger')>('@nestjs/swagger')
  return {
    ...actual,
    SwaggerModule: {
      createDocument: jest.fn((...args: Parameters<typeof actual.SwaggerModule.createDocument>) =>
        actual.SwaggerModule.createDocument(...args),
      ),
      setup: jest.fn(),
    },
  }
})

@ApiTags('exemplo')
@Controller('exemplo')
class ExemploController {
  @Get('publica')
  publica() { return { ok: true } }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('protegida')
  protegida() { return { ok: true } }
}

function envWith(apiDocs: boolean): RuntimeEnv {
  return { apiDocs } as unknown as RuntimeEnv
}

describe('documentação OpenAPI', () => {
  let app: INestApplication

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [ExemploController] }).compile()
    app = mod.createNestApplication({ logger: false })
  })

  afterAll(async () => { await app.close() })
  beforeEach(() => jest.clearAllMocks())

  it('serve a UI em /docs e o JSON em /docs-json quando ligada', () => {
    setupApiDocs(app, envWith(true))

    expect(SwaggerModule.setup).toHaveBeenCalledTimes(1)
    const [path, target, document, options] = (SwaggerModule.setup as jest.Mock).mock.calls[0] as [
      string, INestApplication, unknown, { jsonDocumentUrl?: string },
    ]
    expect(path).toBe(API_DOCS_PATH)
    expect(path).toBe('docs')
    expect(target).toBe(app)
    expect(document).toEqual(expect.objectContaining({ openapi: expect.any(String), paths: expect.any(Object) }))
    expect(options.jsonDocumentUrl).toBe(API_DOCS_JSON_PATH)
    expect(options.jsonDocumentUrl).toBe('docs-json')
  })

  it('não monta nada com API_DOCS=0, nem gera o documento', () => {
    setupApiDocs(app, envWith(false))

    expect(SwaggerModule.setup).not.toHaveBeenCalled()
    expect(SwaggerModule.createDocument).not.toHaveBeenCalled()
  })

  it('declara o esquema Bearer JWT que os guards usam', () => {
    const document = buildOpenApiDocument(app)

    expect(document.components?.securitySchemes?.[BEARER_SCHEME]).toEqual(
      expect.objectContaining({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }),
    )
  })

  it('marca como protegida a rota com @ApiBearerAuth e deixa a pública sem exigência', () => {
    const document = buildOpenApiDocument(app)

    expect(document.paths['/exemplo/protegida']?.get?.security).toEqual([{ [BEARER_SCHEME]: [] }])
    expect(document.paths['/exemplo/publica']?.get?.security).toBeUndefined()
    expect(document.paths['/exemplo/publica']?.get?.tags).toEqual(['exemplo'])
  })

  it('serializa de forma estável: JSON indentado com quebra de linha final, para o diff do snapshot ser legível', () => {
    const document = buildOpenApiDocument(app)
    const text = serializeOpenApi(document)

    expect(text).toBe(JSON.stringify(document, null, 2) + '\n')
    expect(serializeOpenApi(buildOpenApiDocument(app))).toBe(text)
  })

  it('prepara um ambiente só para gerar o documento, sem sobrescrever o que já existe', () => {
    const vazio: NodeJS.ProcessEnv = {}
    prepareOfflineEnv(vazio)
    expect(vazio.JWT_SECRET).toEqual(expect.any(String))
    expect(vazio.NODE_ENV).toBe('development')

    const definido: NodeJS.ProcessEnv = { JWT_SECRET: 'meu', NODE_ENV: 'test' }
    prepareOfflineEnv(definido)
    expect(definido).toEqual({ JWT_SECRET: 'meu', NODE_ENV: 'test' })
  })

  it('não tem prefixo global: as rotas ficam na raiz', () => {
    const document = buildOpenApiDocument(app)

    expect(Object.keys(document.paths)).toEqual(['/exemplo/publica', '/exemplo/protegida'])
  })
})
