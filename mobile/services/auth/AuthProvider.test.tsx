import { act, create } from 'react-test-renderer';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { AuthProvider, RESTORE_WAIT_MS, useAuth } from './AuthProvider';
import { CONFIRM_RETRY_MS } from './sessionKeeper';
import { notifyUnauthorized } from '../api/unauthorized';
import type { SessionCheck, StoredSession, User } from './types';

const mockBackend = {
  confirmSession: jest.fn<Promise<SessionCheck>, []>(),
  restoreSession: jest.fn<Promise<StoredSession | null>, []>(),
  signIn: jest.fn<Promise<User>, [unknown]>(),
  signOut: jest.fn(async () => undefined),
};
jest.mock('./getAuthBackend', () => ({ getAuthBackend: () => mockBackend }));

const mockClearJourney = jest.fn(async () => undefined);
jest.mock('../journey/journeyCache', () => ({
  getJourneyCache: () => ({ clear: mockClearJourney }),
}));

let mockReconnect: (() => void) | null = null;
jest.mock('../realtime/connectionStatus', () => ({
  connectionStatus: {
    onReconnect: (listener: () => void) => {
      mockReconnect = listener;
      return () => {
        mockReconnect = null;
      };
    },
  },
}));

const ana: User = { id: 'u1', email: 'ana@ex.com', name: 'Ana' };
const copia: StoredSession = { user: ana, confirmedAt: '2026-10-07T12:00:00.000Z' };

// Confirmações no ar, respondidas pelo teste na ordem em que saíram.
let answers: ((check: SessionCheck) => void)[] = [];
const noAr = () => new Promise<SessionCheck>((resolve) => { answers.push(resolve); });

let appState: ((s: AppStateStatus) => void) | null = null;

// Sonda: expõe o estado do hook como texto e guarda a API para os testes.
let auth!: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  const { user, restoring, sessionEnded, resumed } = auth;
  return (
    <Text>
      {`${restoring ? 'restoring' : 'ready'}:${user?.name ?? 'anon'}${sessionEnded ? ':ended' : ''}${resumed ? ':resumed' : ''}`}
    </Text>
  );
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });

// Árvores montadas no teste, desmontadas no fim: montadas, seguiriam ouvindo
// o aviso de 401, que é do módulo inteiro.
let trees: ReturnType<typeof create>[] = [];

async function render() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<AuthProvider><Probe /></AuthProvider>);
  });
  trees.push(tree);
  await flush();
  return tree;
}

const texto = (tree: ReturnType<typeof create>) => tree.root.findByType(Text).props.children as string;

async function responder(check: SessionCheck) {
  const resolve = answers.shift();
  if (!resolve) throw new Error('nenhuma confirmação no ar');
  resolve(check);
  await flush();
}

