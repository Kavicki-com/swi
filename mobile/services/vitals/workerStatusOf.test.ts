import type { ActiveCondition, MetricState, WorkerTelemetry } from '../telemetry/myTelemetry';
import { metric, neverReported, reporting } from '../telemetry/myTelemetryFixtures';
import { workerStatusOf } from './dashboardVitalsView';

// A tabela do estado do funcionário, a mesma do backend e do painel: sem
// batimento válido o avatar fica neutro, e com ele cada condição pinta só
// enquanto o dado que a sustenta vale. As bordas contam do instante da
// leitura (observedAt), como no backend.

const OBSERVED_AT = neverReported().observedAt;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const before = (ms: number) => new Date(Date.parse(OBSERVED_AT) - ms).toISOString();

const aberta = (
  kind: string,
  category: ActiveCondition['category'],
  measuredAt: string | null = before(30 * SECOND),
): ActiveCondition => ({
  kind,
  category,
  openedAt: before(2 * MINUTE),
  measuredAt,
  observedValue: null,
  thresholdValue: null,
});

const lendo = (heartRate: MetricState<number>, conditions: ActiveCondition[] = []): WorkerTelemetry => ({
  ...reporting({ heartRate }),
  conditions,
});

/** O que o backend manda para um batimento ao vivo da idade dada. */
const aoVivo = (ms: number, source: MetricState<number>['source'] = 'APPLE_WATCH') =>
  metric(88, { measuredAt: before(ms), quality: ms <= 45 * SECOND ? 'CURRENT' : 'STALE', source });

/** O batimento do Health Connect chega em lote e vence a qualidade em minutos. */
const pelaPulseira = (ms: number) =>
  metric(88, { measuredAt: before(ms), quality: 'UNAVAILABLE', source: 'HEALTH_CONNECT' });

