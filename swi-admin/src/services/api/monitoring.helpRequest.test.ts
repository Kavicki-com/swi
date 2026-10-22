// Pedido de ajuda do app na fila de alertas: a condição HELP_REQUESTED nasce
// encerrada (não é medição), então o cartão não pode dizer que a leitura
// voltou nem que a condição fechou. O estado do pedido mora no alerta.
import { vi } from 'vitest'

vi.mock('./users', () => ({ adminsApi: { list: vi.fn() }, employeesApi: { list: vi.fn() } }))
vi.mock('./reports', () => ({ reportsApi: { list: vi.fn() } }))
vi.mock('./telemetry', () => ({ telemetryApi: { alerts: vi.fn() } }))
vi.mock('./cameras', () => ({ countCameras: vi.fn() }))

import { alertDetailFrom, describeCondition } from './monitoring'
import { alertItem, FIXTURE_AT } from '@/test-utils/telemetryFixtures'

const helpAlert = (over: Parameters<typeof alertItem>[1] = {}) =>
  alertItem('a-help', {
    condition: {
      kind: 'HELP_REQUESTED',
      category: 'URGENT',
      observedValue: null,
      thresholdValue: null,
      openedAt: FIXTURE_AT,
      // Preenchido desde o nascimento: não quer dizer que o pedido acabou.
      recoveredAt: FIXTURE_AT,
      recoveryReason: null,
    },
    ...over,
  })

describe('pedido de ajuda na fila de alertas', () => {
  it('tem o rótulo "Pedido de ajuda" e o ícone da mão, o mesmo do botão do app', () => {
    const detail = alertDetailFrom(helpAlert())
    expect(detail.title).toBe('Pedido de ajuda')
    expect(detail.icon).toBe('hand')
    expect(detail.tone).toBe('error')
  })

  it('não diz que a condição fechou, mesmo com recoveredAt preenchido', () => {
    const detail = alertDetailFrom(helpAlert())
    expect(detail.notes).toHaveLength(1)
    expect(detail.notes?.[0]).toMatch(/^Urgente, aberto às /)
    expect(detail.notes?.join(' ')).not.toMatch(/encerrada|voltou/i)
  })

  it('segue triável: aberto reconhece e resolve', () => {
    const detail = alertDetailFrom(helpAlert())
    expect(detail.triage?.canAcknowledge).toBe(true)
    expect(detail.triage?.canResolve).toBe(true)
  })

  it('descreve o pedido sem número inventado', () => {
    const described = describeCondition({
      kind: 'HELP_REQUESTED',
      observedValue: null,
      thresholdValue: null,
    })
    expect(described.title).toBe('Pedido de ajuda')
    expect(described.description).not.toMatch(/\d/)
  })
})
