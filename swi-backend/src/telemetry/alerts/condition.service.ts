import { Injectable, Logger } from '@nestjs/common'
import type { Prisma, TelemetryConditionKind, TelemetryOrigin } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ageInYearsAt, maxHeartRateForAge, restingFromDailyMinima } from '../assessment/assessment-baseline'
import { EVENT_AGE, FRESHNESS, monitoredDayOf } from '../domain/metric-state'
import { EXPERIMENTAL_ALERT_PROFILE, type AlertProfile } from './alert-profile'
import {
  decideBattery,
  decideBloodPressure,
  decideHeartRate,
  heartRateLimits,
  type Decision,
  type EngineSample,
} from './condition-engine'

// Serviço de condições: decide QUAIS LINHAS entram na conta e grava o
// resultado; a conta é do motor, que é puro. Condição e alerta são máquinas
// separadas: a condição diz o que o corpo ou o aparelho está fazendo agora, e
// recupera sozinha; o alerta diz que um humano precisa olhar, e só fecha na mão.

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Idade mínima do carimbo para valer uma escrita de renovação. Esta é a rota
 * mais quente do backend: com cadência de 5 s, renovar sem amortizar daria uma
 * escrita por condição ativa a cada evento, e um minuto de defasagem no carimbo
 * não muda decisão nenhuma da varredura.
 */
const LAST_SEEN_REFRESH_MS = 60_000

/**
 * Teto de candidatas por execução da varredura, no molde do teto de triplas do
 * ciclo de vida: a rodada tem tamanho previsível, e o que sobra entra na
 * seguinte, daqui a 30 s. Sem ele, backend fora do ar por dez minutos põe o
 * piloto inteiro na mesma rodada, justo quando o banco está voltando.
 */
export const MAX_SILENT_SESSIONS_PER_RUN = 200

/**
 * Piso da busca de candidatas: calado além disto, o funcionário deixa de ser
 * varrido. Não é teto de turno e não tem relação nenhuma com ele: o teto de
 * turno decide SE ABRE perda de sinal, e este piso decide se a pessoa ainda é
 * um funcionário monitorado.
 *
 * Sete dias cobre queda de fim de semana e feriado emendado, que é o que a
 * ausência de teto superior existia para proteger, e descarta quem saiu do
 * piloto. Sem ele, relógio devolvido ou funcionário desligado fica candidato
 * para sempre; como a ordem é pela mais calada primeiro, ele vem na frente de
 * todo mundo e come uma vaga do teto da rodada a cada 30 s. Com desligados o
 * bastante, os vivos param de ser varridos: o histórico vira uma negação de
 * serviço lenta.
 *
 * O conserto de verdade é ENCERRAR sessão de monitoramento, dívida que este
 * serviço já declara no comentário de sweepSilentSessions. Este piso é
 * paliativo até lá.
 */
export const MONITORED_SILENCE_FLOOR_MS = 7 * 24 * 60 * 60 * 1000

/** Tipos que viram item de fila. Bateria e sinal são estado, não item. */
const ALERTING_KINDS: ReadonlySet<TelemetryConditionKind> = new Set<TelemetryConditionKind>([
  'HEART_RATE_HIGH',
  'HEART_RATE_LOW',
  'BLOOD_PRESSURE_REVIEW',
])

/**
 * Condições contínuas que o SILÊNCIO derruba. Batimento e bateria descrevem um
 * valor que o relógio precisa estar mandando: parado o relógio, a evidência que
 * sustentava a condição deixou de existir, e mantê-la aberta seria afirmar um
 * agora que ninguém mediu.
 *
 * Pressão fica de fora de propósito: é medida à mão, vale por 72 h pelo prazo
 * do domínio, e silêncio do relógio não diz nada sobre a pressão de ninguém.
 * Ela só recupera por medição nova.
 */
const SILENCE_RECOVERS: ReadonlySet<TelemetryConditionKind> = new Set<TelemetryConditionKind>([
  'HEART_RATE_HIGH',
  'HEART_RATE_LOW',
  'DEVICE_BATTERY_LOW',
])

export interface EvaluateOutcome {
  opened: TelemetryConditionKind[]
  recovered: TelemetryConditionKind[]
  alerts: number
}

