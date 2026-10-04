import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type { PrismaClient } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

// Retenção das chaves de idempotência. A chave só serve enquanto o aparelho
// ainda pode reenviar o mesmo envio; depois disso é peso morto na tabela.

/**
 * 30 dias cobrem com folga um aparelho que passou semanas sem sinal com a
 * fila cheia. Um reenvio que chegue depois disso cria o registro de novo.
 */
export const IDEMPOTENCY_KEY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** 07:00 UTC, madrugada em Brasília, depois das retenções da telemetria (06:30) e das posições (06:45). */
export const IDEMPOTENCY_RETENTION_CRON = '0 0 7 * * *'

export async function purgeExpiredKeys(prisma: Pick<PrismaClient, 'idempotencyKey'>, now: Date): Promise<number> {
  const { count } = await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_KEY_RETENTION_MS) } },
  })
  return count
}

@Injectable()
export class IdempotencyRetentionJob {
  private readonly logger = new Logger(IdempotencyRetentionJob.name)

  constructor(private readonly prisma: PrismaService) {}

  @Cron(IDEMPOTENCY_RETENTION_CRON)
  async run(): Promise<void> {
    try {
      const deleted = await purgeExpiredKeys(this.prisma, new Date())
      this.logger.log(`Retenção de chaves de envio: ${deleted} apagadas`)
    } catch (error) {
      // Melhor esforço: o que ficou de fora entra na rodada de amanhã.
      this.logger.warn(`Retenção de chaves de envio falhou: ${(error as Error).message}`)
    }
  }
}
