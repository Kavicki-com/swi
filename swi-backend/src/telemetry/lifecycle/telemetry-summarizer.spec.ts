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
  activeEnergyKcal: null,
  batteryPercent: null,
  systolicMmHg: null,
  diastolicMmHg: null,
  bloodPressureSource: null,
  ...over,
})

const heartRates = (start: string, values: number[], stepSeconds = 30): SummarizerSample[] => {
  const from = at(start).getTime()
  return values.map((heartRateBpm, i) =>
    sample({ eventTime: new Date(from + i * stepSeconds * 1000), heartRateBpm }),
  )
}

const assessment = (
  clock: string,
  over: Partial<SummarizerAssessment> = {},
): SummarizerAssessment => ({
  computedAt: at(clock),
  effortPercent: 55,
  wearPercent: 40,
  ...over,
})

/** Série de avaliações de 30 em 30 segundos com os valores de esforço dados. */
const efforts = (start: string, values: (number | null)[], stepSeconds = 30) => {
  const from = at(start).getTime()
  return values.map((effortPercent, i) => ({
    computedAt: new Date(from + i * stepSeconds * 1000),
    effortPercent,
    wearPercent: null,
  }))
}

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

describe('summarizeDay: energia ativa', () => {
  it('soma a energia e conta as leituras que a trazem', () => {
    const summary = summarize([
      sample({ eventTime: at('12:00:00'), activeEnergyKcal: 1.5 }),
      sample({ eventTime: at('12:00:30'), activeEnergyKcal: 2.25 }),
      sample({ eventTime: at('12:01:00'), heartRateBpm: 80 }),
    ])

    expect(summary?.activeEnergyKcalTotal).toBe(3.75)
    expect(summary?.activeEnergyCount).toBe(2)
  })
})

describe('summarizeDay: bateria', () => {
  it('guarda o mínimo do dia, que é o pior momento de autonomia', () => {
    const summary = summarize([
      sample({ eventTime: at('12:00:00'), batteryPercent: 80 }),
      sample({ eventTime: at('12:00:30'), batteryPercent: 12 }),
      sample({ eventTime: at('12:01:00'), batteryPercent: 45 }),
    ])

    expect(summary?.batteryMin).toBe(12)
  })

  it('dia sem leitura de bateria deixa o mínimo nulo', () => {
    expect(summarize(heartRates('12:00:00', [70]))?.batteryMin).toBeNull()
  })
})

describe('summarizeDay: sessões que tocaram o dia', () => {
  it('conta sessões distintas, e não leituras', () => {
    // Um turno que cruza a meia-noite abre sessão nova, e uma reconexão do
    // relógio também. Saber quantas tocaram o dia é o que separa "monitorado o
    // dia todo" de "monitorado em pedaços".
    const summary = summarize([
      sample({ eventTime: at('12:00:00'), sessionId: 'a', heartRateBpm: 70 }),
      sample({ eventTime: at('12:00:30'), sessionId: 'a', heartRateBpm: 71 }),
      sample({ eventTime: at('12:01:00'), sessionId: 'b', heartRateBpm: 72 }),
    ])

    expect(summary?.sessionCount).toBe(2)
  })
})

describe('summarizeDay: esforço e desgaste', () => {
  it('resume máximo, média e quantidade de cada um, separados', () => {
    const summary = summarize(
      [],
      [
        assessment('12:00:00', { effortPercent: 40, wearPercent: 10 }),
        assessment('12:00:30', { effortPercent: 90, wearPercent: 30 }),
        assessment('12:01:00', { effortPercent: 50, wearPercent: null }),
      ],
    )

    expect(summary?.effortMax).toBe(90)
    expect(summary?.effortAvg).toBe(60)
    expect(summary?.effortCount).toBe(3)
    expect(summary?.wearMax).toBe(30)
    expect(summary?.wearAvg).toBe(20)
    // Desgaste tem uma avaliação a menos: os dois não compartilham denominador.
    expect(summary?.wearCount).toBe(2)
  })

  it('dia sem avaliação deixa esforço e desgaste nulos', () => {
    const summary = summarize(heartRates('12:00:00', [70]))

    expect(summary?.effortMax).toBeNull()
    expect(summary?.effortAvg).toBeNull()
    expect(summary?.effortCount).toBeNull()
    expect(summary?.effortAbove80Ms).toBeNull()
    expect(summary?.wearCount).toBeNull()
  })
})