export interface SweepOutcome {
  /** Sessões silenciosas olhadas na rodada, tenham gerado escrita ou não. */
  scanned: number
  /** Perdas de sinal abertas por esta rodada. */
  signalLost: number
  /** Condições contínuas recuperadas por silêncio nesta rodada. */
  recovered: number
}

@Injectable()
export class TelemetryConditionService {
  private readonly logger = new Logger(TelemetryConditionService.name)
  private readonly profile: AlertProfile = EXPERIMENTAL_ALERT_PROFILE

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Avalia as condições de VALOR de uma sessão a partir de um evento ao vivo.
   * `triggerAt` é o eventTime mais recente do lote; `now` é o relógio do
   * servidor, e é contra ele que os carimbos são gravados.
   */
  async evaluateSession(sessionId: string, triggerAt: Date, now: Date): Promise<EvaluateOutcome> {
    return this.prisma.$transaction((tx) => this.evaluateLocked(tx, sessionId, triggerAt, now))
  }

  private async evaluateLocked(
    tx: Prisma.TransactionClient,
    sessionId: string,
    triggerAt: Date,
    now: Date,
  ): Promise<EvaluateOutcome> {
    const outcome: EvaluateOutcome = { opened: [], recovered: [], alerts: 0 }

    // Condição descreve o AGORA, e evento que não é ao vivo não descreve agora
    // nada. A ingestão só deveria chamar com evento ao vivo, mas essa garantia
    // mora no chamador, e um gatilho de horas atrás faria estrago em silêncio
    // aqui: o motor veria a série densa e sustentada que aconteceu de manhã e
    // gravaria uma condição com firstSeenAt de agora, jurando 185 bpm neste
    // instante; e a perda de sinal recuperaria incondicionalmente, com o
    // backlog "provando" que o sinal voltou. O prazo é o do domínio, o mesmo
    // que classifica evento como ao vivo, e não um número novo desta fatia.
    if (now.getTime() - triggerAt.getTime() > EVENT_AGE.liveMs) {
      this.logger.debug(
        `Sessão ${sessionId}: gatilho de ${triggerAt.toISOString()} não é ao vivo em ${now.toISOString()}, nada avaliado`,
      )
      return outcome
    }

    // A sessão é lida ANTES do lock porque é dela que sai a chave do lock, e
    // ler antes é seguro: funcionário e origem nascem com a linha e ninguém os
    // reescreve. A conferência de existência é aqui, e não mais no lock: o lock
    // consultivo não olha linha nenhuma, então zero linhas deixou de significar
    // "sessão inexistente".
    const session = await tx.telemetrySession.findUnique({
      where: { id: sessionId },
      select: { id: true, workerId: true, origin: true },
    })
    if (session === null) throw new Error(`Sessão de monitoramento ${sessionId} não existe para avaliar condições`)

    await this.lockWorkerOrigin(tx, session)

    // Por funcionário e origem, e não por sessão: uma condição aberta numa
    // sessão continua sendo dele na seguinte, mas real e demonstração nunca se
    // misturam, e sem o filtro uma condição de demonstração ativa faria o
    // motor concluir que a real já está aberta e nunca abri-la.
    //
    // lastSeenAt entra na projeção porque é ele que decide, no fim, se o
    // carimbo da condição ainda ativa precisa ser renovado. Sem cast: assim o
    // compilador reprova qualquer mexida no select que tire uma coluna que o
    // corpo abaixo consome, em vez de deixar o erro para o runtime.
    const active = await tx.telemetryCondition.findMany({
      where: { workerId: session.workerId, origin: session.origin, status: 'ACTIVE' },
      select: { id: true, kind: true, lastSeenAt: true },
    })
    const activeByKind = new Map(active.map((c) => [c.kind, c]))

    const windowStart = new Date(triggerAt.getTime() - this.profile.persistence.windowMs)
    const sinceDay = new Date(monitoredDayOf(now).getTime() - this.profile.restingDays * DAY_MS)
    // Cada métrica tem a sua própria noção de "vale agora", e uma janela só não
    // serve às três. BPM precisa de evidência CONTÍNUA dentro da janela de
    // persistência; bateria e pressão precisam do ÚLTIMO valor conhecido dentro
    // do prazo de validade DELAS. Presa à janela do BPM, uma medição de pressão
    // carimbada mais de 60 s antes da amostra mais nova do lote não seria
    // avaliada por chamada nenhuma, porque a janela seguinte já andou para a
    // frente; e pressão é medida à mão e raramente, então perder uma é perder o
    // evento inteiro.
    //
    // As duas leituras pontuais são recortadas por FUNCIONÁRIO e origem, e não
    // por sessão, porque prazo de 30 min e de 72 h não cabe dentro de uma
    // sessão: ela nasce de novo a cada reconexão do relógio. Recortada por
    // sessão, uma medição de pressão de ontem seria atual pelo domínio e
    // apareceria no painel, mas ficaria invisível para a avaliação. A condição
    // já é chaveada por (workerId, origin) pelo mesmo motivo: sobrevive à
    // sessão. A janela de 60 s do BPM continua por sessão, porque evidência
    // CONTÍNUA de esforço só faz sentido dentro de uma.
    const batteryFrom = new Date(triggerAt.getTime() - FRESHNESS.BATTERY.staleMs)
    const pressureFrom = new Date(triggerAt.getTime() - FRESHNESS.BLOOD_PRESSURE.staleMs)
    const [rows, batteryRow, pressureRow, profile, summaries] = await Promise.all([
      // Fronteira de baixo fechada, como a do motor: aberta, a amostra que cai
      // exatamente no início da janela ficaria de fora e o trecho medido seria
      // menor que o que o perfil declara. Só BPM: as colunas de bateria e de
      // pressão saíram daqui porque quem as lê agora são as buscas abaixo.
      tx.telemetrySample.findMany({
        where: { sessionId, eventTime: { gte: windowStart, lte: triggerAt } },
        select: { eventTime: true, heartRateBpm: true },
        orderBy: { eventTime: 'asc' },
      }),
      // 30 min é FRESHNESS.BATTERY.staleMs, o prazo do domínio para bateria, e
      // não número novo desta fatia: a leitura chega a cada cinco minutos, o
      // painel a trata como válida até meia hora, e a condição tem de decidir
      // sobre a mesma leitura que o painel mostra.
      tx.telemetrySample.findFirst({
        where: {
          workerId: session.workerId,
          origin: session.origin,
          batteryPercent: { not: null },
          eventTime: { gte: batteryFrom, lte: triggerAt },
        },
        select: { batteryPercent: true },
        orderBy: { eventTime: 'desc' },
      }),
      // 72 h é FRESHNESS.BLOOD_PRESSURE.staleMs, pelo mesmo motivo: passado
      // esse prazo o domínio diz "sem medição recente" e o valor some da tela,
      // então é exatamente aí que ele deixa de poder abrir condição.
      tx.telemetrySample.findFirst({
        where: {
          workerId: session.workerId,
          origin: session.origin,
          systolicMmHg: { not: null },
          diastolicMmHg: { not: null },
          eventTime: { gte: pressureFrom, lte: triggerAt },
        },
        select: { systolicMmHg: true, diastolicMmHg: true },
        orderBy: { eventTime: 'desc' },
      }),
      tx.profile.findUnique({ where: { userId: session.workerId }, select: { birthDate: true } }),
      tx.telemetryDailySummary.findMany({
        where: {
          workerId: session.workerId,
          origin: session.origin,
          day: { gte: sinceDay },
          heartRateMin: { not: null },
        },
        select: { heartRateMin: true },
        orderBy: { day: 'desc' },
        take: this.profile.restingDays,
      }),
    ])

    const restingBpm = restingFromDailyMinima(
      summaries.flatMap((s) => (s.heartRateMin === null ? [] : [s.heartRateMin])),
    )
    const birthDate = profile?.birthDate ?? null
    const maxBpm = birthDate === null ? null : maxHeartRateForAge(ageInYearsAt(birthDate, now))
    const limits = heartRateLimits(this.profile, { maxBpm, restingBpm })

    // batteryPercent fica nulo aqui de propósito: o motor recebe a bateria como
    // escalar, pela leitura própria, e nenhuma decisão de BPM olha esta coluna.
    const samples: EngineSample[] = rows.map((r) => ({
      atMs: r.eventTime.getTime(),
      heartRateBpm: r.heartRateBpm,
      batteryPercent: null,
    }))
    const latestBattery = batteryRow?.batteryPercent ?? null
    // O filtro `not: null` não estreita o tipo devolvido pelo Prisma, então as
    // duas colunas são conferidas aqui em vez de assertadas.
    const pressure =
      pressureRow === null || pressureRow.systolicMmHg === null || pressureRow.diastolicMmHg === null
        ? null
        : { systolic: pressureRow.systolicMmHg, diastolic: pressureRow.diastolicMmHg }

    const nowMs = triggerAt.getTime()
    const decisions: Decision[] = [
      decideHeartRate('HEART_RATE_HIGH', samples, limits.high, activeByKind.has('HEART_RATE_HIGH'), this.profile, nowMs),
      decideHeartRate('HEART_RATE_LOW', samples, limits.low, activeByKind.has('HEART_RATE_LOW'), this.profile, nowMs),
      decideBattery(latestBattery, activeByKind.has('DEVICE_BATTERY_LOW'), this.profile),
      decideBloodPressure(pressure, activeByKind.has('BLOOD_PRESSURE_REVIEW'), this.profile),
    ].flatMap((d) => (d === null ? [] : [d]))

    // Evento ao vivo é sinal de volta: perda de sinal ativa recupera aqui, e
    // não na varredura, que só enxerga o silêncio.
    if (activeByKind.has('DEVICE_SIGNAL_LOST')) {
      decisions.push({ kind: 'DEVICE_SIGNAL_LOST', action: 'RECOVER', observedValue: null, threshold: null })
    }

    // Recuperar antes de abrir. Já foi a garantia de que uma violação de
    // unicidade não levava as recuperações junto; hoje quem garante isso é o ON
    // CONFLICT DO NOTHING da abertura, que não aborta a transação. A ordem fica
    // como boa prática: fechar o que já não vale antes de abrir o que passou a
    // valer deixa a leitura da linha do tempo na ordem dos fatos.
    const recoveredIds = new Set<string>()
    for (const decision of decisions) {
      if (decision.action !== 'RECOVER') continue
      const row = activeByKind.get(decision.kind)
      if (row === undefined) continue
      // observedValue não é reescrito: ele guarda o valor que ABRIU a
      // condição, que é o que a auditoria quer saber. O valor da recuperação
      // já está no histórico de amostras.
      //
      // Perda de sinal fecha com motivo próprio: NORMALIZED afirma que o valor
      // voltou pela banda, e esta condição não tem valor nem banda. Sem a
      // distinção, quem audita não separa batimento que normalizou de relógio
      // que voltou a falar, e é esta que mais vai oscilar no piloto.
      const reason = decision.kind === 'DEVICE_SIGNAL_LOST' ? 'SIGNAL_RESTORED' : 'NORMALIZED'
      await tx.telemetryCondition.update({
        where: { id: row.id },
        data: { status: 'RECOVERED', recoveredAt: now, recoveryReason: reason, lastSeenAt: now },
      })
      outcome.recovered.push(decision.kind)
      recoveredIds.add(row.id)
    }

    // lastSeenAt é a última vez que uma AVALIAÇÃO COBRIU este funcionário com a
    // condição ainda aberta, e não quando ela abriu. Leia ao pé da letra: a
    // renovação é movida por "uma avaliação rodou para esta sessão", e não por
    // "a evidência ainda sustenta esta condição". Ela NÃO prova persistência,
    // porque o motor devolve nulo tanto para "sem amostra na janela" quanto
    // para "continua acima", e um HEART_RATE_HIGH segue ativo, e carimbado,
    // sem nenhuma amostra de BPM chegando. Quem precisar da prova tem de olhar
    // as amostras.
    //
    // Assim mesmo é o significado útil: sem renovar, uma condição ativa há três
    // horas, com o funcionário mandando dado o tempo todo, exibiria carimbo
    // idêntico ao firstSeenAt, e o índice [status, lastSeenAt] deixaria de
    // servir a uma varredura que procure condição esquecida. Quem recuperou
    // fica de fora: já levou o carimbo do fechamento e não segue aberta.
    //
    // Antes das aberturas pelo mesmo motivo que as recuperações: mantém junto
    // tudo o que mexe em condição já existente, antes do que cria linha nova.
    const refreshBefore = new Date(now.getTime() - LAST_SEEN_REFRESH_MS)
    for (const row of active) {
      if (recoveredIds.has(row.id)) continue
      if (row.lastSeenAt > refreshBefore) continue
      await tx.telemetryCondition.update({ where: { id: row.id }, data: { lastSeenAt: now } })
    }

    for (const decision of decisions) {
      if (decision.action !== 'OPEN') continue
      // A escrita é crua, e a mesma da varredura de silêncio: o motivo de ela
      // ser crua está em insertCondition, junto do SQL.
      const createdId = await this.insertCondition(tx, session, now, {
        kind: decision.kind,
        rule: decision.threshold?.rule ?? null,
        value: decision.threshold?.value ?? null,
        observedValue: decision.observedValue,
      })
      if (createdId === null) continue

      outcome.opened.push(decision.kind)
      if (await this.openAlert(tx, createdId, session.workerId, session.origin, decision.kind)) outcome.alerts += 1
    }

    if (outcome.opened.length > 0 || outcome.recovered.length > 0) {
      this.logger.debug(
        `Condições da sessão ${session.id}: abriu ${outcome.opened.join(',') || 'nada'}, recuperou ${outcome.recovered.join(',') || 'nada'}, ${outcome.alerts} alerta(s)`,
      )
    }
    return outcome
  }

