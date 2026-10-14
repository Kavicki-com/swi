// Histórico de resgates da tela /alerts/rescues, mais as transições registrar
// chegada e encerrar. A linha local só muda depois que o servidor confirma: se
// a transição falhar, o status na tela não mente.
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/services/api/http'
import { rescuesApi, type Rescue } from '@/services/api/rescues'

export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback
}

export function useRescues() {
  const [rescues, setRescues] = useState<Rescue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    rescuesApi
      .list()
      .then((data) => {
        if (cancelled) return
        setRescues(data)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(errorMessage(e, 'Erro ao carregar os resgates'))
        setRescues([])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  const arrive = useCallback(async (id: string) => {
    const updated = await rescuesApi.arrive(id)
    setRescues((prev) => prev.map((r) => (r.id === id ? updated : r)))
  }, [])

  const end = useCallback(async (id: string) => {
    const updated = await rescuesApi.end(id)
    setRescues((prev) => prev.map((r) => (r.id === id ? updated : r)))
  }, [])

  return { rescues, loading, error, retry, arrive, end }
}
