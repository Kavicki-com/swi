import type { MetricState, WorkerTelemetry } from '../telemetry/myTelemetry';
import type { SeriesPoint, WorkerSeries } from '../telemetry/mySeries';
import {
  DEMO_DATA_LABEL,
  isSameDay,
  liveValue,
  NO_VALUE,
  whenLabel,
} from './dashboardVitalsView';

// O que a tela de Estatísticas mostra além do bloco de vitais do dashboard:
// os quatro anéis, a bateria do aparelho e o gráfico de gasto calórico.
// Funções puras, como dashboardVitalsView: ausência continua ausência e a
// tela só desenha o que sai daqui.

export interface DonutView {
  value: string;
  label: string;
  /** 0-100 para o arco do anel. */
  progress: number;
}

export interface StatsDonutsView {
  effort: DonutView;
  oxygen: DonutView;
  steps: DonutView;
  energy: DonutView;
  /** Oxigenação é medição pontual: a nota diz de quando é, ou null sem medição. */
  oxygenNote: string | null;
  battery: string;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

/** Percentual com vírgula decimal (pt-BR): 62.5 vira "62,5%". */
const pct = (n: number) => `${n.toFixed(1).replace('.', ',')}%`;

type Reading<T> = Pick<MetricState<T>, 'value' | 'quality' | 'measuredAt'>;

const ABSENT: Reading<number> = { value: null, quality: 'UNAVAILABLE', measuredAt: null };

// Passos e gasto por hora não têm meta: o arco não mede fração nenhuma. Cheio
// diz que há leitura, vazio diz que não há, e nenhum dos dois sugere progresso.
const presence = (value: number | null) => (value === null ? 0 : 100);

// Passos e distância são acumulados do dia. O total de horas atrás continua
// sendo o de hoje, mesmo com a qualidade expirada; o de outro dia não é.
const todayValue = (state: Reading<number>, observedAt: string): number | null =>
  state.value !== null && state.measuredAt !== null && isSameDay(state.measuredAt, observedAt)
    ? state.value
    : null;

export function statsDonutsView(telemetry: WorkerTelemetry | null): StatsDonutsView {
  const reported = telemetry !== null && telemetry.origin !== null ? telemetry : null;
  const m = reported?.metrics;
  const observedAt = reported?.observedAt ?? '';

  const effort = liveValue(m?.effort ?? ABSENT);
  const energyState = m?.energyRatePerHour ?? { ...ABSENT, calculating: false };
  const energy = liveValue(energyState);
  const steps = todayValue(m?.steps ?? ABSENT, observedAt);
  const distance = todayValue(m?.distance ?? ABSENT, observedAt);
  // Oxigenação é medição pontual e o backend só a devolve enquanto vale;
  // bateria fica guardada, e por isso sempre diz de quando é se não for atual.
  const oxygen = m?.oxygenSaturation ?? ABSENT;
  const battery = m?.battery ?? ABSENT;

  const batteryText =
    battery.value === null
      ? 'sem leitura'
      : battery.quality !== 'CURRENT' && battery.measuredAt
        ? `${Math.round(battery.value)}% ${whenLabel(battery.measuredAt, observedAt)}`
        : `${Math.round(battery.value)}%`;

  return {
    effort: {
      value: effort === null ? NO_VALUE : pct(effort),
      label: 'Esforço feito',
      progress: effort === null ? 0 : clampPct(effort),
    },
    oxygen: {
      value: oxygen.value === null ? NO_VALUE : pct(oxygen.value),
      label: 'Oxigenação',
      progress: oxygen.value === null ? 0 : clampPct(oxygen.value),
    },
    steps: {
      value: steps === null ? NO_VALUE : String(Math.round(steps)),
      label:
        distance !== null
          ? `${(distance / 1000).toFixed(2).replace('.', ',')}km`
          : steps !== null
            ? 'passos'
            : 'Sem medição',
      progress: presence(steps),
    },
    energy: {
      value: energy === null ? NO_VALUE : `${Math.round(energy)} kcal`,
      label: energyState.value === null && energyState.calculating ? 'Calculando' : 'por hora',
      progress: presence(energy),
    },
    oxygenNote:
      oxygen.value !== null && oxygen.measuredAt
        ? `Oxigenação: última medição ${whenLabel(oxygen.measuredAt, observedAt)}`
        : null,
    battery: `Bateria do aparelho: ${batteryText}`,
  };
}

export interface CaloriesChartPoint {
  time: string;
  /** null é bloco sem medição: o gráfico deixa um buraco, não desenha zero. */
  kcal: number | null;
}

export interface CaloriesChartView {
  /** No máximo MAX_CHART_POINTS. */
  points: CaloriesChartPoint[];
  /** Unidade da etiqueta: taxa por hora em "hoje", total por dia em semana e mês. */
  unit: string;
  /** Frase no lugar do gráfico quando não há o que desenhar; null com gráfico. */
  emptyText: string | null;
  /** Selo de origem quando a série não vem do relógio real. */
  sourceBadge: string | null;
}

// O LineCaloriesChart do DS desenha uma etiqueta de valor e uma de horário em
// CADA ponto: na largura do celular cabem quatro. Os baldes do período são
// agrupados em até quatro blocos vizinhos, e cada bloco mostra uma média, não
// a soma: blocos de tamanhos diferentes somados desenhariam quedas falsas.
export const MAX_CHART_POINTS = 4;

/** Rótulo do ponto do dia em curso na semana e no mês. */
export const TODAY_LABEL = 'hoje';

const HOUR_MS = 60 * 60 * 1000;

// Menos que isto de leitura num bloco não sustenta uma taxa por hora: dois
// minutos de esforço extrapolados para a hora inteira seriam um número
// inventado.
const MIN_COVERED_MS = 5 * 60 * 1000;

const pad2 = (n: number) => String(n).padStart(2, '0');

// Brasília é UTC-3 fixo, sem horário de verão.
const BRASILIA_OFFSET_MS = 3 * HOUR_MS;

// A hora sai do relógio do aparelho, como os outros horários da tela. A data
// do balde de dia não: o backend corta o dia na meia-noite de Brasília, e num
// aparelho mais a oeste (Manaus, Rio Branco) esse instante ainda é a véspera.
// O rótulo é a data do dia civil de Brasília que o balde representa.
function bucketLabel(point: SeriesPoint, bucket: WorkerSeries['bucket']): string {
  if (bucket === 'hour') return `${pad2(new Date(point.start).getHours())}h`;
  const day = new Date(Date.parse(point.start) - BRASILIA_OFFSET_MS);
  return `${pad2(day.getUTCDate())}/${pad2(day.getUTCMonth() + 1)}`;
}

/** Fatia `items` em até `max` blocos vizinhos do mesmo tamanho (o último pode ser menor). */
function chunks<T>(items: readonly T[], max: number): T[][] {
  const size = Math.max(1, Math.ceil(items.length / max));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// "Hoje": o kcal do balde é a soma do que foi medido nele, e nem toda hora é
// medida inteira. A hora em curso tem só os minutos já decorridos, e o turno
// começa e termina no meio de uma hora. Cada bloco vira TAXA: kcal dividido
// pelo tempo realmente coberto por leitura, em horas.
function hourlyRatePoints(series: WorkerSeries): CaloriesChartPoint[] {
  const to = Date.parse(series.to);
  const coveredMs = (p: SeriesPoint) =>
    Math.max(0, Math.min(Date.parse(p.end), to) - Date.parse(p.start)) * p.coverage;

  return chunks(series.points, MAX_CHART_POINTS).map((group) => {
    const measured = group.filter((p) => p.activeEnergyKcal !== null);
    const kcal = measured.reduce((sum, p) => sum + (p.activeEnergyKcal ?? 0), 0);
    const covered = measured.reduce((sum, p) => sum + coveredMs(p), 0);
    return {
      time: bucketLabel(group[0]!, 'hour'),
      kcal: covered < MIN_COVERED_MS ? null : Math.round(kcal / (covered / HOUR_MS)),
    };
  });
}

// Semana e mês: o total do dia é o número que importa, e o dia em curso ainda
// está pela metade. Ele ganha um ponto próprio, rotulado "hoje", e fica fora
// da média dos dias completos, que ocupam os outros pontos.
function dailyTotalPoints(series: WorkerSeries): CaloriesChartPoint[] {
  const to = Date.parse(series.to);
  const last = series.points[series.points.length - 1];
  const inProgress = last !== undefined && Date.parse(last.end) > to ? last : null;
  const complete = inProgress ? series.points.slice(0, -1) : series.points;

  const points = chunks(complete, inProgress ? MAX_CHART_POINTS - 1 : MAX_CHART_POINTS).map(
    (group): CaloriesChartPoint => {
      const totals = group
        .map((p) => p.activeEnergyKcal)
        .filter((kcal): kcal is number => kcal !== null);
      return {
        time: bucketLabel(group[0]!, 'day'),
        kcal:
          totals.length === 0
            ? null
            : Math.round(totals.reduce((sum, kcal) => sum + kcal, 0) / totals.length),
      };
    },
  );
  if (inProgress) {
    points.push({
      time: TODAY_LABEL,
      kcal: inProgress.activeEnergyKcal === null ? null : Math.round(inProgress.activeEnergyKcal),
    });
  }
  return points;
}

export function caloriesChartView(
  series: WorkerSeries | null,
  options: { failed?: boolean; loading?: boolean } = {},
): CaloriesChartView {
  const unit = series?.bucket === 'day' ? 'kcal/dia' : 'kcal/h';
  const sourceBadge = series?.origin === 'DEMO' ? DEMO_DATA_LABEL : null;
  const empty = (emptyText: string): CaloriesChartView => ({
    points: [],
    unit,
    emptyText,
    sourceBadge,
  });

  if (series === null) {
    return empty(
      options.failed
        ? 'Série indisponível no momento'
        : options.loading
          ? 'Carregando série'
          : 'Sem medição no período',
    );
  }

  const points = series.bucket === 'hour' ? hourlyRatePoints(series) : dailyTotalPoints(series);

  if (series.origin === null || points.every((p) => p.kcal === null)) {
    return empty('Sem medição no período');
  }
  return { points, unit, emptyText: null, sourceBadge };
}
