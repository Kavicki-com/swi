import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import { SyncBanner } from '../../../components/telemetry/SyncBanner';
import { reporting } from '../../../services/telemetry/myTelemetryFixtures';
import type { WorkerTelemetry } from '../../../services/telemetry/myTelemetry';
import type { HealthConnectState } from '../../../services/telemetry/healthConnect/healthConnectReader';

// A faixa da pulseira lida pelo Health Connect, igual no Dashboard e em Minhas
// estatísticas. As fronteiras dubladas são as duas leituras de contexto (a de
// me/current e a do envio); o relógio é falso, porque é ele que faz o
// "sincronizado há" andar com a tela aberta.
//
// O que se cerca aqui: a faixa só existe com sincronização; o botão só existe
// quando ESTE celular lê o Health Connect e está pareado; o progresso vem do
// contexto do envio (um estado só para todas as faixas montadas); e um toque
// é uma sincronização, com UMA releitura de me/current no fim.

const NOW = new Date('2026-10-01T15:00:00.000Z');
const MEASURED_UNTIL = '2026-10-01T14:10:00.000Z';
const MIN = 60 * 1000;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const synced = (): WorkerTelemetry => ({
  ...reporting(),
  sync: {
    measuredUntil: MEASURED_UNTIL,
    syncedAt: new Date(NOW.getTime() - 3 * MIN).toISOString(),
  },
});

const LENDO: HealthConnectState = {
  availability: 'available',
  permission: 'granted',
  bandPackage: 'com.huami.watch.hmwatchmanager',
  bandLabel: 'Zepp',
  noBand: false,
  lastSyncAt: '2026-10-01T14:57:00.000Z',
};

// --- Fronteiras dubladas -----------------------------------------------------

let mockTelemetry: WorkerTelemetry | null = null;
const mockRefresh = jest.fn();
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => ({ telemetry: mockTelemetry, failed: false, loading: false }),
  useRefreshMyTelemetry: () => mockRefresh,
}));

// O contexto do envio como o provider o entrega: `syncing` é um estado só,
// e quem o lê renderiza de novo quando ele muda.
let mockHealthConnect: HealthConnectState | null = null;
let mockPaired = true;
let mockSyncing = false;
const mockOuvintes = new Set<() => void>();
const mockSyncNow = jest.fn<Promise<void>, []>();
jest.mock('../../../services/telemetry/TelemetryUploadProvider', () => {
  const { useEffect, useReducer } = require('react');
  return {
    useTelemetryUploadState: () => {
      const [, renderDeNovo] = useReducer((n: number) => n + 1, 0);
      useEffect(() => {
        mockOuvintes.add(renderDeNovo);
        return () => {
          mockOuvintes.delete(renderDeNovo);
        };
      }, []);
      return {
        healthConnect: mockHealthConnect,
        paired: mockPaired,
        syncing: mockSyncing,
        syncNow: mockSyncNow,
      };
    },
  };
});

const mudarSyncing = (valor: boolean) => {
  mockSyncing = valor;
  mockOuvintes.forEach((renderDeNovo) => renderDeNovo());
};

// Igual ao provider: uma promessa única, com `syncing` ligado enquanto ela
// corre. `terminar` resolve a que está em voo.
let emVoo: Promise<void> | null = null;
let terminarEmVoo: (() => void) | null = null;
const terminar = async () => {
  await act(async () => {
    terminarEmVoo?.();
  });
};

// --- Helpers -----------------------------------------------------------------

let montada: ReactTestRenderer | null = null;

const montar = async (faixas = 1) => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SwiThemeProvider>
        {Array.from({ length: faixas }, (_, i) => (
          <SyncBanner key={i} />
        ))}
      </SwiThemeProvider>,
    );
  });
  montada = tree;
  return tree;
};

const faixa = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.testID === 'sync-banner')[0];

const textos = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

// Os nós pressáveis do Button do DS: os com papel de botão e estado. As
// mesmas props descem por camadas (o contêiner estilizado, o Pressable, o
// View); fica só a de fora, que é a que recebe o onPress já sem efeito
// quando desabilitado.
const dentroDe = (no: ReactTestInstance, outro: ReactTestInstance) => {
  for (let p = no.parent; p !== null; p = p.parent) if (p === outro) return true;
  return false;
};
const botoes = (tree: ReactTestRenderer): ReactTestInstance[] => {
  const todos = tree.root.findAll(
    (n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityState !== undefined,
  );
  return todos.filter((n) => !todos.some((outro) => outro !== n && dentroDe(n, outro)));
};
const botao = (tree: ReactTestRenderer): ReactTestInstance | undefined => botoes(tree)[0];

const tocar = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onPress?.();
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockTelemetry = synced();
  mockHealthConnect = null;
  mockPaired = true;
  mockSyncing = false;
  emVoo = null;
  terminarEmVoo = null;
  mockRefresh.mockReset();
  mockSyncNow.mockReset();
  mockSyncNow.mockImplementation(() => {
    if (emVoo !== null) return emVoo;
    mudarSyncing(true);
    emVoo = new Promise<void>((resolve) => {
      terminarEmVoo = () => {
        emVoo = null;
        terminarEmVoo = null;
        mudarSyncing(false);
        resolve();
      };
    });
    return emVoo;
  });
});

afterEach(async () => {
  await act(async () => {
    montada?.unmount();
  });
  montada = null;
  jest.useRealTimers();
});

// --- Casos -------------------------------------------------------------------

