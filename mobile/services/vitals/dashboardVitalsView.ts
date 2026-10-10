import type { MetricState, WorkerTelemetry } from '../telemetry/myTelemetry';
import { formatEta } from './formatEta';
import type { WorkerStatus } from './types';

// O que o bloco de vitais do dashboard mostra, decidido a partir da leitura do
// backend. Função pura: a tela só desenha o que sai daqui. Ausência continua
// ausência (null), para a tela escrever NO_VALUE em vez de inventar um zero, e
// a frase de estado descreve a leitura, não a saúde: juízo de saúde vem das
// condições abertas no backend.

export interface DashboardVitalsView {
  /** Batimento já formatado, ou null sem leitura. */
  heartRate: string | null;
  /** "sistólica/diastólica", ou null sem medição. */
  pressure: string | null;
  /** Rótulo sob a pressão: medição pontual leva o horário, nunca um juízo. */
  pressureLabel: string;
  /** Gasto por hora já arredondado, ou null. */
  energyRate: string | null;
  energyLabel: string;
  /** Desgaste 0-100 para a barra, ou null sem avaliação. */
  fatigueProgress: number | null;
  /** Frase sob a barra de fadiga. */
  fatigueText: string;
  /** Em que pé está a leitura. */
  status: string;
  /** Selo de origem quando a leitura não é do relógio real. */
  sourceBadge: string | null;
  /** Cor da silhueta: só condição aberta no backend tira o estado de bom. */
  workerStatus: WorkerStatus;
}

export const DEMO_DATA_LABEL = 'Dados de demonstração';

/** Marcador de valor ausente na tela. */
export const NO_VALUE = '--';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const pad2 = (n: number) => String(n).padStart(2, '0');

const dayMonth = (iso: string) => {
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
};

/** A medição é do mesmo dia (no relógio do aparelho) que o instante da leitura. */
export const isSameDay = (measuredAt: string, observedAt: string) =>
  new Date(measuredAt).toDateString() === new Date(observedAt).toDateString();

/**
 * De quando é uma medição, para completar frases: "às 14:59" se é de hoje,
 * "em 29/09 às 14:59" se é de outro dia. Pressão e oxigenação valem por dias
 * no backend, e o último batimento fica guardado sem prazo: só o horário
 * faria uma medição de anteontem parecer de hoje.
 */
export const whenLabel = (measuredAt: string, observedAt: string) =>
  isSameDay(measuredAt, observedAt)
    ? `às ${clock(measuredAt)}`
    : `em ${dayMonth(measuredAt)} às ${clock(measuredAt)}`;

/**
 * O valor de uma métrica contínua enquanto ele vale como leitura. O backend
 * guarda o último batimento, esforço, desgaste, tempo até a fadiga e gasto por
 * hora depois de expirar, e é a qualidade UNAVAILABLE que avisa: mostrar esse
 * valor seria passar o estado de ontem por estado de agora.
 */
export const liveValue = <T,>(state: Pick<MetricState<T>, 'value' | 'quality'>): T | null =>
  state.quality === 'UNAVAILABLE' ? null : state.value;

// O tempo que o backend manda vai até o limiar do alerta de desgaste, não até
// o desgaste total.
const FATIGUE_PREFIX = 'Tempo até o alerta de fadiga:';
const FATIGUE_ALERT_REACHED = 'Alerta de fadiga atingido';
const WEAR_ALERT_KIND = 'WEAR_HIGH';

const UNAVAILABLE_STATUS = 'Leitura indisponível no momento';
const LOADING_STATUS = 'Carregando leitura';
// Não usa "indisponível": no glossário a palavra nomeia o estado de quem tem
// suporte e não recebeu leitura, que pede outro conselho.
const UNSUPPORTED_STATUS = 'Monitoramento só com iPhone e Apple Watch';

const EMPTY: Omit<DashboardVitalsView, 'status'> = {
  heartRate: null,
  pressure: null,
  pressureLabel: 'Sem medição',
  energyRate: null,
  energyLabel: 'Kcal/hora',
  fatigueProgress: null,
  fatigueText: `${FATIGUE_PREFIX} sem estimativa`,
  sourceBadge: null,
  workerStatus: 'unknown',
};

