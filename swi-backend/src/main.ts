import 'dotenv/config'
import { existsSync, unlinkSync } from 'node:fs'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { logLevelsFor } from './config/log-levels'
import { parseRuntimeEnv } from './config/runtime-env'
import { applyCors } from './cors'
import { setupApiDocs } from './docs/api-docs'

async function bootstrap() {
  // Antes de qualquer coisa: um ambiente de produção incompleto tem que
  // derrubar o boot aqui, e não depois de abrir conexão de banco e porta.
  const env = parseRuntimeEnv(process.env)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: logLevelsFor(env.nodeEnv) })
  // A API fica atrás do nginx, que encaminha por 127.0.0.1 e acrescenta o
  // cliente ao X-Forwarded-For. Sem isto `req.ip` é o endereço do proxy, e o
  // limite de requisições e a trilha de auditoria contam todo mundo como um IP
  // só. Só o loopback é confiável: um X-Forwarded-For vindo de fora é ignorado.
  app.set('trust proxy', 'loopback')
  applyCors(app)
  // Swagger em /docs e /docs-json. Antes de escutar, como o CORS: a página só
  // vale se existir desde a primeira requisição.
  setupApiDocs(app, env)
  if (env.nodeEnv === 'test') {
    new Logger('Bootstrap').warn('Rate limiting DESLIGADO (NODE_ENV=test) — nunca rode a API real com NODE_ENV=test.')
  }
  // Hospedagem atual: o nginx dela não faz proxy pra
  // porta TCP, e sim pra um socket Unix fixo da aplicação
  // (etc/nodejs/nodejs.sock). O socket anterior sobrevive a restart do
  // processo e daria EADDRINUSE — remove antes de escutar. Sem a env
  // (Docker local, testes), segue na porta numérica de sempre.
  const socket = env.listenSocket
  if (socket) {
    if (existsSync(socket)) unlinkSync(socket)
    await app.listen(socket)
  } else {
    await app.listen(env.port)
  }
}
void bootstrap()
