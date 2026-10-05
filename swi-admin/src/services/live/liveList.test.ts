// Lista de quem está transmitindo: chega pela API e muda com os avisos do
// socket. Na volta da conexão o painel relê pela API, e o que o socket avisou
// enquanto a resposta vinha não pode ser desfeito por ela.
import type { LiveBroadcast } from '@/services/api/live'
import { applyLiveEvent, createLiveListLog } from './liveList'

const ana: LiveBroadcast = { workerId: 'w1', name: 'Ana', startedAt: '2026-10-05T14:32:00.000Z' }
const bruno: LiveBroadcast = {
  workerId: 'w2',
  name: 'Bruno',
  startedAt: '2026-10-05T14:40:00.000Z',
}
const caio: LiveBroadcast = { workerId: 'w3', name: 'Caio', startedAt: '2026-10-05T14:45:00.000Z' }

describe('applyLiveEvent', () => {
  it('quem liga entra na lista, em ordem de nome', () => {
    expect(applyLiveEvent([caio], { kind: 'started', broadcast: ana })).toEqual([ana, caio])
  })

  it('quem liga de novo (outro aparelho) troca a entrada, sem repetir', () => {
    const religou = { ...ana, startedAt: '2026-10-05T15:00:00.000Z' }
    expect(applyLiveEvent([ana, bruno], { kind: 'started', broadcast: religou })).toEqual([
      religou,
      bruno,
    ])
  })

  it('quem para sai da lista; parar quem não está não muda nada', () => {
    expect(applyLiveEvent([ana, bruno], { kind: 'stopped', workerId: 'w1' })).toEqual([bruno])
    expect(applyLiveEvent([bruno], { kind: 'stopped', workerId: 'w9' })).toEqual([bruno])
  })

  it('ordena pelo nome em português, sem diferenciar acento', () => {
    const elis = { ...bruno, workerId: 'w4', name: 'Élis' }
    const davi = { ...bruno, workerId: 'w5', name: 'Davi' }
    expect(applyLiveEvent([elis], { kind: 'started', broadcast: davi }).map((b) => b.name)).toEqual(
      ['Davi', 'Élis'],
    )
  })
})

describe('createLiveListLog', () => {
  it('o que chegou durante a releitura é aplicado por cima da resposta', () => {
    const log = createLiveListLog()
    log.record({ kind: 'started', broadcast: ana })
    const asked = log.mark()
    // Durante a releitura: Bruno liga e Ana para.
    log.record({ kind: 'started', broadcast: bruno })
    log.record({ kind: 'stopped', workerId: 'w1' })
    // A resposta foi montada antes desses avisos.
    expect(log.resolve([ana], asked)).toEqual([bruno])
  })

  it('a resposta vale inteira quando nada chegou durante ela', () => {
    const log = createLiveListLog()
    log.record({ kind: 'started', broadcast: ana })
    const asked = log.mark()
    expect(log.resolve([bruno, caio], asked)).toEqual([bruno, caio])
  })

  it('resposta mais velha que outra já aplicada é descartada', () => {
    const log = createLiveListLog()
    const first = log.mark()
    log.record({ kind: 'started', broadcast: ana })
    const second = log.mark()
    expect(log.resolve([ana, bruno], second)).toEqual([ana, bruno])
    expect(log.resolve([], first)).toBeNull()
  })

  it('a resposta chega ordenada, como a lista que os avisos mantêm', () => {
    const log = createLiveListLog()
    expect(log.resolve([caio, ana, bruno], log.mark())).toEqual([ana, bruno, caio])
  })
})
