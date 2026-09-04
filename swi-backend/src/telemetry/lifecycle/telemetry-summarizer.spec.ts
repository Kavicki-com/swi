import {
  SUMMARIZER_VERSION,
  summarizeDay,
  type SummarizerAssessment,
  type SummarizerSample,
} from './telemetry-summarizer'

// O resumidor é o que permite apagar a Leitura bruta sem perder a história do
// piloto, então ele é puro pelo mesmo motivo que a projeção: "now" entra por
// parâmetro e nada aqui lê relógio nem banco. Estes casos protegem as decisões
// congeladas do ciclo de vida: ausência de métrica nunca vira zero, lacuna
// nunca vira cobertura, e a mesma entrada sempre produz o mesmo Resumo.

/** Dia civil em Brasília 2026-09-02, como data pura (meia-noite UTC). */
const DAY = new Date('2026-09-02T00:00:00.000Z')
/** Instante do cálculo: o job roda depois, com o dia já fechado. */
const COMPUTED_AT = new Date('2026-09-05T06:00:00.000Z')

// 12:00Z é 09:00 em Brasília, bem dentro do dia monitorado 2026-09-02.
const at = (clock: string) => new Date(`2026-09-02T${clock}.000Z`)

const sample = (over: Partial<SummarizerSample> & { eventTime: Date }): SummarizerSample => ({
  sessionId: 'session-1',
  heartRateBpm: null,
  stepDelta: null,
  ...over,
})

const heartRates = (start: string, values: number[], stepSeconds = 30): SummarizerSample[] => {
  const from = at(start).getTime()
  return values.map((heartRateBpm, i) =>
    sample({ eventTime: new Date(from + i * stepSeconds * 1000), heartRateBpm }),
  )
}

const assessment = (clock: string): SummarizerAssessment => ({
  computedAt: at(clock),
  effortPercent: 55,
  wearPercent: 40,
})

const summarize = (
  samples: SummarizerSample[],
  assessments: SummarizerAssessment[] = [],
  origin: 'REAL' | 'DEMO' = 'REAL',
) => summarizeDay({ workerId: 'worker-1', day: DAY, origin, samples, assessments }, COMPUTED_AT)

describe('summarizeDay: estatísticas de BPM', () => {
  it('resume mínimo, máximo, média e quantidade das leituras do dia', () => {
    const summary = summarize(heartRates('12:00:00', [60, 90, 72]))

    expect(summary?.heartRateMin).toBe(60)
    expect(summary?.heartRateMax).toBe(90)
    expect(summary?.heartRateCount).toBe(3)
    expect(summary?.heartRateAvg).toBe(74)
  })

  it('conta só a leitura que traz BPM, e não toda leitura do dia', () => {
    const summary = summarize([
      ...heartRates('12:00:00', [80, 90]),
      sample({ eventTime: at('12:01:00'), stepDelta: 12 }),
    ])

    expect(summary?.heartRateCount).toBe(2)
    expect(summary?.heartRateAvg).toBe(85)
  })
})

describe('summarizeDay: tempo coberto ignora lacuna', () => {
  it('soma os intervalos entre leituras consecutivas de BPM', () => {
    // Quatro leituras de 30 em 30 segundos: três intervalos de 30 s.
    const summary = summarize(heartRates('12:00:00', [70, 71, 72, 73]))

    expect(summary?.heartRateCoveredMs).toBe(90_000)
  })

  it('intervalo acima do prazo de indisponibilidade é lacuna, não cobertura', () => {
    // Duas leituras coladas, silêncio de dez minutos, mais duas coladas. O
    // silêncio não é tempo monitorado: contá-lo diria que o aparelho cobriu um
    // período em que ninguém sabe o que aconteceu.
    const summary = summarize([
      ...heartRates('12:00:00', [70, 71]),
      ...heartRates('12:10:00', [72, 73]),
    ])

    expect(summary?.heartRateCoveredMs).toBe(60_000)
  })

  it('intervalo de exatamente 120 segundos ainda é cobertura', () => {
    // A fronteira é inclusiva: o limite é o mesmo que torna a leitura
    // indisponível, e no instante exato ela ainda não é. Deixá-la de fora aqui
    // faria o Resumo discordar do painel sobre a mesma leitura.
    const summary = summarize(heartRates('12:00:00', [70, 71], 120))

    expect(summary?.heartRateCoveredMs).toBe(120_000)
  })

  it('leitura única não cobre tempo nenhum, e isso é zero e não nulo', () => {
    // Zero aqui é medido, não ausente: houve leitura, e ela não cobre intervalo.
    const summary = summarize(heartRates('12:00:00', [70]))

    expect(summary?.heartRateCoveredMs).toBe(0)
  })
})

describe('summarizeDay: passos', () => {
  it('soma os deltas de passo e conta as leituras que os trazem', () => {
    const summary = summarize([
      sample({ eventTime: at('12:00:00'), stepDelta: 10 }),
      sample({ eventTime: at('12:00:30'), stepDelta: 25 }),
      sample({ eventTime: at('12:01:00'), heartRateBpm: 80 }),
    ])

    expect(summary?.stepsTotal).toBe(35)
    expect(summary?.stepsCount).toBe(2)
  })
})

