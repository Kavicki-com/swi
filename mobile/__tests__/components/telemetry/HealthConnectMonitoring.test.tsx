import { AppState, Linking } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, StatusTag, SwiThemeProvider } from '@kavicki/swi-design-system';
import { HealthConnectMonitoring } from '../../../components/telemetry/HealthConnectMonitoring';
import type { HealthConnectState } from '../../../services/telemetry/healthConnect/healthConnectReader';
import {
  useTelemetryUploadState,
  type TelemetryUploadContextValue,
} from '../../../services/telemetry/TelemetryUploadProvider';

// O Monitoramento em Configurações no Android: o estado do Health Connect, a
// pulseira detectada, a última sincronização, o envio, e as ações de cada
// estado. A fronteira dublada é o contexto do envio; trocar o valor e
// renderizar de novo imita o provider relendo o estado. O relógio é falso,
// porque é ele que faz a "última sincronização" andar com a tela aberta.

jest.mock('../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: jest.fn(),
}));
const mockEnvio = useTelemetryUploadState as jest.MockedFunction<typeof useTelemetryUploadState>;

const NOW = new Date('2026-10-01T15:00:00.000Z');
const MIN = 60 * 1000;
const MARKET = 'market://details?id=com.google.android.apps.healthdata';

const mockSyncNow = jest.fn(async () => undefined);
const mockPedir = jest.fn(async (): Promise<'granted' | 'denied' | 'unavailable'> => 'denied');
const mockConferir = jest.fn(
  async (): Promise<'available' | 'unavailable' | 'update_required'> => 'available',
);
const mockAjustes = jest.fn();
const mockRedetectar = jest.fn(async () => true);
const mockParear = jest.fn();

const estadoHC = (parcial: Partial<HealthConnectState> = {}): HealthConnectState => ({
  availability: 'available',
  permission: 'granted',
  bandPackage: 'com.huami.watch.hmwatchmanager',
  bandLabel: 'Zepp',
  noBand: false,
  lastSyncAt: new Date(NOW.getTime() - 3 * MIN).toISOString(),
  ...parcial,
});

const comEnvio = (parcial: Partial<TelemetryUploadContextValue> = {}) =>
  mockEnvio.mockReturnValue({
    paired: true,
    lastOutcome: null,
    refreshPairing: jest.fn(),
    healthConnect: estadoHC(),
    syncNow: mockSyncNow,
    syncing: false,
    requestHealthConnectPermission: mockPedir,
    checkHealthConnect: mockConferir,
    openHealthConnectSettings: mockAjustes,
    redetectBand: mockRedetectar,
    ...parcial,
  });

let montada: ReactTestRenderer | null = null;

const arvore = () => (
  <SwiThemeProvider>
    <HealthConnectMonitoring onPair={mockParear} />
  </SwiThemeProvider>
);

const montar = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(arvore());
  });
  montada = tree;
  return tree;
};

const renderDeNovo = async (tree: ReactTestRenderer) => {
  await act(async () => {
    tree.update(arvore());
  });
};

const texto = (tree: ReactTestRenderer): string => {
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
const botoes = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Button as React.ComponentType<BotaoProps>);
const botao = (tree: ReactTestRenderer, label: string) =>
  botoes(tree).find((b) => b.props.label === label);
const tocar = async (tree: ReactTestRenderer, label: string) => {
  const alvo = botao(tree, label);
  if (!alvo) throw new Error(`sem o botão "${label}"`);
  await act(async () => {
    alvo.props.onPress();
  });
};

type TagProps = { label?: string; status?: string };
const tags = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(StatusTag as React.ComponentType<TagProps>)
    .map((t) => ({ label: t.props.label, status: t.props.status }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockRedetectar.mockResolvedValue(true);
  comEnvio();
});

