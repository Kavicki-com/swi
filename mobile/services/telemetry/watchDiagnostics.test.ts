import { act, create } from 'react-test-renderer';
import { createElement } from 'react';
import {
  createWatchControl,
  loadNativeWatchControl,
  type SwiWatchControlEvents,
  type SwiWatchControlStatus,
  type WatchControlNative,
} from '../../modules/swi-watch-control';
import { useWatchDiagnostics, type WatchDiagnosticsState } from './watchDiagnostics';

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
    sessionChangedAt: null,
    lastSample: null,
    ...initial,
  };
  const requestAuthorization = jest.fn(async () => true);
  const native: WatchControlNative = {
    getStatus: () => ({ ...status }),
    requestAuthorization,
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
  return { native, emit, listeners, requestAuthorization };
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
      lastSample: { bpm: 68, measuredAt: '2026-09-02T13:00:03.000Z' },
    });

    await act(async () => {
      emit('onMirroredSessionChanged', { state: 'ended', changedAt: '2026-09-02T13:10:00.000Z' });
    });
    expect(last()).toMatchObject({ session: 'ended', lastSample: { bpm: 68 } });
  });

  it('pede autorização do HealthKit no iPhone uma vez quando há suporte', async () => {
    const { native, requestAuthorization } = fakeNative();
    const { Probe } = probe(createWatchControl(native));
    await act(async () => {
      create(createElement(Probe));
    });
    expect(requestAuthorization).toHaveBeenCalledTimes(1);
  });

  it('sem suporte não tenta autorizar nada', async () => {
    const control = createWatchControl(null);
    const spy = jest.spyOn(control, 'requestAuthorization');
    const { Probe } = probe(control);
    await act(async () => {
      create(createElement(Probe));
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
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
