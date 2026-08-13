import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { AuthProvider, useAuth } from './AuthProvider';

const mockGetCurrentUser = jest.fn();
jest.mock('./getAuthBackend', () => ({
  getAuthBackend: () => ({ getCurrentUser: () => mockGetCurrentUser() }),
}));

// Sonda mínima: expõe o estado do hook como texto pra asserção.
function Probe() {
  const { user, restoring } = useAuth();
  return <Text>{`${restoring ? 'restoring' : 'ready'}:${user?.email ?? 'anon'}`}</Text>;
}

const textoDa = (tree: ReturnType<typeof create>) =>
  tree.root.findByType(Text).props.children as string;

beforeEach(() => mockGetCurrentUser.mockReset());

describe('AuthProvider — restauração de sessão no cold start', () => {
  it('começa restaurando, sem usuário', () => {
    mockGetCurrentUser.mockReturnValue(new Promise(() => {}));
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<AuthProvider><Probe /></AuthProvider>);
    });
    expect(textoDa(tree)).toBe('restoring:anon');
  });

  it('restaura o usuário guardado e termina o restoring', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'j@ex.com', name: 'J' });
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<AuthProvider><Probe /></AuthProvider>);
    });
    expect(textoDa(tree)).toBe('ready:j@ex.com');
  });

  it('sem sessão guardada termina o restoring deslogado', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<AuthProvider><Probe /></AuthProvider>);
    });
    expect(textoDa(tree)).toBe('ready:anon');
  });
});
