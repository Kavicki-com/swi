import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import EmailSent from '../../../app/(auth)/email-sent';
import PasswordRecoveryEmailSent from '../../../app/(auth)/password-recovery/email-sent';

// Os dois avisos de e-mail enviado. O fluxo é por CÓDIGO (o e-mail traz um
// código que a pessoa digita), então nenhum dos dois pode mandar "clicar no
// link".

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ email: 'pessoa@example.test' }),
}));

jest.mock('../../../services/auth/AuthProvider', () => ({
  useAuth: () => ({ confirmSignUp: jest.fn(), resendConfirmation: jest.fn() }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const textoDa = async (Tela: () => React.JSX.Element) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <Tela />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  const json = JSON.stringify(tree.toJSON());
  act(() => tree.unmount());
  return json;
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('Cadastro: e-mail de confirmação enviado', () => {
  it('pede para digitar o código abaixo, não para clicar no link', async () => {
    const texto = await textoDa(EmailSent);

    expect(texto).toContain('pessoa@example.test');
    expect(texto).toContain(
      'acesse sua caixa de entrada e digite abaixo o código para confirmar a sua conta.',
    );
    expect(texto).not.toContain('clique no link');
  });
});

describe('Recuperar senha: e-mail enviado', () => {
  it('tem o título "Confira seu email"', async () => {
    const texto = await textoDa(PasswordRecoveryEmailSent);

    expect(texto).toContain('Confira seu email');
    expect(texto).not.toContain('Acesse o link de recuperação');
  });

  it('pede para usar o código e criar uma nova senha', async () => {
    const texto = await textoDa(PasswordRecoveryEmailSent);

    expect(texto).toContain('pessoa@example.test');
    expect(texto).toContain(
      'acesse sua caixa de entrada e use o código para criar uma nova senha.',
    );
    expect(texto).not.toContain('clique no link');
    expect(texto).not.toContain('confirmar a sua conta');
  });
});
