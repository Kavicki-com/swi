import type {
  BluetoothListenerState,
  HealthConnectAvailability,
  HealthConnectFailureReason,
  Prisma,
} from '@prisma/client'
import type { ReadinessReportDto } from './dto/readiness-report.dto'

// Relato de prontidão do celular Android: como ele vira colunas do aparelho e
// como volta ao painel. Funções puras, sem banco, para a derivação ser provada
// por tabela e reaproveitada por quem precisar do caminho ativo.

/** O relato como o painel o lê: a mesma forma que o app mandou. */
export interface ReadinessReport {
  healthConnect: {
    availability: HealthConnectAvailability | null
    readGranted: boolean | null
    backgroundGranted: boolean | null
    manufacturerPackage: string | null
    lastSyncAt: Date | null
    lastFailure: { reason: HealthConnectFailureReason; at: Date } | null
  }
  bluetooth: {
    bandChosen: boolean | null
    listenerState: BluetoothListenerState | null
    listenerStateSince: Date | null
    lastReadingAt: Date | null
  }
}

/** As colunas do relato no aparelho, para o select de quem o lê. */
export const READINESS_SELECT = {
  readinessReportedAt: true,
  healthConnectAvailability: true,
  healthConnectReadGranted: true,
  healthConnectBackgroundGranted: true,
  healthConnectPackage: true,
  healthConnectLastSyncAt: true,
  healthConnectFailureReason: true,
  healthConnectFailureAt: true,
  bluetoothBandChosen: true,
  bluetoothListenerState: true,
  bluetoothListenerStateSince: true,
  bluetoothLastReadingAt: true,
} as const satisfies Prisma.TelemetryDeviceSelect

export type ReadinessColumns = Prisma.TelemetryDeviceGetPayload<{ select: typeof READINESS_SELECT }>

const dateOrNull = (iso: string | null | undefined): Date | null => (iso == null ? null : new Date(iso))

/**
 * O relato inteiro em colunas, com o instante em que chegou. Ausente vira nulo
 * de propósito: o relato novo substitui o anterior, e um fato que o app deixou
 * de mandar não pode sobreviver do relato velho.
 */
export function readinessColumnsOf(report: ReadinessReportDto, reportedAt: Date): ReadinessColumns {
  const { healthConnect: hc, bluetooth: bt } = report
  return {
    readinessReportedAt: reportedAt,
    healthConnectAvailability: hc.availability ?? null,
    healthConnectReadGranted: hc.readGranted ?? null,
    healthConnectBackgroundGranted: hc.backgroundGranted ?? null,
    healthConnectPackage: hc.manufacturerPackage ?? null,
    healthConnectLastSyncAt: dateOrNull(hc.lastSyncAt),
    healthConnectFailureReason: hc.lastFailure?.reason ?? null,
    healthConnectFailureAt: dateOrNull(hc.lastFailure?.at),
    bluetoothBandChosen: bt.bandChosen ?? null,
    bluetoothListenerState: bt.listenerState ?? null,
    bluetoothListenerStateSince: dateOrNull(bt.listenerStateSince),
    bluetoothLastReadingAt: dateOrNull(bt.lastReadingAt),
  }
}

/** Por onde a leitura chega ao celular Android (glossário, Caminho). */
export type ActivePath = 'HEALTH_CONNECT' | 'BLUETOOTH'

/**
 * Os caminhos ativos do último relato, Health Connect primeiro. O Health
 * Connect está ativo com a leitura permitida e alguma sincronização feita; o
 * Bluetooth, com pulseira escolhida e a escuta não encerrada. Bluetooth
 * desligado conta como ativo: a escuta segue ligada e o caminho só está
 * falhando. Fato não informado nunca ativa caminho, e sem relato não há
 * caminho nenhum.
 */
