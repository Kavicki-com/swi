import { AppState, type AppStateStatus } from 'react-native';
import { act, create } from 'react-test-renderer';
import { connectionStatus } from '../realtime/connectionStatus';
import { NotificationProvider, useNotifications } from './NotificationProvider';
import type { AppNotification } from './types';

// Backend de mentira: cada leitura da lista fica pendurada até o teste
// responder, para dar para mexer na tela enquanto a resposta vem.
type Deferred = { resolve: (ns: AppNotification[]) => void; reject: (e: Error) => void };
const leituras: Deferred[] = [];
let entregar: ((n: AppNotification) => void) | null = null;
const mockBackend = {
  myId: 'me',
  listNotifications: jest.fn(
    () =>
      new Promise<AppNotification[]>((resolve, reject) => {
        leituras.push({ resolve, reject });
      }),
  ),
  markRead: jest.fn(async () => undefined),
  markAllRead: jest.fn(async () => undefined),
  registerPushToken: jest.fn(async () => undefined),
  subscribe: jest.fn((cb: (n: AppNotification) => void) => {
    entregar = cb;
    return () => {
      entregar = null;
    };
  }),
};
jest.mock('./getNotificationBackend', () => ({ getNotificationBackend: () => mockBackend }));

const notif = (id: string, createdAt: string, read = false): AppNotification => ({
  id,
  title: `t-${id}`,
  body: '',
  domain: 'journey',
  targetId: null,
  read,
  createdAt,
});
const A = notif('a', '2026-10-05T10:00:00.000Z');
const B = notif('b', '2026-10-05T11:00:00.000Z');
const C = notif('c', '2026-10-05T12:00:00.000Z');

type Ctx = ReturnType<typeof useNotifications>;
let ctx!: Ctx;
const statuses: string[] = [];
function Probe() {
  ctx = useNotifications();
  statuses.push(ctx.loadStatus);
  return null;
}

let appStateHandler: ((status: AppStateStatus) => void) | null = null;
const montadas: ReturnType<typeof create>[] = [];
const unwatches: (() => void)[] = [];

function montar() {
  act(() => {
    montadas.push(
      create(
        <NotificationProvider>
          <Probe />
        </NotificationProvider>,
      ),
    );
  });
}

// Responde a leitura `i` (na ordem em que saíram).
async function responder(i: number, ns: AppNotification[]) {
  await act(async () => {
    leituras[i].resolve(ns);
  });
}
async function falhar(i: number) {
  await act(async () => {
    leituras[i].reject(new Error('sem sinal'));
  });
}

// Socket de mentira registrado no armazém de verdade: cair e voltar dispara
// a releitura de quem ouve a volta.
function socketQueVolta() {
  const handlers = new Map<string, (reason?: unknown) => void>();
  const socket = {
    on: (event: string, h: (reason?: unknown) => void) => handlers.set(event, h),
    off: (event: string) => handlers.delete(event),
  };
  unwatches.push(connectionStatus.watch(socket));
  handlers.get('connect')?.();
  return () => {
    act(() => {
      handlers.get('disconnect')?.('transport close');
      handlers.get('connect')?.();
    });
  };
}

beforeEach(() => {
  leituras.length = 0;
  statuses.length = 0;
  entregar = null;
  jest.clearAllMocks();
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler as (status: AppStateStatus) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  act(() => {
    for (const tree of montadas.splice(0)) tree.unmount();
    for (const unwatch of unwatches.splice(0)) unwatch();
  });
  jest.restoreAllMocks();
});

it('a conexão que volta relê a lista sem passar por "carregando"', async () => {
  const reconectar = socketQueVolta();
  montar();
  await responder(0, [A]);
  statuses.length = 0;

  reconectar();
  expect(mockBackend.listNotifications).toHaveBeenCalledTimes(2);
  await responder(1, [B, A]);

  expect(ctx.notifications.map((n) => n.id)).toEqual(['b', 'a']);
  expect(statuses).not.toContain('loading');
});

