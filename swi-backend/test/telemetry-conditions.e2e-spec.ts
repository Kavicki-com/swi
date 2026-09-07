import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import type { JwtUser } from '../src/auth/current-user.decorator'
import { PrismaService } from '../src/prisma/prisma.service'
import { ALERT_PROFILE_VERSION, EXPERIMENTAL_ALERT_PROFILE } from '../src/telemetry/alerts/alert-profile'
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
    admin: `telemetry-cond-admin-${randomUUID()}@ex.com`,
  }
  let workerA = ''
  let workerB = ''
  let workerSemNascimento = ''
  let workerDemo = ''
  let admin: JwtUser = { userId: '', role: 'ADMIN', companyId: null }
  let headersA: Record<string, string> = {}
  let headersB: Record<string, string> = {}
  let headersSemNascimento: Record<string, string> = {}
  let headersDemo: Record<string, string> = {}

  /**
   * 185 bpm serve aos dois limites de propósito. Para quem nasceu em 1991 a
   * máxima por idade (Tanaka) dá 183,5, e 90% arredondado dá 165, regra
   * PERSONALIZED; para quem não tem data de nascimento o limite é o piso de
   * 180, regra FLOOR. O mesmo valor abre os dois, e a única diferença entre os
   * casos 1 e 5 passa a ser o cadastro, que é o que se quer provar.
   */
  const SUSTAINED_BPM = 185
  const LIMITE_PERSONALIZADO = 165
  const LIMITE_PISO = EXPERIMENTAL_ALERT_PROFILE.heartRateHigh.floorBpm

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
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ } })
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
    expect(condicao.thresholdProfile).toBe(ALERT_PROFILE_VERSION)
    expect(condicao.thresholdRule).toBe('PERSONALIZED')
    expect(condicao.thresholdValue).toBe(LIMITE_PERSONALIZADO)
    expect(condicao.observedValue).toBe(SUSTAINED_BPM)

    const alerta = await prisma.operationalAlert.findUnique({ where: { conditionId: condicao.id } })
    expect(alerta).not.toBeNull()
    expect(alerta?.workerId).toBe(workerA)
    expect(alerta?.origin).toBe('REAL')
    expect(alerta?.status).toBe('OPEN')

    const resumo = await query.adminSummary(admin)
    expect(resumo.urgentAlerts.workers).toBeGreaterThanOrEqual(1)
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

  it('5. sem data de nascimento abre pelo piso, e a linha registra a regra de piso', async () => {
    await post(headersSemNascimento, sustainedBatch(randomUUID())).expect(200)

    const rows = await ativas(workerSemNascimento)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('HEART_RATE_HIGH')
    // Sem idade não há máxima por idade, e o piso é a rede de segurança de quem
    // não tem dado. A regra vai para a linha porque é ela que explica, na
    // auditoria, por que 185 bpm abriu para um com limite 165 e para outro com
    // limite 180.
    expect(rows[0].thresholdRule).toBe('FLOOR')
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
  it('10. pressão fora da faixa abre revisão com alerta não urgente, e recupera por medição em outra sessão', async () => {
    const urgentesAntes = (await query.adminSummary(admin)).urgentAlerts.workers
    const alertasAntes = await prisma.operationalAlert.count({ where: { workerId: workerB } })
    const pressao = (systolic: number, diastolic: number) => ({
      bloodPressure: { value: { systolic, diastolic }, unit: 'mmHg', source: 'EXTERNAL_CUFF' },
    })

    await post(headersB, { events: [event({ measurements: pressao(150, 80) })] }).expect(200)

    const aberta = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerB, kind: 'BLOOD_PRESSURE_REVIEW', status: 'ACTIVE' },
    })
    expect(aberta).toMatchObject({
      origin: 'REAL',
      thresholdProfile: EXPERIMENTAL_ALERT_PROFILE.version,
      thresholdRule: 'FLOOR',
      thresholdValue: EXPERIMENTAL_ALERT_PROFILE.bloodPressureReview.systolicAt,
      observedValue: 150,
    })
    // Revisão vira item de fila, porque exige gente. Mas não é urgente: o
    // contador do painel só olha batimento.
    const alerta = await prisma.operationalAlert.findUnique({ where: { conditionId: aberta.id } })
    expect(alerta).toMatchObject({ workerId: workerB, origin: 'REAL', status: 'OPEN' })
    expect(await prisma.operationalAlert.count({ where: { workerId: workerB } })).toBe(alertasAntes + 1)
    expect((await query.adminSummary(admin)).urgentAlerts.workers).toBe(urgentesAntes)

    // Medição nova, abaixo de 130 por 85, em sessão de monitoramento NOVA.
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
    expect(await prisma.operationalAlert.count({ where: { workerId: workerB } })).toBe(alertasAntes)

    // 20% está dentro da banda e não recupera; 30% passa de 25% e recupera.
    await post(headersB, { events: [event({ measurements: bateria(20) })] }).expect(200)
    expect((await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: aberta.id } })).status).toBe('ACTIVE')

    await post(headersB, { events: [event({ measurements: bateria(30) })] }).expect(200)
    expect(await prisma.telemetryCondition.findUniqueOrThrow({ where: { id: aberta.id } })).toMatchObject({
      status: 'RECOVERED',
      recoveryReason: 'NORMALIZED',
    })
  })
})
