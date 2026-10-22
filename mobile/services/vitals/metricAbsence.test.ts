import {
  absenceLabelOf,
  androidAbsenceContext,
  failureNoticesOf,
  type AbsenceContext,
  type AbsenceMetric,
} from './metricAbsence';

// A regra de cada rótulo de ausência, em tabela. As telas (dashboard e Meu
// desempenho) provam o mesmo pelo que mostram; aqui ficam as bordas que a
// tela não consegue fixar sem montar o mundo inteiro.

const NOW = Date.parse('2026-10-01T15:00:00.000Z');
const HOJE_14_10 = new Date('2026-10-01T14:10:00').toISOString();
const ONTEM_09_05 = new Date('2026-09-30T09:05:00').toISOString();

const android = (over: Partial<Extract<AbsenceContext, { platform: 'android' }>> = {}): AbsenceContext => ({
  platform: 'android',
  healthConnect: null,
  bluetooth: null,
  bluetoothConnected: false,
  now: NOW,
  ...over,
});

const HC_NEGADO = { path: 'healthConnect', reason: 'permission_denied', at: HOJE_14_10 } as const;
const BLE_FORA = { path: 'bluetooth', reason: 'searching', since: HOJE_14_10, deviceId: 'AA:01' } as const;

const TODAS: AbsenceMetric[] = ['heartRate', 'steps', 'energy', 'oxygenSaturation', 'bloodPressure'];

describe('absenceLabelOf: o que o backend decidiu', () => {
  it.each([
    ['heartRate', 'Aguardando leitura'],
    ['steps', 'Aguardando leitura'],
    ['energy', 'Aguardando leitura'],
    ['oxygenSaturation', 'Aguardando medição'],
    ['bloodPressure', 'Aguardando medição'],
  ] as const)('%s aguardando: "%s"', (metric, rotulo) => {
    expect(absenceLabelOf(metric, 'AWAITING', android())).toBe(rotulo);
  });

  it.each([
    ['heartRate', 'Esta pulseira não envia batimento'],
    ['steps', 'Esta pulseira não envia passos'],
    ['energy', 'Esta pulseira não envia energia'],
    ['oxygenSaturation', 'Esta pulseira não envia oxigenação'],
    ['bloodPressure', 'Esta pulseira não envia pressão'],
  ] as const)('%s não enviada: "%s"', (metric, rotulo) => {
    expect(absenceLabelOf(metric, 'NOT_SENT', android())).toBe(rotulo);
  });

  // Sem caminho ativo o backend não diz nada, e o Android nunca cai no
  // "Indisponível" do iPhone: quem explica é a lista de prontidão.
  it('Android sem ausência e sem falha não diz nada', () => {
    for (const metric of TODAS) expect(absenceLabelOf(metric, null, android())).toBeNull();
  });

  it('sem contexto (Android sem o gate, carregando no iPhone) não diz nada', () => {
    expect(absenceLabelOf('bloodPressure', 'AWAITING', null)).toBeNull();
  });
});

