// `npm run docs:openapi`: compila com o plugin do Swagger (nest build) e grava
// docs/openapi.json a partir do AppModule real, sem escutar porta nem conectar
// no banco. O teste src/docs/openapi-snapshot.spec.ts falha quando o arquivo
// versionado diverge do que este script geraria, então toda mudança de rota ou
// de DTO termina com uma rodada dele e o JSON no commit.
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { buildOpenApiDocument, OPENAPI_JSON_FILE, prepareOfflineEnv, serializeOpenApi } from './api-docs'

async function main(): Promise<void> {
  prepareOfflineEnv(process.env)
  // Só create, nunca init: os hooks de módulo (Prisma, fila, agendador) não
  // rodam, e o documento depende apenas dos metadados dos controllers.
  const app = await NestFactory.create(AppModule, { logger: false })
  try {
    const output = resolve(__dirname, OPENAPI_JSON_FILE)
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, serializeOpenApi(buildOpenApiDocument(app)))
    process.stdout.write(`OpenAPI gravado em ${output}\n`)
  } finally {
    await app.close()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
