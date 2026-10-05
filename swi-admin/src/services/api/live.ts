// Transmissão ao vivo da câmera do celular do funcionário. A lista diz quem
// está transmitindo agora na empresa do administrador; os servidores de
// conexão são os que o navegador usa para abrir a conexão direta com o
// celular (o vídeo não passa pelo servidor do SWI).
import { ApiError, apiFetch } from './http'

export type LiveBroadcast = {
  workerId: string
  name: string
  /** ISO 8601, hora em que o funcionário ligou a câmera. */
  startedAt: string
}

export type LiveIceServer = {
  urls: string | string[]
  username?: string
  credential?: string
}

const isBroadcast = (value: unknown): value is LiveBroadcast => {
  if (typeof value !== 'object' || value === null) return false
  const { workerId, name, startedAt } = value as Record<string, unknown>
  return typeof workerId === 'string' && typeof name === 'string' && typeof startedAt === 'string'
}

export const liveApi = {
  list: async (): Promise<LiveBroadcast[]> => {
    const data = await apiFetch<unknown>('/live')
    if (!Array.isArray(data)) throw new ApiError('Resposta inesperada do servidor', 0)
    return data.filter(isBroadcast)
  },

  iceServers: async (): Promise<LiveIceServer[]> => {
    const data = await apiFetch<{ iceServers?: unknown }>('/live/ice-servers')
    return Array.isArray(data?.iceServers) ? (data.iceServers as LiveIceServer[]) : []
  },
}
