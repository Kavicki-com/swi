import type { NativeHttpResponse, WatchControl } from '../../modules/swi-watch-control';
import {
  createTelemetryOutbox,
  type OutboxEvent,
  type OutboxStorage,
  type TelemetryOutbox,
} from './telemetryOutbox';
import { createTelemetryUploader, MAX_BATCH_EVENTS, type UploadOutcome } from './telemetryUploader';

const API = 'https://api.exemplo';
const URL_LOTES = `${API}/telemetry/v1/batches`;
const SESSAO_A = '11111111-1111-4111-8111-111111111111';
const SESSAO_B = '22222222-2222-4222-8222-222222222222';

function memoryStorage(): OutboxStorage {
  let text: string | null = null;
  return {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
  };
}

// A fila só aceita UUID, e o teste quer falar em 'e1'. O rótulo vira os
// últimos bytes de um UUID v4 fixo, e volta pelo caminho inverso.
const uid = (label: string) =>
  `00000000-0000-4000-8000-${Buffer.from(label, 'ascii').toString('hex').padStart(12, '0')}`;
const label = (id: string) => Buffer.from(id.slice(-12).replace(/^(00)+/, ''), 'hex').toString('ascii');

function evento(id: string, sessionId = SESSAO_A, sequence = 0): OutboxEvent {
  return {
    eventId: uid(id),
    monitoringSessionId: sessionId,
    sequence,
    eventTime: '2026-09-07T12:00:00.000Z',
    origin: 'REAL',
    measurements: { heartRate: { value: 72, unit: 'bpm', source: 'APPLE_WATCH' } },
  };
}

const muitos = (n: number) => Array.from({ length: n }, (_, i) => evento(`e${i}`, SESSAO_A, i));

// Fila real sobre armazenamento em memória, e não um dublê: o que interessa é
// o que sobra na fila depois de cada resposta, e isso é comportamento da fila.
async function filaCom(...events: OutboxEvent[]): Promise<TelemetryOutbox> {
  const outbox = createTelemetryOutbox(memoryStorage());
  for (const event of events) await outbox.append(event);
  return outbox;
}

const labels = async (outbox: TelemetryOutbox) =>
  (await outbox.pending()).map((e) => label(e.eventId));

function fakeControl(overrides: Partial<WatchControl> = {}) {
  const request = jest.fn<Promise<NativeHttpResponse>, Parameters<WatchControl['request']>>(
    async () => ({ status: 200, body: ack({ accepted: [] }) }),
  );
  const clearDeviceCredential = jest.fn(() => undefined);
  const control: WatchControl = {
    supported: true,
    getStatus: () => null,
    requestAuthorization: async () => true,
    startMonitoring: async () => true,
    subscribe: () => () => undefined,
    request,
    hasDeviceCredential: () => true,
    clearDeviceCredential,
    rotateInbox: () => [],
    ...overrides,
  };
  return { control, request, clearDeviceCredential };
}

// Confirmação do backend (telemetry-ingestion.service.ts, TelemetryBatchAck),
// com os ids em rótulo.
function ack(parts: {
  accepted?: string[];
  duplicates?: string[];
  conflicts?: { eventId: string; reason: string; detail: string }[];
}): string {
  return JSON.stringify({
    acceptedEventIds: (parts.accepted ?? []).map(uid),
    duplicateEventIds: (parts.duplicates ?? []).map(uid),
    conflicts: (parts.conflicts ?? []).map((c) => ({ ...c, eventId: uid(c.eventId) })),
    serverTime: '2026-09-07T12:00:01.000Z',
  });
}

const nestError = (statusCode: number, message: string | string[]) =>
  JSON.stringify({ statusCode, message, error: 'x' });

const rejeicao = (code: string) => Object.assign(new Error(code), { code });

function uploader(outbox: TelemetryOutbox, control: WatchControl) {
  return createTelemetryUploader({ outbox, control, apiUrl: () => API });
}

const sent = (accepted: number, remaining: number, duplicates = 0, conflicts = 0) => ({
  outcome: 'sent',
  accepted,
  duplicates,
  conflicts,
  remaining,
});

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

