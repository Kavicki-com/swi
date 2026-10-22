import type { ActiveCondition, MetricState, WorkerTelemetry } from '../telemetry/myTelemetry';
import { formatEta } from './formatEta';
import {
  absenceLabelOf,
  failureLabelOf,
  type AbsenceContext,
  type AbsenceMetric,
} from './metricAbsence';
import type { WorkerStatus } from './types';
import { clock, dayMonth, isSameDay, whenLabel } from './whenLabel';

// O que o bloco de vitais do dashboard mostra, decidido a partir da leitura do
// backend. Função pura: a tela só desenha o que sai daqui. Ausência continua
// ausência (null), para a tela escrever NO_VALUE em vez de inventar um zero, e
// a frase de estado descreve a leitura, não a saúde: juízo de saúde é a cor do
// avatar, pelo batimento válido e pelas condições abertas no backend.

export interface DashboardVitalsView {
  /** Batimento já formatado, ou null sem leitura. */
  heartRate: string | null;
  /** "BPM", ou a ausência dele (Aguardando, Não envia, Falhou, Indisponível). */
  heartRateLabel: string;
  /** "sistólica/diastólica", ou null sem medição. */
  pressure: string | null;
  /**
   * Rótulo sob a pressão: medição pontual leva o horário, nunca um juízo;
   * sem medição, a ausência dela.
   */
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
  /** Selo das roscas de esforço e desgaste enquanto a régua ainda aprende. */
  calibrationTag: string | null;
  /** Cor da silhueta: neutra sem batimento válido; com ele, as condições vigentes decidem. */
  workerStatus: WorkerStatus;
  /** As métricas desta visão sem valor na tela, para o aviso de falha. */
  absent: AbsenceMetric[];
}

export const DEMO_DATA_LABEL = 'Dados de demonstração';

/** Marcador de valor ausente na tela. */
export const NO_VALUE = '--';

export { isSameDay, whenLabel };

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

// Cortes: menos de 1 min (ou relógio do aparelho atrás do servidor) é "agora
// há pouco"; até 59 min, minutos inteiros; até 23 h, horas inteiras. De 24 h
// em diante "há 30 h" obrigaria a fazer conta: vai a data e a hora.
// Exportada para a última sincronização em Configurações, Monitoramento
// (lastSyncCopy, telemetryCopy.ts): as duas telas dizem o tempo do mesmo
// jeito, e os cortes moram só aqui.
export function syncedAgo(syncedAt: string, observedAt: string | number): string {
  const elapsed = new Date(observedAt).getTime() - Date.parse(syncedAt);
  if (elapsed < MIN_MS) return 'agora há pouco';
  if (elapsed < HOUR_MS) return `há ${Math.floor(elapsed / MIN_MS)} min`;
  if (elapsed < DAY_MS) return `há ${Math.floor(elapsed / HOUR_MS)} h`;
  return `em ${dayMonth(syncedAt)} às ${clock(syncedAt)}`;
}

/**
 * Faixa da pulseira lida pelo Health Connect: o celular Android só envia o que
 * a pulseira já sincronizou com ele, e quem olha precisa saber que o dado é de
 * antes. null sem sincronização (iPhone, cujo relógio envia ao vivo).
 * `observedAt` é o relógio do aparelho (useNow), para o "há N min" andar com a
 * tela aberta.
 */
export function syncBannerOf(
  telemetry: WorkerTelemetry | null,
  observedAt: string | number,
): string | null {
  const sync = telemetry?.sync;
  if (!sync) return null;
  // "Dados até às 14:10" não cabe na frase: o horário vai sem o "às" do whenLabel.
  const until = isSameDay(sync.measuredUntil, observedAt)
    ? clock(sync.measuredUntil)
    : `${dayMonth(sync.measuredUntil)} às ${clock(sync.measuredUntil)}`;
  return `Dados até ${until} · sincronizado ${syncedAgo(sync.syncedAt, observedAt)}`;
}

