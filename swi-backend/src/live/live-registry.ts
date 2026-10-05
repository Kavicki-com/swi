import { randomUUID } from 'node:crypto'

/** Decisão do usuário: até três administradores assistindo cada transmissão. */
export const LIVE_MAX_VIEWERS = 3

export interface LiveBroadcastSummary {
  workerId: string
  name: string
  startedAt: string
}

export interface LiveSessionLink {
  sessionId: string
  viewerSocketId: string
}

export interface LiveEnded {
  workerId: string
  companyId: string
  /** Socket que transmitia; difere de quem pediu quando o funcionário para de outro socket. */
  socketId: string
  viewers: LiveSessionLink[]
}

export type LiveWatchResult =
  | { ok: true; sessionId: string; broadcasterSocketId: string; replacedSessionId: string | null }
  | { ok: false; error: 'not-live' | 'full' }

interface Broadcast {
  workerId: string
  companyId: string
  name: string
  socketId: string
  startedAt: Date
  /** sessionId → socket do painel que assiste. */
  viewers: Map<string, string>
}

/**
 * Quem está transmitindo e quem assiste, só em memória: vale para um processo
 * da API, e reiniciar derruba as transmissões (o app anuncia de novo ao
 * reconectar). Puro de propósito: não fala com socket nem com banco, só
 * responde quem deve ser avisado.
 */
export class LiveRegistry {
  private readonly byWorker = new Map<string, Broadcast>()
  private readonly workerBySession = new Map<string, string>()

  constructor(
    private readonly newId: () => string = randomUUID,
    private readonly maxViewers: number = LIVE_MAX_VIEWERS,
  ) {}

  /**
   * Uma transmissão por funcionário. Repetir pelo mesmo socket é inofensivo;
   * outro socket do mesmo funcionário (outro aparelho, ou o mesmo reconectado
   * antes de a queda chegar) substitui a antiga, e quem assistia a ela cai.
   */
  start(
    input: { workerId: string; companyId: string; name: string; socketId: string },
    now: Date,
  ): { fresh: boolean; replaced: { socketId: string; sessions: LiveSessionLink[] } | null } {
    const current = this.byWorker.get(input.workerId)
    if (current?.socketId === input.socketId) return { fresh: false, replaced: null }
    const replaced = current ? { socketId: current.socketId, sessions: this.drop(current) } : null
    this.byWorker.set(input.workerId, { ...input, startedAt: now, viewers: new Map() })
    return { fresh: true, replaced }
  }

  /**
   * Encerra a transmissão deste socket ou, com `workerId`, a do próprio
   * funcionário por outro socket dele (o app reconectado antes de o servidor
   * notar a queda do socket antigo). null se não há o que encerrar.
   */
  stop(socketId: string, workerId?: string): LiveEnded | null {
    const broadcast = this.ownedBy(socketId) ?? (workerId === undefined ? undefined : this.byWorker.get(workerId))
    if (!broadcast) return null
    const viewers = this.drop(broadcast)
    return { workerId: broadcast.workerId, companyId: broadcast.companyId, socketId: broadcast.socketId, viewers }
  }

  /**
   * Outra empresa recebe `not-live`, igual a quem pede um funcionário que não
   * transmite: a resposta não revela que a transmissão existe.
   */
  watch(input: { workerId: string; companyId: string; viewerSocketId: string }): LiveWatchResult {
    const broadcast = this.byWorker.get(input.workerId)
    if (!broadcast || broadcast.companyId !== input.companyId) return { ok: false, error: 'not-live' }
    // O mesmo painel pedindo de novo (reconexão da imagem) troca a sessão em
    // vez de ocupar outra vaga.
    let replacedSessionId: string | null = null
    for (const [sessionId, viewerSocketId] of broadcast.viewers) {
      if (viewerSocketId === input.viewerSocketId) replacedSessionId = sessionId
    }
    if (replacedSessionId !== null) this.forget(broadcast, replacedSessionId)
    else if (broadcast.viewers.size >= this.maxViewers) return { ok: false, error: 'full' }
    const sessionId = this.newId()
    broadcast.viewers.set(sessionId, input.viewerSocketId)
    this.workerBySession.set(sessionId, broadcast.workerId)
    return { ok: true, sessionId, broadcasterSocketId: broadcast.socketId, replacedSessionId }
  }

  /** O painel deixa de assistir; null se a sessão não é dele ou já acabou. */
  unwatch(sessionId: string, viewerSocketId: string): { workerId: string; broadcasterSocketId: string } | null {
    const broadcast = this.bySession(sessionId)
    if (!broadcast || broadcast.viewers.get(sessionId) !== viewerSocketId) return null
    this.forget(broadcast, sessionId)
    return { workerId: broadcast.workerId, broadcasterSocketId: broadcast.socketId }
  }

  /**
   * Para onde vai uma mensagem da sessão. Só os dois lados conversam, e cada
   * um sempre para o outro; qualquer outro socket recebe null.
   */
  route(sessionId: string, fromSocketId: string): { to: string; from: 'broadcaster' | 'viewer' } | null {
    const broadcast = this.bySession(sessionId)
    if (!broadcast) return null
    const viewerSocketId = broadcast.viewers.get(sessionId)
    if (viewerSocketId === undefined) return null
    if (fromSocketId === broadcast.socketId) return { to: viewerSocketId, from: 'broadcaster' }
    if (fromSocketId === viewerSocketId) return { to: broadcast.socketId, from: 'viewer' }
    return null
  }

  /** Socket caiu: encerra o que ele transmitia e as sessões em que assistia. */
  leave(socketId: string): { ended: LiveEnded | null; left: Array<{ sessionId: string; broadcasterSocketId: string }> } {
    const ended = this.stop(socketId)
    const left: Array<{ sessionId: string; broadcasterSocketId: string }> = []
    for (const broadcast of this.byWorker.values()) {
      for (const [sessionId, viewerSocketId] of [...broadcast.viewers]) {
        if (viewerSocketId !== socketId) continue
        this.forget(broadcast, sessionId)
        left.push({ sessionId, broadcasterSocketId: broadcast.socketId })
      }
    }
    return { ended, left }
  }

  list(companyId: string): LiveBroadcastSummary[] {
    return [...this.byWorker.values()]
      .filter((b) => b.companyId === companyId)
      .map((b) => ({ workerId: b.workerId, name: b.name, startedAt: b.startedAt.toISOString() }))
  }

  private ownedBy(socketId: string): Broadcast | undefined {
    for (const broadcast of this.byWorker.values()) if (broadcast.socketId === socketId) return broadcast
    return undefined
  }

  private bySession(sessionId: string): Broadcast | undefined {
    const workerId = this.workerBySession.get(sessionId)
    return workerId === undefined ? undefined : this.byWorker.get(workerId)
  }

  private forget(broadcast: Broadcast, sessionId: string): void {
    broadcast.viewers.delete(sessionId)
    this.workerBySession.delete(sessionId)
  }

  /** Tira a transmissão do registro e devolve as sessões que ela tinha. */
  private drop(broadcast: Broadcast): LiveSessionLink[] {
    const sessions = [...broadcast.viewers].map(([sessionId, viewerSocketId]) => ({ sessionId, viewerSocketId }))
    for (const { sessionId } of sessions) this.workerBySession.delete(sessionId)
    this.byWorker.delete(broadcast.workerId)
    return sessions
  }
}