describe('absenceLabelOf: Falhou, decidido pelo estado local', () => {
  it('a última rodada do Health Connect com erro sobrepõe Aguardando e Não envia em todas', () => {
    const ctx = android({ healthConnect: HC_NEGADO });
    for (const metric of TODAS) {
      expect(absenceLabelOf(metric, 'AWAITING', ctx)).toBe('Sincronização falhou às 14:10');
      expect(absenceLabelOf(metric, 'NOT_SENT', ctx)).toBe('Sincronização falhou às 14:10');
    }
  });

  // Sem caminho ativo o backend manda nulo, e a falha continua sendo a
  // verdade: é ela que tirou o caminho do ar.
  it('vale também quando o backend não diz nada', () => {
    const ctx = android({ healthConnect: HC_NEGADO });
    expect(absenceLabelOf('bloodPressure', null, ctx)).toBe('Sincronização falhou às 14:10');
  });

  it('falha de outro dia leva a data', () => {
    const ctx = android({ healthConnect: { ...HC_NEGADO, at: ONTEM_09_05 } });
    expect(absenceLabelOf('steps', 'AWAITING', ctx)).toBe('Sincronização falhou em 30/09 às 09:05');
  });

  it('a escuta caída só derruba o batimento: o Bluetooth não traz mais nada', () => {
    const ctx = android({ bluetooth: BLE_FORA });
    expect(absenceLabelOf('heartRate', 'AWAITING', ctx)).toBe('Pulseira desconectada desde 14:10');
    expect(absenceLabelOf('bloodPressure', 'AWAITING', ctx)).toBe('Aguardando medição');
    expect(absenceLabelOf('steps', 'NOT_SENT', ctx)).toBe('Esta pulseira não envia passos');
  });

  it('Bluetooth desligado também é a pulseira desconectada, desde a mudança', () => {
    const ctx = android({ bluetooth: { ...BLE_FORA, reason: 'bluetoothOff', since: ONTEM_09_05 } });
    expect(absenceLabelOf('heartRate', null, ctx)).toBe('Pulseira desconectada desde 30/09 às 09:05');
  });

  it('sem saber desde quando, a frase sai sem hora em vez de inventar uma', () => {
    const ctx = android({ bluetooth: { ...BLE_FORA, since: null } });
    expect(absenceLabelOf('heartRate', 'AWAITING', ctx)).toBe('Pulseira desconectada');
  });

  // O batimento tem dois caminhos. Com a escuta conectada ele está a
  // caminho por ela, mesmo com o Health Connect falhando; com a escuta fora
  // do ar (nenhuma pulseira escolhida, ou parada) a falha do Health Connect
  // é a dele também.
  it('batimento: escuta conectada segura a falha do Health Connect', () => {
    const ctx = android({ healthConnect: HC_NEGADO, bluetoothConnected: true });
    expect(absenceLabelOf('heartRate', 'AWAITING', ctx)).toBe('Aguardando leitura');
    expect(absenceLabelOf('bloodPressure', 'AWAITING', ctx)).toBe('Sincronização falhou às 14:10');
  });

  it('batimento: com os dois caminhos falhando, vale a escuta, que é o ao vivo', () => {
    const ctx = android({ healthConnect: HC_NEGADO, bluetooth: BLE_FORA });
    expect(absenceLabelOf('heartRate', 'AWAITING', ctx)).toBe('Pulseira desconectada desde 14:10');
  });
});

describe('absenceLabelOf: iPhone (ADR-0004)', () => {
  const ios = (mirroredSession: boolean): AbsenceContext => ({ platform: 'ios', mirroredSession });

  it.each([
    ['heartRate', 'Aguardando leitura'],
    ['energy', 'Aguardando leitura'],
    ['bloodPressure', 'Aguardando medição'],
    ['oxygenSaturation', 'Aguardando medição'],
  ] as const)('com a sessão espelhada ativa, %s: "%s"', (metric, rotulo) => {
    expect(absenceLabelOf(metric, null, ios(true))).toBe(rotulo);
  });

  it('sem a sessão, "Indisponível", sem motivo', () => {
    for (const metric of TODAS) expect(absenceLabelOf(metric, null, ios(false))).toBe('Indisponível');
  });

  it('ignora o que vier do backend: lá vale a ADR-0004', () => {
    expect(absenceLabelOf('bloodPressure', 'NOT_SENT', ios(false))).toBe('Indisponível');
  });
});

