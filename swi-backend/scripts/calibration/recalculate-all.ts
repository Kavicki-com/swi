// Recalcula a calibração individual de todos os funcionários com Resumo REAL,
// a mesma rodada do job das 06:45 UTC, sob demanda.
//
// Uso único depois do deploy da calibração: a troca de versão do Resumo refaz
// os dias antigos em rodadas de 30 min, e quando essa fila esvaziar este
// script dá a cada funcionário a calibração com os dias já medidos, sem
// esperar a madrugada. Sem portão de produção de propósito: é em produção que
// ele precisa rodar.
//
//   npm run calibration:recalculate

// O mesmo primeiro passo do main.ts: sem isto o AppModule sobe sem o .env.
import 'dotenv/config'

async function main(): Promise<void> {
  const { NestFactory } = await import('@nestjs/core')
  const { AppModule } = await import('../../src/app.module')
  const { CalibrationService } = await import('../../src/telemetry/calibration/calibration.service')

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  try {
    const { recalculated, failed } = await app.get(CalibrationService).recalculateAll(new Date())
    console.log(`calibração: ${recalculated} funcionários recalculados, ${failed} falharam`)
    if (failed > 0) process.exitCode = 1
  } finally {
    await app.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
