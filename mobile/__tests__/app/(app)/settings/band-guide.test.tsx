import { Linking } from 'react-native';
import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import {
  Accordion,
  Button,
  RadioGroup,
  StatusTag,
  SwiThemeProvider,
  TopBar,
} from '@kavicki/swi-design-system';
import BandGuide from '../../../../app/(app)/settings/band-guide';

// O guia da pulseira: o funcionário responde "Qual é o app da sua pulseira?"
// e lê as instruções daquele app do fabricante, em dois blocos (Health
// Connect e Bluetooth). A resposta fica só no aparelho, por usuário.

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

const mockGuardado = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockGuardado.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockGuardado.set(k, v);
  }),
}));

let mockUsuario: { id: string; email: string; name: string } | null = {
  id: 'func-1',
  email: 'ana@empresa.com',
  name: 'Ana',
};
jest.mock('../../../../services/auth/AuthProvider', () => ({
  useAuth: () => ({ user: mockUsuario }),
}));

// Nada detectado: aqui a escolha é só pela pergunta. A detecção tem o teste
// dela (band-guide-detection.test.tsx).
jest.mock('../../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: () => ({ healthConnect: null }),
}));
jest.mock('../../../../services/telemetry/bluetooth/bluetoothBandChoice', () => ({
  useBandChoice: () => null,
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

type Arvore = ReturnType<typeof create>;
const montadas: Arvore[] = [];

beforeEach(() => {
  mockGuardado.clear();
  mockUsuario = { id: 'func-1', email: 'ana@empresa.com', name: 'Ana' };
  jest.clearAllMocks();
});

afterEach(() => {
  act(() => {
    while (montadas.length) montadas.pop()!.unmount();
  });
});

const render = async () => {
  let tree!: Arvore;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <BandGuide />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  montadas.push(tree);
  return tree;
};

const textoDe = (tree: Arvore): string => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    walk((node as { children?: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join(' ');
};

type Opcao = { label: string; value: string };
const pergunta = (tree: Arvore) =>
  tree.root.findByType(
    RadioGroup as React.ComponentType<{
      label: string;
      options: Opcao[];
      value: string | null;
      onChange: (v: string) => void;
    }>,
  );

const responder = async (tree: Arvore, rotulo: string) => {
  const grupo = pergunta(tree);
  const opcao = grupo.props.options.find((o: Opcao) => o.label === rotulo);
  expect(opcao).toBeDefined();
  await act(async () => {
    grupo.props.onChange(opcao!.value);
  });
};

const blocos = (tree: Arvore) =>
  tree.root
    .findAllByType(Accordion as React.ComponentType<{ title: string }>)
    .map((a) => a.props.title);

const etiquetas = (tree: Arvore) =>
  tree.root
    .findAllByType(StatusTag as React.ComponentType<{ label: string }>)
    .map((t) => t.props.label);

const botoes = (tree: Arvore) =>
  tree.root.findAllByType(
    Button as React.ComponentType<{ label: string; onPress: () => void }>,
  );

describe('Guia da pulseira', () => {
  it('pergunta qual é o app da pulseira, com os sete apps do fabricante e "Outro"', async () => {
    const tree = await render();
    const grupo = pergunta(tree);
    expect(grupo.props.label).toBe('Qual é o app da sua pulseira?');
    expect(grupo.props.options.map((o: Opcao) => o.label)).toEqual([
      'Zepp',
      'Zepp Life',
      'Mi Fitness',
      'Samsung Health',
      'Fitbit',
      'Garmin Connect',
      'Huawei Health',
      'Outro',
    ]);
    expect(grupo.props.value).toBeNull();
    // Sem resposta, nenhum guia.
    expect(blocos(tree)).toEqual([]);
  });

  it('mantém a TopBar com o nome da tela', async () => {
    const tree = await render();
    const topBar = tree.root.findAllByType(TopBar as React.ComponentType<{ title: string }>)[0];
    expect(topBar.props.title).toBe('Guia da pulseira');
  });

  it('com Mi Fitness, mostra o guia nos dois blocos', async () => {
    const tree = await render();
    await responder(tree, 'Mi Fitness');
    expect(blocos(tree)).toEqual(['Medições pelo Health Connect', 'Batimento ao vivo por Bluetooth']);
    const t = textoDe(tree);
    expect(t).toContain('Mi Fitness');
    // Health Connect: o caminho da Xiaomi, fonte primária, afirmado.
    expect(t).toContain('Third-party data');
    // Bluetooth: a opção existe só em parte das pulseiras.
    expect(t).toContain('Share HR');
    expect(t).toContain('Pode variar com o modelo');
  });

  it('com Huawei Health, diz que o app não grava no Health Connect e mostra só o Bluetooth como possível', async () => {
    const tree = await render();
    await responder(tree, 'Huawei Health');
    expect(blocos(tree)).toEqual(['Medições pelo Health Connect', 'Batimento ao vivo por Bluetooth']);
    expect(etiquetas(tree)).toEqual(['Este app não grava no Health Connect']);
    const t = textoDe(tree);
    expect(t).toContain('HR Data Broadcasts');
    expect(t).not.toContain('Este app não permite');
  });

  it('com Samsung Health, o bloco do Bluetooth diz que o app não permite', async () => {
    const tree = await render();
    await responder(tree, 'Samsung Health');
    expect(etiquetas(tree)).toEqual(['Este app não permite']);
    expect(textoDe(tree)).toContain('App permissions');
  });

  it('com "Outro", mostra o guia genérico dos dois caminhos', async () => {
    const tree = await render();
    await responder(tree, 'Outro');
    expect(blocos(tree)).toEqual(['Medições pelo Health Connect', 'Batimento ao vivo por Bluetooth']);
    const t = textoDe(tree);
    expect(t).toContain('O SWI não sabe se a sua pulseira permite');
    expect(t).toContain('Health Connect');
    expect(t).toContain('Bluetooth');
    // O genérico não tem página de fabricante.
    expect(botoes(tree).filter((b) => b.props.label === 'Abrir a página do fabricante')).toEqual([]);
  });

  it('abre a página do fabricante quando ela existe na pesquisa', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const tree = await render();
    await responder(tree, 'Huawei Health');
    const links = botoes(tree).filter((b) => b.props.label === 'Abrir a página do fabricante');
    expect(links).toHaveLength(1);
    await act(async () => {
      links[0].props.onPress();
    });
    expect(abrir).toHaveBeenCalledWith('https://consumer.huawei.com/kh/support/content/en-us15827504/');
    abrir.mockRestore();
  });

  it('guarda a resposta no aparelho, por usuário, e a recupera ao voltar', async () => {
    const primeira = await render();
    await responder(primeira, 'Garmin Connect');
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    const [chave] = (SecureStore.setItemAsync as jest.Mock).mock.calls[0] as [string, string];
    expect(chave).toContain('func-1');

    const segunda = await render();
    expect(pergunta(segunda).props.value).toBe('garmin-connect');
    expect(textoDe(segunda)).toContain('Broadcast Heart Rate');
  });

  it('a resposta de um usuário não vale para outro no mesmo aparelho', async () => {
    const primeira = await render();
    await responder(primeira, 'Zepp');

    mockUsuario = { id: 'func-2', email: 'bia@empresa.com', name: 'Bia' };
    const segunda = await render();
    expect(pergunta(segunda).props.value).toBeNull();
    expect(blocos(segunda)).toEqual([]);
  });

  it('não envia a resposta ao backend', async () => {
    const rede = jest.fn();
    const original = global.fetch;
    global.fetch = rede as unknown as typeof fetch;
    const tree = await render();
    await responder(tree, 'Zepp Life');
    expect(rede).not.toHaveBeenCalled();
    global.fetch = original;
  });

  it('com o armazenamento indisponível, a pergunta continua respondível', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain'));
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain'));
    const tree = await render();
    expect(pergunta(tree).props.value).toBeNull();
    await responder(tree, 'Fitbit');
    expect(textoDe(tree)).toContain('Google Health');
  });

  it('com um valor guardado que não é app conhecido, volta a perguntar', async () => {
    mockGuardado.set('swi.bandGuide.answer.v1.func-1', 'smartwatch-qualquer');
    const tree = await render();
    expect(pergunta(tree).props.value).toBeNull();
  });

  it('sem usuário na sessão, só mostra a pergunta e não grava nada', async () => {
    mockUsuario = null;
    const tree = await render();
    await responder(tree, 'Zepp');
    expect(textoDe(tree)).toContain('Heart Rate Push');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});
