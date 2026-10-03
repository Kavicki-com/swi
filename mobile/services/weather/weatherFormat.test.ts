import {
  formatTempC, formatHumidity, formatWind, conditionLabel, activeAlert, weatherDisplay, alertLevelLabel,
} from './weatherFormat';
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
  it('entre os vigentes, prefere o de perigo mesmo que venha depois', () => {
    const alerts = [
      alert({ id: 'sol', event: 'Sol intenso', severity: 'ATENCAO' }),
      alert({ id: 'tempestade', severity: 'PERIGO' }),
    ];
    expect(activeAlert(snap({ alerts }), now)?.id).toBe('tempestade');
  });
  it('perigo expirado não passa na frente de atenção vigente', () => {
    const alerts = [
      alert({ id: 'velho', severity: 'PERIGO', endsAt: '2026-06-23T11:00:00.000Z' }),
      alert({ id: 'sol', severity: 'ATENCAO' }),
    ];
    expect(activeAlert(snap({ alerts }), now)?.id).toBe('sol');
  });
  it('empate de severidade fica na ordem recebida', () => {
    const doisPerigos = [alert({ id: 'p1', severity: 'PERIGO' }), alert({ id: 'p2', severity: 'PERIGO' })];
    expect(activeAlert(snap({ alerts: doisPerigos }), now)?.id).toBe('p1');

    // Backend antigo e mock podem não mandar severity: vale o primeiro.
    const semSeveridade = [alert({ id: 's1' }), alert({ id: 's2' })];
    expect(activeAlert(snap({ alerts: semSeveridade }), now)?.id).toBe('s1');
  });
});

describe('weatherFormat: alertLevelLabel', () => {
  it('junta o evento com o nível em palavras', () => {
    expect(alertLevelLabel(alert({ severity: 'PERIGO' }))).toBe('Tempestade: perigo');
    expect(alertLevelLabel(alert({ event: 'Sol intenso', severity: 'ATENCAO' }))).toBe('Sol intenso: atenção');
  });
  it('sem severity, mostra só o evento', () => {
    expect(alertLevelLabel(alert())).toBe('Tempestade');
  });
});

describe('weatherFormat: weatherDisplay', () => {
  it('formata a partir do snapshot + alerta quando presentes', () => {
    const d = weatherDisplay(snap({ alerts: [alert()] }), alert({ severity: 'PERIGO' }));
    expect(d).toEqual({
      tempStr: '17ºC', condStr: 'Chuva Intensa', humStr: '65%',
      windStr: '65km/h', maxStr: '32ºC', minStr: '19ºC', descStr: 'desc',
      levelStr: 'Tempestade: perigo',
    });
  });
  it('sem snapshot e sem alerta, não inventa medição nem texto', () => {
    expect(weatherDisplay(null, null)).toEqual({
      tempStr: '--', condStr: '--', humStr: '--',
      windStr: '--', maxStr: '--', minStr: '--', descStr: null, levelStr: null,
    });
  });
  it('snapshot indisponível traz valores de reserva, que não viram medição', () => {
    const d = weatherDisplay(snap({ unavailable: true }), null);
    expect(d.tempStr).toBe('--');
    expect(d.condStr).toBe('--');
    expect(d.humStr).toBe('--');
    expect(d.windStr).toBe('--');
    expect(d.maxStr).toBe('--');
    expect(d.minStr).toBe('--');
  });
  it('snapshot indisponível ainda mostra o alerta que veio junto', () => {
    const d = weatherDisplay(snap({ unavailable: true }), alert({ severity: 'ATENCAO' }));
    expect(d.tempStr).toBe('--');
    expect(d.descStr).toBe('desc');
    expect(d.levelStr).toBe('Tempestade: atenção');
  });
  it('leitura velha (stale) segue sendo medição', () => {
    expect(weatherDisplay(snap({ stale: true }), null).tempStr).toBe('17ºC');
  });
  it('snapshot sem alerta não tem descrição', () => {
    const d = weatherDisplay(snap(), null);
    expect(d.descStr).toBeNull();
    expect(d.levelStr).toBeNull();
  });
});