describe('summarizeDay: ausência é nula, nunca zero', () => {
  it('dia sem BPM deixa as estatísticas de BPM nulas', () => {
    const summary = summarize([sample({ eventTime: at('12:00:00'), stepDelta: 10 })])

    expect(summary?.heartRateMin).toBeNull()
    expect(summary?.heartRateMax).toBeNull()
    expect(summary?.heartRateAvg).toBeNull()
    expect(summary?.heartRateCount).toBeNull()
    expect(summary?.heartRateCoveredMs).toBeNull()
  })

  it('dia sem passo deixa os passos nulos, e não zerados', () => {
    // A diferença importa: zero passos afirma que a pessoa não andou; nulo diz
    // que ninguém mediu. O painel e o relatório leem as duas coisas diferente.
    const summary = summarize(heartRates('12:00:00', [70, 71]))

    expect(summary?.stepsTotal).toBeNull()
    expect(summary?.stepsCount).toBeNull()
  })
})

describe('summarizeDay: cobertura do dia', () => {
  it('conta as leituras e guarda a primeira, a última e o tempo coberto', () => {
    const samples = [
      ...heartRates('12:00:00', [70, 71]),
      sample({ eventTime: at('12:01:00'), stepDelta: 5 }),
    ]

    const summary = summarize(samples)

    expect(summary?.sampleCount).toBe(3)
    expect(summary?.firstSampleAt).toEqual(at('12:00:00'))
    expect(summary?.lastSampleAt).toEqual(at('12:01:00'))
    expect(summary?.coveredMs).toBe(60_000)
  })

  it('a cobertura total olha toda leitura, e não só as que trazem BPM', () => {
    // Uma leitura só de passos no meio da série mantém o aparelho reportando,
    // então ela sustenta a cobertura mesmo sem BPM.
    const summary = summarize([
      sample({ eventTime: at('12:00:00'), heartRateBpm: 70 }),
      sample({ eventTime: at('12:01:00'), stepDelta: 5 }),
      sample({ eventTime: at('12:03:00'), heartRateBpm: 72 }),
    ])

    expect(summary?.coveredMs).toBe(180_000)
    // O BPM, sozinho, teria um intervalo de três minutos: lacuna, não cobertura.
    expect(summary?.heartRateCoveredMs).toBe(0)
  })
})

describe('summarizeDay: quando existe linha', () => {
  it('dia sem leitura e sem avaliação não gera linha', () => {
    expect(summarize([], [])).toBeNull()
  })

  it('dia só com avaliação gera linha, com zero leituras declarado', () => {
    // Zero leituras aqui é fato apurado, não ausência: houve o que resumir.
    const summary = summarize([], [assessment('12:00:00')])

    expect(summary).not.toBeNull()
    expect(summary?.sampleCount).toBe(0)
    expect(summary?.firstSampleAt).toBeNull()
    expect(summary?.coveredMs).toBeNull()
  })
})

describe('summarizeDay: chave e rastro', () => {
  it('carrega funcionário, dia e origem, que são a chave da linha', () => {
    const summary = summarize(heartRates('12:00:00', [70]), [], 'DEMO')

    expect(summary?.workerId).toBe('worker-1')
    expect(summary?.day).toEqual(DAY)
    expect(summary?.origin).toBe('DEMO')
  })

  it('registra a versão do resumidor e o instante recebido, para recálculo rastreável', () => {
    const summary = summarize(heartRates('12:00:00', [70]))

    expect(summary?.summarizerVersion).toBe(SUMMARIZER_VERSION)
    expect(summary?.computedAt).toEqual(COMPUTED_AT)
  })

  it('um dia com centenas de milhares de leituras não estoura a pilha', () => {
    // Um relógio a 1 Hz mandando BPM e passos como eventos separados passa de
    // cem mil leituras num turno longo. Espalhar isso como argumentos de
    // Math.min ou Math.max estoura a pilha, e o dia mais cheio de dado seria
    // justamente o que nunca ganharia Resumo.
    const values = Array.from({ length: 200_000 }, (_, i) => 60 + (i % 40))
    const summary = summarize(heartRates('03:00:00', values, 1))

    expect(summary?.heartRateCount).toBe(200_000)
    expect(summary?.heartRateMin).toBe(60)
    expect(summary?.heartRateMax).toBe(99)
    expect(summary?.sampleCount).toBe(200_000)
  })

  it('a ordem em que as leituras chegam não muda o Resumo', () => {
    // Determinismo é o que torna o Resumo recomputável: a varredura carrega as
    // linhas na ordem que o banco quiser, e isso não pode aparecer no número.
    const serie = [
      ...heartRates('12:00:00', [70, 90, 60]),
      sample({ eventTime: at('12:03:00'), stepDelta: 7 }),
    ]

    const emOrdem = summarize(serie)
    const embaralhado = summarize([serie[3], serie[1], serie[2], serie[0]])

    expect(embaralhado).toEqual(emOrdem)
  })
})
