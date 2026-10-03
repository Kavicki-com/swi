import { act, create } from 'react-test-renderer';
import { createElement } from 'react';
import type { WatchControl } from '../../modules/swi-watch-control';
import type { TelemetryInboxDrain } from './telemetryInboxDrain';
import { createTelemetryOutbox, type OutboxStorage } from './telemetryOutbox';
import type { TelemetryUploader, UploadOutcome } from './telemetryUploader';
import {
  useTelemetryUpload,
  type TelemetryUploadOptions,
  type TelemetryUploadState,
} from './useTelemetryUpload';

// O envio mora na raiz do app, e não numa tela: por isso precisa saber ligar e
// desligar sem remontar. Liga com sessão aberta e credencial no chaveiro;
// reconfere a credencial quando o pareamento conclui ou o login acontece.

function memoryStorage(): OutboxStorage {
  let text: string | null = null;
  return {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
  };
}

function setup(credencialInicial: boolean) {
  let credencial = credencialInicial;
  const hasDeviceCredential = jest.fn(() => credencial);
  const control: WatchControl = {
    supported: true,
    getStatus: () => null,
    requestAuthorization: async () => true,
    startMonitoring: async () => true,
    subscribe: () => () => undefined,
    request: async () => ({ status: 200, body: '{}' }),
    hasDeviceCredential,
    clearDeviceCredential: () => {
      credencial = false;
    },
    rotateInbox: () => [],
  };
  const uploadPending = jest.fn<Promise<UploadOutcome>, []>(async () => ({ outcome: 'idle' }));
  const uploader: TelemetryUploader = { uploadPending };
  const run = jest.fn(async () => ({ files: 0, events: 0, rejected: 0 }));
  const inboxDrain = { run } as unknown as TelemetryInboxDrain;
  const deps = { outbox: createTelemetryOutbox(memoryStorage()), uploader, inboxDrain };

  const states: TelemetryUploadState[] = [];
  function Probe(props: TelemetryUploadOptions) {
    states.push(useTelemetryUpload(control, deps, props));
    return null;
  }
  return {
    Probe,
    states,
    last: () => states[states.length - 1]!,
    uploadPending,
    run,
    hasDeviceCredential,
    parear: () => {
      credencial = true;
    },
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const montadas: ReturnType<typeof create>[] = [];
afterEach(async () => {
  while (montadas.length) {
    const tree = montadas.pop()!;
    await act(async () => {
      tree.unmount();
    });
  }
});

async function mount(s: ReturnType<typeof setup>, props: TelemetryUploadOptions) {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(createElement(s.Probe, props));
    await flush();
  });
  montadas.push(tree);
  const update = async (next: TelemetryUploadOptions) => {
    await act(async () => {
      tree.update(createElement(s.Probe, next));
      await flush();
    });
  };
  return { update };
}

describe('useTelemetryUpload, liga e desliga', () => {
  it('desligado não consulta o chaveiro, não drena e não envia', async () => {
    const s = setup(true);
    await mount(s, { enabled: false });
    expect(s.last().paired).toBe(false);
    expect(s.hasDeviceCredential).not.toHaveBeenCalled();
    expect(s.run).not.toHaveBeenCalled();
    expect(s.uploadPending).not.toHaveBeenCalled();
  });

  it('ligar depois (o login) lê a credencial e começa a enviar', async () => {
    const s = setup(true);
    const { update } = await mount(s, { enabled: false });
    await update({ enabled: true });
    expect(s.last().paired).toBe(true);
    expect(s.uploadPending).toHaveBeenCalledTimes(1);
  });

  it('desligar (o logout) para o envio e volta a não pareado', async () => {
    const s = setup(true);
    const { update } = await mount(s, { enabled: true });
    expect(s.uploadPending).toHaveBeenCalledTimes(1);
    await update({ enabled: false });
    expect(s.last().paired).toBe(false);
  });

  // Sem credencial o arquivo durável do iPhone fica como está: drenar para a
  // fila sem ter como enviar só trocaria um acúmulo por outro.
  it('sem credencial não drena nem envia', async () => {
    const s = setup(false);
    await mount(s, { enabled: true });
    expect(s.last().paired).toBe(false);
    expect(s.run).not.toHaveBeenCalled();
    expect(s.uploadPending).not.toHaveBeenCalled();
  });
});

describe('useTelemetryUpload, reconferir a credencial', () => {
  it('pareamento concluído liga o envio sem remontar', async () => {
    const s = setup(false);
    const { update } = await mount(s, { enabled: true, recheckKey: 0 });
    expect(s.last().paired).toBe(false);

    s.parear();
    await update({ enabled: true, recheckKey: 1 });

    expect(s.last().paired).toBe(true);
    expect(s.run).toHaveBeenCalledTimes(1);
    expect(s.uploadPending).toHaveBeenCalledTimes(1);
  });

  it('depois do 401 fica parado até parear de novo', async () => {
    const s = setup(true);
    s.uploadPending.mockResolvedValueOnce({ outcome: 'unpaired' });
    const { update } = await mount(s, { enabled: true, recheckKey: 0 });
    expect(s.last().paired).toBe(false);
    expect(s.uploadPending).toHaveBeenCalledTimes(1);

    s.parear();
    await update({ enabled: true, recheckKey: 1 });

    expect(s.last().paired).toBe(true);
    expect(s.uploadPending).toHaveBeenCalledTimes(2);
  });

  it('a mesma chave não relê o chaveiro a cada render', async () => {
    const s = setup(true);
    const { update } = await mount(s, { enabled: true, recheckKey: 3 });
    const leituras = s.hasDeviceCredential.mock.calls.length;
    await update({ enabled: true, recheckKey: 3 });
    expect(s.hasDeviceCredential.mock.calls.length).toBe(leituras);
  });
});
