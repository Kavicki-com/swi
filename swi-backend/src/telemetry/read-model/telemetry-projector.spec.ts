import type { ConditionKind } from '../domain/telemetry.types'
import {
  ENERGY_RATE_MIN_COVERAGE_MS,
  ENERGY_RATE_WINDOW_MS,
  MOVEMENT_WINDOW_MS,
  PANEL_CAPTIONS,
  projectAdminSummary,
  projectAggregateWorker,
  projectWorker,
  type DayTotals,
  type ProjectionAssessment,
  type ProjectionSample,
  type ProjectionSnapshot,
  type WorkerTelemetry,
} from './telemetry-projector'

// A projeção é o único lugar que transforma amostra bruta em número exibido, e
// é por isso que ela é pura: "now" entra por parâmetro, nada aqui lê relógio,
// banco ou Prisma. O que estes casos protegem são as decisões congeladas do
// piloto: ausência nunca vira zero, origem real e demonstrativa nunca se
// misturam, e todo agregado do painel diz de quantos funcionários ele fala.

const NOW = new Date('2026-09-03T12:00:00.000Z')
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString()
const secondsAgo = (s: number) => at(s * 1000)
const minutesAgo = (m: number) => secondsAgo(m * 60)
const hoursAgo = (h: number) => minutesAgo(h * 60)

const sample = (over: Partial<ProjectionSample> & { eventTime: string }): ProjectionSample => ({
  stepDelta: null,
  activeEnergyKcal: null,
  motionCount: null,
  ...over,
})

const snapshot = (over: Partial<ProjectionSnapshot> = {}): ProjectionSnapshot => ({
  origin: 'REAL',
  sessionId: 'session-1',
  heartRateBpm: 88,
  heartRateAt: secondsAgo(5),
  batteryPercent: 74,
  batteryAt: minutesAgo(2),
  systolicMmHg: null,
  diastolicMmHg: null,
  bloodPressureSource: null,
  bloodPressureAt: null,
  ...over,
})

/**
 * Totais do dia como o banco os devolve: já somados. `energyEarliestAt` é a
 * primeira amostra de energia do dia, que decide se cobertura curta é começo
 * ("Calculando") ou lacuna (indisponível).
 */
const totals = (
  over: {
    steps?: number
    stepsAt?: string
    energy?: number
    energyAt?: string
    energyEarliestAt?: string
  } = {},
): DayTotals => ({
  steps:
    over.steps === undefined
      ? null
      : { value: over.steps, measuredAt: over.stepsAt ?? secondsAgo(20), source: 'APPLE_WATCH' },
  activeEnergy:
    over.energy === undefined
      ? null
      : {
          value: over.energy,
          measuredAt: over.energyAt ?? secondsAgo(20),
          source: 'APPLE_WATCH',
          earliestAt: over.energyEarliestAt ?? over.energyAt ?? secondsAgo(20),
        },
})

const project = (
  over: {
    snapshot?: ProjectionSnapshot | null
    windowSamples?: readonly ProjectionSample[]
    dayTotals?: DayTotals
    assessment?: ProjectionAssessment | null
  } = {},
): WorkerTelemetry =>
  projectWorker(
    {
      workerId: 'worker-1',
      snapshot: over.snapshot === undefined ? snapshot() : over.snapshot,
      windowSamples: over.windowSamples ?? [],
      dayTotals: over.dayTotals ?? totals(),
      assessment: over.assessment ?? null,
    },
    NOW,
  )

/** Série de energia com um ponto por minuto, para exercitar a janela móvel. */
const energySeries = (minutes: number, kcalPerMinute: number): ProjectionSample[] =>
  Array.from({ length: minutes + 1 }, (_, i) =>
    sample({
      eventTime: minutesAgo(minutes - i),
      // A primeira amostra ancora o início da cobertura e não traz delta: o
      // consumo dela pertence ao intervalo anterior ao início da janela.
      activeEnergyKcal: i === 0 ? 0 : kcalPerMinute,
    }),
  )

