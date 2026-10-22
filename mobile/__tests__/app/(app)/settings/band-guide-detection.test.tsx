import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Accordion, RadioGroup, SwiThemeProvider, Title } from '@kavicki/swi-design-system';
import BandGuide from '../../../../app/(app)/settings/band-guide';

// A detecção do app do fabricante no guia da pulseira: o pacote que gravou no
// Health Connect e, antes da primeira sincronização, o nome que a pulseira
// escolhida anuncia por Bluetooth. O detectado sobrepõe a resposta guardada,
// e a pergunta só aparece quando nada foi detectado.

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

jest.mock('../../../../services/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'func-1', email: 'ana@empresa.com', name: 'Ana' } }),
}));

let mockPacote: string | null = null;
jest.mock('../../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: () => ({
    healthConnect:
      mockPacote === null
        ? null
        : {
            availability: 'available',
            permission: 'granted',
            bandPackage: mockPacote,
            bandLabel: null,
            noBand: false,
            lastSyncAt: null,
          },
  }),
}));

let mockEscolha: { deviceId: string; name: string | null } | null = null;
jest.mock('../../../../services/telemetry/bluetooth/bluetoothBandChoice', () => ({
  useBandChoice: () => mockEscolha,
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

type Arvore = ReturnType<typeof create>;
const montadas: Arvore[] = [];

beforeEach(() => {
  mockGuardado.clear();
  mockPacote = null;
  mockEscolha = null;
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

const perguntas = (tree: Arvore) => tree.root.findAllByType(RadioGroup);

const titulo = (tree: Arvore) =>
  tree.root.findAllByType(Title as React.ComponentType<{ children: string }>)[0]?.props.children;

const blocos = (tree: Arvore) =>
  tree.root
    .findAllByType(Accordion as React.ComponentType<{ title: string }>)
    .map((a) => a.props.title);

describe('Guia da pulseira, detecção do app do fabricante', () => {
  it('pelo pacote que gravou no Health Connect, abre o guia sem perguntar', async () => {
    mockPacote = 'com.xiaomi.wearable';
    const tree = await render();
    expect(perguntas(tree)).toEqual([]);
    expect(titulo(tree)).toBe('Mi Fitness');
    expect(blocos(tree)).toEqual(['Medições pelo Health Connect', 'Batimento ao vivo por Bluetooth']);
    const t = textoDe(tree);
    expect(t).toContain('Third-party data');
    expect(t).toContain('O SWI identificou o app pelas medições que ele gravou no Health Connect.');
    expect(t).not.toContain('Qual é o app da sua pulseira?');
  });

  it('pelo nome anunciado por Bluetooth, abre o guia e nunca mostra o modelo', async () => {
    mockEscolha = { deviceId: 'AA:BB:CC:DD:EE:FF', name: 'Galaxy Fit3 (1A2B)' };
    const tree = await render();
    expect(perguntas(tree)).toEqual([]);
    expect(titulo(tree)).toBe('Samsung Health');
    const t = textoDe(tree);
    expect(t).toContain('App permissions');
    expect(t).toContain('O SWI identificou o app pelo nome que a pulseira anuncia por Bluetooth.');
    expect(t).not.toContain('Galaxy Fit3');
    expect(t).not.toContain('1A2B');
  });

  it('o pacote do Health Connect vence o nome anunciado', async () => {
    mockPacote = 'com.fitbit.FitbitMobile';
    mockEscolha = { deviceId: 'AA:BB:CC:DD:EE:FF', name: 'HUAWEI Band 8-1A2' };
    const tree = await render();
    expect(titulo(tree)).toBe('Fitbit');
    expect(textoDe(tree)).not.toContain('HR Data Broadcasts');
  });

  it('o detectado sobrepõe a resposta guardada', async () => {
    mockGuardado.set('swi.bandGuide.answer.v1.func-1', 'zepp');
    mockPacote = 'com.garmin.android.apps.connectmobile';
    const tree = await render();
    expect(perguntas(tree)).toEqual([]);
    expect(titulo(tree)).toBe('Garmin Connect');
    const t = textoDe(tree);
    expect(t).toContain('Broadcast Heart Rate');
    expect(t).not.toContain('Heart Rate Push');
  });

  it('nome sem prefixo conhecido não detecta nada e cai na pergunta', async () => {
    mockEscolha = { deviceId: 'AA:BB:CC:DD:EE:FF', name: 'Pulseira X1' };
    const tree = await render();
    const [grupo] = perguntas(tree);
    expect(grupo.props.label).toBe('Qual é o app da sua pulseira?');
    expect(grupo.props.value).toBeNull();
    expect(blocos(tree)).toEqual([]);
    expect(textoDe(tree)).not.toContain('Pulseira X1');
  });

  it('pacote desconhecido e pulseira sem nome caem na pergunta, com a resposta guardada', async () => {
    mockGuardado.set('swi.bandGuide.answer.v1.func-1', 'huawei-health');
    mockPacote = 'com.exemplo.pulseira';
    mockEscolha = { deviceId: 'AA:BB:CC:DD:EE:FF', name: null };
    const tree = await render();
    const [grupo] = perguntas(tree);
    expect(grupo.props.value).toBe('huawei-health');
    expect(titulo(tree)).toBe('Huawei Health');
    // Respondido não se apresenta como detectado.
    expect(textoDe(tree)).not.toContain('O SWI identificou');
  });
});