  /**
   * Varre as sessões silenciosas e trata a AUSÊNCIA de evento. É a outra porta
   * do motor: perda de sinal não nasce de um valor que chegou, nasce de nada
   * ter chegado, e o caminho do evento é cego para ela por definição, porque
   * relógio calado não dispara chamada nenhuma.
   *
   * A candidata é lida do SNAPSHOT, e não da sessão, por dois motivos. O
   * primeiro: o snapshot tem uma linha por funcionário e só é promovido por
   * evento AO VIVO, então backlog que chega depois de uma reconexão nunca conta
   * como sinal. O segundo é dívida assumida: sessão de monitoramento nunca
   * encerra neste sistema, e `status`, `interruptedAt` e `endedAt` não são
   * escritos por ninguém, então a varredura não pode confiar neles e "sessão
   * viva" acaba definida por silêncio aqui. No dia em que o ciclo de vida
   * passar a encerrar sessão, esta definição deve ceder à dele.
   */
  async sweepSilentSessions(now: Date): Promise<SweepOutcome> {
    const { silenceMs } = this.profile.signalLost
    // Só a fronteira do silêncio, e ABERTA em cima: o prazo é o mesmo que o
    // caminho do evento usa para dizer "ao vivo", e um carimbo exatamente em
    // cima dele é ao vivo lá, então não pode ser silêncio aqui.
    //
    // O teto de turno NÃO entra: filtrando por ele aqui, ele governaria as duas
    // coisas, e recuperar passaria a depender de a gente estar rodando. Uma
    // queda de fim de semana, ou um deploy longo, e o batimento alto aberto na
    // sexta nunca recuperaria, porque na segunda a sessão já não seria
    // candidata. O teto governa só a ABERTURA, e por candidata.
    //
    // Origem REAL, e só ela. O snapshot tem uma linha por funcionário e a
    // origem é substituída por inteiro, então sem o filtro a varredura opera na
    // origem de QUEM FALOU POR ÚLTIMO: uma demonstração rodada por cima de
    // alguém com condição real aberta faria a rodada seguinte ler as condições
    // de (funcionário, DEMO), não recuperar nada e abrir perda de sinal em
    // DEMO, com a condição REAL aberta para sempre e perda de sinal real
    // nenhuma registrada. Demonstração é ensaio, não observação: ninguém está
    // esperando dado de um ensaio que acabou. CONSEQUÊNCIA ACEITA: rodar uma
    // demonstração num funcionário que tem condição real aberta deixa essa
    // condição aberta até ele voltar a mandar telemetria real, e isso é aceito
    // porque demonstração é rara e deliberada. De brinde, o índice
    // [origin, lastEventTime] do snapshot passa a ser usável: origem é a coluna
    // líder dele.
    //
    // A mais calada primeiro, para o teto da rodada cortar as menos urgentes.
    const candidates = await this.prisma.telemetrySnapshot.findMany({
      where: {
        origin: 'REAL',
        sessionId: { not: null },
        // O piso (MONITORED_SILENCE_FLOOR_MS) corta quem sumiu do piloto; ele
        // não é teto de turno, e o motivo está na declaração da constante.
        lastEventTime: {
          lt: new Date(now.getTime() - silenceMs),
          gte: new Date(now.getTime() - MONITORED_SILENCE_FLOOR_MS),
        },
      },
      select: { sessionId: true },
      orderBy: { lastEventTime: 'asc' },
      take: MAX_SILENT_SESSIONS_PER_RUN,
    })
    if (candidates.length === MAX_SILENT_SESSIONS_PER_RUN) {
      this.logger.warn(
        `Varredura de silêncio bateu o teto de ${MAX_SILENT_SESSIONS_PER_RUN} candidatas na rodada; o resto entra na seguinte`,
      )
    }

    const outcome: SweepOutcome = { scanned: candidates.length, signalLost: 0, recovered: 0 }
    for (const candidate of candidates) {
      // O `where` já exclui sessão nula; a conferência aqui é o que estreita o
      // tipo, porque a coluna é opcional no schema.
      const sessionId = candidate.sessionId
      if (sessionId === null) continue
      try {
        // Uma transação por candidata, e não uma pela rodada: a rodada varre
        // todo mundo a cada 30 s, e uma sessão que estoure não pode deixar o
        // resto do turno sem perda de sinal registrada. É o mesmo desenho da
        // varredura do ciclo de vida, pelo mesmo motivo.
        const one = await this.prisma.$transaction((tx) => this.sweepLocked(tx, sessionId, now))
        outcome.signalLost += one.signalLost
        outcome.recovered += one.recovered
      } catch (error) {
        // Sem valor de saúde na mensagem, como no ciclo de vida: log é lugar
        // onde dado sensível vaza sem ninguém notar. Só a sessão, que é o que
        // permite repetir a mão.
        this.logger.warn(`Varredura de silêncio falhou para a sessão ${sessionId}: ${(error as Error).message}`)
      }
    }
    return outcome
  }