describe('projectWorker: ausência é estado de leitura, nunca zero', () => {
  it('sem snapshot algum, toda métrica fica indisponível e sem valor', () => {
    const projected = project({ snapshot: null })

    expect(projected.origin).toBeNull()
    expect(projected.monitoringSessionId).toBeNull()
    for (const [kind, state] of Object.entries(projected.metrics)) {
      expect({ kind, value: state.value, quality: state.quality }).toEqual({
        kind,
        value: null,
        quality: 'UNAVAILABLE',
      })
    }
  })

  it('sem amostra de passos, o total do dia é nulo e não zero', () => {
    const projected = project({ windowSamples: [sample({ eventTime: secondsAgo(10) })] })

    expect(projected.metrics.steps.value).toBeNull()
    expect(projected.metrics.steps.quality).toBe('UNAVAILABLE')
    expect(projected.metrics.steps.measuredAt).toBeNull()
  })

  it('métrica que o snapshot não carrega não herda a qualidade das outras', () => {
    const projected = project({ snapshot: snapshot({ batteryPercent: null, batteryAt: null }) })

    expect(projected.metrics.heartRate.quality).toBe('CURRENT')
    expect(projected.metrics.battery.value).toBeNull()
    expect(projected.metrics.battery.quality).toBe('UNAVAILABLE')
  })
})

describe('projectWorker: evento fora de ordem não substitui o valor atual', () => {
  it('o total do dia chega somado do banco, carimbado pela amostra de passos mais recente', () => {
    // A soma e o carimbo são do banco (_sum e _max sobre amostras COM passos);
    // ao projetor cabe não reinterpretar nem reordenar o que veio.
    const projected = project({ dayTotals: totals({ steps: 200, stepsAt: secondsAgo(10) }) })

    expect(projected.metrics.steps.value).toBe(200)
    expect(projected.metrics.steps.measuredAt).toBe(secondsAgo(10))
    expect(projected.metrics.steps.quality).toBe('CURRENT')
  })

  it('backlog embaralhado não muda a taxa: a janela ordena por horário de medição', () => {
    const ordered = energySeries(10, 5)
    const shuffled = [...ordered].reverse()

    expect(project({ windowSamples: shuffled }).metrics.energyRatePerHour).toEqual(
      project({ windowSamples: ordered }).metrics.energyRatePerHour,
    )
  })
})

describe('projectWorker: kcal/h é energia da janela sobre a duração coberta', () => {
  it('divide a energia da janela pela duração efetivamente coberta', () => {
    // 10 minutos cobertos, 5 kcal por minuto: 50 kcal em 1/6 de hora = 300 kcal/h.
    const projected = project({ windowSamples: energySeries(10, 5) })

    expect(projected.metrics.energyRatePerHour.value).toBe(300)
    expect(projected.metrics.energyRatePerHour.unit).toBe('kcal/h')
    expect(projected.energyWindow.coveredMs).toBe(10 * 60_000)
    expect(projected.energyWindow.samples).toBe(11)
  })

  it('a duração coberta é a das amostras, não os 60 minutos inteiros da janela', () => {
    // Se o denominador fosse a janela cheia, 50 kcal em 10 minutos apareceriam
    // como 50 kcal/h, e um turno com pouca cobertura pareceria leve.
    const projected = project({ windowSamples: energySeries(10, 5) })

    expect(projected.metrics.energyRatePerHour.value).not.toBe(50)
    expect(projected.energyWindow.coveredMs).toBeLessThan(ENERGY_RATE_WINDOW_MS)
  })

  it('amostra mais velha que a janela não entra no cálculo, mesmo que chegue', () => {
    // O serviço já pede só a janela; se um dia pedir mais, a projeção continua
    // filtrando pelo horário, e não pela confiança em quem chamou.
    const projected = project({
      windowSamples: [
        sample({ eventTime: hoursAgo(3), activeEnergyKcal: 900 }),
        ...energySeries(10, 5),
      ],
    })

    expect(projected.metrics.energyRatePerHour.value).toBe(300)
    expect(projected.energyWindow.samples).toBe(11)
  })

  it('o acumulado do dia é o total do banco, não a soma da janela', () => {
    const projected = project({
      windowSamples: energySeries(10, 5),
      dayTotals: totals({ energy: 950, energyEarliestAt: hoursAgo(3) }),
    })

    expect(projected.metrics.activeEnergy.value).toBe(950)
    expect(projected.metrics.activeEnergy.unit).toBe('kcal')
  })
})

