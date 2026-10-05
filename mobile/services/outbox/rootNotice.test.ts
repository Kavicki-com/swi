import { batteryLowCopy, batteryLowOf, pickRootNotice, type RootNoticeInput } from './rootNotice';
import { metric, reporting } from '../telemetry/myTelemetryFixtures';
import type { ActiveCondition, MetricState, WorkerTelemetry } from '../telemetry/myTelemetry';

const NONE_DISMISSED = { offline: false, pending: false, battery: false };
const input = (over: Partial<RootNoticeInput> = {}): RootNoticeInput => ({
  refused: false,
  offline: false,
  stalled: false,
  battery: false,
  dismissed: NONE_DISMISSED,
  ...over,
});

describe('pickRootNotice: um aviso por vez', () => {
  it('sem nada a avisar, nenhum aviso', () => {
    expect(pickRootNotice(input())).toBeNull();
  });

  it('a recusa vem antes de tudo', () => {
    expect(pickRootNotice(input({ refused: true, offline: true, stalled: true, battery: true }))).toEqual({
      kind: 'refused',
    });
  });

  it('sem conexão vem antes da bateria', () => {
    expect(pickRootNotice(input({ offline: true, battery: true }))).toEqual({
      kind: 'offline',
      pending: false,
    });
  });

  it('a bateria aparece quando não há recusa nem queda', () => {
    expect(pickRootNotice(input({ battery: true }))).toEqual({ kind: 'battery' });
  });
});

describe('pickRootNotice: sem conexão', () => {
  it('sem envio parado, o texto das informações desatualizadas', () => {
    expect(pickRootNotice(input({ offline: true }))).toEqual({ kind: 'offline', pending: false });
  });

  // Só depois de uma tentativa falhar: com sinal a ação também passa pela
  // fila, e o aviso piscaria a cada toque.
  it('com envio parado numa tentativa que falhou, o texto dos envios', () => {
    expect(pickRootNotice(input({ offline: true, stalled: true }))).toEqual({
      kind: 'offline',
      pending: true,
    });
  });

  it('fechado o aviso sem envio, a queda segue sem aviso e a bateria pode aparecer', () => {
    const dismissed = { ...NONE_DISMISSED, offline: true };
    expect(pickRootNotice(input({ offline: true, dismissed }))).toBeNull();
    expect(pickRootNotice(input({ offline: true, battery: true, dismissed }))).toEqual({ kind: 'battery' });
  });

  // A ação da jornada não marca nada na tela: este aviso é o único sinal de
  // que ela ainda não saiu.
  it('fechado o aviso sem envio, o envio que fica parado ainda avisa', () => {
    const dismissed = { ...NONE_DISMISSED, offline: true };
    expect(pickRootNotice(input({ offline: true, stalled: true, dismissed }))).toEqual({
      kind: 'offline',
      pending: true,
    });
  });

  it('fechado o aviso dos envios, nenhum dos dois volta enquanto o envio segue parado', () => {
    const dismissed = { ...NONE_DISMISSED, pending: true };
    expect(pickRootNotice(input({ offline: true, stalled: true, dismissed }))).toBeNull();
  });
});

describe('pickRootNotice: bateria fechada', () => {
  it('não aparece mais enquanto a mesma condição seguir aberta', () => {
    const dismissed = { ...NONE_DISMISSED, battery: true };
    expect(pickRootNotice(input({ battery: true, dismissed }))).toBeNull();
  });
});

const BATTERY_LOW: ActiveCondition = {
  kind: 'DEVICE_BATTERY_LOW',
  category: 'DEVICE',
  openedAt: '2026-10-05T12:00:00.000Z',
  observedValue: 15,
  thresholdValue: 15,
};

const comBateria = (conditions: ActiveCondition[], battery?: MetricState<number>): WorkerTelemetry => ({
  ...reporting(battery ? { battery } : {}),
  conditions,
});

describe('batteryLowOf', () => {
  it('sem leitura, sem aviso', () => {
    expect(batteryLowOf(null)).toBeNull();
  });

  it('sem a condição aberta, sem aviso', () => {
    expect(batteryLowOf(comBateria([]))).toBeNull();
  });

  it('condição de outro tipo não é bateria baixa', () => {
    expect(batteryLowOf(comBateria([{ ...BATTERY_LOW, kind: 'DEVICE_SIGNAL_LOST' }]))).toBeNull();
  });

  // A tela de Estatísticas mostra a leitura atual: o aviso não pode dizer
  // outro número ao mesmo tempo.
  it('usa a leitura atual da bateria', () => {
    const t = comBateria([BATTERY_LOW], metric(9.4));
    expect(batteryLowOf(t)).toEqual({ key: BATTERY_LOW.openedAt, percent: 9 });
  });

  it('sem leitura atual, usa o valor de quando a condição abriu', () => {
    const t = comBateria([BATTERY_LOW], metric(40, { quality: 'STALE' }));
    expect(batteryLowOf(t)).toEqual({ key: BATTERY_LOW.openedAt, percent: 15 });
  });

  it('sem nenhum dos dois, sem número', () => {
    const t = comBateria([{ ...BATTERY_LOW, observedValue: null }]);
    expect(batteryLowOf(t)).toEqual({ key: BATTERY_LOW.openedAt, percent: null });
  });

  it('a chave é a abertura: a condição que fecha e reabre é outra', () => {
    const t = comBateria([{ ...BATTERY_LOW, openedAt: '2026-10-05T15:00:00.000Z' }]);
    expect(batteryLowOf(t)?.key).toBe('2026-10-05T15:00:00.000Z');
  });
});

describe('batteryLowCopy: igual à notificação do servidor', () => {
  it('com número', () => {
    expect(batteryLowCopy(12)).toEqual({
      title: 'Bateria do relógio baixa',
      message: 'Bateria em 12%. Carregue o relógio para seguir monitorado.',
    });
  });

  it('sem número', () => {
    expect(batteryLowCopy(null)).toEqual({
      title: 'Bateria do relógio baixa',
      message: 'Carregue o relógio para seguir monitorado.',
    });
  });
});
