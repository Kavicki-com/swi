import {
  condition,
  expired,
  FIXTURE_OTHER_DAY,
  metric,
  neverReported,
  noMetric,
  reporting,
} from '../telemetry/myTelemetryFixtures';
import type { WorkerTelemetry } from '../telemetry/myTelemetry';
import { dashboardVitalsView, syncBannerOf, workerStatusOf } from './dashboardVitalsView';

const OLD = '2026-10-01T14:20:00.000Z';
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayMonth = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

describe('dashboardVitalsView', () => {
  it('leitura atual: batimento, kcal por hora e frase de monitoramento', () => {
    const view = dashboardVitalsView(reporting());
    expect(view.heartRate).toBe('112');
    expect(view.energyRate).toBe('310');
    expect(view.energyLabel).toBe('Kcal/hora');
    expect(view.status).toBe('Monitorando agora');
    expect(view.sourceBadge).toBeNull();
  });

  it('leitura desatualizada mantém o valor e diz o horário da última', () => {
    const view = dashboardVitalsView(
      reporting({ heartRate: metric(98, { quality: 'STALE', measuredAt: OLD }) }),
    );
    expect(view.heartRate).toBe('98');
    expect(view.status).toBe(`Última leitura às ${clock(OLD)}`);
  });

  it('quem nunca reportou não vira zero: tudo é ausência declarada', () => {
    const view = dashboardVitalsView(neverReported());
    expect(view.heartRate).toBeNull();
    expect(view.pressure).toBeNull();
    expect(view.pressureLabel).toBe('Sem medição');
    expect(view.energyRate).toBeNull();
    expect(view.fatigueProgress).toBeNull();
    expect(view.fatigueText).toBe('Tempo até o alerta de fadiga: sem estimativa');
    expect(view.status).toBe('Sem leitura do aparelho');
  });

  it('falha na leitura não culpa o aparelho', () => {
    expect(dashboardVitalsView(null, { failed: true }).status).toBe(
      'Leitura indisponível no momento',
    );
    expect(dashboardVitalsView(null).status).toBe('Sem leitura do aparelho');
  });

  it('antes da primeira resposta diz que está carregando, sem afirmar ausência', () => {
    const view = dashboardVitalsView(null, { loading: true });
    expect(view.status).toBe('Carregando leitura');
    expect(view.heartRate).toBeNull();
    expect(view.workerStatus).toBe('unknown');
  });

  // Depois do prazo da última resposta sobra só a condição aberta, sem valor.
  describe('leitura vencida que só guarda a condição aberta', () => {
    const held = () => ({
      ...neverReported(),
      origin: 'REAL' as const,
      conditions: [condition('URGENT')],
    });

    it('com falha diz que a leitura está indisponível e mantém o estado', () => {
      const view = dashboardVitalsView(held(), { failed: true });
      expect(view.status).toBe('Leitura indisponível no momento');
      expect(view.workerStatus).toBe('low');
      expect(view.heartRate).toBeNull();
    });

    it('esperando a leitura nova diz que está carregando', () => {
      const view = dashboardVitalsView(held(), { loading: true });
      expect(view.status).toBe('Carregando leitura');
      expect(view.workerStatus).toBe('low');
    });
  });

  it('workerStatusOf dá o mesmo estado da visão, para quem só precisa da cor', () => {
    expect(workerStatusOf(null)).toBe('unknown');
    expect(workerStatusOf(neverReported())).toBe('unknown');
    expect(workerStatusOf(reporting())).toBe('good');
    expect(workerStatusOf({ ...reporting(), conditions: [condition('URGENT')] })).toBe('low');
  });

  it('pressão é medição pontual: mostra o horário, nunca um juízo', () => {
    const view = dashboardVitalsView(
      reporting({
        bloodPressure: metric({ systolic: 128, diastolic: 82 }, { measuredAt: OLD }),
      }),
    );
    expect(view.pressure).toBe('128/82');
    expect(view.pressureLabel).toBe(`Às ${clock(OLD)}`);
  });

  it('taxa de energia ainda calculando diz isso em vez de mostrar número', () => {
    const view = dashboardVitalsView(
      reporting({ energyRatePerHour: { ...noMetric<number>('kcal/h'), calculating: true } }),
    );
    expect(view.energyRate).toBeNull();
    expect(view.energyLabel).toBe('Calculando');
  });

  it('a barra de fadiga é o desgaste 0-100 e o texto traz o tempo até a fadiga', () => {
    const view = dashboardVitalsView(reporting());
    expect(view.fatigueProgress).toBe(38);
    expect(view.fatigueText).toBe('Tempo até o alerta de fadiga: 1h35m');
  });

  // O tempo do backend vai até o limiar do alerta de desgaste. Com o alerta
  // aberto ele é zero, e "0h00m" não diz que o limiar já foi passado.
  it('com o alerta de desgaste aberto, o texto diz que o alerta foi atingido', () => {
    const view = dashboardVitalsView({
      ...reporting({ wear: metric(85), fatigueEtaMin: metric(0) }),
      conditions: [condition('HEALTH', 'WEAR_HIGH')],
    });
    expect(view.fatigueText).toBe('Alerta de fadiga atingido');
  });

  it('outra condição de saúde aberta não fala em alerta de fadiga', () => {
    const view = dashboardVitalsView({
      ...reporting(),
      conditions: [condition('HEALTH', 'BLOOD_PRESSURE_REVIEW')],
    });
    expect(view.fatigueText).toBe('Tempo até o alerta de fadiga: 1h35m');
  });

  it('sem estimativa com desgaste presente: o ritmo atual não leva à fadiga', () => {
    const view = dashboardVitalsView(reporting({ fatigueEtaMin: noMetric('min') }));
    expect(view.fatigueText).toBe('Sem previsão de fadiga no ritmo atual');
  });

  it('batimento indisponível de quem já reportou diz que não há leitura recente', () => {
    expect(dashboardVitalsView(reporting({ heartRate: noMetric('bpm') })).status).toBe(
      'Sem leitura recente',
    );
  });

  // O backend guarda o último valor das métricas contínuas depois de expirar
  // (qualidade UNAVAILABLE). Mostrar esse valor seria passar o desgaste de
  // ontem por estado de agora.
  it('valor expirado conta como ausência, e a frase diz de quando é a última leitura', () => {
    const view = dashboardVitalsView(
      reporting({
        heartRate: expired(98, FIXTURE_OTHER_DAY),
        energyRatePerHour: { ...expired(310, FIXTURE_OTHER_DAY), calculating: false },
        wear: expired(82, FIXTURE_OTHER_DAY),
        fatigueEtaMin: expired(0, FIXTURE_OTHER_DAY),
      }),
    );
    expect(view.heartRate).toBeNull();
    expect(view.energyRate).toBeNull();
    expect(view.energyLabel).toBe('Kcal/hora');
    expect(view.fatigueProgress).toBeNull();
    expect(view.fatigueText).toBe('Tempo até o alerta de fadiga: sem estimativa');
    expect(view.status).toBe(
      `Última leitura em ${dayMonth(FIXTURE_OTHER_DAY)} às ${clock(FIXTURE_OTHER_DAY)}`,
    );
    expect(view.workerStatus).toBe('unknown');
  });

  it('batimento expirado no mesmo dia: sem valor, e a frase traz só o horário', () => {
    const view = dashboardVitalsView(reporting({ heartRate: expired(98, OLD) }));
    expect(view.heartRate).toBeNull();
    expect(view.status).toBe(`Última leitura às ${clock(OLD)}`);
  });

  it('pressão medida em outro dia mostra a data, não um horário que parece de hoje', () => {
    const view = dashboardVitalsView(
      reporting({
        bloodPressure: metric(
          { systolic: 128, diastolic: 82 },
          { measuredAt: FIXTURE_OTHER_DAY, quality: 'STALE' },
        ),
      }),
    );
    expect(view.pressure).toBe('128/82');
    expect(view.pressureLabel).toBe(`Em ${dayMonth(FIXTURE_OTHER_DAY)}`);
  });

  describe('estado de saúde vem das condições abertas, nunca de um palpite', () => {
    it('leitura atual sem condição é bom', () => {
      expect(dashboardVitalsView(reporting()).workerStatus).toBe('good');
    });

    it('condição urgente aberta é o pior estado', () => {
      const t = { ...reporting(), conditions: [condition('HEALTH'), condition('URGENT')] };
      expect(dashboardVitalsView(t).workerStatus).toBe('low');
    });

    it('condição de saúde sem urgência é alerta', () => {
      const t = { ...reporting(), conditions: [condition('HEALTH')] };
      expect(dashboardVitalsView(t).workerStatus).toBe('alert');
    });

    // Relógio descarregado não é funcionário em risco.
    it('condição só de aparelho não muda o estado de saúde', () => {
      const t = { ...reporting(), conditions: [condition('DEVICE')] };
      expect(dashboardVitalsView(t).workerStatus).toBe('good');
    });

    // Sem leitura atual ninguém confirma que o funcionário está bem.
    it('sem leitura, leitura velha ou falha é neutro', () => {
      expect(dashboardVitalsView(null).workerStatus).toBe('unknown');
      expect(dashboardVitalsView(null, { failed: true }).workerStatus).toBe('unknown');
      expect(dashboardVitalsView(neverReported()).workerStatus).toBe('unknown');
      expect(
        dashboardVitalsView(
          reporting({ heartRate: metric(98, { quality: 'STALE', measuredAt: OLD }) }),
        ).workerStatus,
      ).toBe('unknown');
    });

    it('urgência continua valendo mesmo com a leitura velha', () => {
      const t = {
        ...reporting({ heartRate: metric(98, { quality: 'STALE', measuredAt: OLD }) }),
        conditions: [condition('URGENT')],
      };
      expect(dashboardVitalsView(t).workerStatus).toBe('low');
    });
  });

  it('origem de demonstração é declarada', () => {
    expect(dashboardVitalsView(reporting({}, 'DEMO')).sourceBadge).toBe('Dados de demonstração');
  });
});

