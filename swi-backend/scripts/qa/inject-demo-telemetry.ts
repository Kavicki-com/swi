// Injeta um cenário de telemetria de demonstração na ingestão REAL, para a
// homologação ver esforço, desgaste e alerta sem relógio no pulso.
//
// Ferramenta de homologação, não recurso: sem tela, sem interruptor, sem agendamento.
// Inerte em produção por código, na primeira linha executável. A origem DEMO
// em todo evento é o rótulo que impede o dado injetado de ser confundido com
// real: o read model separa origens e o app mostra o selo.
//
// Uso (com o backend local de pé e o seed aplicado):
//   QA_DEMO_TELEMETRY=1 npm run qa:demo-telemetry -- --worker <email> [--scenario alerta] [--mode backfill|live]
//
// `backfill` grava o cenário inteiro de uma vez, terminando agora: bom para
// ver o resultado no painel. `live` manda um evento por cadência, em tempo
// real: bom para ver o esforço subir e o alerta abrir na tela.

import { randomBytes, randomUUID } from 'node:crypto'
import {
  assertNotProduction,
  batchesFor,
  SCENARIOS,
  type DemoEvent,
} from '../../src/telemetry/qa/demo-telemetry'

// Antes de qualquer coisa do Nest: os imports do Nest abaixo são dinâmicos de
// propósito, para este gate ser a primeira linha que roda.
assertNotProduction(process.env)

type ScenarioName = keyof typeof SCENARIOS
type Mode = 'backfill' | 'live'

interface Args {
  worker: string
  scenario: ScenarioName
  mode: Mode
}

function parseArgs(argv: readonly string[]): Args {
  const read = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const worker = read('--worker')
  if (!worker) throw new Error('Informe --worker <email do funcionário>')
  const scenario = (read('--scenario') ?? 'alerta') as ScenarioName
  if (!(scenario in SCENARIOS)) {
    throw new Error(`Cenário desconhecido: ${scenario}. Opções: ${Object.keys(SCENARIOS).join(', ')}`)
  }
  const mode = (read('--mode') ?? 'backfill') as Mode
  if (mode !== 'backfill' && mode !== 'live') throw new Error('--mode é backfill ou live')
  return { worker, scenario, mode }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const { NestFactory } = await import('@nestjs/core')
  const { AppModule } = await import('../../src/app.module')
  const { PrismaService } = await import('../../src/prisma/prisma.service')
  const { TelemetryIngestionService } = await import(
    '../../src/telemetry/ingestion/telemetry-ingestion.service'
  )
  const { hashCredential } = await import('../../src/telemetry/devices/device-auth.service')

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  try {
    const prisma = app.get(PrismaService)
    const ingestion = app.get(TelemetryIngestionService)

    const worker = await prisma.user.findUnique({
      where: { email: args.worker },
      select: { id: true, name: true },
    })
    if (worker === null) {
      console.error(`Funcionário não encontrado: ${args.worker}`)
      process.exitCode = 1
      return
    }

    // Um aparelho de demonstração por funcionário, reaproveitado entre rodadas.
    // Tipo IPHONE com modelo QA_DEMO: não há tipo DEMO no enum, e criar um só
    // para este script seria uma migration por um rótulo que nenhuma tela
    // mostra. O que separa demonstração de real é a origem do evento. O
    // segredo é aleatório e não é guardado: este aparelho nunca autentica por
    // HTTP, só por esta chamada interna.
    const device =
      (await prisma.telemetryDevice.findFirst({
        where: { workerId: worker.id, model: 'QA_DEMO', revokedAt: null },
      })) ??
      (await prisma.telemetryDevice.create({
        data: {
          workerId: worker.id,
          kind: 'IPHONE',
          model: 'QA_DEMO',
          credentialHash: hashCredential(randomBytes(32).toString('hex')),
        },
      }))

    const identity = { deviceId: device.id, workerId: worker.id }
    const scenario = SCENARIOS[args.scenario]
    const sessionId = randomUUID()
    console.log(
      `funcionário ${worker.name} (${worker.id}), aparelho ${device.id}, sessão ${sessionId}, cenário ${args.scenario}, modo ${args.mode}`,
    )

    if (args.mode === 'backfill') {
      for (const batch of batchesFor(scenario, { sessionId, endAt: new Date() })) {
        const ack = await ingestion.ingest(identity, batch)
        console.log(
          `lote de ${batch.events.length}: ${ack.acceptedEventIds.length} aceitos, ${ack.duplicateEventIds.length} duplicados, ${ack.conflicts.length} conflitos`,
        )
        for (const conflict of ack.conflicts) console.warn('  conflito:', conflict)
      }
      return
    }

    // live: os mesmos eventos, um por vez, no instante do envio.
    const events = batchesFor(scenario, { sessionId, endAt: new Date() }).flatMap((b) => b.events)
    console.log(`${events.length} eventos, um a cada ${scenario.cadenceSec} s; Ctrl+C encerra`)
    for (const event of events) {
      const live: DemoEvent = { ...event, eventTime: new Date().toISOString() }
      const ack = await ingestion.ingest(identity, { events: [live] })
      if (ack.conflicts.length > 0) console.warn('conflito:', ack.conflicts[0])
      const bpm = live.measurements.heartRate?.value
      process.stdout.write(`\r#${live.sequence} ${bpm === undefined ? 'sem bpm' : `${bpm} bpm`}   `)
      await sleep(scenario.cadenceSec * 1000)
    }
    console.log('\nfim do cenário')
  } finally {
    await app.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
