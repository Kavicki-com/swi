import { AppState, Linking, Platform } from 'react-native';
import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, Input, StatusTag, SwiThemeProvider, TopBar } from '@kavicki/swi-design-system';
import WatchPairing from '../../../../app/(onboarding)/watch/pairing';
import { isFeatureEnabled, type FeatureGate } from '../../../../lib/featureFlags';
import { androidDeviceControl } from '../../../../services/telemetry/android/androidDeviceControl';
import { completeEnrollment } from '../../../../services/telemetry/deviceEnrollment';
import type { HealthConnectState } from '../../../../services/telemetry/healthConnect/healthConnectReader';
import {
  useTelemetryUploadState,
  type TelemetryUploadContextValue,
} from '../../../../services/telemetry/TelemetryUploadProvider';

// Tela de pareamento: o funcionário digita os seis dígitos que o administrador
// gerou no painel. Uma tela, dois caminhos: primeiro uso (pulável) e
// Configurações, Monitoramento. No iPhone pareia para o Apple Watch; no
// Android, para a pulseira do Health Connect, com o passo da permissão depois.

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockParams: { origem?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));

jest.mock('../../../../services/telemetry/deviceEnrollment', () => ({
  completeEnrollment: jest.fn(),
}));

jest.mock('../../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: jest.fn(),
}));

const mockGate = isFeatureEnabled as jest.Mock;
const mockConcluir = completeEnrollment as jest.MockedFunction<typeof completeEnrollment>;
const mockEnvio = useTelemetryUploadState as jest.MockedFunction<typeof useTelemetryUploadState>;
const mockRefresh = jest.fn();

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const mockSyncNow = jest.fn(async () => undefined);
const mockPedir = jest.fn(
  async (): Promise<'granted' | 'denied' | 'unavailable'> => 'granted',
);
const mockConferir = jest.fn(
  async (): Promise<'available' | 'unavailable' | 'update_required'> => 'available',
);
const mockAjustes = jest.fn();

// O contexto do envio como a tela o lê. Trocar o valor e renderizar de novo
// imita o provider relendo o estado.
const comEnvio = (parcial: Partial<TelemetryUploadContextValue> = {}) =>
  mockEnvio.mockReturnValue({
    paired: false,
    lastOutcome: null,
    refreshPairing: mockRefresh,
    healthConnect: null,
    syncNow: mockSyncNow,
    requestHealthConnectPermission: mockPedir,
    checkHealthConnect: mockConferir,
    openHealthConnectSettings: mockAjustes,
    ...parcial,
  });

const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

const montadas: ReturnType<typeof create>[] = [];
afterEach(() => {
  while (montadas.length) montadas.pop()!.unmount();
  naPlataforma(originalOS);
  jest.restoreAllMocks();
});

const arvore = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <SwiThemeProvider>
      <WatchPairing />
    </SwiThemeProvider>
  </SafeAreaProvider>
);

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(arvore());
  });
  montadas.push(tree);
  return tree;
};

const renderDeNovo = async (tree: ReturnType<typeof create>) => {
  await act(async () => {
    tree.update(arvore());
  });
};