describe('projectWorker: menos de cinco minutos de cobertura devolve Calculando', () => {
  it('com cobertura abaixo do mínimo, a taxa fica em Calculando e sem valor', () => {
    const projected = project({ windowSamples: energySeries(4, 5) })

    expect(projected.metrics.energyRatePerHour.quality).toBe('CALCULATING')
    expect(projected.metrics.energyRatePerHour.value).toBeNull()
    // Calculando não é indisponível: já há amostra, e o horário dela aparece.
    expect(projected.metrics.energyRatePerHour.measuredAt).toBe(minutesAgo(0))
  })

  it('uma amostra só não cobre intervalo nenhum e também fica em Calculando', () => {
    const projected = project({
      windowSamples: [sample({ eventTime: secondsAgo(10), activeEnergyKcal: 12 })],
    })

    expect(projected.metrics.energyRatePerHour.quality).toBe('CALCULATING')
    expect(projected.metrics.energyRatePerHour.value).toBeNull()
  })

  it('Calculando expira: relógio que silencia logo depois de começar não fica calculando para sempre', () => {
    // Duas amostras no começo da janela e nada depois. Pela regra de começo,
    // isto seria "Calculando": o dia começou aqui e a cobertura é curta. Mas a
    // última medição tem 57 minutos, e prometer um número que não vem é a mesma
    // história falsa que a ADR-0004 proíbe na lacuna. Quem decide que a leitura
    // deixou de descrever o agora é o prazo do domínio, não o projetor.
    const projected = project({
      windowSamples: [
        sample({ eventTime: minutesAgo(59), activeEnergyKcal: 0 }),
        sample({ eventTime: minutesAgo(57), activeEnergyKcal: 9 }),
      ],
      dayTotals: totals({ energy: 9, energyAt: minutesAgo(57), energyEarliestAt: minutesAgo(59) }),
    })

    expect(projected.metrics.energyRatePerHour.quality).toBe('UNAVAILABLE')
    expect(projected.metrics.energyRatePerHour.value).toBeNull()
    // O horário da última amostra permanece: houve dado, e ele é desta hora.
    expect(projected.metrics.energyRatePerHour.measuredAt).toBe(minutesAgo(57))
  })

  it('cobertura curta DEPOIS de uma lacuna é indisponível, e não Calculando', () => {
    // "Calculando" fala dos primeiros minutos de cobertura. No meio de um turno,
    // depois de um silêncio de rede, ele contaria uma história falsa sobre por
    // que o número sumiu: a ADR-0004 manda a indisponibilidade derivar da
    // ausência do dado.
    // A lacuna se vê pelo total do dia: a primeira amostra de energia do dia
    // é de três horas atrás, então a janela curta não é começo de nada.
    const projected = project({
      windowSamples: [
        sample({ eventTime: minutesAgo(2), activeEnergyKcal: 0 }),
        sample({ eventTime: minutesAgo(0), activeEnergyKcal: 8 }),
      ],
      dayTotals: totals({ energy: 408, energyEarliestAt: hoursAgo(3) }),
    })

    expect(projected.metrics.energyRatePerHour.quality).toBe('UNAVAILABLE')
    expect(projected.metrics.energyRatePerHour.value).toBeNull()
    // O horário da última amostra permanece: houve dado, só não dá taxa.
    expect(projected.metrics.energyRatePerHour.measuredAt).toBe(minutesAgo(0))
  })

  it('sem amostra alguma de energia é indisponível, e não Calculando', () => {
    const projected = project({ windowSamples: [sample({ eventTime: secondsAgo(10), stepDelta: 9 })] })

    expect(projected.metrics.energyRatePerHour.quality).toBe('UNAVAILABLE')
  })

  it('exatamente o mínimo de cobertura já produz número', () => {
    const projected = project({ windowSamples: energySeries(ENERGY_RATE_MIN_COVERAGE_MS / 60_000, 5) })

    expect(projected.metrics.energyRatePerHour.quality).toBe('CURRENT')
    expect(projected.metrics.energyRatePerHour.value).toBe(300)
  })
})

