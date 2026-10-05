import { alertItem } from '@/test-utils/telemetryFixtures'
import { whenLabel } from '@/lib/whenLabel'
import {
  initialUrgentAlerts,
  noticeText,
  visibleAlerts,
  withDismissed,
  withRead,
} from './urgentAlerts'

const at = (min: number) => new Date(Date.UTC(2026, 9, 5, 12, min)).toISOString()

const urgent = (id: string, min: number, name = `Pessoa ${id}`) =>
  alertItem(id, {
    createdAt: at(min),
    worker: { id: `w-${id}`, name, sector: null },
    condition: { ...alertItem(id).condition, openedAt: at(min) },
  })

const health = (id: string) =>
  alertItem(id, {
    condition: { ...alertItem(id).condition, kind: 'WEAR_HIGH', category: 'HEALTH' },
  })

describe('withRead', () => {
  it('guarda só os urgentes abertos, mais novo primeiro', () => {
    const { state } = withRead(initialUrgentAlerts(), {
      request: 1,
      items: [
        urgent('a', 1),
        health('h'),
        urgent('b', 2),
        alertItem('ack', { status: 'ACKNOWLEDGED' }),
      ],
    })
    expect(state.open.map((a) => a.id)).toEqual(['b', 'a'])
  })

  it('na primeira leitura nada conta como novo', () => {
    const { fresh, state } = withRead(initialUrgentAlerts(), {
      request: 1,
      items: [urgent('a', 1)],
    })
    expect(fresh).toEqual([])
    expect(state.loaded).toBe(true)
  })

  it('depois dela, novo é o que não estava em leitura nenhuma antes', () => {
    let { state } = withRead(initialUrgentAlerts(), { request: 1, items: [urgent('a', 1)] })
    const next = withRead(state, { request: 2, items: [urgent('b', 2), urgent('a', 1)] })
    expect(next.fresh.map((a) => a.id)).toEqual(['b'])
    state = next.state
    expect(withRead(state, { request: 3, items: [urgent('b', 2)] }).fresh).toEqual([])
  })

  it('resposta de pedido mais velho que o último aplicado é descartada', () => {
    const { state } = withRead(initialUrgentAlerts(), { request: 2, items: [urgent('novo', 2)] })
    const stale = withRead(state, { request: 1, items: [urgent('velho', 1)] })
    expect(stale.state).toBe(state)
    expect(stale.fresh).toEqual([])
  })

  it('alerta que deixou de estar aberto sai da lista', () => {
    let { state } = withRead(initialUrgentAlerts(), { request: 1, items: [urgent('a', 1)] })
    state = withRead(state, { request: 2, items: [] }).state
    expect(state.open).toEqual([])
  })
})

describe('fechar o aviso', () => {
  it('esconde os alertas que estavam nele', () => {
    let { state } = withRead(initialUrgentAlerts(), { request: 1, items: [urgent('a', 1)] })
    state = withDismissed(state)
    expect(visibleAlerts(state)).toEqual([])
  })

  it('alerta novo traz o aviso de volta, só com ele', () => {
    let { state } = withRead(initialUrgentAlerts(), { request: 1, items: [urgent('a', 1)] })
    state = withDismissed(state)
    state = withRead(state, { request: 2, items: [urgent('b', 2), urgent('a', 1)] }).state
    expect(visibleAlerts(state).map((a) => a.id)).toEqual(['b'])
  })
})

describe('noticeText', () => {
  it('um alerta: nome no título, condição e hora na mensagem', () => {
    const a = urgent('a', 1, 'João Silva')
    expect(noticeText([a], Date.parse(at(5)))).toEqual({
      title: 'Alerta urgente: João Silva',
      message: `Frequência cardíaca alta, aberto ${whenLabel(at(1), Date.parse(at(5)))}.`,
    })
  })

  it('batimento baixo usa o rótulo do monitoramento', () => {
    const a = alertItem('l', {
      worker: { id: 'w', name: 'Ana Souza', sector: null },
      condition: { ...alertItem('l').condition, kind: 'HEART_RATE_LOW', openedAt: at(1) },
    })
    expect(noticeText([a], Date.parse(at(5)))?.message).toMatch(
      /^Frequência cardíaca baixa, aberto /,
    )
  })

  it('vários: quantos no título e o mais recente na mensagem', () => {
    const list = [urgent('b', 3, 'João Silva'), urgent('a', 1, 'Ana Souza'), urgent('c', 2)]
    expect(noticeText(list, Date.parse(at(5)))).toEqual({
      title: '3 alertas urgentes',
      message: `Mais recente: João Silva, frequência cardíaca alta, aberto ${whenLabel(at(3), Date.parse(at(5)))}.`,
    })
  })

  it('sem alerta, sem aviso', () => {
    expect(noticeText([], Date.now())).toBeNull()
  })
})