/**
 * Sufixo de quando vale uma avaliação da pulseira (" às 14:10"). Com o
 * Health Connect o esforço e o desgaste saem da fórmula esparsa e valem para o
 * instante medido, não para agora; no iPhone o valor é de agora e o sufixo é
 * vazio. Avaliação sem horário próprio vale até onde há dado.
 */
export function measuredSuffix(
  telemetry: Pick<WorkerTelemetry, 'sync' | 'observedAt'>,
  measuredAt: string | null,
): string {
  const { sync } = telemetry;
  if (!sync) return '';
  return ` ${whenLabel(measuredAt ?? sync.measuredUntil, telemetry.observedAt)}`;
}

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
const UNSUPPORTED_STATUS = 'Este aparelho não faz o monitoramento';

// Os rótulos de sempre, para quando não há o que afirmar sobre a ausência
// (Android sem caminho ativo: quem explica é a lista de prontidão).
const HEART_RATE_LABEL = 'BPM';
const PRESSURE_LABEL = 'mmHg';
const ENERGY_LABEL = 'Kcal/hora';

const EMPTY: Omit<DashboardVitalsView, 'status'> = {
  heartRate: null,
  heartRateLabel: HEART_RATE_LABEL,
  pressure: null,
  pressureLabel: PRESSURE_LABEL,
  energyRate: null,
  energyLabel: ENERGY_LABEL,
  fatigueProgress: null,
  fatigueText: `${FATIGUE_PREFIX} sem estimativa`,
  sourceBadge: null,
  calibrationTag: null,
  workerStatus: 'unknown',
  absent: ['heartRate', 'bloodPressure', 'energy'],
};

/**
 * O contexto que vale para esta leitura. No iPhone, sem leitura ainda
 * (carregando, falha de rede) não há o que afirmar: "Indisponível" diria que
 * o relógio não mandou nada, e ninguém conferiu. No Android a falha é local e
 * vale mesmo sem leitura.
 */
export const absenceContextFor = (
  telemetry: WorkerTelemetry | null,
  ctx: AbsenceContext | null | undefined,
): AbsenceContext | null => (ctx == null || (ctx.platform === 'ios' && telemetry === null) ? null : ctx);

/** Rótulos das três colunas sem valor, e quais estão sem valor. */
function absenceLabels(
  telemetry: WorkerTelemetry | null,
  values: { heartRate: number | null; pressure: unknown; energyRate: number | null },
  absence: AbsenceContext | null | undefined,
): Pick<DashboardVitalsView, 'heartRateLabel' | 'pressureLabel' | 'energyLabel' | 'absent'> {
  const ctx = absenceContextFor(telemetry, absence);
  const m = telemetry?.metrics;
  const energyRate = m?.energyRatePerHour;
  const absent: AbsenceMetric[] = [];
  if (values.heartRate === null) absent.push('heartRate');
  if (values.pressure === null) absent.push('bloodPressure');
  if (values.energyRate === null) absent.push('energy');
  return {
    heartRateLabel:
      values.heartRate === null
        ? (absenceLabelOf('heartRate', m?.heartRate.ausencia, ctx) ?? HEART_RATE_LABEL)
        : HEART_RATE_LABEL,
    // A pressão com valor e horário leva o horário; quem chama troca este.
    pressureLabel:
      values.pressure === null
        ? (absenceLabelOf('bloodPressure', m?.bloodPressure.ausencia, ctx) ?? PRESSURE_LABEL)
        : PRESSURE_LABEL,
    // Calculando é um aguardando mais preciso (há energia, falta janela):
    // fica entre a falha, que o sobrepõe, e a ausência do backend.
    energyLabel:
      values.energyRate !== null
        ? ENERGY_LABEL
        : energyRate?.calculating
          ? (failureLabelOf('energy', ctx) ?? 'Calculando')
          : (absenceLabelOf('energy', energyRate?.ausencia, ctx) ?? ENERGY_LABEL),
    absent,
  };
}

// Textos e regra do selo iguais aos do painel (calibrationView.ts e
// sourceBadgeOf em swi-admin). A diferença é só de lugar: o atraso da pulseira
// já tem a faixa própria aqui, então não disputa o selo com a calibração.
const calibratingLabel = (day: number) => `Calibrando, dia ${day} de 30`;
const recalibratingLabel = (day: number) =>
  `Recalibrando: novo aparelho, dia ${day} de 30`;