describe('projectWorker: passos são o acumulado do dia monitorado', () => {
  it('o acumulado do dia vai muito além da janela da taxa', () => {
    const projected = project({
      windowSamples: [sample({ eventTime: secondsAgo(20), stepDelta: 120 })],
      dayTotals: totals({ steps: 5_620 }),
    })

    expect(projected.metrics.steps.value).toBe(5_620)
    expect(projected.metrics.steps.unit).toBe('steps')
  })

  it('acumulado antigo continua visível, com a qualidade dizendo que envelheceu', () => {
    const projected = project({ dayTotals: totals({ steps: 4_200, stepsAt: hoursAgo(2) }) })

    expect(projected.metrics.steps.value).toBe(4_200)
    expect(projected.metrics.steps.quality).toBe('UNAVAILABLE')
    expect(projected.metrics.steps.measuredAt).toBe(hoursAgo(2))
  })
})

describe('projectWorker: MPM fica disponível para cálculo e diagnóstico', () => {
  it('deriva movimento por minuto da janela curta de movimento', () => {
    const projected = project({
      windowSamples: [
        sample({ eventTime: secondsAgo(10), motionCount: 0 }),
        sample({ eventTime: secondsAgo(5), motionCount: 4 }),
        sample({ eventTime: secondsAgo(0), motionCount: 6 }),
      ],
    })

    // 10 movimentos em 10 segundos = 60 por minuto.
    expect(projected.metrics.movementPerMinute.value).toBe(60)
    expect(projected.metrics.movementPerMinute.unit).toBe('mpm')
    expect(projected.metrics.movementPerMinute.source).toBe('DERIVED')
  })

  it('movimento fora da janela curta não entra: ela é de segundos, não de minutos', () => {
    const projected = project({
      windowSamples: [
        sample({ eventTime: minutesAgo(10), motionCount: 500 }),
        sample({ eventTime: secondsAgo(10), motionCount: 0 }),
        sample({ eventTime: secondsAgo(0), motionCount: 10 }),
      ],
    })

    expect(MOVEMENT_WINDOW_MS).toBeLessThan(60_000)
    expect(projected.metrics.movementPerMinute.value).toBe(60)
  })

  it('uma amostra só de movimento não cobre intervalo e fica indisponível', () => {
    const projected = project({
      windowSamples: [sample({ eventTime: secondsAgo(2), motionCount: 3 })],
    })

    expect(projected.metrics.movementPerMinute.value).toBeNull()
    expect(projected.metrics.movementPerMinute.quality).toBe('UNAVAILABLE')
  })
})

