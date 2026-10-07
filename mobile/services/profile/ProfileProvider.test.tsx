import { act, create } from 'react-test-renderer';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { ProfileProvider, useProfile } from './ProfileProvider';
import { getProfileBackend } from './getProfileBackend';
import { useAuth } from '../auth/AuthProvider';

jest.mock('./getProfileBackend', () => ({ getProfileBackend: jest.fn() }));
jest.mock('../auth/AuthProvider', () => ({ useAuth: jest.fn() }));

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
let appState: ((s: AppStateStatus) => void) | null = null;

const mockUseAuth = useAuth as jest.Mock;
const mockGetBackend = getProfileBackend as jest.Mock;

const get = jest.fn();
const save = jest.fn();

function Probe() {
  const { profile } = useProfile();
  return <Text>{profile?.fullName ?? 'SEM-PERFIL'}</Text>;
}

const renderWithUser = async (user: { id: string } | null) => {
  mockUseAuth.mockReturnValue({ user });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <ProfileProvider>
        <Probe />
      </ProfileProvider>,
    );
  });
  return tree;
};

describe('ProfileProvider: auto-carga', () => {
  beforeEach(() => {
    get.mockReset();
    save.mockReset();
    mockGetBackend.mockReturnValue({ get, save });
  });

  it('com sessão, busca o perfil sem a tela pedir', async () => {
    // Se o provider dependesse de a TELA chamar loadProfile(), jornada,
    // dashboard e my-stats renderizariam sem perfil e cairiam no PNG de
    // estoque com nome de outra pessoa.
    get.mockResolvedValue({ fullName: 'Gabriel De Souza Fernandes' });
    const tree = await renderWithUser({ id: 'u1' });
    expect(get).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tree.toJSON())).toContain('Gabriel De Souza Fernandes');
  });

  it('sem sessão, não bate na API (o wizard roda pré-login)', async () => {
    const tree = await renderWithUser(null);
    expect(get).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('SEM-PERFIL');
  });

  it('erro na carga não derruba a árvore (perfil vazio responde 404)', async () => {
    const err = new Error('Not Found');
    (err as any).status = 404;
    get.mockRejectedValue(err);
    const tree = await renderWithUser({ id: 'u1' });
    expect(JSON.stringify(tree.toJSON())).toContain('SEM-PERFIL');
  });
});

// O app aberto sem sinal entra pela cópia da sessão e o perfil falha. Sem
// reler, foto e nome ficariam vazios a sessão inteira, até sair e entrar.
describe('ProfileProvider: releitura depois de falha', () => {
  const semRede = () => new TypeError('Network request failed');
  const texto = (tree: ReturnType<typeof create>) => JSON.stringify(tree.toJSON());

  beforeEach(() => {
    get.mockReset();
    save.mockReset();
    mockGetBackend.mockReturnValue({ get, save });
    mockReconnect = null;
    appState = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      cb: (s: AppStateStatus) => void,
    ) => {
      appState = cb;
      return { remove: () => { appState = null; } };
    }) as unknown as typeof AppState.addEventListener);
  });
  afterEach(() => jest.restoreAllMocks());

  it('relê quando a conexão volta', async () => {
    get.mockRejectedValueOnce(semRede()).mockResolvedValue({ fullName: 'Ana Souza' });
    const tree = await renderWithUser({ id: 'u1' });
    expect(texto(tree)).toContain('SEM-PERFIL');

    await act(async () => mockReconnect?.());

    expect(get).toHaveBeenCalledTimes(2);
    expect(texto(tree)).toContain('Ana Souza');
  });

  it('relê ao voltar ao primeiro plano', async () => {
    get.mockRejectedValueOnce(semRede()).mockResolvedValue({ fullName: 'Ana Souza' });
    const tree = await renderWithUser({ id: 'u1' });

    await act(async () => appState?.('active'));

    expect(texto(tree)).toContain('Ana Souza');
  });

  it('falhando de novo, tenta no gatilho seguinte', async () => {
    get.mockRejectedValueOnce(semRede()).mockRejectedValueOnce(semRede()).mockResolvedValue({ fullName: 'Ana' });
    const tree = await renderWithUser({ id: 'u1' });

    await act(async () => mockReconnect?.());
    await act(async () => appState?.('active'));

    expect(get).toHaveBeenCalledTimes(3);
    expect(texto(tree)).toContain('Ana');
  });

  it('perfil ainda não preenchido (404) não relê', async () => {
    get.mockResolvedValue(null);
    await renderWithUser({ id: 'u1' });

    await act(async () => mockReconnect?.());
    await act(async () => appState?.('active'));

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('a falha da sessão anterior não relê o perfil de quem entrou depois', async () => {
    get.mockRejectedValueOnce(semRede()).mockResolvedValue({ fullName: 'Bia' });
    const tree = await renderWithUser({ id: 'u1' });
    mockUseAuth.mockReturnValue({ user: { id: 'u2' } });
    await act(async () => {
      tree.update(
        <ProfileProvider>
          <Probe />
        </ProfileProvider>,
      );
    });
    expect(get).toHaveBeenCalledTimes(2);

    await act(async () => mockReconnect?.());

    expect(get).toHaveBeenCalledTimes(2);
  });

  it('perfil carregado não relê', async () => {
    get.mockResolvedValue({ fullName: 'Ana' });
    await renderWithUser({ id: 'u1' });

    await act(async () => mockReconnect?.());
    await act(async () => appState?.('active'));

    expect(get).toHaveBeenCalledTimes(1);
  });
});