  private async sweepLocked(
    tx: Prisma.TransactionClient,
    sessionId: string,
    now: Date,
  ): Promise<{ signalLost: number; recovered: number }> {
    const result = { signalLost: 0, recovered: 0 }

    // Sessão antes do lock, como no caminho do evento e pelo mesmo motivo: é
    // dela que sai a chave, e a existência precisa continuar sendo conferida
    // agora que o lock não olha linha nenhuma.
    const session = await tx.telemetrySession.findUnique({
      where: { id: sessionId },
      select: { id: true, workerId: true, origin: true },
    })
    if (session === null) throw new Error(`Sessão de monitoramento ${sessionId} não existe para varrer silêncio`)

    // Mesmo lock do caminho do evento, e é ele que resolve a corrida com um
    // lote que chega neste instante: quem chegar segundo lê o estado que o
    // primeiro já gravou, em vez de os dois decidirem sobre a mesma leitura.
    await this.lockWorkerOrigin(tx, session)

    // O silêncio é RELIDO aqui dentro, e não trazido da busca de candidatas: o
    // laço leva tempo, e o carimbo da busca envelhece nesse intervalo, então
    // gravá-lo subestimaria o silêncio pelo tempo da rodada, justo na coluna
    // que a auditoria vai ler.
    //
    // Relê pela sessão, e não pelo funcionário: se o snapshot já não aponta
    // para esta sessão e origem, quem manda é quem escreveu depois. E se a
    // sessão voltou a falar entre a busca e o lock, esta candidata não é mais
    // assunto da varredura: quem chegou depois tem a informação mais nova.
    const { silenceMs, shiftCeilingMs } = this.profile.signalLost
    const snapshot = await tx.telemetrySnapshot.findFirst({
      where: { sessionId, origin: session.origin },
      select: { lastEventTime: true },
    })
    if (snapshot === null) return result
    const observedSilenceMs = now.getTime() - snapshot.lastEventTime.getTime()
    if (observedSilenceMs <= silenceMs) return result

    // Por funcionário e origem, como no caminho do evento: a condição sobrevive
    // à sessão, e demonstração nunca cega o real.
    //
    // lastSeenAt fica FORA da projeção de propósito, porque a varredura não
    // renova carimbo nenhum. Renovar faria a segunda rodada sobre o mesmo
    // silêncio escrever, e o carimbo passaria a andar por causa de ausência de
    // dado, que é o oposto do que ele significa.
    const active = await tx.telemetryCondition.findMany({
      where: { workerId: session.workerId, origin: session.origin, status: 'ACTIVE' },
      select: { id: true, kind: true },
    })

    // Recuperar antes de abrir, pela mesma razão de ordem do caminho do evento:
    // fechar o que já não vale antes de abrir o que passou a valer deixa a
    // leitura da linha do tempo na ordem dos fatos.
    //
    // E recuperar SEM olhar teto de turno, de propósito: valor que ninguém mede
    // não vale, tenha o silêncio dois minutos ou dois dias. É a abertura que
    // olha o teto, logo abaixo, e os dois tetos são diferentes porque as duas
    // perguntas são diferentes: "esta condição ainda se sustenta?" não depende
    // do turno de ninguém, "vale a pena avisar a operação?" depende.
    for (const row of active) {
      if (!SILENCE_RECOVERS.has(row.kind)) continue
      await tx.telemetryCondition.update({
        where: { id: row.id },
        data: { status: 'RECOVERED', recoveredAt: now, recoveryReason: 'SIGNAL_LOST', lastSeenAt: now },
      })
      result.recovered += 1
    }

    // Passado o teto do turno, ninguém está esperando dado: relógio guardado no
    // armário há dois dias não é notícia, e abrir perda de sinal ali encheria o
    // painel de item que não é para ninguém.
    if (observedSilenceMs > shiftCeilingMs) return result

    // Idempotência: com perda de sinal já ativa não há o que abrir, e a rodada
    // seguinte sobre o mesmo silêncio não grava nada. Importa porque a
    // varredura roda a cada 30 s e o silêncio dura minutos.
    if (active.some((row) => row.kind === 'DEVICE_SIGNAL_LOST')) return result

    // Sem alerta de propósito: aparelho fora do alcance é estado do
    // funcionário, não item de fila. DEVICE_SIGNAL_LOST não está em
    // ALERTING_KINDS, e openAlert nem chega a ser chamado aqui.
    const created = await this.insertCondition(tx, session, now, {
      kind: 'DEVICE_SIGNAL_LOST',
      // Regra nula porque não se personaliza silêncio: o limite é o prazo do
      // perfil, igual para todo mundo. O valor observado é o silêncio medido em
      // milissegundos, que é o que a auditoria quer saber depois.
      rule: null,
      value: this.profile.signalLost.silenceMs,
      observedValue: observedSilenceMs,
    })
    if (created !== null) result.signalLost += 1
    return result
  }

