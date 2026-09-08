import { act, create } from 'react-test-renderer';
import { createElement } from 'react';
import {
  createWatchControl,
  loadNativeWatchControl,
  nativeErrorCode,
  type NativeHttpResponse,
  type SwiWatchControlEvents,
  type SwiWatchControlStatus,
  type WatchControlNative,
} from '../../modules/swi-watch-control';
import {
  activateMonitoring,
  useWatchDiagnostics,
  type WatchDiagnosticsState,
} from './watchDiagnostics';

type Listener<K extends keyof SwiWatchControlEvents> = (event: SwiWatchControlEvents[K]) => void;

// Dublê do módulo nativo: guarda os listeners para o teste disparar eventos
// como o iPhone faria ao receber dados da sessão espelhada.
function fakeNative(initial?: Partial<SwiWatchControlStatus>) {
  const listeners: { [K in keyof SwiWatchControlEvents]: Listener<K>[] } = {
    onMirroredSessionChanged: [],
    onHeartRateSample: [],
  };
  const status: SwiWatchControlStatus = {
    session: 'none',
    watchProtocol: null,
    sessionChangedAt: null,
    lastSample: null,
    ...initial,
  };
  const requestAuthorization = jest.fn(async () => true);
  const startMonitoring = jest.fn(async () => true);
  const request = jest.fn(async (): Promise<NativeHttpResponse> => ({ status: 200, body: '{}' }));
  const hasDeviceCredential = jest.fn(() => false);
  const clearDeviceCredential = jest.fn();
  const native: WatchControlNative = {
    getStatus: () => ({ ...status }),
    requestAuthorization,
    startMonitoring,
    request,
    hasDeviceCredential,
    clearDeviceCredential,
    rotateInbox: () => [],
    addListener: (event, listener) => {
      const list = listeners[event] as Listener<typeof event>[];
      list.push(listener as Listener<typeof event>);
      return {
        remove: () => {
          const i = list.indexOf(listener as Listener<typeof event>);
          if (i >= 0) list.splice(i, 1);
        },
      };
    },
  };
  const emit = <K extends keyof SwiWatchControlEvents>(
    event: K,
    payload: SwiWatchControlEvents[K],
  ) => {
    for (const l of listeners[event] as Listener<K>[]) l(payload);
  };
  return {
    native,
    emit,
    listeners,
    requestAuthorization,
    startMonitoring,
    request,
    hasDeviceCredential,
    clearDeviceCredential,
    status,
  };
}

describe('loadNativeWatchControl', () => {
  it('Android não tem módulo nativo e não quebra', () => {
    expect(loadNativeWatchControl('android')).toBeNull();
  });

  it('iOS sem o módulo compilado (Expo Go, Jest) também resolve para null', () => {
    expect(loadNativeWatchControl('ios')).toBeNull();
  });

  it('web resolve para null', () => {
    expect(loadNativeWatchControl('web')).toBeNull();
  });
});

