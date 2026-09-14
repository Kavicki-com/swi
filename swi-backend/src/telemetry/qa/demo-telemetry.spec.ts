import { assertNotProduction, batchesFor, SCENARIOS } from './demo-telemetry'

// O gerador é a parte pura do script de homologação: recebe um cenário e
// devolve lotes no formato exato que a ingestão aceita. É o que dá para
// provar sem banco. O que ele protege: a origem é sempre DEMO (o rótulo que
// impede dado injetado de ser confundido com real), ausência nunca vira zero,
// e o movimento vai como contagem por intervalo, que é o que a fórmula divide.

const SESSAO = '11111111-1111-4111-8111-111111111111'
const T_FIM = new Date('2026-09-13T12:00:00.000Z')
const UUID_MINUSCULO = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const eventos = (batches: ReturnType<typeof batchesFor>) => batches.flatMap((b) => b.events)

describe('gerador de cenário de demonstração', () => {
  it('gera um evento por cadência, com origem DEMO e sequência contígua desde 0', () => {
    const all = eventos(batchesFor(SCENARIOS.repouso, { sessionId: SESSAO, endAt: T_FIM }))
    // 30 min a 5 s: 360 eventos.
    expect(all).toHaveLength(360)
    expect(all.every((e) => e.origin === 'DEMO')).toBe(true)
    expect(all.every((e) => e.monitoringSessionId === SESSAO)).toBe(true)
    expect(all.map((e) => e.sequence)).toEqual(all.map((_, i) => i))
  })

  it('o último evento termina em endAt e os anteriores recuam pela cadência', () => {
    // Terminar em endAt é o que faz os últimos eventos serem "atuais" no read
    // model, em vez de um passado que a tela chamaria de indisponível.
    const all = eventos(batchesFor(SCENARIOS.repouso, { sessionId: SESSAO, endAt: T_FIM }))
    expect(all[all.length - 1].eventTime).toBe(T_FIM.toISOString())
    expect(all[all.length - 2].eventTime).toBe(new Date(T_FIM.getTime() - 5_000).toISOString())
    expect(all[0].eventTime).toBe(new Date(T_FIM.getTime() - 359 * 5_000).toISOString())
  })

  it('respeita o teto de 200 eventos por lote, que é o da ingestão', () => {
    const batches = batchesFor(SCENARIOS.alerta, { sessionId: SESSAO, endAt: T_FIM })
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.every((b) => b.events.length <= 200)).toBe(true)
    // Nada se perde na divisão.
    expect(eventos(batches)).toHaveLength(SCENARIOS.alerta.segments.reduce((n, [s]) => n + s / 5, 0))
  })

  it('segmento sem batimento não escreve heartRate, e nunca escreve zero', () => {
    const cenario = { cadenceSec: 5, segments: [[30, null, 10]] as const }
    const all = eventos(batchesFor(cenario, { sessionId: SESSAO, endAt: T_FIM }))
    expect(all).toHaveLength(6)
    for (const e of all) {
      expect(e.measurements).not.toHaveProperty('heartRate')
      expect(e.measurements.motionCount).toBeDefined()
    }
  })

  it('movimento vai como contagem por intervalo, não como taxa', () => {
    // 30 picos por minuto a cada 5 s são 2,5 por evento: o backend divide a
    // contagem pelo intervalo desde o evento anterior, qualquer evento.
    const cenario = { cadenceSec: 5, segments: [[10, 95, 30]] as const }
    const all = eventos(batchesFor(cenario, { sessionId: SESSAO, endAt: T_FIM }))
    expect(all.map((e) => e.measurements.motionCount)).toEqual([
      { value: 2.5, unit: 'count', source: 'APPLE_WATCH' },
      { value: 2.5, unit: 'count', source: 'APPLE_WATCH' },
    ])
  })

  it('passos e energia são variações inteiras e não negativas, e batimento sai como veio', () => {
    const all = eventos(batchesFor(SCENARIOS.intenso, { sessionId: SESSAO, endAt: T_FIM }))
    for (const e of all) {
      expect(e.measurements.heartRate).toEqual({ value: 165, unit: 'bpm', source: 'APPLE_WATCH' })
      const steps = e.measurements.stepDelta?.value
      const kcal = e.measurements.activeEnergyKcal?.value
      expect(Number.isInteger(steps)).toBe(true)
      expect(steps).toBeGreaterThanOrEqual(0)
      expect(kcal).toBeGreaterThanOrEqual(0)
    }
    // Esforço intenso caminha: a soma dos passos em 30 min tem de ser positiva.
    expect(all.reduce((n, e) => n + (e.measurements.stepDelta?.value ?? 0), 0)).toBeGreaterThan(0)
  })

  it('bateria entra a cada 3 minutos, cai devagar e nunca é zero por ausência', () => {
    const all = eventos(batchesFor(SCENARIOS.repouso, { sessionId: SESSAO, endAt: T_FIM }))
    const comBateria = all.filter((e) => e.measurements.battery !== undefined)
    // 30 min a cada 3 min, contando a do primeiro evento (0:00 a 27:00): a
    // marca de 30:00 cai depois do último evento, que é 29:55.
    expect(comBateria).toHaveLength(10)
    const valores = comBateria.map((e) => e.measurements.battery!.value)
    expect(valores[0]).toBeGreaterThan(valores[valores.length - 1])
    expect(valores.every((v) => v > 0 && v <= 100)).toBe(true)
  })

  it('identificadores de evento são UUID em minúsculas e únicos', () => {
    const all = eventos(batchesFor(SCENARIOS.leve, { sessionId: SESSAO, endAt: T_FIM }))
    expect(all.every((e) => UUID_MINUSCULO.test(e.eventId))).toBe(true)
    expect(new Set(all.map((e) => e.eventId)).size).toBe(all.length)
  })
})

describe('gate do script de homologação', () => {
  // A mesma regra do simulador de posições: produção nunca, e nunca por
  // acidente. O gate roda antes de qualquer import do Nest.
  it('recusa em produção mesmo com a variável de QA ligada', () => {
    expect(() => assertNotProduction({ NODE_ENV: 'production', QA_DEMO_TELEMETRY: '1' })).toThrow(
      /produção/,
    )
  })

  it('recusa sem a variável de QA explicitamente ligada', () => {
    expect(() => assertNotProduction({ NODE_ENV: 'development' })).toThrow(/QA_DEMO_TELEMETRY/)
    expect(() => assertNotProduction({ NODE_ENV: 'development', QA_DEMO_TELEMETRY: '0' })).toThrow()
  })

  it('passa fora de produção com a variável ligada', () => {
    expect(() => assertNotProduction({ NODE_ENV: 'development', QA_DEMO_TELEMETRY: '1' })).not.toThrow()
    expect(() => assertNotProduction({ QA_DEMO_TELEMETRY: '1' })).not.toThrow()
  })
})
