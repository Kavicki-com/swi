// describe/it/expect vêm dos globals do Vitest.
import { emptyPoint, series } from '@/test-utils/telemetryFixtures'
import type { SeriesPoint } from '@/services/api/telemetry'
import { caloriesPointsFrom, PERIOD_FROM_OPTION } from './caloriesSeries'

const point = (start: string, end: string, kcal: number | null): SeriesPoint => ({
  ...emptyPoint(start, end),
  activeEnergyKcal: kcal,
})

const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })

describe('caloriesPointsFrom', () => {
  it('cada balde com medição vira um ponto, com a hora de início no dia de hoje', () => {
    const s = series(
      [
        point('2026-10-01T11:00:00.000Z', '2026-10-01T12:00:00.000Z', 62.4),
        point('2026-10-01T12:00:00.000Z', '2026-10-01T13:00:00.000Z', 80),
      ],
      { bucket: 'hour', period: 'day' },
    )
    expect(caloriesPointsFrom(s)).toEqual([
      { time: hour('2026-10-01T11:00:00.000Z'), kcal: 62 },
      { time: hour('2026-10-01T12:00:00.000Z'), kcal: 80 },
    ])
  })

  it('balde diário leva a data, não a hora', () => {
    const s = series([point('2026-09-30T03:00:00.000Z', '2026-10-01T03:00:00.000Z', 1840)], {
      bucket: 'day',
      period: 'week',
    })
    expect(caloriesPointsFrom(s)).toEqual([{ time: day('2026-09-30T03:00:00.000Z'), kcal: 1840 }])
  })

  // Balde sem medição entre duas medições vira ponto nulo: o gráfico do DS
  // interrompe a linha ali em vez de ligar os vizinhos. Nunca entra como zero.
  it('balde sem medição no meio vira buraco, nunca zero', () => {
    const s = series(
      [
        point('2026-10-01T11:00:00.000Z', '2026-10-01T12:00:00.000Z', 40),
        point('2026-10-01T12:00:00.000Z', '2026-10-01T13:00:00.000Z', null),
        point('2026-10-01T13:00:00.000Z', '2026-10-01T14:00:00.000Z', 0),
      ],
      { bucket: 'hour', period: 'day' },
    )
    expect(caloriesPointsFrom(s)).toEqual([
      { time: hour('2026-10-01T11:00:00.000Z'), kcal: 40 },
      { time: hour('2026-10-01T12:00:00.000Z'), kcal: null },
      { time: hour('2026-10-01T13:00:00.000Z'), kcal: 0 },
    ])
  })

  // Antes da primeira medição e depois da última não há curva a interromper:
  // esses baldes saem, para o gráfico não abrir com um vazio.
  it('baldes sem medição nas pontas ficam fora', () => {
    const s = series(
      [
        point('2026-10-01T10:00:00.000Z', '2026-10-01T11:00:00.000Z', null),
        point('2026-10-01T11:00:00.000Z', '2026-10-01T12:00:00.000Z', 40),
        point('2026-10-01T12:00:00.000Z', '2026-10-01T13:00:00.000Z', null),
      ],
      { bucket: 'hour', period: 'day' },
    )
    expect(caloriesPointsFrom(s)).toEqual([{ time: hour('2026-10-01T11:00:00.000Z'), kcal: 40 }])
  })

  it('série sem nenhuma medição devolve lista vazia', () => {
    const s = series([point('2026-10-01T11:00:00.000Z', '2026-10-01T12:00:00.000Z', null)])
    expect(caloriesPointsFrom(s)).toEqual([])
  })

  it('as opções do seletor apontam para os períodos do backend', () => {
    expect(PERIOD_FROM_OPTION).toEqual({ today: 'day', week: 'week', month: 'month' })
  })
})
