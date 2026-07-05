import 'dotenv/config'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  if (process.env.NODE_ENV === 'test') {
    new Logger('Bootstrap').warn('Rate limiting DESLIGADO (NODE_ENV=test) — nunca rode a API real com NODE_ENV=test.')
  }
  await app.listen(Number(process.env.PORT ?? 3000))
}
bootstrap()