export function activePathsOf(report: ReadinessReport | null): ActivePath[] {
  if (report === null) return []
  const { healthConnect: hc, bluetooth: bt } = report
  const paths: ActivePath[] = []
  if (hc.readGranted === true && hc.lastSyncAt !== null) paths.push('HEALTH_CONNECT')
  if (bt.bandChosen === true && bt.listenerState !== null && bt.listenerState !== 'ENDED') paths.push('BLUETOOTH')
  return paths
}

/** Os passos da lista de prontidão, na ordem em que o app os mostra. */
export type ReadinessStepId =
  | 'PAIR'
  | 'HEALTH_CONNECT_INSTALL'
  | 'HEALTH_CONNECT_READ'
  | 'HEALTH_CONNECT_BACKGROUND'
  | 'MANUFACTURER_APP'
  | 'BLUETOOTH_BAND'
  | 'BIRTH_DATE'

/**
 * Um passo da lista. `pendente` nulo é "não informado pelo app": o backend
 * não afirma pendência que o celular não relatou.
 */
export interface ReadinessStep {
  id: ReadinessStepId
  obrigatorio: boolean
  pendente: boolean | null
}

const unlessUnknown = <T>(fact: T | null | undefined, pending: (known: T) => boolean): boolean | null =>
  fact == null ? null : pending(fact)

/**
 * A lista de prontidão do celular Android, a mesma que o app deriva, a partir
 * do último relato e da data de nascimento do perfil. Parear sai cumprido
 * porque só há lista com aparelho pareado; a data de nascimento é do cadastro,
 * então o backend sempre sabe. Os outros passos vêm do relato e, sem ele, saem
 * todos como não informados.
 */
export function readinessStepsOf(report: ReadinessReport | null, hasBirthDate: boolean): ReadinessStep[] {
  const hc = report?.healthConnect
  const bt = report?.bluetooth
  const reported = report !== null
  return [
    { id: 'PAIR', obrigatorio: true, pendente: false },
    {
      id: 'HEALTH_CONNECT_INSTALL',
      obrigatorio: true,
      pendente: unlessUnknown(hc?.availability, (availability) => availability !== 'AVAILABLE'),
    },
    { id: 'HEALTH_CONNECT_READ', obrigatorio: true, pendente: unlessUnknown(hc?.readGranted, (granted) => !granted) },
    {
      id: 'HEALTH_CONNECT_BACKGROUND',
      obrigatorio: true,
      pendente: unlessUnknown(hc?.backgroundGranted, (granted) => !granted),
    },
    // Pacote nulo num relato é fato, não lacuna: a detecção rodou e não achou.
    { id: 'MANUFACTURER_APP', obrigatorio: false, pendente: reported ? hc?.manufacturerPackage == null : null },
    { id: 'BLUETOOTH_BAND', obrigatorio: false, pendente: unlessUnknown(bt?.bandChosen, (chosen) => !chosen) },
    { id: 'BIRTH_DATE', obrigatorio: true, pendente: !hasBirthDate },
  ]
}

/** O último relato do aparelho, ou nulo se o app ainda não relatou. */
export function readinessReportOf(columns: ReadinessColumns): ReadinessReport | null {
  if (columns.readinessReportedAt === null) return null
  const failureReason = columns.healthConnectFailureReason
  const failureAt = columns.healthConnectFailureAt
  return {
    healthConnect: {
      availability: columns.healthConnectAvailability,
      readGranted: columns.healthConnectReadGranted,
      backgroundGranted: columns.healthConnectBackgroundGranted,
      manufacturerPackage: columns.healthConnectPackage,
      lastSyncAt: columns.healthConnectLastSyncAt,
      lastFailure: failureReason === null || failureAt === null ? null : { reason: failureReason, at: failureAt },
    },
    bluetooth: {
      bandChosen: columns.bluetoothBandChosen,
      listenerState: columns.bluetoothListenerState,
      listenerStateSince: columns.bluetoothListenerStateSince,
      lastReadingAt: columns.bluetoothLastReadingAt,
    },
  }
}
