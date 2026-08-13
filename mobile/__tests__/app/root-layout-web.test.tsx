/**
 * @jest-environment jsdom
 */
import type { ReactNode } from 'react';
import { act, create } from 'react-test-renderer';

// Caminho WEB da raiz do app (`app/_layout.tsx`). No web o `useFonts` registra
// todo face com weight=normal, e o browser aplica synthetic-bold em cima de um
// arquivo que já é Bold; daí a raiz pular o useFonts e registrar os 6 pesos na
// FontFace API com o descriptor explícito. É esse registro que estes testes
// cercam, junto do que acontece quando um arquivo não vem.
//
// `IS_WEB` é calculado no MÓDULO, durante o import, então a plataforma precisa
// estar dublada antes. Por isso o caminho native mora em arquivo separado
// (`root-layout.test.tsx`) e a raiz é carregada aqui com require, lá embaixo.

jest.mock('react-native/Libraries/Utilities/Platform', () => {
  // O index do react-native lê `.default` deste módulo; o objeto responde
  // pelas duas formas para servir a quem importa de um jeito ou de outro.
  const plataforma = {
    OS: 'web',
    select: (o: Record<string, unknown>) => o.web ?? o.default,
    isTV: false,
    isTesting: true,
    Version: 0,
    constants: {},
  };
  return { ...plataforma, default: plataforma, __esModule: true };
});

jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: require('react-native').View,
}));
jest.mock('../../assets/smartwatch.glb', () => 'smartwatch.glb', { virtual: true });

// Os arquivos de fonte: um por forma que o bundler entrega (string crua,
// objeto com `uri`, objeto com `default`) mais um ausente, para cobrir a
// resolução do href.
jest.mock('@expo-google-fonts/inter/400Regular', () => ({ Inter_400Regular: 'inter-400.ttf' }));
jest.mock('@expo-google-fonts/inter/500Medium', () => ({
  Inter_500Medium: { uri: 'inter-500.ttf' },
}));
jest.mock('@expo-google-fonts/inter/700Bold', () => ({
  Inter_700Bold: { default: 'inter-700.ttf' },
}));
jest.mock('@expo-google-fonts/montserrat/400Regular', () => ({
  Montserrat_400Regular: 'mont-400.ttf',
}));
jest.mock('@expo-google-fonts/montserrat/500Medium', () => ({
  Montserrat_500Medium: 'mont-500.ttf',
}));
jest.mock('@expo-google-fonts/montserrat/700Bold', () => ({ Montserrat_700Bold: undefined }));

const mockUseFonts = jest.fn((_map: unknown) => [false, null]);
jest.mock('expo-font', () => ({ useFonts: (m: unknown) => mockUseFonts(m) }));

const mockHideAsync = jest.fn();
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: () => mockHideAsync(),
}));

jest.mock('expo-asset', () => ({ Asset: { loadAsync: () => Promise.resolve([]) } }));

const mockStack = Object.assign(
  ({ children }: { children?: ReactNode; screenOptions?: unknown }) => <>{children}</>,
  { Screen: (_props: { name: string; options?: unknown }) => null },
);
jest.mock('expo-router', () => ({ Stack: mockStack }));

jest.mock('../../services/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ user: null }),
}));
jest.mock('../../services/profile/ProfileProvider', () => ({
  ProfileProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../../services/reports/ReportsProvider', () => ({
  ReportsProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../../services/vitals/VitalsProvider', () => ({
  VitalsProvider: ({ children }: { children: ReactNode }) => children,
  useVitals: () => ({ vitals: null }),
}));
jest.mock('../../services/location/LocationProvider', () => ({
  LocationProvider: ({ children }: { children: ReactNode }) => children,
  useLocation: () => ({ coords: null, source: 'mock' }),
}));
jest.mock('../../services/weather/WeatherProvider', () => ({
  WeatherProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../../services/telemetry/useTelemetrySampler', () => ({
  useTelemetrySampler: () => undefined,
}));
jest.mock('../../services/positions/usePositionHeartbeat', () => ({
  usePositionHeartbeat: () => undefined,
}));

// Dublê da FontFace API do browser. Cada instância guarda o que foi pedido e
// segura a promessa de load, para o teste decidir quando (e se) ela resolve.
type FaceDuble = {
  family: string;
  source: string;
  weight?: string;
  resolver: (f: unknown) => void;
  rejeitar: (e: unknown) => void;
  load: () => Promise<unknown>;
};

let faces: FaceDuble[] = [];
const adicionadas: unknown[] = [];

class FontFaceDuble {
  constructor(family: string, source: string, descriptors?: { weight?: string }) {
    const face: FaceDuble = {
      family,
      source,
      weight: descriptors?.weight,
      resolver: () => {},
      rejeitar: () => {},
      load: () =>
        new Promise((res, rej) => {
          face.resolver = res;
          face.rejeitar = rej;
        }),
    };
    faces.push(face);
    return face as unknown as FontFaceDuble;
  }
}

