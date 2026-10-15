// Dois contratos sobre o documento OpenAPI da aplicação REAL, gerado em memória
// a partir do AppModule inteiro (sem app.init(): nada conecta no banco, nada
// escuta porta, nenhum cron é agendado).
//
// 1. Drift: o docs/openapi.json versionado tem que ser byte a byte o que o
//    código gera hoje. Quem muda rota ou DTO roda `npm run docs:openapi` e
//    comita o resultado; este teste é o que faz a CI acusar o esquecimento.
// 2. Proteção: toda rota atrás do JwtAuthGuard aparece no documento exigindo
//    o esquema Bearer, a de aparelho exige o esquema do aparelho, e rota
//    pública não exige nada. Quem cria um controller protegido sem
//    @ApiBearerAuth é pego aqui, e não pelo cliente lendo o Swagger.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import type { INestApplication, Type } from '@nestjs/common'
import { ModulesContainer } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { DeviceAuthGuard } from '../telemetry/devices/device-auth.guard'
import { BEARER_SCHEME, DEVICE_SCHEME, buildOpenApiDocument, OPENAPI_JSON_FILE, prepareOfflineEnv, serializeOpenApi } from './api-docs'

// O AppModule inteiro sob ts-jest, com cobertura, leva bem mais que os 5 s
// padrão. A suíte unitária roda em série (--runInBand), então o custo é pago
// uma vez.
jest.setTimeout(120_000)

type Operation = { operationId?: string; security?: Array<Record<string, string[]>> }

function operationsOf(document: OpenAPIObject): Map<string, Operation> {
  const byId = new Map<string, Operation>()
  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item as Record<string, Operation>)) {
      if (operation?.operationId) byId.set(operation.operationId, operation)
    }
  }
  return byId
}

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ?? []
}

function controllersOf(app: INestApplication): Type[] {
  const controllers: Type[] = []
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      if (typeof wrapper.metatype === 'function') controllers.push(wrapper.metatype as Type)
    }
  }
  return controllers
}

function routeMethodsOf(controller: Type): string[] {
  return Object.getOwnPropertyNames(controller.prototype as object).filter((name) => {
    const handler = (controller.prototype as Record<string, unknown>)[name]
    return typeof handler === 'function' && name !== 'constructor' &&
      Reflect.hasMetadata(PATH_METADATA, handler) && Reflect.hasMetadata(METHOD_METADATA, handler)
  })
}

describe('documento OpenAPI da aplicação', () => {
  let app: INestApplication
  let document: OpenAPIObject

  beforeAll(async () => {
    prepareOfflineEnv(process.env)
    const { AppModule } = await import('../app.module')
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication({ logger: false })
    document = buildOpenApiDocument(app)
  })

  afterAll(async () => { await app?.close() })

  it('o docs/openapi.json versionado é o que o código gera (rode npm run docs:openapi)', () => {
    const committed = readFileSync(resolve(__dirname, OPENAPI_JSON_FILE), 'utf8')
    expect(committed).toBe(serializeOpenApi(document))
  })

  it('cobre as rotas que o contrato cita: saúde, login e ingestão de telemetria', () => {
    expect(document.paths['/health']?.get).toBeDefined()
    expect(document.paths['/auth/login']?.post).toBeDefined()
    expect(document.paths['/telemetry/v1/batches']?.post).toBeDefined()
  })

  it('toda rota aparece com a exigência de autenticação do guard que a protege', () => {
    const operations = operationsOf(document)
    const divergences: string[] = []
    for (const controller of controllersOf(app)) {
      const classGuards = guardsOf(controller)
      for (const method of routeMethodsOf(controller)) {
        const handler = (controller.prototype as Record<string, object>)[method]
        const guards = [...classGuards, ...guardsOf(handler)]
        const expected: Array<Record<string, string[]>> = []
        if (guards.includes(JwtAuthGuard)) expected.push({ [BEARER_SCHEME]: [] })
        if (guards.includes(DeviceAuthGuard)) expected.push({ [DEVICE_SCHEME]: [] })

        const id = `${controller.name}_${method}`
        const operation = operations.get(id)
        if (!operation) {
          divergences.push(`${id}: rota sem operação no documento`)
          continue
        }
        const actual = operation.security ?? []
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          divergences.push(`${id}: esperado ${JSON.stringify(expected)}, documento diz ${JSON.stringify(actual)}`)
        }
      }
    }
    expect(divergences).toEqual([])
  })

  it('cada operação tem uma tag, para a UI agrupar por controller', () => {
    const semTag = [...operationsOf(document).values()]
      .filter((operation) => !(operation as { tags?: string[] }).tags?.length)
      .map((operation) => operation.operationId)
    expect(semTag).toEqual([])
  })
})
