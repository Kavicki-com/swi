import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { requireJwtSecret } from '../src/auth/jwt-secret'
import { PrismaService } from '../src/prisma/prisma.service'
import { RealtimeGateway } from '../src/realtime/realtime.gateway'
import {
  CONDITION_CHANGED_EVENT,
  MAX_NO_NEW_READING_PER_RUN,
  NO_NEW_READING_MS,
  TelemetryConditionService,
} from '../src/telemetry/alerts/condition.service'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'

// E2E do encerramento por vencimento: condição de saúde sem medição nova da
// métrica em 24 h fecha com NO_NEW_READING, o alerta continua na fila, ninguém
// é notificado, e a medição fora da faixa que vem depois abre condição e alerta
// novos. A varredura é chamada direto no serviço com instante fixo, como a de
// silêncio, porque o agendador está desligado no e2e (setup-e2e.ts).
//
// CNPJ exclusivo deste spec, pelo mesmo motivo dos outros: reusar o do seed
// apagaria a empresa demo.
const CNPJ = '99000000002401'
const OUTRO_CNPJ = '99000000002402'

describe('Telemetry no new reading e2e', () => {
  let app: INestApplication
  let prisma: PrismaService
  let conditions: TelemetryConditionService

  const emails = {
    pressao: `telemetry-venc-p-${randomUUID()}@ex.com`,
    batimento: `telemetry-venc-b-${randomUUID()}@ex.com`,
    ciclo: `telemetry-venc-c-${randomUUID()}@ex.com`,
    corrida: `telemetry-venc-r-${randomUUID()}@ex.com`,
    admin: `telemetry-venc-admin-${randomUUID()}@ex.com`,
    outroAdmin: `telemetry-venc-outro-${randomUUID()}@ex.com`,
  }
  let workerPressao = ''
  let workerBatimento = ''
  let workerCiclo = ''
  let workerCorrida = ''
  let adminId = ''
  let outroAdminId = ''
  let headersPressao: Record<string, string> = {}
  let headersBatimento: Record<string, string> = {}
  let headersCiclo: Record<string, string> = {}
  let headersCorrida: Record<string, string> = {}

  const post = (headers: Record<string, string>, body: object) =>
    request(app.getHttpServer()).post('/telemetry/v1/batches').set(headers).send(body)

  // Assina com o mesmo segredo que a estratégia JWT confere; o papel vem do
  // banco a cada requisição, então o token só identifica a pessoa.
  const bearer = (sub: string) => ({
    Authorization: `Bearer ${new JwtService({ secret: requireJwtSecret() }).sign({ sub, role: 'ADMIN' })}`,
  })
  const historico = (workerId: string, as = adminId) =>
    request(app.getHttpServer()).get(`/telemetry/v1/workers/${workerId}/conditions`).set(bearer(as))
  const fila = () => request(app.getHttpServer()).get('/telemetry/v1/admin/alerts').set(bearer(adminId))

  let sequence = 0
  const event = (over: Record<string, unknown> = {}) => ({
    eventId: randomUUID(),
    monitoringSessionId: randomUUID(),
    sequence: ++sequence,
    eventTime: new Date().toISOString(),
    origin: 'REAL',
    ...over,
  })
  const pressaoAlta = (eventTime: Date) => ({
    events: [
      event({
        eventTime: eventTime.toISOString(),
        measurements: {
          bloodPressure: { value: { systolic: 185, diastolic: 112 }, unit: 'mmHg', source: 'EXTERNAL_CUFF' },
        },
      }),
    ],
  })

  /**
   * A varredura não tem recorte por funcionário: ela olha o banco inteiro. Com
   * resto de outra suíte no banco descartável, o teto da rodada poderia deixar
   * a condição deste spec para a rodada seguinte; repetir até a rodada vir
   * abaixo do teto é o que o agendamento faria a cada 30 s.
   */
  const vencer = async (instante: Date) => {
    for (let rodada = 0; rodada < 10; rodada++) {
      const { scanned } = await conditions.sweepNoNewReading(instante)
      if (scanned < MAX_NO_NEW_READING_PER_RUN) return
    }
  }

  const enroll = async (workerId: string) => {
    const secret = randomUUID().replace(/-/g, '')
    const device = await prisma.telemetryDevice.create({
      data: { workerId, kind: 'IPHONE', credentialHash: hashCredential(secret) },
    })
    return { Authorization: `Device ${encodeCredential(device.id, secret)}` }
  }

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    // Profile e notificação não têm cascade.
    await prisma.profile.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } })
    await prisma.notification.deleteMany({ where: { workerId: { in: users.map((u) => u.id) } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: [CNPJ, OUTRO_CNPJ] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    conditions = app.get(TelemetryConditionService)

    await cleanup()

    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyId = (await prisma.company.create({ data: { name: 'Venc Co', cnpj: CNPJ, ...endereco } })).id
    const outraId = (await prisma.company.create({ data: { name: 'Venc Outra', cnpj: OUTRO_CNPJ, ...endereco } })).id

    const user = async (email: string, name: string, role: 'WORKER' | 'ADMIN', company: string) =>
      (
        await prisma.user.create({
          data: {
            email,
            name,
            passwordHash: 'nao-usado-neste-spec',
            role,
            emailVerified: true,
            approvalStatus: 'APPROVED',
            companyId: company,
            ...(role === 'WORKER' ? { profile: { create: { birthDate: new Date('1991-05-10T00:00:00.000Z') } } } : {}),
          },
        })
      ).id

    workerPressao = await user(emails.pressao, 'Venc Pressao', 'WORKER', companyId)
    workerBatimento = await user(emails.batimento, 'Venc Batimento', 'WORKER', companyId)
    workerCiclo = await user(emails.ciclo, 'Venc Ciclo', 'WORKER', companyId)
    workerCorrida = await user(emails.corrida, 'Venc Corrida', 'WORKER', companyId)
    adminId = await user(emails.admin, 'Venc Admin', 'ADMIN', companyId)
    outroAdminId = await user(emails.outroAdmin, 'Venc Outro Admin', 'ADMIN', outraId)

    headersPressao = await enroll(workerPressao)
    headersBatimento = await enroll(workerBatimento)
    headersCiclo = await enroll(workerCiclo)
    headersCorrida = await enroll(workerCorrida)
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  const pressaoAtiva = () =>
    prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerPressao, kind: 'BLOOD_PRESSURE_HIGH', status: 'ACTIVE' },
    })

  it('1. pressão alta sem medição nova vence em 24 h exatas, e não um milissegundo antes', async () => {
    const medidaEm = new Date(Date.now() - 60_000)
    await post(headersPressao, pressaoAlta(medidaEm)).expect(200)
    const aberta = await pressaoAtiva()

    await vencer(new Date(medidaEm.getTime() + NO_NEW_READING_MS - 1))
    expect(await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: aberta.id } })).toMatchObject({
      status: 'ACTIVE',
      recoveryReason: null,
    })

    const notificacoesAntes = await prisma.notification.count({ where: { workerId: workerPressao } })
    const emit = jest.spyOn(app.get(RealtimeGateway), 'emitToUsers')
    const instante = new Date(medidaEm.getTime() + NO_NEW_READING_MS)
    try {
      await vencer(instante)

      expect(await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: aberta.id } })).toMatchObject({
        status: 'RECOVERED',
        recoveryReason: 'NO_NEW_READING',
        recoveredAt: instante,
        lastSeenAt: instante,
      })
      // O painel tira a condição da lista pelo evento de sempre.
      expect(emit).toHaveBeenCalledWith(
        expect.arrayContaining([workerPressao, adminId]),
        CONDITION_CHANGED_EVENT,
        expect.objectContaining({ conditionId: aberta.id, change: 'RECOVERED', at: instante.toISOString() }),
      )
    } finally {
      emit.mockRestore()
    }
    // "Sua condição foi encerrada" seria lido como melhora: nem funcionário nem gestor.
    expect(await prisma.notification.count({ where: { workerId: workerPressao } })).toBe(notificacoesAntes)
  }, 30_000)

  it('2. o alerta da condição vencida continua aberto na fila, com o motivo', async () => {
    const alerta = await prisma.operationalAlert.findFirstOrThrow({
      where: { workerId: workerPressao, condition: { kind: 'BLOOD_PRESSURE_HIGH' } },
      include: { condition: true },
    })
    expect(alerta.status).toBe('OPEN')
    expect(alerta.condition.recoveryReason).toBe('NO_NEW_READING')

    const { body } = await fila().expect(200)
    const item = body.items.find((i: { id: string }) => i.id === alerta.id)
    expect(item).toMatchObject({ status: 'OPEN', condition: { recoveryReason: 'NO_NEW_READING' } })
  })

  it('3. a próxima pressão alta abre condição e alerta novos, sem ser engolida', async () => {
    const vencida = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerPressao, kind: 'BLOOD_PRESSURE_HIGH', recoveryReason: 'NO_NEW_READING' },
    })

    await post(headersPressao, pressaoAlta(new Date())).expect(200)

    const nova = await pressaoAtiva()
    expect(nova.id).not.toBe(vencida.id)
    const alertas = await prisma.operationalAlert.findMany({
      where: { workerId: workerPressao, status: 'OPEN', condition: { kind: 'BLOOD_PRESSURE_HIGH' } },
      select: { conditionId: true },
    })
    expect(alertas.map((a) => a.conditionId).sort()).toEqual([vencida.id, nova.id].sort())
  }, 30_000)

  it('4. o histórico do perfil traz abertas e fechadas com o motivo, só para o painel da empresa', async () => {
    const { body } = await historico(workerPressao).expect(200)
    const altas = body.items.filter((i: { kind: string }) => i.kind === 'BLOOD_PRESSURE_HIGH')
    // Mais nova primeiro: a aberta agora, depois a vencida.
    expect(altas.map((i: { status: string; recoveryReason: string | null }) => [i.status, i.recoveryReason])).toEqual([
      ['ACTIVE', null],
      ['RECOVERED', 'NO_NEW_READING'],
    ])
    expect(altas[1]).toMatchObject({ category: 'URGENT', origin: 'REAL', observedValue: 185 })
    expect(body.nextCursor).toBeNull()

    await historico(workerPressao, outroAdminId).expect(404)
  })

  it('5. condição fechada pelo silêncio guarda o motivo do silêncio; perda de sinal nunca vence', async () => {
    // Batimento alto ao vivo por 60 s abre a condição; o relógio cala.
    const sessao = randomUUID()
    const fim = Date.now()
    await post(headersBatimento, {
      events: Array.from({ length: 13 }, (_, i) =>
        event({
          monitoringSessionId: sessao,
          eventTime: new Date(fim - (12 - i) * 5_000).toISOString(),
          measurements: { heartRate: { value: 185, unit: 'bpm', source: 'APPLE_WATCH' } },
        }),
      ),
    }).expect(200)
    const batimento = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerBatimento, kind: 'HEART_RATE_HIGH', status: 'ACTIVE' },
    })
    await prisma.telemetrySnapshot.update({
      where: { workerId: workerBatimento },
      data: { lastEventTime: new Date(fim - 5 * 60_000), lastLiveEventTime: new Date(fim - 5 * 60_000) },
    })
    await conditions.sweepSilentSessions(new Date())
    const porSilencio = await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: batimento.id } })
    expect(porSilencio.recoveryReason).toBe('SIGNAL_LOST')

    await vencer(new Date(fim + NO_NEW_READING_MS + 60 * 60_000))

    expect(await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: batimento.id } })).toMatchObject({
      recoveryReason: 'SIGNAL_LOST',
      recoveredAt: porSilencio.recoveredAt,
    })
    expect(
      await prisma.telemetryCondition.count({
        where: { workerId: workerBatimento, kind: 'DEVICE_SIGNAL_LOST', status: 'ACTIVE' },
      }),
    ).toBe(1)

    const { body } = await historico(workerBatimento).expect(200)
    expect(body.items.find((i: { id: string }) => i.id === batimento.id)).toMatchObject({
      status: 'RECOVERED',
      recoveryReason: 'SIGNAL_LOST',
    })
  }, 30_000)

  // Batimento normal ao vivo pelo relógio: a outra métrica que mantém os lotes
  // chegando a cada poucos segundos, e cada lote reavalia as condições.
  const batimentoNormal = () => {
    const sessao = randomUUID()
    const fim = Date.now()
    return {
      events: Array.from({ length: 3 }, (_, i) =>
        event({
          monitoringSessionId: sessao,
          eventTime: new Date(fim - (2 - i) * 5_000).toISOString(),
          measurements: { heartRate: { value: 80, unit: 'bpm', source: 'APPLE_WATCH' } },
        }),
      ),
    }
  }
  const PRESSAO = ['BLOOD_PRESSURE_REVIEW', 'BLOOD_PRESSURE_FATIGUE', 'BLOOD_PRESSURE_HIGH'] as const
  const rastro = async (workerId: string) => ({
    condicoes: await prisma.telemetryCondition.count({ where: { workerId, kind: { in: [...PRESSAO] } } }),
    alertas: await prisma.operationalAlert.count({ where: { workerId } }),
    notificacoes: await prisma.notification.count({ where: { workerId, domain: 'health' } }),
  })

  it('6. pressão alta medida há 40 h não reabre a cada lote do relógio: nem condição, nem alerta, nem notificação', async () => {
    // A varredura fecha a condição sem medição em 24 h. Se a avaliação
    // aceitasse pressão mais velha que isso, cada lote de batimento reabriria
    // a condição com a mesma medição velha, a varredura a fecharia, e cada
    // abertura notificaria o funcionário e a administração.
    await post(headersCiclo, pressaoAlta(new Date(Date.now() - 40 * 60 * 60_000))).expect(200)

    for (let lote = 0; lote < 3; lote++) {
      await post(headersCiclo, batimentoNormal()).expect(200)
      await vencer(new Date())
    }

    expect(await rastro(workerCiclo)).toEqual({ condicoes: 0, alertas: 0, notificacoes: 0 })
  }, 60_000)

  it('7. a medição que a varredura já julgou vencida não reabre a condição no lote seguinte', async () => {
    // Condição aberta por uma pressão recente e vencida pela varredura num
    // instante 24 h depois da medição: a varredura julgou aquela medição
    // vencida, então o lote de batimento que chega em seguida não a reabre.
    const medidaEm = new Date(Date.now() - 60_000)
    await post(headersCorrida, pressaoAlta(medidaEm)).expect(200)
    const aberta = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerCorrida, kind: 'BLOOD_PRESSURE_HIGH', status: 'ACTIVE' },
    })
    await vencer(new Date(medidaEm.getTime() + NO_NEW_READING_MS))
    const antes = await rastro(workerCorrida)

    await post(headersCorrida, batimentoNormal()).expect(200)

    expect(await rastro(workerCorrida)).toEqual(antes)
    expect(
      await prisma.telemetryCondition.count({
        where: { workerId: workerCorrida, kind: { in: [...PRESSAO] }, status: 'ACTIVE' },
      }),
    ).toBe(0)
    expect(await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: aberta.id } })).toMatchObject({
      status: 'RECOVERED',
      recoveryReason: 'NO_NEW_READING',
    })
  }, 60_000)
})
