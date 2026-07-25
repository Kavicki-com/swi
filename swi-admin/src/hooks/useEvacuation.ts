import { useCallback, useEffect, useRef, useState } from 'react'
import { evacuationsApi, type EvacuationProgressDto } from '@/services/api/evacuations'
import {
  subscribeEvacuationEvents,
  type EvacuationAckEvent,
} from '@/services/evacuations/evacuationsSocket'

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

  useEffect(() => {
    let cancelled = false
    evacuationsApi.active().then((res) => {
      if (!cancelled && res.data) setEvacuation(res.data)
    })
    const unsubscribe = subscribeEvacuationEvents({
      onStarted: (dto) => setEvacuation(dto),
      onAck: (ev: EvacuationAckEvent) =>
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
        }),
      onEnded: (ev) => setEvacuation((cur) => (cur && cur.id === ev.id ? null : cur)),
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    const res = await evacuationsApi.start()
    if (res.data) setEvacuation(res.data)
    else setError(res.error?.message ?? 'Não foi possível iniciar a evacuação')
  }, [])

  const end = useCallback(async () => {
    const cur = evacRef.current
    if (!cur) return
    setError(null)
    const res = await evacuationsApi.end(cur.id)
    if (!res.error) setEvacuation(null)
    else setError(res.error.message)
  }, [])

  return { evacuation, error, start, end }
}