afterEach(async () => {
  await act(async () => {
    montada?.unmount();
  });
  montada = null;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Monitoramento no Android: estado do Health Connect', () => {
  // Antes da primeira rodada disponibilidade e permissão são nulas: a tela
  // pergunta ao entrar e diz que está conferindo, sem afirmar nada.
  it('antes de saber, diz que está conferindo e confere ao entrar', async () => {
    comEnvio({ healthConnect: null });
    const tree = await montar();
    expect(mockConferir).toHaveBeenCalledTimes(1);
    expect(texto(tree)).toContain('Conferindo o Health Connect');
    expect(botao(tree, 'Permitir leitura')).toBeUndefined();
    expect(tags(tree)).toEqual([]);
  });

  it('com disponibilidade nula no estado também diz que está conferindo', async () => {
    comEnvio({ healthConnect: estadoHC({ availability: null, permission: null }) });
    const tree = await montar();
    expect(texto(tree)).toContain('Conferindo o Health Connect');
  });

  it('sem Health Connect, oferece instalar pela Play Store', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    comEnvio({ healthConnect: estadoHC({ availability: 'unavailable', permission: null }) });
    const tree = await montar();
    expect(texto(tree)).toContain('Health Connect não instalado');
    expect(botao(tree, 'Permitir leitura')).toBeUndefined();
    await tocar(tree, 'Instalar o Health Connect');
    expect(abrir).toHaveBeenCalledWith(MARKET);
  });

  it('Health Connect desatualizado oferece atualizar, pelo mesmo link', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    comEnvio({ healthConnect: estadoHC({ availability: 'update_required', permission: null }) });
    const tree = await montar();
    expect(texto(tree)).toContain('Health Connect desatualizado');
    await tocar(tree, 'Atualizar o Health Connect');
    expect(abrir).toHaveBeenCalledWith(MARKET);
  });

  it('sem permissão, Permitir leitura abre o pedido do sistema', async () => {
    comEnvio({ healthConnect: estadoHC({ permission: 'denied' }) });
    const tree = await montar();
    expect(texto(tree)).toContain('Leitura não permitida');
    expect(botao(tree, 'Abrir os ajustes do Health Connect')).toBeUndefined();
    await tocar(tree, 'Permitir leitura');
    expect(mockPedir).toHaveBeenCalledTimes(1);
  });

  // Depois de negar, o pedido do sistema pode nem abrir de novo (o Android
  // para de mostrar depois de duas recusas): os ajustes são o caminho certo.
  it('negado aqui, oferece tentar de novo e os ajustes do Health Connect', async () => {
    comEnvio({ healthConnect: estadoHC({ permission: 'denied' }) });
    const tree = await montar();
    await tocar(tree, 'Permitir leitura');

    expect(texto(tree)).toContain('ajustes do Health Connect');
    expect(botao(tree, 'Permitir leitura')).toBeUndefined();
    await tocar(tree, 'Abrir os ajustes do Health Connect');
    expect(mockAjustes).toHaveBeenCalledTimes(1);
    await tocar(tree, 'Tentar de novo');
    expect(mockPedir).toHaveBeenCalledTimes(2);
  });

  // Sem permissão nada da pulseira é lido: nem pulseira nem redetectar.
  it('sem permissão não mostra pulseira nem redetectar', async () => {
    comEnvio({ healthConnect: estadoHC({ permission: 'denied' }) });
    const tree = await montar();
    expect(tags(tree)).toEqual([]);
    expect(botao(tree, 'Redetectar pulseira')).toBeUndefined();
  });

  // A volta da Play Store ou dos ajustes é a volta ao primeiro plano.
  it('ao voltar ao primeiro plano, confere o Health Connect de novo', async () => {
    let aoMudar: ((estado: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_tipo, ouvinte) => {
      aoMudar = ouvinte as (estado: string) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    comEnvio({ healthConnect: estadoHC({ availability: 'unavailable', permission: null }) });
    const tree = await montar();
    expect(mockConferir).toHaveBeenCalledTimes(1);

    comEnvio({ healthConnect: estadoHC({ permission: 'denied' }) });
    await act(async () => {
      aoMudar!('active');
    });
    await renderDeNovo(tree);

    expect(mockConferir).toHaveBeenCalledTimes(2);
    expect(botao(tree, 'Permitir leitura')).toBeDefined();
  });

  it('nada do Apple Watch aparece', async () => {
    for (const healthConnect of [
      null,
      estadoHC({ availability: 'unavailable', permission: null }),
      estadoHC({ permission: 'denied' }),
      estadoHC(),
    ]) {
      comEnvio({ healthConnect });
      const tree = await montar();
      const t = texto(tree);
      expect(t).not.toMatch(/iPhone|Apple Watch|bpm/i);
      expect(botao(tree, 'Ativar monitoramento')).toBeUndefined();
      await act(async () => {
        tree.unmount();
      });
      montada = null;
    }
  });
});

