import { act, create } from 'react-test-renderer';
import { createElement, useState, type ReactElement } from 'react';
import type { SwiWatchControlStatus, WatchControl } from '../../modules/swi-watch-control';
import { createTelemetryOutbox, type OutboxStorage } from './telemetryOutbox';
import type { TelemetryUploader, UploadOutcome } from './telemetryUploader';
import {
  MAX_DRAIN_ROUNDS,
  useTelemetryUpload,
  type TelemetryUploadDeps,
  type TelemetryUploadState,
} from './useTelemetryUpload';

// O hook é a fiação: enquanto a tela de monitoramento está montada, cada
// amostra que entra na fila dispara um envio, e o que ficou de uma execução
// anterior sai ao montar. Fila real em memória (o gravador precisa dela para
// avisar); o envio é dublê, porque a rede é assunto do uploader.

function memoryStorage(): OutboxStorage {
  let text: string | null = null;
  return {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
  };
}

function fakeControl(overrides: Partial<WatchControl> = {}) {
  let listener: ((status: SwiWatchControlStatus) => void) | null = null;
  const unsubscribe = jest.fn(() => {
    listener = null;
  });
  const hasDeviceCredential = jest.fn(() => true);
  const subscribe = jest.fn((l: (status: SwiWatchControlStatus) => void) => {
    listener = l;
    return unsubscribe;
  });
  const control: WatchControl = {
    supported: true,
    getStatus: () => null,
    requestAuthorization: async () => true,
    startMonitoring: async () => true,
    subscribe,
    request: async () => ({ status: 200, body: '{}' }),
    hasDeviceCredential,
    clearDeviceCredential: () => undefined,
    rotateInbox: () => [],
    ...overrides,
  };
  // `watchProtocol` entra com o padrão do formato novo: é o que o relógio
  // desta entrega fala, e os testes que exercitam o legado o sobrescrevem.
  const emit = (status: Partial<SwiWatchControlStatus>) => {
    if (!listener) throw new Error('ninguém assinou o controle');
    listener({
      session: 'none',
      sessionChangedAt: null,
      lastSample: null,
      watchProtocol: 'v1',
      ...status,
    });
  };
  return { control, emit, subscribe, unsubscribe, hasDeviceCredential };
}

function fakeUploader() {
  const uploadPending = jest.fn<Promise<UploadOutcome>, []>(async () => ({ outcome: 'idle' }));
  const uploader: TelemetryUploader = { uploadPending };
  return { uploader, uploadPending };
}

const sent = (accepted: number, remaining: number): UploadOutcome => ({
  outcome: 'sent',
  accepted,
  duplicates: 0,
  conflicts: 0,
  remaining,
});

const amostra = (measuredAt: string): SwiWatchControlStatus => ({
  session: 'running',
  watchProtocol: null,
  sessionChangedAt: '2026-09-07T12:00:00.000Z',
  lastSample: { bpm: 70, measuredAt },
});

// Macrotarefa: gravador, fila e laço de envio resolvem antes dela.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function probe(control: WatchControl, deps?: TelemetryUploadDeps) {
  const states: TelemetryUploadState[] = [];
  function Probe() {
    states.push(useTelemetryUpload(control, deps));
    return null;
  }
  return { Probe, states, last: () => states[states.length - 1] };
}

async function mount(Probe: () => ReactElement | null) {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(createElement(Probe));
    await flush();
  });
  return tree;
}

const montadas: ReturnType<typeof create>[] = [];
afterEach(async () => {
  while (montadas.length) {
    const tree = montadas.pop()!;
    await act(async () => {
      tree.unmount();
    });
  }
});

async function setup(controlOverrides: Partial<WatchControl> = {}) {
  const c = fakeControl(controlOverrides);
  const u = fakeUploader();
  const outbox = createTelemetryOutbox(memoryStorage());
  const p = probe(c.control, { outbox, uploader: u.uploader });
  return { ...c, ...u, ...p, outbox };
}

describe('useTelemetryUpload, sem condições de enviar', () => {
  it('sem suporte não cria gravador nem chama uploadPending', async () => {
    const s = await setup({ supported: false });
    montadas.push(await mount(s.Probe));
    expect(s.last()).toEqual({ paired: false, lastOutcome: null });
    expect(s.subscribe).not.toHaveBeenCalled();
    expect(s.uploadPending).not.toHaveBeenCalled();
  });

  it('com suporte e sem credencial, paired é false e nada é chamado', async () => {
    const s = await setup();
    s.hasDeviceCredential.mockReturnValue(false);
    montadas.push(await mount(s.Probe));
    expect(s.last()).toEqual({ paired: false, lastOutcome: null });
    expect(s.subscribe).not.toHaveBeenCalled();
    expect(s.uploadPending).not.toHaveBeenCalled();
  });
});

