import 'dotenv/config'
import { existsSync, unlinkSync } from 'node:fs'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { parseRuntimeEnv } from './config/runtime-env'
import { applyCors } from './cors'

async function bootstrap() {
  // Antes de qualquer coisa: um ambiente de produção incompleto tem que
  // derrubar o boot aqui, e não depois de abrir conexão de banco e porta.
  const env = parseRuntimeEnv(process.env)
  const app = await NestFactory.create(AppModule)
  applyCors(app)
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