describe('Monitoramento no Android: pulseira, sincronização e envio', () => {
  it('pareado e concedido: pulseira, última sincronização, envio e os dois botões', async () => {
    const tree = await montar();
    const t = texto(tree);
    expect(t).toContain('Leitura permitida');
    expect(tags(tree)).toEqual([{ label: 'Pulseira detectada: Zepp', status: 'accept' }]);
    expect(t).toContain('Última sincronização há 3 min');
    expect(t).toContain('Enviando ao servidor');
    expect(botao(tree, 'Sincronizar agora')).toBeDefined();
    expect(botao(tree, 'Redetectar pulseira')).toBeDefined();
    expect(botao(tree, 'Parear aparelho')).toBeUndefined();
  });

  it('a última sincronização anda com o relógio, com a tela aberta', async () => {
    const tree = await montar();
    expect(texto(tree)).toContain('Última sincronização há 3 min');
    await act(async () => {
      jest.advanceTimersByTime(2 * MIN);
    });
    expect(texto(tree)).toContain('Última sincronização há 5 min');
  });

  it('sem sincronização ainda, diz que não houve', async () => {
    comEnvio({ healthConnect: estadoHC({ lastSyncAt: null, bandPackage: null, bandLabel: null }) });
    const tree = await montar();
    expect(texto(tree)).toContain('Ainda não houve sincronização com o Health Connect.');
  });

  it('sem pareamento: oferece parear, e não sincronizar nem redetectar', async () => {
    comEnvio({ paired: false });
    const tree = await montar();
    expect(texto(tree)).toContain('Aparelho não pareado');
    expect(botao(tree, 'Sincronizar agora')).toBeUndefined();
    expect(botao(tree, 'Redetectar pulseira')).toBeUndefined();
    await tocar(tree, 'Parear aparelho');
    expect(mockParear).toHaveBeenCalledTimes(1);
  });

  // Sem a leitura permitida a rodada não lê nada: o botão primário só
  // piscaria. A mesma regra do Redetectar.
  it('pareado sem leitura permitida não oferece sincronizar', async () => {
    for (const healthConnect of [
      null,
      estadoHC({ availability: null, permission: null }),
      estadoHC({ availability: 'unavailable', permission: null }),
      estadoHC({ availability: 'update_required', permission: null }),
      estadoHC({ permission: 'denied' }),
      estadoHC({ permission: null }),
    ]) {
      comEnvio({ healthConnect });
      const tree = await montar();
      expect(botao(tree, 'Sincronizar agora')).toBeUndefined();
      expect(botao(tree, 'Sincronizando…')).toBeUndefined();
      await act(async () => {
        tree.unmount();
      });
      montada = null;
    }
  });

  it('Sincronizar agora pede a sincronização', async () => {
    const tree = await montar();
    await tocar(tree, 'Sincronizar agora');
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
  });

  // O progresso é o `syncing` do contexto: um estado só para toda tela.
  it('enquanto sincroniza, o botão mostra o progresso e fica desabilitado', async () => {
    comEnvio({ syncing: true });
    const tree = await montar();
    const sincronizando = botao(tree, 'Sincronizando…');
    expect(sincronizando).toBeDefined();
    expect(sincronizando!.props.disabled).toBe(true);
    expect(botao(tree, 'Sincronizar agora')).toBeUndefined();
    expect(botao(tree, 'Redetectar pulseira')!.props.disabled).toBe(true);
  });

  it('sem pulseira, avisa, diz o que conferir e não oferece redetectar', async () => {
    comEnvio({ healthConnect: estadoHC({ bandPackage: null, bandLabel: null, noBand: true }) });
    const tree = await montar();
    expect(tags(tree)).toEqual([{ label: 'Nenhuma pulseira encontrada', status: 'pending' }]);
    expect(texto(tree)).toContain('Abra o app da sua pulseira');
    expect(botao(tree, 'Redetectar pulseira')).toBeUndefined();
  });

  // Antes do primeiro resultado não se afirma nada da pulseira; enquanto a
  // leitura corre, diz que está procurando.
  it('sem resultado ainda não afirma nada, e sincronizando diz que procura', async () => {
    comEnvio({ healthConnect: estadoHC({ bandPackage: null, bandLabel: null }) });
    const tree = await montar();
    expect(tags(tree)).toEqual([]);
    expect(botao(tree, 'Redetectar pulseira')).toBeUndefined();

    comEnvio({ healthConnect: estadoHC({ bandPackage: null, bandLabel: null }), syncing: true });
    await renderDeNovo(tree);
    expect(tags(tree)).toEqual([
      { label: 'Procurando a pulseira no Health Connect…', status: 'info' },
    ]);
  });
});

