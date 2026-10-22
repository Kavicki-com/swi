import { getApiUrl } from '../auth/apiConfig';
import type { BleHeartRateState, ConnectedInterval } from '../../modules/swi-ble-heart-rate/src';
import { nativeErrorCode, type WatchControl } from '../../modules/swi-watch-control';
import type { HealthConnectFailureReason, HealthConnectState } from './healthConnect/healthConnectReader';
import type { HealthConnectAvailability } from './healthConnect/healthConnectSource';
import type { ReadinessFacts } from './readiness';

// O relato de prontidão ao backend: os fatos do lado do aparelho que só o
// app sabe, para o painel derivar a mesma lista de prontidão que o
// funcionário vê (swi-backend/src/telemetry/devices/readiness.ts). O backend
// guarda o último relato com a hora em que chegou; cada envio substitui o
// anterior. A data de nascimento não vai: o backend a lê do perfil. A
// resposta a "Qual é o app da sua pulseira?" também não: fica no aparelho,
// e o relato leva só o pacote que o Health Connect mostrou.
//
// Nulo é "o app não sabe", nunca "não". Só o celular Android relata; o
// backend recusa os outros aparelhos com 403.

export const READINESS_REPORT_PATH = '/telemetry/v1/devices/me/readiness';

export type ReportAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UPDATE_REQUIRED';
export type ReportFailureReason = 'PERMISSION_DENIED' | 'UNAVAILABLE' | 'UPDATE_REQUIRED' | 'OTHER';
export type ReportListenerState = 'CONNECTED' | 'SEARCHING' | 'BLUETOOTH_OFF' | 'ENDED';

export interface ReadinessReport {
  healthConnect: {
    availability: ReportAvailability | null;
    readGranted: boolean | null;
    backgroundGranted: boolean | null;
    manufacturerPackage: string | null;
    lastSyncAt: string | null;
    lastFailure: { reason: ReportFailureReason; at: string } | null;
  };
  bluetooth: {
    bandChosen: boolean | null;
    listenerState: ReportListenerState | null;
    listenerStateSince: string | null;
    lastReadingAt: string | null;
  };
}

/** O estado da escuta e desde quando, em ms; `since` nulo quando não se sabe. */
export interface ListenerSnapshot {
  state: BleHeartRateState;
  since: number | null;
}

export interface ReadinessReportInput {
  facts: ReadinessFacts;
  /** O estado do leitor, de onde vêm a última sincronização e a última falha. */
  healthConnect: HealthConnectState | null;
  /** Nulo sem escuta possível (gate do Bluetooth desligado, ponte ausente). */
  listener: ListenerSnapshot | null;
  /** Última notificação da pulseira, em ms; só vale com escuta. */
  lastReadingAt: number | null;
}

const AVAILABILITY: Record<HealthConnectAvailability, ReportAvailability> = {
  available: 'AVAILABLE',
  unavailable: 'UNAVAILABLE',
  update_required: 'UPDATE_REQUIRED',
};

const FAILURE: Record<HealthConnectFailureReason, ReportFailureReason> = {
  permission_denied: 'PERMISSION_DENIED',
  unavailable: 'UNAVAILABLE',
  update_required: 'UPDATE_REQUIRED',
  other: 'OTHER',
};

// O `idle` da ponte é o serviço parado. Hoje ele para com a jornada; quando a
// escuta passar a só parar ao encerrar, o mesmo `idle` é o "encerrada", sem
// mudar o contrato.
const LISTENER: Record<BleHeartRateState, ReportListenerState> = {
  connected: 'CONNECTED',
  searching: 'SEARCHING',
  bluetoothOff: 'BLUETOOTH_OFF',
  idle: 'ENDED',
};

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function readinessReportOf({
  facts,
  healthConnect,
  listener,
  lastReadingAt,
}: ReadinessReportInput): ReadinessReport {
  const reason = healthConnect?.lastFailureReason ?? null;
  const failedAt = healthConnect?.lastFailureAt ?? null;
  return {
    healthConnect: {
      availability:
        facts.healthConnectAvailability === null ? null : AVAILABILITY[facts.healthConnectAvailability],
      readGranted: facts.readGranted,
      backgroundGranted: facts.backgroundGranted,
      manufacturerPackage: facts.manufacturerPackage,
      lastSyncAt: healthConnect?.lastSyncAt ?? null,
      lastFailure: reason === null || failedAt === null ? null : { reason: FAILURE[reason], at: failedAt },
    },
    bluetooth: {
      bandChosen: facts.bandChosen,
      listenerState: listener === null ? null : LISTENER[listener.state],
      listenerStateSince: listener === null ? null : iso(listener.since),
      lastReadingAt: listener === null ? null : iso(lastReadingAt),
    },
  };
}

/**
 * Desde quando a escuta está como está, pelos trechos conectados da ponte:
 * conectada, desde o começo do trecho aberto; procurando ou sem Bluetooth,
 * desde o fim do último trecho. É o ponto de partida ao abrir o app com o
 * serviço já de pé; depois, cada mudança traz a própria hora.
 */
export function listenerSinceOf(
  state: BleHeartRateState,
  intervals: readonly ConnectedInterval[],
): number | null {
  const last = intervals.length === 0 ? null : intervals[intervals.length - 1];
  if (last === null || state === 'idle') return null;
  if (state === 'connected') return last.end === null ? last.start : null;
  return last.end;
}

export type ReadinessSendOutcome = 'sent' | 'unpaired' | 'deferred' | 'rejected';

export interface ReadinessSendDeps {
  control: WatchControl;
  apiUrl?: () => string;
}

/**
 * Um envio. Nunca rejeita. 401 apaga a credencial, como o envio da
 * telemetria (telemetryUploader.ts): o painel revogou o aparelho, e quem
 * chama relê o pareamento. Rede e 5xx adiam, e o próximo gatilho manda o
 * relato de então; 4xx é recusa, só avisada, porque reenviar o mesmo corpo
 * daria a mesma resposta.
 */
export async function sendReadinessReport(
  report: ReadinessReport,
  { control, apiUrl = getApiUrl }: ReadinessSendDeps,
): Promise<ReadinessSendOutcome> {
  let status: number;
  let body: string;
  try {
    ({ status, body } = await control.request(
      `${apiUrl()}${READINESS_REPORT_PATH}`,
      'PUT',
      JSON.stringify(report),
      { kind: 'device' },
      false,
    ));
  } catch (error) {
    const code = nativeErrorCode(error);
    return code === 'E_NO_CREDENTIAL' || code === 'E_UNSUPPORTED' ? 'unpaired' : 'deferred';
  }
  if (status >= 200 && status < 300) return 'sent';
  if (status === 401) {
    try {
      control.clearDeviceCredential();
    } catch {
      // O desfecho é o mesmo: o backend já disse que a credencial não vale.
    }
    return 'unpaired';
  }
  if (status >= 400 && status < 500 && status !== 429) {
    console.warn(`[readinessReport] relato recusado com ${status}: ${body.slice(0, 200)}`);
    return 'rejected';
  }
  return 'deferred';
}
