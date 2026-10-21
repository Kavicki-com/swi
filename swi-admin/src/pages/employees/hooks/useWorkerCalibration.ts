// Estado da página "Faixas e travas": o detalhe da calibração de um
// funcionário e as escritas que o devolvem atualizado. Cada escrita responde
// a mensagem de erro (para o toast e o campo) ou nulo quando deu certo; o
// detalhe novo entra sem recarregar. O histórico tem o seu próprio estado,
// com "carregar mais" pelo cursor.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  calibrationApi,
  type CalibrationDetail,
  type CalibrationHistoryItem,
  type CalibrationMetric,
  type Cuts,
  type SafetyRule,
  type SafetyValues,
} from '@/services/api/calibration'
import type { ServiceResponse } from '@/services/types'

export type WriteResult = Promise<string | null>

export function useWorkerCalibration(workerId: string | undefined) {
  const [detail, setDetail] = useState<CalibrationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!workerId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    calibrationApi.detail(workerId).then(({ data, error: failure }) => {
      if (cancelled) return
      setDetail(data)
      setError(data ? null : (failure?.message ?? 'Falha ao carregar a calibração'))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [workerId, attempt])

  const write = useCallback(
    async (work: (id: string) => Promise<ServiceResponse<CalibrationDetail>>): WriteResult => {
      if (!workerId) return 'Funcionário não encontrado'
      const { data, error: failure } = await work(workerId)
      if (!data) return failure?.message ?? 'Não foi possível salvar'
      setDetail(data)
      return null
    },
    [workerId],
  )

  return {
    detail,
    loading,
    error,
    retry: () => setAttempt((n) => n + 1),
    setBand: (metric: CalibrationMetric, cuts: Cuts) =>
      write((id) => calibrationApi.setBand(id, metric, cuts)),
    revertBand: (metric: CalibrationMetric) => write((id) => calibrationApi.revertBand(id, metric)),
    setSafety: (rule: SafetyRule, values: SafetyValues) =>
      write((id) => calibrationApi.setSafety(id, rule, values)),
    revertSafety: (rule: SafetyRule) => write((id) => calibrationApi.revertSafety(id, rule)),
  }
}

export function useCalibrationHistory(workerId: string) {
  const [items, setItems] = useState<CalibrationHistoryItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moreError, setMoreError] = useState<string | null>(null)
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
    setError(null)
    calibrationApi.history(workerId).then(({ data, error: failure }) => {
      if (cancelled) return
      setItems(data?.items ?? [])
      setNextCursor(data?.nextCursor ?? null)
      setError(data ? null : (failure?.message ?? 'Falha ao carregar o histórico'))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [workerId, attempt])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setMoreError(null)
    const { data, error: failure } = await calibrationApi.history(workerId, nextCursor)
    if (!alive.current) return
    if (data) {
      setItems((prev) => [...prev, ...data.items])
      setNextCursor(data.nextCursor)
    } else {
      setMoreError(failure?.message ?? 'Falha ao carregar mais mudanças')
    }
    setLoadingMore(false)
  }

  return {
    items,
    hasMore: nextCursor !== null,
    loading,
    loadingMore,
    error,
    moreError,
    retry: () => setAttempt((n) => n + 1),
    loadMore,
  }
}