describe('summarizeDay: tempo acima de 80 por cento', () => {
  it('soma os intervalos entre avaliações que estão em 80 ou mais', () => {
    // Quatro avaliações seguidas acima do limite, de 30 em 30 segundos: três
    // intervalos de 30 s.
    const summary = summarize([], efforts('12:00:00', [85, 90, 82, 95]))

    expect(summary?.effortAbove80Ms).toBe(90_000)
  })

  it('80 exato conta: o limite é "80 ou mais"', () => {
    const summary = summarize([], efforts('12:00:00', [80, 80]))

    expect(summary?.effortAbove80Ms).toBe(30_000)
  })

  it('avaliação abaixo do limite quebra a sequência, e o intervalo não conta', () => {
    // Acima, abaixo, acima: os dois trechos altos estão a 60 s um do outro, mas
    // o meio não estava acima do limite. Contar seria afirmar esforço alto num
    // momento em que ele foi medido baixo.
    const summary = summarize([], efforts('12:00:00', [85, 40, 88]))

    expect(summary?.effortAbove80Ms).toBe(0)
  })

  it('lacuna maior que o prazo não vira tempo acima do limite', () => {
    // Mesma regra do tempo coberto: dez minutos de silêncio entre duas medidas
    // altas não são dez minutos de esforço alto.
    const summary = summarize([], [
      ...efforts('12:00:00', [85, 90]),
      ...efforts('12:10:00', [88, 92]),
    ])

    expect(summary?.effortAbove80Ms).toBe(60_000)
  })

  it('avaliação sem valor no meio é silêncio, não esforço baixo', () => {
    // Nulo é "ninguém mediu", e é a mesma regra do tempo coberto: um silêncio
    // curto entre duas medidas altas não quebra a sequência. Tratar o nulo
    // como baixo inventaria um valor que o aparelho não reportou.
    const summary = summarize([], efforts('12:00:00', [85, null, 88]))

    expect(summary?.effortAbove80Ms).toBe(60_000)
  })

  it('esforço e desgaste têm tempos acima do limite independentes', () => {
    const summary = summarize(
      [],
      [
        assessment('12:00:00', { effortPercent: 85, wearPercent: 20 }),
        assessment('12:00:30', { effortPercent: 90, wearPercent: 25 }),
      ],
    )

    expect(summary?.effortAbove80Ms).toBe(30_000)
    expect(summary?.wearAbove80Ms).toBe(0)
  })
})

describe('summarizeDay: pressão arterial', () => {
  const bp = (clock: string, systolic: number, diastolic: number) =>
    sample({
      eventTime: at(clock),
      systolicMmHg: systolic,
      diastolicMmHg: diastolic,
      bloodPressureSource: 'EXTERNAL_CUFF',
    })

  it('conta as medições e guarda a última do dia, com origem e horário', () => {
    const summary = summarize([bp('08:00:00', 130, 85), bp('18:00:00', 120, 78)])

    expect(summary?.bloodPressureCount).toBe(2)
    expect(summary?.lastSystolicMmHg).toBe(120)
    expect(summary?.lastDiastolicMmHg).toBe(78)
    expect(summary?.lastBloodPressureSource).toBe('EXTERNAL_CUFF')
    expect(summary?.lastBloodPressureAt).toEqual(at('18:00:00'))
  })

  it('no mesmo instante, a última é a de maior sistólica, depois maior diastólica', () => {
    // Duas aferições no mesmo milissegundo (possível entre sessões) deixariam
    // "a última" dependente da ordem de chegada, e o Resumo deixaria de ser
    // recomputável. O desempate erra para o lado do cuidado: pior caso vence.
    const empatadas = [bp('18:00:00', 120, 78), bp('18:00:00', 135, 85)]

    const direto = summarize(empatadas)
    const invertido = summarize([...empatadas].reverse())

    expect(direto?.lastSystolicMmHg).toBe(135)
    expect(direto?.lastDiastolicMmHg).toBe(85)
    expect(invertido).toEqual(direto)

    const mesmaSistolica = summarize([bp('18:00:00', 130, 80), bp('18:00:00', 130, 90)])
    expect(mesmaSistolica?.lastDiastolicMmHg).toBe(90)
  })

  it('só conta a medição com o par completo', () => {
    // Pressão é o par, não dois números soltos: a ingestão já recusa meia
    // medição, e contar uma linha capenga aqui inventaria uma aferição.
    const summary = summarize([
      bp('08:00:00', 130, 85),
      sample({ eventTime: at('09:00:00'), systolicMmHg: 140, diastolicMmHg: null }),
    ])

    expect(summary?.bloodPressureCount).toBe(1)
    expect(summary?.lastSystolicMmHg).toBe(130)
  })

  it('dia sem aferição deixa todos os campos de pressão nulos', () => {
    const summary = summarize(heartRates('12:00:00', [70]))

    expect(summary?.bloodPressureCount).toBeNull()
    expect(summary?.lastSystolicMmHg).toBeNull()
    expect(summary?.lastDiastolicMmHg).toBeNull()
    expect(summary?.lastBloodPressureSource).toBeNull()
    expect(summary?.lastBloodPressureAt).toBeNull()
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

  it('a versão está fixada, para que mudá-la seja decisão e não acidente', () => {
    // A varredura recandidata dia cujo Resumo veio de outra versão, então este
    // literal é o gatilho de recálculo de todo o histórico. Ele não pode mudar
    // junto com um refactor qualquer.
    expect(SUMMARIZER_VERSION).toBe('swi-daily-summary-2')
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

  it('a soma de energia não depende da ordem em que o banco devolveu as linhas', () => {
    // Soma de ponto flutuante não é associativa: 0.1 + 0.2 + 0.3 dá resultado
    // diferente de 0.3 + 0.2 + 0.1 nos últimos bits. A consulta não pede
    // ordenação, então duas rodadas poderiam gravar totais diferentes para o
    // mesmo dia, e o Resumo deixaria de ser recomputável.
    const serie = [
      sample({ eventTime: at('12:00:00'), activeEnergyKcal: 0.1 }),
      sample({ eventTime: at('12:00:30'), activeEnergyKcal: 0.2 }),
      sample({ eventTime: at('12:01:00'), activeEnergyKcal: 0.3 }),
    ]

    const emOrdem = summarize(serie)
    const invertido = summarize([...serie].reverse())

    expect(invertido?.activeEnergyKcalTotal).toBe(emOrdem?.activeEnergyKcalTotal)
    expect(invertido).toEqual(emOrdem)
  })
})