describe('Monitoramento no Android: redetectar a pulseira', () => {
  it('redetecta e, com sucesso, sincroniza na hora', async () => {
    const ordem: string[] = [];
    mockRedetectar.mockImplementationOnce(async () => {
      ordem.push('redetecção');
      return true;
    });
    mockSyncNow.mockImplementationOnce(async () => {
      ordem.push('sincronização');
    });
    const tree = await montar();
    await tocar(tree, 'Redetectar pulseira');
    expect(ordem).toEqual(['redetecção', 'sincronização']);
    expect(texto(tree)).not.toContain('Não foi possível redetectar');
  });

  it('com falha, diz que não deu e não sincroniza', async () => {
    mockRedetectar.mockResolvedValueOnce(false);
    const tree = await montar();
    await tocar(tree, 'Redetectar pulseira');
    expect(mockSyncNow).not.toHaveBeenCalled();
    expect(texto(tree)).toContain('Não foi possível redetectar a pulseira. Tente de novo.');
    expect(botao(tree, 'Redetectar pulseira')).toBeDefined();
  });

  // A frase pede para tentar de novo: sem o botão (permissão revogada,
  // pulseira esquecida por outro caminho) ela ficaria sem ação.
  it('a falha some junto com o botão de redetectar', async () => {
    mockRedetectar.mockResolvedValueOnce(false);
    const tree = await montar();
    await tocar(tree, 'Redetectar pulseira');
    expect(texto(tree)).toContain('Não foi possível redetectar');

    comEnvio({ healthConnect: estadoHC({ permission: 'denied' }) });
    await renderDeNovo(tree);
    expect(botao(tree, 'Redetectar pulseira')).toBeUndefined();
    expect(texto(tree)).not.toContain('Não foi possível redetectar');

    comEnvio({ healthConnect: estadoHC({ bandPackage: null, bandLabel: null }) });
    await renderDeNovo(tree);
    expect(texto(tree)).not.toContain('Não foi possível redetectar');
  });

  it('tentar de novo depois da falha apaga a mensagem ao dar certo', async () => {
    mockRedetectar.mockResolvedValueOnce(false);
    const tree = await montar();
    await tocar(tree, 'Redetectar pulseira');
    expect(texto(tree)).toContain('Não foi possível redetectar');
    await tocar(tree, 'Redetectar pulseira');
    expect(texto(tree)).not.toContain('Não foi possível redetectar');
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
  });

  // Dois toques no mesmo quadro veem o mesmo estado: o segundo não pode
  // virar outra redetecção.
  it('dois toques rápidos são uma redetecção só', async () => {
    let soltar!: (ok: boolean) => void;
    mockRedetectar.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          soltar = resolve;
        }),
    );
    const tree = await montar();
    const alvo = botao(tree, 'Redetectar pulseira')!;
    await act(async () => {
      alvo.props.onPress();
      alvo.props.onPress();
    });
    expect(mockRedetectar).toHaveBeenCalledTimes(1);
    await act(async () => {
      soltar(true);
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
  });
});
