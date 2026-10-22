import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import type { JwtUser } from '../src/auth/current-user.decorator'
import { requireJwtSecret } from '../src/auth/jwt-secret'
import { PrismaService } from '../src/prisma/prisma.service'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'
import { monitoredDayOf, monitoredDayWindow } from '../src/telemetry/domain/metric-state'
import { NOT_SENT_AFTER_MS } from '../src/telemetry/read-model/metric-absence'
import { TelemetryQueryService } from '../src/telemetry/read-model/telemetry-query.service'

// E2E da ausência por métrica: o celular Android manda lotes pela rota de
// ingestão com a credencial de verdade, relata o caminho pela rota do relato,
// e a leitura individual e a lista do painel dizem, por métrica sem valor, se
// é "aguardando" ou "não envia". As 24 h não cabem num teste pela rota: a
// leitura é chamada direto no serviço com o instante fixo, contado da primeira
// chegada que o banco gravou, como as varreduras.
//
// CNPJ exclusivo deste spec, pelo mesmo motivo do e2e do pareamento.
const CNPJ = '99000000002501'

const METRICAS = ['heartRate', 'steps', 'activeEnergy', 'energyRatePerHour', 'oxygenSaturation', 'bloodPressure'] as const

describe('Telemetry metric absence e2e', () => {
  let app: INestApplication
  let prisma: PrismaService
  let query: TelemetryQueryService

  const emails = {
    admin: `telemetry-absence-admin-${randomUUID()}@ex.com`,
    android: `telemetry-absence-android-${randomUUID()}@ex.com`,
    semCaminho: `telemetry-absence-sem-caminho-${randomUUID()}@ex.com`,
    iphone: `telemetry-absence-iphone-${randomUUID()}@ex.com`,
  }
  let adminId = ''
  let admin: JwtUser
  let workerAndroid = ''
  let workerSemCaminho = ''
  let workerIphone = ''
  let androidDeviceId = ''
  let androidHeaders: Record<string, string> = {}
  let semCaminhoHeaders: Record<string, string> = {}

  const bearer = (sub: string, role: string) => ({
    Authorization: `Bearer ${new JwtService({ secret: requireJwtSecret() }).sign({ sub, role })}`,
  })

  let sequence = 0
  const event = (eventTime: Date, measurements: object, session = randomUUID()) => ({
    eventId: randomUUID(),
    monitoringSessionId: session,
    sequence: ++sequence,
    eventTime: eventTime.toISOString(),
    origin: 'REAL',
    measurements,
  })
  const beat = (bpm: number) => ({ heartRate: { value: bpm, unit: 'bpm', source: 'HEALTH_CONNECT' } })
  const passos = (n: number) => ({ stepDelta: { value: n, unit: 'steps', source: 'HEALTH_CONNECT' } })
  const pressao = { bloodPressure: { value: { systolic: 118, diastolic: 76 }, unit: 'mmHg', source: 'HEALTH_CONNECT' } }

  /** A rota responde 200 até com evento recusado: o caso só segue com todos aceitos. */
  const enviar = async (headers: Record<string, string>, events: { eventId: string }[]) => {
    const { body } = await request(app.getHttpServer())
      .post('/telemetry/v1/batches')
      .set(headers)
      .send({ events })
      .expect(200)
    expect(body.acceptedEventIds).toEqual(events.map((e) => e.eventId))
  }

  /** Health Connect com leitura permitida e uma sincronização: caminho ativo. */
  const relatoComCaminho = {
    healthConnect: {
      availability: 'AVAILABLE',
      readGranted: true,
      backgroundGranted: true,
      manufacturerPackage: 'com.mi.health',
      lastSyncAt: new Date().toISOString(),
      lastFailure: null,
    },
    bluetooth: { bandChosen: false, listenerState: null, listenerStateSince: null, lastReadingAt: null },
  }

  const minhaLeitura = async (workerId: string) => {
    const { body } = await request(app.getHttpServer())
      .get('/telemetry/v1/me/current')
      .set(bearer(workerId, 'WORKER'))
      .expect(200)
    return body
  }

  /** As ausências das seis métricas, do corpo da rota ou da leitura do serviço. */
  const ausencias = (metrics: object) =>
    Object.fromEntries(METRICAS.map((m) => [m, (metrics as Record<string, { ausencia: unknown }>)[m].ausencia]))

  const daLista = async (workerId: string, now?: Date) => {
    const lista =
      now === undefined
        ? (
            await request(app.getHttpServer())
              .get('/telemetry/v1/admin/workers')
              .set(bearer(adminId, 'ADMIN'))
              .expect(200)
          ).body
        : await query.adminWorkers(admin, now)
    return lista.workers.find((w: { worker: { id: string } }) => w.worker.id === workerId).telemetry
  }

  const aparelho = async (workerId: string, kind: 'ANDROID_PHONE' | 'IPHONE') => {
    const secret = randomUUID().replace(/-/g, '')
    const device = await prisma.telemetryDevice.create({
      data: { workerId, kind, credentialHash: hashCredential(secret) },
    })
    return { id: device.id, headers: { Authorization: `Device ${encodeCredential(device.id, secret)}` } }
  }

  const cleanup = async () => {
    const workers = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    const ids = workers.map((w) => w.id)
    await prisma.profile.deleteMany({ where: { userId: { in: ids } } })
    await prisma.notification.deleteMany({ where: { workerId: { in: ids } } })
    // Cascade a partir do User leva aparelhos, sessões, amostras e snapshot.
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    query = app.get(TelemetryQueryService)

    await cleanup()

    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyId = (await prisma.company.create({ data: { name: 'Absence Co', cnpj: CNPJ, ...endereco } })).id

    const user = async (email: string, role: 'ADMIN' | 'WORKER') =>
      (
        await prisma.user.create({
          data: {
            email,
            name: email,
            passwordHash: 'nao-usado-neste-spec',
            role,
            emailVerified: true,
            approvalStatus: 'APPROVED',
            companyId,
            profile: { create: { birthDate: new Date('1991-05-10T00:00:00.000Z') } },
          },
        })
      ).id

    adminId = await user(emails.admin, 'ADMIN')
    admin = { userId: adminId, role: 'ADMIN', companyId }
    workerAndroid = await user(emails.android, 'WORKER')
    workerSemCaminho = await user(emails.semCaminho, 'WORKER')
    workerIphone = await user(emails.iphone, 'WORKER')

    const android = await aparelho(workerAndroid, 'ANDROID_PHONE')
    androidDeviceId = android.id
    androidHeaders = android.headers
    semCaminhoHeaders = (await aparelho(workerSemCaminho, 'ANDROID_PHONE')).headers
    await aparelho(workerIphone, 'IPHONE')
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  // A ordem importa: cada caso parte do que o anterior gravou no celular.
  describe('celular Android com caminho ativo', () => {
    let primeiraChegada: Date

    it('antes de qualquer amostra, toda métrica está aguardando, na leitura e na lista', async () => {
      await request(app.getHttpServer())
        .put('/telemetry/v1/devices/me/readiness')
        .set(androidHeaders)
        .send(relatoComCaminho)
        .expect(204)

      const todasAguardando = Object.fromEntries(METRICAS.map((m) => [m, 'AWAITING']))
      expect(ausencias((await minhaLeitura(workerAndroid)).metrics)).toEqual(todasAguardando)
      expect(ausencias((await daLista(workerAndroid)).metrics)).toEqual(todasAguardando)
    })

    it('a primeira sincronização com batimento grava a chegada; o que não veio segue aguardando antes das 24 h', async () => {
      await enviar(androidHeaders, [event(new Date(Date.now() - 30 * 60_000), beat(80))])

      const device = await prisma.telemetryDevice.findUniqueOrThrow({ where: { id: androidDeviceId } })
      expect(device.heartRateFirstReceivedAt).not.toBeNull()
      expect(device.bloodPressureFirstReceivedAt).toBeNull()
      primeiraChegada = device.heartRateFirstReceivedAt as Date

      const leitura = await minhaLeitura(workerAndroid)
      expect(leitura.metrics.heartRate.value).toBe(80)
      expect(leitura.metrics.heartRate.ausencia).toBeNull()
      expect(leitura.metrics.bloodPressure.ausencia).toBe('AWAITING')

      const quaseUmDia = new Date(primeiraChegada.getTime() + NOT_SENT_AFTER_MS - 1)
      const antes = await query.currentForWorker(workerAndroid, quaseUmDia)
      expect(antes.metrics.bloodPressure.ausencia).toBe('AWAITING')
    })

    it('24 h exatas depois da primeira sincronização, sem nenhuma amostra desta: não envia', async () => {
      const umDia = new Date(primeiraChegada.getTime() + NOT_SENT_AFTER_MS)

      const leitura = await query.currentForWorker(workerAndroid, umDia)
      expect(ausencias(leitura.metrics)).toEqual({
        heartRate: null,
        steps: 'NOT_SENT',
        activeEnergy: 'NOT_SENT',
        energyRatePerHour: 'NOT_SENT',
        oxygenSaturation: 'NOT_SENT',
        bloodPressure: 'NOT_SENT',
      })
      expect((await daLista(workerAndroid, umDia)).metrics.bloodPressure.ausencia).toBe('NOT_SENT')
    })

    it('a primeira amostra que chega devolve a métrica a valor', async () => {
      await enviar(androidHeaders, [event(new Date(Date.now() - 60_000), pressao)])

      const leitura = await minhaLeitura(workerAndroid)
      expect(leitura.metrics.bloodPressure.value).toEqual({ systolic: 118, diastolic: 76 })
      expect(leitura.metrics.bloodPressure.ausencia).toBeNull()
      const naLista = await daLista(workerAndroid)
      expect(naLista.metrics.bloodPressure.ausencia).toBeNull()
      // Chegou depois das 24 h, e a chegada dela não muda a das outras.
      const device = await prisma.telemetryDevice.findUniqueOrThrow({ where: { id: androidDeviceId } })
      expect(device.heartRateFirstReceivedAt).toEqual(primeiraChegada)
      expect(device.bloodPressureFirstReceivedAt).not.toBeNull()
    })

    it('a métrica que já chegou e some por menos de 24 h volta a aguardando, não a não envia', async () => {
      const agora = new Date()
      await enviar(androidHeaders, [event(new Date(agora.getTime() - 60_000), passos(120))])
      expect((await query.currentForWorker(workerAndroid, agora)).metrics.steps).toMatchObject({
        value: 120,
        ausencia: null,
      })

      // No começo do dia monitorado seguinte o total de passos fica sem valor,
      // menos de 24 h depois da amostra, e muito depois das 24 h da primeira
      // sincronização.
      const { end } = monitoredDayWindow(monitoredDayOf(agora))
      const diaSeguinte = new Date(end.getTime() + 60_000)
      expect((await query.currentForWorker(workerAndroid, diaSeguinte)).metrics.steps).toMatchObject({
        value: null,
        ausencia: 'AWAITING',
      })
    })
  })

  it('celular Android sem caminho ativo: nenhuma métrica diz ausência, mesmo depois das 24 h', async () => {
    await enviar(semCaminhoHeaders, [event(new Date(Date.now() - 30 * 60_000), beat(75))])

    const nenhuma = Object.fromEntries(METRICAS.map((m) => [m, null]))
    expect(ausencias((await minhaLeitura(workerSemCaminho)).metrics)).toEqual(nenhuma)
    const depois = new Date(Date.now() + 2 * NOT_SENT_AFTER_MS)
    expect(ausencias((await query.currentForWorker(workerSemCaminho, depois)).metrics)).toEqual(nenhuma)
    expect(ausencias((await daLista(workerSemCaminho)).metrics)).toEqual(nenhuma)
  })

  it('iPhone: nenhuma métrica diz ausência, na leitura e na lista', async () => {
    const nenhuma = Object.fromEntries(METRICAS.map((m) => [m, null]))
    expect(ausencias((await minhaLeitura(workerIphone)).metrics)).toEqual(nenhuma)
    expect(ausencias((await daLista(workerIphone)).metrics)).toEqual(nenhuma)
  })
})
