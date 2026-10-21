// describe/it/expect vêm dos globals do Vitest; importar de 'vitest' duplica a instância.
import { metric, neverReported, noMetric as none, reporting } from '@/test-utils/telemetryFixtures'
import { vitalsViewFrom } from './vitalsView'
import { whenLabel } from '@/lib/whenLabel'

const OLD = '2026-10-01T14:20:00.000Z'

describe('vitalsViewFrom', () => {
  it('leitura atual mostra o batimento e diz que está monitorando agora', () => {
    const view = vitalsViewFrom(reporting())
    expect(view.heartRate).toBe('112')
    expect(view.status).toBe('Monitorando agora')
    expect(view.sourceBadge).toBeNull()
  })

  it('desgaste com repouso provisório leva o selo de estimativa; demonstração vence; sem desgaste não há selo', () => {
    expect(vitalsViewFrom({ ...reporting(), baseline: 'PROVISIONAL' }).sourceBadge).toBe(
      'Estimativa provisória',
    )
    expect(vitalsViewFrom({ ...reporting({}, 'DEMO'), baseline: 'PROVISIONAL' }).sourceBadge).toBe(
      'Dados de demonstração',
    )
    expect(
      vitalsViewFrom({ ...reporting({ wear: none('%') }), baseline: 'PROVISIONAL' }).sourceBadge,
    ).toBeNull()
    expect(vitalsViewFrom({ ...reporting(), baseline: 'MEASURED' }).sourceBadge).toBeNull()
  })

  it('leitura desatualizada do mesmo dia mantém o valor e diz o horário', () => {
    const now = new Date('2026-10-01T20:00:00.000Z').getTime()
    const view = vitalsViewFrom(
      reporting({ heartRate: metric(98, { quality: 'STALE', measuredAt: OLD }) }),
      { now },
    )
    expect(view.heartRate).toBe('98')
    expect(view.status).toBe(`Última leitura ${whenLabel(OLD, now)}`)
  })

  // Sem a data, uma leitura de dias atrás parecia de hoje (o backend guarda o
  // último bpm para sempre). whenLabel mostra "em dd/mm às HH:mm" fora do dia.
  it('leitura desatualizada de outro dia mostra a data junto do horário', () => {
    const now = new Date('2026-10-05T10:00:00.000Z').getTime()
    const view = vitalsViewFrom(
      reporting({ heartRate: metric(98, { quality: 'STALE', measuredAt: OLD }) }),
      { now },
    )
    expect(view.status).toMatch(/^Última leitura em 01\/10 às \d{2}:\d{2}$/)
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
    expect(vitalsViewFrom(null, { noDevice: true }).status).toBe('Sem relógio pareado')
    // Falha de rede não é ausência de aparelho: a frase não pode culpar o relógio.
    expect(vitalsViewFrom(null, { failed: true }).status).toBe('Leitura indisponível no momento')
  })

  it('sem aparelho pareado esconde a leitura que o backend guardou', () => {
    // Desparear não apaga o último snapshot: mostrar o batimento antigo seria dado falso.
    const view = vitalsViewFrom(
      reporting({ heartRate: metric(86, { quality: 'STALE', measuredAt: OLD }) }),
      { noDevice: true },
    )
    expect(view.heartRate).toBeNull()
    expect(view.pressure).toBeNull()
    expect(view.wearPct).toBeNull()
    expect(view.effortPct).toBeNull()
    expect(view.fatigueEta).toEqual({ minutes: null, label: 'Sem estimativa' })
    expect(view.status).toBe('Sem relógio pareado')
  })

  // Enquanto não se sabe se há relógio, a leitura guardada pode ser de quem já
  // despareou: não aparece como atual.
  it('sem saber se há relógio, esconde a leitura e diz que está verificando', () => {
    const view = vitalsViewFrom(reporting(), { deviceUnknown: true })
    expect(view.heartRate).toBeNull()
    expect(view.pressure).toBeNull()
    expect(view.status).toBe('Verificando o relógio…')
  })

  it('sem conseguir saber se há relógio, esconde a leitura e diz que está indisponível', () => {
    const view = vitalsViewFrom(reporting(), { deviceUnknown: true, failed: true })
    expect(view.heartRate).toBeNull()
    expect(view.status).toBe('Leitura indisponível no momento')
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

  // Pulseira lida pelo Health Connect: a leitura chega em lotes e vale para o
  // instante medido, não para agora. O painel diz até quando há dados e quando
  // o lote chegou, no relógio de quem está olhando. Os instantes são montados
  // no fuso local para "mesmo dia" e "outro dia" valerem em qualquer máquina.
  describe('leitura sincronizada pela pulseira (sync)', () => {
    const local = (day: number, hour: number, minute: number) =>
      new Date(2026, 8, day, hour, minute).toISOString()
    const hhmm = (iso: string) =>
      new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    const now = new Date(2026, 8, 30, 12, 0).getTime()
    const MEASURED = local(30, 11, 10)
    const SYNCED = local(30, 12, 2)
    const YESTERDAY_MEASURED = local(29, 14, 10)
    const YESTERDAY_SYNCED = local(29, 23, 50)
    const synced = (measuredUntil = MEASURED, syncedAt = SYNCED) => ({
      ...reporting(),
      sync: { measuredUntil, syncedAt },
    })

    it('no mesmo dia o selo diz até que hora há dados e quando sincronizou', () => {
      const view = vitalsViewFrom(synced(), { now })
      expect(view.sourceBadge).toBe(`Dados até ${hhmm(MEASURED)}, sincronizado às ${hhmm(SYNCED)}`)
      expect(view.sourceBadge).toMatch(/^Dados até \d{2}:\d{2}, sincronizado às \d{2}:\d{2}$/)
    })

    it('em outro dia cada parte leva a data, para dado velho não parecer de hoje', () => {
      expect(vitalsViewFrom(synced(YESTERDAY_MEASURED, SYNCED), { now }).sourceBadge).toBe(
        `Dados até 29/09 às ${hhmm(YESTERDAY_MEASURED)}, sincronizado às ${hhmm(SYNCED)}`,
      )
      expect(
        vitalsViewFrom(synced(YESTERDAY_MEASURED, YESTERDAY_SYNCED), { now }).sourceBadge,
      ).toBe(
        `Dados até 29/09 às ${hhmm(YESTERDAY_MEASURED)}, sincronizado em 29/09 às ${hhmm(YESTERDAY_SYNCED)}`,
      )
    })

    it('demonstração vence a sincronização, que vence a estimativa provisória', () => {
      expect(
        vitalsViewFrom({ ...synced(), origin: 'DEMO', baseline: 'PROVISIONAL' }, { now })
          .sourceBadge,
      ).toBe('Dados de demonstração')
      expect(vitalsViewFrom({ ...synced(), baseline: 'PROVISIONAL' }, { now }).sourceBadge).toBe(
        `Dados até ${hhmm(MEASURED)}, sincronizado às ${hhmm(SYNCED)}`,
      )
    })

    it('as roscas de fadiga e esforço dizem o instante medido de cada métrica', () => {
      const view = vitalsViewFrom(
        {
          ...synced(),
          metrics: {
            ...reporting().metrics,
            wear: metric(38.4, { source: 'DERIVED', measuredAt: MEASURED }),
            effort: metric(61, { source: 'DERIVED', measuredAt: YESTERDAY_MEASURED }),
          },
        },
        { now },
      )
      expect(view.wearLabel).toBe(`Fadiga ${whenLabel(MEASURED, now)}`)
      expect(view.wearLabel).toMatch(/^Fadiga às \d{2}:\d{2}$/)
      expect(view.effortLabel).toBe(`Esforço feito ${whenLabel(YESTERDAY_MEASURED, now)}`)
      expect(view.effortLabel).toMatch(/^Esforço feito em 29\/09 às \d{2}:\d{2}$/)
    })

    it('métrica sem instante próprio usa o fim dos dados sincronizados', () => {
      const view = vitalsViewFrom(
        {
          ...synced(),
          metrics: {
            ...reporting().metrics,
            wear: metric(38.4, { source: 'DERIVED', measuredAt: null }),
            effort: metric(61, { source: 'DERIVED', measuredAt: null }),
          },
        },
        { now },
      )
      expect(view.wearLabel).toBe(`Fadiga ${whenLabel(MEASURED, now)}`)
      expect(view.effortLabel).toBe(`Esforço feito ${whenLabel(MEASURED, now)}`)
    })

    it('com sync mas sem valor a rosca mantém o rótulo padrão, sem instante medido', () => {
      const view = vitalsViewFrom(
        {
          ...synced(),
          metrics: {
            ...reporting().metrics,
            wear: metric(0, { value: null, source: 'DERIVED', measuredAt: MEASURED }),
            effort: metric(0, { value: null, source: 'DERIVED', measuredAt: MEASURED }),
          },
        },
        { now },
      )
      expect(view.wearLabel).toBe('Fadiga atual')
      expect(view.effortLabel).toBe('Esforço feito')
    })

    it('data inválida no sync cai na estimativa provisória e nos rótulos padrão', () => {
      const view = vitalsViewFrom({ ...synced('x'), baseline: 'PROVISIONAL' }, { now })
      expect(view.sourceBadge).toBe('Estimativa provisória')
      expect(view.wearLabel).toBe('Fadiga atual')
      expect(view.effortLabel).toBe('Esforço feito')
    })

    it('sem sync (ausente ou nulo) as roscas mantêm os rótulos de hoje e não há selo', () => {
      for (const telemetry of [reporting(), { ...reporting(), sync: null }]) {
        const view = vitalsViewFrom(telemetry, { now })
        expect(view.sourceBadge).toBeNull()
        expect(view.wearLabel).toBe('Fadiga atual')
        expect(view.effortLabel).toBe('Esforço feito')
      }
    })

    it('a visão vazia usa os rótulos padrão mesmo com sync na leitura guardada', () => {
      for (const view of [
        vitalsViewFrom(synced(), { now, noDevice: true }),
        vitalsViewFrom(synced(), { now, deviceUnknown: true }),
        vitalsViewFrom(
          { ...neverReported(), sync: { measuredUntil: MEASURED, syncedAt: SYNCED } },
          { now },
        ),
        vitalsViewFrom(null, { now }),
      ]) {
        expect(view.sourceBadge).toBeNull()
        expect(view.wearLabel).toBe('Fadiga atual')
        expect(view.effortLabel).toBe('Esforço feito')
      }
    })
  })
})
