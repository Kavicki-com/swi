// Estado da aba "Ao vivo": quem está transmitindo e o vídeo do funcionário
// escolhido. Um socket só, aberto enquanto a aba está aberta, serve à lista e
// à conexão com o celular.
import { useCallback, useEffect, useRef, useState } from 'react'
import { liveApi, type LiveBroadcast } from '@/services/api/live'
import { applyLiveEvent, createLiveListLog, type LiveListEvent } from '@/services/live/liveList'
import { openLiveSocket, type LiveSocket } from '@/services/live/liveSocket'
import { createLiveViewer, type LiveViewer, type LiveViewState } from '@/services/live/liveViewer'
import { connectionStatus } from '@/services/realtime/connectionStatus'

export interface LiveRoom {
  broadcasts: LiveBroadcast[]
  loading: boolean
  /** Só a primeira leitura mostra erro; releitura que falha mantém a lista. */
  error: boolean
  retryList: () => void
  view: LiveViewState
  retryWatch: () => void
}

const IDLE: LiveViewState = { status: 'idle', workerId: null, stream: null }

export function useLiveRoom(selectedWorkerId: string | null): LiveRoom {
  const [broadcasts, setBroadcasts] = useState<LiveBroadcast[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [view, setView] = useState<LiveViewState>(IDLE)
  const viewerRef = useRef<LiveViewer | null>(null)
  const loadRef = useRef<() => void>(() => {})

  useEffect(() => {
    let cancelled = false
    let loadedOnce = false
    const log = createLiveListLog()
    // Só a resposta boa fica guardada: uma falha (servidor reiniciando, por
    // exemplo) não pode deixar a aba inteira sem servidor de conexão.
    let iceServers: Promise<RTCIceServer[]> | null = null
    const fetchIceServers = () => {
      if (!iceServers) {
        iceServers = liveApi.iceServers().catch(() => {
          iceServers = null
          return []
        })
      }
      return iceServers
    }

    const record = (event: LiveListEvent) => {
      log.record(event)
      setBroadcasts((list) => applyLiveEvent(list, event))
    }

    // O viewer e o socket se usam um ao outro: o socket existe antes de o
    // viewer receber qualquer pedido, porque o viewer só fala com ele em
    // resposta a uma escolha ou a um aviso do próprio socket.
    let socket: LiveSocket | null = null
    const viewer = createLiveViewer({
      port: {
        watch: (workerId) =>
          socket ? socket.watch(workerId) : Promise.resolve({ ok: false, error: 'closed' }),
        unwatch: (sessionId) => socket?.unwatch(sessionId),
        answer: (sessionId, sdp) => socket?.answer(sessionId, sdp),
        candidate: (sessionId, candidate) => socket?.candidate(sessionId, candidate),
      },
      iceServers: fetchIceServers,
      onChange: (next) => {
        if (!cancelled) setView(next)
      },
    })
    socket = openLiveSocket({
      onStarted: (broadcast) => {
        record({ kind: 'started', broadcast })
        viewer.handleStarted(broadcast.workerId)
      },
      onStopped: (workerId) => record({ kind: 'stopped', workerId }),
      onOffer: (sessionId, sdp) => void viewer.handleOffer(sessionId, sdp),
      onCandidate: (sessionId, candidate) => void viewer.handleCandidate(sessionId, candidate),
      onEnded: (sessionId) => viewer.handleEnded(sessionId),
      // Só a volta deste socket derruba as sessões dele no servidor.
      onReconnect: () => viewer.handleReconnect(),
    })

    const load = () => {
      const asked = log.mark()
      liveApi
        .list()
        .then((snapshot) => {
          if (cancelled) return
          const next = log.resolve(snapshot, asked)
          if (next) setBroadcasts(next)
          loadedOnce = true
          setError(false)
        })
        .catch(() => {
          if (!cancelled && !loadedOnce) setError(true)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }
    loadRef.current = load
    viewerRef.current = viewer
    load()

    // Na volta de qualquer socket do painel os avisos do intervalo podem ter
    // se perdido: relê a lista. O vídeo não é tocado aqui.
    const stopReconnect = connectionStatus.onReconnect(load)

    return () => {
      cancelled = true
      stopReconnect()
      viewer.stop()
      socket?.close()
      socket = null
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (selectedWorkerId) void viewer.watch(selectedWorkerId)
    else viewer.stop()
  }, [selectedWorkerId])

  const retryList = useCallback(() => {
    setError(false)
    setLoading(true)
    loadRef.current()
  }, [])

  const retryWatch = useCallback(() => {
    void viewerRef.current?.retry()
  }, [])

  return { broadcasts, loading, error, retryList, view, retryWatch }
}
