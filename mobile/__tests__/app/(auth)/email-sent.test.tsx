import { act, create } from 'react-test-renderer';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import EmailSent from '../../../app/(auth)/email-sent';
import { useAuth } from '../../../services/auth/AuthProvider';
import * as featureFlags from '../../../lib/featureFlags';

// Tela do fim do cadastro: avisa que o e-mail de confirmação saiu e, no backend
// real, recebe o código digitado.
//
// AUTH_BACKEND é const de MÓDULO, resolvida na importação a partir do env. Em
// teste ela vale 'mock', e era isso que deixava metade da tela inalcançável: o
// campo de código e os dois botões só existem no modo 'api'.
//
// A troca é por ESCRITA no objeto de exports, não por jest.mock: o babel emite
// `export const` como propriedade GRAVÁVEL, e a tela lê o valor a cada render.
// Um factory com `{ ...requireActual, get AUTH_BACKEND() {} }` não serve, o
// getter se perde no spread e a propriedade chega undefined (medido). E
// resetModules traria outro React, quebrando os hooks da árvore.
const flags = featureFlags as unknown as { AUTH_BACKEND: 'mock' | 'api' };
const usarBackend = (valor: 'mock' | 'api') => {
  flags.AUTH_BACKEND = valor;
};

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, push: jest.fn(), back: jest.fn() };
let mockParams: { email?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../../../services/auth/AuthProvider', () => ({ useAuth: jest.fn() }));

const mockUseAuth = useAuth as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const CONFIRMACAO = '/(auth)/account-confirmation';

let confirmSignUp: jest.Mock;
let resendConfirmation: jest.Mock;

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <EmailSent />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const botao = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onPress === 'function')[0];

const campoDoCodigo = (tree: ReturnType<typeof create>) =>
  tree.root.findAll(
    (n) => n.props?.label === 'Código de confirmação' && typeof n.props?.onChangeText === 'function',
  )[0];

const texto = (tree: ReturnType<typeof create>) => JSON.stringify(tree.toJSON());

const avancar = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

const alertas = () => (Alert.alert as jest.Mock).mock.calls;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  usarBackend('mock');
  mockParams = {};
  mockReplace.mockReset();
  confirmSignUp = jest.fn().mockResolvedValue(undefined);
  resendConfirmation = jest.fn().mockResolvedValue(undefined);
  mockUseAuth.mockReturnValue({ confirmSignUp, resendConfirmation });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('EmailSent, qual endereço a tela mostra', () => {
  it('com o e-mail na rota, mostra o endereço da pessoa', async () => {
    mockParams = { email: 'fulana@empresa.com' };

    const tree = await render();

    expect(texto(tree)).toContain('fulana@empresa.com');
  });

  // Discriminante do lado esquerdo do `&&`: sem param nenhum a tela precisa de
  // um endereço de exemplo, senão o texto ficaria pela metade.
  it('sem e-mail na rota, cai no endereço de exemplo', async () => {
    const tree = await render();

    expect(texto(tree)).toContain('nomedousuario@email.com');
  });

  // Discriminante do lado direito: string vazia é param PRESENTE, e sem o teste
  // de comprimento a tela anunciaria "Enviamos um email para " e mais nada.
  it('e-mail vazio na rota também cai no endereço de exemplo', async () => {
    mockParams = { email: '' };

    const tree = await render();

    expect(texto(tree)).toContain('nomedousuario@email.com');
  });
});