const texto = (tree: ReturnType<typeof create>): string => {
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

type BotaoProps = { label: string; onPress: () => void; disabled?: boolean };
const botoes = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType(Button as React.ComponentType<BotaoProps>);
const botao = (tree: ReturnType<typeof create>, label: string) =>
  botoes(tree).find((b) => b.props.label === label);

const tocar = async (tree: ReturnType<typeof create>, label: string) => {
  const alvo = botao(tree, label);
  if (!alvo) {
    throw new Error(
      `Botão "${label}" não existe. Há: ${botoes(tree)
        .map((b) => b.props.label)
        .join(', ')}`,
    );
  }
  await act(async () => {
    alvo.props.onPress();
  });
};

type CampoProps = {
  value: string;
  onChangeText: (t: string) => void;
  description?: string;
  descriptionVariant?: string;
  disabled?: boolean;
};
const campo = (tree: ReturnType<typeof create>) =>
  tree.root.findByType(Input as React.ComponentType<CampoProps>);

const digitar = async (tree: ReturnType<typeof create>, valor: string) => {
  await act(async () => {
    campo(tree).props.onChangeText(valor);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockGate.mockReturnValue(true);
  // `clearAllMocks` não desfaz implementações: cada teste começa das mesmas.
  mockSyncNow.mockReset().mockResolvedValue(undefined);
  mockPedir.mockReset().mockResolvedValue('granted');
  mockConferir.mockReset().mockResolvedValue('available');
  comEnvio();
  mockConcluir.mockResolvedValue({ paired: true });
});

describe('pareamento: digitar o código', () => {
  it('só aceita dígitos e no máximo seis', async () => {
    const tree = await render();
    await digitar(tree, '48a2-91077');
    expect(campo(tree).props.value).toBe('482910');
  });

  it('Parear fica desligado até haver seis dígitos', async () => {
    const tree = await render();
    expect(botao(tree, 'Parear')!.props.disabled).toBe(true);
    await digitar(tree, '48291');
    expect(botao(tree, 'Parear')!.props.disabled).toBe(true);
    await digitar(tree, '482910');
    expect(botao(tree, 'Parear')!.props.disabled).toBe(false);
  });

  it('envia os seis dígitos ao serviço de pareamento', async () => {
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    expect(mockConcluir).toHaveBeenCalledTimes(1);
    expect(mockConcluir).toHaveBeenCalledWith('482910');
  });

  it('enquanto o servidor responde, o botão e o campo ficam desligados', async () => {
    let resolver!: (r: { paired: true }) => void;
    mockConcluir.mockReturnValue(new Promise((r) => (resolver = r)));
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    expect(botao(tree, 'Pareando…')!.props.disabled).toBe(true);
    expect(campo(tree).props.disabled).toBe(true);
    await act(async () => {
      resolver({ paired: true });
    });
  });
});

// O teclado numérico do iOS não tem tecla de confirmar: se o botão Parear
// ficasse embaixo dele, o funcionário digitaria o código sem ter onde tocar.
// Os dublês do teclado são View e ScrollView, então o que se confere são as
// props que só os componentes de teclado recebem.
describe('pareamento: teclado', () => {
  it('o conteúdo rola acima do teclado', async () => {
    const tree = await render();
    const rolagem = tree.root.findAll((n) => n.props.bottomOffset !== undefined);
    expect(rolagem.length).toBeGreaterThan(0);
    expect(rolagem[0]!.findAllByType(Input)).toHaveLength(1);
  });

  it('o botão Parear acompanha o teclado', async () => {
    const tree = await render();
    const fixo = tree.root.findAll((n) => n.props.offset !== undefined);
    expect(fixo.length).toBeGreaterThan(0);
    const labels = fixo[0]!
      .findAllByType(Button as React.ComponentType<BotaoProps>)
      .map((b) => b.props.label);
    expect(labels).toContain('Parear');
  });
});

describe('pareamento: recusas', () => {
  it.each([
    ['expired', 'Este código expirou. Peça um novo ao administrador.'],
    [
      'already_used',
      'Este código já foi usado. Se este aparelho já está pareado, não é preciso repetir.',
    ],
    ['invalid_code', 'Código não confere. Confira os seis dígitos com o administrador.'],
    ['unsupported_device', 'Este aparelho não pode ser pareado.'],
  ] as const)('%s mostra a frase certa no campo, como erro', async (reason, frase) => {
    mockConcluir.mockResolvedValue({ paired: false, reason });
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    expect(campo(tree).props.description).toBe(frase);
    expect(campo(tree).props.descriptionVariant).toBe('error');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('corrigir o código limpa a recusa anterior', async () => {
    mockConcluir.mockResolvedValue({ paired: false, reason: 'invalid_code' });
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    await digitar(tree, '48291');
    expect(campo(tree).props.description).toBeUndefined();
  });
});

describe('pareamento: concluído', () => {
  it('avisa o envio, mostra o aparelho pareado e some com o campo', async () => {
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(texto(tree)).toContain('Aparelho pareado');
    expect(tree.root.findAllByType(Input)).toHaveLength(0);
  });

  it('quem já chega pareado vê o estado pareado, sem campo', async () => {
    comEnvio({ paired: true });
    const tree = await render();
    expect(texto(tree)).toContain('Aparelho pareado');
    expect(tree.root.findAllByType(Input)).toHaveLength(0);
  });
});

describe('pareamento: primeiro uso', () => {
  it('Parear depois segue para o fim do primeiro uso, sem parear', async () => {
    const tree = await render();
    await tocar(tree, 'Parear depois');
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/complete');
    expect(mockConcluir).not.toHaveBeenCalled();
  });

  it('depois de parear, Continuar segue para o fim do primeiro uso', async () => {
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    await tocar(tree, 'Continuar');
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/complete');
  });

  it('não tem barra de voltar', async () => {
    const tree = await render();
    expect(tree.root.findAllByType(TopBar)).toHaveLength(0);
  });
});

describe('pareamento: vindo de Configurações', () => {
  beforeEach(() => {
    mockParams = { origem: 'configuracoes' };
  });

  it('tem voltar e não oferece Parear depois', async () => {
    const tree = await render();
    expect(tree.root.findAllByType(TopBar)).toHaveLength(1);
    expect(botao(tree, 'Parear depois')).toBeUndefined();
  });

  it('depois de parear, Continuar volta para o Monitoramento', async () => {
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    await tocar(tree, 'Continuar');
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('pareamento: fora do piloto', () => {
  // Expo Go e builds sem o módulo nativo não têm como guardar a credencial
  // nem de onde ler: nem o piloto do Apple Watch nem o Health Connect.
  it('não mostra a tela de código', async () => {
    mockGate.mockReturnValue(false);
    const tree = await render();
    expect(mockGate).toHaveBeenCalledWith('appleWatchPilot');
    expect(tree.root.findAllByType(Input)).toHaveLength(0);
  });
});

// O iPhone não tem passo do Health Connect: o relógio já foi autorizado nas
// telas anteriores do primeiro uso.
describe('pareamento: iPhone', () => {
  it('pareado, não mostra o passo do Health Connect nem consulta nada', async () => {
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    expect(botao(tree, 'Permitir leitura')).toBeUndefined();
    expect(mockConferir).not.toHaveBeenCalled();
    expect(texto(tree)).not.toContain('Health Connect');
  });
});

const estadoHC = (parcial: Partial<HealthConnectState> = {}): HealthConnectState => ({
  availability: 'available',
  permission: null,
  bandPackage: null,
  bandLabel: null,
  noBand: false,
  lastSyncAt: null,
  ...parcial,
});

const comGates = (...ligados: FeatureGate[]) =>
  mockGate.mockImplementation((gate: FeatureGate) => ligados.includes(gate));

type TagProps = { label?: string; status?: string };
const tags = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAllByType(StatusTag as React.ComponentType<TagProps>)
    .map((t) => ({ label: t.props.label, status: t.props.status }));

const MARKET = 'market://details?id=com.google.android.apps.healthdata';
const PLAY_WEB = 'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';

describe('pareamento: Android', () => {
  beforeEach(() => {
    naPlataforma('android');
    comGates('healthConnect');
  });

  // Pareia direto: cada teste do passo do Health Connect começa daqui.
  const parearNoAndroid = async () => {
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    return tree;
  };

  it('o gate do Health Connect liga a tela, sem o do Apple Watch', async () => {
    const tree = await render();
    expect(tree.root.findAllByType(Input)).toHaveLength(1);
  });

  it('pareia com o controle do Android e o tipo de aparelho certo', async () => {
    await parearNoAndroid();
    expect(mockConcluir).toHaveBeenCalledWith('482910', {
      control: androidDeviceControl,
      deviceKind: 'ANDROID_PHONE',
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('fala do celular e da pulseira, sem citar iPhone nem Apple Watch', async () => {
    const tree = await render();
    expect(texto(tree)).toContain('Parear este celular');
    expect(texto(tree)).not.toMatch(/iPhone|Apple Watch/);
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    expect(texto(tree)).toContain('As leituras da sua pulseira passam a ser enviadas ao servidor.');
    expect(texto(tree)).toContain('pelo Health Connect');
    expect(texto(tree)).not.toMatch(/iPhone|Apple Watch/);
  });

  it('a falha de guardar a credencial fala do celular', async () => {
    mockConcluir.mockResolvedValue({ paired: false, reason: 'keychain' });
    const tree = await parearNoAndroid();
    expect(campo(tree).props.description).toBe(
      'Não foi possível guardar o pareamento neste celular. Tente de novo.',
    );
  });

  // Antes da primeira rodada disponibilidade e permissão são nulas: a tela
  // pergunta.
  it('pareado, confere o acesso ao Health Connect', async () => {
    await parearNoAndroid();
    expect(mockConferir).toHaveBeenCalled();
  });

  it('com o Health Connect disponível, Permitir leitura abre o pedido do sistema', async () => {
    comEnvio({ healthConnect: estadoHC() });
    const tree = await parearNoAndroid();
    await tocar(tree, 'Permitir leitura');
    expect(mockPedir).toHaveBeenCalledTimes(1);
  });

  it('sem Health Connect, Instalar o Health Connect abre a Play Store', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    comEnvio({ healthConnect: estadoHC({ availability: 'unavailable' }) });
    const tree = await parearNoAndroid();
    expect(botao(tree, 'Permitir leitura')).toBeUndefined();
    await tocar(tree, 'Instalar o Health Connect');
    expect(abrir).toHaveBeenCalledWith(MARKET);
    expect(abrir).not.toHaveBeenCalledWith(PLAY_WEB);
  });

  // Sem o app da Play Store, o link do market não tem quem o abra.
  it('se o market falha, abre a Play Store no navegador', async () => {
    const abrir = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValueOnce(new Error('sem quem abra'))
      .mockResolvedValue(true);
    comEnvio({ healthConnect: estadoHC({ availability: 'unavailable' }) });
    const tree = await parearNoAndroid();
    await tocar(tree, 'Instalar o Health Connect');
    expect(abrir).toHaveBeenNthCalledWith(1, MARKET);
    expect(abrir).toHaveBeenNthCalledWith(2, PLAY_WEB);
  });

  it('Health Connect desatualizado oferece atualizar, pelo mesmo link', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    comEnvio({ healthConnect: estadoHC({ availability: 'update_required' }) });
    const tree = await parearNoAndroid();
    await tocar(tree, 'Atualizar o Health Connect');
    expect(abrir).toHaveBeenCalledWith(MARKET);
  });

  // Quem volta da Play Store volta ao primeiro plano: a tela confere de novo
  // e troca o botão da loja pelo pedido de permissão.
  it('ao voltar ao primeiro plano, confere o Health Connect de novo', async () => {
    let aoMudar: ((estado: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_tipo, ouvinte) => {
      aoMudar = ouvinte as (estado: string) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    comEnvio({ healthConnect: estadoHC({ availability: 'unavailable' }) });
    const tree = await parearNoAndroid();
    const antes = mockConferir.mock.calls.length;

    comEnvio({ healthConnect: estadoHC() });
    await act(async () => {
      aoMudar!('active');
    });
    await renderDeNovo(tree);

    expect(mockConferir.mock.calls.length).toBe(antes + 1);
    expect(botao(tree, 'Permitir leitura')).toBeDefined();
  });

  it('negado diz o que fazer, abre os ajustes e deixa tentar de novo e continuar', async () => {
    comEnvio({ healthConnect: estadoHC() });
    mockPedir.mockImplementation(async () => {
      comEnvio({ healthConnect: estadoHC({ permission: 'denied' }) });
      return 'denied';
    });
    const tree = await parearNoAndroid();
    await tocar(tree, 'Permitir leitura');

    expect(texto(tree)).toContain('ajustes do Health Connect');
    await tocar(tree, 'Abrir os ajustes do Health Connect');
    expect(mockAjustes).toHaveBeenCalledTimes(1);
    await tocar(tree, 'Tentar de novo');
    expect(mockPedir).toHaveBeenCalledTimes(2);
    expect(mockSyncNow).not.toHaveBeenCalled();

    await tocar(tree, 'Continuar');
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/complete');
  });

  // A permissão de segundo plano concedida só vale na próxima mudança de
  // estado: a tela sincroniza depois de conceder. Mas o `syncNow` não faz
  // nada enquanto o provider ainda relê a credencial (`paired` falso): a
  // sincronização espera o `paired` do provider.
  it('concedida, sincroniza uma vez, só quando o provider já vê o pareamento', async () => {
    comEnvio({ healthConnect: estadoHC() });
    mockPedir.mockImplementation(async () => {
      comEnvio({ healthConnect: estadoHC({ permission: 'granted' }) });
      return 'granted';
    });
    const tree = await parearNoAndroid();
    await tocar(tree, 'Permitir leitura');
    expect(mockSyncNow).not.toHaveBeenCalled();
    expect(tags(tree)).toContainEqual({
      label: 'Procurando a pulseira no Health Connect…',
      status: 'info',
    });

    comEnvio({ paired: true, healthConnect: estadoHC({ permission: 'granted' }) });
    await renderDeNovo(tree);
    expect(mockSyncNow).toHaveBeenCalledTimes(1);

    await renderDeNovo(tree);
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
  });

  it('enquanto sincroniza, mostra o progresso', async () => {
    mockSyncNow.mockImplementationOnce(() => new Promise<undefined>(() => undefined));
    comEnvio({ paired: true, healthConnect: estadoHC({ permission: 'granted' }) });
    const tree = await render();
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(tags(tree)).toEqual([
      { label: 'Procurando a pulseira no Health Connect…', status: 'info' },
    ]);
  });

  it('com a pulseira detectada, mostra o nome dela', async () => {
    comEnvio({
      paired: true,
      healthConnect: estadoHC({
        permission: 'granted',
        bandPackage: 'com.huami.watch.hmwatchmanager',
        bandLabel: 'Zepp',
      }),
    });
    const tree = await render();
    expect(tags(tree)).toEqual([{ label: 'Pulseira detectada: Zepp', status: 'accept' }]);
  });

  it('sem pulseira, avisa e diz o que conferir', async () => {
    comEnvio({
      paired: true,
      healthConnect: estadoHC({ permission: 'granted', noBand: true }),
    });
    const tree = await render();
    expect(tags(tree)).toEqual([{ label: 'Nenhuma pulseira encontrada', status: 'pending' }]);
    expect(texto(tree)).toContain('Abra o app da sua pulseira');
  });

  // Os ouvintes de AppState, para o teste disparar a volta ao primeiro plano.
  const ouvirAppState = () => {
    const ouvintes: ((estado: string) => void)[] = [];
    const remover = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_tipo, ouvinte) => {
      ouvintes.push(ouvinte as (estado: string) => void);
      return { remove: remover } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    return {
      remover,
      voltar: async () => {
        await act(async () => {
          ouvintes.forEach((ouvinte) => ouvinte('active'));
        });
      },
    };
  };

  // Negou no pedido, concedeu nos ajustes do Health Connect e voltou: a
  // conferência da volta traz a permissão nova, e a primeira sincronização
  // sai sem precisar tocar em mais nada.
  it('negado e concedido nos ajustes: na volta mostra o progresso e sincroniza', async () => {
    const appState = ouvirAppState();
    comEnvio({ healthConnect: estadoHC() });
    mockPedir.mockImplementation(async () => {
      comEnvio({ healthConnect: estadoHC({ permission: 'denied' }) });
      return 'denied';
    });
    const tree = await parearNoAndroid();
    await tocar(tree, 'Permitir leitura');
    expect(texto(tree)).toContain('ajustes do Health Connect');

    mockSyncNow.mockImplementationOnce(() => new Promise<undefined>(() => undefined));
    mockConferir.mockImplementation(async () => {
      comEnvio({ paired: true, healthConnect: estadoHC({ permission: 'granted' }) });
      return 'available';
    });
    await appState.voltar();
    await renderDeNovo(tree);

    expect(tags(tree)).toEqual([
      { label: 'Procurando a pulseira no Health Connect…', status: 'info' },
    ]);
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(botao(tree, 'Tentar de novo')).toBeUndefined();
  });

  // Rodada que falhou em silêncio, ou que caiu numa em voo: nem pulseira nem
  // "nenhuma pulseira". A tela não fica muda nem afirma o que não sabe.
  it('sincronizou sem resultado: frase neutra, sem afirmar nada da pulseira', async () => {
    comEnvio({ paired: true, healthConnect: estadoHC({ permission: 'granted' }) });
    const tree = await render();
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(tags(tree)).toEqual([]);
    expect(texto(tree)).toContain(
      'A leitura do Health Connect ainda não trouxe resultado. O SWI tenta de novo sozinho.',
    );
  });

  // O pedido rejeitou com o Health Connect ainda disponível: a pessoa não
  // pode voltar a um "Permitir leitura" mudo, como se nada tivesse havido.
  it('pedido que falha com o Health Connect disponível mostra o caminho de sem permissão', async () => {
    comEnvio({ healthConnect: estadoHC() });
    mockPedir.mockResolvedValue('unavailable');
    const tree = await parearNoAndroid();
    await tocar(tree, 'Permitir leitura');

    expect(texto(tree)).toContain('ajustes do Health Connect');
    expect(botao(tree, 'Tentar de novo')).toBeDefined();
    expect(botao(tree, 'Abrir os ajustes do Health Connect')).toBeDefined();
    expect(botao(tree, 'Permitir leitura')).toBeUndefined();
  });

  // O pedido rejeitou porque não havia Health Connect; a pessoa instalou pela
  // Play Store e voltou. A permissão do estado vem negada (nunca foi
  // perguntada): a tela volta a oferecer o pedido, não o caminho dos ajustes.
  it('instalado depois de um pedido que falhou, volta a oferecer Permitir leitura', async () => {
    const appState = ouvirAppState();
    comEnvio({ healthConnect: estadoHC() });
    mockPedir.mockImplementation(async () => {
      comEnvio({ healthConnect: estadoHC({ availability: 'unavailable' }) });
      return 'unavailable';
    });
    const tree = await parearNoAndroid();
    await tocar(tree, 'Permitir leitura');
    expect(botao(tree, 'Instalar o Health Connect')).toBeDefined();

    mockConferir.mockImplementation(async () => {
      comEnvio({ healthConnect: estadoHC({ permission: 'denied' }) });
      return 'available';
    });
    await appState.voltar();
    await renderDeNovo(tree);

    expect(botao(tree, 'Permitir leitura')).toBeDefined();
    expect(botao(tree, 'Tentar de novo')).toBeUndefined();
  });

  it('sair da tela remove o ouvinte da volta ao primeiro plano', async () => {
    const appState = ouvirAppState();
    comEnvio({ paired: true, healthConnect: estadoHC() });
    const tree = await render();
    expect(appState.remover).not.toHaveBeenCalled();
    montadas.splice(montadas.indexOf(tree), 1);
    await act(async () => {
      tree.unmount();
    });
    expect(appState.remover).toHaveBeenCalledTimes(1);
  });

  it('vindo de Configurações, Continuar volta para o Monitoramento', async () => {
    mockParams = { origem: 'configuracoes' };
    comEnvio({ healthConnect: estadoHC() });
    const tree = await parearNoAndroid();
    expect(tree.root.findAllByType(TopBar)).toHaveLength(1);
    await tocar(tree, 'Continuar');
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
