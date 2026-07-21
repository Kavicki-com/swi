import 'dotenv/config'
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
  await app.listen(Number(process.env.PORT ?? 3000))
}
bootstrap()
