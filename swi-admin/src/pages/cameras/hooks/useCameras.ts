// Lista de câmeras da tela /cameras e as três escritas. A lista local só muda
// depois que o servidor confirma: se a gravação falhar, nada some nem aparece
// na tela sem estar no banco.
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/services/api/http'
import { camerasApi, type Camera, type CameraInput } from '@/services/api/cameras'

const byName = (a: Camera, b: Camera) => a.name.localeCompare(b.name, 'pt-BR')

export function errorMessage(e: unknown, fallback: string): string {
  // apiFetch garante ApiError em todo caminho de erro; o fallback cobre só uma
  // falha de programação nossa, não um cenário de rede.
  return e instanceof ApiError ? e.message : fallback
}

export function useCameras() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Gatilho do "Tentar novamente": nada mais muda, então só ele refaz a busca.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    camerasApi
      .list()
      .then((data) => {
        if (cancelled) return
        setCameras([...data].sort(byName))
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(errorMessage(e, 'Erro ao carregar as câmeras'))
        setCameras([])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  const create = useCallback(async (input: CameraInput) => {
    const created = await camerasApi.create(input)
    setCameras((prev) => [...prev, created].sort(byName))
    return created
  }, [])

  const update = useCallback(async (id: string, patch: Partial<CameraInput>) => {
    const updated = await camerasApi.update(id, patch)
    setCameras((prev) => prev.map((c) => (c.id === id ? updated : c)).sort(byName))
    return updated
  }, [])

  const remove = useCallback(async (id: string) => {
    await camerasApi.remove(id)
    setCameras((prev) => prev.filter((c) => c.id !== id))
  }, [])

  return { cameras, loading, error, retry, create, update, remove }
}
