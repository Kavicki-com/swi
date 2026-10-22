import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect() }

  // Devolve o pool no app.close(). Sem isto, cada suíte do e2e (um processo só)
  // deixa as conexões dela abertas até o fim, e a soma estoura o Postgres.
  async onModuleDestroy() { await this.$disconnect() }
}