// Urgência e alerta de saúde valem mesmo com a leitura velha: esconder uma
// condição aberta seria pior que mostrá-la atrasada. "Bom" exige leitura atual,
// porque sem ela ninguém confirma que o funcionário está bem. Condição só de
// aparelho não entra: relógio descarregado não é funcionário em risco.
export function workerStatusOf(telemetry: WorkerTelemetry | null): WorkerStatus {
  if (telemetry === null || telemetry.origin === null) return 'unknown';
  const categories = new Set(telemetry.conditions.map((c) => c.category));
  if (categories.has('URGENT')) return 'low';
  if (categories.has('HEALTH')) return 'alert';
  return telemetry.metrics.heartRate.quality === 'CURRENT' ? 'good' : 'unknown';
}

export function dashboardVitalsView(
  telemetry: WorkerTelemetry | null,
  options: { failed?: boolean; loading?: boolean; unsupported?: boolean } = {},
): DashboardVitalsView {
  if (telemetry === null || telemetry.origin === null) {
    // Aparelho sem o módulo do relógio (Android, iPhone sem a build do piloto)
    // nunca vai ler: a frase diz onde o monitoramento funciona e vale acima de
    // carregando e de falha, porque esses dois prometem uma leitura que não
    // vem. Leitura que já existe no servidor (outro aparelho do mesmo
    // funcionário, demonstração) continua aparecendo pelo caminho de baixo.
    // Antes da primeira resposta a tela ainda não sabe se há leitura: dizer
    // "sem leitura" seria afirmar uma ausência que ninguém conferiu.
    const status = options.unsupported
      ? UNSUPPORTED_STATUS
      : options.failed
        ? UNAVAILABLE_STATUS
        : options.loading && telemetry === null
          ? LOADING_STATUS
          : 'Sem leitura do aparelho';
    return { ...EMPTY, status };
  }

  const { heartRate, bloodPressure, energyRatePerHour } = telemetry.metrics;
  const { observedAt } = telemetry;
  const heartRateValue = liveValue(heartRate);
  const energyRate = liveValue(energyRatePerHour);
  const wear = liveValue(telemetry.metrics.wear);
  const fatigueEta = liveValue(telemetry.metrics.fatigueEtaMin);

  // A qualidade já chega decidida pelo backend contra o instante da leitura;
  // a tela não recalcula frescor com o próprio relógio.
  // Com falha ou ainda carregando, o que chega aqui é só a condição aberta
  // que sobrou da última leitura: a frase fala da leitura que falta.
  const status = options.failed
    ? UNAVAILABLE_STATUS
    : heartRate.value !== null && heartRate.quality === 'CURRENT'
      ? 'Monitorando agora'
      : heartRate.value !== null && heartRate.measuredAt
        ? `Última leitura ${whenLabel(heartRate.measuredAt, observedAt)}`
        : options.loading
          ? LOADING_STATUS
          : 'Sem leitura recente';

  // Com o alerta aberto o limiar já ficou para trás: o tempo até ele seria um
  // zero que não diz isso. Avaliação presente sem estimativa quer dizer que o
  // ritmo recente não leva ao limiar dentro do horizonte da fórmula.
  const fatigueText = telemetry.conditions.some((c) => c.kind === WEAR_ALERT_KIND)
    ? FATIGUE_ALERT_REACHED
    : fatigueEta !== null
      ? `${FATIGUE_PREFIX} ${formatEta(fatigueEta)}`
      : wear !== null
        ? 'Sem previsão de fadiga no ritmo atual'
        : EMPTY.fatigueText;

  return {
    heartRate: heartRateValue === null ? null : String(Math.round(heartRateValue)),
    pressure:
      bloodPressure.value === null
        ? null
        : `${bloodPressure.value.systolic}/${bloodPressure.value.diastolic}`,
    pressureLabel:
      bloodPressure.value !== null && bloodPressure.measuredAt
        ? isSameDay(bloodPressure.measuredAt, observedAt)
          ? `Às ${clock(bloodPressure.measuredAt)}`
          : `Em ${dayMonth(bloodPressure.measuredAt)}`
        : EMPTY.pressureLabel,
    energyRate: energyRate === null ? null : String(Math.round(energyRate)),
    energyLabel:
      energyRatePerHour.value === null && energyRatePerHour.calculating
        ? 'Calculando'
        : EMPTY.energyLabel,
    fatigueProgress:
      wear === null ? null : Math.round(Math.min(100, Math.max(0, wear))),
    fatigueText,
    status,
    sourceBadge: telemetry.origin === 'DEMO' ? DEMO_DATA_LABEL : null,
    workerStatus: workerStatusOf(telemetry),
  };
}
