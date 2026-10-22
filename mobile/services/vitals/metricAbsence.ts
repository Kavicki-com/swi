import type { BandChoice } from '../telemetry/bluetooth/bluetoothBandChoice';
import type {
  HealthConnectFailureReason,
  HealthConnectState,
} from '../telemetry/healthConnect/healthConnectReader';
import type { MetricAbsence } from '../telemetry/myTelemetry';
import type { ListenerSnapshot } from '../telemetry/readinessReport';
import { sinceLabel, whenLabel } from './whenLabel';

// O que um cartão de métrica diz quando não tem valor. Três estados,
// exclusivos entre si e com "tem valor":
//
// - Aguardando e Não envia vêm do backend (`ausencia` por métrica), para o
//   app e o painel dizerem a mesma coisa.
// - Falhou é do app, só no Android, pelo estado local: a última rodada do
//   Health Connect deu erro, ou a escuta da pulseira caiu. Ele sobrepõe os
//   outros dois nas métricas daquele caminho enquanto durar, com a hora e o
//   motivo, porque o Android informa o motivo.
//
// No iPhone o iOS esconde o motivo (ADR-0004): com a sessão espelhada ativa a
// métrica está a caminho; sem ela, "Indisponível", sem dizer por quê.
//
// "Sem medição" não existe mais: escondia as três situações.

/** As métricas que têm ausência. Energia é a taxa por hora, a das telas. */
export type AbsenceMetric = 'heartRate' | 'steps' | 'energy' | 'oxygenSaturation' | 'bloodPressure';

export interface HealthConnectFailure {
  path: 'healthConnect';
  reason: HealthConnectFailureReason;
  /** Início da rodada que falhou, ISO. */
  at: string;
}

export interface BluetoothFailure {
  path: 'bluetooth';
  /** Procurando (fora do alcance ou desligada) ou Bluetooth do celular desligado. */
  reason: 'searching' | 'bluetoothOff';
  /** Desde quando, ISO; null quando a ponte não sabe. */
  since: string | null;
  /** A pulseira escolhida, que o "Religar a escuta" liga de novo. */
  deviceId: string;
}

export type AbsenceContext =
  | {
      platform: 'android';
      healthConnect: HealthConnectFailure | null;
      bluetooth: BluetoothFailure | null;
      /** A escuta está conectada: o batimento está a caminho por ela. */
      bluetoothConnected: boolean;
      /** Relógio do aparelho, para dizer se a falha é de hoje. */
      now: number;
    }
  | {
      platform: 'ios';
      mirroredSession: boolean;
    };

// Contínuas são lidas; avulsas são medidas (glossário, "Aguardando").
const SPOT: ReadonlySet<AbsenceMetric> = new Set(['oxygenSaturation', 'bloodPressure']);

const NAME: Record<AbsenceMetric, string> = {
  heartRate: 'batimento',
  steps: 'passos',
  energy: 'energia',
  oxygenSaturation: 'oxigenação',
  bloodPressure: 'pressão',
};

const awaitingLabel = (metric: AbsenceMetric) =>
  SPOT.has(metric) ? 'Aguardando medição' : 'Aguardando leitura';

const UNAVAILABLE_LABEL = 'Indisponível';

type PathFailure = HealthConnectFailure | BluetoothFailure;

/**
 * A falha que derruba a métrica, se houver. O Health Connect traz todas; o
 * Bluetooth só o batimento. O batimento tem os dois caminhos: com a escuta
 * conectada ele não falhou, e com os dois fora do ar vale a escuta, que é o
 * ao vivo.
 */
function failureOf(metric: AbsenceMetric, ctx: AbsenceContext | null): PathFailure | null {
  if (ctx === null || ctx.platform !== 'android') return null;
  if (metric !== 'heartRate') return ctx.healthConnect;
  if (ctx.bluetooth !== null) return ctx.bluetooth;
  if (ctx.bluetoothConnected) return null;
  return ctx.healthConnect;
}

function failureTitle(failure: PathFailure, now: number): string {
  if (failure.path === 'healthConnect') return `Sincronização falhou ${whenLabel(failure.at, now)}`;
  return failure.since === null
    ? 'Pulseira desconectada'
    : `Pulseira desconectada desde ${sinceLabel(failure.since, now)}`;
}

const HEALTH_CONNECT_REASON: Record<HealthConnectFailureReason, string> = {
  permission_denied: 'Permissão de leitura do Health Connect negada.',
  unavailable: 'Health Connect não instalado neste celular.',
  update_required: 'Health Connect desatualizado.',
  other: 'Erro ao ler o Health Connect.',
};

