import 'dotenv/config'
import { existsSync, unlinkSync } from 'node:fs'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { applyCors } from './cors'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  applyCors(app)
  if (process.env.NODE_ENV === 'test') {
    new Logger('Bootstrap').warn('Rate limiting DESLIGADO (NODE_ENV=test) — nunca rode a API real com NODE_ENV=test.')
  }
  // Hospedagem Cloudez (deploy 2026-07-29): o nginx deles não faz proxy pra
  // porta TCP, e sim pra um socket Unix fixo da aplicação
  // (etc/nodejs/nodejs.sock). O socket anterior sobrevive a restart do
  // processo e daria EADDRINUSE — remove antes de escutar. Sem a env
  // (Docker local, testes), segue na porta numérica de sempre.
  const socket = process.env.LISTEN_SOCKET
  if (socket) {
    if (existsSync(socket)) unlinkSync(socket)
    await app.listen(socket)
  } else {
    await app.listen(Number(process.env.PORT ?? 3000))
  }
}
void bootstrap()
