import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { ProfileProvider, useProfile } from './ProfileProvider';
import { getProfileBackend } from './getProfileBackend';
import { useAuth } from '../auth/AuthProvider';

jest.mock('./getProfileBackend', () => ({ getProfileBackend: jest.fn() }));
jest.mock('../auth/AuthProvider', () => ({ useAuth: jest.fn() }));

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
    // O bug: o provider só enchia se a TELA chamasse loadProfile(), e só as de
    // settings chamavam, então jornada/dashboard/my-stats renderizavam sem
    // perfil e caíam no PNG de estoque + nome de outra pessoa.
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
