import type { NativeHttpResponse, WatchControl } from '../../modules/swi-watch-control';
import type { HealthConnectState } from './healthConnect/healthConnectReader';
import type { ReadinessFacts } from './readiness';
import {
  READINESS_REPORT_PATH,
  listenerSinceOf,
  readinessReportOf,
  sendReadinessReport,
  type ReadinessReport,
} from './readinessReport';

// O relato de prontidão: os fatos do aparelho no contrato do backend
// (PUT /telemetry/v1/devices/me/readiness) e o envio com a credencial do
// aparelho, com o mesmo desfecho do envio da telemetria para 401 e rede.

const FATOS: ReadinessFacts = {
  paired: true,
  healthConnectAvailability: 'available',
  readGranted: true,
  backgroundGranted: false,
  manufacturerPackage: 'com.xiaomi.wearable',
  bandChosen: true,
  hasBirthDate: true,
};

const HC: HealthConnectState = {
  availability: 'available',
  permission: 'granted',
  backgroundPermission: 'denied',
  bandPackage: 'com.xiaomi.wearable',
  bandLabel: 'Mi Fitness',
  noBand: false,
  lastSyncAt: '2026-10-22T10:00:00.000Z',
  lastFailureReason: null,
  lastFailureAt: null,
};

const LEITURA = Date.parse('2026-10-22T10:05:00.000Z');
const DESDE = Date.parse('2026-10-22T09:00:00.000Z');

describe('readinessReportOf', () => {
  it('leva os fatos do Health Connect e do Bluetooth no contrato do backend', () => {
    expect(
      readinessReportOf({
        facts: FATOS,
        healthConnect: HC,
        listener: { state: 'connected', since: DESDE },
        lastReadingAt: LEITURA,
      }),
    ).toEqual<ReadinessReport>({
      healthConnect: {
        availability: 'AVAILABLE',
        readGranted: true,
        backgroundGranted: false,
        manufacturerPackage: 'com.xiaomi.wearable',
        lastSyncAt: '2026-10-22T10:00:00.000Z',
        lastFailure: null,
      },
      bluetooth: {
        bandChosen: true,
        listenerState: 'CONNECTED',
        listenerStateSince: '2026-10-22T09:00:00.000Z',
        lastReadingAt: '2026-10-22T10:05:00.000Z',
      },
    });
  });

  it.each([
    ['available', 'AVAILABLE'],
    ['unavailable', 'UNAVAILABLE'],
    ['update_required', 'UPDATE_REQUIRED'],
    [null, null],
  ] as const)('disponibilidade %s vira %s', (disponibilidade, contrato) => {
    const report = readinessReportOf({
      facts: { ...FATOS, healthConnectAvailability: disponibilidade },
      healthConnect: HC,
      listener: null,
      lastReadingAt: null,
    });
    expect(report.healthConnect.availability).toBe(contrato);
  });

  it.each([
    ['permission_denied', 'PERMISSION_DENIED'],
    ['unavailable', 'UNAVAILABLE'],
    ['update_required', 'UPDATE_REQUIRED'],
    ['other', 'OTHER'],
  ] as const)('falha %s vira %s, com a hora', (motivo, contrato) => {
    const report = readinessReportOf({
      facts: FATOS,
      healthConnect: { ...HC, lastFailureReason: motivo, lastFailureAt: '2026-10-22T10:15:00.000Z' },
      listener: null,
      lastReadingAt: null,
    });
    expect(report.healthConnect.lastFailure).toEqual({ reason: contrato, at: '2026-10-22T10:15:00.000Z' });
  });

  it('motivo sem hora (estado montado à mão) não vira falha', () => {
    const report = readinessReportOf({
      facts: FATOS,
      healthConnect: { ...HC, lastFailureReason: 'other', lastFailureAt: undefined },
      listener: null,
      lastReadingAt: null,
    });
    expect(report.healthConnect.lastFailure).toBeNull();
  });

  it.each([
    ['connected', 'CONNECTED'],
    ['searching', 'SEARCHING'],
    ['bluetoothOff', 'BLUETOOTH_OFF'],
    ['idle', 'ENDED'],
  ] as const)('escuta %s vira %s', (estado, contrato) => {
    const report = readinessReportOf({
      facts: FATOS,
      healthConnect: HC,
      listener: { state: estado, since: null },
      lastReadingAt: null,
    });
    expect(report.bluetooth).toMatchObject({ listenerState: contrato, listenerStateSince: null });
  });

  it('sem a escuta (gate desligado ou ponte ausente), o estado e a última leitura saem nulos', () => {
    const report = readinessReportOf({
      facts: { ...FATOS, bandChosen: false },
      healthConnect: HC,
      listener: null,
      lastReadingAt: LEITURA,
    });
    expect(report.bluetooth).toEqual({
      bandChosen: false,
      listenerState: null,
      listenerStateSince: null,
      lastReadingAt: null,
    });
  });

  it('antes do primeiro estado do leitor, a sincronização e a falha saem nulas', () => {
    const report = readinessReportOf({ facts: FATOS, healthConnect: null, listener: null, lastReadingAt: null });
    expect(report.healthConnect).toMatchObject({ lastSyncAt: null, lastFailure: null });
  });
});

