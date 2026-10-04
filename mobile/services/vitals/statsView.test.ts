import {
  expired,
  FIXTURE_OTHER_DAY,
  metric,
  neverReported,
  noMetric,
  reporting,
} from '../telemetry/myTelemetryFixtures';
import { emptySeries, series, SERIES_DAY_START } from '../telemetry/mySeriesFixtures';
import { caloriesChartView, statsDonutsView } from './statsView';

const OLD = '2026-10-01T14:20:00.000Z';
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayMonth = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const HOUR = 60 * 60 * 1000;
/** Instante a tantos milissegundos do início da série de teste. */
const at = (offsetMs: number) => new Date(Date.parse(SERIES_DAY_START) + offsetMs).toISOString();
const hourLabel = (offsetHours: number) =>
  `${String(new Date(Date.parse(SERIES_DAY_START) + offsetHours * HOUR).getHours()).padStart(2, '0')}h`;
// O balde de dia é o dia civil de Brasília, e a série de teste começa no
// primeiro dia de outubro: o rótulo esperado é literal, igual em qualquer fuso.
const dayLabel = (offsetDays: number) => `${String(1 + offsetDays).padStart(2, '0')}/10`;

describe('statsDonutsView', () => {
  it('quem nunca reportou não vira zero: valor ausente e anel vazio em todos', () => {
    for (const telemetry of [null, neverReported()]) {
      const view = statsDonutsView(telemetry);
      expect(view.effort).toEqual({ value: '--', label: 'Esforço feito', progress: 0 });
      expect(view.oxygen).toEqual({ value: '--', label: 'Oxigenação', progress: 0 });
      expect(view.steps).toEqual({ value: '--', label: 'Sem medição', progress: 0 });
      expect(view.energy).toEqual({ value: '--', label: 'por hora', progress: 0 });
      expect(view.oxygenNote).toBeNull();
      expect(view.battery).toBe('Bateria do aparelho: sem leitura');
    }
  });

  it('esforço é o percentual da leitura, com vírgula decimal, e enche o anel na mesma medida', () => {
    const view = statsDonutsView(reporting({ effort: metric(62.5) }));
    expect(view.effort).toEqual({ value: '62,5%', label: 'Esforço feito', progress: 62.5 });
  });

  it('esforço fora da faixa não estoura o anel', () => {
    expect(statsDonutsView(reporting({ effort: metric(140) })).effort.progress).toBe(100);
    expect(statsDonutsView(reporting({ effort: metric(-3) })).effort.progress).toBe(0);
  });

  it('oxigenação é medição pontual: a nota traz o horário da última', () => {
    const view = statsDonutsView(
      reporting({ oxygenSaturation: metric(97, { measuredAt: OLD, quality: 'STALE' }) }),
    );
    expect(view.oxygen).toEqual({ value: '97,0%', label: 'Oxigenação', progress: 97 });
    expect(view.oxygenNote).toBe(`Oxigenação: última medição às ${clock(OLD)}`);
  });

  it('passos e distância saem da leitura; sem meta, o anel só diz que há leitura', () => {
    const view = statsDonutsView(reporting({ steps: metric(4200), distance: metric(3104) }));
    expect(view.steps).toEqual({ value: '4200', label: '3,10km', progress: 100 });
  });

  it('passos sem distância não inventam quilômetros', () => {
    const view = statsDonutsView(reporting({ steps: metric(4200) }));
    expect(view.steps).toEqual({ value: '4200', label: 'passos', progress: 100 });
  });

  it('gasto por hora arredonda; ainda calculando diz isso em vez de número', () => {
    expect(statsDonutsView(reporting()).energy).toEqual({
      value: '310 kcal',
      label: 'por hora',
      progress: 100,
    });
    const calculating = statsDonutsView(
      reporting({ energyRatePerHour: { ...noMetric<number>('kcal/h'), calculating: true } }),
    );
    expect(calculating.energy).toEqual({ value: '--', label: 'Calculando', progress: 0 });
  });

  // O backend guarda o último valor das métricas contínuas depois de expirar.
  it('esforço e gasto por hora expirados contam como ausência', () => {
    const view = statsDonutsView(
      reporting({
        effort: expired(74, FIXTURE_OTHER_DAY),
        energyRatePerHour: { ...expired(310, FIXTURE_OTHER_DAY), calculating: false },
      }),
    );
    expect(view.effort).toEqual({ value: '--', label: 'Esforço feito', progress: 0 });
    expect(view.energy).toEqual({ value: '--', label: 'por hora', progress: 0 });
  });

  it('passos e distância são acumulados do dia: valem enquanto forem de hoje', () => {
    const hoje = statsDonutsView(
      reporting({ steps: expired(4200, OLD), distance: expired(3104, OLD) }),
    );
    expect(hoje.steps).toEqual({ value: '4200', label: '3,10km', progress: 100 });

    const outroDia = statsDonutsView(
      reporting({
        steps: expired(4200, FIXTURE_OTHER_DAY),
        distance: expired(3104, FIXTURE_OTHER_DAY),
      }),
    );
    expect(outroDia.steps).toEqual({ value: '--', label: 'Sem medição', progress: 0 });
  });

  it('medição de outro dia leva a data, na oxigenação e na bateria', () => {
    const view = statsDonutsView(
      reporting({
        oxygenSaturation: metric(97, { measuredAt: FIXTURE_OTHER_DAY, quality: 'STALE' }),
        battery: expired(40, FIXTURE_OTHER_DAY),
      }),
    );
    const quando = `em ${dayMonth(FIXTURE_OTHER_DAY)} às ${clock(FIXTURE_OTHER_DAY)}`;
    expect(view.oxygenNote).toBe(`Oxigenação: última medição ${quando}`);
    expect(view.battery).toBe(`Bateria do aparelho: 40% ${quando}`);
  });

  it('bateria do aparelho: atual mostra o percentual, velha diz de quando é', () => {
    expect(statsDonutsView(reporting({ battery: metric(81.6) })).battery).toBe(
      'Bateria do aparelho: 82%',
    );
    expect(
      statsDonutsView(reporting({ battery: metric(40, { quality: 'STALE', measuredAt: OLD }) }))
        .battery,
    ).toBe(`Bateria do aparelho: 40% às ${clock(OLD)}`);
  });
});

