import { act, create } from 'react-test-renderer';
import { Redirect } from 'expo-router';
import Index from '../../app/index';

jest.mock('expo-router', () => ({
  Redirect: jest.fn(() => null),
}));

const mockUseAuth = jest.fn();
jest.mock('../../services/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

const render = () => {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<Index />);
  });
  return tree;
};

const redirects = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType(Redirect as unknown as React.ComponentType);

describe('index — rota inicial com sessão persistida', () => {
  it('não decide rota enquanto a sessão restaura', () => {
    mockUseAuth.mockReturnValue({ user: null, restoring: true });
    expect(redirects(render())).toHaveLength(0);
  });

  it('cai no dashboard quando a sessão foi restaurada', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
    expect(redirects(render())[0].props.href).toBe('/(app)/dashboard');
  });

  it('cai no login quando não há sessão', () => {
    mockUseAuth.mockReturnValue({ user: null, restoring: false });
    expect(redirects(render())[0].props.href).toBe('/(auth)/login');
  });
});