// O DOM vem do ambiente jsdom declarado no topo do arquivo, mas duas peças que
// a raiz usa no web faltam nele: `matchMedia` (o react-native consulta o
// esquema de cores do browser já na carga) e a FontFace API.
window.matchMedia = (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
})) as unknown as typeof window.matchMedia;
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: { add: (f: unknown) => adicionadas.push(f) },
});
(globalThis as { FontFace?: unknown }).FontFace = FontFaceDuble;

const RootLayout = require('../../app/_layout').default as () => ReactNode;

const montadas: ReturnType<typeof create>[] = [];

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<RootLayout />);
  });
  montadas.push(tree);
  return tree;
};

const desmontarTudo = async () => {
  await act(async () => {
    montadas.splice(0).forEach((t) => t.unmount());
  });
};

const resolverTodas = async () => {
  await act(async () => {
    faces.forEach((f) => f.resolver(f));
  });
};

const stackProps = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => n.type === mockStack)[0]?.props as Record<string, unknown> | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  faces = [];
  adicionadas.length = 0;
});

afterEach(desmontarTudo);

describe('RootLayout no web: registro das fontes', () => {
  it('não usa o caminho nativo do useFonts: manda um mapa vazio', async () => {
    await render();
    expect(mockUseFonts.mock.calls[0][0]).toEqual({});
  });

  it('registra os pesos com o descriptor explícito que o CSS pede', async () => {
    await render();

    expect(faces.map((f) => `${f.family} ${f.weight}`)).toEqual(
      expect.arrayContaining([
        'Inter 400',
        'Inter 500',
        'Inter 700',
        'Montserrat 400',
        'Montserrat 500',
      ]),
    );
  });

  // Os apelidos existem para o CSS que pede a family pelo nome do peso
  // ('Inter-Medium'); ali o peso é normal porque a family já carrega o certo.
  it('registra os apelidos de family com peso normal', async () => {
    await render();

    const apelidos = faces.filter((f) => f.family.includes('-'));
    expect(apelidos.map((f) => f.family)).toEqual([
      'Inter-Medium',
      'Inter-Bold',
      'Montserrat-Regular',
      'Montserrat-Medium',
    ]);
    apelidos.forEach((f) => expect(f.weight).toBe('normal'));
  });

  it('resolve o arquivo tanto de string crua quanto de objeto com uri ou default', async () => {
    await render();

    const fonte = (family: string, weight: string) =>
      faces.find((f) => f.family === family && f.weight === weight)?.source;

    expect(fonte('Inter', '400')).toBe('url(inter-400.ttf)');
    expect(fonte('Inter', '500')).toBe('url(inter-500.ttf)');
    expect(fonte('Inter', '700')).toBe('url(inter-700.ttf)');
  });

  // Montserrat_700Bold está dublado como ausente: sem href não há o que
  // registrar, e o resto das fontes tem que seguir normalmente.
  it('fonte sem arquivo é pulada em vez de virar face quebrada', async () => {
    await render();

    expect(faces.some((f) => f.family === 'Montserrat' && f.weight === '700')).toBe(false);
    expect(faces).toHaveLength(9);
  });

  it('as fontes carregadas entram no documento', async () => {
    await render();
    await resolverTodas();

    expect(adicionadas).toHaveLength(9);
  });
});

describe('RootLayout no web: o que destrava o render', () => {
  it('enquanto as fontes estão em voo, não renderiza nada e mantém o splash', async () => {
    const tree = await render();

    expect(tree.toJSON()).toBeNull();
    expect(mockHideAsync).not.toHaveBeenCalled();
  });

  it('com as fontes registradas, monta a árvore de navegação e esconde o splash', async () => {
    const tree = await render();
    await resolverTodas();

    expect(stackProps(tree)).toBeDefined();
    expect(mockHideAsync).toHaveBeenCalled();
  });

  // Uma fonte que não baixa não pode segurar o app: o allSettled destrava
  // assim que TODAS as tentativas terminam, com sucesso ou não.
  it('fonte que falha ao baixar não segura o app nem entra no documento', async () => {
    const tree = await render();

    await act(async () => {
      faces.forEach((f, i) => (i === 0 ? f.rejeitar(new Error('404')) : f.resolver(f)));
    });

    expect(stackProps(tree)).toBeDefined();
    expect(adicionadas).toHaveLength(8);
  });

  // Sair da tela antes das fontes chegarem não pode virar setState em árvore
  // desmontada nem face adicionada tarde.
  it('desmontar antes das fontes chegarem cancela o registro', async () => {
    await render();

    await desmontarTudo();
    await resolverTodas();

    expect(adicionadas).toHaveLength(0);
  });
});