  /**
   * Serializa as duas portas do motor, a do valor e a da ausência, pelo par
   * FUNCIONÁRIO e ORIGEM, que é exatamente o escopo do invariante do índice
   * único parcial (workerId, kind, origin).
   *
   * Lock consultivo, e não a linha da sessão. Travar a sessão tem escopo menor
   * que o invariante: reconexão do relógio cria sessão nova, duas sessões do
   * mesmo funcionário travam linhas distintas, não se enfileiram, e as duas
   * mexem no mesmo conjunto de condições. A varredura torna isso COMUM em vez
   * de raro, porque ela trava a sessão velha que veio do snapshot enquanto o
   * lote novo trava a nova: por desenho, elas nunca se enfileiravam.
   *
   * `pg_advisory_xact_lock` é solto no fim da transação, sem unlock, então não
   * há caminho de saída que vaze o lock. A chave sai do TEXTO "funcionário e
   * origem" por `hashtext`: colisão de hash só faz dois pares distintos
   * esperarem um pelo outro, que custa latência e não corrompe nada.
   */
  private async lockWorkerOrigin(
    tx: Prisma.TransactionClient,
    session: { workerId: string; origin: TelemetryOrigin },
  ): Promise<void> {
    // $executeRaw, NUNCA $queryRaw: pg_advisory_xact_lock devolve void, e o
    // desserializador do Prisma não tem tipo para void, então o $queryRaw
    // levanta ANTES de o lock ser tomado. Não padronize isto de volta.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${session.workerId}:${session.origin}`}))`
  }

