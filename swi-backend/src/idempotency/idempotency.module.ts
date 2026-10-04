import { Module } from '@nestjs/common'
import { IdempotencyRetentionJob } from './idempotency-retention.job'

// Só o agendamento da retenção. A escrita protegida (write-once.ts) é função
// pura que recebe o prisma, então os serviços não precisam injetar nada.
// Importado pelos módulos que usam a chave: o Nest instancia o módulo uma vez
// só, e o job não roda em dobro.
@Module({ providers: [IdempotencyRetentionJob] })
export class IdempotencyModule {}