describe('aparelho sem o módulo do relógio', () => {
  // Android e iPhone sem o módulo compilado nunca vão ler: a linha de estado
  // diz onde o monitoramento funciona, em vez de "sem leitura", que soa como
  // falha. Mesma linha de Text, nenhum pixel muda de lugar.
  const SEM_RELOGIO = 'Monitoramento só com iPhone e Apple Watch';

  it('sem leitura, a linha de estado diz onde o monitoramento funciona', () => {
    expect(dashboardVitalsView(null, { unsupported: true }).status).toBe(SEM_RELOGIO);
    expect(dashboardVitalsView(neverReported(), { unsupported: true }).status).toBe(SEM_RELOGIO);
  });

  it('vale acima de carregando e de falha: este aparelho não vai ler nunca', () => {
    expect(dashboardVitalsView(null, { unsupported: true, loading: true }).status).toBe(SEM_RELOGIO);
    expect(dashboardVitalsView(null, { unsupported: true, failed: true }).status).toBe(SEM_RELOGIO);
  });

  it('leitura que já existe no servidor continua aparecendo', () => {
    const view = dashboardVitalsView(reporting(), { unsupported: true });
    expect(view.status).toBe('Monitorando agora');
    expect(view.heartRate).not.toBeNull();
  });

  it('com suporte, nada muda', () => {
    expect(dashboardVitalsView(null, { unsupported: false }).status).toBe('Sem leitura do aparelho');
  });
});