describe('SyncBanner: quando aparece', () => {
  it('sem sincronização (iPhone, sem leitura) não há faixa', async () => {
    mockTelemetry = reporting();
    const tree = await montar();
    expect(tree.toJSON()).toBeNull();

    mockTelemetry = null;
    await act(async () => {
      tree.update(
        <SwiThemeProvider>
          <SyncBanner />
        </SwiThemeProvider>,
      );
    });
    expect(tree.toJSON()).toBeNull();
  });

  it('com sincronização diz até quando há dado e há quanto tempo o celular sincronizou', async () => {
    const tree = await montar();

    expect(faixa(tree)).toBeDefined();
    expect(textos(tree)).toContain(
      `Dados até ${clock(MEASURED_UNTIL)} · sincronizado há 3 min`,
    );
  });

  it('o "sincronizado há" anda com a tela aberta', async () => {
    const tree = await montar();

    await act(async () => {
      jest.advanceTimersByTime(2 * MIN);
    });

    expect(textos(tree)).toContain(
      `Dados até ${clock(MEASURED_UNTIL)} · sincronizado há 5 min`,
    );
  });
});

describe('SyncBanner: o botão', () => {
  // Dado sincronizado por outro aparelho do mesmo funcionário: este celular
  // não tem o que ler, e o botão prometeria uma sincronização que não vem.
  it('sem Health Connect neste celular a faixa mostra só o texto', async () => {
    const tree = await montar();

    expect(faixa(tree)).toBeDefined();
    expect(botao(tree)).toBeUndefined();
    expect(textos(tree)).not.toContain('Sincronizar agora');
  });

  // Com o pareamento caído o syncNow é inerte: o botão piscaria e nada subiria.
  it('sem pareamento a faixa mostra só o texto', async () => {
    mockHealthConnect = LENDO;
    mockPaired = false;
    const tree = await montar();

    expect(faixa(tree)).toBeDefined();
    expect(botao(tree)).toBeUndefined();
    expect(textos(tree)).not.toContain('Sincronizar agora');
  });

  // Sem a leitura de batimento a rodada forçada não lê nada: o botão piscaria
  // sem subir medição. O Monitoramento já exige o mesmo.
  it.each<[string, HealthConnectState]>([
    ['leitura não concedida', { ...LENDO, permission: 'denied' }],
    ['permissão ainda não conferida', { ...LENDO, availability: null, permission: null }],
    ['Health Connect ausente', { ...LENDO, availability: 'unavailable', permission: null }],
  ])('pareado com %s a faixa mostra só o texto', async (_caso, estado) => {
    mockHealthConnect = estado;
    const tree = await montar();

    expect(faixa(tree)).toBeDefined();
    expect(botao(tree)).toBeUndefined();
    expect(textos(tree)).not.toContain('Sincronizar agora');
  });

  it('com Health Connect e pareado oferece "Sincronizar agora"', async () => {
    mockHealthConnect = LENDO;
    const tree = await montar();

    expect(textos(tree)).toContain('Sincronizar agora');
    expect(botao(tree)!.props.accessibilityState).toEqual({ disabled: false });
  });

  it('um toque é uma sincronização: progresso à vista, desabilitado, e volta no fim', async () => {
    mockHealthConnect = LENDO;
    const tree = await montar();

    await tocar(botao(tree)!);

    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(textos(tree)).toContain('Sincronizando…');
    expect(textos(tree)).not.toContain('Sincronizar agora');
    expect(botao(tree)!.props.accessibilityState).toEqual({ disabled: true });

    // Desabilitado, um segundo toque não começa outra.
    await tocar(botao(tree)!);
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();

    await terminar();

    expect(textos(tree)).toContain('Sincronizar agora');
    expect(botao(tree)!.props.accessibilityState).toEqual({ disabled: false });
    // O "sincronizado há" vem do backend: no fim me/current é relido.
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  // Dois toques antes do próximo render: os dois veem o mesmo `syncing`
  // falso. Continua sendo uma sincronização e uma releitura.
  it('toque duplo no mesmo quadro é uma sincronização e uma releitura', async () => {
    mockHealthConnect = LENDO;
    const tree = await montar();
    const alvo = botao(tree)!;

    await act(async () => {
      alvo.props.onPress();
      alvo.props.onPress();
    });
    await terminar();

    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  // Minhas estatísticas empilhada sobre o Dashboard: duas faixas montadas.
  it('com duas faixas montadas o progresso é o mesmo e a releitura é uma só', async () => {
    mockHealthConnect = LENDO;
    const tree = await montar(2);
    expect(botoes(tree)).toHaveLength(2);

    await tocar(botoes(tree)[0]!);

    // O Button do DS usa o rótulo visível como rótulo acessível.
    expect(botoes(tree).map((b) => b.props.accessibilityLabel)).toEqual([
      'Sincronizando…',
      'Sincronizando…',
    ]);
    expect(botoes(tree).map((b) => b.props.accessibilityState)).toEqual([
      { disabled: true },
      { disabled: true },
    ]);
    // A outra faixa, desabilitada, não começa outra.
    await tocar(botoes(tree)[1]!);
    expect(mockSyncNow).toHaveBeenCalledTimes(1);

    await terminar();

    expect(botoes(tree).map((b) => b.props.accessibilityLabel)).toEqual([
      'Sincronizar agora',
      'Sincronizar agora',
    ]);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  // Sincronização começada noutro lugar (a outra faixa, a tela de
  // pareamento): esta só mostra o progresso, e não relê por conta dela.
  it('sincronização em curso noutro lugar: progresso à vista, sem releitura daqui', async () => {
    mockHealthConnect = LENDO;
    mockSyncing = true;
    const tree = await montar();

    expect(textos(tree)).toContain('Sincronizando…');
    expect(botao(tree)!.props.accessibilityState).toEqual({ disabled: true });

    await act(async () => {
      mudarSyncing(false);
    });
    expect(textos(tree)).toContain('Sincronizar agora');
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
