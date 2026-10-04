import {
  condition,
  expired,
  FIXTURE_OTHER_DAY,
  metric,
  neverReported,
  noMetric,
  reporting,
} from '../telemetry/myTelemetryFixtures';
import { dashboardVitalsView, workerStatusOf } from './dashboardVitalsView';

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