describe('projectWorker: esforço e desgaste vêm da avaliação, com versão', () => {
  const assessment = (over: Partial<ProjectionAssessment> = {}): ProjectionAssessment => ({
    computedAt: secondsAgo(10),
    effortPercent: 62,
    wearPercent: 31,
    formulaVersion: 'swi-fatigue-experimental',
    ...over,
  })

  it('esforço recente é atual e carrega a versão da fórmula que o produziu', () => {
    const projected = project({ assessment: assessment() })

    expect(projected.metrics.effort.value).toBe(62)
    expect(projected.metrics.effort.quality).toBe('CURRENT')
    expect(projected.metrics.effort.source).toBe('DERIVED')
    expect(projected.formulaVersion).toBe('swi-fatigue-experimental')
  })

  it('esforço fora da janela recente envelhece: o valor fica, a qualidade avisa', () => {
    expect(project({ assessment: assessment({ computedAt: secondsAgo(90) }) }).metrics.effort).toMatchObject(
      { value: 62, quality: 'STALE' },
    )
    expect(project({ assessment: assessment({ computedAt: minutesAgo(10) }) }).metrics.effort).toMatchObject(
      { value: 62, quality: 'UNAVAILABLE' },
    )
  })

  it('desgaste do dia monitorado sobrevive à troca de sessão', () => {
    // Acumular e recuperar é trabalho da fórmula; ao read model cabe não zerar
    // o desgaste do dia só porque uma sessão nova começou.
    const projected = project({
      snapshot: snapshot({ sessionId: 'session-2' }),
      assessment: assessment({ wearPercent: 44 }),
    })

    expect(projected.metrics.wear.value).toBe(44)
    expect(projected.metrics.wear.unit).toBe('%')
  })

  it('sem avaliação, esforço e desgaste ficam indisponíveis e sem versão', () => {
    const projected = project({ assessment: null })

    expect(projected.metrics.effort.value).toBeNull()
    expect(projected.metrics.wear.value).toBeNull()
    expect(projected.formulaVersion).toBeNull()
  })

  it('avaliação que falhou preserva a medição real e só apaga o derivado', () => {
    const projected = project({
      assessment: assessment({ effortPercent: null, wearPercent: null }),
      dayTotals: totals({ steps: 88, stepsAt: secondsAgo(10) }),
    })

    expect(projected.metrics.effort.value).toBeNull()
    expect(projected.metrics.heartRate.value).toBe(88)
    expect(projected.metrics.steps.value).toBe(88)
  })
})