describe('caloriesChartView', () => {
  it('carregando, falha e ausência dizem o que houve, sem desenhar ponto', () => {
    expect(caloriesChartView(null, { loading: true })).toMatchObject({
      points: [],
      emptyText: 'Carregando série',
    });
    expect(caloriesChartView(null, { failed: true })).toMatchObject({
      points: [],
      emptyText: 'Série indisponível no momento',
    });
    expect(caloriesChartView(emptySeries('week', 7))).toMatchObject({
      points: [],
      emptyText: 'Sem medição no período',
    });
  });

  it('série com origem mas sem nenhuma medição no período também não desenha', () => {
    expect(caloriesChartView(series('day', [null, null, null]))).toMatchObject({
      points: [],
      emptyText: 'Sem medição no período',
    });
  });

  it('hoje: poucas horas viram um ponto por hora, em kcal por hora', () => {
    const view = caloriesChartView(series('day', [120, 80.4, 200]));
    expect(view.unit).toBe('kcal/h');
    expect(view.emptyText).toBeNull();
    expect(view.points).toEqual([
      { time: hourLabel(0), kcal: 120 },
      { time: hourLabel(1), kcal: 80 },
      { time: hourLabel(2), kcal: 200 },
    ]);
  });

  it('o gráfico só comporta quatro pontos: o dia inteiro agrupa de 6 em 6 horas, pela média', () => {
    const kcal = Array.from({ length: 24 }, (_, h) => (h < 6 ? 60 : h < 12 ? 120 : h < 18 ? 180 : 90));
    const view = caloriesChartView(series('day', kcal));
    expect(view.points).toEqual([
      { time: hourLabel(0), kcal: 60 },
      { time: hourLabel(6), kcal: 120 },
      { time: hourLabel(12), kcal: 180 },
      { time: hourLabel(18), kcal: 90 },
    ]);
  });

  it('semana: sete dias viram quatro pontos, em kcal por dia, e o último grupo menor não despenca', () => {
    const view = caloriesChartView(series('week', [1000, 2000, 1500, 1500, 1800, 2200, 1900]));
    expect(view.unit).toBe('kcal/dia');
    expect(view.points).toEqual([
      { time: dayLabel(0), kcal: 1500 },
      { time: dayLabel(2), kcal: 1500 },
      { time: dayLabel(4), kcal: 2000 },
      { time: dayLabel(6), kcal: 1900 },
    ]);
  });

  // O backend corta o dia na meia-noite de Brasília. Em Manaus esse instante
  // ainda é 23h da véspera, e a data local rotularia o balde com o dia errado.
  it('o rótulo do dia é o de Brasília mesmo com o aparelho em outro fuso', () => {
    // O jest isola process.env, então trocar o fuso do processo não funciona
    // aqui. O relógio local de um aparelho em UTC-4 é simulado nos métodos de
    // data que dependem do fuso.
    const emManaus = (campo: 'getUTCDate' | 'getUTCMonth') =>
      function (this: Date) {
        return new Date(this.getTime() - 4 * HOUR)[campo]();
      };
    const dia = jest.spyOn(Date.prototype, 'getDate').mockImplementation(emManaus('getUTCDate'));
    const mes = jest.spyOn(Date.prototype, 'getMonth').mockImplementation(emManaus('getUTCMonth'));
    try {
      expect(new Date(SERIES_DAY_START).getDate()).toBe(30);
      const view = caloriesChartView(series('week', [1000, 1200]));
      expect(view.points.map((p) => p.time)).toEqual(['01/10', '02/10']);
    } finally {
      dia.mockRestore();
      mes.mockRestore();
    }
  });

  it('mês: trinta dias viram quatro pontos', () => {
    const view = caloriesChartView(series('month', Array.from({ length: 30 }, () => 1700)));
    expect(view.points.map((p) => p.time)).toEqual([
      dayLabel(0),
      dayLabel(8),
      dayLabel(16),
      dayLabel(24),
    ]);
    expect(view.points.every((p) => p.kcal === 1700)).toBe(true);
  });

  it('balde sem medição não entra na média; grupo inteiro sem medição vira buraco, não zero', () => {
    const view = caloriesChartView(
      series('week', [1000, null, null, null, 1800, 2200, 1900]),
    );
    expect(view.points).toEqual([
      { time: dayLabel(0), kcal: 1000 },
      { time: dayLabel(2), kcal: null },
      { time: dayLabel(4), kcal: 2000 },
      { time: dayLabel(6), kcal: 1900 },
    ]);
  });

  // O kcal do balde é a soma do que foi medido nele. A hora em curso tem só
  // alguns minutos: comparada como hora cheia, desenharia uma queda falsa.
  it('hoje: a hora em curso vira taxa pelo tempo decorrido, não despenca', () => {
    const view = caloriesChartView(
      series('day', [300, 300, 300, 75], 'REAL', at(3 * HOUR + 15 * 60_000)),
    );
    expect(view.points.map((p) => p.kcal)).toEqual([300, 300, 300, 300]);
  });

  it('hoje: hora coberta só em parte também vira taxa', () => {
    const s = series('day', [300, 100]);
    s.points[1]!.coverage = 1 / 3;
    expect(caloriesChartView(s).points.map((p) => p.kcal)).toEqual([300, 300]);
  });

  it('hoje: poucos minutos de leitura não bastam para afirmar uma taxa', () => {
    const s = series('day', [300, 20]);
    s.points[1]!.coverage = 2 / 60;
    expect(caloriesChartView(s).points.map((p) => p.kcal)).toEqual([300, null]);
  });

  it('semana: o dia em curso é um ponto próprio, rotulado "hoje", fora da média', () => {
    const view = caloriesChartView(
      series('week', [1000, 2000, 1500, 1500, 1800, 2200, 300], 'REAL', at(6 * 24 * HOUR + 9 * HOUR)),
    );
    expect(view.points).toEqual([
      { time: dayLabel(0), kcal: 1500 },
      { time: dayLabel(2), kcal: 1500 },
      { time: dayLabel(4), kcal: 2000 },
      { time: 'hoje', kcal: 300 },
    ]);
  });

  it('mês: com o dia em curso, os dias completos cabem em três pontos mais o de hoje', () => {
    const kcal = [...Array.from({ length: 29 }, () => 1700), 250];
    const view = caloriesChartView(
      series('month', kcal, 'REAL', at(29 * 24 * HOUR + 9 * HOUR)),
    );
    expect(view.points).toEqual([
      { time: dayLabel(0), kcal: 1700 },
      { time: dayLabel(10), kcal: 1700 },
      { time: dayLabel(20), kcal: 1700 },
      { time: 'hoje', kcal: 250 },
    ]);
  });

  it('origem de demonstração é declarada; a real não leva selo', () => {
    expect(caloriesChartView(series('day', [120], 'DEMO')).sourceBadge).toBe(
      'Dados de demonstração',
    );
    expect(caloriesChartView(series('day', [120])).sourceBadge).toBeNull();
  });
});