/**
 * Esforço e desgaste calculados com repouso provisório, antes do primeiro dia
 * de uso fechar. O número existe e vale, mas ainda vai se ajustar.
 */
const PROVISIONAL_BASELINE_LABEL = 'Estimativa provisória';

/**
 * Demonstração não leva selo de régua: nem é medida. Com calibração, o selo é
 * o da fase ("dia N de 30", nenhum depois de calibrado), que substitui o
 * provisório; sem ela, fica o provisório, que só faz sentido com desgaste.
 */
function calibrationTagOf(telemetry: WorkerTelemetry): string | null {
  if (telemetry.origin === 'DEMO') return null;
  const { calibration } = telemetry;
  if (calibration) {
    if (calibration.day === null) return null;
    return calibration.recalibrating
      ? recalibratingLabel(calibration.day)
      : calibratingLabel(calibration.day);
  }
  if (telemetry.baseline === 'PROVISIONAL' && telemetry.metrics.wear.value !== null)
    return PROVISIONAL_BASELINE_LABEL;
  return null;
}

// Estado do funcionário, a mesma tabela do backend e do painel. Só existe com
// batimento válido: sem ele a cor afirmaria o agora com dado velho, e o avatar
// fica neutro. A condição aberta continua na leitura; o que ela perde é a cor.
// Condição só de aparelho não entra: relógio descarregado não é funcionário em
// risco. As idades contam do instante da leitura, não do relógio do aparelho.

/**
 * O Health Connect chega em lote: 60 min cobrem o ciclo de 30 min do app do
 * fabricante e a rodada de 15 min do segundo plano. Apple Watch e Bluetooth
 * são ao vivo e só valem atuais.
 */
const HEALTH_CONNECT_VALID_HEART_RATE_MS = HOUR_MS;

const ageMs = (measuredAt: string, observedAt: string) =>
  Math.max(0, Date.parse(observedAt) - Date.parse(measuredAt));

function hasValidHeartRate(
  heartRate: Pick<MetricState<number>, 'value' | 'quality' | 'measuredAt' | 'source'>,
  observedAt: string,
): boolean {
  if (heartRate.value === null || heartRate.measuredAt === null) return false;
  if (heartRate.quality === 'CURRENT') return true;
  return (
    heartRate.source === 'HEALTH_CONNECT' &&
    ageMs(heartRate.measuredAt, observedAt) <= HEALTH_CONNECT_VALID_HEART_RATE_MS
  );
}

/**
 * Por quanto tempo a medição avulsa sustenta a cor, contado da medição. São
 * prazos só da cor: a régua de exibição (recente até 24 h, histórica até
 * 72 h) não muda. Batimento e desgaste não estão aqui: pintam junto com o
 * batimento válido, que o estado já exige.
 */
const SPOT_CONDITION_PAINTS_MS: Readonly<Record<string, number>> = {
  OXYGEN_LOW: 12 * HOUR_MS,
  OXYGEN_FATIGUE: 12 * HOUR_MS,
  BLOOD_PRESSURE_HIGH: 6 * HOUR_MS,
  BLOOD_PRESSURE_REVIEW: 6 * HOUR_MS,
  BLOOD_PRESSURE_FATIGUE: 6 * HOUR_MS,
};

function conditionPaints(condition: ActiveCondition, observedAt: string): boolean {
  const limit = SPOT_CONDITION_PAINTS_MS[condition.kind];
  if (limit === undefined) return true;
  return condition.measuredAt != null && ageMs(condition.measuredAt, observedAt) <= limit;
}

export function workerStatusOf(telemetry: WorkerTelemetry | null): WorkerStatus {
  if (telemetry === null || telemetry.origin === null) return 'unknown';
  const { observedAt } = telemetry;
  if (!hasValidHeartRate(telemetry.metrics.heartRate, observedAt)) return 'unknown';
  const painting = telemetry.conditions.filter((c) => conditionPaints(c, observedAt));
  const categories = new Set(painting.map((c) => c.category));
  if (categories.has('URGENT')) return 'low';
  if (categories.has('HEALTH')) return 'alert';
  return 'good';
}

