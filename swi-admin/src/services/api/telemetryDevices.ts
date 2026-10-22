// Pareamento do celular do funcionário, pelo painel. Três verbos do backend
// (telemetry/v1/devices): ler o estado do aparelho de um funcionário, gerar o
// código de pareamento que o administrador lê para ele, e revogar. O painel
// convida sem saber qual celular a pessoa tem; é o app que declara o tipo ao
// concluir (iPhone com Apple Watch, ou Android com pulseira via Health
// Connect). O painel nunca vê a credencial, e o código só existe em claro no
// retorno da criação. No celular Android a leitura do estado traz também o
// último relato de prontidão do app, os caminhos ativos e a lista de
// prontidão, que o backend deriva do relato e da data de nascimento.
import type { ServiceResponse } from '@/services/types'
import { apiFetch } from './http'

export type WorkerDevice = {
  id: string
  /**
   * Declarado pelo app ao concluir o pareamento. O relógio nunca aparece aqui:
   * não tem credencial própria, quem a recebe é o celular. A união aberta
   * aceita um tipo que o backend venha a criar sem quebrar a leitura do estado.
   */
  kind: 'IPHONE' | 'ANDROID_PHONE' | 'EXTERNAL_CUFF' | (string & {})
  model: string | null
  /** ISO-8601: quando o pareamento foi concluído. */
  pairedAt: string
  /** ISO-8601: último evento recebido deste aparelho; null antes do primeiro. */
  lastSeenAt: string | null
  // Os quatro abaixo são do celular Android. No iPhone e no medidor de pressão
  // a lista de prontidão não se aplica e vêm nulos; opcionais para a leitura
  // não quebrar diante de um backend que ainda não os manda.
  /** O último relato de prontidão do celular; nulo sem relato. */
  relato?: ReadinessReport | null
  /** ISO-8601: quando o servidor recebeu o último relato. */
  relatadoEm?: string | null
  /** Por onde a leitura chega, derivado do último relato, Health Connect primeiro. */
  caminhosAtivos?: ActivePath[] | null
  /** A lista de prontidão, na ordem em que o app a mostra. */
  pendencias?: ReadinessStep[] | null
}

/** Por onde a leitura chega ao celular Android. */
export type ActivePath = 'HEALTH_CONNECT' | 'BLUETOOTH' | (string & {})

export type ReadinessStepId =
  | 'PAIR'
  | 'HEALTH_CONNECT_INSTALL'
  | 'HEALTH_CONNECT_READ'
  | 'HEALTH_CONNECT_BACKGROUND'
  | 'MANUFACTURER_APP'
  | 'BLUETOOTH_BAND'
  | 'BIRTH_DATE'
  | (string & {})

/** Um passo da lista. `pendente` nulo é "não informado pelo app". */
export type ReadinessStep = {
  id: ReadinessStepId
  obrigatorio: boolean
  pendente: boolean | null
}

/**
 * Os fatos que o app relatou, na forma em que mandou. Todo campo nulo é "o app
 * não sabe"; datas em ISO-8601.
 */
export type ReadinessReport = {
  healthConnect: {
    availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UPDATE_REQUIRED' | (string & {}) | null
    readGranted: boolean | null
    backgroundGranted: boolean | null
    manufacturerPackage: string | null
    lastSyncAt: string | null
    lastFailure: {
      reason: 'PERMISSION_DENIED' | 'UNAVAILABLE' | 'UPDATE_REQUIRED' | 'OTHER' | (string & {})
      at: string
    } | null
  }
  bluetooth: {
    bandChosen: boolean | null
    listenerState: 'CONNECTED' | 'SEARCHING' | 'BLUETOOTH_OFF' | 'ENDED' | (string & {}) | null
    /** ISO-8601: desde quando a escuta está no estado atual. */
    listenerStateSince: string | null
    lastReadingAt: string | null
  }
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

  // O convite não tem tipo de aparelho: só o funcionário. O app declara
  // IPHONE ou ANDROID_PHONE quando conclui o pareamento com o código.
  createEnrollment: async (workerId: string): Promise<ServiceResponse<EnrollmentCode>> => {
    try {
      const data = await apiFetch<EnrollmentCode>('/telemetry/v1/devices/enrollments', {
        method: 'POST',
        body: JSON.stringify({ workerId }),
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