describe('telemetryUploader, fila vazia', () => {
  it('é idle e não toca a rede', async () => {
    const { control, request } = fakeControl();
    const outbox = await filaCom();
    await expect(uploader(outbox, control).uploadPending()).resolves.toEqual({ outcome: 'idle' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('telemetryUploader, pedido', () => {
  it('manda POST na rota de lotes com a fila inteira, na ordem, em modo device e sem guardar credencial', async () => {
    const { control, request } = fakeControl();
    const outbox = await filaCom(evento('e1'), evento('e2', SESSAO_B), evento('e3', SESSAO_A, 1));
    await uploader(outbox, control).uploadPending();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      URL_LOTES,
      'POST',
      JSON.stringify({
        events: [evento('e1'), evento('e2', SESSAO_B), evento('e3', SESSAO_A, 1)],
      }),
      { kind: 'device' },
      false,
    );
  });

  // O DTO do backend recusa lote acima de MAX_BATCH_EVENTS com 400. Sem este
  // corte, uma fila acumulada num turno sem rede seria recusada inteira na
  // primeira tentativa, e o 400 a esvaziaria.
  it('corta o lote no teto do backend e diz quantos sobraram para a próxima chamada', async () => {
    const { control, request } = fakeControl();
    const todos = muitos(250);
    const outbox = await filaCom(...todos);
    request.mockResolvedValue({
      status: 200,
      body: ack({ accepted: todos.slice(0, MAX_BATCH_EVENTS).map((e) => label(e.eventId)) }),
    });
    await expect(uploader(outbox, control).uploadPending()).resolves.toEqual(
      sent(MAX_BATCH_EVENTS, 50),
    );
    const corpo = JSON.parse(request.mock.calls[0][2] as string) as { events: OutboxEvent[] };
    expect(corpo.events).toHaveLength(MAX_BATCH_EVENTS);
    expect(label(corpo.events[0].eventId)).toBe('e0');
    expect(await labels(outbox)).toHaveLength(50);
    expect((await labels(outbox))[0]).toBe('e200');
  });
});

describe('telemetryUploader, confirmação 2xx', () => {
  it('remove da fila aceitos, repetidos e conflitos, e mantém o que a confirmação não citou', async () => {
    const { control, request } = fakeControl();
    const outbox = await filaCom(evento('e1'), evento('e2'), evento('e3'), evento('e4'));
    request.mockResolvedValue({
      status: 200,
      body: ack({
        accepted: ['e1'],
        duplicates: ['e2'],
        conflicts: [{ eventId: 'e3', reason: 'sequence_conflict', detail: 'sequência 0 já usada' }],
      }),
    });
    await expect(uploader(outbox, control).uploadPending()).resolves.toEqual(sent(1, 1, 1, 1));
    // e4 não foi citado: melhor reenviar do que perder.
    await expect(labels(outbox)).resolves.toEqual(['e4']);
  });

  it('remaining é 0 quando a confirmação citou tudo', async () => {
    const { control, request } = fakeControl();
    const outbox = await filaCom(evento('e1'), evento('e2'));
    request.mockResolvedValue({ status: 200, body: ack({ accepted: ['e1', 'e2'] }) });
    await expect(uploader(outbox, control).uploadPending()).resolves.toEqual(sent(2, 0));
  });

  it('conflito é registrado com o eventId e o motivo', async () => {
    const { control, request } = fakeControl();
    const outbox = await filaCom(evento('e3'));
    request.mockResolvedValue({
      status: 200,
      body: ack({
        conflicts: [{ eventId: 'e3', reason: 'session_unavailable', detail: 'Sessão indisponível' }],
      }),
    });
    await uploader(outbox, control).uploadPending();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(uid('e3'));
    expect(warn.mock.calls[0][0]).toMatch(/session_unavailable/);
  });

  it('2xx que não é a confirmação esperada é deferred, com aviso e fila intacta', async () => {
    const { control, request } = fakeControl();
    const outbox = await filaCom(evento('e1'));
    for (const body of ['<html>', '{}', JSON.stringify({ acceptedEventIds: 'e1' }), '[]']) {
      warn.mockClear();
      request.mockResolvedValue({ status: 200, body });
      await expect(uploader(outbox, control).uploadPending()).resolves.toEqual({
        outcome: 'deferred',
      });
      expect(warn).toHaveBeenCalledTimes(1);
    }
    await expect(labels(outbox)).resolves.toEqual(['e1']);
  });

  it('não chama clearDeviceCredential no caminho feliz', async () => {
    const { control, clearDeviceCredential } = fakeControl();
    const outbox = await filaCom(evento('e1'));
    await uploader(outbox, control).uploadPending();
    expect(clearDeviceCredential).not.toHaveBeenCalled();
  });
});

describe('telemetryUploader, status do backend', () => {
  const respondendo = (status: number, body: string) => {
    const fake = fakeControl();
    fake.request.mockResolvedValue({ status, body });
    return fake;
  };

  // Depois de re-parear, as sessões antigas pertencem ao aparelho revogado e
  // voltariam todas como session_unavailable: um lote de recusas no log a
  // cada re-pareamento. Melhor descartar de uma vez, dizendo quantos.
  it('401 limpa a credencial, esvazia a fila inteira com aviso da contagem e é unpaired', async () => {
    const { control, clearDeviceCredential } = respondendo(401, nestError(401, 'Unauthorized'));
    const outbox = await filaCom(...muitos(203));
    await expect(uploader(outbox, control).uploadPending()).resolves.toEqual({
      outcome: 'unpaired',
    });
    expect(clearDeviceCredential).toHaveBeenCalledTimes(1);
    await expect(labels(outbox)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/203/);
    expect(warn.mock.calls[0][0]).toMatch(/revog/);
  });

  it('401 com chaveiro que falha ao limpar ainda é unpaired', async () => {
    const { control, clearDeviceCredential } = respondendo(401, nestError(401, 'Unauthorized'));
    clearDeviceCredential.mockImplementation(() => {
      throw new Error('chaveiro indisponível');
    });
    const outbox = await filaCom(evento('e1'));
    await expect(uploader(outbox, control).uploadPending()).resolves.toEqual({
      outcome: 'unpaired',
    });
  });

  it.each([429, 500, 502, 503])('%s é deferred com a fila intacta', async (status) => {
    const { control, clearDeviceCredential } = respondendo(status, nestError(status, 'x'));
    const outbox = await filaCom(evento('e1'), evento('e2'));
    await expect(uploader(outbox, control).uploadPending()).resolves.toEqual({
      outcome: 'deferred',
    });
    await expect(labels(outbox)).resolves.toEqual(['e1', 'e2']);
    expect(clearDeviceCredential).not.toHaveBeenCalled();
  });

  it.each([400, 403, 413, 422])('%s é rejected com o status, o lote sai da fila e o corpo vai ao aviso', async (status) => {
    const { control, clearDeviceCredential } = respondendo(status, nestError(status, ['events must contain no more than 200 elements']));
    const outbox = await filaCom(evento('e1'), evento('e2'));
    await expect(uploader(outbox, control).uploadPending()).resolves.toEqual({
      outcome: 'rejected',
      status,
    });
    await expect(labels(outbox)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/no more than 200/);
    expect(clearDeviceCredential).not.toHaveBeenCalled();
  });

  // Só o que foi enviado é descartado: o que ficou atrás do teto nunca foi
  // visto pelo backend e ainda pode ser aceito.
  it('rejected acima do teto esvazia só o lote enviado', async () => {
    const { control } = respondendo(422, '{}');
    const outbox = await filaCom(...muitos(MAX_BATCH_EVENTS + 2));
    await uploader(outbox, control).uploadPending();
    await expect(labels(outbox)).resolves.toEqual(['e200', 'e201']);
  });

  it('status fora de qualquer faixa esperada (3xx) é deferred com aviso', async () => {
    const { control } = respondendo(302, '');
    const outbox = await filaCom(evento('e1'));
    await expect(uploader(outbox, control).uploadPending()).resolves.toEqual({
      outcome: 'deferred',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    await expect(labels(outbox)).resolves.toEqual(['e1']);
  });
});

describe('telemetryUploader, rejeição do nativo', () => {
  const rejeitando = (error: unknown) => {
    const fake = fakeControl();
    fake.request.mockRejectedValue(error);
    return fake;
  };

  it.each<[string, UploadOutcome['outcome'], number]>([
    ['E_NETWORK', 'deferred', 0],
    ['E_KEYCHAIN', 'deferred', 0],
    ['E_NO_CREDENTIAL', 'unpaired', 0],
    ['E_UNSUPPORTED', 'unpaired', 0],
    ['E_URL', 'deferred', 1],
    ['E_CREDENTIAL_MISSING', 'deferred', 1],
  ])('%s vira %s, com %i aviso, fila intacta e sem limpar credencial', async (code, outcome, avisos) => {
    const { control, clearDeviceCredential } = rejeitando(rejeicao(code));
    const outbox = await filaCom(evento('e1'));
    await expect(uploader(outbox, control).uploadPending()).resolves.toEqual({ outcome });
    expect(warn).toHaveBeenCalledTimes(avisos);
    expect(clearDeviceCredential).not.toHaveBeenCalled();
    await expect(labels(outbox)).resolves.toEqual(['e1']);
  });

  it('rejeição sem código é deferred com aviso, sem lançar', async () => {
    const { control } = rejeitando(new Error('qualquer coisa'));
    const outbox = await filaCom(evento('e1'));
    await expect(uploader(outbox, control).uploadPending()).resolves.toEqual({
      outcome: 'deferred',
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('telemetryUploader, reentrância', () => {
  it('envio em curso: a segunda chamada devolve a mesma promessa e a rede é tocada uma vez', async () => {
    const { control, request } = fakeControl();
    let responde!: (r: NativeHttpResponse) => void;
    request.mockImplementation(
      () =>
        new Promise<NativeHttpResponse>((resolve) => {
          responde = resolve;
        }),
    );
    const outbox = await filaCom(evento('e1'));
    const up = uploader(outbox, control);

    const primeira = up.uploadPending();
    const segunda = up.uploadPending();
    expect(segunda).toBe(primeira);

    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    responde({ status: 200, body: ack({ accepted: ['e1'] }) });

    const [r1, r2] = await Promise.all([primeira, segunda]);
    expect(r1).toEqual(sent(1, 0));
    expect(r2).toBe(r1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('depois de terminar, a próxima chamada é um envio novo', async () => {
    const { control, request } = fakeControl();
    const outbox = await filaCom(evento('e1'));
    const up = uploader(outbox, control);
    request.mockResolvedValueOnce({ status: 503, body: '' });
    await expect(up.uploadPending()).resolves.toEqual({ outcome: 'deferred' });
    request.mockResolvedValueOnce({ status: 200, body: ack({ accepted: ['e1'] }) });
    await expect(up.uploadPending()).resolves.toEqual(sent(1, 0));
    expect(request).toHaveBeenCalledTimes(2);
    await expect(labels(outbox)).resolves.toEqual([]);
  });
});
