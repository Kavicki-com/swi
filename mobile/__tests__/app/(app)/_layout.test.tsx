import { act, create } from 'react-test-renderer';
import { Redirect, Stack } from 'expo-router';
import AppLayout from '../../../app/(app)/_layout';

jest.mock('expo-router', () => ({
  Redirect: jest.fn(() => null),
  Stack: jest.fn(() => null),
}));

const mockUseAuth = jest.fn();
jest.mock('../../../services/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../../../services/journey/JourneyProvider', () => ({
  JourneyProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../../services/evacuation/EvacuationProvider', () => ({
  EvacuationProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../../services/notifications/NotificationProvider', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const render = () => {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<AppLayout />);
  });
  return tree;
};

const achados = (tree: ReturnType<typeof create>, C: unknown) =>
  tree.root.findAllByType(C as React.ComponentType);

describe('(app)/_layout — auth gate com sessão persistida', () => {
  it('não derruba deep-link pro login enquanto a sessão restaura', () => {
    mockUseAuth.mockReturnValue({ user: null, restoring: true });
    const tree = render();
    expect(achados(tree, Redirect)).toHaveLength(0);
    expect(achados(tree, Stack)).toHaveLength(0);
  });

  it('sem sessão redireciona pro login', () => {
    mockUseAuth.mockReturnValue({ user: null, restoring: false });
    const tree = render();
    expect(achados(tree, Redirect)[0].props.href).toBe('/(auth)/login');
  });

  it('com sessão renderiza o Stack autenticado', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
    const tree = render();
    expect(achados(tree, Stack)).toHaveLength(1);
    expect(achados(tree, Redirect)).toHaveLength(0);
  });
});
