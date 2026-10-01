// describe/it/expect vêm dos globals do Vitest; importar de 'vitest' duplica a instância.
import { metric, neverReported, noMetric as none, reporting } from '@/test-utils/telemetryFixtures'
import { vitalsViewFrom } from './vitalsView'

const OLD = '2026-10-01T14:20:00.000Z'

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

describe('vitalsViewFrom', () => {
  it('leitura atual mostra o batimento e diz que está monitorando agora', () => {
    const view = vitalsViewFrom(reporting())
    expect(view.heartRate).toBe('112')
    expect(view.status).toBe('Monitorando agora')
    expect(view.sourceBadge).toBeNull()
  })

  it('leitura desatualizada mantém o valor e diz o horário da última', () => {
    const view = vitalsViewFrom(
      reporting({ heartRate: metric(98, { quality: 'STALE', measuredAt: OLD }) }),
    )
    expect(view.heartRate).toBe('98')
    expect(view.status).toBe(`Última leitura às ${clock(OLD)}`)
  })

  it('quem nunca reportou não vira zero: tudo é ausência declarada', () => {
    const view = vitalsViewFrom(neverReported())
    expect(view.heartRate).toBeNull()
    expect(view.pressure).toBeNull()
    expect(view.wearPct).toBeNull()
    expect(view.effortPct).toBeNull()
    expect(view.fatigueEta).toEqual({ minutes: null, label: 'Sem estimativa' })
    expect(view.status).toBe('Sem leitura do aparelho')
  })

  it('sem leitura alguma (falha ou admin) usa a frase pedida', () => {
    expect(vitalsViewFrom(null).status).toBe('Sem leitura do aparelho')
    expect(vitalsViewFrom(null, { noDevice: true }).status).toBe('Sem aparelho')
    // Falha de rede não é ausência de aparelho: a frase não pode culpar o relógio.
    expect(vitalsViewFrom(null, { failed: true }).status).toBe('Leitura indisponível no momento')
  })

  it('batimento indisponível de quem já reportou diz que não há leitura recente', () => {
    const view = vitalsViewFrom(reporting({ heartRate: none('bpm') }))
    expect(view.heartRate).toBeNull()
    expect(view.status).toBe('Sem leitura recente')
  })

  it('pressão vem como sistólica/diastólica, e sem medição é nula', () => {
    const view = vitalsViewFrom(
      reporting({
        bloodPressure: metric({ systolic: 128, diastolic: 82 }, { source: 'EXTERNAL_CUFF' }),
      }),
    )
    expect(view.pressure).toBe('128/82')
    expect(vitalsViewFrom(reporting()).pressure).toBeNull()
  })

  it('fadiga e esforço chegam em 0-100 e são arredondados a uma casa', () => {
    const view = vitalsViewFrom(reporting())
    expect(view.wearPct).toBe(38.4)
    expect(view.effortPct).toBe(61)
  })

  it('tempo até a fadiga em minutos inteiros quando há estimativa', () => {
    expect(vitalsViewFrom(reporting()).fatigueEta).toEqual({ minutes: 95, label: '95 minutos' })
  })

  it('sem estimativa com desgaste presente: o ritmo atual não leva à fadiga', () => {
    const view = vitalsViewFrom(reporting({ fatigueEtaMin: none('min') }))
    expect(view.fatigueEta).toEqual({
      minutes: null,
      label: 'Sem previsão de fadiga no ritmo atual',
    })
  })

  it('origem de demonstração é declarada na tela', () => {
    expect(vitalsViewFrom(reporting({}, 'DEMO')).sourceBadge).toBe('Dados de demonstração')
  })
})
