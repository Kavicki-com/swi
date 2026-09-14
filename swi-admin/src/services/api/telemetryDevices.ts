// Pareamento de aparelho do piloto Apple Watch, pelo painel. Três verbos do
// backend (telemetry/v1/devices): ler o estado do aparelho de um funcionário,
// gerar o código de pareamento que o administrador lê para ele, e revogar. O
// funcionário conclui o pareamento no próprio iPhone; o painel nunca vê a
// credencial, e o código só existe em claro no retorno da criação.
import type { ServiceResponse } from '@/services/types'
import { apiFetch } from './http'

export type WorkerDevice = {
  id: string
  kind: string
  model: string | null
  /** ISO-8601: quando o pareamento foi concluído. */
  pairedAt: string
  /** ISO-8601: último evento recebido deste aparelho; null antes do primeiro. */
  lastSeenAt: string | null
}

/**
 * O que o painel sabe antes de agir. `pendingEnrollment` diz que há um código
 * válido aguardando o funcionário, mas não qual: recarregar a página não
 * recupera o código, por regra do backend.
 */
export type WorkerDeviceState = {
  device: WorkerDevice | null
  pendingEnrollment: { expiresAt: string } | null
}

export type EnrollmentCode = {
  enrollmentId: string
  /** Seis dígitos, em claro só aqui. */
  code: string
  /** ISO-8601, dez minutos depois da criação. */
  expiresAt: string
}

const failure = (e: unknown, fallback: string): { data: null; error: { message: string } } => ({
  data: null,
  error: { message: e instanceof Error ? e.message : fallback },
})

export const telemetryDevicesApi = {
  stateOf: async (workerId: string): Promise<ServiceResponse<WorkerDeviceState>> => {
    try {
      const data = await apiFetch<WorkerDeviceState>(
        `/telemetry/v1/devices/workers/${encodeURIComponent(workerId)}`,
      )
      return { data, error: null }
    } catch (e) {
      return failure(e, 'Falha ao carregar o aparelho')
    }
  },

  // Só iPhone recebe credencial no piloto: o relógio se associa ao iPhone na
  // sessão espelhada, e o backend recusa qualquer outro tipo.
  createEnrollment: async (workerId: string): Promise<ServiceResponse<EnrollmentCode>> => {
    try {
      const data = await apiFetch<EnrollmentCode>('/telemetry/v1/devices/enrollments', {
        method: 'POST',
        body: JSON.stringify({ workerId, kind: 'IPHONE' }),
      })
      return { data, error: null }
    } catch (e) {
      return failure(e, 'Falha ao gerar o código de pareamento')
    }
  },

  // 204 sem corpo. O app do funcionário descobre pelo 401 no próximo envio e
  // volta sozinho a pedir pareamento; o painel não precisa avisá-lo.
  revoke: async (deviceId: string): Promise<ServiceResponse<null>> => {
    try {
      await apiFetch<null>(`/telemetry/v1/devices/${encodeURIComponent(deviceId)}/revoke`, {
        method: 'POST',
      })
      return { data: null, error: null }
    } catch (e) {
      return failure(e, 'Falha ao revogar o aparelho')
    }
  },
}
