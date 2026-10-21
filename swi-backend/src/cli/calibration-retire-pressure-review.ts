// Fecha as revisões de pressão REAIS que ficaram abertas no deploy dos alertas
// calibrados, e resolve o alerta da fila de cada uma. A migration
// 20261023120000_calibrated_alerts cria o motivo PROFILE_RETIRED, mas não pode
// usá-lo na mesma transação; este script roda logo depois dela. Idempotente:
// rodar de novo não acha nada para fechar.
//
// Vive em src/cli, e não em scripts/, para o nest build emitir o JavaScript:
// em produção não há ts-node nem src/, só o dist.
//
//   npm run calibration:retire-pressure-review   (node dist/cli/calibration-retire-pressure-review.js)

// O mesmo primeiro passo do main.ts: sem isto o PrismaClient sobe sem o .env.
import 'dotenv/config'

async function main(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client')
  const { retireBloodPressureReview } = await import('../telemetry/calibration/retire-blood-pressure-review')

  const prisma = new PrismaClient()
  try {
    const { conditions, alerts } = await retireBloodPressureReview(prisma, new Date())
    console.log(`revisão de pressão: ${conditions} condições fechadas, ${alerts} alertas resolvidos`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
