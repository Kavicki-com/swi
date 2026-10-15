// Documentação OpenAPI da API, exigida pela entrega do contrato: interface
// Swagger em /docs e documento JSON em /docs-json, servidos pela própria API.
//
// Os esquemas dos DTOs não são anotados à mão: o plugin do @nestjs/swagger
// (nest-cli.json e, nos testes, jest.swagger-plugin.js) os deriva dos
// decoradores do class-validator em tempo de compilação. O que fica declarado
// aqui é o que nenhum plugin deduz: metadados do documento, esquemas de
// autenticação e os caminhos das duas rotas.
import { randomBytes } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger'
import type { RuntimeEnv } from '../config/runtime-env'

export const API_DOCS_PATH = 'docs'
export const API_DOCS_JSON_PATH = 'docs-json'

/**
 * Cópia versionada do documento, relativa a este arquivo. O mesmo caminho vale
 * de src/docs (teste) e de dist/docs (script): os dois ficam dois níveis
 * abaixo da raiz do pacote.
 */
export const OPENAPI_JSON_FILE = '../../docs/openapi.json'

/**
 * Nome do esquema Bearer JWT. É o default de `@ApiBearerAuth()`, então todo
 * controller protegido pelo JwtAuthGuard o referencia sem repetir o nome.
 */
export const BEARER_SCHEME = 'bearer'

/**
 * Credencial do aparelho na ingestão de telemetria (`Authorization: Device
 * <id>:<segredo>`). Não é Bearer: o esquema é próprio, e o OpenAPI só o
 * descreve como chave no cabeçalho Authorization.
 */
export const DEVICE_SCHEME = 'device'

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('SWI API')
    .setDescription(
      'API do SWI (painel administrativo e aplicativo do colaborador). ' +
        'Rotas protegidas exigem `Authorization: Bearer <JWT>` obtido em `POST /auth/login`; ' +
        'a ingestão de telemetria usa a credencial do aparelho (`Authorization: Device <id>:<segredo>`).',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT emitido por POST /auth/login' },
      BEARER_SCHEME,
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description: 'Credencial do aparelho pareado, no formato `Device <id>:<segredo>`',
      },
      DEVICE_SCHEME,
    )
    .build()
  return SwaggerModule.createDocument(app, config)
}

/**
 * Monta as rotas de documentação quando a flag permite. Chamado pelo bootstrap
 * antes de escutar; com API_DOCS=0 nem o documento é gerado.
 */
export function setupApiDocs(app: INestApplication, env: Pick<RuntimeEnv, 'apiDocs'>): void {
  if (!env.apiDocs) return
  const document = buildOpenApiDocument(app)
  SwaggerModule.setup(API_DOCS_PATH, app, document, { jsonDocumentUrl: API_DOCS_JSON_PATH })
}

/**
 * Texto exato que vai para docs/openapi.json. Um formato só, usado pelo gerador
 * e pelo teste de snapshot: indentado para o diff de uma mudança de rota ser
 * legível na revisão, e com quebra de linha final como todo arquivo do repo.
 */
export function serializeOpenApi(document: OpenAPIObject): string {
  return JSON.stringify(document, null, 2) + '\n'
}

/**
 * Ambiente mínimo para montar o AppModule sem subir nada. O JwtModule exige
 * JWT_SECRET ao compilar o módulo, mesmo que nenhum token vá ser assinado; o
 * valor é descartável e sorteado para nunca virar segredo de verdade. Nada é
 * sobrescrito: quem já tem .env continua com o dele.
 */
export function prepareOfflineEnv(source: NodeJS.ProcessEnv): void {
  source.NODE_ENV ??= 'development'
  source.JWT_SECRET ??= `openapi-descartavel-${randomBytes(24).toString('hex')}`
}
