import { useCallback, useEffect, useRef, useState } from 'react'
import { evacuationsApi, type EvacuationProgressDto } from '@/services/api/evacuations'
import {
  subscribeEvacuationEvents,
  type EvacuationAckEvent,
} from '@/services/evacuations/evacuationsSocket'
import { connectionStatus } from '@/services/realtime/connectionStatus'

export interface UseEvacuationResult {
  // null = sem evacuação ativa (ou ainda carregando o snapshot inicial).
  evacuation: EvacuationProgressDto | null
  error: string | null
  start: () => Promise<void>
  end: () => Promise<void>
}

// Ciclo de evacuação pro admin: snapshot REST + eventos WS (started/ack/ended).
// O ack chega como delta e é aplicado em cima do dto corrente.
export function useEvacuation(): UseEvacuationResult {
  const [evacuation, setEvacuation] = useState<EvacuationProgressDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  // O end() precisa do id corrente sem re-assinar callbacks a cada update.
  const evacRef = useRef(evacuation)
  evacRef.current = evacuation
  // Conta cada mudança vinda do socket ou de iniciar/encerrar. A releitura da
  // volta da conexão só vale se nada mudou enquanto a resposta vinha.
  const revision = useRef(0)

  useEffect(() => {
    let cancelled = false
    evacuationsApi.active().then((res) => {
      if (!cancelled && res.data) setEvacuation(res.data)
    })
    const unsubscribe = subscribeEvacuationEvents({
      onStarted: (dto) => {
        revision.current += 1
        setEvacuation(dto)
      },
      onAck: (ev: EvacuationAckEvent) => {
        revision.current += 1
        setEvacuation((cur) => {
          // Corrida rara: ack de outra evacuação (ex.: encerrou e reabriu) — ignora.
          if (!cur || cur.id !== ev.evacuationId) return cur
          return {
            ...cur,
            acked: ev.acked,
            total: ev.total,
            workers: cur.workers.map((w) =>
              w.id === ev.workerId
                ? { ...w, acked: true, ackAt: w.ackAt ?? new Date().toISOString() }
                : w,
            ),
          }
        })
      },
      onEnded: (ev) => {
        revision.current += 1
        setEvacuation((cur) => (cur && cur.id === ev.id ? null : cur))
      },
    })
    // Na volta da conexão, a resposta do servidor vale inteira: "nenhuma
    // ativa" limpa a tela, porque a evacuação pode ter acabado durante a
    // queda. Falha nessa releitura mantém o que está na tela.
    const stopReconnect = connectionStatus.onReconnect(() => {
      const asked = revision.current
      evacuationsApi.active().then((res) => {
        if (!cancelled && !res.error && revision.current === asked) setEvacuation(res.data)
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
      stopReconnect()
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    const res = await evacuationsApi.start()
    if (res.data) {
      revision.current += 1
      setEvacuation(res.data)
    } else setError(res.error?.message ?? 'Não foi possível iniciar a evacuação')
  }, [])

  const end = useCallback(async () => {
    const cur = evacRef.current
    if (!cur) return
    setError(null)
    const res = await evacuationsApi.end(cur.id)
    if (!res.error) {
      revision.current += 1
      setEvacuation(null)
    } else setError(res.error.message)
  }, [])

  return { evacuation, error, start, end }
}