describe('useTelemetryUpload, pareado', () => {
  it('drena ao montar e paired é true', async () => {
    const s = await setup();
    montadas.push(await mount(s.Probe));
    expect(s.uploadPending).toHaveBeenCalledTimes(1);
    expect(s.last()).toEqual({ paired: true, lastOutcome: { outcome: 'idle' } });
    expect(s.subscribe).toHaveBeenCalledTimes(1);
  });

  it('cada amostra que entra na fila dispara um envio', async () => {
    const s = await setup();
    montadas.push(await mount(s.Probe));
    await act(async () => {
      s.emit(amostra('2026-09-07T12:00:05.000Z'));
      await flush();
    });
    expect(s.uploadPending).toHaveBeenCalledTimes(2);
  });

  // Um `sent` não significa fila vazia: o envio corta em 200 por chamada.
  it('sent com remaining 50 faz uma segunda chamada, e remaining 0 para', async () => {
    const s = await setup();
    s.uploadPending.mockResolvedValueOnce(sent(200, 50)).mockResolvedValueOnce(sent(50, 0));
    montadas.push(await mount(s.Probe));
    expect(s.uploadPending).toHaveBeenCalledTimes(2);
    expect(s.last().lastOutcome).toEqual(sent(50, 0));
  });

  // Confirmação que não cita nada deixa a fila como estava; repetir seria
  // martelar o backend com o mesmo lote.
  it('sent que não cita evento nenhum não repete', async () => {
    const s = await setup();
    s.uploadPending.mockResolvedValueOnce(sent(0, 5));
    montadas.push(await mount(s.Probe));
    expect(s.uploadPending).toHaveBeenCalledTimes(1);
  });

  it('o laço tem teto: para depois de MAX_DRAIN_ROUNDS mesmo com fila que nunca zera', async () => {
    const s = await setup();
    s.uploadPending.mockImplementation(async () => sent(1, 1));
    montadas.push(await mount(s.Probe));
    expect(s.uploadPending).toHaveBeenCalledTimes(MAX_DRAIN_ROUNDS);
  });

  it('deferred para o laço e mantém paired', async () => {
    const s = await setup();
    s.uploadPending.mockResolvedValueOnce({ outcome: 'deferred' });
    montadas.push(await mount(s.Probe));
    expect(s.uploadPending).toHaveBeenCalledTimes(1);
    expect(s.last()).toEqual({ paired: true, lastOutcome: { outcome: 'deferred' } });
  });
});

describe('useTelemetryUpload, revogação', () => {
  it('unpaired derruba paired, para o gravador e nada mais é enviado', async () => {
    const s = await setup();
    s.uploadPending.mockResolvedValueOnce({ outcome: 'unpaired' });
    montadas.push(await mount(s.Probe));
    expect(s.last()).toEqual({ paired: false, lastOutcome: { outcome: 'unpaired' } });
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);

    // O ouvinte já foi cancelado: emitir agora é o invólucro falando sozinho.
    expect(() => s.emit(amostra('2026-09-07T12:00:05.000Z'))).toThrow();
    expect(s.uploadPending).toHaveBeenCalledTimes(1);
  });
});

describe('useTelemetryUpload, montagem', () => {
  it('desmontar cancela a assinatura do gravador', async () => {
    const s = await setup();
    const tree = await mount(s.Probe);
    expect(s.unsubscribe).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('um envio em voo termina depois do desmonte sem atualizar estado', async () => {
    const s = await setup();
    let resolver!: (outcome: UploadOutcome) => void;
    s.uploadPending.mockImplementationOnce(
      () =>
        new Promise<UploadOutcome>((resolve) => {
          resolver = resolve;
        }),
    );
    const tree = await mount(s.Probe);
    const renders = s.states.length;
    await act(async () => {
      tree.unmount();
    });
    await act(async () => {
      resolver(sent(1, 0));
      await flush();
    });
    expect(s.states.length).toBe(renders);
  });

  // hasDeviceCredential lê o chaveiro: uma vez por montagem, não por render.
  it('hasDeviceCredential é lido uma vez mesmo com dois renders', async () => {
    const s = await setup();
    let rerender!: () => void;
    function Wrapper() {
      const [, setN] = useState(0);
      rerender = () => setN((n) => n + 1);
      return createElement(s.Probe);
    }
    montadas.push(await mount(Wrapper));
    await act(async () => {
      rerender();
    });
    expect(s.states.length).toBeGreaterThanOrEqual(2);
    expect(s.hasDeviceCredential).toHaveBeenCalledTimes(1);
  });
});