async function avançar(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  answers = [];
  mockReconnect = null;
  appState = null;
  jest.clearAllMocks();
  mockBackend.confirmSession.mockImplementation(noAr);
  mockBackend.restoreSession.mockResolvedValue(null);
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    cb: (s: AppStateStatus) => void,
  ) => {
    appState = cb;
    return { remove: () => { appState = null; } };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => {
  act(() => {
    trees.forEach((tree) => tree.unmount());
  });
  trees = [];
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('AuthProvider, abertura', () => {
  it('começa restaurando, sem usuário', async () => {
    const tree = await render();
    expect(texto(tree)).toBe('restoring:anon');
  });

  it('com sinal, entra pela confirmação do servidor', async () => {
    const tree = await render();

    await responder({ status: 'valid', user: ana });

    expect(texto(tree)).toBe('ready:Ana');
    expect(mockBackend.restoreSession).not.toHaveBeenCalled();
  });

  it('sem rede, entra pela cópia da sessão', async () => {
    mockBackend.restoreSession.mockResolvedValue(copia);
    const tree = await render();

    await responder({ status: 'unreachable' });

    expect(texto(tree)).toBe('ready:Ana');
  });

  it('servidor sem resposta em 3 s: entra pela cópia, e a resposta que chega depois vale', async () => {
    mockBackend.restoreSession.mockResolvedValue(copia);
    const tree = await render();

    await avançar(RESTORE_WAIT_MS);
    expect(RESTORE_WAIT_MS).toBe(3_000);
    expect(texto(tree)).toBe('ready:Ana');

    await responder({ status: 'valid', user: { ...ana, name: 'Ana Souza' } });
    expect(texto(tree)).toBe('ready:Ana Souza');
  });

  it('sem cópia válida, cai no login', async () => {
    const tree = await render();

    await responder({ status: 'unreachable' });

    expect(texto(tree)).toBe('ready:anon');
  });

  it('401 na abertura vai ao login com o aviso, sem passar pela cópia', async () => {
    mockBackend.restoreSession.mockResolvedValue(copia);
    const tree = await render();

    await responder({ status: 'revoked' });

    expect(texto(tree)).toBe('ready:anon:ended');
    expect(mockBackend.restoreSession).not.toHaveBeenCalled();
    expect(mockClearJourney).toHaveBeenCalled();
  });

  it('sem token, login sem aviso', async () => {
    const tree = await render();

    await responder({ status: 'none' });

    expect(texto(tree)).toBe('ready:anon');
  });
});

describe('AuthProvider, confirmação depois de abrir pela cópia', () => {
  async function abertaPelaCopia() {
    mockBackend.restoreSession.mockResolvedValue(copia);
    const tree = await render();
    await responder({ status: 'unreachable' });
    expect(texto(tree)).toBe('ready:Ana');
    return tree;
  }

  it('confirma quando a conexão volta', async () => {
    const tree = await abertaPelaCopia();

    await act(async () => mockReconnect?.());
    await responder({ status: 'valid', user: ana });

    expect(mockBackend.confirmSession).toHaveBeenCalledTimes(2);
    expect(texto(tree)).toBe('ready:Ana');
  });

  it('confirma ao voltar ao primeiro plano', async () => {
    await abertaPelaCopia();

    await act(async () => appState?.('active'));

    expect(mockBackend.confirmSession).toHaveBeenCalledTimes(2);
  });

  it('tenta sozinha a cada 30 s', async () => {
    await abertaPelaCopia();

    await avançar(CONFIRM_RETRY_MS);

    expect(mockBackend.confirmSession).toHaveBeenCalledTimes(2);
  });

  it('confirmação com 401 tira a pessoa da sessão, apaga a cópia da jornada e avisa', async () => {
    const tree = await abertaPelaCopia();

    await act(async () => mockReconnect?.());
    await responder({ status: 'revoked' });

    expect(texto(tree)).toBe('ready:anon:ended');
    expect(mockClearJourney).toHaveBeenCalled();
  });

  it('confirmação de outra pessoa encerra a sessão', async () => {
    const tree = await abertaPelaCopia();

    await act(async () => mockReconnect?.());
    await responder({ status: 'valid', user: { id: 'u2', email: 'bia@ex.com', name: 'Bia' } });

    expect(texto(tree)).toBe('ready:anon:ended');
    expect(mockBackend.signOut).toHaveBeenCalled();
  });
});

describe('AuthProvider, sessão confirmada', () => {
  async function confirmada() {
    const tree = await render();
    await responder({ status: 'valid', user: ana });
    return tree;
  }

  it('não pergunta de novo ao voltar ao primeiro plano nem quando a conexão volta', async () => {
    await confirmada();

    await act(async () => appState?.('active'));
    await act(async () => mockReconnect?.());
    await avançar(CONFIRM_RETRY_MS * 2);

    expect(mockBackend.confirmSession).toHaveBeenCalledTimes(1);
  });

  it('um 401 de outra chamada confirma, e a sessão fica se o servidor disser que vale', async () => {
    const tree = await confirmada();

    await act(async () => notifyUnauthorized());
    await responder({ status: 'valid', user: ana });

    expect(mockBackend.confirmSession).toHaveBeenCalledTimes(2);
    expect(texto(tree)).toBe('ready:Ana');
  });

  it('um 401 de outra chamada com a sessão revogada tira a pessoa', async () => {
    const tree = await confirmada();

    await act(async () => notifyUnauthorized());
    await responder({ status: 'revoked' });

    expect(texto(tree)).toBe('ready:anon:ended');
  });

  it('signOut sai da sessão mesmo se o backend falhar', async () => {
    const tree = await confirmada();
    mockBackend.signOut.mockRejectedValueOnce(new Error('keychain'));

    await act(async () => {
      await auth.signOut().catch(() => undefined);
    });

    expect(texto(tree)).toBe('ready:anon');
    expect(mockClearJourney).toHaveBeenCalled();
  });

  it('signOut apaga a cópia da jornada e para de confirmar', async () => {
    const tree = await confirmada();

    await act(async () => auth.signOut());
    await act(async () => notifyUnauthorized());

    expect(texto(tree)).toBe('ready:anon');
    expect(mockBackend.signOut).toHaveBeenCalled();
    expect(mockClearJourney).toHaveBeenCalled();
    expect(mockBackend.confirmSession).toHaveBeenCalledTimes(1);
  });
});

describe('AuthProvider, retomada na tela de login', () => {
  async function noLoginComToken() {
    const tree = await render();
    await responder({ status: 'unreachable' });
    expect(texto(tree)).toBe('ready:anon');
    return tree;
  }

  it('sem cópia, quando o servidor confirma, entra sozinha e marca a retomada', async () => {
    const tree = await noLoginComToken();

    await avançar(CONFIRM_RETRY_MS);
    await responder({ status: 'valid', user: ana });

    expect(texto(tree)).toBe('ready:Ana:resumed');
  });

  it('tenta de novo ao voltar ao primeiro plano', async () => {
    await noLoginComToken();

    await act(async () => appState?.('active'));

    expect(mockBackend.confirmSession).toHaveBeenCalledTimes(2);
  });

  it('para de tentar quando a pessoa começa a digitar', async () => {
    await noLoginComToken();

    await act(async () => auth.stopResume());
    await avançar(CONFIRM_RETRY_MS * 2);
    await act(async () => appState?.('active'));

    expect(mockBackend.confirmSession).toHaveBeenCalledTimes(1);
  });

  it('a resposta que passou dos 3 s também retoma', async () => {
    const tree = await render();

    await avançar(RESTORE_WAIT_MS);
    expect(texto(tree)).toBe('ready:anon');
    await responder({ status: 'valid', user: ana });

    expect(texto(tree)).toBe('ready:Ana:resumed');
  });
});

describe('AuthProvider, login', () => {
  it('signIn abre a sessão confirmada e tira o aviso', async () => {
    const tree = await render();
    await responder({ status: 'revoked' });
    expect(texto(tree)).toBe('ready:anon:ended');
    mockBackend.signIn.mockResolvedValue(ana);

    await act(async () => {
      await auth.signIn({ email: 'ana@ex.com', password: 'x' });
    });

    expect(texto(tree)).toBe('ready:Ana');
    await act(async () => appState?.('active'));
    expect(mockBackend.confirmSession).toHaveBeenCalledTimes(1);
  });

  it('fechar o aviso esconde', async () => {
    const tree = await render();
    await responder({ status: 'revoked' });

    await act(async () => auth.dismissSessionEnded());

    expect(texto(tree)).toBe('ready:anon');
  });
});