describe('failureNoticesOf: o aviso com motivo e botão', () => {
  it('um aviso por caminho que derrubou alguma métrica mostrada, com o motivo afirmado', () => {
    const ctx = android({ healthConnect: HC_NEGADO, bluetooth: BLE_FORA });
    expect(failureNoticesOf(['heartRate', 'bloodPressure'], ctx)).toEqual([
      {
        path: 'bluetooth',
        title: 'Pulseira desconectada desde 14:10',
        reason: 'Pulseira fora do alcance ou desligada.',
        action: 'relisten',
        deviceId: 'AA:01',
      },
      {
        path: 'healthConnect',
        title: 'Sincronização falhou às 14:10',
        reason: 'Permissão de leitura do Health Connect negada.',
        action: 'sync',
        deviceId: null,
      },
    ]);
  });

  it.each([
    ['permission_denied', 'Permissão de leitura do Health Connect negada.'],
    ['unavailable', 'Health Connect não instalado neste celular.'],
    ['update_required', 'Health Connect desatualizado.'],
    ['other', 'Erro ao ler o Health Connect.'],
  ] as const)('Health Connect, %s: "%s"', (reason, texto) => {
    const ctx = android({ healthConnect: { ...HC_NEGADO, reason } });
    expect(failureNoticesOf(['steps'], ctx)[0]?.reason).toBe(texto);
  });

  it('Bluetooth desligado diz isso', () => {
    const ctx = android({ bluetooth: { ...BLE_FORA, reason: 'bluetoothOff' } });
    expect(failureNoticesOf(['heartRate'], ctx)[0]?.reason).toBe('Bluetooth do celular desligado.');
  });

  it('com todas as métricas de pé, ou sem a do caminho, não há aviso', () => {
    expect(failureNoticesOf([], android({ healthConnect: HC_NEGADO }))).toEqual([]);
    expect(failureNoticesOf(['bloodPressure'], android({ bluetooth: BLE_FORA }))).toEqual([]);
  });

  it('iPhone e sem contexto nunca têm aviso', () => {
    expect(failureNoticesOf(TODAS, { platform: 'ios', mirroredSession: false })).toEqual([]);
    expect(failureNoticesOf(TODAS, null)).toEqual([]);
  });
});

describe('androidAbsenceContext: do estado local às falhas', () => {
  const hc = (lastFailureReason: 'permission_denied' | null, lastFailureAt: string | null) => ({
    availability: 'available' as const,
    permission: 'granted' as const,
    bandPackage: null,
    bandLabel: null,
    noBand: false,
    lastSyncAt: null,
    lastFailureReason,
    lastFailureAt,
  });
  const PULSEIRA = { deviceId: 'AA:01', name: 'Band' };
  const desde = Date.parse(HOJE_14_10);

  it('última rodada do Health Connect com erro vira a falha dele', () => {
    const ctx = androidAbsenceContext({
      healthConnect: hc('permission_denied', HOJE_14_10),
      band: null,
      listener: null,
      now: NOW,
    });
    expect(ctx).toMatchObject({ healthConnect: HC_NEGADO, bluetooth: null, bluetoothConnected: false });
  });

  it('rodada que leu (ou nenhuma) não é falha', () => {
    for (const healthConnect of [hc(null, null), null]) {
      expect(androidAbsenceContext({ healthConnect, band: null, listener: null, now: NOW })).toMatchObject({
        healthConnect: null,
      });
    }
  });

  it.each([
    ['searching', { bluetooth: BLE_FORA, bluetoothConnected: false }],
    ['bluetoothOff', { bluetooth: { ...BLE_FORA, reason: 'bluetoothOff' }, bluetoothConnected: false }],
    ['connected', { bluetooth: null, bluetoothConnected: true }],
    // Parada não é falha: a escuta parada é o ciclo de vida dela, não erro.
    ['idle', { bluetooth: null, bluetoothConnected: false }],
  ] as const)('escuta %s', (state, esperado) => {
    const ctx = androidAbsenceContext({
      healthConnect: null,
      band: PULSEIRA,
      listener: { state, since: desde },
      now: NOW,
    });
    expect(ctx).toMatchObject(esperado);
  });

  it('sem pulseira escolhida a escuta não conta', () => {
    const ctx = androidAbsenceContext({
      healthConnect: null,
      band: null,
      listener: { state: 'searching', since: desde },
      now: NOW,
    });
    expect(ctx).toMatchObject({ bluetooth: null, bluetoothConnected: false });
  });
});