// Pulseira lida pelo Health Connect: o celular Android envia atrasado, e a
// leitura vale para o instante medido, não para agora.
const NOW = '2026-10-01T15:00:00.000Z';
const MEASURED_UNTIL = '2026-10-01T14:10:00.000Z';
const MIN = 60 * 1000;
const before = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const synced = (
  over: Partial<WorkerTelemetry['metrics']> = {},
  sync: Partial<NonNullable<WorkerTelemetry['sync']>> = {},
): WorkerTelemetry => ({
  ...reporting(over),
  sync: { measuredUntil: MEASURED_UNTIL, syncedAt: before(3 * MIN), ...sync },
});

describe('linha de estado com a pulseira', () => {
  // A qualidade do batimento é decidida no backend pela idade da medição
  // (qualityAt, régua VITAL de 45 s), e a pulseira pelo Health Connect entra
  // na mesma régua (snapshotPolicyFor: LATEST). Medição sincronizada logo
  // depois de feita chega CURRENT, mas o celular só envia em lote: dizer
  // "agora" afirmaria um monitoramento contínuo que não há.
  it('batimento ainda atual não vira "Monitorando agora": vai o horário da medição', () => {
    const telemetry = synced();
    expect(telemetry.metrics.heartRate.quality).toBe('CURRENT');
    const view = dashboardVitalsView(telemetry);
    expect(view.status).not.toMatch(/agora/);
    expect(view.status).toBe(
      `Última leitura às ${clock(telemetry.metrics.heartRate.measuredAt!)}`,
    );
    expect(view.heartRate).toBe('112');
  });

  it('sem a pulseira (iPhone) a frase de sempre', () => {
    expect(dashboardVitalsView(reporting()).status).toBe('Monitorando agora');
  });
});