  /**
   * Abre uma condição. Escrita crua, e só ESTA: é a única do serviço que pode
   * violar índice, e o preço da violação é a transação inteira. O lock por
   * funcionário e origem já enfileira as duas portas do motor, então o conflito
   * ficou raro; ele não ficou impossível, porque nada obriga um escritor futuro
   * a passar por aqui, e é contra isso que a cláusula abaixo protege. O Prisma
   * não envolve consulta individual em savepoint, então engolir o P2002
   * impediria o LANÇAMENTO, não o ABORTO: o Postgres põe a transação em estado
   * abortado e o comando seguinte morre com 25P02, que não é P2002, sobe, e
   * leva junto as recuperações já gravadas.
   *
   * ON CONFLICT DO NOTHING resolve no banco: nunca levanta e nunca aborta. Zero
   * linhas em RETURNING é exatamente o sinal de "outro escritor já abriu esta
   * condição", que é o estado desejado, e devolve nulo: não conta como aberta
   * por este chamador, não vira alerta e não entra no resultado.
   *
   * Uma função só para as duas portas, a do valor e a da ausência, porque o
   * motivo de a escrita ser crua é o mesmo nas duas, e duas cópias deste SQL
   * divergiriam na primeira coluna que alguém acrescentasse.
   *
   * Template marcado, nunca concatenação: é o que parametriza os valores. Os
   * enums levam CAST explícito porque o parâmetro chega como texto, no mesmo
   * padrão que o read model usa para origem. id e updatedAt vão à mão porque os
   * padrões deles são do cliente Prisma, e não do banco: a inserção crua passa
   * por fora do cliente e a coluna não tem DEFAULT.
   */
  private async insertCondition(
    tx: Prisma.TransactionClient,
    session: { id: string; workerId: string; origin: TelemetryOrigin },
    now: Date,
    opening: {
      kind: TelemetryConditionKind
      rule: string | null
      value: number | null
      observedValue: number | null
    },
  ): Promise<string | null> {
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "TelemetryCondition" (
        "id", "workerId", "sessionId", "origin", "kind", "status", "firstSeenAt", "lastSeenAt",
        "thresholdProfile", "thresholdRule", "thresholdValue", "observedValue", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text,
        ${session.workerId},
        ${session.id},
        CAST(${session.origin} AS "TelemetryOrigin"),
        CAST(${opening.kind} AS "TelemetryConditionKind"),
        CAST(${'ACTIVE'} AS "TelemetryConditionStatus"),
        ${now},
        ${now},
        ${this.profile.version},
        ${opening.rule},
        ${opening.value},
        ${opening.observedValue},
        ${now}
      )
      ON CONFLICT ("workerId", "kind", "origin") WHERE "status" = 'ACTIVE' DO NOTHING
      RETURNING id
    `
    const createdId = inserted[0]?.id ?? null
    if (createdId === null) {
      this.logger.debug(
        `Condição ${opening.kind} de ${session.workerId} (${session.origin}) já estava aberta por outro escritor`,
      )
    }
    return createdId
  }

  /**
   * Alerta nasce na mesma transação da condição, e só para os tipos que
   * exigem gente. Não nasce enquanto houver um não resolvido do mesmo
   * funcionário, tipo E ORIGEM: a fila não empilha o mesmo problema, e o
   * alerta antigo já diz "olhe este funcionário".
   *
   * A origem é parte da chave, e não detalhe de leitura: demonstração nunca é
   * triada, então um alerta de demonstração fica OPEN para sempre, e sem o
   * filtro ele suprimiria o alerta REAL do mesmo funcionário e tipo pelo resto
   * do piloto. A condição real abriria, a fila não receberia nada, e o painel
   * voltaria a mostrar zero urgente. É a mesma falha que a chave única
   * (workerId, kind, origin) já corrige um nível acima, na condição.
   */
  private async openAlert(
    tx: Prisma.TransactionClient,
    conditionId: string,
    workerId: string,
    origin: TelemetryOrigin,
    kind: TelemetryConditionKind,
  ): Promise<boolean> {
    if (!ALERTING_KINDS.has(kind)) return false
    const unresolved = await tx.operationalAlert.findFirst({
      where: { workerId, origin, status: { in: ['OPEN', 'ACKNOWLEDGED'] }, condition: { kind } },
      select: { id: true },
    })
    if (unresolved !== null) return false
    await tx.operationalAlert.create({ data: { conditionId, workerId, origin, status: 'OPEN' } })
    return true
  }
}
