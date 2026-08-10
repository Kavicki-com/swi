import { formatTempC, formatHumidity, formatWind, conditionLabel, activeAlert , weatherDisplay } from './weatherFormat';
import type { WeatherSnapshot, WeatherAlert } from './types';

const snap = (over: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
  current: { tempC: 17, condition: 'rain', humidityPct: 65, windKmh: 65 },
  daily: { minC: 19, maxC: 32 },
  alerts: [],
  fetchedAt: '2026-06-23T12:00:00.000Z',
  ...over,
});
const alert = (over: Partial<WeatherAlert> = {}): WeatherAlert => ({
  id: 'a', event: 'Tempestade', description: 'desc',
  startsAt: '2026-06-23T10:00:00.000Z', endsAt: '2026-06-23T18:00:00.000Z', ...over,
});

describe('weatherFormat: formatters', () => {
  it('formata temp/umidade/vento com unidades', () => {
    expect(formatTempC(17)).toBe('17ºC');
    expect(formatTempC(17.6)).toBe('18ºC');      // arredonda
    expect(formatHumidity(65)).toBe('65%');
    expect(formatWind(65)).toBe('65km/h');
  });
  it('conditionLabel mapeia o enum pra PT-BR', () => {
    expect(conditionLabel('rain')).toBe('Chuva Intensa');
    expect(conditionLabel('clear')).toBe('Céu limpo');
  });
});

describe('weatherFormat: activeAlert', () => {
  const now = new Date('2026-06-23T12:00:00.000Z');
  it('devolve o alerta vigente', () => {
    expect(activeAlert(snap({ alerts: [alert()] }), now)?.event).toBe('Tempestade');
  });
  it('null quando não há alertas', () => {
    expect(activeAlert(snap({ alerts: [] }), now)).toBeNull();
  });
  it('ignora alerta expirado (endsAt < now)', () => {
    expect(activeAlert(snap({ alerts: [alert({ endsAt: '2026-06-23T11:00:00.000Z' })] }), now)).toBeNull();
  });
});

describe('weatherFormat: weatherDisplay', () => {
  it('formata a partir do snapshot + alerta quando presentes', () => {
    const d = weatherDisplay(snap({ alerts: [alert()] }), alert());
    expect(d).toEqual({
      tempStr: '17ºC', condStr: 'Chuva Intensa', humStr: '65%',
      windStr: '65km/h', maxStr: '32ºC', minStr: '19ºC', descStr: 'desc',
    });
  });
  it('cai pro fallback estático quando snapshot/alerta são null', () => {
    const d = weatherDisplay(null, null);
    expect(d.tempStr).toBe('17ºC');
    expect(d.condStr).toBe('Chuva Intensa');
    expect(d.humStr).toBe('65%');
    expect(d.windStr).toBe('65km/h');
    expect(d.maxStr).toBe('32ºC');
    expect(d.minStr).toBe('19ºC');
    expect(d.descStr).toContain('desabamentos');
  });
});