describe('syncBannerOf', () => {
  it('sem sincronização (iPhone, leitura nula ou backend antigo) não há faixa', () => {
    expect(syncBannerOf(null, NOW)).toBeNull();
    expect(syncBannerOf(reporting(), NOW)).toBeNull();
    const { sync: _ausente, ...semCampo } = reporting();
    expect(syncBannerOf(semCampo, NOW)).toBeNull();
  });

  it('diz até quando há dado e há quanto tempo o celular sincronizou', () => {
    expect(syncBannerOf(synced(), NOW)).toBe(
      `Dados até ${clock(MEASURED_UNTIL)} · sincronizado há 3 min`,
    );
  });

  it('dado de outro dia leva a data, como as outras medições da tela', () => {
    expect(syncBannerOf(synced({}, { measuredUntil: FIXTURE_OTHER_DAY }), NOW)).toBe(
      `Dados até ${dayMonth(FIXTURE_OTHER_DAY)} às ${clock(FIXTURE_OTHER_DAY)} · sincronizado há 3 min`,
    );
  });

  // Menos de 1 min: "agora há pouco" (inclui relógio do aparelho atrás do
  // servidor). De 1 a 59 min: minutos inteiros. De 1 h a 23 h: horas
  // inteiras. A partir de 24 h, "há N h" esconderia o dia: vai data e hora.
  it.each([
    [0, 'agora há pouco'],
    [59 * 1000, 'agora há pouco'],
    [-30 * 1000, 'agora há pouco'],
    [MIN, 'há 1 min'],
    [59 * MIN + 59 * 1000, 'há 59 min'],
    [60 * MIN, 'há 1 h'],
    [2 * 60 * MIN + 59 * MIN, 'há 2 h'],
    [24 * 60 * MIN - 1, 'há 23 h'],
  ])('sincronizado %d ms antes: "sincronizado %s"', (ms, texto) => {
    expect(syncBannerOf(synced({}, { syncedAt: before(ms) }), NOW)).toBe(
      `Dados até ${clock(MEASURED_UNTIL)} · sincronizado ${texto}`,
    );
  });

  it('24 h ou mais desde a sincronização: data e hora em vez de "há N h"', () => {
    const syncedAt = before(24 * 60 * MIN);
    expect(syncBannerOf(synced({}, { syncedAt }), NOW)).toBe(
      `Dados até ${clock(MEASURED_UNTIL)} · sincronizado em ${dayMonth(syncedAt)} às ${clock(syncedAt)}`,
    );
  });

  // A tela passa o relógio do aparelho (useNow), em milissegundos, para o
  // "há N min" andar enquanto ela fica aberta.
  it('aceita o instante de referência em milissegundos', () => {
    expect(syncBannerOf(synced(), Date.parse(NOW))).toBe(
      `Dados até ${clock(MEASURED_UNTIL)} · sincronizado há 3 min`,
    );
  });
});

describe('desgaste da pulseira vale para o instante medido', () => {
  const WEAR_AT = '2026-10-01T14:05:00.000Z';

  it('a frase da fadiga leva o horário da avaliação', () => {
    const view = dashboardVitalsView(
      synced({ fatigueEtaMin: metric(95, { source: 'DERIVED', measuredAt: WEAR_AT }) }),
    );
    expect(view.fatigueText).toBe(`Tempo até o alerta de fadiga: 1h35m às ${clock(WEAR_AT)}`);
  });

  it('alerta atingido e ritmo sem previsão também dizem de quando são', () => {
    const wear = metric(38.4, { source: 'DERIVED', measuredAt: WEAR_AT });
    const alert = { ...synced({ wear }), conditions: [condition('HEALTH')] };
    expect(dashboardVitalsView(alert).fatigueText).toBe(
      `Alerta de fadiga atingido às ${clock(WEAR_AT)}`,
    );
    const semPrevisao = synced({ wear, fatigueEtaMin: noMetric('min') });
    expect(dashboardVitalsView(semPrevisao).fatigueText).toBe(
      `Sem previsão de fadiga no ritmo atual às ${clock(WEAR_AT)}`,
    );
  });

  it('avaliação sem horário próprio usa até quando há dado', () => {
    const view = dashboardVitalsView(
      synced({ fatigueEtaMin: metric(95, { source: 'DERIVED', measuredAt: null }) }),
    );
    expect(view.fatigueText).toBe(
      `Tempo até o alerta de fadiga: 1h35m às ${clock(MEASURED_UNTIL)}`,
    );
  });

  it('avaliação de outro dia leva a data', () => {
    const view = dashboardVitalsView(
      synced({ fatigueEtaMin: metric(95, { source: 'DERIVED', measuredAt: FIXTURE_OTHER_DAY }) }),
    );
    expect(view.fatigueText).toBe(
      `Tempo até o alerta de fadiga: 1h35m em ${dayMonth(FIXTURE_OTHER_DAY)} às ${clock(FIXTURE_OTHER_DAY)}`,
    );
  });

  it('sem avaliação não há horário a dizer', () => {
    const view = dashboardVitalsView(
      synced({ wear: noMetric('%'), fatigueEtaMin: noMetric('min') }),
    );
    expect(view.fatigueText).toBe('Tempo até o alerta de fadiga: sem estimativa');
  });

  it('sem sincronização (iPhone) a frase não muda', () => {
    expect(dashboardVitalsView(reporting()).fatigueText).toBe(
      'Tempo até o alerta de fadiga: 1h35m',
    );
  });
});
