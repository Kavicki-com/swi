// Histórico de condições de um funcionário: a primeira página ao montar, as
// seguintes pelo cursor, e a primeira de novo quando o socket avisa que uma
// condição deste funcionário abriu ou fechou. A releitura pelo aviso é
// silenciosa: falha mantém o que está na tela, e a lista volta à primeira
// página (as condições novas entram no topo).
import { useCallback, useEffect, useRef, useState } from 'react'
import { telemetryApi, type ConditionHistoryItem } from '@/services/api/telemetry'
import { subscribeTelemetryEvents } from '@/services/telemetry/telemetrySocket'

export function useConditionHistory(workerId: string) {
  const [items, setItems] = useState<ConditionHistoryItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [failed, setFailed] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Página pedida depois de sair da tela não escreve estado.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    telemetryApi.workerConditions(workerId).then(({ data }) => {
      if (cancelled) return
      setItems(data?.items ?? [])
      setNextCursor(data?.nextCursor ?? null)
      setFailed(!data)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [workerId, attempt])

  const refresh = useCallback(async () => {
    const { data } = await telemetryApi.workerConditions(workerId)
    if (!alive.current || !data) return
    setItems(data.items)
    setNextCursor(data.nextCursor)
    setFailed(false)
    setMoreFailed(false)
  }, [workerId])

  useEffect(
    () =>
      subscribeTelemetryEvents({
        onSnapshot: () => {},
        onCondition: (ev) => {
          if (ev.workerId === workerId) void refresh()
        },
      }),
    [workerId, refresh],
  )

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setMoreFailed(false)
    const { data } = await telemetryApi.workerConditions(workerId, nextCursor)
    if (!alive.current) return
    if (data) {
      setItems((prev) => [...prev, ...data.items])
      setNextCursor(data.nextCursor)
    } else {
      setMoreFailed(true)
    }
    setLoadingMore(false)
  }

  return {
    items,
    hasMore: nextCursor !== null,
    loading,
    loadingMore,
    failed,
    moreFailed,
    retry: () => setAttempt((n) => n + 1),
    loadMore,
  }
}
