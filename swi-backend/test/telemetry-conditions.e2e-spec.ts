import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { requireJwtSecret } from '../src/auth/jwt-secret'
import type { JwtUser } from '../src/auth/current-user.decorator'
import { PrismaService } from '../src/prisma/prisma.service'
import {
  ALERT_PROFILE_VERSION,
  CALIBRATED_ALERT_PROFILE,
  CALIBRATED_ALERT_PROFILE_VERSION,
  EXPERIMENTAL_ALERT_PROFILE,
} from '../src/telemetry/alerts/alert-profile'
import { CALIBRATION_VERSION } from '../src/telemetry/calibration/calibration-bands'
import { TelemetryConditionService } from '../src/telemetry/alerts/condition.service'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'
import { monitoredDayOf } from '../src/telemetry/domain/metric-state'
import { SUMMARIZER_VERSION } from '../src/telemetry/lifecycle/telemetry-summarizer'
import { TelemetryQueryService } from '../src/telemetry/read-model/telemetry-query.service'

// E2E do motor de condições. Os 87 unitários rodam todos contra dublê de
// Prisma, e três invariantes centrais desta fatia não existem em TypeScript
// nenhum: eles são do banco.
//
//   1. O índice único parcial (workerId, kind, origin) WHERE status = 'ACTIVE',
//      que é o que impede duas condições ativas iguais.
//   2. O ON CONFLICT DO NOTHING da abertura, que existe para a transação nunca
//      abortar e levar junto recuperações já gravadas.
//   3. O lock consultivo por funcionário e origem, que substituiu um lock de
//      linha de sessão porque o invariante é por FUNCIONÁRIO, não por sessão.
//
// O primeiro achado desta suíte apareceu antes do primeiro caso: o lock
// chamava $queryRaw sobre pg_advisory_xact_lock, que devolve void, e estourava
// em toda chamada. O motor inteiro era um no-op, com a suíte verde. Nenhum
// dublê podia pegar isso, porque nele $queryRaw é função simulada.
//
// CNPJ exclusivo deste spec. Reusar o do seed apagaria a empresa demo e
// desvincularia os usuários dela, porque User.companyId é opcional e o Prisma
// aplica SetNull.
const CNPJ = '99000000000303'
const OUTRO_CNPJ = '99000000000304'