describe('listenerSinceOf', () => {
  const trechos = [
    { start: 1_000, end: 2_000 },
    { start: 3_000, end: 4_000 },
  ];

  it('conectada: desde o começo do trecho aberto', () => {
    expect(listenerSinceOf('connected', [...trechos, { start: 5_000, end: null }])).toBe(5_000);
  });

  it.each(['searching', 'bluetoothOff'] as const)('%s: desde o fim do último trecho', (estado) => {
    expect(listenerSinceOf(estado, trechos)).toBe(4_000);
  });

  it('sem trecho, ou parada, não se afirma nada', () => {
    expect(listenerSinceOf('searching', [])).toBeNull();
    expect(listenerSinceOf('connected', trechos)).toBeNull();
    expect(listenerSinceOf('idle', trechos)).toBeNull();
  });
});

describe('sendReadinessReport', () => {
  const RELATO = readinessReportOf({ facts: FATOS, healthConnect: HC, listener: null, lastReadingAt: null });

  function controle(resposta: NativeHttpResponse | Error) {
    const request = jest.fn(async () => {
      if (resposta instanceof Error) throw resposta;
      return resposta;
    });
    const clearDeviceCredential = jest.fn();
    const control = { request, clearDeviceCredential } as unknown as WatchControl;
    return { control, request, clearDeviceCredential };
  }
  const comCodigo = (code: string) => Object.assign(new Error(code), { code });
  const apiUrl = () => 'https://api.example.test';

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('PUT com a credencial do aparelho, o relato em JSON e sem guardar credencial', async () => {
    const m = controle({ status: 204, body: '' });

    expect(await sendReadinessReport(RELATO, { control: m.control, apiUrl })).toBe('sent');

    expect(READINESS_REPORT_PATH).toBe('/telemetry/v1/devices/me/readiness');
    expect(m.request).toHaveBeenCalledWith(
      'https://api.example.test/telemetry/v1/devices/me/readiness',
      'PUT',
      JSON.stringify(RELATO),
      { kind: 'device' },
      false,
    );
  });

  it('401: apaga a credencial, como o envio da telemetria', async () => {
    const m = controle({ status: 401, body: '' });

    expect(await sendReadinessReport(RELATO, { control: m.control, apiUrl })).toBe('unpaired');

    expect(m.clearDeviceCredential).toHaveBeenCalledTimes(1);
  });

  it.each(['E_NO_CREDENTIAL', 'E_UNSUPPORTED'])('%s: não pareado, sem nada a apagar', async (code) => {
    const m = controle(comCodigo(code));

    expect(await sendReadinessReport(RELATO, { control: m.control, apiUrl })).toBe('unpaired');

    expect(m.clearDeviceCredential).not.toHaveBeenCalled();
  });

  it.each([
    ['falha de rede', comCodigo('E_NETWORK')],
    ['rejeição sem código', new Error('estranho')],
  ])('%s: adiado, nunca rejeita', async (_caso, erro) => {
    const m = controle(erro);
    expect(await sendReadinessReport(RELATO, { control: m.control, apiUrl })).toBe('deferred');
  });

  it.each([429, 500, 503])('%s: adiado', async (status) => {
    const m = controle({ status, body: '' });
    expect(await sendReadinessReport(RELATO, { control: m.control, apiUrl })).toBe('deferred');
  });

  it.each([400, 403])('%s: recusado, com aviso', async (status) => {
    const m = controle({ status, body: 'nope' });

    expect(await sendReadinessReport(RELATO, { control: m.control, apiUrl })).toBe('rejected');

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(String(status)));
    expect(m.clearDeviceCredential).not.toHaveBeenCalled();
  });
});
