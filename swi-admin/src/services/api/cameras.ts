// Pontos de câmera da obra, cadastrados pelo administrador. O endereço é a
// página da câmera no sistema do cliente: o SWI não transmite vídeo, só abre
// essa página. É a fonte única do mapa, da tela de câmeras e dos KPIs.
import { apiFetch } from './http'

export type Camera = {
  id: string
  name: string
  lat: number
  lng: number
  url: string | null
}

export type CameraInput = {
  name: string
  lat: number
  lng: number
  url: string | null
}

export const camerasApi = {
  list: () => apiFetch<Camera[]>('/cameras'),

  create: (input: CameraInput) =>
    apiFetch<Camera>('/cameras', { method: 'POST', body: JSON.stringify(input) }),

  // PATCH parcial: só o que mudou. `url: null` limpa o endereço.
  update: (id: string, input: Partial<CameraInput>) =>
    apiFetch<Camera>(`/cameras/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),

  remove: (id: string) => apiFetch<null>(`/cameras/${id}`, { method: 'DELETE' }),
}

// Contagem para os KPIs. Falha vira null, que a tela mostra como "--": zero
// afirmaria que a obra não tem câmera.
export async function countCameras(): Promise<number | null> {
  try {
    return (await camerasApi.list()).length
  } catch {
    return null
  }
}
