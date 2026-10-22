import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { requireJwtSecret } from '../src/auth/jwt-secret'
import { PrismaService } from '../src/prisma/prisma.service'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'
import { monitoredDayOf, monitoredDayWindow } from '../src/telemetry/domain/metric-state'

// E2E dos episódios repetidos. O episódio atrasado (abriu e fechou dentro do
// lote da pulseira) segue sem alerta e sem notificação, mas guarda a hora em
// que o lote chegou; o terceiro do mesmo tipo no mesmo dia monitorado abre a
// condição REPEATED_EPISODES, nascida recuperada, com alerta para o gestor.
//
// CNPJ exclusivo deste spec, pelo mesmo motivo dos outros: reusar o do seed
// apagaria a empresa demo.
const CNPJ = '99000000002601'

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

describe('Telemetry repeated episodes e2e', () => {
  let app: INestApplication
  let prisma: PrismaService

  const emails = {
    worker: `telemetry-rep-w-${randomUUID()}@ex.com`,
    admin: `telemetry-rep-admin-${randomUUID()}@ex.com`,
  }
  let workerId = ''
  let adminId = ''
  let deviceHeaders: Record<string, string> = {}

  // O dia de ontem, em horário fixo, como no e2e da pulseira: um "agora menos
  // tanto" perto da meia-noite partiria o lote em dois dias.
  const yesterday = monitoredDayWindow(monitoredDayOf(new Date(Date.now() - DAY_MS))).start
  /** Minutos depois do meio-dia de ontem, em Brasília. */
  const t = (minutes: number) => new Date(yesterday.getTime() + 12 * HOUR_MS + minutes * 60_000)
  // O outro dia monitorado precisa caber no backlog de 48 h e estar no
  // passado: hoje cedo, se já passou das 2 h; senão, a noite de anteontem.
  const today = monitoredDayWindow(monitoredDayOf(new Date())).start
  const otherDayStart =
    Date.now() - today.getTime() >= 2 * HOUR_MS ? today.getTime() + 5 * 60_000 : yesterday.getTime() - HOUR_MS
  const other = (minutes: number) => new Date(otherDayStart + minutes * 60_000)

  let sequence = 0
  const post = (beats: Array<[Date, number]>) =>
    request(app.getHttpServer())
      .post('/telemetry/v1/batches')
      .set(deviceHeaders)
      .send({
        events: beats.map(([at, bpm]) => ({
          eventId: randomUUID(),
          monitoringSessionId: randomUUID(),
          sequence: ++sequence,
          eventTime: at.toISOString(),
          origin: 'REAL',
          measurements: { heartRate: { value: bpm, unit: 'bpm', source: 'HEALTH_CONNECT' } },
        })),
      })
      .expect(200)

  /**
   * Um episódio de batimento alto a cada 10 minutos, a partir de `from`: 200
   * abre (a trava de quem nasceu em 1991 é 165) e 150 fecha, no mesmo lote.
   */
  const highEpisodes = (at: (minutes: number) => Date, from: number, count: number): Array<[Date, number]> =>
    Array.from({ length: count }, (_, i) => [
      [at(from + i * 10), 200] as [Date, number],
      [at(from + i * 10 + 5), 150] as [Date, number],
    ]).flat()

  const bearer = (sub: string) => ({
    Authorization: `Bearer ${new JwtService({ secret: requireJwtSecret() }).sign({ sub, role: 'ADMIN' })}`,
  })
  const historico = () =>
    request(app.getHttpServer()).get(`/telemetry/v1/workers/${workerId}/conditions`).set(bearer(adminId)).expect(200)
  const fila = () => request(app.getHttpServer()).get('/telemetry/v1/admin/alerts').set(bearer(adminId)).expect(200)

  const repeated = (episodeKind: 'HEART_RATE_HIGH' | 'HEART_RATE_LOW') =>
    prisma.telemetryCondition.findMany({
      where: { workerId, kind: 'REPEATED_EPISODES', episodeKind },
      orderBy: { firstSeenAt: 'asc' },
      include: { alert: true },
    })

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    // Profile e notificação não têm cascade.
    await prisma.profile.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } })
    await prisma.notification.deleteMany({ where: { workerId: { in: users.map((u) => u.id) } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)

    await cleanup()

    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyId = (await prisma.company.create({ data: { name: 'Rep Co', cnpj: CNPJ, ...endereco } })).id
    const user = async (email: string, name: string, role: 'WORKER' | 'ADMIN') =>
      (
        await prisma.user.create({
          data: {
            email,
            name,
            passwordHash: 'nao-usado-neste-spec',
            role,
            emailVerified: true,
            approvalStatus: 'APPROVED',
            companyId,
            ...(role === 'WORKER' ? { profile: { create: { birthDate: new Date('1991-05-10T00:00:00.000Z') } } } : {}),
          },
        })
      ).id
    workerId = await user(emails.worker, 'Rep Worker', 'WORKER')
    adminId = await user(emails.admin, 'Rep Admin', 'ADMIN')

    const secret = randomUUID().replace(/-/g, '')
    const device = await prisma.telemetryDevice.create({
      data: { workerId, kind: 'ANDROID_PHONE', credentialHash: hashCredential(secret) },
    })
    deviceHeaders = { Authorization: `Device ${encodeCredential(device.id, secret)}` }
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it('1. dois episódios no dia não abrem nada; cada um guarda a hora em que o lote chegou', async () => {
    const before = Date.now()
    await post(highEpisodes(t, 0, 2))
    const after = Date.now()

    const episodes = await prisma.telemetryCondition.findMany({
      where: { workerId, kind: 'HEART_RATE_HIGH' },
      orderBy: { firstSeenAt: 'asc' },
    })
    expect(episodes).toHaveLength(2)
    for (const episode of episodes) {
      expect(episode.status).toBe('RECOVERED')
      expect(episode.receivedAt?.getTime()).toBeGreaterThanOrEqual(before - 1_000)
      expect(episode.receivedAt?.getTime()).toBeLessThanOrEqual(after + 1_000)
    }
    expect(await repeated('HEART_RATE_HIGH')).toHaveLength(0)
    expect(await prisma.operationalAlert.count({ where: { workerId } })).toBe(0)
  }, 30_000)

  it('2. o terceiro abre episódios repetidos, nascida recuperada, com alerta para o gestor e nada para o funcionário', async () => {
    await post(highEpisodes(t, 20, 1))

    const [condition] = await repeated('HEART_RATE_HIGH')
    expect(condition).toMatchObject({
      status: 'RECOVERED',
      origin: 'REAL',
      observedValue: 3,
      thresholdValue: 3,
      episodeKind: 'HEART_RATE_HIGH',
    })
    // Abre e fecha no instante medido do terceiro episódio.
    expect(condition.firstSeenAt.toISOString()).toBe(t(20).toISOString())
    expect(condition.recoveredAt?.toISOString()).toBe(t(20).toISOString())
    expect(condition.receivedAt).not.toBeNull()
    expect(condition.alert).toMatchObject({ status: 'OPEN', origin: 'REAL' })

    const { body } = await fila()
    const item = body.items.find((i: { id: string }) => i.id === condition.alert?.id)
    expect(item).toMatchObject({
      status: 'OPEN',
      worker: { id: workerId },
      condition: { kind: 'REPEATED_EPISODES', category: 'HEALTH', episodeKind: 'HEART_RATE_HIGH', observedValue: 3 },
    })

    // O sino do gestor recebe; o funcionário não.
    expect(await prisma.notification.count({ where: { workerId: adminId, targetId: condition.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { workerId } })).toBe(0)

    // Não conta para o estado do funcionário: nada ativo na leitura individual.
    const current = await request(app.getHttpServer())
      .get(`/telemetry/v1/workers/${workerId}/current`)
      .set(bearer(adminId))
      .expect(200)
    expect(current.body.conditions).toEqual([])
  }, 30_000)

  it('3. o quarto do mesmo tipo e dia não repete o alerta', async () => {
    await post(highEpisodes(t, 30, 1))

    expect(
      await prisma.telemetryCondition.count({ where: { workerId, kind: 'HEART_RATE_HIGH', status: 'RECOVERED' } }),
    ).toBe(4)
    expect(await repeated('HEART_RATE_HIGH')).toHaveLength(1)
    expect(await prisma.operationalAlert.count({ where: { workerId } })).toBe(1)
  }, 30_000)

  it('4. outro tipo no mesmo dia abre o seu, mesmo com o primeiro alerta pendente', async () => {
    // 30 abre a trava de batimento baixo e 80 fecha, com ou sem repouso medido.
    const lows: Array<[Date, number]> = [0, 1, 2].flatMap((i) => [
      [t(60 + i * 10), 30] as [Date, number],
      [t(60 + i * 10 + 5), 80] as [Date, number],
    ])
    await post(lows)

    const [low] = await repeated('HEART_RATE_LOW')
    expect(low).toMatchObject({ status: 'RECOVERED', observedValue: 3, thresholdValue: 3 })
    expect(low.firstSeenAt.toISOString()).toBe(t(80).toISOString())
    expect(low.alert).toMatchObject({ status: 'OPEN' })
    expect(await repeated('HEART_RATE_HIGH')).toHaveLength(1)
  }, 30_000)

  it('5. o mesmo tipo em outro dia monitorado abre o seu', async () => {
    await post(highEpisodes(other, 0, 3))

    const highs = await repeated('HEART_RATE_HIGH')
    expect(highs).toHaveLength(2)
    expect(new Set(highs.map((c) => monitoredDayOf(c.firstSeenAt).getTime())).size).toBe(2)
    expect(highs.every((c) => c.alert?.status === 'OPEN')).toBe(true)
  }, 30_000)

  it('6. o histórico traz "recebido às" de cada episódio e o tipo repetido', async () => {
    const { body } = await historico()
    type Item = { kind: string; status: string; receivedAt: string | null; episodeKind: string | null; openedAt: string }
    const items: Item[] = body.items

    const episodes = items.filter((i) => i.kind === 'HEART_RATE_HIGH')
    expect(episodes.length).toBeGreaterThanOrEqual(4)
    for (const episode of episodes) {
      expect(episode).toMatchObject({ status: 'RECOVERED', episodeKind: null })
      expect(Date.parse(episode.receivedAt ?? '')).toBeGreaterThan(Date.parse(episode.openedAt))
    }
    const kinds = items
      .filter((i) => i.kind === 'REPEATED_EPISODES')
      .map((i) => i.episodeKind)
      .sort()
    expect(kinds).toEqual(['HEART_RATE_HIGH', 'HEART_RATE_HIGH', 'HEART_RATE_LOW'])
  })
})