describe('Telemetry conditions e2e', () => {
  let app: INestApplication
  let prisma: PrismaService
  let query: TelemetryQueryService
  let conditions: TelemetryConditionService

  const emails = {
    a: `telemetry-cond-a-${randomUUID()}@ex.com`,
    b: `telemetry-cond-b-${randomUUID()}@ex.com`,
    semNascimento: `telemetry-cond-c-${randomUUID()}@ex.com`,
    demo: `telemetry-cond-d-${randomUUID()}@ex.com`,
    calibrado: `telemetry-cond-e-${randomUUID()}@ex.com`,
    trava: `telemetry-cond-f-${randomUUID()}@ex.com`,
    desgaste: `telemetry-cond-g-${randomUUID()}@ex.com`,
    oxigenio: `telemetry-cond-h-${randomUUID()}@ex.com`,
    oxigenioSemFaixa: `telemetry-cond-i-${randomUUID()}@ex.com`,
    admin: `telemetry-cond-admin-${randomUUID()}@ex.com`,
    outroAdmin: `telemetry-cond-outro-admin-${randomUUID()}@ex.com`,
  }
  let workerA = ''
  let workerB = ''
  let workerSemNascimento = ''
  let workerDemo = ''
  let workerCalibrado = ''
  let workerTrava = ''
  let workerDesgaste = ''
  let workerOxigenio = ''
  let workerOxigenioSemFaixa = ''
  let admin: JwtUser = { userId: '', role: 'ADMIN', companyId: null }
  let headersA: Record<string, string> = {}
  let headersB: Record<string, string> = {}
  let headersSemNascimento: Record<string, string> = {}
  let headersDemo: Record<string, string> = {}
  let headersCalibrado: Record<string, string> = {}
  let headersTrava: Record<string, string> = {}
  let headersDesgaste: Record<string, string> = {}
  let headersOxigenio: Record<string, string> = {}
  let headersOxigenioSemFaixa: Record<string, string> = {}

  /**
   * 185 bpm serve aos dois limites de propósito. Para quem nasceu em 1991 a
   * máxima por idade (Tanaka) dá 183,5, e 90% arredondado dá 165, regra
   * PERSONALIZED; para quem não tem data de nascimento o limite é o piso de
   * 180, regra FLOOR. O mesmo valor abre os dois, e a única diferença entre os
   * casos 1 e 5 passa a ser o cadastro, que é o que se quer provar.
   */
  const SUSTAINED_BPM = 185
  const LIMITE_PERSONALIZADO = 165
  const LIMITE_PISO = CALIBRATED_ALERT_PROFILE.heartRateHigh.floorBpm

  const post = (headers: Record<string, string>, body: object) =>
    request(app.getHttpServer()).post('/telemetry/v1/batches').set(headers).send(body)

  let sequence = 0
  const event = (over: Record<string, unknown> = {}) => ({
    eventId: randomUUID(),
    monitoringSessionId: randomUUID(),
    sequence: ++sequence,
    eventTime: new Date().toISOString(),
    origin: 'REAL',
    measurements: { heartRate: { value: SUSTAINED_BPM, unit: 'bpm', source: 'APPLE_WATCH' } },
    ...over,
  })

  /**
   * Treze eventos a cada 5 s cobrindo os últimos 60 s, todos com o mesmo
   * batimento. É o formato que o motor EXIGE, e nenhuma das três exigências
   * dele é opcional: toda a janela tem de satisfazer o predicado, o trecho
   * entre a primeira e a última amostra tem de cobrir 45 s, e nenhum vão entre
   * amostras consecutivas pode passar de 15 s. Um lote curto passaria pelo vão
   * e morreria no trecho; duas amostras nas pontas passariam pelo trecho e não
   * provariam 45 s de nada. Densidade e comprimento, os dois.
   *
   * `fimMs` existe só para o caso do backlog, que precisa da mesma série densa
   * carimbada dias atrás.
   */
  const sustainedBatch = (session: string, over: Record<string, unknown> = {}, fimMs = Date.now()) => ({
    events: Array.from({ length: 13 }, (_, i) =>
      event({
        monitoringSessionId: session,
        eventTime: new Date(fimMs - (12 - i) * 5_000).toISOString(),
        ...over,
      }),
    ),
  })

  /** Eventos a cada 5 s cobrindo os últimos `minutos`, todos com o mesmo batimento. */
  const minutesBatch = (session: string, minutos: number, bpm: number) => ({
    events: Array.from({ length: minutos * 12 + 1 }, (_, i) =>
      event({
        monitoringSessionId: session,
        eventTime: new Date(Date.now() - (minutos * 12 - i) * 5_000).toISOString(),
        measurements: { heartRate: { value: bpm, unit: 'bpm', source: 'APPLE_WATCH' } },
      }),
    ),
  })

  const enroll = async (workerId: string) => {
    const secret = randomUUID().replace(/-/g, '')
    const device = await prisma.telemetryDevice.create({
      data: { workerId, kind: 'IPHONE', credentialHash: hashCredential(secret) },
    })
    return { Authorization: `Device ${encodeCredential(device.id, secret)}` }
  }

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    // Profile não tem cascade: apagar o funcionário sem apagar o perfil antes
    // viola a chave estrangeira e deixa lixo entre execuções.
    await prisma.profile.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } })
    // Notificação também não tem cascade, e condição aberta passa a gerar uma.
    await prisma.notification.deleteMany({ where: { workerId: { in: users.map((u) => u.id) } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: [CNPJ, OUTRO_CNPJ] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    query = app.get(TelemetryQueryService)
    conditions = app.get(TelemetryConditionService)

    await cleanup()

    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyId = (await prisma.company.create({ data: { name: 'Cond Co', cnpj: CNPJ, ...endereco } })).id

    const worker = async (email: string, name: string, birthDate: Date | null) =>
      (
        await prisma.user.create({
          data: {
            email,
            name,
            passwordHash: 'nao-usado-neste-spec',
            role: 'WORKER',
            emailVerified: true,
            approvalStatus: 'APPROVED',
            companyId,
            profile: { create: { birthDate } },
          },
        })
      ).id

    const nascimento = new Date('1991-05-10T00:00:00.000Z')
    workerA = await worker(emails.a, 'Cond A', nascimento)
    workerB = await worker(emails.b, 'Cond B', nascimento)
    workerSemNascimento = await worker(emails.semNascimento, 'Cond C', null)
    workerDemo = await worker(emails.demo, 'Cond D', null)
    workerCalibrado = await worker(emails.calibrado, 'Cond E', nascimento)
    workerTrava = await worker(emails.trava, 'Cond F', nascimento)
    workerDesgaste = await worker(emails.desgaste, 'Cond G', nascimento)
    workerOxigenio = await worker(emails.oxigenio, 'Cond H', nascimento)
    workerOxigenioSemFaixa = await worker(emails.oxigenioSemFaixa, 'Cond I', nascimento)

    // O administrador entra pelo serviço, e não por login: adminSummary só olha
    // o companyId do token, e o que este spec exercita é o contador do painel,
    // não a autenticação, que já tem suíte própria. A empresa é a mesma dos
    // quatro, senão a população do painel seria vazia.
    admin = {
      userId: (
        await prisma.user.create({
          data: {
            email: emails.admin,
            name: 'Cond Admin',
            passwordHash: 'nao-usado-neste-spec',
            role: 'ADMIN',
            emailVerified: true,
            approvalStatus: 'APPROVED',
            companyId,
          },
        })
      ).id,
      role: 'ADMIN',
      companyId,
    }

    headersA = await enroll(workerA)
    headersB = await enroll(workerB)
    headersSemNascimento = await enroll(workerSemNascimento)
    headersDemo = await enroll(workerDemo)
    headersCalibrado = await enroll(workerCalibrado)
    headersTrava = await enroll(workerTrava)
    headersDesgaste = await enroll(workerDesgaste)
    headersOxigenio = await enroll(workerOxigenio)
    headersOxigenioSemFaixa = await enroll(workerOxigenioSemFaixa)

    // E está no 10º dia da calibração, com a faixa de fadiga de batimento
    // aprendida em 130 bpm: abaixo da trava pela idade (165), para a Atenção
    // abrir sem a trava junto.
    await prisma.workerCalibration.create({
      data: {
        workerId: workerCalibrado,
        version: CALIBRATION_VERSION,
        deviceFamily: 'WATCH',
        phaseStartedAt: monitoredDayOf(new Date(Date.now() - 12 * 24 * 60 * 60 * 1000)),
        validDays: 9,
        restingBpm: 60,
        peakBpm: 170,
        peakPersonalBpm: 170,
        computedAt: new Date(),
      },
    })
    await prisma.workerCalibrationBand.create({
      data: {
        workerId: workerCalibrado,
        metric: 'HEART_RATE',
        validDays: 9,
        startCuts: { excellence: null, fatigue: 165 },
        learnedCuts: { excellence: 95, fatigue: 130 },
        computedAt: new Date(),
      },
    })

    // H também está no 10º dia, com a faixa de fadiga de oxigenação aprendida
    // em 94%. A oxigenação não tem partida na v1.0: sem esta faixa (como I),
    // só a trava decide.
    await prisma.workerCalibration.create({
      data: {
        workerId: workerOxigenio,
        version: CALIBRATION_VERSION,
        deviceFamily: 'WATCH',
        phaseStartedAt: monitoredDayOf(new Date(Date.now() - 12 * 24 * 60 * 60 * 1000)),
        validDays: 9,
        restingBpm: 60,
        peakBpm: 170,
        peakPersonalBpm: 170,
        computedAt: new Date(),
      },
    })
    await prisma.workerCalibrationBand.create({
      data: {
        workerId: workerOxigenio,
        metric: 'OXYGEN_SATURATION',
        validDays: 9,
        startCuts: { excellence: null, fatigue: null },
        learnedCuts: { excellence: 97, fatigue: 94 },
        computedAt: new Date(),
      },
    })

    // Um dia fechado com batimento mínimo para A e B: é o repouso observado.
    // Ele não muda o limite ALTO, que sai da idade, mas sem ele o limite baixo
    // cairia no piso, e o cadastro dos dois não seria o cadastro completo que o
    // caso 5 contrasta.
    const tresDiasAtras = monitoredDayOf(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
    for (const workerId of [workerA, workerB]) {
      await prisma.telemetryDailySummary.create({
        data: {
          workerId,
          day: tresDiasAtras,
          origin: 'REAL',
          heartRateMin: 62,
          sampleCount: 10,
          summarizerVersion: SUMMARIZER_VERSION,
          computedAt: new Date(),
        },
      })
    }
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  const ativas = (workerId: string) => prisma.telemetryCondition.findMany({ where: { workerId, status: 'ACTIVE' } })

  it('1. lote ao vivo com batimento alto por 60 s abre condição e alerta urgente', async () => {
    const sessao = randomUUID()
    await post(headersA, sustainedBatch(sessao)).expect(200)

    const rows = await prisma.telemetryCondition.findMany({ where: { workerId: workerA } })
    expect(rows).toHaveLength(1)
    const condicao = rows[0]
    expect(condicao.kind).toBe('HEART_RATE_HIGH')
    expect(condicao.status).toBe('ACTIVE')
    expect(condicao.sessionId).toBe(sessao)
    expect(condicao.origin).toBe('REAL')
    // A versão do perfil é o que permite auditar depois com que régua a
    // condição foi aberta. Sem ela, mudar limite apaga a história.
    expect(condicao.thresholdProfile).toBe(CALIBRATED_ALERT_PROFILE_VERSION)
    // A origem REAL segue o perfil calibrado: o batimento alto é trava, e sem
    // valor do admin vale a padrão, pela máxima por idade.
    expect(condicao.thresholdRule).toBe('SAFETY_DEFAULT')
    // Sem calibração gravada, a pessoa está no primeiro dia, e o selo vai junto.
    expect(condicao.calibrationDay).toBe(1)
    expect(condicao.thresholdValue).toBe(LIMITE_PERSONALIZADO)
    expect(condicao.observedValue).toBe(SUSTAINED_BPM)

    const alerta = await prisma.operationalAlert.findUnique({ where: { conditionId: condicao.id } })
    expect(alerta).not.toBeNull()
    expect(alerta?.workerId).toBe(workerA)
    expect(alerta?.origin).toBe('REAL')
    expect(alerta?.status).toBe('OPEN')

    const resumo = await query.adminSummary(admin)
    expect(resumo.urgentAlerts.workers).toBeGreaterThanOrEqual(1)

    // A leitura do funcionário traz a condição aberta, já classificada, com o
    // valor e o limite que a abriram: é daí que app e painel tiram o estado.
    const leitura = await query.currentForWorker(workerA)
    expect(leitura.conditions).toEqual([
      {
        kind: 'HEART_RATE_HIGH',
        category: 'URGENT',
        openedAt: condicao.firstSeenAt.toISOString(),
        observedValue: SUSTAINED_BPM,
        thresholdValue: LIMITE_PERSONALIZADO,
      },
    ])

    // Condição urgente vira notificação de saúde para o funcionário e para a
    // administração, uma por público, com a condição como alvo.
    const doFuncionario = await prisma.notification.findMany({ where: { workerId: workerA, domain: 'health' } })
    expect(doFuncionario).toHaveLength(1)
    expect(doFuncionario[0]).toMatchObject({ targetId: condicao.id, title: 'Batimento acima do limite' })
    const doAdmin = await prisma.notification.findMany({ where: { workerId: admin.userId, domain: 'health', targetId: condicao.id } })
    expect(doAdmin).toHaveLength(1)
    expect(doAdmin[0].title).toMatch(/^Batimento alto: /)
  }, 30_000)

  it('2. dois lotes em paralelo abrem uma condição só', async () => {
    const sessao = randomUUID()

    const [primeiro, segundo] = await Promise.all([
      post(headersB, sustainedBatch(sessao)),
      post(headersB, sustainedBatch(sessao)),
    ])

    // Os dois são aceitos: o lock serializa a AVALIAÇÃO, não a ingestão, e
    // nenhum lote é recusado por causa dele.
    for (const res of [primeiro, segundo]) expect(res.status).toBe(200)

    expect(await ativas(workerB)).toHaveLength(1)
    expect(await prisma.operationalAlert.findMany({ where: { workerId: workerB } })).toHaveLength(1)

    // RESSALVA, e ela importa mais que o caso: isto prova o LOCK e a
    // idempotência do resultado, e NÃO prova o ON CONFLICT DO NOTHING. Com o
    // lock funcionando, quem chega em segundo só lê as condições depois de
    // adquirir o lock, ou seja, depois do commit do primeiro; em READ COMMITTED
    // ele enxerga a linha ativa, decide "já está aberta" e nem chega a tentar
    // inserir. A cláusula de conflito segue sendo rede para um escritor futuro
    // que não passe pelo lock, e quem a exercita é o caso 9, que contorna o
    // lock de propósito. Teste que promete mais do que entrega é pior que
    // teste nenhum.
  }, 30_000)

  it('3. o índice único parcial recusa uma segunda condição ativa igual, direto no banco', async () => {
    // Este caso NÃO passa pelo serviço de propósito: ele prova o BANCO, não o
    // código. Se o índice sumir da migration, todo o resto continua verde e só
    // este fica vermelho, que é exatamente o sinal que se quer.
    const ativa = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerA, status: 'ACTIVE' },
    })

    await expect(
      prisma.telemetryCondition.create({
        data: {
          workerId: ativa.workerId,
          sessionId: ativa.sessionId,
          origin: ativa.origin,
          kind: ativa.kind,
          status: 'ACTIVE',
          firstSeenAt: ativa.firstSeenAt,
          lastSeenAt: ativa.lastSeenAt,
          thresholdProfile: ativa.thresholdProfile,
          thresholdRule: ativa.thresholdRule,
          thresholdValue: ativa.thresholdValue,
          observedValue: ativa.observedValue,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('4. backlog com batimento alto não abre nada', async () => {
    // Condição descreve o AGORA. Uma série densa e sustentada de três dias
    // atrás abriria uma condição com firstSeenAt de agora, jurando 185 bpm
    // neste instante, e a perda de sinal recuperaria com o backlog "provando"
    // que o sinal voltou.
    const tresDiasAtras = Date.now() - 3 * 24 * 60 * 60 * 1000
    await post(headersSemNascimento, sustainedBatch(randomUUID(), {}, tresDiasAtras)).expect(200)

    expect(await prisma.telemetryCondition.count({ where: { workerId: workerSemNascimento } })).toBe(0)
  }, 30_000)

  it('5. sem data de nascimento abre pelo piso de 180, gravado como trava padrão', async () => {
    await post(headersSemNascimento, sustainedBatch(randomUUID())).expect(200)

    const rows = await ativas(workerSemNascimento)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('HEART_RATE_HIGH')
    // Sem idade não há máxima por idade, e o piso é a rede de segurança de quem
    // não tem dado. A regra vai para a linha porque é ela que explica, na
    // auditoria, por que 185 bpm abriu para um com limite 165 e para outro com
    // limite 180.
    expect(rows[0].thresholdRule).toBe('SAFETY_DEFAULT')
    expect(rows[0].thresholdValue).toBe(LIMITE_PISO)
  }, 30_000)

  it('6. a varredura recupera por silêncio e abre perda de sinal, sem fechar o alerta', async () => {
    // Envelhecer o snapshot é a forma de simular silêncio sem esperar dois
    // minutos de relógio. Cinco minutos: passa do prazo de silêncio (120 s) e
    // fica muito abaixo do teto de turno (8 h), que é o que decide se vale
    // avisar a operação.
    await prisma.telemetrySnapshot.update({
      where: { workerId: workerA },
      data: { lastEventTime: new Date(Date.now() - 5 * 60 * 1000) },
    })

    const resultado = await conditions.sweepSilentSessions(new Date())
    expect(resultado.signalLost).toBeGreaterThanOrEqual(1)

    const batimento = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerA, kind: 'HEART_RATE_HIGH' },
    })
    // Valor que ninguém mede não vale: parado o relógio, a evidência que
    // sustentava a condição deixou de existir, e mantê-la aberta seria afirmar
    // um agora que ninguém mediu. O motivo é próprio para a auditoria não
    // confundir batimento que normalizou com relógio que sumiu.
    expect(batimento.status).toBe('RECOVERED')
    expect(batimento.recoveryReason).toBe('SIGNAL_LOST')

    const perdaDeSinal = await ativas(workerA)
    expect(perdaDeSinal).toHaveLength(1)
    expect(perdaDeSinal[0].kind).toBe('DEVICE_SIGNAL_LOST')
    // Sem alerta de propósito: aparelho fora do alcance é estado do
    // funcionário, não item de fila.
    expect(await prisma.operationalAlert.findUnique({ where: { conditionId: perdaDeSinal[0].id } })).toBeNull()

    // Condição e alerta são máquinas SEPARADAS. A condição recuperou sozinha; o
    // alerta continua aberto porque só fecha na mão, e alguém ainda precisa
    // olhar o que aconteceu com esse funcionário.
    const alerta = await prisma.operationalAlert.findFirstOrThrow({ where: { conditionId: batimento.id } })
    expect(alerta.status).toBe('OPEN')
  }, 30_000)

  it('7. reabertura não duplica alerta, e o evento ao vivo recupera a perda de sinal', async () => {
    await post(headersA, sustainedBatch(randomUUID())).expect(200)

    const abertas = await ativas(workerA)
    expect(abertas.map((c) => c.kind)).toEqual(['HEART_RATE_HIGH'])

    // A fila não empilha o mesmo problema: o alerta antigo já diz "olhe este
    // funcionário", e um segundo não acrescentaria informação nenhuma.
    expect(await prisma.operationalAlert.findMany({ where: { workerId: workerA } })).toHaveLength(1)

    // Evento ao vivo é sinal de volta, e quem fecha a perda de sinal é o
    // caminho do evento, não a varredura, que só enxerga o silêncio.
    const perdaDeSinal = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerA, kind: 'DEVICE_SIGNAL_LOST' },
    })
    expect(perdaDeSinal.status).toBe('RECOVERED')
    expect(perdaDeSinal.recoveryReason).toBe('SIGNAL_RESTORED')
  }, 30_000)

  it('8. demonstração fica na própria origem e não mexe no painel real', async () => {
    const antes = (await query.adminSummary(admin)).urgentAlerts.workers

    await post(headersDemo, sustainedBatch(randomUUID(), { origin: 'DEMO' })).expect(200)

    const rows = await ativas(workerDemo)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('HEART_RATE_HIGH')
    expect(rows[0].origin).toBe('DEMO')

    // A origem é parte da chave do alerta, e não detalhe de leitura:
    // demonstração nunca é triada, então um alerta de demonstração fica aberto
    // para sempre e suprimiria o alerta REAL do mesmo funcionário e tipo pelo
    // resto do piloto se a origem não separasse os dois.
    const alerta = await prisma.operationalAlert.findUniqueOrThrow({ where: { conditionId: rows[0].id } })
    expect(alerta.origin).toBe('DEMO')

    // O painel lê só o real. Ensaio não entra na conta de quem está em risco.
    expect((await query.adminSummary(admin)).urgentAlerts.workers).toBe(antes)

    // Nem vira aviso para pessoa nenhuma.
    expect(await prisma.notification.count({ where: { domain: 'health', targetId: rows[0].id } })).toBe(0)
  }, 30_000)

  /**
   * O caso que o 2 não consegue ser. Como o lock enfileira os dois escritores,
   * o segundo sempre lê a condição já commitada e nem tenta inserir, então a
   * cláusula de conflito nunca é exercitada pelo caminho do serviço. Aqui o
   * lock é contornado DE PROPÓSITO: duas transações abertas à mão inserem a
   * mesma condição ativa pelo caminho cru, sem passar por evaluateSession.
   *
   * O que se prova, e é o motivo de o ON CONFLICT existir: sem ele o Postgres
   * põe a transação inteira em estado abortado, o comando seguinte morre com
   * 25P02 e leva junto as recuperações já gravadas na mesma transação. Com ele,
   * a segunda inserção devolve zero linhas, não levanta, e a transação segue
   * utilizável, que é o que a escrita seguinte comprova.
   *
   * O SQL é cópia deliberada do de insertCondition. Passar pelo serviço aqui
   * seria passar pelo lock, que é justamente o que este caso precisa evitar.
   */
  it('9. a cláusula de conflito absorve a corrida sem abortar a transação', async () => {
    const sessao = await prisma.telemetrySession.findFirstOrThrow({
      where: { workerId: workerSemNascimento, origin: 'REAL' },
      select: { id: true },
    })
    const agora = new Date()

    const insere = (tx: PrismaService, kind: string) => tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "TelemetryCondition" (
        "id", "workerId", "sessionId", "origin", "kind", "status", "firstSeenAt", "lastSeenAt",
        "thresholdProfile", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text,
        ${workerSemNascimento},
        ${sessao.id},
        CAST(${'REAL'} AS "TelemetryOrigin"),
        CAST(${kind} AS "TelemetryConditionKind"),
        CAST(${'ACTIVE'} AS "TelemetryConditionStatus"),
        ${agora}, ${agora}, ${ALERT_PROFILE_VERSION}, ${agora}
      )
      ON CONFLICT ("workerId", "kind", "origin") WHERE "status" = 'ACTIVE' DO NOTHING
      RETURNING id
    `

    let inseriuNaPrimeira = () => {}
    const primeiraInseriu = new Promise<void>((resolve) => {
      inseriuNaPrimeira = resolve
    })
    let liberaCommit = () => {}
    const podeCommitar = new Promise<void>((resolve) => {
      liberaCommit = resolve
    })

    const primeira = prisma.$transaction(
      async (tx) => {
        const linhas = await insere(tx as PrismaService, 'BLOOD_PRESSURE_REVIEW')
        expect(linhas).toHaveLength(1)
        inseriuNaPrimeira()
        await podeCommitar
      },
      { timeout: 20_000, maxWait: 10_000 },
    )

    await primeiraInseriu

    const segunda = prisma.$transaction(
      async (tx) => {
        // Esta inserção BLOQUEIA no índice enquanto a primeira não commita: o
        // Postgres faz o segundo inseridor esperar a sorte da entrada ainda não
        // confirmada. É o que torna a corrida real, e não sequencial.
        const conflitada = await insere(tx as PrismaService, 'BLOOD_PRESSURE_REVIEW')
        // Zero linhas é o sinal de "outro escritor já abriu esta condição", que
        // é o estado desejado: não conta como aberta por este chamador e não
        // vira alerta.
        expect(conflitada).toHaveLength(0)

        // A prova de que a transação NÃO abortou. Sem o ON CONFLICT, este
        // comando morreria com 25P02 e derrubaria a transação inteira, levando
        // junto qualquer recuperação já gravada nela.
        const seguinte = await insere(tx as PrismaService, 'DEVICE_BATTERY_LOW')
        expect(seguinte).toHaveLength(1)
      },
      { timeout: 20_000, maxWait: 10_000 },
    )

    // Só agora, para a segunda ter chegado ao INSERT e estar bloqueada nele. Se
    // a máquina for lenta e ela chegar depois do commit, o caso continua
    // válido: ela lê a linha já confirmada e o ON CONFLICT devolve zero do
    // mesmo jeito. A espera aumenta a chance da intercalação mais interessante,
    // e nenhuma asserção depende dela.
    await new Promise((resolve) => setTimeout(resolve, 300))
    liberaCommit()

    await primeira
    await segunda

    const finais = await ativas(workerSemNascimento)
    expect(finais.filter((c) => c.kind === 'BLOOD_PRESSURE_REVIEW')).toHaveLength(1)
    expect(finais.filter((c) => c.kind === 'DEVICE_BATTERY_LOW')).toHaveLength(1)
  }, 60_000)

  /**
   * Pressão e bateria só tinham prova unitária, contra dublê. Estes dois casos
   * fecham a lacuna e provam, de quebra, a decisão que uma revisão corrigiu: as
   * duas são lidas por FUNCIONÁRIO e origem, com o prazo do próprio domínio,
   * e não pela janela de 60 s da sessão. Por isso a medição que abre vai numa
   * sessão e a que recupera vai em OUTRA.
   */
  it('10. pressão na faixa de fadiga abre a Atenção com alerta não urgente, e recupera por medição em outra sessão', async () => {
    const urgentesAntes = (await query.adminSummary(admin)).urgentAlerts.workers
    const alertasAntes = await prisma.operationalAlert.count({ where: { workerId: workerB } })
    const pressao = (systolic: number, diastolic: number) => ({
      bloodPressure: { value: { systolic, diastolic }, unit: 'mmHg', source: 'EXTERNAL_CUFF' },
    })

    await post(headersB, { events: [event({ measurements: pressao(150, 95) })] }).expect(200)

    // Sem faixa aprendida, a faixa de fadiga é a partida v1.0: 140 por 90.
    const aberta = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerB, kind: 'BLOOD_PRESSURE_FATIGUE', status: 'ACTIVE' },
    })
    expect(aberta).toMatchObject({
      origin: 'REAL',
      thresholdProfile: CALIBRATED_ALERT_PROFILE_VERSION,
      thresholdRule: 'BAND',
      thresholdValue: 140,
      observedValue: 150,
      calibrationDay: 1,
    })
    // Atenção vira item de fila, porque pede que alguém olhe. Mas não é
    // urgente: urgente é só trava.
    const alerta = await prisma.operationalAlert.findUnique({ where: { conditionId: aberta.id } })
    expect(alerta).toMatchObject({ workerId: workerB, origin: 'REAL', status: 'OPEN' })
    expect(await prisma.operationalAlert.count({ where: { workerId: workerB } })).toBe(alertasAntes + 1)
    expect((await query.adminSummary(admin)).urgentAlerts.workers).toBe(urgentesAntes)

    // Medição nova, fora da faixa de fadiga nas duas, em sessão de monitoramento NOVA.
    await post(headersB, { events: [event({ measurements: pressao(125, 80) })] }).expect(200)

    const recuperada = await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: aberta.id } })
    expect(recuperada).toMatchObject({ status: 'RECOVERED', recoveryReason: 'NORMALIZED' })
    // Condição recuperar não fecha alerta: isso é da triagem humana.
    expect(await prisma.operationalAlert.findUnique({ where: { conditionId: aberta.id } })).toMatchObject({ status: 'OPEN' })
  })

  it('11. bateria baixa abre condição sem alerta, e recupera acima da banda em outra sessão', async () => {
    const alertasAntes = await prisma.operationalAlert.count({ where: { workerId: workerB } })
    const bateria = (value: number) => ({ battery: { value, unit: '%', source: 'APPLE_WATCH' } })

    await post(headersB, { events: [event({ measurements: bateria(12) })] }).expect(200)

    const aberta = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerB, kind: 'DEVICE_BATTERY_LOW', status: 'ACTIVE' },
    })
    expect(aberta).toMatchObject({
      thresholdRule: 'FLOOR',
      thresholdValue: EXPERIMENTAL_ALERT_PROFILE.batteryLow.openAtPercent,
      observedValue: 12,
    })
    // Aparelho é estado do funcionário, não item de fila.
    expect(await prisma.operationalAlert.findUnique({ where: { conditionId: aberta.id } })).toBeNull()
    // Na leitura ela aparece como aparelho, nunca como saúde.
    const comBateriaBaixa = await query.currentForWorker(workerB)
    expect(comBateriaBaixa.conditions.filter((c) => c.kind === 'DEVICE_BATTERY_LOW')).toEqual([
      expect.objectContaining({ category: 'DEVICE', observedValue: 12 }),
    ])
    expect(await prisma.operationalAlert.count({ where: { workerId: workerB } })).toBe(alertasAntes)

    // 20% está dentro da banda e não recupera; 30% passa de 25% e recupera.
    await post(headersB, { events: [event({ measurements: bateria(20) })] }).expect(200)
    expect((await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: aberta.id } })).status).toBe('ACTIVE')

    await post(headersB, { events: [event({ measurements: bateria(30) })] }).expect(200)
    expect(await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: aberta.id } })).toMatchObject({
      status: 'RECOVERED',
      recoveryReason: 'NORMALIZED',
    })
    // Recuperada, sai da leitura.
    const recuperada = await query.currentForWorker(workerB)
    expect(recuperada.conditions.some((c) => c.kind === 'DEVICE_BATTERY_LOW')).toBe(false)
  })

  it('12. demonstração segue o perfil v2: desgaste em 80% abre WEAR_HIGH, e recupera em sessão nova', async () => {
    // O funcionário A, na origem DEMO: o desgaste precisa da máxima por idade, e
    // o funcionário de demonstração deste spec não tem data de nascimento.
    const alertasAntes = await prisma.operationalAlert.count({ where: { workerId: workerA, origin: 'DEMO' } })
    const demo = { origin: 'DEMO' }

    // Chegar a 80% de desgaste pela porta da frente leva mais de duas horas de
    // intensidade máxima. O caso planta a dose na cadeia da sessão, que é o
    // estado que a avaliação seguinte continua, e deixa a fórmula e o motor
    // fazerem o resto: é a fiação avaliação -> condição -> alerta que se prova.
    // Dois eventos separados no tempo: um evento sozinho no primeiro lote de
    // uma sessão faz a janela começar e terminar no mesmo instante, e janela
    // sem duração não é avaliada.
    const sessao = randomUUID()
    await post(headersA, {
      events: [
        event({ ...demo, monitoringSessionId: sessao, eventTime: new Date(Date.now() - 10_000).toISOString() }),
        event({ ...demo, monitoringSessionId: sessao, eventTime: new Date(Date.now() - 5_000).toISOString() }),
      ],
    }).expect(200)
    const primeira = await prisma.telemetryAssessment.findFirstOrThrow({
      where: { sessionId: sessao },
      orderBy: { computedAt: 'desc' },
    })
    const inputs = primeira.inputs as { chain: { nextState: { strainDose: number } } }
    inputs.chain.nextState.strainDose = 300
    // Vinte segundos atrás para passar o corte de 15 s da avaliação seguinte.
    await prisma.telemetryAssessment.update({
      where: { id: primeira.id },
      data: { inputs, computedAt: new Date(Date.now() - 20_000) },
    })

    await post(headersA, { events: [event({ ...demo, monitoringSessionId: sessao })] }).expect(200)

    const avaliada = await prisma.telemetryAssessment.findFirstOrThrow({
      where: { sessionId: sessao },
      orderBy: { computedAt: 'desc' },
    })
    expect(avaliada.wearPercent).toBeGreaterThanOrEqual(80)

    const aberta = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerA, origin: 'DEMO', kind: 'WEAR_HIGH', status: 'ACTIVE' },
    })
    // A demonstração não tem calibração: régua de piso do v2, sem dia.
    expect(aberta).toMatchObject({
      origin: 'DEMO',
      thresholdProfile: EXPERIMENTAL_ALERT_PROFILE.version,
      thresholdRule: 'FLOOR',
      thresholdValue: EXPERIMENTAL_ALERT_PROFILE.wearHigh.openAtPercent,
      observedValue: avaliada.wearPercent,
      calibrationDay: null,
    })
    const alerta = await prisma.operationalAlert.findUnique({ where: { conditionId: aberta.id } })
    expect(alerta).toMatchObject({ workerId: workerA, origin: 'DEMO', status: 'OPEN' })
    expect(await prisma.operationalAlert.count({ where: { workerId: workerA, origin: 'DEMO' } })).toBe(alertasAntes + 1)

    // Sessão nova começa a cadeia do zero: um lote denso a 70 bpm produz uma
    // avaliação com desgaste próximo de zero, abaixo da banda de recuperação.
    const nova = randomUUID()
    await post(
      headersA,
      sustainedBatch(nova, { ...demo, measurements: { heartRate: { value: 70, unit: 'bpm', source: 'APPLE_WATCH' } } }),
    ).expect(200)

    const recuperada = await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: aberta.id } })
    expect(recuperada).toMatchObject({ status: 'RECOVERED', recoveryReason: 'NORMALIZED' })
    // Condição recuperar não fecha alerta: isso é da triagem humana.
    expect(await prisma.operationalAlert.findUnique({ where: { conditionId: aberta.id } })).toMatchObject({ status: 'OPEN' })
  })

  it('13. a lista do painel traz todos os funcionários da empresa, por HTTP, e só para administrador dela', async () => {
    // Assina com o mesmo segredo que a estratégia JWT confere; o papel vem do
    // banco a cada requisição, então o token só identifica a pessoa.
    const bearer = (sub: string, role: string) => ({ Authorization: `Bearer ${new JwtService({ secret: requireJwtSecret() }).sign({ sub, role })}` })
    const lista = (headers: Record<string, string>) =>
      request(app.getHttpServer()).get('/telemetry/v1/admin/workers').set(headers)

    const { body } = await lista(bearer(admin.userId, 'ADMIN')).expect(200)
    const ids = body.workers.map((w: { worker: { id: string } }) => w.worker.id)
    expect(new Set(ids)).toEqual(
      new Set([
        workerA,
        workerB,
        workerSemNascimento,
        workerDemo,
        workerCalibrado,
        workerTrava,
        workerDesgaste,
        workerOxigenio,
        workerOxigenioSemFaixa,
      ]),
    )
    for (const entry of body.workers) {
      expect(entry.device.state).toBe('PAIRED')
      expect(Array.isArray(entry.telemetry.conditions)).toBe(true)
    }
    // A mesma leitura da rota individual, com condições incluídas.
    const individual = await query.currentForWorker(workerA)
    const daLista = body.workers.find((w: { worker: { id: string } }) => w.worker.id === workerA)
    expect(daLista.telemetry.conditions).toEqual(individual.conditions)
    expect(daLista.telemetry.origin).toBe(individual.origin)

    // Ordem de atenção: ninguém sem urgência aparece antes de quem tem.
    const rank = (entry: { telemetry: { conditions: { category: string }[] } }) => {
      const cats = entry.telemetry.conditions.map((c) => c.category)
      return cats.includes('URGENT') ? 0 : cats.includes('HEALTH') ? 1 : 2
    }
    const ranks = body.workers.map(rank)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))

    // Funcionário não lê a lista do painel.
    await lista(bearer(workerA, 'WORKER')).expect(403)

    // Administrador de outra empresa não vê nenhum destes funcionários.
    const endereco = { cep: '01000-000', street: 'Rua B', number: '2', neighborhood: 'Centro', uf: 'SP' }
    const outra = await prisma.company.create({ data: { name: 'Outra Co', cnpj: OUTRO_CNPJ, ...endereco } })
    const outroAdmin = await prisma.user.create({
      data: {
        email: emails.outroAdmin,
        name: 'Outro Admin',
        passwordHash: 'nao-usado-neste-spec',
        role: 'ADMIN',
        emailVerified: true,
        approvalStatus: 'APPROVED',
        companyId: outra.id,
      },
    })
    const alheia = await lista(bearer(outroAdmin.id, 'ADMIN')).expect(200)
    expect(alheia.body.workers).toEqual([])
  })

  it('14. pressão do app Saúde medida há horas abre a Atenção ao chegar, sem devolver o sinal do relógio', async () => {
    // O caso 9 deixou neste funcionário uma revisão de pressão inserida à mão,
    // sem valor observado. Com ela ativa o motor não abriria outra.
    await prisma.telemetryCondition.deleteMany({
      where: { workerId: workerSemNascimento, kind: 'BLOOD_PRESSURE_REVIEW' },
    })

    // O relógio avisa 10% de bateria e para de falar. Essa leitura fica dentro
    // do prazo da bateria (30 min) quando a pressão chegar, logo abaixo.
    await post(headersSemNascimento, {
      events: [event({ measurements: { battery: { value: 10, unit: '%', source: 'APPLE_WATCH' } } })],
    }).expect(200)

    // Relógio calado: mesma simulação de silêncio do caso 6.
    await prisma.telemetrySnapshot.update({
      where: { workerId: workerSemNascimento },
      data: { lastEventTime: new Date(Date.now() - 5 * 60 * 1000) },
    })
    await conditions.sweepSilentSessions(new Date())
    const perdaDeSinal = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerSemNascimento, kind: 'DEVICE_SIGNAL_LOST', status: 'ACTIVE' },
    })
    const antes = await prisma.telemetrySnapshot.findUniqueOrThrow({ where: { workerId: workerSemNascimento } })

    // Medida de manhã, lida pelo iPhone só agora, numa sessão que não é a do relógio.
    const medidaEm = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    await post(headersSemNascimento, {
      events: [
        event({
          eventTime: medidaEm,
          measurements: {
            bloodPressure: { value: { systolic: 150, diastolic: 95 }, unit: 'mmHg', source: 'MANUAL_HEALTHKIT' },
          },
        }),
      ],
    }).expect(200)

    const atencao = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerSemNascimento, kind: 'BLOOD_PRESSURE_FATIGUE', status: 'ACTIVE' },
    })
    expect(atencao.observedValue).toBe(150)
    expect(await prisma.operationalAlert.findUnique({ where: { conditionId: atencao.id } })).toMatchObject({
      status: 'OPEN',
    })

    // Uma pressão digitada no app Saúde não é o relógio falando: a perda de
    // sinal continua aberta, e a sessão e o último evento continuam os dele.
    expect((await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: perdaDeSinal.id } })).status).toBe('ACTIVE')
    const depois = await prisma.telemetrySnapshot.findUniqueOrThrow({ where: { workerId: workerSemNascimento } })
    expect(depois.sessionId).toBe(antes.sessionId)
    expect(depois.lastEventTime).toEqual(antes.lastEventTime)
    // A varredura recuperou a bateria baixa por silêncio, e a chegada da
    // pressão não a reabre a partir da leitura velha do relógio.
    expect((await ativas(workerSemNascimento)).map((c) => c.kind).sort()).toEqual([
      'BLOOD_PRESSURE_FATIGUE',
      'DEVICE_SIGNAL_LOST',
    ])

    // E a leitura traz a última medição com a hora em que foi medida.
    const leitura = await query.currentForWorker(workerSemNascimento)
    expect(leitura.metrics.bloodPressure).toMatchObject({
      value: { systolic: 150, diastolic: 95 },
      quality: 'CURRENT',
      measuredAt: medidaEm,
      source: 'MANUAL_HEALTHKIT',
    })
  }, 30_000)

  // Calibração individual (perfil swi-alert-calibrated-3): a origem REAL abre a
  // Atenção pela faixa de fadiga da pessoa e o urgente pelas travas. Os casos
  // abaixo provam a fiação com o banco de verdade: faixa gravada, trava do
  // admin, avaliações de desgaste e o dia da calibração na condição.

  it('15. calibrado: 10 min acima da faixa de fadiga abrem a Atenção com o dia; 9 min não; uma leitura de volta fecha', async () => {
    const sessao = randomUUID()
    await post(headersCalibrado, minutesBatch(sessao, 9, 140)).expect(200)
    expect(await ativas(workerCalibrado)).toHaveLength(0)

    await post(headersCalibrado, minutesBatch(sessao, 10, 140)).expect(200)
    const abertas = await ativas(workerCalibrado)
    expect(abertas).toHaveLength(1)
    expect(abertas[0]).toMatchObject({
      kind: 'HEART_RATE_FATIGUE',
      origin: 'REAL',
      thresholdProfile: CALIBRATED_ALERT_PROFILE_VERSION,
      thresholdRule: 'BAND',
      thresholdValue: 130,
      observedValue: 140,
      calibrationDay: 10,
    })
    // Atenção vira item de fila, como saúde sem urgência.
    expect(await prisma.operationalAlert.findUnique({ where: { conditionId: abertas[0].id } })).toMatchObject({
      status: 'OPEN',
    })
    const leitura = await query.currentForWorker(workerCalibrado)
    expect(leitura.conditions).toEqual([expect.objectContaining({ kind: 'HEART_RATE_FATIGUE', category: 'HEALTH' })])

    await post(headersCalibrado, {
      events: [
        event({
          monitoringSessionId: sessao,
          measurements: { heartRate: { value: 110, unit: 'bpm', source: 'APPLE_WATCH' } },
        }),
      ],
    }).expect(200)
    expect(await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: abertas[0].id } })).toMatchObject({
      status: 'RECOVERED',
      recoveryReason: 'NORMALIZED',
    })
  }, 60_000)

  it('16. trava de batimento alto gravada pelo admin abre pelo valor dele', async () => {
    await prisma.workerSafetyLimit.create({
      data: { workerId: workerTrava, rule: 'HEART_RATE_HIGH', values: { openAt: 150, closeAt: 140 }, updatedById: admin.userId },
    })

    // 155 bpm fica abaixo da trava padrão pela idade (165): só a do admin abre.
    await post(
      headersTrava,
      sustainedBatch(randomUUID(), { measurements: { heartRate: { value: 155, unit: 'bpm', source: 'APPLE_WATCH' } } }),
    ).expect(200)

    const abertas = await ativas(workerTrava)
    expect(abertas).toHaveLength(1)
    expect(abertas[0]).toMatchObject({
      kind: 'HEART_RATE_HIGH',
      thresholdRule: 'SAFETY_CUSTOM',
      thresholdValue: 150,
      observedValue: 155,
    })
  }, 30_000)

  it('17. desgaste em 85% por 10 min abre só a Atenção; em 90% abre a trava, urgente', async () => {
    // Chegar a 85% de desgaste pela porta da frente leva horas. O caso grava as
    // avaliações da sessão direto no banco, a cada 20 s como a ingestão grava
    // (corte de 15 s, uma por lote), e chama o motor: é a leitura da série de
    // avaliações que se prova, não a fórmula.
    const sessao = randomUUID()
    await post(headersDesgaste, {
      events: [
        event({ monitoringSessionId: sessao, measurements: { heartRate: { value: 80, unit: 'bpm', source: 'APPLE_WATCH' } } }),
      ],
    }).expect(200)
    const agora = Date.now() + 1_000
    const avaliacao = (msAntes: number, wearPercent: number) => ({
      workerId: workerDesgaste,
      sessionId: sessao,
      origin: 'REAL' as const,
      computedAt: new Date(agora - msAntes),
      windowStart: new Date(agora - msAntes - 20_000),
      windowEnd: new Date(agora - msAntes),
      wearPercent,
      formulaVersion: 'e2e-condicoes',
      inputs: {},
    })
    await prisma.telemetryAssessment.createMany({
      data: Array.from({ length: 31 }, (_, i) => avaliacao((30 - i) * 20_000, 85)),
    })

    await conditions.evaluateSession(sessao, new Date(agora), new Date())

    const abertas = await ativas(workerDesgaste)
    expect(abertas.map((c) => c.kind)).toEqual(['WEAR_FATIGUE'])
    // Sem faixa aprendida, o corte de fadiga do desgaste é a partida: 80.
    expect(abertas[0]).toMatchObject({ thresholdRule: 'BAND', thresholdValue: 80, observedValue: 85 })

    const urgentesAntes = (await query.adminSummary(admin)).urgentAlerts.workers
    await prisma.telemetryAssessment.create({ data: avaliacao(-5_000, 92) })
    await conditions.evaluateSession(sessao, new Date(agora + 5_000), new Date())

    const trava = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerDesgaste, kind: 'WEAR_HIGH', status: 'ACTIVE' },
    })
    expect(trava).toMatchObject({ thresholdRule: 'SAFETY_DEFAULT', thresholdValue: 90, observedValue: 92 })
    // O desgaste na trava passou a ser urgente.
    const leitura = await query.currentForWorker(workerDesgaste)
    expect(leitura.conditions.find((c) => c.kind === 'WEAR_HIGH')?.category).toBe('URGENT')
    expect((await query.adminSummary(admin)).urgentAlerts.workers).toBe(urgentesAntes + 1)
    // A Atenção segue aberta: 92% continua na faixa de fadiga.
    expect((await ativas(workerDesgaste)).map((c) => c.kind).sort()).toEqual(['WEAR_FATIGUE', 'WEAR_HIGH'])
  }, 30_000)

  it('18. pressão em 185 por 112 abre a Atenção e a trava urgente, e nunca a revisão', async () => {
    const urgentesAntes = (await query.adminSummary(admin)).urgentAlerts.workers

    await post(headersCalibrado, {
      events: [
        event({
          measurements: {
            bloodPressure: { value: { systolic: 185, diastolic: 112 }, unit: 'mmHg', source: 'EXTERNAL_CUFF' },
          },
        }),
      ],
    }).expect(200)

    const abertas = await ativas(workerCalibrado)
    expect(abertas.map((c) => c.kind).sort()).toEqual(['BLOOD_PRESSURE_FATIGUE', 'BLOOD_PRESSURE_HIGH'])
    expect(abertas.find((c) => c.kind === 'BLOOD_PRESSURE_HIGH')).toMatchObject({
      thresholdRule: 'SAFETY_DEFAULT',
      thresholdValue: 180,
      observedValue: 185,
      calibrationDay: 10,
    })
    expect((await query.adminSummary(admin)).urgentAlerts.workers).toBe(urgentesAntes + 1)
  }, 30_000)

  it('19. demonstração continua abrindo a revisão de pressão do perfil v2', async () => {
    await post(headersDemo, {
      events: [
        event({
          origin: 'DEMO',
          measurements: {
            bloodPressure: { value: { systolic: 150, diastolic: 80 }, unit: 'mmHg', source: 'EXTERNAL_CUFF' },
          },
        }),
      ],
    }).expect(200)

    const revisao = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerDemo, kind: 'BLOOD_PRESSURE_REVIEW', status: 'ACTIVE' },
    })
    expect(revisao).toMatchObject({
      origin: 'DEMO',
      thresholdProfile: ALERT_PROFILE_VERSION,
      thresholdRule: 'FLOOR',
      thresholdValue: EXPERIMENTAL_ALERT_PROFILE.bloodPressureReview.systolicAt,
      calibrationDay: null,
    })
    expect(
      await prisma.telemetryCondition.count({ where: { workerId: workerDemo, kind: { in: ['BLOOD_PRESSURE_FATIGUE', 'BLOOD_PRESSURE_HIGH'] } } }),
    ).toBe(0)
  }, 30_000)

  // Oxigenação é pontual: quem a manda é o relógio, poucas vezes por turno. A
  // ao vivo é decidida pela avaliação da sessão; a que chega como backlog, pela
  // porta da medição avulsa. As duas leem as duas últimas leituras do
  // funcionário nas últimas 12 h, em qualquer sessão.
  const oxigenacao = (pct: number, minutosAtras = 0, origin = 'REAL') =>
    event({
      origin,
      eventTime: new Date(Date.now() - minutosAtras * 60_000).toISOString(),
      measurements: { oxygenSaturation: { value: pct, unit: '%', source: 'APPLE_WATCH' } },
    })
  const OXIGENACAO = ['OXYGEN_FATIGUE', 'OXYGEN_LOW'] as const
  const ativasDe = async (workerId: string) =>
    (await ativas(workerId)).filter((c) => (OXIGENACAO as readonly string[]).includes(c.kind))

  it('20. oxigenação: duas leituras na faixa com 12 min entre elas abrem a Atenção, com 5 min não; 89% abre a trava urgente e 93% a fecha', async () => {
    // As duas chegam como backlog, com 5 min entre elas: a porta avulsa decide e não abre.
    await post(headersOxigenio, { events: [oxigenacao(93, 17), oxigenacao(93, 12)] }).expect(200)
    expect(await ativasDe(workerOxigenio)).toEqual([])

    // A ao vivo fica 12 min depois da anterior: duas seguidas na faixa de fadiga (abaixo de 94).
    await post(headersOxigenio, { events: [oxigenacao(93)] }).expect(200)
    const atencao = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerOxigenio, kind: 'OXYGEN_FATIGUE', status: 'ACTIVE' },
    })
    expect(atencao).toMatchObject({
      origin: 'REAL',
      thresholdProfile: CALIBRATED_ALERT_PROFILE_VERSION,
      thresholdRule: 'BAND',
      thresholdValue: 94,
      observedValue: 93,
      calibrationDay: 10,
    })
    expect(await prisma.operationalAlert.findUnique({ where: { conditionId: atencao.id } })).toMatchObject({
      status: 'OPEN',
    })

    const urgentesAntes = (await query.adminSummary(admin)).urgentAlerts.workers
    await post(headersOxigenio, { events: [oxigenacao(89)] }).expect(200)
    const trava = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerOxigenio, kind: 'OXYGEN_LOW', status: 'ACTIVE' },
    })
    expect(trava).toMatchObject({ thresholdRule: 'SAFETY_DEFAULT', thresholdValue: 90, observedValue: 89 })
    expect((await query.currentForWorker(workerOxigenio)).conditions.find((c) => c.kind === 'OXYGEN_LOW')?.category).toBe(
      'URGENT',
    )
    expect((await query.adminSummary(admin)).urgentAlerts.workers).toBe(urgentesAntes + 1)

    // 93% passa da recuperação da trava (acima de 92%), mas segue na faixa de fadiga.
    await post(headersOxigenio, { events: [oxigenacao(93)] }).expect(200)
    expect(await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: trava.id } })).toMatchObject({
      status: 'RECOVERED',
      recoveryReason: 'NORMALIZED',
    })
    expect((await ativasDe(workerOxigenio)).map((c) => c.kind)).toEqual(['OXYGEN_FATIGUE'])
  }, 30_000)

  it('21. sem faixa de oxigenação aprendida só a trava decide; a demonstração não decide oxigenação', async () => {
    // Medida há 30 min e lida só agora: a porta avulsa abre a trava na chegada,
    // sem esperar o relógio falar. A leitura nova acima de 92% a fecha.
    await post(headersOxigenioSemFaixa, { events: [oxigenacao(88, 30)] }).expect(200)
    const trava = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerOxigenioSemFaixa, kind: 'OXYGEN_LOW', status: 'ACTIVE' },
    })
    expect(trava).toMatchObject({ thresholdRule: 'SAFETY_DEFAULT', thresholdValue: 90, observedValue: 88 })
    await post(headersOxigenioSemFaixa, { events: [oxigenacao(95, 20)] }).expect(200)
    expect((await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: trava.id } })).status).toBe('RECOVERED')

    // 91% duas vezes com 12 min entre elas: acima da trava, e sem corte de fadiga não há Atenção.
    await post(headersOxigenioSemFaixa, { events: [oxigenacao(91, 12)] }).expect(200)
    await post(headersOxigenioSemFaixa, { events: [oxigenacao(91)] }).expect(200)
    expect(await ativasDe(workerOxigenioSemFaixa)).toEqual([])

    // Um backlog mais velho abaixo da trava não abre: a última leitura continua
    // sendo a de 91% de agora, e é ela que a trava olha.
    await post(headersOxigenioSemFaixa, { events: [oxigenacao(88, 25)] }).expect(200)
    expect(await ativasDe(workerOxigenioSemFaixa)).toEqual([])

    await post(headersOxigenioSemFaixa, { events: [oxigenacao(88)] }).expect(200)
    expect((await ativasDe(workerOxigenioSemFaixa)).map((c) => c.kind)).toEqual(['OXYGEN_LOW'])

    await post(headersDemo, { events: [oxigenacao(85, 0, 'DEMO')] }).expect(200)
    expect(await prisma.telemetryCondition.count({ where: { workerId: workerDemo, kind: { in: [...OXIGENACAO] } } })).toBe(0)
  }, 30_000)
})
