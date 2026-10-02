import { io, type Socket } from 'socket.io-client'
import type { ConditionKind } from '../api/telemetry'
import { readToken } from '../api/http'

import { getApiUrl } from '../api/apiConfig'

export const SNAPSHOT_UPDATED_EVENT = 'telemetry.snapshot.updated'
export const CONDITION_CHANGED_EVENT = 'telemetry.condition.changed'

/** Leitura nova de um funcionário. Só identificadores: o valor vem pela leitura. */
export type SnapshotUpdated = {
  workerId: string
  monitoringSessionId: string
  eventId: string
  revision: string
}

/** Condição que abriu ou se recuperou. Só identificadores, como o aviso acima. */
export type ConditionChanged = {
  workerId: string
  conditionId: string
  kind: ConditionKind
  change: 'OPENED' | 'RECOVERED'
  /** ISO-8601 do relógio do servidor. */
  at: string
}

export interface TelemetryHandlers {
  onSnapshot: (ev: SnapshotUpdated) => void
  onCondition: (ev: ConditionChanged) => void
}

// Uma conexão para o painel inteiro, aberta pelo primeiro assinante e fechada
// pelo último. Cada tela que acompanha telemetria (dashboard, detalhe, mapas)
// abriria a sua; aqui todas dividem uma, e cada assinante tira os próprios
// handlers ao sair, para nunca receber aviso depois disso.
let shared: { socket: Socket; subscribers: number } | null = null

function acquire(): Socket {
  if (!shared) {
    const socket = io(getApiUrl(), {
      // O token é lido na hora de conectar: uma conexão nova depois de um
      // novo login leva a sessão nova.
      auth: { token: readToken() },
      // Polling primeiro para atravessar página intermediária de túnel, onde o
      // WS puro morre no handshake; o upgrade para WS vem quando o caminho deixa.
      transports: ['polling', 'websocket'],
    })
    shared = { socket, subscribers: 0 }
  }
  shared.subscribers += 1
  return shared.socket
}

function release(socket: Socket): void {
  if (!shared || shared.socket !== socket) return
  shared.subscribers -= 1
  if (shared.subscribers === 0) {
    shared = null
    socket.close()
  }
}

// Assina os avisos de telemetria (mesmo gateway do chat, das posições e da
// evacuação). Os avisos dizem só QUE algo mudou; quem os recebe relê pela API,
// que confere o acesso a cada leitura. Retorna cleanup; chamá-lo de novo não
// tem efeito.
export function subscribeTelemetryEvents(handlers: TelemetryHandlers): () => void {
  const socket = acquire()
  socket.on(SNAPSHOT_UPDATED_EVENT, handlers.onSnapshot)
  socket.on(CONDITION_CHANGED_EVENT, handlers.onCondition)
  let active = true
  return () => {
    if (!active) return
    active = false
    socket.off(SNAPSHOT_UPDATED_EVENT, handlers.onSnapshot)
    socket.off(CONDITION_CHANGED_EVENT, handlers.onCondition)
    release(socket)
  }
}