describe('workerStatusOf', () => {
  it('sem leitura fica neutro', () => {
    expect(workerStatusOf(null)).toBe('unknown');
    expect(workerStatusOf(neverReported())).toBe('unknown');
  });

  it('batimento válido sem condição aberta é bom', () => {
    expect(workerStatusOf(lendo(aoVivo(5 * SECOND)))).toBe('good');
  });

  describe('sem batimento válido o avatar é neutro, com qualquer condição aberta', () => {
    it.each([
      ['urgente', aberta('HEART_RATE_HIGH', 'URGENT')],
      ['de saúde', aberta('WEAR_FATIGUE', 'HEALTH')],
      ['de pressão medida agora', aberta('BLOOD_PRESSURE_HIGH', 'URGENT', before(MINUTE))],
    ])('condição %s com o batimento de 6 h atrás', (_caso, condicao) => {
      expect(workerStatusOf(lendo(aoVivo(6 * HOUR), [condicao]))).toBe('unknown');
    });

    it('batimento sem valor não vale, mesmo com o instante', () => {
      const semValor = metric<number>(88, { value: null, measuredAt: before(5 * SECOND) });
      expect(workerStatusOf(lendo(semValor, [aberta('HEART_RATE_HIGH', 'URGENT')]))).toBe('unknown');
    });
  });

  describe('batimento válido', () => {
    it('ao vivo vale até 45 s', () => {
      expect(workerStatusOf(lendo(aoVivo(45 * SECOND)))).toBe('good');
      expect(workerStatusOf(lendo(aoVivo(46 * SECOND)))).toBe('unknown');
    });

    it('pelo Bluetooth é ao vivo: parado há 50 min não vale', () => {
      expect(workerStatusOf(lendo(aoVivo(50 * MINUTE, 'BLUETOOTH_HR')))).toBe('unknown');
    });

    it('pelo Health Connect vale até 60 min contados do instante medido', () => {
      expect(workerStatusOf(lendo(pelaPulseira(60 * MINUTE)))).toBe('good');
      expect(workerStatusOf(lendo(pelaPulseira(60 * MINUTE + SECOND)))).toBe('unknown');
    });

    it('com o batimento do Health Connect de 30 min, condição de batimento pinta', () => {
      const lido = lendo(pelaPulseira(30 * MINUTE), [aberta('HEART_RATE_HIGH', 'URGENT')]);
      expect(workerStatusOf(lido)).toBe('low');
    });
  });

  describe('com batimento válido, as condições vigentes decidem', () => {
    const valido = aoVivo(5 * SECOND);

    it('urgência é urgente', () => {
      expect(workerStatusOf(lendo(valido, [aberta('HEART_RATE_HIGH', 'URGENT')]))).toBe('low');
    });

    it('saúde é atenção', () => {
      expect(workerStatusOf(lendo(valido, [aberta('WEAR_FATIGUE', 'HEALTH')]))).toBe('alert');
    });

    it('urgência vence saúde', () => {
      const lido = lendo(valido, [aberta('WEAR_FATIGUE', 'HEALTH'), aberta('HEART_RATE_HIGH', 'URGENT')]);
      expect(workerStatusOf(lido)).toBe('low');
    });

    it('condição só de aparelho não muda o estado da pessoa', () => {
      expect(workerStatusOf(lendo(valido, [aberta('DEVICE_BATTERY_LOW', 'DEVICE')]))).toBe('good');
    });

    it('oxigenação pinta até 12 h depois da medição', () => {
      const oxigenacao = (kind: string, category: ActiveCondition['category'], ms: number) =>
        workerStatusOf(lendo(valido, [aberta(kind, category, before(ms))]));
      expect(oxigenacao('OXYGEN_LOW', 'URGENT', 12 * HOUR)).toBe('low');
      expect(oxigenacao('OXYGEN_LOW', 'URGENT', 12 * HOUR + SECOND)).toBe('good');
      expect(oxigenacao('OXYGEN_FATIGUE', 'HEALTH', 12 * HOUR)).toBe('alert');
      expect(oxigenacao('OXYGEN_FATIGUE', 'HEALTH', 12 * HOUR + SECOND)).toBe('good');
    });

    it('pressão pinta até 6 h depois da medição', () => {
      const pressao = (kind: string, category: ActiveCondition['category'], ms: number) =>
        workerStatusOf(lendo(valido, [aberta(kind, category, before(ms))]));
      expect(pressao('BLOOD_PRESSURE_HIGH', 'URGENT', 6 * HOUR)).toBe('low');
      expect(pressao('BLOOD_PRESSURE_HIGH', 'URGENT', 6 * HOUR + SECOND)).toBe('good');
      expect(pressao('BLOOD_PRESSURE_REVIEW', 'HEALTH', 6 * HOUR)).toBe('alert');
      expect(pressao('BLOOD_PRESSURE_REVIEW', 'HEALTH', 6 * HOUR + SECOND)).toBe('good');
      expect(pressao('BLOOD_PRESSURE_FATIGUE', 'HEALTH', 6 * HOUR + SECOND)).toBe('good');
    });

    it('medição avulsa sem instante legível não pinta', () => {
      expect(workerStatusOf(lendo(valido, [aberta('OXYGEN_LOW', 'URGENT', null)]))).toBe('good');
    });

    it('batimento e desgaste não têm prazo próprio: pintam com o batimento válido', () => {
      const lido = lendo(valido, [aberta('WEAR_HIGH', 'HEALTH', before(10 * HOUR))]);
      expect(workerStatusOf(lido)).toBe('alert');
    });

    it('a condição vencida não tira a cor de outra ainda vigente', () => {
      const lido = lendo(valido, [
        aberta('OXYGEN_LOW', 'URGENT', before(13 * HOUR)),
        aberta('WEAR_FATIGUE', 'HEALTH'),
      ]);
      expect(workerStatusOf(lido)).toBe('alert');
    });
  });
});