it('a volta ao primeiro plano relê a lista em silêncio', async () => {
  montar();
  await responder(0, [A]);
  statuses.length = 0;

  act(() => appStateHandler?.('active'));
  expect(mockBackend.listNotifications).toHaveBeenCalledTimes(2);
  await responder(1, [B, A]);

  expect(ctx.notifications.map((n) => n.id)).toEqual(['b', 'a']);
  expect(statuses).not.toContain('loading');
});

it('ir para o segundo plano não relê', async () => {
  montar();
  await responder(0, [A]);
  act(() => appStateHandler?.('background'));
  expect(mockBackend.listNotifications).toHaveBeenCalledTimes(1);
});

it('releitura silenciosa que falha mantém a lista e o estado', async () => {
  const reconectar = socketQueVolta();
  montar();
  await responder(0, [A]);

  reconectar();
  await falhar(1);

  expect(ctx.notifications).toEqual([A]);
  expect(ctx.loadStatus).toBe('ready');
});

it('releitura que acerta depois de a primeira leitura falhar tira a tela do erro', async () => {
  const reconectar = socketQueVolta();
  montar();
  await falhar(0);
  expect(ctx.loadStatus).toBe('error');

  reconectar();
  await responder(1, [A]);
  expect(ctx.loadStatus).toBe('ready');
  expect(ctx.notifications).toEqual([A]);
});

describe('o que acontece enquanto a releitura vem', () => {
  it('notificação que chega pelo socket não some com a resposta', async () => {
    const reconectar = socketQueVolta();
    montar();
    await responder(0, [A]);

    reconectar();
    act(() => entregar?.(C));
    await responder(1, [B, A]);

    expect(ctx.notifications.map((n) => n.id)).toEqual(['c', 'b', 'a']);
  });

  it('notificação lida na tela não volta a não lida', async () => {
    const reconectar = socketQueVolta();
    montar();
    await responder(0, [A, B]);

    reconectar();
    await act(async () => ctx.markRead('a'));
    await responder(1, [B, A]);

    expect(ctx.notifications.find((n) => n.id === 'a')?.read).toBe(true);
    expect(ctx.unreadCount).toBe(1);
  });

  it('"marcar todas" vale para as que estavam na tela, não para a que chegou depois', async () => {
    const reconectar = socketQueVolta();
    montar();
    await responder(0, [B, A]);

    reconectar();
    await act(async () => ctx.markAllRead());
    act(() => entregar?.(C));
    await responder(1, [B, A]);

    expect(ctx.notifications.map((n) => [n.id, n.read])).toEqual([
      ['c', false],
      ['b', true],
      ['a', true],
    ]);
  });

  // A releitura que sai depois do toque pode ser atendida antes de o servidor
  // gravar o "lida".
  it('lida com o pedido ainda indo ao servidor não volta a não lida', async () => {
    const reconectar = socketQueVolta();
    let gravar!: () => void;
    mockBackend.markRead.mockReturnValueOnce(new Promise<undefined>((r) => (gravar = () => r(undefined))));
    montar();
    await responder(0, [A, B]);

    act(() => {
      void ctx.markRead('a');
    });
    reconectar();
    await responder(1, [B, A]);

    expect(ctx.notifications.find((n) => n.id === 'a')?.read).toBe(true);
    await act(async () => gravar());
  });

  it('lida cujo pedido falhou volta ao que o servidor tem na releitura seguinte', async () => {
    const reconectar = socketQueVolta();
    mockBackend.markRead.mockRejectedValueOnce(new Error('sem sinal'));
    montar();
    await responder(0, [A, B]);

    await act(async () => ctx.markRead('a'));
    reconectar();
    await responder(1, [B, A]);

    expect(ctx.notifications.find((n) => n.id === 'a')?.read).toBe(false);
  });

  it('resposta de uma releitura mais antiga que chega depois da mais nova é descartada', async () => {
    const reconectar = socketQueVolta();
    montar();
    await responder(0, [A]);

    reconectar();
    reconectar();
    await responder(2, [C, B, A]);
    await responder(1, [A]);

    expect(ctx.notifications.map((n) => n.id)).toEqual(['c', 'b', 'a']);
  });
});
