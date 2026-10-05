// Lista de quem está transmitindo, mantida pelos avisos do socket e relida
// pela API ao abrir a aba e na volta da conexão. Sem React: o hook da aba
// guarda a lista; aqui ficam as regras e o registro dos avisos da releitura.
import type { LiveBroadcast } from '@/services/api/live'

export type LiveListEvent =
  | { kind: 'started'; broadcast: LiveBroadcast }
  | { kind: 'stopped'; workerId: string }

const byName = (a: LiveBroadcast, b: LiveBroadcast) =>
  a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })

/** Ordem de nome: quem procura alguém na lista acha pelo nome. */
export function sortBroadcasts(list: ReadonlyArray<LiveBroadcast>): LiveBroadcast[] {
  return [...list].sort(byName)
}

export function applyLiveEvent(
  list: ReadonlyArray<LiveBroadcast>,
  event: LiveListEvent,
): LiveBroadcast[] {
  const workerId = event.kind === 'started' ? event.broadcast.workerId : event.workerId
  const others = list.filter((b) => b.workerId !== workerId)
  return event.kind === 'started' ? sortBroadcasts([...others, event.broadcast]) : others
}

/**
 * Registro dos avisos para a releitura. `mark()` antes de pedir a lista;
 * `resolve()` com a resposta aplica por cima dela os avisos que chegaram
 * depois da marca, porque a resposta foi montada antes deles. Devolve null
 * quando a resposta é mais velha que outra já aplicada.
 */
export function createLiveListLog() {
  let seq = 0
  let lastResolved = -1
  let events: Array<{ seq: number; event: LiveListEvent }> = []

  return {
    record(event: LiveListEvent): void {
      seq += 1
      events.push({ seq, event })
    },
    mark(): number {
      return seq
    },
    resolve(snapshot: ReadonlyArray<LiveBroadcast>, asked: number): LiveBroadcast[] | null {
      if (asked < lastResolved) return null
      lastResolved = asked
      events = events.filter((e) => e.seq > asked)
      return events.reduce<LiveBroadcast[]>(
        (list, e) => applyLiveEvent(list, e.event),
        sortBroadcasts(snapshot),
      )
    },
  }
}