describe('createWatchControl', () => {
  it('sem módulo nativo é unsupported: status null e subscribe inerte', async () => {
    const control = createWatchControl(null);
    expect(control.supported).toBe(false);
    expect(control.getStatus()).toBeNull();
    await expect(control.requestAuthorization()).resolves.toBe(false);
    await expect(control.startMonitoring()).resolves.toBe(false);
    const listener = jest.fn();
    const unsubscribe = control.subscribe(listener);
    expect(() => unsubscribe()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('com módulo nativo expõe o status inicial sem inventar amostra', () => {
    const { native } = fakeNative();
    const control = createWatchControl(native);
    expect(control.supported).toBe(true);
    expect(control.getStatus()).toEqual({
      session: 'none',
      watchProtocol: null,
      sessionChangedAt: null,
      lastSample: null,
    });
  });

  it('sessão espelhada e amostra de BPM atualizam o status com measuredAt', () => {
    const { native, emit } = fakeNative();
    const control = createWatchControl(native);
    const seen: SwiWatchControlStatus[] = [];
    control.subscribe((s) => seen.push(s));

    emit('onMirroredSessionChanged', { state: 'running', changedAt: '2026-09-02T13:00:00.000Z' });
    emit('onHeartRateSample', { bpm: 72, measuredAt: '2026-09-02T13:00:05.000Z' });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({
      session: 'running',
      watchProtocol: null,
      sessionChangedAt: '2026-09-02T13:00:00.000Z',
      lastSample: null,
    });
    expect(seen[1].lastSample).toEqual({ bpm: 72, measuredAt: '2026-09-02T13:00:05.000Z' });
    expect(seen[1].session).toBe('running');
  });

  it('amostra inválida (NaN, zero, sem horário) é ignorada em vez de virar número', () => {
    const { native, emit } = fakeNative();
    const control = createWatchControl(native);
    const listener = jest.fn();
    control.subscribe(listener);

    emit('onHeartRateSample', { bpm: Number.NaN, measuredAt: '2026-09-02T13:00:05.000Z' });
    emit('onHeartRateSample', { bpm: 0, measuredAt: '2026-09-02T13:00:06.000Z' });
    emit('onHeartRateSample', { bpm: 80, measuredAt: '' });

    expect(listener).not.toHaveBeenCalled();
    expect(control.getStatus()?.lastSample).toBeNull();
  });

  it('cancelar a inscrição remove os dois listeners nativos', () => {
    const { native, listeners } = fakeNative();
    const control = createWatchControl(native);
    const unsubscribe = control.subscribe(jest.fn());
    expect(listeners.onMirroredSessionChanged).toHaveLength(1);
    expect(listeners.onHeartRateSample).toHaveLength(1);
    unsubscribe();
    expect(listeners.onMirroredSessionChanged).toHaveLength(0);
    expect(listeners.onHeartRateSample).toHaveLength(0);
  });
});

describe('createWatchControl.request e estado de pareamento', () => {
  it('sem suporte, request rejeita com E_UNSUPPORTED sem tocar a rede', async () => {
    const control = createWatchControl(null);
    await expect(
      control.request('https://api/x', 'POST', null, { kind: 'device' }, false),
    ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
  });

  it('sem suporte, não há credencial e limpar não lança', () => {
    const control = createWatchControl(null);
    expect(control.hasDeviceCredential()).toBe(false);
    expect(() => control.clearDeviceCredential()).not.toThrow();
  });

  it('com suporte, request repassa os cinco argumentos na ordem e devolve a resposta como veio', async () => {
    const { native, request } = fakeNative();
    request.mockResolvedValueOnce({ status: 201, body: '{"ok":true}' });
    const control = createWatchControl(native);
    const resposta = await control.request(
      'https://api/telemetry',
      'POST',
      '{"a":1}',
      { kind: 'bearer', token: 'tok' },
      true,
    );
    expect(request).toHaveBeenCalledWith(
      'https://api/telemetry',
      'POST',
      '{"a":1}',
      { kind: 'bearer', token: 'tok' },
      true,
    );
    expect(resposta).toEqual({ status: 201, body: '{"ok":true}' });
  });

  // Quem chama decide pelo código da rejeição; o invólucro não engole nada.
  it('com suporte, a rejeição do nativo sobe intacta', async () => {
    const { native, request } = fakeNative();
    const erro = Object.assign(new Error('sem rede'), { code: 'E_NETWORK' });
    request.mockRejectedValueOnce(erro);
    await expect(
      createWatchControl(native).request('https://api/x', 'GET', null, { kind: 'device' }, false),
    ).rejects.toBe(erro);
  });

  it('hasDeviceCredential e clearDeviceCredential delegam ao nativo', () => {
    const { native, hasDeviceCredential, clearDeviceCredential } = fakeNative();
    hasDeviceCredential.mockReturnValueOnce(true);
    const control = createWatchControl(native);
    expect(control.hasDeviceCredential()).toBe(true);
    expect(hasDeviceCredential).toHaveBeenCalledTimes(1);
    control.clearDeviceCredential();
    expect(clearDeviceCredential).toHaveBeenCalledTimes(1);
  });
});

describe('nativeErrorCode', () => {
  it.each([
    'E_URL',
    'E_NO_CREDENTIAL',
    'E_NETWORK',
    'E_KEYCHAIN',
    'E_CREDENTIAL_MISSING',
    'E_UNSUPPORTED',
  ])('reconhece %s', (code) => {
    expect(nativeErrorCode(Object.assign(new Error('x'), { code }))).toBe(code);
  });

  it('devolve null para código desconhecido, erro sem código e valores que não são erro', () => {
    expect(nativeErrorCode(Object.assign(new Error('x'), { code: 'TIMEOUT' }))).toBeNull();
    expect(nativeErrorCode(new Error('x'))).toBeNull();
    expect(nativeErrorCode(null)).toBeNull();
    expect(nativeErrorCode('E_NETWORK')).toBeNull();
    expect(nativeErrorCode({ code: 42 })).toBeNull();
  });
});

describe('activateMonitoring', () => {
  it('sem suporte não tenta nada e responde que não ativou', async () => {
    await expect(activateMonitoring(createWatchControl(null))).resolves.toBe(false);
  });

  it('autoriza e só então ativa, nessa ordem', async () => {
    const { native, requestAuthorization, startMonitoring } = fakeNative();
    const ordem: string[] = [];
    requestAuthorization.mockImplementation(async () => {
      ordem.push('autorizar');
      return true;
    });
    startMonitoring.mockImplementation(async () => {
      ordem.push('ativar');
      return true;
    });

    await expect(activateMonitoring(createWatchControl(native))).resolves.toBe(true);
    expect(ordem).toEqual(['autorizar', 'ativar']);
  });

  // ADR-0004: o iOS não conta negação de leitura, e a folha pode já ter sido
  // respondida antes. Parar aqui deixaria de ativar quem já tinha autorizado.
  it('autorização recusada ou falha não impede a ativação', async () => {
    const { native, requestAuthorization, startMonitoring } = fakeNative();
    requestAuthorization.mockResolvedValueOnce(false);
    await activateMonitoring(createWatchControl(native));
    expect(startMonitoring).toHaveBeenCalledTimes(1);

    requestAuthorization.mockRejectedValueOnce(new Error('folha cancelada'));
    await expect(activateMonitoring(createWatchControl(native))).resolves.toBe(true);
    expect(startMonitoring).toHaveBeenCalledTimes(2);
  });

  it('devolve o resultado da ativação, não o da autorização', async () => {
    const { native, requestAuthorization, startMonitoring } = fakeNative();
    requestAuthorization.mockResolvedValueOnce(true);
    startMonitoring.mockResolvedValueOnce(false);
    await expect(activateMonitoring(createWatchControl(native))).resolves.toBe(false);
  });
});

describe('createWatchControl.startMonitoring', () => {
  it('pede ao nativo para acordar o relógio e abrir a sessão', async () => {
    const { native, startMonitoring } = fakeNative();
    await expect(createWatchControl(native).startMonitoring()).resolves.toBe(true);
    expect(startMonitoring).toHaveBeenCalledTimes(1);
  });

  it('com a sessão espelhada já ativa não tenta abrir uma segunda', async () => {
    const { native, startMonitoring } = fakeNative({ session: 'running' });
    await expect(createWatchControl(native).startMonitoring()).resolves.toBe(true);
    expect(startMonitoring).not.toHaveBeenCalled();
  });

  it('sessão encerrada pode ser reaberta', async () => {
    const { native, startMonitoring } = fakeNative({ session: 'ended' });
    await createWatchControl(native).startMonitoring();
    expect(startMonitoring).toHaveBeenCalledTimes(1);
  });

  it('falha do nativo resolve false em vez de rejeitar, para a tela não ter dois caminhos de erro', async () => {
    const { native, startMonitoring } = fakeNative();
    startMonitoring.mockRejectedValueOnce(new Error('HealthKit indisponível'));
    await expect(createWatchControl(native).startMonitoring()).resolves.toBe(false);
  });
});

describe('useWatchDiagnostics', () => {
  const probe = (control: ReturnType<typeof createWatchControl>) => {
    const states: WatchDiagnosticsState[] = [];
    function Probe() {
      states.push(useWatchDiagnostics(control));
      return null;
    }
    return { Probe, states, last: () => states[states.length - 1] };
  };

  it('unsupported quando não há módulo nativo', async () => {
    const { Probe, last } = probe(createWatchControl(null));
    await act(async () => {
      create(createElement(Probe));
    });
    expect(last()).toEqual({ support: 'unsupported' });
  });

  it('ready espelha o status nativo e acompanha eventos', async () => {
    const { native, emit } = fakeNative();
    const { Probe, last } = probe(createWatchControl(native));
    await act(async () => {
      create(createElement(Probe));
    });
    expect(last()).toEqual({
      support: 'ready',
      session: 'none',
      watchProtocol: null,
      sessionChangedAt: null,
      lastSample: null,
    });

    await act(async () => {
      emit('onMirroredSessionChanged', { state: 'running', changedAt: '2026-09-02T13:00:00.000Z' });
      emit('onHeartRateSample', { bpm: 68, measuredAt: '2026-09-02T13:00:03.000Z' });
    });
    expect(last()).toMatchObject({
      support: 'ready',
      session: 'running',
      watchProtocol: null,
      lastSample: { bpm: 68, measuredAt: '2026-09-02T13:00:03.000Z' },
    });

    await act(async () => {
      emit('onMirroredSessionChanged', { state: 'ended', changedAt: '2026-09-02T13:10:00.000Z' });
    });
    expect(last()).toMatchObject({ session: 'ended', lastSample: { bpm: 68 } });
  });

  // Autorizar é ação do funcionário, no botão. Observar o estado não pode
  // abrir a folha do sistema antes de a tela explicar o que vai ser lido.
  it('apenas observar o estado não abre a folha de permissão', async () => {
    const { native, requestAuthorization, startMonitoring } = fakeNative();
    const { Probe } = probe(createWatchControl(native));
    await act(async () => {
      create(createElement(Probe));
    });
    expect(requestAuthorization).not.toHaveBeenCalled();
    expect(startMonitoring).not.toHaveBeenCalled();
  });

  it('desmontar cancela a inscrição', async () => {
    const { native, listeners } = fakeNative();
    const { Probe } = probe(createWatchControl(native));
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(createElement(Probe));
    });
    expect(listeners.onHeartRateSample).toHaveLength(1);
    await act(async () => {
      tree.unmount();
    });
    expect(listeners.onHeartRateSample).toHaveLength(0);
  });
});