describe('projectWorker: pressão segue as janelas de 24 e 72 horas', () => {
  const withPressure = (measuredAt: string) =>
    project({
      snapshot: snapshot({
        systolicMmHg: 128,
        diastolicMmHg: 82,
        bloodPressureSource: 'EXTERNAL_CUFF',
        bloodPressureAt: measuredAt,
      }),
    })

  it('até 24 horas é atual e entra no painel', () => {
    const projected = withPressure(hoursAgo(23))

    expect(projected.metrics.bloodPressure.value).toEqual({ systolic: 128, diastolic: 82 })
    expect(projected.metrics.bloodPressure.quality).toBe('CURRENT')
    expect(projected.bloodPressureRecency).toBe('CURRENT')
  })

  it('entre 24 e 72 horas é histórica: aparece no mobile, fora do painel', () => {
    const projected = withPressure(hoursAgo(30))

    expect(projected.metrics.bloodPressure.value).toEqual({ systolic: 128, diastolic: 82 })
    expect(projected.metrics.bloodPressure.quality).toBe('STALE')
    expect(projected.bloodPressureRecency).toBe('HISTORICAL')
  })

  it('acima de 72 horas o valor some, e nunca vira 0/0', () => {
    const projected = withPressure(hoursAgo(80))

    expect(projected.metrics.bloodPressure.value).toBeNull()
    expect(projected.bloodPressureRecency).toBe('NONE')
  })

  it('pressão sem origem declarada não é exibida', () => {
    // O painel promete "aparelho externo ou entrada manual real". Uma leitura
    // cuja procedência não se sabe não sustenta essa promessa.
    const projected = project({
      snapshot: snapshot({
        systolicMmHg: 128,
        diastolicMmHg: 82,
        bloodPressureSource: null,
        bloodPressureAt: hoursAgo(1),
      }),
    })

    expect(projected.metrics.bloodPressure.value).toBeNull()
    expect(projected.metrics.bloodPressure.quality).toBe('UNAVAILABLE')
  })

  it('sistólica sem diastólica não vira meia medição', () => {
    const projected = project({
      snapshot: snapshot({
        systolicMmHg: 128,
        diastolicMmHg: null,
        bloodPressureSource: 'MANUAL_SWI',
        bloodPressureAt: hoursAgo(1),
      }),
    })

    expect(projected.metrics.bloodPressure.value).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

interface WorkerOverrides {
  hrBpm?: number | null
  hrAt?: string
  wearPercent?: number | null
  wearAt?: string
  steps?: number | null
  pressureAt?: string
  systolic?: number
  diastolic?: number
  conditions?: readonly string[]
}

const worker = (id: string, over: WorkerOverrides = {}) =>
  projectAggregateWorker(
    {
      workerId: id,
      snapshot: snapshot({
        heartRateBpm: over.hrBpm === undefined ? 80 : over.hrBpm,
        heartRateAt: over.hrAt ?? secondsAgo(5),
        systolicMmHg: over.pressureAt === undefined ? null : (over.systolic ?? 120),
        diastolicMmHg: over.pressureAt === undefined ? null : (over.diastolic ?? 80),
        bloodPressureSource: over.pressureAt === undefined ? null : 'EXTERNAL_CUFF',
        bloodPressureAt: over.pressureAt ?? null,
      }),
      // Já somado pelo banco no caminho real do painel.
      steps:
        over.steps === undefined || over.steps === null
          ? null
          : { value: over.steps, measuredAt: secondsAgo(20), source: 'APPLE_WATCH' },
      assessment:
        over.wearPercent === undefined
          ? null
          : {
              computedAt: over.wearAt ?? secondsAgo(10),
              effortPercent: null,
              wearPercent: over.wearPercent,
              formulaVersion: 'swi-fatigue-experimental',
            },
      activeConditions: (over.conditions ?? []) as ConditionKind[],
    },
    NOW,
  )

describe('projectAdminSummary: médias excluem indisponíveis e devolvem cobertura', () => {
  it('a média de BPM usa só os atuais e diz de quantos ela fala', () => {
    const summary = projectAdminSummary(
      [
        worker('a', { hrBpm: 70 }),
        worker('b', { hrBpm: 80 }),
        // Fora da janela de atualidade: não entra na média.
        worker('c', { hrBpm: 200, hrAt: minutesAgo(10) }),
        // Nunca reportou: não entra na média nem some da população.
        worker('d', { hrBpm: null }),
      ],
      NOW,
    )

    expect(summary.heartRateAverage.value).toBe(75)
    expect(summary.heartRateAverage.coverage).toEqual({ evaluated: 2, total: 4 })
    expect(summary.heartRateAverage.caption).toBe(PANEL_CAPTIONS.heartRate)
    // Um agregado precisa dizer de quando ele fala, e não só de quantos.
    expect(summary.heartRateAverage.measuredAt).toBe(secondsAgo(5))
  })

  it('sem nenhum valor atual, a média é nula e a legenda muda para sem cobertura', () => {
    const summary = projectAdminSummary([worker('a', { hrBpm: null })], NOW)

    expect(summary.heartRateAverage.value).toBeNull()
    expect(summary.heartRateAverage.coverage).toEqual({ evaluated: 0, total: 1 })
    expect(summary.heartRateAverage.caption).toBe(PANEL_CAPTIONS.noCoverage)
    expect(summary.heartRateAverage.measuredAt).toBeNull()
  })

  it('a taxa de desgaste é média das avaliações atuais e é rotulada como experimental', () => {
    const summary = projectAdminSummary(
      [
        worker('a', { wearPercent: 30 }),
        worker('b', { wearPercent: 50 }),
        worker('c', { wearPercent: 90, wearAt: minutesAgo(5) }),
      ],
      NOW,
    )

    expect(summary.wearRate.value).toBe(40)
    expect(summary.wearRate.coverage).toEqual({ evaluated: 2, total: 3 })
    expect(summary.wearRate.caption).toBe(PANEL_CAPTIONS.wearRate)
  })

  it('a média de pressão só aceita leitura de até 24 horas', () => {
    const summary = projectAdminSummary(
      [
        worker('a', { pressureAt: hoursAgo(2), systolic: 120, diastolic: 80 }),
        worker('b', { pressureAt: hoursAgo(20), systolic: 130, diastolic: 90 }),
        // Histórica: aparece no mobile, mas está fora do painel.
        worker('c', { pressureAt: hoursAgo(40), systolic: 200, diastolic: 120 }),
      ],
      NOW,
    )

    expect(summary.bloodPressureAverage.value).toEqual({ systolic: 125, diastolic: 85 })
    expect(summary.bloodPressureAverage.coverage).toEqual({ evaluated: 2, total: 3 })
  })

  it('movimentos somam o acumulado do dia de quem tem total conhecido', () => {
    const summary = projectAdminSummary(
      [worker('a', { steps: 4_000 }), worker('b', { steps: 2_500 }), worker('c')],
      NOW,
    )

    expect(summary.movements.value).toBe(6_500)
    expect(summary.movements.coverage).toEqual({ evaluated: 2, total: 3 })
    expect(summary.movements.caption).toBe(PANEL_CAPTIONS.movements)
  })

  it('a legenda de movimentos fala do dia monitorado, não da jornada', () => {
    expect(PANEL_CAPTIONS.movements).toBe('Passos acumulados no dia monitorado')
    expect(PANEL_CAPTIONS.movements).not.toMatch(/jornada/i)
  })

  it('painel vazio não inventa zero em lugar nenhum', () => {
    const summary = projectAdminSummary([], NOW)

    expect(summary.heartRateAverage.value).toBeNull()
    expect(summary.wearRate.value).toBeNull()
    expect(summary.bloodPressureAverage.value).toBeNull()
    expect(summary.movements.value).toBeNull()
    expect(summary.vitalSigns.value).toBeNull()
    expect(summary.heartRateAverage.coverage).toEqual({ evaluated: 0, total: 0 })
  })
})

describe('projectAdminSummary: sinais vitais e alertas urgentes', () => {
  it('sinais vitais conta quem tem BPM atual e nenhuma condição cardíaca ativa', () => {
    const summary = projectAdminSummary(
      [
        worker('a', { hrBpm: 70 }),
        worker('b', { hrBpm: 190, conditions: ['HEART_RATE_HIGH'] }),
        // Sem BPM atual: "não avaliado", nunca saudável.
        worker('c', { hrBpm: null }),
      ],
      NOW,
    )

    expect(summary.vitalSigns.value).toBe(1)
    expect(summary.vitalSigns.coverage).toEqual({ evaluated: 2, total: 3 })
    expect(summary.vitalSigns.caption).toBe(PANEL_CAPTIONS.vitalSigns)
  })

  it('alerta urgente conta funcionário, e não quantidade de condições', () => {
    const summary = projectAdminSummary(
      [
        worker('a', { conditions: ['HEART_RATE_HIGH', 'HEART_RATE_LOW'] }),
        worker('b', { conditions: ['HEART_RATE_HIGH'] }),
        worker('c'),
      ],
      NOW,
    )

    expect(summary.urgentAlerts.workers).toBe(2)
  })

  it('revisão de pressão e alerta de aparelho não são urgência automática', () => {
    const summary = projectAdminSummary(
      [
        worker('a', { conditions: ['BLOOD_PRESSURE_REVIEW'] }),
        worker('b', { conditions: ['DEVICE_BATTERY_LOW', 'DEVICE_SIGNAL_LOST'] }),
      ],
      NOW,
    )

    // Só o contador urgente existe na Task 6. Apresentar revisão e alerta de
    // aparelho é da Task 8, dona das condições e da triagem.
    expect(summary.urgentAlerts.workers).toBe(0)
    expect(summary).not.toHaveProperty('reviewAlerts')
    expect(summary).not.toHaveProperty('deviceAlerts')
  })

  it('condição de pressão não tira ninguém de sinais vitais', () => {
    const summary = projectAdminSummary(
      [worker('a', { hrBpm: 70, conditions: ['BLOOD_PRESSURE_REVIEW'] })],
      NOW,
    )

    expect(summary.vitalSigns.value).toBe(1)
  })
})
