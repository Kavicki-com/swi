// describe/it/expect vêm dos globals do Vitest.
import { neverReported, noMetric, reporting } from '@/test-utils/telemetryFixtures'
import { pairedFatigue } from './pairedFatigue'

describe('pairedFatigue', () => {
  it('ainda consultando o aparelho não afirma nada', () => {
    expect(pairedFatigue({ device: 'loading', telemetry: null, failed: false })).toEqual({
      label: '--',
      sourceBadge: null,
    })
  })

  // Vale para admin e para funcionário sem aparelho: não há de onde vir o dado.
  it('sem aparelho diz isso', () => {
    expect(pairedFatigue({ device: 'none', telemetry: null, failed: false }).label).toBe(
      'Sem aparelho pareado',
    )
  })

  it('falha diz que a leitura está indisponível', () => {
    expect(pairedFatigue({ device: 'loading', telemetry: null, failed: true }).label).toBe(
      'Leitura indisponível no momento',
    )
  })

  it('pareado que nunca reportou diz que não há leitura', () => {
    expect(
      pairedFatigue({ device: 'paired', telemetry: neverReported(), failed: false }).label,
    ).toBe('Sem leitura do aparelho')
  })

  it('pareado com avaliação mostra o tempo até a fadiga', () => {
    expect(pairedFatigue({ device: 'paired', telemetry: reporting(), failed: false }).label).toBe(
      '95 minutos',
    )
  })

  it('pareado sem estimativa e com desgaste diz que o ritmo não leva à fadiga', () => {
    const t = reporting({ fatigueEtaMin: noMetric('min') })
    expect(pairedFatigue({ device: 'paired', telemetry: t, failed: false }).label).toBe(
      'Sem previsão de fadiga no ritmo atual',
    )
  })

  it('leitura de demonstração leva o selo', () => {
    const t = reporting({}, 'DEMO')
    expect(pairedFatigue({ device: 'paired', telemetry: t, failed: false }).sourceBadge).toBe(
      'Dados de demonstração',
    )
  })

  // Pulseira lida pelo Android chega em lote: o selo diz até quando há dado e
  // quando sincronizou. A regex não fixa hora nem data, então vale em qualquer fuso.
  it('leitura sincronizada pela pulseira leva o selo do atraso', () => {
    const now = Date.now()
    const t = {
      ...reporting(),
      sync: {
        measuredUntil: new Date(now - 50 * 60_000).toISOString(),
        syncedAt: new Date(now - 2 * 60_000).toISOString(),
      },
    }
    expect(pairedFatigue({ device: 'paired', telemetry: t, failed: false }).sourceBadge).toMatch(
      /^Dados até .+, sincronizado .+$/,
    )
  })
})