const BLUETOOTH_REASON: Record<BluetoothFailure['reason'], string> = {
  searching: 'Pulseira fora do alcance ou desligada.',
  bluetoothOff: 'Bluetooth do celular desligado.',
};

/** O título da falha que derruba a métrica ("Sincronização falhou às 14:10"), ou null. */
export function failureLabelOf(metric: AbsenceMetric, ctx: AbsenceContext | null): string | null {
  const failure = failureOf(metric, ctx);
  return failure === null || ctx?.platform !== 'android' ? null : failureTitle(failure, ctx.now);
}

/**
 * O rótulo do cartão de uma métrica SEM valor, ou null quando não há nada a
 * afirmar (a tela fica com o rótulo de sempre: "BPM", "mmHg"). Sem contexto
 * também é null: Android sem o gate, ou iPhone sem leitura ainda.
 */
export function absenceLabelOf(
  metric: AbsenceMetric,
  ausencia: MetricAbsence | null | undefined,
  ctx: AbsenceContext | null,
): string | null {
  if (ctx === null) return null;
  if (ctx.platform === 'ios') return ctx.mirroredSession ? awaitingLabel(metric) : UNAVAILABLE_LABEL;
  const failed = failureLabelOf(metric, ctx);
  if (failed !== null) return failed;
  if (ausencia === 'NOT_SENT') return `Esta pulseira não envia ${NAME[metric]}`;
  if (ausencia === 'AWAITING') return awaitingLabel(metric);
  return null;
}

export interface FailureNotice {
  path: PathFailure['path'];
  title: string;
  /** O motivo, afirmado: o Android o informa. */
  reason: string;
  /** Sincronizar agora (Health Connect) ou religar a escuta (Bluetooth). */
  action: 'sync' | 'relisten';
  /** A pulseira a religar; null no Health Connect. */
  deviceId: string | null;
}

/**
 * Um aviso por caminho que derrubou alguma das métricas SEM valor da tela,
 * a escuta primeiro (o batimento ao vivo). Caminho falhando sem métrica
 * ausente não tem aviso: os números na tela ainda valem.
 */
export function failureNoticesOf(
  absent: readonly AbsenceMetric[],
  ctx: AbsenceContext | null,
): FailureNotice[] {
  if (ctx === null || ctx.platform !== 'android') return [];
  const failures = new Set(absent.map((metric) => failureOf(metric, ctx)));
  return [ctx.bluetooth, ctx.healthConnect]
    .filter((failure): failure is PathFailure => failure !== null && failures.has(failure))
    .map((failure) => ({
      path: failure.path,
      title: failureTitle(failure, ctx.now),
      reason:
        failure.path === 'healthConnect'
          ? HEALTH_CONNECT_REASON[failure.reason]
          : BLUETOOTH_REASON[failure.reason],
      action: failure.path === 'healthConnect' ? 'sync' : 'relisten',
      deviceId: failure.path === 'bluetooth' ? failure.deviceId : null,
    }));
}

export interface AndroidAbsenceSources {
  healthConnect: HealthConnectState | null;
  /** A pulseira escolhida; null ou indefinida sem escolha (ou sem o gate). */
  band: BandChoice | null | undefined;
  /** O estado da escuta pela ponte; null sem o gate do Bluetooth. */
  listener: ListenerSnapshot | null;
  now: number;
}

/**
 * O contexto do Android a partir do estado local. A última rodada do Health
 * Connect que não leu deixa motivo e hora (a seguinte que lê apaga). A escuta
 * procurando ou com o Bluetooth desligado é a pulseira desconectada; parada
 * não é falha, é o ciclo de vida dela.
 */
export function androidAbsenceContext({
  healthConnect,
  band,
  listener,
  now,
}: AndroidAbsenceSources): AbsenceContext {
  const reason = healthConnect?.lastFailureReason ?? null;
  const at = healthConnect?.lastFailureAt ?? null;
  const state = band != null && listener !== null ? listener.state : null;
  return {
    platform: 'android',
    healthConnect: reason !== null && at !== null ? { path: 'healthConnect', reason, at } : null,
    bluetooth:
      band != null && (state === 'searching' || state === 'bluetoothOff')
        ? {
            path: 'bluetooth',
            reason: state,
            since: listener?.since == null ? null : new Date(listener.since).toISOString(),
            deviceId: band.deviceId,
          }
        : null,
    bluetoothConnected: state === 'connected',
    now,
  };
}