describe('EmailSent, avanço automático do modo mock', () => {
  it('depois de 4s a tela fecha o fluxo sozinha', async () => {
    await render();

    await avancar(3999);
    expect(mockReplace).not.toHaveBeenCalled();

    await avancar(1);
    expect(mockReplace).toHaveBeenCalledWith(CONFIRMACAO);
  });

  it('sair antes dos 4s cancela o avanço', async () => {
    const agendar = jest.spyOn(globalThis, 'setTimeout');
    const cancelar = jest.spyOn(globalThis, 'clearTimeout');

    const tree = await render();
    const idsDoAvanco = agendar.mock.calls
      .map((args, i) => (args[1] === 4000 ? agendar.mock.results[i].value : undefined))
      .filter((v) => v !== undefined);
    expect(idsDoAvanco).toHaveLength(1);

    await act(async () => {
      tree.unmount();
    });
    expect(cancelar).toHaveBeenCalledWith(idsDoAvanco[0]);

    // A prova que importa: sem o cancelamento, o timer sobrevive à tela e joga
    // quem já saiu de volta pra confirmação.
    await avancar(5000);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('no modo mock não existe campo de código: quem confirma é o link do e-mail', async () => {
    const tree = await render();

    expect(campoDoCodigo(tree)).toBeUndefined();
    expect(botao(tree, 'Reenviar código')).toBeUndefined();
  });
});

describe('EmailSent, modo api', () => {
  beforeEach(() => {
    usarBackend('api');
    mockParams = { email: 'fulana@empresa.com' };
  });

  // No backend real ninguém clica em link nenhum: a pessoa digita o código. Um
  // avanço automático aqui tiraria a tela debaixo dela no meio da digitação.
  it('a tela não avança sozinha, por mais que o tempo corra', async () => {
    await render();

    await avancar(10000);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('oferece o campo de código e os dois botões', async () => {
    const tree = await render();

    expect(campoDoCodigo(tree)).toBeDefined();
    expect(botao(tree, 'Confirmar conta')).toBeDefined();
    expect(botao(tree, 'Reenviar código')).toBeDefined();
  });

  it('confirmar manda o código digitado junto do e-mail e fecha o fluxo', async () => {
    const tree = await render();
    await act(async () => {
      campoDoCodigo(tree).props.onChangeText('123456');
    });

    await act(async () => {
      await botao(tree, 'Confirmar conta').props.onPress();
    });

    expect(confirmSignUp).toHaveBeenCalledWith({
      email: 'fulana@empresa.com',
      code: '123456',
    });
    expect(mockReplace).toHaveBeenCalledWith(CONFIRMACAO);
  });

  it('sem e-mail na rota, confirma mandando e-mail vazio em vez de undefined', async () => {
    mockParams = {};
    const tree = await render();

    await act(async () => {
      await botao(tree, 'Confirmar conta').props.onPress();
    });

    expect(confirmSignUp).toHaveBeenCalledWith({ email: '', code: '' });
  });

  // O servidor separa "inválido" de "expirado", e a ação da pessoa muda: um
  // pede redigitar, o outro pede reenvio. Engolir os dois num texto genérico
  // deixa quem está do outro lado sem saber o que corrigir.
  it('código recusado mostra o motivo que veio do servidor', async () => {
    confirmSignUp.mockRejectedValue(new Error('Código expirado'));
    const tree = await render();

    await act(async () => {
      await botao(tree, 'Confirmar conta').props.onPress();
    });

    expect(alertas()[0]).toEqual(['Erro', 'Código expirado']);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('enquanto confirma, o botão anuncia o envio e recusa um segundo toque', async () => {
    let liberar!: () => void;
    confirmSignUp.mockReturnValue(
      new Promise<void>((resolve) => {
        liberar = resolve;
      }),
    );
    const tree = await render();

    await act(async () => {
      void botao(tree, 'Confirmar conta').props.onPress();
    });

    const emVoo = botao(tree, 'Confirmando…');
    expect(emVoo).toBeDefined();
    expect(emVoo.props.disabled).toBe(true);

    await act(async () => {
      liberar();
    });
    expect(botao(tree, 'Confirmar conta')).toBeDefined();
  });

  it('reenviar pede outro código e confirma na tela', async () => {
    const tree = await render();

    await act(async () => {
      await botao(tree, 'Reenviar código').props.onPress();
    });

    expect(resendConfirmation).toHaveBeenCalledWith({ email: 'fulana@empresa.com' });
    expect(alertas()[0][0]).toBe('Código reenviado');
  });

  it('falha no reenvio mostra o motivo, e o botão volta a aceitar toque', async () => {
    resendConfirmation.mockRejectedValue(new Error('Muitas tentativas'));
    const tree = await render();

    await act(async () => {
      await botao(tree, 'Reenviar código').props.onPress();
    });

    expect(alertas()[0]).toEqual(['Erro', 'Muitas tentativas']);
    // O `finally` é o que devolve o botão: sem ele, o primeiro erro de rede
    // deixaria a pessoa sem como pedir o código de novo.
    expect(botao(tree, 'Reenviar código').props.disabled).toBe(false);
  });
});