export function dashboardVitalsView(
  telemetry: WorkerTelemetry | null,
  options: {
    failed?: boolean;
    loading?: boolean;
    unsupported?: boolean;
    /** De onde sai o rótulo de cada métrica sem valor (useAbsenceContext). */
    absence?: AbsenceContext | null;
  } = {},
): DashboardVitalsView {
  if (telemetry === null || telemetry.origin === null) {
    // Build sem o módulo do relógio e sem o Health Connect (iPhone sem a build
    // do piloto, Expo Go) nunca vai ler: a frase diz isso e vale acima de
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
    // Quem nunca reportou já tem a ausência de cada métrica: é o primeiro
    // minuto depois de parear, quando ela mais importa.
    const labels = absenceLabels(
      telemetry,
      { heartRate: null, pressure: null, energyRate: null },
      options.absence,
    );
    return { ...EMPTY, ...labels, status };
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
  // Com a pulseira (sync presente) nunca vai "agora": o backend dá CURRENT a
  // uma medição de até 45 s mesmo vinda pelo Health Connect, que só chega em
  // lote, e o "agora" prometeria um monitoramento contínuo que não existe. A
  // frase é a da última leitura, com o horário em que foi medida.
  const status = options.failed
    ? UNAVAILABLE_STATUS
    : heartRate.value !== null && heartRate.quality === 'CURRENT' && !telemetry.sync
      ? 'Monitorando agora'
      : heartRate.value !== null && heartRate.measuredAt
        ? `Última leitura ${whenLabel(heartRate.measuredAt, observedAt)}`
        : options.loading
          ? LOADING_STATUS
          : 'Sem leitura recente';

  // Com o alerta aberto o limiar já ficou para trás: o tempo até ele seria um
  // zero que não diz isso. Avaliação presente sem estimativa quer dizer que o
  // ritmo recente não leva ao limiar dentro do horizonte da fórmula.
  // Com a pulseira cada frase diz de quando é a avaliação que a sustenta.
  const wearAt = measuredSuffix(telemetry, telemetry.metrics.wear.measuredAt);
  const fatigueText = telemetry.conditions.some((c) => c.kind === WEAR_ALERT_KIND)
    ? `${FATIGUE_ALERT_REACHED}${wearAt}`
    : fatigueEta !== null
      ? `${FATIGUE_PREFIX} ${formatEta(fatigueEta)}${measuredSuffix(telemetry, telemetry.metrics.fatigueEtaMin.measuredAt)}`
      : wear !== null
        ? `Sem previsão de fadiga no ritmo atual${wearAt}`
        : EMPTY.fatigueText;

  const labels = absenceLabels(
    telemetry,
    { heartRate: heartRateValue, pressure: bloodPressure.value, energyRate },
    options.absence,
  );

  return {
    heartRate: heartRateValue === null ? null : String(Math.round(heartRateValue)),
    heartRateLabel: labels.heartRateLabel,
    pressure:
      bloodPressure.value === null
        ? null
        : `${bloodPressure.value.systolic}/${bloodPressure.value.diastolic}`,
    pressureLabel:
      bloodPressure.value !== null && bloodPressure.measuredAt
        ? isSameDay(bloodPressure.measuredAt, observedAt)
          ? `Às ${clock(bloodPressure.measuredAt)}`
          : `Em ${dayMonth(bloodPressure.measuredAt)}`
        : labels.pressureLabel,
    energyRate: energyRate === null ? null : String(Math.round(energyRate)),
    energyLabel: labels.energyLabel,
    absent: labels.absent,
    fatigueProgress:
      wear === null ? null : Math.round(Math.min(100, Math.max(0, wear))),
    fatigueText,
    status,
    sourceBadge: telemetry.origin === 'DEMO' ? DEMO_DATA_LABEL : null,
    calibrationTag: calibrationTagOf(telemetry),
    workerStatus: workerStatusOf(telemetry),
  };
}
